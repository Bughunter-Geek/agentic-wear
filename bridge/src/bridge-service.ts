import { cloudHistoryPayloads } from "./cloud-history-push.js";
import { TurnTiming } from "./turn-timing.js";
import { LiveVoice } from "./live-voice.js";
import { CloudTextProof } from "./cloud-text-proof.js";
import { CloudTextSession } from "./cloud-text-session.js";
import { DesktopCloudReceiver } from "./desktop-cloud-receiver.js";
import type { BridgeConfig } from "./config.js";
import { TurnReceipts } from "./turn-receipts.js";
import { configPath, writeConfig } from "./config.js";
import { CryptoBox, type SealedLocalPayload } from "./crypto-box.js";
import {
  AppServerClient,
  ForeignThreadSelectionError,
  ForeignThreadSteerError,
  FastModeUnavailableError,
  type ModelView,
  type ApprovalEvent,
  type QuestionEvent,
  buildQuestionReplyText,
  type SessionView,
  type TerminalEvent,
  type ExternalTurnBaseline,
  type RealtimeVoiceCapability,
  type TurnSubmissionResult,
} from "./app-server-client.js";
import { RelayClient } from "./relay-client.js";
import { shouldWakeWatch } from "./wake-policy.js";
import { ReplayGuard } from "./replay-guard.js";
import { processAuthenticatedEnvelope } from "./inbound-envelope.js";
import { followUpActionSchema, reasoningEffort, type FollowUpAction, type WatchPayload, type WireEnvelope } from "./schemas.js";
import type { Transcriber } from "./transcriber.js";
import { cleanPhononFillers, type CleanupDiagnostics } from "./filler-cleanup.js";
import type { ExplicitCorrectionDiagnostics } from "./explicit-correction.js";
import { LocalDraftEditor, type DraftEdit } from "./draft-editor.js";
import { MAX_AUDIO_BYTES } from "./limits.js";
import { sanitizePublicText } from "./public-text.js";
import { z } from "zod";

type SendablePayload = Record<string, unknown> & { version: 1; kind: string };
const pendingTurnSchema = z.object({
  requestId: z.string().min(1).max(128),
  threadId: z.string().min(1).max(128),
  text: z.string().trim().min(1).max(12_000),
  model: z.string().min(1).max(128).nullable(),
  effort: z.string().min(1).max(32),
  followUpAction: followUpActionSchema.default("default"),
  fastMode: z.boolean().optional(),
  createdAt: z.number().int().positive(),
  blockedReason: z.string().min(1).max(1200).optional(),
  externalAttempt: z.object({
    attemptedAt: z.number().int().positive(),
    userMessageIds: z.array(z.string().min(1).max(128)).max(200),
  }).strict().optional(),
}).strict();
type PendingTurn = z.infer<typeof pendingTurnSchema>;
type StoredPendingTurn = { payload: PendingTurn; sealed: SealedLocalPayload };

export class BridgeService {
  private readonly ownedThreads: Set<string>;
  private readonly crypto: CryptoBox;
  private readonly appServer: AppServerClient;
  private readonly liveVoice: LiveVoice;
  private turnTimingInstance: TurnTiming | undefined;
  private get turnTiming(): TurnTiming { return this.turnTimingInstance ??= new TurnTiming(); }
  private liveTimer: NodeJS.Timeout | null = null;
  private readonly turnReceipts: TurnReceipts;
  private readonly controller = new AbortController();
  private persistTask: Promise<void> = Promise.resolve();
  private fatalError: Error | null = null;
  private watchedThreadId: string | null = null;
  private watchExpiresAt = 0;
  private watchAcceptedAt = 0;
  private chatSyncTimer: NodeJS.Timeout | null = null;
  private pendingTurnTimer: NodeJS.Timeout | null = null;
  private pendingTurnTask: Promise<void> | null = null;
  private readonly draftEditor = new LocalDraftEditor();
  private readonly pendingTurns = new Map<string, StoredPendingTurn>();
  private readonly cloudTextProof = new CloudTextProof();
  private readonly cloudTextSession = new CloudTextSession();
  private readonly desktopCloud: DesktopCloudReceiver;
  private readonly cloudHistorySignatures = new Map<string,string>();
  // High-priority (wake) history pushes are throttled per thread. See sendCloudHistory.
  private readonly cloudInlineLastAt = new Map<string,number>();
  private readonly cloudInlineTimers = new Map<string,NodeJS.Timeout>();
  private readonly cloudTerminalAt = new Map<string,number>();

  constructor(
    private readonly config: BridgeConfig,
    private readonly relay: RelayClient,
    private readonly privateKey: string,
    private readonly transcriber: Transcriber,
    private readonly replayGuard = new ReplayGuard(),
  ) {
    this.ownedThreads = new Set(config.watchOwnedThreadIds);
    this.crypto = new CryptoBox(config.pairId, privateKey, config.bridgePublicKey, config.watchPublicKey);
    this.turnReceipts = new TurnReceipts(`${configPath()}.turn-receipts-v1`, this.crypto);
    this.desktopCloud = new DesktopCloudReceiver(config,
      async ({ eventId, kind, turnScope, threadId, title, detail, occurredAt, requestId }) => {
        this.cloudTerminalAt.set(threadId, Date.now());
        await this.send({ version: 1, eventId, kind, turnScope, threadId, title, detail, occurredAt, requestId });
      }, (threadId) => {
        void this.sendChatSnapshot(threadId).catch((error:unknown) => {
          console.error(JSON.stringify({level:"error",message:"Could not push cloud history",error:publicError(error)}));
        });
      });
    this.appServer = new AppServerClient(
      this.ownedThreads,
      (event) => this.onTerminal(event),
      (event) => this.onApproval(event),
      (error) => {
        this.fatalError = error;
        this.controller.abort(error);
      },
      (threadId) => this.onAgentOutput(threadId),
    );
    this.appServer.setQuestionHandler((event) => this.onQuestion(event));
    // Status/attention changes refresh the watch's session list (quiet sessions.snapshot, debounced in the client).
    this.appServer.setSessionsChangedHandler(() => { void this.sendSessions().catch(() => undefined); });
    this.liveVoice = new LiveVoice(this.appServer, (payload) => this.send(payload));
    this.appServer.setRealtimeHandler((method, params) => this.liveVoice.notification(method, params));
    this.appServer.setTurnStageHandler((threadId, stage) => this.turnTiming.markThread(threadId, stage));
  }

