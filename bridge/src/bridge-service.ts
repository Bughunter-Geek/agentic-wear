import type { BridgeConfig } from "./config.js";
import { writeConfig } from "./config.js";
import { CryptoBox } from "./crypto-box.js";
import {
  AppServerClient,
  type ModelView,
  type ApprovalEvent,
  type SessionView,
  type TerminalEvent,
} from "./app-server-client.js";
import { RelayClient } from "./relay-client.js";
import { ReplayGuard } from "./replay-guard.js";
import { processAuthenticatedEnvelope } from "./inbound-envelope.js";
import { type WatchPayload, type WireEnvelope } from "./schemas.js";
import type { Transcriber } from "./transcriber.js";
import { MAX_AUDIO_BYTES } from "./limits.js";

type SendablePayload = Record<string, unknown> & { version: 1; kind: string };

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
      await this.appServer.connect("stdio");
      await this.sendSessions();
      const monitorTask = this.appServer.monitorTerminals(this.controller.signal).catch((error: unknown) => {
        this.fatalError = error instanceof Error ? error : new Error("Terminal monitor stopped");
        this.controller.abort(this.fatalError);
      });
      await socketTask;
      await monitorTask;
      if (this.fatalError) throw this.fatalError;
    } finally {
      this.appServer.close();
      if (this.chatSyncTimer) clearTimeout(this.chatSyncTimer);
      this.chatSyncTimer = null;
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
          const result = await this.appServer.submitTurn(
            payload.threadId,
            payload.text,
            this.config.defaultCwd,
            payload.model ?? null,
            payload.effort,
          );
          if (result.created) await this.persistOwnedThreads();
          await this.send({
            version: 1,
            kind: "turn.accepted",
            requestId: payload.requestId,
            threadId: result.threadId,
          });
          await this.sendSessions();
          return;
        }
        case "chat.watch":
          this.watchedThreadId = payload.threadId;
          this.watchExpiresAt = Date.now() + CHAT_WATCH_TTL_MS;
          await this.sendChatSnapshot(payload.threadId, payload.requestId);
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
    await this.sendSessions().catch((error: unknown) => {
      console.error(JSON.stringify({ level: "error", message: "Could not refresh sessions", error: publicError(error) }));
    });
  }

  private async onApproval(event: ApprovalEvent): Promise<void> {
    await this.send({ version: 1, ...event });
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

  private async sendChatSnapshot(threadId: string, requestId?: string): Promise<void> {
    const snapshot = await this.appServer.chatSnapshot(threadId, requestId !== undefined);
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

  private async persistConfig(): Promise<void> {
    this.persistTask = this.persistTask.catch(() => undefined).then(() => writeConfig(this.config));
    await this.persistTask;
  }
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The request could not be completed";
  return message.trim().replace(/\s+/gu, " ").slice(0, 260) || "The request could not be completed";
}

function publicRequestError(error: unknown, kind: WatchPayload["kind"]): string {
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
  if (/not found|no rollout/iu.test(message)) {
    return "That Codex session is no longer available on this bridge. Refresh Sessions and choose another one.";
  }
  if (/not connected|socket closed|app server closed/iu.test(message)) {
    return "The private bridge lost its Codex connection. Restart Codex and the Agentic Wear bridge, then retry.";
  }
  if (/active writer/iu.test(message)) {
    return "Codex still owns this session in another client. Update and restart Codex, then retry so Agentic Wear can queue the prompt safely.";
  }
  if (/unknown variant [`']thread\/queue\/add|queued submission operation failed/iu.test(message)) {
    return "This Codex version cannot receive queued watch prompts yet. Update and restart Codex on the bridge host, then retry.";
  }
  return message;
}

const CHAT_SYNC_DEBOUNCE_MS = 700;
const CHAT_WATCH_TTL_MS = 90_000;

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Bridge stopped");
}
