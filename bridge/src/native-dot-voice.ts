import type { NativeVoiceCommand, NativeVoiceEvent, VoiceTransportState } from "./native-dot-protocol.js";

type Delivery = (payload: Record<string, unknown> & { version: 1; kind: string }) => Promise<void>;
export interface NativeDotConnection {
  nativeVoiceAvailable(threadId: string): boolean;
  configuredDot(threadId: string): { title: string } | null;
  voiceCommand(command: NativeVoiceCommand): void;
}
type Call = { id: string; threadId: string; startedAt: number; expiresAt: number; accepted: boolean; answer: boolean; active: boolean; transportSeq: number };
type EndReason = "watch" | "native" | "receiver-lost" | "expired" | "bridge-stop";
type TimingLog = (fields: { callId: string; stage: string; at: number; sinceStartMs: number;
  browserElapsedMs?: number; setupTiming?: NativeVoiceEvent["setupTiming"]; httpTiming?: NativeVoiceEvent["httpTiming"];
  allocationMode?: NativeVoiceEvent["allocationMode"]; statusCode?: number; endReason?: EndReason }) => void;

/** Account/call control stays in the native browser client; Watch WebRTC owns media. */
export class NativeDotVoice {
  private call: Call | null = null;
  get active(): boolean { return this.call !== null; }
  constructor(private readonly browser: NativeDotConnection, private readonly deliver: Delivery,
    private readonly now = () => Date.now(), private readonly log: TimingLog = () => {}) {}

  owns(callId: string): boolean { return this.call?.id === callId; }
  capability(threadId: string): Record<string, unknown> {
    const dot = this.browser.configuredDot(threadId);
    return { realtimeApiAvailable: Boolean(dot && this.browser.nativeVoiceAvailable(threadId)), requiresHostReady: true,
      nativeDot: true, voices: { defaultV1: "dot" }, task: { id: threadId, title: dot?.title ?? "Your Dot", cwd: "", model: null, effort: null } };
  }
  start(callId: string, threadId: string, sdp: string): void {
    if (this.call) {
      if (this.call.id === callId && this.call.threadId === threadId) return;
      throw new Error("Another live voice call is active. End it before reconnecting.");
    }
    if (!this.browser.configuredDot(threadId) || !this.browser.nativeVoiceAvailable(threadId))
      throw new Error("Open Lumen in Chrome with the current Watch receiver before connecting native voice.");
    if (!sdp.startsWith("v=0") || !sdp.includes("m=audio") || sdp.length > 65_536) throw new Error("A valid WebRTC audio offer is required");
    const call: Call = { id: callId, threadId, startedAt: this.now(), expiresAt: this.now() + 45_000, accepted: false, answer: false, active: false, transportSeq: 0 };
    this.call = call;
    try { this.command(call, { action: "start", sdp }); this.timing(call, "start.dispatched"); }
    catch (error) { if (this.call === call) this.call = null; throw error; }
    // Do not await media here: Watch peer-state messages must remain dispatchable
    // while the native client creates and attaches its authenticated call.
  }
  transport(callId: string, transport: VoiceTransportState): void {
    const call = this.call;
    if (!call || call.id !== callId || transport.seq <= call.transportSeq) return;
    call.transportSeq = transport.seq;
    this.command(call, { action: "transport", transport });
  }
  heartbeat(callId: string): void {
    const call = this.call;
    if (!call || call.id !== callId) throw new Error("This call has ended. Reconnect explicitly.");
    call.expiresAt = this.now() + 45_000;
    this.command(call, { action: "heartbeat" });
  }
  async stop(callId: string, reason = "Call ended", endReason: EndReason = "watch"): Promise<void> {
    const call = this.call;
    if (!call || call.id !== callId) return;
    this.call = null;
    this.timing(call, "call.closed", undefined, endReason);
    // Browser commands carry the call id. A delayed stop cannot close a later
    // call, and loss of the browser socket is handled by its own ownership lease.
    try { this.command(call, { action: "stop" }); }
    catch { /* The disconnected client releases its owned call on control loss. */ }
    await this.deliver({ version: 1, kind: "live.closed", callId, reason });
  }
  async event(value: NativeVoiceEvent): Promise<void> {
    const call = this.call;
    if (!call || value.callId !== call.id || value.threadId !== call.threadId) return;
    if (value.state === "progress") { this.timing(call, `browser.startup.${value.progressStage}`, value); }
    else if (value.state === "timing") { this.timing(call, `browser.http.${value.httpTiming?.phase}`, value); }
    else if (value.state === "accepted") { call.accepted = true; this.timing(call, "browser.accepted", value); }
    else if (value.state === "answer" && call.accepted && !call.answer) {
      call.answer = true;
      this.timing(call, "browser.answer", value);
      await this.deliver({ version: 1, kind: "live.answer", callId: call.id, sdp: value.sdp });
      this.timing(call, "relay.answer.accepted");
    } else if (value.state === "active" && call.accepted && call.answer && !call.active) {
      call.active = true;
      this.timing(call, "browser.active", value);
      await this.deliver({ version: 1, kind: "live.ready", callId: call.id });
      this.timing(call, "relay.ready.accepted");
    } else if (value.state === "failed" || value.state === "closed") {
      this.timing(call, `browser.${value.state}`, value);
      const cleanupFailed = value.setupTiming?.cleanupStartMs !== undefined && value.setupTiming.captureMs === undefined;
      await this.stop(call.id, value.state === "closed" ? "Lumen ended the call" : cleanupFailed
        ? "Chrome could not finish closing the previous Lumen call. Retry after it has closed."
        : "Lumen could not connect its native call. Reconnect when it is available.", "native");
    }
  }
  async disconnected(): Promise<void> { if (this.call) await this.stop(this.call.id, "The native Dot browser disconnected. Reconnect when it is available.", "receiver-lost"); }
  async expire(): Promise<void> { if (this.call && this.now() >= this.call.expiresAt) await this.stop(this.call.id, "Watch voice connection expired", "expired"); }
  async close(): Promise<void> { if (this.call) await this.stop(this.call.id, "Call ended", "bridge-stop"); }

  private timing(call: Call, stage: string, event?: NativeVoiceEvent, endReason?: EndReason): void {
    const at = this.now();
    this.log({ callId: call.id, stage, at, sinceStartMs: Math.max(0, at - call.startedAt),
      ...(event?.elapsedMs !== undefined ? { browserElapsedMs: event.elapsedMs } : {}),
      ...(event?.setupTiming ? { setupTiming: event.setupTiming } : {}),
      ...(event?.httpTiming ? { httpTiming: event.httpTiming } : {}),
      ...(event?.allocationMode ? { allocationMode: event.allocationMode } : {}),
      ...(endReason ? { endReason } : {}),
      ...(event?.statusCode !== undefined ? { statusCode: event.statusCode } : {}) });
  }

  private command(call: Call, fields: { action: "start"; sdp: string } | { action: "transport"; transport: VoiceTransportState } | { action: "heartbeat" | "stop" }): void {
    this.browser.voiceCommand({ version: 1, kind: "native-voice", callId: call.id, threadId: call.threadId,
      expiresAt: this.now() + 45_000, ...fields });
  }
}