  async run(): Promise<void> {
    const status = await this.relay.status();
    if (!status.paired || !status.watchPublicKey) throw new Error("The watch has not completed authenticated pairing");
    this.assertWatchPublicKey(status.watchPublicKey);
    // Preload the resident voice editor before accepting Watch work. Phonon
    // was already prepared by start(); avoid a first-use model load racing ASR.
    if (this.transcriber.defaultBackend === "phonon") {
      await this.draftEditor.prepare().catch(() => undefined);
    }

    const socketTask = this.relay.runSocket(
      this.controller.signal,
      (envelope, localQueueMs) => this.onEnvelope(envelope, localQueueMs),
      (publicKey) => Promise.resolve(this.assertWatchPublicKey(publicKey)),
    );
    try {
      if (this.controller.signal.aborted) throw abortError(this.controller.signal);
      // The Desktop-managed daemon owns the shared session registry. A private
      // stdio App Server sees every Desktop-loaded thread as foreign, which
      // makes an otherwise idle existing chat permanently unsendable from the
      // watch. Connect through the control socket so ownership and idle state
      // are evaluated by the same App Server as Desktop.
      await this.appServer.connect("daemon");
      await this.desktopCloud.start();
      await this.loadPendingTurns();
      await this.processPendingTurns();
      let nextCallbackAt = performance.now() + PENDING_TURN_RETRY_MS;
      this.pendingTurnTimer = setInterval(() => {
        const callbackAt = performance.now();
        const callbackLatenessMs = Math.max(0, callbackAt - nextCallbackAt);
        nextCallbackAt = callbackAt + PENDING_TURN_RETRY_MS;
        if (callbackLatenessMs > 500) console.log(JSON.stringify({ level: "info",
          message: "cloud.history.callback_late", at: Date.now(), callbackLatenessMs }));
        const legacyDelivery = (payload: SendablePayload) => this.desktopCloud?.owns(payload.threadId)
          ? Promise.resolve() : this.send(payload);
        void this.cloudTextSession?.publish(legacyDelivery,
          this.cloudTextSession.owns(this.watchedThreadId) && Date.now() <= this.watchExpiresAt,
          { trigger: "periodic", subscriptionAcceptedAt: this.watchAcceptedAt, subscriptionExpiresAt: this.watchExpiresAt, callbackLatenessMs })
          .catch(() => undefined);
        void this.cloudTextProof?.publish(legacyDelivery,
          this.cloudTextProof.owns(this.watchedThreadId) && Date.now() <= this.watchExpiresAt)
          .catch(() => undefined);
        void this.processPendingTurns().catch((error: unknown) => {
          console.error(JSON.stringify({
            level: "error",
            message: "Could not retry a pending Watch prompt",
            error: publicError(error),
          }));
        });
      }, PENDING_TURN_RETRY_MS);
      this.pendingTurnTimer.unref();
      this.liveTimer = setInterval(() => {
        void this.liveVoice.expire()
          .then(() => this.appServer.releaseEndedRealtimeLeases()).catch(() => undefined);
      }, 5_000);
      this.liveTimer.unref();
      await this.reportRealtimeVoiceCapability();
      await this.sendSessions();
      const monitorTask = this.appServer.monitorTerminals(this.controller.signal).catch((error: unknown) => {
        this.fatalError = error instanceof Error ? error : new Error("Terminal monitor stopped");
        this.controller.abort(this.fatalError);
      });
      await socketTask;
      await monitorTask;
      if (this.fatalError) throw this.fatalError;
    } finally {
      if (this.liveTimer) clearInterval(this.liveTimer);
      await this.liveVoice.close().catch(() => undefined);
      for (const timer of this.cloudInlineTimers.values()) clearTimeout(timer);
      this.cloudInlineTimers.clear();
      await this.desktopCloud.close();
      await this.appServer.close();
      if (this.chatSyncTimer) clearTimeout(this.chatSyncTimer);
      this.chatSyncTimer = null;
      if (this.pendingTurnTimer) clearInterval(this.pendingTurnTimer);
      this.pendingTurnTimer = null;
      this.controller.abort();
      await socketTask.catch(() => undefined);
      await this.transcriber.close?.();
    }
  }

  stop(): void {
    this.controller.abort(new Error("Bridge stopped"));
  }

  private assertWatchPublicKey(publicKey: string): void {
    if (!this.config.watchPublicKey || this.config.watchPublicKey !== publicKey) {
      throw new Error("Relay presented a watch key that does not match the authenticated pairing");
    }
  }

  private async onEnvelope(envelope: WireEnvelope, localQueueMs = 0): Promise<void> {
    const receivedAt = performance.now();
    await processAuthenticatedEnvelope(
      envelope,
      this.crypto,
      this.replayGuard,
      (payload) => {
        if ((payload.kind === "turn.submit" || payload.kind === "question.answer") && !(payload.threadId !== null &&
            (this.desktopCloud?.owns(payload.threadId) || this.cloudTextProof?.owns(payload.threadId) || this.cloudTextSession?.owns(payload.threadId)))) {
          this.turnTiming.begin(payload.requestId, payload.threadId, envelope.sentAt);
        }
        if (payload.kind === "transcription.create") console.log(JSON.stringify({ level: "info", message: "transcription.ingress.timing", localQueueMs: Math.round(localQueueMs * 1000) / 1000, decryptAndReplayMs: Math.round((performance.now() - receivedAt) * 1000) / 1000 }));
        if (payload.kind === "notify.trace") console.log(JSON.stringify({ level: "info", message: "watch.notify.trace.ingress",
          receivedAt: Date.now(), watchSentAt: envelope.sentAt, envelopeId: envelope.messageId,
          eventIds: payload.alerts.map((alert) => alert.eventId) }));
        if (payload.kind === "chat.watch" && this.cloudTextSession?.owns(payload.threadId)) console.log(JSON.stringify({ level: "info",
          message: "cloud.history.ingress", at: Date.now(), threadId: payload.threadId, requestId: payload.requestId,
          localQueueMs, decryptAndReplayMs: Math.max(0, performance.now() - receivedAt) }));
        // History/catalog reads may take the full App Server request deadline.
        // Keep rendering work out of the relay's ordered command stream.
        if (payload.kind === "session.sync" || payload.kind === "chat.watch") {
          this.runBackgroundRefresh(() => this.handleWatchPayload(payload));
          return Promise.resolve();
        }
        return this.handleAuthenticatedCommand(payload);
      },
      (payload) => payload.kind === "turn.submit" || payload.kind === "question.answer" ? this.replayTurnReceipt(payload)
        : payload.kind === "live.newTask" ? this.replayNewVoiceTask(payload) : Promise.resolve(),
    );
  }

  private async handleAuthenticatedCommand(payload: WatchPayload): Promise<void> {
    if (payload.kind === "live.newTask") {
      const receipt = await this.turnReceipts.begin(payload.requestId, payload);
      if (receipt) return this.replayNewVoiceTask(payload);
      return this.handleWatchPayload(payload);
    }
    if (payload.kind !== "turn.submit" && payload.kind !== "question.answer") return this.handleWatchPayload(payload);
    const receipt = await this.turnReceipts.begin(payload.requestId, payload);
    if (receipt) return this.replayTurnReceipt(payload);
    await this.handleWatchPayload(payload);
  }

  private async replayNewVoiceTask(payload: Extract<WatchPayload, { kind: "live.newTask" }>): Promise<void> {
    const receipt = await this.turnReceipts.get(payload.requestId, payload);
    await this.send(receipt?.response ? receipt.response as SendablePayload : {
      version: 1, kind: "live.error", requestId: payload.requestId, deliveryUncertain: true,
      message: "Task creation is not confirmed. Check Sessions before creating another task; Retry checks this same request.",
    });
  }

