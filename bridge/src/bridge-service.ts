import type { BridgeConfig } from "./config.js";
import { writeConfig } from "./config.js";
import { CryptoBox, type SealedLocalPayload } from "./crypto-box.js";
import {
  AppServerClient,
  type ModelView,
  type ApprovalEvent,
  type SessionView,
  type TerminalEvent,
  type ExternalTurnBaseline,
  type TurnSubmissionResult,
} from "./app-server-client.js";
import { RelayClient } from "./relay-client.js";
import { ReplayGuard } from "./replay-guard.js";
import { processAuthenticatedEnvelope } from "./inbound-envelope.js";
import { followUpActionSchema, type FollowUpAction, type WatchPayload, type WireEnvelope } from "./schemas.js";
import type { Transcriber } from "./transcriber.js";
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
  createdAt: z.number().int().positive(),
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
  private readonly controller = new AbortController();
  private persistTask: Promise<void> = Promise.resolve();
  private fatalError: Error | null = null;
  private watchedThreadId: string | null = null;
  private watchExpiresAt = 0;
  private chatSyncTimer: NodeJS.Timeout | null = null;
  private pendingTurnTimer: NodeJS.Timeout | null = null;
  private pendingTurnTask: Promise<void> | null = null;
  private readonly pendingTurns = new Map<string, StoredPendingTurn>();

  constructor(
    private readonly config: BridgeConfig,
    private readonly relay: RelayClient,
    private readonly privateKey: string,
    private readonly transcriber: Transcriber,
    private readonly replayGuard = new ReplayGuard(),
  ) {
    this.ownedThreads = new Set(config.watchOwnedThreadIds);
    this.crypto = new CryptoBox(config.pairId, privateKey, config.bridgePublicKey, config.watchPublicKey);
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
  }

  async run(): Promise<void> {
    const status = await this.relay.status();
    if (!status.paired || !status.watchPublicKey) throw new Error("The watch has not completed authenticated pairing");
    this.assertWatchPublicKey(status.watchPublicKey);

    const socketTask = this.relay.runSocket(
      this.controller.signal,
      (envelope) => this.onEnvelope(envelope),
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
      await this.loadPendingTurns();
      await this.processPendingTurns();
      this.pendingTurnTimer = setInterval(() => {
        void this.processPendingTurns().catch((error: unknown) => {
          console.error(JSON.stringify({
            level: "error",
            message: "Could not retry a pending Watch prompt",
            error: publicError(error),
          }));
        });
      }, PENDING_TURN_RETRY_MS);
      this.pendingTurnTimer.unref();
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

  private async onEnvelope(envelope: WireEnvelope): Promise<void> {
    await processAuthenticatedEnvelope(
      envelope,
      this.crypto,
      this.replayGuard,
      (payload) => this.handleWatchPayload(payload),
    );
  }

  private async handleWatchPayload(payload: WatchPayload): Promise<void> {
    try {
      switch (payload.kind) {
        case "session.sync":
          await this.sendSessions();
          return;
        case "transcription.create":
          await this.createTranscription(payload);
          return;
        case "turn.submit": {
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
          );
          if (result.created) await this.persistOwnedThreads();
          if (result.state === "waiting") {
            await this.storePendingTurn(pendingPayload(
              result.threadId,
              result.followUpMode ?? payload.followUpAction,
            ));
          } else await this.removePendingTurn(payload.requestId);
          this.watchedThreadId = result.threadId;
          this.watchExpiresAt = Date.now() + CHAT_WATCH_TTL_MS;
          await this.send({
            version: 1,
            kind: "turn.accepted",
            requestId: payload.requestId,
            threadId: result.threadId,
            state: result.state,
            selectionApplied: result.selectionApplied,
            message: turnAcceptedMessage(result),
          });
          await this.sendChatSnapshot(result.threadId).catch(() => undefined);
          await this.sendSessions();
          return;
        }
        case "chat.watch":
          this.watchedThreadId = payload.threadId;
          this.watchExpiresAt = Date.now() + CHAT_WATCH_TTL_MS;
          await this.sendChatSnapshot(payload.threadId, payload.requestId);
          await this.sendSessions();
          return;
        case "chat.unwatch":
          if (this.watchedThreadId === payload.threadId) {
            this.watchedThreadId = null;
            this.watchExpiresAt = 0;
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
        message: publicRequestError(error, payload.kind),
        occurredAt: Date.now(),
      });
      if (payload.kind === "turn.submit" || payload.kind === "chat.watch") {
        await this.sendSessions().catch(() => undefined);
      }
    }
  }

  private async createTranscription(payload: Extract<WatchPayload, { kind: "transcription.create" }>): Promise<void> {
    const audio = Buffer.from(payload.audioBase64, "base64");
    try {
      if (audio.byteLength < 1_024 || audio.byteLength > MAX_AUDIO_BYTES) {
        throw new Error("Voice recordings must be between 1 KiB and the four-minute limit");
      }
      const text = await this.transcriber.transcribe(audio, payload.mimeType);
      const revisedText = payload.previousText
        ? await this.appServer.reviseDraft(payload.previousText, text, this.config.defaultCwd)
        : text;
      await this.send({
        version: 1,
        kind: "transcription.ready",
        requestId: payload.requestId,
        threadId: payload.threadId,
        text: revisedText,
        revised: payload.previousText != null,
      });
    } finally {
      audio.fill(0);
    }
  }

  private async onTerminal(event: TerminalEvent): Promise<void> {
    await this.send({ version: 1, ...event });
    if (this.watchedThreadId === event.threadId && Date.now() <= this.watchExpiresAt) {
      await this.sendChatSnapshot(event.threadId, undefined, true).catch((error: unknown) => {
        console.error(JSON.stringify({
          level: "error",
          message: "Could not refresh the completed live chat",
          error: publicError(error),
        }));
      });
    }
    void this.processPendingTurns().catch(() => undefined);
    await this.sendSessions().catch((error: unknown) => {
      console.error(JSON.stringify({ level: "error", message: "Could not refresh sessions", error: publicError(error) }));
    });
  }

  private async onApproval(event: ApprovalEvent): Promise<void> {
    await this.send({ version: 1, ...event });
  }

  private async reportRealtimeVoiceCapability(): Promise<void> {
    const capability = await this.appServer.realtimeVoiceCapability();
    const messageByBlocker = {
      realtime_api_unavailable: "Realtime voice is unavailable: this Codex App Server does not expose a compatible realtime API.",
      model_catalog_unavailable: "Realtime voice is unavailable: the Codex model catalog could not be verified.",
      gpt_live_model_unavailable: "Realtime voice is unavailable: GPT-Live-1 is not in this Codex App Server model catalog.",
      watch_transport_not_implemented: "GPT-Live-1 is cataloged; realtime voice remains disabled pending a reviewed watch transport.",
    } as const;
    console.info(JSON.stringify({
      level: capability.blocker === "watch_transport_not_implemented" ? "info" : "warn",
      message: messageByBlocker[capability.blocker],
      realtimeVoiceAvailable: capability.available,
      realtimeApiAvailable: capability.realtimeApiAvailable,
      gptLiveModelAvailable: capability.gptLiveModelAvailable,
      realtimeVoiceBlocker: capability.blocker,
    }));
  }

  private async sendSessions(): Promise<void> {
    const sessions: SessionView[] = await this.appServer.listSessions();
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
    if (models.length > 0) snapshot.models = models;
    await this.send(snapshot);
  }

  private async sendChatSnapshot(
    threadId: string,
    requestId?: string,
    forceRefresh = false,
  ): Promise<void> {
    const snapshot = await this.appServer.chatSnapshot(threadId, requestId !== undefined || forceRefresh);
    await this.send({
      version: 1,
      kind: "chat.snapshot",
      requestId,
      ...snapshot,
      generatedAt: Date.now(),
    });
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

  private async send(payload: SendablePayload): Promise<void> {
    await this.relay.sendToWatch(await this.crypto.encrypt(payload));
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
        );
      } catch (error) {
        if (isRetryablePendingTurnError(error)) continue;
        throw error;
      }
      if (result.state === "waiting") continue;
      await this.finishPendingTurn(requestId, result.threadId, result.steered);
    }
  }

  private async finishPendingTurn(requestId: string, threadId: string, steered = false): Promise<void> {
    await this.removePendingTurn(requestId);
    await this.send({
      version: 1,
      kind: "turn.started",
      requestId,
      threadId,
      selectionApplied: true,
      message: steered
        ? "Steered the active turn. Your selected model and reasoning will be used for the next new turn."
        : "Watch model and reasoning selection applied. Prompt submitted in this chat.",
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
const PENDING_TURN_RETRY_MS = 2_000;
const MAX_PENDING_TURNS = 20;

function isRetryablePendingTurnError(error: unknown): boolean {
  return /active writer|actively writing this session|active session in another client|session is (?:currently )?active in another client|not found|no rollout|not available|temporarily unavailable|cancel(?:led|ed)/iu
    .test(error instanceof Error ? error.message : "");
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Bridge stopped");
}
