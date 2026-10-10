import { constants } from "node:fs";
import { lstat, mkdir, open, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { ChatSnapshot, SessionView } from "./app-server-client.js";
import { CLOUD_TEXT_TARGET, historyDeliveryTiming, historySnapshot, matchingNativeTurn, mergeNativeHistory, nativePrompt,
  readNativeCloud, safeCloudId, toMillis, unwrapNativeCloud, type NativeHistory } from "./native-cloud-history.js";

const MAX_MESSAGES = 5;
const DURATION_MS = 30 * 60_000;
const DRAIN_MS = 2 * 60_000;
const HEARTBEAT_MS = 45_000;
const sessionSchema = z.object({ id: z.string().uuid(), controller: z.literal(CLOUD_TEXT_TARGET.controllerThreadId),
  owner: z.string().uuid(), startedAt: z.number().int(), expiresAt: z.number().int(), drainUntil: z.number().int() }).strict();
type Session = z.infer<typeof sessionSchema>;
const requestSchema = z.object({ sessionId: z.string().uuid(), requestId: safeCloudId, text: z.string().trim().min(1).max(4_000), receivedAt: z.number().int() }).strict();
type Request = z.infer<typeof requestSchema>;
const claimSchema = z.object({ requestId: safeCloudId, baselineTurnIds: z.array(safeCloudId).max(20), claimedAt: z.number().int() }).strict();
const progressSchema = z.object({ requestId: safeCloudId, stage: z.enum(["accepted", "running", "completed", "failed", "uncertain"]),
  observedAt: z.number().int(), nativeTurnId: safeCloudId.optional(), nativeItemId: safeCloudId.optional(),
  nativeStartedAt: z.number().int().optional(), nativeCompletedAt: z.number().int().optional(), reply: z.string().max(6_000).optional() }).strict();
type Progress = z.infer<typeof progressSchema>;
type Entry = { slot: number; request: Request; claim: z.infer<typeof claimSchema> | null; progress: Progress | null };
type Payload = Record<string, unknown> & { version: 1; kind: string };
type Delivery = (payload: Payload) => Promise<void>;
export type HistoryPublishContext = {
  trigger: "direct" | "periodic";
  subscriptionAcceptedAt?: number;
  subscriptionExpiresAt?: number;
  callbackLatenessMs?: number;
};
const terminal = (stage: string) => ["completed", "failed", "uncertain", "expired"].includes(stage);
const missing = (e: unknown) => e instanceof Error && "code" in e && e.code === "ENOENT";
const exists = (e: unknown) => e instanceof Error && "code" in e && e.code === "EEXIST";

/** Private local state, used only while an existing native controller task is running. */
export class CloudTextSession {
  private enqueueTask: Promise<unknown> = Promise.resolve();
  private publishTask: Promise<void> | null = null;
  private published = new Map<string, string>();
  private publishedHistory = "";

  constructor(readonly directory = join(homedir(), ".agentic-wear", "cloud-text-sessions-v1"),
    private readonly now = Date.now, private readonly monotonicNow = () => performance.now()) {}
  owns(id: unknown): boolean { return id === CLOUD_TEXT_TARGET.threadId; }

  private async checkDirectory(): Promise<void> {
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
      throw new Error("Cloud text state is not a private user-owned directory");
  }

  async read(name: string): Promise<unknown | null> {
    let handle;
    try {
      await this.checkDirectory();
      handle = await open(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) { if (missing(error)) return null; throw error; }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 524_288)
        throw new Error("Cloud text state file is not private or exceeds its bound");
      return JSON.parse(await handle.readFile("utf8")) as unknown;
    } finally { await handle.close(); }
  }

  private async write(name: string, value: unknown, once = false): Promise<void> {
    await this.checkDirectory();
    const text = JSON.stringify(value) + "\n";
    if (Buffer.byteLength(text) > 524_288) throw new Error("Cloud text state exceeds its bound");
    const final = join(this.directory, name);
    const path = once ? final : `${final}.${randomUUID()}.tmp`;
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    if (!once) await rename(path, final);
    const directory = await open(this.directory, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  }

  private file(session: Session, suffix: string): string { return `${session.id}-${suffix}.json`; }
  private async active(): Promise<Session | null> {
    const raw = await this.read("active.json");
    if (!raw) return null;
    const session = sessionSchema.parse(raw);
    if (session.expiresAt - session.startedAt !== DURATION_MS || session.drainUntil - session.expiresAt !== DRAIN_MS || session.startedAt > this.now())
      throw new Error("Cloud text session has invalid bounds");
    return session;
  }
  async configured(): Promise<boolean> { return (await this.active()) !== null; }

  private async alive(session: Session): Promise<boolean> {
    if (await this.read(this.file(session, "disabled"))) return false;
    const heartbeat = await this.read(this.file(session, "heartbeat"));
    const parsed = z.object({ owner: z.literal(session.owner), at: z.number().int() }).safeParse(heartbeat);
    return parsed.success && parsed.data.at <= this.now() && this.now() - parsed.data.at < HEARTBEAT_MS && this.now() < session.drainUntil;
  }

  private async history(session: Session): Promise<NativeHistory | null> {
    return await this.read(this.file(session, "history")) as NativeHistory | null;
  }
  private async entries(session: Session): Promise<Entry[]> {
    const entries: Entry[] = [];
    for (let slot = 0; slot < MAX_MESSAGES; slot++) {
      const raw = await this.read(this.file(session, `request-${slot}`));
      if (!raw) continue;
      const request = requestSchema.parse(raw);
      if (request.sessionId !== session.id || request.receivedAt < session.startedAt || request.receivedAt >= session.expiresAt)
        throw new Error("Watch request belongs to another cloud text window");
      const claim = await this.read(this.file(session, `claim-${slot}`));
      const progress = await this.read(this.file(session, `progress-${slot}`));
      const entry = { slot, request, claim: claim ? claimSchema.parse(claim) : null, progress: progress ? progressSchema.parse(progress) : null };
      if (entry.claim?.requestId && entry.claim.requestId !== request.requestId || entry.progress?.requestId && entry.progress.requestId !== request.requestId)
        throw new Error("Cloud text progress does not match its Watch request");
      entries.push(entry);
    }
    return entries;
  }

  private async effectiveStage(session: Session, entry: Entry): Promise<string> {
    if (entry.progress && terminal(entry.progress.stage)) return entry.progress.stage;
    if (this.now() >= session.drainUntil || await this.read(this.file(session, "disabled"))) return entry.claim ? "uncertain" : "expired";
    if (!entry.claim && this.now() >= session.expiresAt) return "expired";
    if (!await this.alive(session)) return entry.claim ? "reconnecting" : "paused";
    return entry.progress?.stage ?? (entry.claim ? "dispatching" : "queued");
  }

  async session(): Promise<SessionView | null> {
    const session = await this.active();
    if (!session) return null;
    const history = await this.history(session);
    const alive = await this.alive(session);
    const ready = alive && this.now() < session.expiresAt && (await this.entries(session)).length < MAX_MESSAGES;
    return { id: CLOUD_TEXT_TARGET.threadId, title: history?.title ?? CLOUD_TEXT_TARGET.title,
      updatedAt: history?.nativeLatestActivityAt || session.startedAt,
      status: !alive ? "notLoaded" : history?.active ? "active" : "idle", ownedByWear: false,
      watchReady: ready, canAcceptDirectInput: ready };
  }

  enqueue(requestId: string, text: string): Promise<Request> {
    const task = this.enqueueTask.catch(() => undefined).then(() => this.enqueueNow(requestId, text));
    this.enqueueTask = task;
    return task;
  }
  private async enqueueNow(requestId: string, text: string): Promise<Request> {
    const session = await this.active();
    if (!session) throw new Error("The cloud text controller is not connected. Your draft was not sent.");
    const entries = await this.entries(session);
    const existing = entries.find((entry) => entry.request.requestId === requestId);
    if (existing) {
      if (existing.request.text !== text.trim()) throw new Error("Watch request identity was reused with different text");
      return existing.request;
    }
    if (!await this.alive(session) || this.now() >= session.expiresAt)
      throw new Error("The bounded cloud text session is paused or ended. Your draft was not sent.");
    if (entries.length >= MAX_MESSAGES) throw new Error("This cloud text session reached its five-message limit. Your draft was not sent.");
    const request = requestSchema.parse({ sessionId: session.id, requestId, text, receivedAt: this.now() });
    const slot = Array.from({ length: MAX_MESSAGES }, (_, n) => n).find((n) => !entries.some((e) => e.slot === n))!;
    await this.write(this.file(session, `request-${slot}`), request, true);
    return request;
  }

  async snapshot(): Promise<ChatSnapshot & { generatedAt: number }> {
    const session = await this.active();
    if (!session) throw new Error("No native cloud history is connected");
    const history = await this.history(session);
    if (!history) throw new Error("The initial native cloud history is still loading");
    const snapshot = historySnapshot(history);
    if (!await this.alive(session)) snapshot.status = "notLoaded";
    return { ...snapshot, generatedAt: history.observedAt };
  }

  /** Record acceptance for the same snapshot sent by a direct chat.watch reply. */
  async deliverSnapshot(deliver: Delivery, requestId?: string, context: HistoryPublishContext = { trigger: "direct" }): Promise<void> {
    const session = await this.active();
    if (!session) throw new Error("No native cloud history is connected");
    const history = await this.history(session);
    if (!history) throw new Error("The initial native cloud history is still loading");
    await this.deliverHistory(session, history, await this.alive(session), deliver, context, requestId);
  }

  private async deliverHistory(session: Session, history: NativeHistory, online: boolean, deliver: Delivery, context: HistoryPublishContext, requestId?: string): Promise<void> {
    const snapshot = historySnapshot(history);
    if (!online) snapshot.status = "notLoaded";
    const publishStartedAt = this.now();
    const monotonicStart = this.monotonicNow();
    try {
      await deliver({ version: 1, kind: "chat.snapshot", ...snapshot, ...(requestId ? { requestId } : {}), generatedAt: history.observedAt });
    } catch (error) {
      console.warn(JSON.stringify({ level: "warn", message: "cloud.history.publish_failed", at: this.now(),
        trigger: context.trigger, publishStartedAt, publishDurationMs: Math.max(0, this.monotonicNow() - monotonicStart) }));
      throw error;
    }
    const relayAcceptedAt = this.now();
    const publishDurationMs = Math.max(0, this.monotonicNow() - monotonicStart);
    await this.write(this.file(session, "history-delivery"), { revision: history.revision,
      nativeObservedAt: history.observedAt, nativeLatestActivityAt: history.nativeLatestActivityAt,
      publishStartedAt, relayAcceptedAt, publishDurationMs, ...context, messageIds: snapshot.messages.map((m) => m.id), physicalDisplayVerified: false });
    this.publishedHistory = `${session.id}:${history.revision}:${online}`;
  }

  publish(deliver: Delivery, includeSnapshot: boolean, context: HistoryPublishContext = { trigger: "periodic" }): Promise<void> {
    if (this.publishTask) return this.publishTask;
    this.publishTask = this.publishNow(deliver, includeSnapshot, context).finally(() => { this.publishTask = null; });
    return this.publishTask;
  }
  private async publishNow(deliver: Delivery, includeSnapshot: boolean, context: HistoryPublishContext): Promise<void> {
    const session = await this.active();
    if (!session) return;
    const history = await this.history(session);
    const online = await this.alive(session);
    const snapshotKey = `${session.id}:${history?.revision}:${online}`;
    // Publish small request-state/terminal events before bulk history. A slow or
    // failed snapshot must not leave an already-completed request looking busy.
    for (const entry of await this.entries(session)) {
      const stage = await this.effectiveStage(session, entry);
      const key = `${session.id}:${entry.request.requestId}`;
      if (this.published.get(key) === stage) continue;
      await deliver({ version: 1, kind: "turn.started", threadId: CLOUD_TEXT_TARGET.threadId,
        requestId: entry.request.requestId, deliveryState: stage,
        ...(entry.progress?.nativeTurnId ? { nativeTurnId: entry.progress.nativeTurnId } : {}),
        selectionApplied: false, message: statusMessage(stage) });
      if (terminal(stage)) {
        const completed = stage === "completed";
        await deliver({ version: 1, kind: completed ? "terminal.completed" : "terminal.failed",
          turnScope: "topLevel", eventId: `cloud:${session.id}:${entry.slot}:${stage}`, threadId: CLOUD_TEXT_TARGET.threadId,
          requestId: entry.request.requestId, deliveryState: stage,
          title: history?.title ?? CLOUD_TEXT_TARGET.title,
          detail: completed ? entry.progress!.reply : `${statusMessage(stage)}\n\nYour message:\n${entry.request.text}`, occurredAt: this.now() });
        await this.write(this.file(session, `delivery-${entry.slot}`), { requestId: entry.request.requestId, stage,
          nativeTurnId: entry.progress?.nativeTurnId, nativeItemId: entry.progress?.nativeItemId,
          watchReceivedAt: entry.request.receivedAt, nativeObservedAt: entry.progress?.observedAt,
          nativeStartedAt: entry.progress?.nativeStartedAt, nativeCompletedAt: entry.progress?.nativeCompletedAt,
          relayAcceptedAt: this.now(), physicalDisplayVerified: false });
      }
      this.published.set(key, stage);
    }
    if (history && includeSnapshot && this.publishedHistory !== snapshotKey) {
      await this.deliverHistory(session, history, online, deliver, context);
    }
  }

  private nextWork(session: Session, entries: Entry[]): Record<string, unknown> {
    const pending = entries.find((entry) => !terminal(entry.progress?.stage ?? ""));
    if (!pending) return { work: "idle", admissionClosed: this.now() >= session.expiresAt };
    if (pending.claim) return { work: "observe", requestId: pending.request.requestId,
      claimedAt: pending.claim.claimedAt, stage: pending.progress?.stage ?? "dispatching" };
    if (this.now() >= session.expiresAt) return { work: "expired" };
    return { work: "reserve", requestId: pending.request.requestId };
  }

  private async statusView(session: Session, entries: Entry[]): Promise<Record<string, unknown>> {
    const history = await this.history(session);
    const historyDelivery = await this.read(this.file(session, "history-delivery"));
    return { configured: true, sessionId: session.id, alive: await this.alive(session), expiresAt: session.expiresAt,
      drainUntil: session.drainUntil, historyObservedAt: history?.observedAt, historyRevision: history?.revision,
      historyMessages: history?.messages.length ?? 0,
      entries: await Promise.all(entries.map(async (entry) => ({ requestId: entry.request.requestId,
        stage: await this.effectiveStage(session, entry), nativeTurnId: entry.progress?.nativeTurnId,
        receivedAt: entry.request.receivedAt, nativeObservedAt: entry.progress?.observedAt,
        nativeStartedAt: entry.progress?.nativeStartedAt, nativeCompletedAt: entry.progress?.nativeCompletedAt }))),
      historyDelivery, timing: historyDeliveryTiming(history, historyDelivery) };
  }

  private async terminalReceipt(session: Session, entries: Entry[], requestId: unknown): Promise<unknown> {
    if (requestId === undefined) return null;
    const id = safeCloudId.parse(requestId);
    const entry = entries.find((item) => item.request.requestId === id);
    if (!entry) return null;
    const receipt = z.object({ requestId: safeCloudId, stage: z.enum(["completed", "failed", "uncertain", "expired"]),
      nativeTurnId: safeCloudId.optional(), nativeItemId: safeCloudId.optional(), watchReceivedAt: z.number().int(),
      nativeObservedAt: z.number().int().optional(), nativeStartedAt: z.number().int().optional(),
      nativeCompletedAt: z.number().int().optional(), relayAcceptedAt: z.number().int(),
      physicalDisplayVerified: z.literal(false) }).safeParse(await this.read(this.file(session, `delivery-${entry.slot}`)));
    return receipt.success && receipt.data.requestId === id ? receipt.data : null;
  }

  async control(command: string, input: Record<string, unknown> = {}): Promise<unknown> {
    const controlStartedAt = this.now();
    const started = this.monotonicNow();
    const controlTiming = (phases: Record<string, number>) => ({ controlStartedAt, controlCompletedAt: this.now(),
      durationMs: Math.max(0, this.monotonicNow() - started), ...phases });
    if (command === "start") {
      const data = readNativeCloud(input.native);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.checkDirectory();
      const old = await this.active();
      if (old && this.now() < old.drainUntil && !await this.read(this.file(old, "disabled")))
        throw new Error("An existing bounded cloud session must end before another can start");
      const session: Session = { id: randomUUID(), controller: CLOUD_TEXT_TARGET.controllerThreadId, owner: randomUUID(),
        startedAt: this.now(), expiresAt: this.now() + DURATION_MS, drainUntil: this.now() + DURATION_MS + DRAIN_MS };
      await this.write(this.file(session, "session"), session, true);
      const history = mergeNativeHistory(null, data, this.now());
      await this.write(this.file(session, "history-initial"), history, true);
      await this.write(this.file(session, "history"), history);
      await this.write(this.file(session, "heartbeat"), { owner: session.owner, at: this.now() });
      await this.write("active.json", session);
      return { sessionId: session.id, owner: session.owner, expiresAt: session.expiresAt, drainUntil: session.drainUntil,
        maxMessages: MAX_MESSAGES, target: CLOUD_TEXT_TARGET, initialMessages: history.messages.length };
    }
    const session = await this.active();
    if (command === "status") {
      if (!session) return { configured: false };
      return this.statusView(session, await this.entries(session));
    }
    if (!session || input.sessionId !== session.id || input.owner !== session.owner) throw new Error("Controller does not own the active cloud text session");
    if (command === "stop") {
      try { await this.write(this.file(session, "disabled"), { at: this.now() }, true); } catch (error) { if (!exists(error)) throw error; }
      return { stopped: true, recordsPreserved: true };
    }
    if (await this.read(this.file(session, "disabled")) || this.now() >= session.drainUntil) throw new Error("Cloud text session ended");
    const heartbeatStarted = this.monotonicNow();
    await this.write(this.file(session, "heartbeat"), { owner: session.owner, at: this.now() });
    const heartbeatWriteMs = Math.max(0, this.monotonicNow() - heartbeatStarted);
    const stateStarted = this.monotonicNow();
    const entries = await this.entries(session);
    if (command === "poll") {
      const status = await this.statusView(session, entries);
      const receipt = await this.terminalReceipt(session, entries, input.requestId);
      return { next: this.nextWork(session, entries), status, terminalReceipt: receipt,
        controlTiming: controlTiming({ heartbeatWriteMs, stateReadMs: Math.max(0, this.monotonicNow() - stateStarted) }) };
    }
    if (command === "sync") {
      const persistStarted = this.monotonicNow();
      const data = readNativeCloud(input.native);
      const previous = await this.history(session);
      const history = mergeNativeHistory(previous, data, this.now());
      await this.write(this.file(session, "history"), history);
      for (const entry of entries) {
        if (!entry.claim || entry.progress?.stage === "completed" || entry.progress?.stage === "failed") continue;
        const turn = matchingNativeTurn(data, entry.request, entry.claim.baselineTurnIds);
        if (!turn || toMillis(turn.startedAt ?? 0) + 1000 < entry.claim.claimedAt) continue;
        let progress: Progress | null = null;
        if (turn.status === "inProgress") progress = { requestId: entry.request.requestId, stage: "running", observedAt: this.now(), nativeTurnId: turn.id };
        else if (turn.status === "completed") {
          const final = [...turn.items].reverse().find((item) => item.type === "agentMessage" && item.phase === "final_answer" && item.text && item.id);
          if (final?.id && final.text) progress = { requestId: entry.request.requestId, stage: "completed", observedAt: this.now(),
            nativeTurnId: turn.id, nativeItemId: final.id, reply: history.messages.find((m) => m.id === final.id)?.text ?? final.text.slice(0, 6_000) };
        } else if (turn.status === "failed" || turn.status === "interrupted") progress = { requestId: entry.request.requestId,
          stage: "failed", observedAt: this.now(), nativeTurnId: turn.id };
        if (progress) {
          if (turn.startedAt != null) progress.nativeStartedAt = toMillis(turn.startedAt);
          if (turn.completedAt != null) progress.nativeCompletedAt = toMillis(turn.completedAt);
          await this.write(this.file(session, `progress-${entry.slot}`), progress);
        }
      }
      const historyAndProgressPersistMs = Math.max(0, this.monotonicNow() - persistStarted);
      const currentEntries = await this.entries(session);
      const status = await this.statusView(session, currentEntries);
      const receipt = await this.terminalReceipt(session, currentEntries, input.requestId);
      return { synced: true, changed: history.revision !== previous?.revision, messages: history.messages.length,
        observedAt: history.observedAt, revision: history.revision, next: this.nextWork(session, currentEntries),
        status, terminalReceipt: receipt, controlTiming: controlTiming({ heartbeatWriteMs, historyAndProgressPersistMs }) };
    }
    if (command === "next") return this.nextWork(session, entries);
    const entry = entries.find((e) => e.request.requestId === input.requestId);
    if (!entry) throw new Error("Watch request is not in this session");
    if (command === "reserve") {
      if (this.now() >= session.expiresAt) throw new Error("Cloud text admission window ended; no dispatch permitted");
      if (entry.claim) throw new Error("Watch request is already claimed; never dispatch it again");
      if (entries.some((e) => e.slot < entry.slot && !terminal(e.progress?.stage ?? ""))) return { reserved: false, reason: "earlier_request" };
      const data = readNativeCloud(input.native);
      if (data.turns.some((turn) => turn.status === "inProgress")) return { reserved: false, reason: "native_task_busy" };
      await this.write(this.file(session, `claim-${entry.slot}`), { requestId: entry.request.requestId,
        claimedAt: this.now(), baselineTurnIds: data.turns.map((turn) => turn.id) }, true);
      return { reserved: true, requestId: entry.request.requestId, arguments: { threadId: CLOUD_TEXT_TARGET.threadId,
        hostId: CLOUD_TEXT_TARGET.hostId, prompt: nativePrompt(entry.request.requestId, entry.request.text) } };
    }
    if (!entry.claim) throw new Error("Watch request has not been reserved");
    if (entry.progress && terminal(entry.progress.stage)) return { recorded: true, stage: entry.progress.stage };
    if (command === "accepted") {
      z.object({ threadId: z.literal(CLOUD_TEXT_TARGET.threadId) }).parse(unwrapNativeCloud(input.native));
      await this.write(this.file(session, `accepted-${entry.slot}`), { requestId: entry.request.requestId, at: this.now(), native: input.native }, true);
      await this.write(this.file(session, `progress-${entry.slot}`), { requestId: entry.request.requestId, stage: "accepted", observedAt: this.now() });
      return { recorded: true, stage: "accepted" };
    }
    if (command === "uncertain") {
      await this.write(this.file(session, `progress-${entry.slot}`), { requestId: entry.request.requestId, stage: "uncertain", observedAt: this.now() });
      return { recorded: true, stage: "uncertain", noAutomaticResend: true };
    }
    throw new Error("Unknown cloud text control operation");
  }
}

function statusMessage(stage: string): string {
  switch (stage) {
    case "queued": return "Queued for this existing cloud task. Waiting for its current turn to finish.";
    case "dispatching": return "Sending your message to this cloud task. Current model settings are kept.";
    case "accepted": return "The cloud task accepted your message. Waiting for its response.";
    case "running": return "The cloud task is working on your message.";
    case "completed": return "The cloud reply is ready.";
    case "failed": return "The cloud turn stopped or failed. Check this same task in Codex before retrying.";
    case "paused": return "Cloud forwarding is paused. Your message remains queued and has not been sent.";
    case "reconnecting": return "Cloud sync is reconnecting. Your message will not be sent again.";
    case "expired": return "The cloud session ended before this message was sent. Your original message is preserved.";
    default: return "Delivery could not be confirmed. Check this same cloud task before sending again; no automatic resend will occur.";
  }
}