  private async replayTurnReceipt(payload: Extract<WatchPayload, { kind: "turn.submit" | "question.answer" }>): Promise<void> {
    // A replay claim may predate receipt support or survive a crash before
    // receipt creation. Absence is never permission to dispatch it again.
    const receipt = await this.turnReceipts.get(payload.requestId, payload);
    if(!receipt?.response && payload.kind==="turn.submit" && payload.threadId && this.desktopCloud?.owns(payload.threadId)) {
      try {
        const browserResult=await this.desktopCloud.submitText(payload.threadId,payload.requestId,payload.text,true);
        await this.send({version:1,kind:"turn.accepted",requestId:payload.requestId,threadId:payload.threadId,
          state:"running",selectionApplied:false,message:"Delivery confirmed from the existing browser receipt. No second copy was sent."});
        if(browserResult.nativeTurnId)await this.send({version:1,kind:"turn.started",requestId:payload.requestId,threadId:payload.threadId,
          nativeTurnId:browserResult.nativeTurnId,deliveryState:"running",selectionApplied:false});
        await this.sendChatSnapshot(payload.threadId); return;
      } catch { /* Unconfirmed stays uncertain; a status check must never dispatch text. */ }
    }
    await this.send(receipt?.response ? receipt.response as SendablePayload : {
      version: 1,
      kind: "turn.error",
      requestId: payload.requestId,
      threadId: payload.threadId,
      deliveryUncertain: true,
      message: "The bridge restarted before recording Codex's confirmation. This prompt may already have been sent. Check this chat in Codex before sending it again; Agentic Wear will not send a second copy.",
      occurredAt: Date.now(),
    });
  }

  private liveCallThreadsInstance: Map<string, string> | undefined;
  private get liveCallThreads(): Map<string, string> { return this.liveCallThreadsInstance ??= new Map(); }

  // Single-entry cache of the Codex voice catalog, used only to validate live.start.
  // (live.capability stays uncached: it returns per-thread task metadata.)
  private liveCapabilityCache: { at: number; value: RealtimeVoiceCapability } | undefined;

  /** Fresh cached catalog if it still supports the voice; otherwise one fresh fetch. */
  private async liveStartCapability(voice: string): Promise<{ capability: RealtimeVoiceCapability; cached: boolean }> {
    const now = Date.now();
    const hit = this.liveCapabilityCache;
    if (hit && now - hit.at < LIVE_CAPABILITY_CACHE_MS && supportsLiveVoice(hit.value, voice))
      return { capability: hit.value, cached: true };
    const value = await this.appServer.realtimeVoiceCapability();
    // An unavailable API is usually transient; never remember it.
    this.liveCapabilityCache = value.realtimeApiAvailable ? { at: now, value } : undefined;
    return { capability: value, cached: false };
  }

  private rememberLiveCall(callId: string, threadId: string): void {
    this.liveCallThreads.set(callId, threadId);
    while (this.liveCallThreads.size > 8) this.liveCallThreads.delete(this.liveCallThreads.keys().next().value!);
    this.keepChatWatched(threadId);
  }

  private keepChatWatched(threadId: string): void {
    this.watchedThreadId = threadId;
    this.watchAcceptedAt = Date.now();
    this.watchExpiresAt = this.watchAcceptedAt + CHAT_WATCH_TTL_MS;
  }

  private runBackgroundRefresh(refresh: () => Promise<void>): void {
    void refresh().catch((error: unknown) => {
      console.error(JSON.stringify({
        level: "warn",
        message: "Could not refresh Watch view",
        error: publicError(error),
      }));
    });
  }

