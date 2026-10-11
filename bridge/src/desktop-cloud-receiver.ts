import { timingSafeEqual } from "node:crypto";
import { chmod, lstat, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { z } from "zod";
import type { ChatSnapshot, SessionView } from "./app-server-client.js";
import type { BridgeConfig } from "./config.js";
import {
  CLOUD_FRAME_BYTES, CLOUD_MAX_AGE_MS, DEFAULT_CLOUD_CHAT_TITLE, DYNAMIC_CLOUD_OWN_MS, autoCloudChatsEnabled, cloudEventId, isCloudChatUuid, cloudFrameSchema, cloudHelloSchema,
  desktopCloudConfigPath, desktopCloudPairBinding, desktopCloudSocketPath, logDesktopCloud,
  readDesktopCloudConfig, readPrivateJson, writePrivateJson,
  type CloudSendResult, type CloudFrame, type CloudLog, type CloudSnapshot, type CloudTerminal, type DesktopCloudConfig,
} from "./desktop-cloud-protocol.js";

const receiptsSchema = z.object({ version: z.literal(1), pairBinding: z.string(),
  eventIds: z.array(z.string().max(128)).max(1024) }).strict();
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
async function removeStaleSocket(path: string): Promise<void> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null; throw error;
  });
  if (!stat) return;
  if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw new Error("Cloud socket path is already occupied");
  const inactive = await new Promise<boolean>((resolve) => {
    const probe = createConnection(path);
    probe.once("connect", () => { probe.destroy(); resolve(false); });
    probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ECONNREFUSED" || error.code === "ENOENT"));
    probe.setTimeout(500, () => { probe.destroy(); resolve(false); });
  });
  if (!inactive) throw new Error("A cloud receiver is already listening");
  const current = await lstat(path).catch(() => null);
  if (current?.ino === stat.ino && current.isSocket()) await unlink(path);
}

