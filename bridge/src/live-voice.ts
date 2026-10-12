import { z } from "zod";

export interface LiveAppServer {
  startRealtime(threadId: string, sdp: string, voice: string, fastMode?: boolean): Promise<void>;
  stopRealtime(threadId: string): Promise<void>;
}
type Delivery = (payload: Record<string, unknown> & { version: 1; kind: string }) => Promise<void>;
type Call = { id: string; threadId: string; expires: number; owned: boolean;
  phase: "starting" | "active" | "stopping"; stopAttempted: boolean; stopping: Promise<void> | null; startedAt: number };

/** Signaling only. WebRTC carries microphone/speaker media; never queue watch audio. */
export class LiveVoice {
  private call: Call | null = null;
  private starting: Promise<void> | null = null;
  get active(): boolean { return this.call !== null; }
  constructor(private readonly server: LiveAppServer, private readonly deliver: Delivery,
    private readonly now = () => performance.now(),
    private readonly log: (line: string) => void = (line) => console.log(line)) {}

  /** Signaling milestones only: ids and timings, never SDP, audio or captions. */
  private mark(call: Call, stage: string, extra: Record<string, unknown> = {}): void {
    this.log(JSON.stringify({ level: "info", message: "live.voice.timing", callId: call.id, threadId: call.threadId,
      stage, at: Date.now(), sinceOfferMs: Math.round(this.now() - call.startedAt), ...extra }));
  }

  async start(callId: string, threadId: string, sdp: string, voice: string, fastMode?: boolean): Promise<void> {
    if (this.call) {
      if (this.call.id === callId && this.call.threadId === threadId) {
        const existing = this.call;
        if (existing.phase === "stopping") throw new Error("This call is ending. Reconnect explicitly after it ends.");
        await this.starting;
        if (this.call !== existing || !existing.owned) throw new Error("This call has ended. Reconnect explicitly.");
        return;
      }
      throw new Error("Another live voice call is active. End it before reconnecting.");
    }
    if (!sdp.startsWith("v=0") || !sdp.includes("m=audio") || sdp.length > 65_536)
      throw new Error("A valid WebRTC audio offer is required");
    const call: Call = { id: callId, threadId, expires: this.now() + 45_000, owned: false,
      phase: "starting", stopAttempted: false, stopping: null, startedAt: this.now() };
    this.call = call;
    this.mark(call, "offerReceived");
    let operation: Promise<void> | null = null;
    try {
      operation = fastMode === undefined ? this.server.startRealtime(threadId, sdp, voice)
        : this.server.startRealtime(threadId, sdp, voice, fastMode);
      this.starting = operation;
      await operation;
      if (this.call === call) { call.owned = true; if (call.phase === "starting") call.phase = "active"; }
      this.mark(call, "realtimeStarted");
    } catch (error) {
      this.mark(call, "startRejected");
      // A rejected start may mean another client owns voice. Never stop that client's call.
      if (call.owned) await this.server.stopRealtime(threadId);
      if (this.call === call) this.call = null;
      throw error;
    } finally { if (this.starting === operation) this.starting = null; }
  }

  heartbeat(callId: string): void {
    if (!this.call || this.call.id !== callId || this.call.phase === "stopping")
      throw new Error("This call has ended. Reconnect explicitly.");
    this.call.expires = this.now() + 45_000;
  }

  async stop(callId: string): Promise<void> {
    const call = this.call;
    if (!call || call.id !== callId) return; // Stale stops cannot kill a newer call.
    if (call.stopping) return call.stopping;
    // Stop is scoped only by threadId in the host protocol. A lost response
    // may mean our call ended and a different client now owns the next call.
    // Retain the fence until a native closed event; never retry that stop.
    if (call.stopAttempted)
      throw new Error("Codex did not confirm this call ended. Check its status in Codex before reconnecting.");
    call.stopAttempted = true;
    call.phase = "stopping";
    const operation = (async () => {
      await this.starting?.catch(() => undefined);
      if (this.call !== call) return;
      if (call.owned) await this.server.stopRealtime(call.threadId);
      if (this.call === call) this.call = null;
      this.mark(call, "stoppedByWatch");
      await this.deliver({ version: 1, kind: "live.closed", callId, reason: "Call ended" });
    })();
    call.stopping = operation;
    try { await operation; }
    finally { if (call.stopping === operation) call.stopping = null; }
  }

  async expire(): Promise<void> {
    if (this.call && this.call.phase !== "stopping" && this.now() >= this.call.expires)
      await this.stop(this.call.id);
  }

  async close(): Promise<void> { if (this.call) await this.stop(this.call.id); }

  async notification(method: string, value: unknown): Promise<void> {
    const parsed = z.object({ threadId: z.string() }).passthrough().safeParse(value);
    const call = this.call;
    if (!parsed.success || !call || parsed.data.threadId !== call.threadId) return;
    const p = parsed.data;
    // Thread notifications are broadcast across clients. Only our accepted
    // start RPC establishes ownership; another client's event cannot do so.
    if (method === "thread/realtime/sdp") {
      const sdp = z.string().max(65_536).parse(p.sdp);
      if (call.phase !== "stopping") {
        await this.deliver({ version: 1, kind: "live.answer", callId: call.id, sdp });
        this.mark(call, "answerSentToWatch");
      }
    } else if (method === "thread/realtime/closed") {
      this.call = null;
      this.mark(call, "closed");
      await this.deliver({ version: 1, kind: "live.closed", callId: call.id,
        reason: typeof p.reason === "string" ? p.reason.slice(0, 1200) : "Voice connection ended" });
    } else if (method === "thread/realtime/error") {
      this.mark(call, "error");
      // Avoid leaking server internals or credential-bearing diagnostics into captions.
      await this.deliver({ version: 1, kind: "live.error", callId: call.id,
        message: "Codex voice failed. End the call and check its status in Codex before reconnecting." });
    }
  }
}