  private async handleWatchPayload(payload: WatchPayload): Promise<void> {
    let resolvedSubmit: Extract<WatchPayload, { kind: "turn.submit" }> | null = payload.kind === "turn.submit" ? payload : null;
    try {
      if ("threadId" in payload && this.desktopCloud?.owns(payload.threadId) &&
          ["live.start", "live.capability", "feedback.submit"].includes(payload.kind)) {
        throw new Error("This browser cloud connection supports text replies and history. Live voice and feedback are not connected.");
      }
      if ("threadId" in payload && (this.cloudTextProof?.owns(payload.threadId) || this.cloudTextSession?.owns(payload.threadId)) &&
          (payload.kind === "live.start" || payload.kind === "live.capability" || payload.kind === "feedback.submit")) {
        throw new Error("This cloud connection supports text and chat history. Native cloud voice and feedback are not connected.");
      }
      switch (payload.kind) {
        case "live.newTask": {
          const task = await this.appServer.createVoiceTask(this.config.defaultCwd);
          await this.send({ version: 1, kind: "live.taskCreated", requestId: payload.requestId, task });
          await this.sendSessions();
          return;
        }
        case "live.capability": {
          const capability = await this.appServer.realtimeVoiceCapability(payload.threadId);
          await this.send({ version: 1, kind: "live.capability", requestId: payload.requestId, ...capability,
            fastMode: await this.fastModeAdvertisement() });
          return;
        }
        case "live.start": {
          const capabilityStartedAt = Date.now();
          const { capability, cached } = await this.liveStartCapability(payload.voice);
          console.log(JSON.stringify({ level: "info", message: "live.voice.capability", callId: payload.callId,
            cached, durationMs: Date.now() - capabilityStartedAt }));
          if (!supportsLiveVoice(capability, payload.voice))
            throw new Error("Codex voice or the selected voice is unavailable on this host.");
          await this.liveVoice.start(payload.callId, payload.threadId, payload.sdp, payload.voice, payload.fastMode);
          this.rememberLiveCall(payload.callId, payload.threadId);
          return;
        }
        case "live.heartbeat": {
          this.liveVoice.heartbeat(payload.callId);
          // A call outlasts the chat subscription; keep its turn updates reaching the Watch.
          const threadId = this.liveCallThreads.get(payload.callId);
          if (threadId) this.keepChatWatched(threadId);
          return;
        }
        case "live.stop": {
          await this.liveVoice.stop(payload.callId);
          const threadId = this.liveCallThreads.get(payload.callId);
          this.liveCallThreads.delete(payload.callId);
          // Spoken transcript segments and the thread's final idle state arrive only on a fresh
          // load. Give Codex a moment to persist the last segment, then refresh once.
          if (threadId) this.runBackgroundRefresh(async () => {
            await new Promise((resolve) => setTimeout(resolve, POST_CALL_REFRESH_DELAY_MS));
            await this.sendChatSnapshot(threadId, undefined, true);
          });
          return;
        }
        case "live.trace":
          console.log(JSON.stringify({ level: "info", message: "live.voice.watchTrace", callId: payload.callId,
            events: payload.events.map(({ stage, elapsedMs, state, count }) => ({ stage, elapsedMs, state, count })) }));
          return;
        case "notify.trace":
          // Watch-side push -> fetch -> notify timings (watch wall clock) and per-alert decisions.
          // The Watch sends no message text; only ids, decision names and epoch milliseconds.
          console.log(JSON.stringify({ level: "info", message: "watch.notify.trace", receivedAt: Date.now(),
            pushReceivedAt: payload.pushReceivedAt, fetchStartedAt: payload.fetchStartedAt,
            fetchCompletedAt: payload.fetchCompletedAt, fetchAttempt: payload.fetchAttempt,
            deliveredVia: payload.deliveredVia, alerts: payload.alerts }));
          return;
        case "relay.failures":
          // Watch-side relay request failures (operation, HTTP status, exception class, epoch ms). No text.
          console.log(JSON.stringify({ level: "info", message: "watch.relay.failures", receivedAt: Date.now(),
            failures: payload.failures }));
          return;
        case "push.diagnostics":
          // Watch-side per-push metadata (priorities, envelope presence/size, outcome, epoch ms). No text.
          console.log(JSON.stringify({ level: "info", message: "watch.push.diagnostics", receivedAt: Date.now(),
            pushes: payload.pushes }));
          return;
        case "session.sync":
          // Foreground watch refresh is an earlier, explicit user-use signal than
          // recording. Warm only the configured Phonon route; never block the
          // session reply or change the selected transcriber/rewrite settings.
          if (this.transcriber?.defaultBackend === "phonon") {
            void this.draftEditor.prepare().catch(() => undefined);
          }
          await this.sendSessions(payload.requestId);
          return;
        case "draft.prepare":
          void this.draftEditor.prepare().catch(() => undefined);
          return;
        case "transcription.create":
          await this.createTranscription(payload);
          return;
        case "turn.submit": {
          await this.submitTurn(payload);
          return;
        }
        case "question.answer": {
          const question = await this.appServer.findQuestionTitle(payload.threadId, payload.questionItemId, payload.questionIndex)
            ?? (payload.question || null);
          if (!question) throw new Error("That question is no longer available in Codex. Open the chat to answer it.");
          const persisted = this.appServer.persistedThreadSettings(payload.threadId)?.effort;
          const persistedEffort = typeof persisted === "string" && reasoningEffort.safeParse(persisted).success
            ? persisted : "medium";
          resolvedSubmit = {
            version: 1, kind: "turn.submit", requestId: payload.requestId, threadId: payload.threadId,
            text: buildQuestionReplyText({ questionItemId: payload.questionItemId, questionIndex: payload.questionIndex,
              question, answer: payload.answer }),
            // Keep the chat's own settings: no model override, its persisted effort when it is a valid value.
            model: null, effort: persistedEffort, followUpAction: "default",
          };
          await this.submitTurn(resolvedSubmit);
          return;
        }
        case "chat.watch":
          this.watchedThreadId = payload.threadId;
          this.watchAcceptedAt = Date.now();
          this.watchExpiresAt = this.watchAcceptedAt + CHAT_WATCH_TTL_MS;
          if (this.cloudTextSession?.owns(payload.threadId)) console.log(JSON.stringify({ level: "info",
            message: "cloud.history.subscription", action: "watch", at: this.watchAcceptedAt, expiresAt: this.watchExpiresAt }));
          await this.sendChatSnapshot(payload.threadId, payload.requestId);
          await this.sendSessions();
          return;
        case "chat.unwatch":
          if (this.watchedThreadId === payload.threadId) {
            if (this.cloudTextSession?.owns(payload.threadId)) console.log(JSON.stringify({ level: "info",
              message: "cloud.history.subscription", action: "unwatch", at: Date.now(), previousExpiresAt: this.watchExpiresAt }));
            this.watchedThreadId = null;
            this.watchExpiresAt = 0;
            this.watchAcceptedAt = 0;
          }
          return;
        case "approval.respond":
          this.appServer.respondToApproval(payload.approvalId, payload.decision);
          await this.send({
            version: 1,
            kind: "approval.accepted",
            requestId: payload.requestId,
            approvalId: payload.approvalId,
          });
          return;
        case "feedback.submit":
          await this.appServer.submitFeedback(
            payload.threadId,
            payload.turnId,
            payload.itemId,
            payload.rating,
          );
          await this.send({
            version: 1,
            kind: "feedback.accepted",
            requestId: payload.requestId,
            threadId: payload.threadId,
            itemId: payload.itemId,
            rating: payload.rating,
          });
          return;
      }
    } catch (error) {
      if (payload.kind === "live.newTask" || payload.kind === "live.start" || payload.kind === "live.stop" || payload.kind === "live.heartbeat" || payload.kind === "live.capability") {
        await this.send({ version: 1, kind: "live.error", requestId: payload.requestId,
          ...("callId" in payload ? { callId: payload.callId } : {}),
          ...(payload.kind === "live.newTask" ? { deliveryUncertain: true } : {}), message: publicRequestError(error, payload.kind) });
        return;
      }
      if (
        resolvedSubmit !== null &&
        resolvedSubmit.threadId !== null &&
        !this.cloudTextProof?.owns(resolvedSubmit.threadId) &&
        !this.cloudTextSession?.owns(resolvedSubmit.threadId) &&
        !this.desktopCloud?.owns(resolvedSubmit.threadId) &&
        isRetryablePendingTurnError(error)
      ) {
        // A Watch prompt already carries a stable idempotency key. If Codex's
        // shared rollout is briefly unreadable, persist that exact request
        // before acknowledging it and let the normal pending-turn worker keep
        // retrying. This avoids returning a destructive sync error for a
        // transient cross-client handoff while still guaranteeing one send.
        await this.storePendingTurn({
          requestId: resolvedSubmit.requestId,
          threadId: resolvedSubmit.threadId,
          text: resolvedSubmit.text,
          model: resolvedSubmit.model ?? null,
          effort: resolvedSubmit.effort,
          followUpAction: resolvedSubmit.followUpAction,
          createdAt: Date.now(),
        });
        await this.send({
          version: 1,
          kind: "turn.accepted",
          requestId: payload.requestId,
          threadId: resolvedSubmit.threadId,
          state: "waiting",
          selectionApplied: false,
          message: "Prompt saved securely. Codex is synchronizing this chat, and Agentic Wear will send it once without another tap.",
        });
        await this.sendSessions().catch(() => undefined);
        return;
      }
      const kind = payload.kind === "transcription.create"
        ? "transcription.error"
        : payload.kind === "chat.watch" || payload.kind === "chat.unwatch"
          ? "chat.error"
        : payload.kind === "approval.respond"
          ? "approval.error"
          : payload.kind === "feedback.submit"
            ? "feedback.error"
          : "turn.error";
      await this.send({
        version: 1,
        kind,
        requestId: payload.requestId,
        threadId: "threadId" in payload ? payload.threadId : undefined,
        message: publicRequestError(error, payload.kind === "question.answer" ? "turn.submit" : payload.kind),
        ...(resolvedSubmit !== null && /timed out|socket closed|not connected|app server closed/iu.test(publicError(error))
          ? { deliveryUncertain: true }
          : {}),
        occurredAt: Date.now(),
      });
      if (resolvedSubmit !== null || payload.kind === "question.answer" || payload.kind === "chat.watch") {
        await this.sendSessions().catch(() => undefined);
      }
    }
  }