function cloudFields(snapshot: CloudSnapshot | undefined): Pick<SessionView, "cloudModel" | "cloudModels" | "cloudEffort" | "cloudEfforts"> {
  if (!snapshot) return {};
  return { ...(snapshot.cloudModel ? { cloudModel: snapshot.cloudModel } : {}), ...(snapshot.cloudModels?.length ? { cloudModels: snapshot.cloudModels } : {}),
    ...(snapshot.cloudEffort ? { cloudEffort: snapshot.cloudEffort } : {}), ...(snapshot.cloudEfforts?.length ? { cloudEfforts: snapshot.cloudEfforts } : {}) };
}
export class DesktopCloudReceiver {
  private config: DesktopCloudConfig | null = null;
  private server: Server | null = null;
  private active: Socket | null = null;
  private sockets = new Set<Socket>();
  private snapshots = new Map<string, { snapshot: CloudSnapshot; observedAt: number }>();
  // Open `chatgpt.com/local/<uuid>` tabs reported by the browser (not in the config allowlist).
  private dynamicSeen = new Map<string, { title: string; seenAt: number }>();
  private receipts = new Set<string>();
  private socketInode: number | null = null;
  private closed = false;
  private sends = new Map<string, {threadId:string; resolve:(value:CloudSendResult)=>void; timer:NodeJS.Timeout}>();
  /** Options a browser cloud chat reports right now (empty for Dot or before the first snapshot). */
  cloudOptions(threadId:string):{models:string[];efforts:string[]}|null {
    const s=this.snapshots.get(threadId)?.snapshot;
    return s ? {models:s.cloudModels??[], efforts:s.cloudEfforts??[]} : null;
  }
  async submitText(threadId:string, requestId:string, text:string, checkOnly=false, selection:{model?:string;effortIndex?:number}={}):Promise<CloudSendResult> {
    const target=this.config?.targets.find(t=>t.threadId===threadId);
    const cached=this.snapshots.get(threadId);
    const sendEnabled=target ? target.sendEnabled : this.isDynamic(threadId);
    if(!sendEnabled || !this.active || (!checkOnly && !cached?.snapshot.inputReady) || !cached ||
       Date.now()-cached.observedAt > CLOUD_MAX_AGE_MS) throw new Error("Open the connected browser chat with an empty composer before sending. Your Watch draft is kept.");
    if(this.sends.has(requestId) || [...this.sends.values()].some(s=>s.threadId===threadId)) throw new Error("A Watch send is already in progress for this chat.");
    const socket=this.active;
    this.log("send_dispatched",{threadId,requestId,checkOnly,dispatchedAt:Date.now()});
    const result=await new Promise<CloudSendResult>(resolve=>{
      const timer=setTimeout(()=>{this.sends.delete(requestId);resolve({requestId,threadId,outcome:"uncertain",message:"Browser send timed out; check the chat before retrying."});},18_000);
      this.sends.set(requestId,{threadId,resolve,timer});
      socket.write(`${JSON.stringify({version:1,kind:"send",requestId,threadId,text,checkOnly,expiresAt:Date.now()+15000,
        ...(selection.model!==undefined?{model:selection.model}:{}),...(selection.effortIndex!==undefined?{effortIndex:selection.effortIndex}:{})})}\n`);
    });
    this.log("send_result",{threadId,requestId,outcome:result.outcome,receivedAt:Date.now()});
    if(result.outcome!=="accepted") throw new Error(result.outcome==="uncertain" ? `Browser send timed out or was uncertain. ${result.message}` : result.message);
    return result;
  }
  constructor(private readonly pairing: Pick<BridgeConfig, "pairId" | "bridgePublicKey" | "watchPublicKey">,
    private readonly onTerminal: (event: CloudTerminal) => Promise<void>,
    private readonly onSnapshot: (threadId: string) => void,
    private readonly path = desktopCloudConfigPath(), private readonly log: CloudLog = logDesktopCloud) {}
  async start(): Promise<void> {
    this.config = await readDesktopCloudConfig(this.path);
    if (!this.config?.enabled) { this.config = null; return; }
    if (this.config.pairBinding !== desktopCloudPairBinding(this.pairing)) {
      this.log("pairing_mismatch"); return; // Retain receive-only ownership; never fall back to a sender.
    }
    const raw = await readPrivateJson(`${this.path}.receipts`);
    if (raw !== null) {
      const stored = receiptsSchema.parse(raw);
      if (stored.pairBinding === this.config.pairBinding) this.receipts = new Set(stored.eventIds);
    }
    const socketPath = desktopCloudSocketPath(this.path);
    if (Buffer.byteLength(socketPath) > 103) throw new Error("Cloud socket path is too long");
    await removeStaleSocket(socketPath);
    const server = createServer((socket) => this.accept(socket)); this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject); server.listen(socketPath, () => { server.off("error", reject); resolve(); });
    });
    server.on("error", () => { this.log("listener_error"); });
    await chmod(socketPath, 0o600);
    this.socketInode = (await lstat(socketPath)).ino;
    this.log("listening", { targets: this.config.targets.length });
  }
  /** A dynamic (non-config) cloud chat seen within DYNAMIC_CLOUD_OWN_MS while auto chats are enabled. */
  private isDynamic(threadId: unknown): boolean {
    if (typeof threadId !== "string" || !autoCloudChatsEnabled(this.config) || this.config?.targets.some((t) => t.threadId === threadId)) return false;
    const seen = this.dynamicSeen.get(threadId);
    return seen !== undefined && Date.now() - seen.seenAt <= DYNAMIC_CLOUD_OWN_MS;
  }
  private noteDynamic(threadId: string, title: string | null): void {
    const previous = this.dynamicSeen.get(threadId);
    this.dynamicSeen.delete(threadId);
    this.dynamicSeen.set(threadId, { title: title?.trim() || previous?.title || DEFAULT_CLOUD_CHAT_TITLE, seenAt: Date.now() });
    for (const [id, seen] of this.dynamicSeen) if (Date.now() - seen.seenAt > DYNAMIC_CLOUD_OWN_MS) this.dynamicSeen.delete(id);
    while (this.dynamicSeen.size > 32) this.dynamicSeen.delete(this.dynamicSeen.keys().next().value!);
  }
  owns(threadId: unknown): boolean {
    return (this.config?.targets.some((target) => target.threadId === threadId) ?? false) || this.isDynamic(threadId);
  }
  sessions(): SessionView[] {
    const now = Date.now();
    const fresh = (threadId: string) => { const cached = this.snapshots.get(threadId); return cached !== undefined && now - cached.observedAt < CLOUD_MAX_AGE_MS; };
    const targets = (this.config?.targets ?? []).map((target) => {
      const cached = this.snapshots.get(target.threadId);
      const ready = Boolean(target.sendEnabled && this.active && cached?.snapshot.inputReady && now-cached.observedAt<CLOUD_MAX_AGE_MS);
      return { id: target.threadId, title: target.title, updatedAt: cached?.observedAt ?? 0,
        status: this.active && cached ? cached.snapshot.status : "notLoaded",
        source: target.dotNamespace ? "dot" as const : "cloud" as const,
        ...(target.dotNamespace ? {} : cloudFields(cached?.snapshot)),
        ownedByWear: false, canAcceptDirectInput: ready, watchReady: ready };
    });
    // A dynamic chat is listed only while its tab keeps reporting (fresh snapshot).
    const dynamic: SessionView[] = !this.active || !autoCloudChatsEnabled(this.config) ? [] : [...this.dynamicSeen.entries()]
      .filter(([id]) => this.isDynamic(id) && fresh(id))
      .map(([id, seen]) => {
        const cached = this.snapshots.get(id)!;
        const ready = Boolean(cached.snapshot.inputReady);
        return { id, title: cached.snapshot.title.trim() || seen.title, updatedAt: cached.observedAt, status: cached.snapshot.status,
          source: "cloud" as const, ...cloudFields(cached.snapshot), ownedByWear: false, canAcceptDirectInput: ready, watchReady: ready };
      });
    return [...targets, ...dynamic];
  }
  snapshot(threadId: string): ChatSnapshot {
    const target = this.config?.targets.find((entry) => entry.threadId === threadId);
    const dynamic = target ? undefined : this.dynamicSeen.get(threadId);
    if (!target && !(dynamic && this.isDynamic(threadId))) throw new Error("Cloud chat is not in the receive-only allowlist");
    const title = target?.title ?? dynamic?.title ?? DEFAULT_CLOUD_CHAT_TITLE;
    const cached = this.snapshots.get(threadId)?.snapshot;
    const snapshot = cached ?? { threadId, title, status: "notLoaded" as const, messages: [] };
    const { cloudModel: _m, cloudModels: _ms, cloudEffort: _e, cloudEfforts: _es, ...rest } = snapshot;
    return { ...rest, ...(target?.dotNamespace ? {} : cloudFields(snapshot)), status: this.active ? snapshot.status : "notLoaded",
      paragraphs: snapshot.messages.filter((message) => message.role === "assistant")
        .map(({ id, text, phase }) => ({ id, text, phase })) };
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const socket of this.sockets) socket.destroy();
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    const socketPath = desktopCloudSocketPath(this.path), stat = await lstat(socketPath).catch(() => null);
    if (this.socketInode !== null && stat?.ino === this.socketInode && stat.isSocket()) await unlink(socketPath);
  }
  private accept(socket: Socket): void {
    if (this.closed || this.sockets.size >= 4) { socket.destroy(); return; }
    this.sockets.add(socket);
    let input = "", streamId: string | null = null, queued = 0, chain = Promise.resolve();
    socket.setEncoding("utf8");
    const handshakeTimeout = setTimeout(() => { if (!streamId) socket.destroy(); }, 2_000);
    handshakeTimeout.unref();
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(handshakeTimeout); this.sockets.delete(socket);
      if (this.active === socket) { this.active = null; this.log("disconnected");
        for(const [requestId,pending] of this.sends){clearTimeout(pending.timer);pending.resolve({requestId,threadId:pending.threadId,outcome:"uncertain",message:"Browser socket closed after dispatch; check the chat before retrying."});}
        this.sends.clear(); }
    });
    socket.on("data", (chunk: string) => {
      input += chunk;
      if (Buffer.byteLength(input) > CLOUD_FRAME_BYTES) { socket.destroy(); return; }
      let newline;
      while ((newline = input.indexOf("\n")) >= 0) {
        const line = input.slice(0, newline); input = input.slice(newline + 1);
        if (++queued > 16) { socket.destroy(); return; }
        chain = chain.then(async () => {
          if (socket.destroyed || this.closed) return;
          const value: unknown = JSON.parse(line);
          if (!streamId) {
            const hello = cloudHelloSchema.parse(value);
            if (this.active || !this.config || !sameSecret(hello.capability, this.config.capability) ||
                !sameSecret(hello.pairBinding, this.config.pairBinding)) throw new Error("Unauthorized cloud sender");
            this.active = socket; streamId = hello.streamId; this.snapshots.clear();
            clearTimeout(handshakeTimeout); this.log("authenticated"); return;
          }
          const frame = cloudFrameSchema.parse(value);
          if (frame.streamId !== streamId || this.active !== socket) throw new Error("Retired cloud stream");
          await this.receive(frame);
          if (!socket.destroyed) socket.write(`${JSON.stringify({ version: 1, kind: "ack", id: frame.id })}\n`);
        }).catch(() => { this.log("frame_rejected"); socket.destroy(); }).finally(() => { queued--; });
      }
    });
  }
  private async receive(frame: CloudFrame): Promise<void> {
    if (frame.kind === "reset") { this.snapshots.clear(); return; }
    if(frame.kind==="send-result") {
      const pending=this.sends.get(frame.result.requestId);
      if(pending && pending.threadId===frame.result.threadId){clearTimeout(pending.timer);this.sends.delete(frame.result.requestId);pending.resolve(frame.result);}
      return;
    }
    const threadId = frame.kind === "snapshot" ? frame.snapshot.threadId : frame.event.threadId;
    const configured = this.config?.targets.some((target) => target.threadId === threadId) ?? false;
    if (!configured && !(autoCloudChatsEnabled(this.config) && isCloudChatUuid(threadId))) throw new Error("Thread not allowlisted");
    const observedAt = frame.kind === "snapshot" ? frame.observedAt : frame.event.observedAt;
    if (observedAt > Date.now() + 5_000 || Date.now() - observedAt > CLOUD_MAX_AGE_MS) {
      this.log("stale_frame", { threadId }); return;
    }
    if (frame.kind === "snapshot") {
      const previous = this.snapshots.get(threadId);
      if (!previous || observedAt >= previous.observedAt) {
        this.snapshots.set(threadId, { snapshot: frame.snapshot, observedAt });
        if (!configured) this.noteDynamic(threadId, frame.snapshot.title);
        // Ack cache admission immediately. Relay delivery of a quiet snapshot
        // must not hold an urgent terminal alert behind a slow network request.
        this.onSnapshot(threadId);
      }
      return;
    }
    const event = frame.event;
    if (!configured) this.noteDynamic(threadId, event.title);
    if (event.eventId !== cloudEventId(threadId, event.turnId, event.kind) || frame.id !== event.eventId) throw new Error("Invalid terminal identity");
    if (!this.receipts.has(event.eventId)) {
      const receivedAt = Date.now();
      try { await this.onTerminal(event); }
      catch { this.log("delivery_failed", { eventId: event.eventId }); throw new Error("Cloud relay delivery failed; retry with the same event id"); }
      this.receipts.add(event.eventId);
      if (this.receipts.size > 1024) this.receipts.delete(this.receipts.values().next().value!);
      this.log("terminal_relayed", { eventId: event.eventId, threadId, turnId: event.turnId,
        nativeCompletedAt: event.nativeCompletedAt, desktopObservedAt: event.observedAt, source: event.source,
        bridgeReceivedAt: receivedAt, relayAcceptedAt: Date.now(), desktopToRelayMs: Date.now() - event.observedAt });
    } else this.log("terminal_duplicate", { eventId: event.eventId });
    // A lost local ack may retry, but eventId deduplicates on both bridge and
    // Watch. Receipt storage contains no message text or account credentials.
    await writePrivateJson(`${this.path}.receipts`, { version: 1, pairBinding: this.config!.pairBinding, eventIds: [...this.receipts] });
  }
}