  /** Shared by turn.submit and question.answer: one dispatch path, one receipt/idempotency key. */
  private async submitTurn(payload: Extract<WatchPayload, { kind: "turn.submit" }>): Promise<void> {
          if(payload.threadId && this.desktopCloud?.owns(payload.threadId)) {
            const browserResult=await this.desktopCloud.submitText(payload.threadId,payload.requestId,payload.text);
            this.watchedThreadId=payload.threadId;
            this.watchAcceptedAt=Date.now(); this.watchExpiresAt=this.watchAcceptedAt+CHAT_WATCH_TTL_MS;
            await this.send({version:1,kind:"turn.accepted",requestId:payload.requestId,threadId:payload.threadId,
              state:"running",selectionApplied:false,message:"Message appeared in the connected browser chat. Its current model settings are kept."});
            if(browserResult.nativeTurnId)await this.send({version:1,kind:"turn.started",requestId:payload.requestId,threadId:payload.threadId,
              nativeTurnId:browserResult.nativeTurnId,deliveryState:"running",selectionApplied:false});
            await this.sendChatSnapshot(payload.threadId);
            return;
          }
    const cloudRoute = await this.cloudTextRoute(payload.threadId);
    if (cloudRoute) {
      await cloudRoute.enqueue(payload.requestId, payload.text);
      this.watchedThreadId = payload.threadId;
      this.watchAcceptedAt = Date.now();
      this.watchExpiresAt = this.watchAcceptedAt + CHAT_WATCH_TTL_MS;
      await this.send({ version: 1, kind: "turn.accepted", requestId: payload.requestId,
        threadId: payload.threadId, state: "waiting", selectionApplied: false,
        message: "Watch message queued for this existing cloud task. Its current model settings are kept." });
      await this.sendChatSnapshot(payload.threadId!);
      return;
    }
    const submittedAt = Date.now();
    const pendingPayload = (
      threadId: string,
      followUpAction: FollowUpAction = payload.followUpAction,
    ): PendingTurn => ({
      requestId: payload.requestId,
      threadId,
      text: payload.text,
      model: payload.model ?? null,
      effort: payload.effort,
      ...(payload.fastMode !== undefined ? { fastMode: payload.fastMode } : {}),
      followUpAction,
      createdAt: submittedAt,
    });
    const result = await this.appServer.submitTurn(
      payload.threadId,
      payload.text,
      this.config.defaultCwd,
      payload.model ?? null,
      payload.effort,
      payload.requestId,
      (baseline, followUpMode) => {
        if (payload.threadId === null) throw new Error("A new chat cannot require an external handoff");
        return this.markPendingExternalAttempt(
          pendingPayload(payload.threadId, followUpMode),
          baseline,
        );
      },
      payload.followUpAction,
      ...(payload.fastMode !== undefined ? [payload.fastMode] as const : []),
    );
    this.turnTiming.bindThread(payload.requestId, result.threadId);
    this.turnTiming.markRequest(payload.requestId, "appServerAccepted");
    // Routing metadata only: ids and states, never prompt or reply text.
    console.log(JSON.stringify({ level: "info", message: "watch.turn.route", requestId: payload.requestId,
      threadId: result.threadId, state: result.state, created: result.created, steered: result.steered ?? false,
      followUpMode: result.followUpMode ?? null }));
    // The Watch is using this chat, so poll it every second until its turn finishes.
    this.appServer.markHot(result.threadId);
    if (result.created) await this.persistOwnedThreads();
    if (result.state === "waiting") {
      await this.storePendingTurn(pendingPayload(
        result.threadId,
        result.followUpMode ?? payload.followUpAction,
      ));
    } else await this.removePendingTurn(payload.requestId);
    this.watchedThreadId = result.threadId;
    this.watchAcceptedAt = Date.now();
    this.watchExpiresAt = this.watchAcceptedAt + CHAT_WATCH_TTL_MS;
    await this.send({
      version: 1,
      kind: "turn.accepted",
      requestId: payload.requestId,
      threadId: result.threadId,
      state: result.state,
      selectionApplied: result.selectionApplied,
      message: [turnAcceptedMessage(result), tierNotice(payload.fastMode)].filter(Boolean).join(" ") || undefined,
    });
    this.turnTiming.markRequest(payload.requestId, "watchAckSent");
    this.runBackgroundRefresh(async () => {
      await this.sendChatSnapshot(result.threadId);
      await this.sendSessions();
    });
    return;
  }

  private async createTranscription(payload: Extract<WatchPayload, { kind: "transcription.create" }>): Promise<void> {
    const startedAt = performance.now();
    const audio = Buffer.from(payload.audioBase64, "base64");
    const decodedAt = performance.now();
    try {
      if (audio.byteLength < 1_024 || audio.byteLength > MAX_AUDIO_BYTES) {
        throw new Error("Voice recordings must be between 1 KiB and the four-minute limit");
      }
      const rawText = await this.transcriber.transcribe(audio, payload.mimeType, payload.backend);
      const transcribedAt = performance.now();
      const isPhonon = (payload.backend ?? this.transcriber.defaultBackend) === "phonon";
      let cleanupDiagnostics: CleanupDiagnostics | undefined;
      let explicitRepairDiagnostics: ExplicitCorrectionDiagnostics | undefined;
      const cleanInitialPhonon = isPhonon && !payload.previousText && process.env.AGENTIC_WEAR_PHONON_CLEAN_FILLERS !== "0";
      const text = cleanInitialPhonon
        ? cleanPhononFillers(rawText, value => { cleanupDiagnostics = value; }) : rawText;
      const cleanedAt = performance.now();
      // New watch explicitly requests local editing. Legacy build 51 keeps its existing path.
      const edit: DraftEdit = payload.localEdit && payload.previousText
        ? await this.draftEditor.rewrite(rawText, payload.previousText)
        : payload.finalIntent && !payload.previousText
          ? await this.draftEditor.rewrite(text, undefined, { clauseRestarts: cleanInitialPhonon, explicitCorrections: cleanInitialPhonon,
              onExplicitRepairs: value => { explicitRepairDiagnostics = value; } })
          : { text: payload.previousText ? await this.appServer.reviseDraft(payload.previousText, text, this.config.defaultCwd) : text };
      // A model can reintroduce fillers or stutters. Keep deterministic cleanup
      // on the final draft too, including every bounded rewrite fallback.
      const revisedText = cleanInitialPhonon ? cleanPhononFillers(edit.text) : edit.text;
      const beforeDelivery = performance.now();
      await this.send({
        version: 1,
        kind: "transcription.ready",
        requestId: payload.requestId,
        threadId: payload.threadId,
        text: revisedText,
        ...((text !== rawText || payload.finalIntent) && !payload.previousText ? { rawText } : {}),
        ...(edit.notice ? { editNotice: edit.notice } : {}),
        ...(edit.editChoices ? { editChoices: edit.editChoices } : {}),
        revised: payload.previousText != null,
      });
      const deliveredAt = performance.now();
      const ms = (value: number) => Math.round(value * 1000) / 1000;
      console.log(JSON.stringify({ level: "info", message: "transcription.bridge.timing",
        backend: isPhonon ? "phonon" : "other", audioBytes: audio.byteLength, cleanupApplied: cleanupDiagnostics !== undefined,
        ...(cleanupDiagnostics ? { cleanupDiagnostics } : {}),
        ...(explicitRepairDiagnostics ? { explicitRepairDiagnostics } : {}),
        rewriteOutcome: edit.outcome ?? "not_requested", postCleanupApplied: cleanInitialPhonon,
        postCleanupChanged: revisedText !== edit.text,
        base64DecodeMs: ms(decodedAt - startedAt), transcriberMs: ms(transcribedAt - decodedAt),
        cleanupMs: ms(cleanedAt - transcribedAt), revisionMs: ms(beforeDelivery - cleanedAt),
        encryptAndResultRelayMs: ms(deliveredAt - beforeDelivery), bridgeTotalMs: ms(deliveredAt - startedAt),
      }));
    } finally {
      audio.fill(0);
    }
  }

  private async onTerminal(event: TerminalEvent): Promise<void> {
    await this.send({ version: 1, ...event });
    console.log(JSON.stringify({ level: "info", message: "watch.terminal.sent", eventId: event.eventId,
      threadId: event.threadId, sentAt: Date.now() }));
    this.turnTiming.markThread(event.threadId, "terminalSentToWatch");
    if (this.watchedThreadId === event.threadId && Date.now() <= this.watchExpiresAt) {
      await this.sendChatSnapshot(event.threadId, undefined, true).catch((error: unknown) => {
        console.error(JSON.stringify({
          level: "error",
          message: "Could not refresh the completed live chat",
          error: publicError(error),
        }));
      });
    }
    this.turnTiming.finishThread(event.threadId);
    void this.processPendingTurns().catch(() => undefined);
    await this.sendSessions().catch((error: unknown) => {
      console.error(JSON.stringify({ level: "error", message: "Could not refresh sessions", error: publicError(error) }));
    });
  }

  private async onQuestion(event: QuestionEvent): Promise<void> {
    await this.send({ version: 1, ...event });
    // Metadata only: never the question title, detail or options.
    console.log(JSON.stringify({ level: "info", message: "watch.question.sent", eventId: event.eventId,
      threadId: event.threadId, sentAt: Date.now() }));
    if (this.watchedThreadId === event.threadId && Date.now() <= this.watchExpiresAt) {
      await this.sendChatSnapshot(event.threadId, undefined, true).catch(() => undefined);
    }
  }

  private async onApproval(event: ApprovalEvent): Promise<void> {
    await this.send({ version: 1, ...event });
  }

  private async reportRealtimeVoiceCapability(): Promise<void> {
    const capability = await this.appServer.realtimeVoiceCapability();
    console.info(JSON.stringify({
      level: capability.realtimeApiAvailable ? "info" : "warn",
      message: capability.realtimeApiAvailable
        ? "Codex WebRTC signaling is exposed; voice entitlement is verified only by a negotiated call."
        : "Codex realtime API is unavailable.",
      realtimeVoiceAvailable: capability.available,
      realtimeApiAvailable: capability.realtimeApiAvailable,
      realtimeVoiceBlocker: capability.blocker,
    }));
  }

  private async sendSessions(requestId?: string): Promise<void> {
    const sessions: SessionView[] = await this.appServer.listSessions();
    const cloudSession = await this.cloudTextSession?.session() ?? await this.cloudTextProof?.session();
    if (cloudSession && !this.desktopCloud?.owns(cloudSession.id)) {
      const duplicate = sessions.findIndex((session) => session.id === cloudSession.id);
      if (duplicate >= 0) sessions.splice(duplicate, 1);
      sessions.unshift(cloudSession);
    }
    for (const session of this.desktopCloud?.sessions() ?? []) {
      const duplicate = sessions.findIndex((existing) => existing.id === session.id);
      if (duplicate >= 0) sessions.splice(duplicate, 1);
      sessions.unshift(session);
    }
    let models: ModelView[] = [];
    try {
      models = await this.appServer.listModels();
    } catch (error) {
      console.error(JSON.stringify({
        level: "warn",
        message: "Codex model catalog unavailable; using bridge defaults on the watch",
        error: publicError(error),
      }));
    }
    const snapshot: SendablePayload = { version: 1, kind: "sessions.snapshot", sessions };
    if (requestId !== undefined) snapshot.requestId = requestId;
    snapshot.models = models; // Missing/failed catalog must revoke cached Fast availability.
    snapshot.generatedAt = Date.now();
    snapshot.fastMode = await this.fastModeAdvertisement();
    await this.send(snapshot);
  }

  private async fastModeAdvertisement(): Promise<{
    protocolVersion: number; supported: boolean; eligible: boolean; defaultModel: string | null;
  }> {
    const capability = await this.appServer.fastModeCapability(this.config.defaultCwd)
      .catch(() => ({ supported: this.appServer.supportsFastMode, eligible: false, defaultModel: null }));
    return { protocolVersion: 1, ...capability };
  }

  private async sendChatSnapshot(
    threadId: string,
    requestId?: string,
    forceRefresh = false,
  ): Promise<void> {
    if (this.desktopCloud?.owns(threadId)) {
      const snapshot=this.desktopCloud.snapshot(threadId);
      const signature=JSON.stringify(snapshot);
      if(!requestId && this.cloudHistorySignatures.get(threadId)===signature)return;
      this.cloudHistorySignatures.set(threadId,signature);
      try {
        const {full,inline}=cloudHistoryPayloads(snapshot,Date.now(),requestId);
        // The complete supported window always reaches the inbox quietly. The
        // high-priority inline push (latest history inside the encrypted push,
        // independent of an inbox DNS lookup) is limited to moments where the
        // Watch is plausibly looking, and coalesced to one per 3 s per thread.
        // Unthrottled wake pushes with no visible notification risk FCM
        // deprioritising the app and drain the Watch battery.
        const reason=requestId?"request" as const:this.cloudInlineReason(threadId);
        const sameAsFull=JSON.stringify(full)===JSON.stringify(inline);
        if(reason==="request"){
          this.clearCloudInlineTimer(threadId);
          this.cloudInlineLastAt.set(threadId,Date.now());
          await this.send(inline,reason);
          if(!sameAsFull)await this.send(full);
        } else if(reason){
          const wait=(this.cloudInlineLastAt.get(threadId)??0)+CLOUD_INLINE_MIN_INTERVAL_MS-Date.now();
          if(wait<=0){
            this.clearCloudInlineTimer(threadId);
            this.cloudInlineLastAt.set(threadId,Date.now());
            await this.send(inline,reason);
            if(!sameAsFull)await this.send(full);
          } else {
            await this.send(full);
            this.scheduleCloudInline(threadId,wait);
          }
        } else await this.send(full);
      } catch(error) {
        if(this.cloudHistorySignatures.get(threadId)===signature)this.cloudHistorySignatures.delete(threadId);
        throw error;
      }
      return;
    }
    const cloudRoute = await this.cloudTextRoute(threadId);
    if (cloudRoute && cloudRoute === this.cloudTextSession) {
      // A direct refresh also carries durable request progress, without waiting
      // for the periodic callback or allowing a snapshot failure to hide it.
      await cloudRoute.publish((payload) => this.send(payload), false);
      await cloudRoute.deliverSnapshot((payload) => this.send(payload), requestId, { trigger: "direct",
        subscriptionAcceptedAt: this.watchAcceptedAt, subscriptionExpiresAt: this.watchExpiresAt });
      return;
    }
    const snapshot = cloudRoute
      ? await cloudRoute.snapshot()
      : await this.appServer.chatSnapshot(threadId, requestId !== undefined || forceRefresh);
    await this.send({
      version: 1,
      kind: "chat.snapshot",
      requestId,
      ...snapshot,
      generatedAt: "generatedAt" in snapshot && typeof snapshot.generatedAt === "number" ? snapshot.generatedAt : Date.now(),
    });
    if (!cloudRoute) this.turnTiming.markThread(threadId, forceRefresh ? "finalSnapshotSent" : "firstStreamSnapshotSent");
  }

  private async cloudTextRoute(threadId: unknown): Promise<CloudTextSession | CloudTextProof | null> {
    if (this.cloudTextSession?.owns(threadId) && await this.cloudTextSession.configured()) return this.cloudTextSession;
    return this.cloudTextProof?.owns(threadId) ? this.cloudTextProof : null;
  }

  private onAgentOutput(threadId: string): Promise<void> {
    if (this.watchedThreadId !== threadId || Date.now() > this.watchExpiresAt || this.chatSyncTimer) {
      return Promise.resolve();
    }
    this.chatSyncTimer = setTimeout(() => {
      this.chatSyncTimer = null;
      if (this.watchedThreadId !== threadId || Date.now() > this.watchExpiresAt) return;
      void this.sendChatSnapshot(threadId).catch((error: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "Could not stream chat snapshot", error: publicError(error) }));
      });
    }, CHAT_SYNC_DEBOUNCE_MS);
    this.chatSyncTimer.unref();
    return Promise.resolve();
  }

  private cloudInlineReason(threadId: string): "watched" | "terminal" | null {
    const now = Date.now();
    if (this.watchedThreadId === threadId && now <= this.watchExpiresAt) return "watched";
    const terminalAt = this.cloudTerminalAt.get(threadId);
    if (terminalAt !== undefined && now - terminalAt <= CLOUD_INLINE_TERMINAL_WINDOW_MS) return "terminal";
    return null;
  }

  private clearCloudInlineTimer(threadId: string): void {
    const timer = this.cloudInlineTimers.get(threadId);
    if (timer) clearTimeout(timer);
    this.cloudInlineTimers.delete(threadId);
  }

  // One trailing inline push per window, carrying the latest snapshot.
  private scheduleCloudInline(threadId: string, delayMs: number): void {
    if (this.cloudInlineTimers.has(threadId)) return;
    const timer = setTimeout(() => {
      this.cloudInlineTimers.delete(threadId);
      const reason = this.cloudInlineReason(threadId);
      if (!reason || !this.desktopCloud?.owns(threadId)) return;
      this.cloudInlineLastAt.set(threadId, Date.now());
      const { inline } = cloudHistoryPayloads(this.desktopCloud.snapshot(threadId), Date.now());
      void this.send(inline, reason).catch((error: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "Could not push cloud history", error: publicError(error) }));
      });
    }, Math.max(0, delayMs));
    timer.unref();
    this.cloudInlineTimers.set(threadId, timer);
  }

  private async send(payload: SendablePayload, inlineReason?: "request" | "watched" | "terminal"): Promise<void> {
    const inlineHistory = inlineReason !== undefined;
    if ((payload.kind === "turn.accepted" || payload.kind === "turn.error" || payload.kind === "live.taskCreated" ||
        (payload.kind === "live.error" && payload.callId === undefined)) &&
        typeof payload.requestId === "string") {
      payload = await this.turnReceipts.finish(
        payload.requestId, payload, payload.deliveryUncertain !== true, payload.deferred === true,
      ) as SendablePayload;
    }
    const envelope = await this.crypto.encrypt(payload);
    if(inlineHistory && JSON.stringify(envelope).length>3000)throw new Error("Cloud history exceeded the inline push limit");
    await this.relay.sendToWatch(inlineHistory || shouldWakeWatch(payload.kind) ? envelope : { ...envelope, wake: false });
    if(inlineHistory)console.info(JSON.stringify({level:"info",message:"desktop.cloud.history_pushed",threadId:payload.threadId,
      reason:inlineReason,generatedAt:payload.generatedAt,relayAcceptedAt:Date.now(),envelopeChars:JSON.stringify(envelope).length}));
  }

  private async persistOwnedThreads(): Promise<void> {
    this.config.watchOwnedThreadIds = [...this.ownedThreads].slice(-200);
    await this.persistConfig();
  }

  private async loadPendingTurns(): Promise<void> {
    this.pendingTurns.clear();
    for (const stored of this.config.pendingTurns ?? []) {
      const payload = pendingTurnSchema.parse(await this.crypto.openLocal(stored.id, stored));
      if (payload.requestId !== stored.id) {
        throw new Error("Pending Watch prompt id did not match its encrypted record");
      }
      this.pendingTurns.set(stored.id, {
        payload,
        sealed: { nonce: stored.nonce, ciphertext: stored.ciphertext },
      });
    }
  }

  private async storePendingTurn(payload: PendingTurn): Promise<void> {
    const parsed = pendingTurnSchema.parse(payload);
    if (this.pendingTurns.has(parsed.requestId)) return;
    if (this.pendingTurns.size >= MAX_PENDING_TURNS) {
      throw new Error("The bridge already has too many prompts waiting for session ownership. No prompt was queued; release a Codex session and retry.");
    }
    await this.savePendingTurn(parsed);
  }

  private async savePendingTurn(payload: PendingTurn): Promise<void> {
    const parsed = pendingTurnSchema.parse(payload);
    const sealed = await this.crypto.sealLocal(parsed.requestId, parsed);
    this.pendingTurns.set(parsed.requestId, { payload: parsed, sealed });
    await this.persistPendingTurns();
  }

  private async markPendingExternalAttempt(
    payload: PendingTurn,
    baseline: ExternalTurnBaseline,
  ): Promise<void> {
    await this.savePendingTurn({
      ...payload,
      externalAttempt: {
        attemptedAt: Date.now(),
        userMessageIds: baseline.userMessageIds,
      },
    });
  }

  private async clearPendingExternalAttempt(pending: StoredPendingTurn): Promise<void> {
    const { externalAttempt: _externalAttempt, ...payload } = pending.payload;
    await this.savePendingTurn(payload);
  }

  private async removePendingTurn(requestId: string): Promise<boolean> {
    if (!this.pendingTurns.delete(requestId)) return false;
    await this.persistPendingTurns();
    return true;
  }

  private async processPendingTurns(): Promise<void> {
    if (this.pendingTurnTask) return this.pendingTurnTask;
    this.pendingTurnTask = this.processPendingTurnsNow().finally(() => {
      this.pendingTurnTask = null;
    });
    return this.pendingTurnTask;
  }

  private async processPendingTurnsNow(): Promise<void> {
    for (const [requestId, pending] of this.pendingTurns) {
      if (this.desktopCloud?.owns(pending.payload.threadId)) {
        await this.reportBlockedPendingTurn({ ...pending.payload,
          blockedReason: "This cloud chat now receives messages only. This adapter will not resend the saved prompt. Check Codex for any earlier attempt before sending your draft there." });
        continue;
      }
      if (pending.payload.blockedReason) {
        await this.reportBlockedPendingTurn(pending.payload);
        continue;
      }
      if (pending.payload.externalAttempt) {
        let deliveryStatus;
        try {
          deliveryStatus = await this.appServer.reconcileExternalTurn(
            pending.payload.threadId,
            pending.payload.text,
            pending.payload.externalAttempt,
          );
        } catch (error) {
          if (isRetryablePendingTurnError(error)) continue;
          throw error;
        }
        if (deliveryStatus === "delivered") {
          await this.finishPendingTurn(requestId, pending.payload.threadId);
          continue;
        }
        if (deliveryStatus === "waiting") continue;
        await this.clearPendingExternalAttempt(pending);
      }
      let result;
      try {
        result = await this.appServer.submitTurn(
          pending.payload.threadId,
          pending.payload.text,
          this.config.defaultCwd,
          pending.payload.model,
          pending.payload.effort,
          requestId,
          (baseline, followUpMode) => this.markPendingExternalAttempt({
            ...pending.payload,
            followUpAction: followUpMode,
          }, baseline),
          pending.payload.followUpAction ?? "default",
          ...(pending.payload.fastMode !== undefined ? [pending.payload.fastMode] as const : []),
        );
      } catch (error) {
        if (error instanceof ForeignThreadSelectionError || error instanceof ForeignThreadSteerError || error instanceof FastModeUnavailableError) {
          // Persist the terminal decision before notifying the watch. A crash
          // or lost notification must never revive this rejected submission.
          const blocked = { ...pending.payload, blockedReason: error.message };
          await this.savePendingTurn(blocked);
          await this.reportBlockedPendingTurn(blocked);
          continue;
        }
        if (isRetryablePendingTurnError(error)) continue;
        throw error;
      }
      if (result.state === "waiting") continue;
      await this.finishPendingTurn(requestId, result.threadId, result.steered);
    }
  }

  private async reportBlockedPendingTurn(pending: PendingTurn): Promise<void> {
    try {
      await this.send({
        version: 1,
        kind: "turn.error",
        requestId: pending.requestId,
        threadId: pending.threadId,
        deferred: true,
        draftText: pending.text,
        message: pending.blockedReason,
        occurredAt: Date.now(),
      });
      await this.removePendingTurn(pending.requestId);
    } catch (error) {
      // Keep the blocked record for receipt redelivery; never resubmit it.
      console.error(JSON.stringify({ level: "warn", message: "Could not deliver a blocked Watch prompt notice", error: publicError(error) }));
    }
  }

  private async finishPendingTurn(requestId: string, threadId: string, steered = false): Promise<void> {
    const fastMode = this.pendingTurns.get(requestId)?.payload.fastMode;
    await this.removePendingTurn(requestId);
    await this.send({
      version: 1,
      kind: "turn.started",
      requestId,
      threadId,
      selectionApplied: true,
      message: [steered
        ? "Steered the active turn. Your selected model and reasoning will be used for the next new turn."
        : "Watch model and reasoning selection applied. Prompt submitted in this chat.",
        tierNotice(fastMode)].filter(Boolean).join(" "),
    });
    await this.sendSessions().catch(() => undefined);
  }

  private async persistPendingTurns(): Promise<void> {
    this.config.pendingTurns = [...this.pendingTurns].map(([id, pending]) => ({
      id,
      nonce: pending.sealed.nonce,
      ciphertext: pending.sealed.ciphertext,
    }));
    await this.persistConfig();
  }

  private async persistConfig(): Promise<void> {
    this.persistTask = this.persistTask.catch(() => undefined).then(() => writeConfig(this.config));
    await this.persistTask;
  }
}

function tierNotice(fastMode?: boolean): string | undefined {
  if (fastMode === undefined) return undefined;
  return `${fastMode ? "Fast" : "Standard"} requested for new turns in this task. An already-running turn keeps its current tier.`;
}

function turnAcceptedMessage(result: TurnSubmissionResult): string | undefined {
  if (result.state === "waiting" && result.followUpMode === "queue") {
    return "Queued on the Watch. Waiting for the active turn to finish so the selected model and reasoning can be applied exactly.";
  }
  if (result.state === "waiting") {
    return "Prompt saved for this chat. Waiting for Codex Desktop to apply the Watch model and reasoning selection exactly.";
  }
  if (result.steered) {
    return "Steered the active turn. Your selected model and reasoning will be used for the next new turn.";
  }
  if (result.state === "queued" && result.followUpMode === "queue") {
    return "Queued after the active turn.";
  }
  return undefined;
}

export function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The request could not be completed";
  return sanitizePublicText(message) || "The request could not be completed";
}

export function publicRequestError(error: unknown, kind: WatchPayload["kind"]): string {
  const message = publicError(error);
  if (kind.startsWith("live.")) {
    if (kind === "live.start" && /active writer|actively writing this session|active session in another client|session is (?:currently )?active in another client|another (?:Codex )?client|owns this session/iu.test(message)) {
      return "Another Codex client holds this task's writer. Voice did not start. Restore the shared Desktop/bridge connection, then reconnect to this task.";
    }
    if (/timed out/iu.test(message))
      return "Codex did not confirm this voice request. Check the call in Codex before reconnecting.";
    return message;
  }
  if (/timed out/iu.test(message)) {
    if (kind === "feedback.submit") {
      return "Codex did not acknowledge the feedback. Keep Codex and your private bridge running, then retry.";
    }
    return kind === "chat.watch"
      ? "Codex did not return this chat in time. Keep Codex and your private bridge running, then retry."
      : "Codex did not acknowledge the prompt in time. Keep Codex and your private bridge running, then retry.";
  }
  if (/unauthori[sz]ed|sign(?:ed)? out|log in/iu.test(message)) {
    return "Codex is signed out on the bridge host. Sign in there, then retry.";
  }
  if (/not found|no rollout|not loaded/iu.test(message)) {
    if (kind === "turn.submit") {
      return "Codex could not synchronize this session after retrying. Agentic Wear did not queue or send your message, and your draft remains on the watch. Refresh sessions and retry.";
    }
    return "The bridge could not load this session after resyncing. Agentic Wear kept your selection. Refresh sessions and retry; choose another chat only if this one no longer appears.";
  }
  if (/cancel(?:led|ed)/iu.test(message)) {
    if (kind === "turn.submit") {
      return "Codex cancelled session synchronization after the bridge retried it. Agentic Wear did not queue or send your message, and your draft remains on the watch. Refresh sessions and retry.";
    }
    return "Codex briefly cancelled the chat-history sync after the bridge retried it. Agentic Wear kept your selection and draft; refresh sessions and retry.";
  }
  if (/not connected|socket closed|app server closed/iu.test(message)) {
    return "The private bridge lost its Codex connection. Restart Codex and the Agentic Wear bridge, then retry.";
  }
  if (/active writer|actively writing this session|active session in another client|session is (?:currently )?active in another client|session is busy|another (?:Codex )?client|owns this session/iu.test(message)) {
    return "Another Codex client owns this active session. Agentic Wear did not queue or send your prompt. Keep the draft and retry this same chat after its turn finishes; Agentic Wear will not create another chat.";
  }
  if (/unknown variant [`']thread\/queue\/add|queued submission operation failed/iu.test(message)) {
    return "This Codex App Server does not support queued watch prompts. Agentic Wear did not queue or send your prompt; keep the draft and retry after the current turn finishes.";
  }
  return message;
}

const CHAT_SYNC_DEBOUNCE_MS = 700;
const CHAT_WATCH_TTL_MS = 90_000;
const CLOUD_INLINE_MIN_INTERVAL_MS = 3_000;
const CLOUD_INLINE_TERMINAL_WINDOW_MS = 15_000;
const POST_CALL_REFRESH_DELAY_MS = 750;
const LIVE_CAPABILITY_CACHE_MS = 60_000;
const PENDING_TURN_RETRY_MS = 2_000;
const MAX_PENDING_TURNS = 20;

function supportsLiveVoice(capability: RealtimeVoiceCapability, voice: string): boolean {
  return capability.realtimeApiAvailable && Boolean(capability.voices?.v1.includes(voice));
}

function isRetryablePendingTurnError(error: unknown): boolean {
  return /active writer|actively writing this session|active session in another client|session is (?:currently )?active in another client|not found|no rollout|not available|temporarily unavailable|cancel(?:led|ed)/iu
    .test(error instanceof Error ? error.message : "");
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Bridge stopped");
}
