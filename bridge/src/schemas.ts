import { z } from "zod";
import {
  MAX_AUDIO_BASE64_CHARS,
  MAX_INBOUND_CIPHERTEXT_BASE64_CHARS,
  MAX_TRANSCRIPT_CHARS,
} from "./limits.js";

const safeId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/u);
// Browser-route cloud model names are display names ("GPT-6.1 Sol"), so spaces are allowed there.
const cloudModelName = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:/ -]+$/u);
const safeModel = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:/-]+$/u);
export const reasoningEffort = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_.:-]+$/u);
export const followUpActionSchema = z.enum(["default", "queue", "steer"]);
export type FollowUpAction = z.infer<typeof followUpActionSchema>;
const base64 = z.string().min(16).max(1_048_576).regex(/^[A-Za-z0-9+/]*={0,2}$/u);
const audioBase64 = z.string().min(16).max(MAX_AUDIO_BASE64_CHARS).regex(/^[A-Za-z0-9+/]*={0,2}$/u);
const ciphertextBase64 = z.string()
  .min(16)
  .max(MAX_INBOUND_CIPHERTEXT_BASE64_CHARS)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/u);

export const wireEnvelopeSchema = z.object({
  version: z.literal(1),
  messageId: safeId,
  sender: z.enum(["bridge", "watch"]),
  recipient: z.enum(["bridge", "watch"]),
  sentAt: z.number().int().positive(),
  nonce: base64.max(32),
  ciphertext: ciphertextBase64,
  wake: z.boolean().optional(),
}).strict();

export type WireEnvelope = z.infer<typeof wireEnvelopeSchema>;

export const watchPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ version: z.literal(1), kind: z.literal("live.newTask"), requestId: safeId }).strict(),
  z.object({ version: z.literal(1), kind: z.literal("live.capability"), requestId: safeId,
    threadId: safeId.optional() }).strict(),
  z.object({ version: z.literal(1), kind: z.literal("live.start"), requestId: safeId,
    callId: safeId, threadId: safeId, sdp: z.string().min(10).max(65_536), voice: safeId, fastMode: z.boolean().optional() }).strict(),
  z.object({ version: z.literal(1), kind: z.literal("live.heartbeat"), requestId: safeId, callId: safeId }).strict(),
  z.object({ version: z.literal(1), kind: z.literal("live.stop"), requestId: safeId, callId: safeId }).strict(),
  // Metadata-only call diagnostics from the Watch: stage names, timings, states and counts.
  z.object({ version: z.literal(1), kind: z.literal("live.trace"), requestId: safeId, callId: safeId,
    events: z.array(z.object({ stage: z.string().regex(/^[A-Z_]{1,32}$/u), elapsedMs: z.number().int().min(0).max(90_000),
      callHash: z.string().regex(/^[a-f0-9]{12}$/u).optional(), threadHash: z.string().regex(/^[a-f0-9]{12}$/u).optional(),
      state: z.string().regex(/^[A-Z_]{1,32}$/u).optional(), count: z.number().int().min(0).max(65_536).optional() }).strict()).max(80),
  }).strict(),
  // Value-free voice loop diagnostics from the Watch (Dot/cloud turn-based voice): phase and reason names only.
  z.object({ version: z.literal(1), kind: z.literal("voice.loop.trace"), requestId: safeId,
    phase: z.enum(["idle", "starting", "listening", "sending", "waiting", "speaking"]),
    reason: z.string().regex(/^[a-z_]{1,48}$/u).optional(),
    at: z.number().int().nonnegative() }).strict(),
  // Metadata-only notification timing from the Watch: epoch milliseconds on the Watch clock and
  // per-alert decisions. Never message text, titles or details.
  z.object({ version: z.literal(1), kind: z.literal("notify.trace"), requestId: safeId,
    pushReceivedAt: z.number().int().nonnegative(),
    fetchStartedAt: z.number().int().nonnegative(),
    fetchCompletedAt: z.number().int().nonnegative(),
    // 1-based attempt of the push-triggered inbox fetch that succeeded. Absent on older Watch builds.
    fetchAttempt: z.number().int().min(1).max(10).optional(),
    // "push" when the envelope arrived inside the push and was notified without a fetch; absent on older builds.
    deliveredVia: z.enum(["push", "fetch"]).optional(),
    alerts: z.array(z.object({
      eventId: z.string().max(300),
      decision: z.enum(["posted", "duplicate", "suppressed_notify_off", "suppressed_before_foreground"]),
      decidedAt: z.number().int().nonnegative(),
    }).strict()).max(10),
  }).strict(),
  // Metadata-only relay failure log from the Watch: operation name, HTTP status (0 = no response),
  // exception class and epoch milliseconds. Never messages, URLs, ids, tokens or error text.
  z.object({ version: z.literal(1), kind: z.literal("relay.failures"), requestId: safeId,
    failures: z.array(z.object({
      op: z.enum(["pairing", "sendToBridge", "fetchInbox", "acknowledge", "fcmRegistration"]),
      status: z.number().int().min(0).max(599),
      errorClass: z.string().regex(/^[A-Za-z0-9_.$]{1,80}$/u),
      at: z.number().int().nonnegative(),
    }).strict()).max(20),
  }).strict(),
  // Metadata-only per-push diagnostics from the Watch: FCM priorities, envelope presence/size and the outcome of
  // processing the pushed envelope. Never message text, titles, ciphertext or ids.
  z.object({ version: z.literal(1), kind: z.literal("push.diagnostics"), requestId: safeId,
    pushes: z.array(z.object({
      receivedAt: z.number().int().nonnegative(),
      sentTime: z.number().int().nonnegative(),
      priority: z.number().int().min(0).max(2),
      originalPriority: z.number().int().min(0).max(2),
      envelopePresent: z.boolean(),
      envelopeChars: z.number().int().min(0).max(10_000),
      outcome: z.enum(["processed", "too_long", "bad_json", "bad_structure", "too_old_or_future", "no_pairing",
        "already_handled", "decrypt_failed", "timeout", "error", "no_envelope"]),
      outcomeAt: z.number().int().nonnegative(),
    }).strict()).max(20),
  }).strict(),
  z.object({ version: z.literal(1), kind: z.literal("session.sync"), requestId: safeId }).strict(),
  z.object({ version: z.literal(1), kind: z.literal("draft.prepare"), requestId: safeId }).strict(),
  z.object({
    version: z.literal(1),
    kind: z.literal("transcription.create"),
    requestId: safeId,
    audioBase64,
    mimeType: z.enum(["audio/mp4", "audio/aac"]),
    backend: z.enum(["phonon", "whisper"]).optional(),
    threadId: safeId.nullable(),
    previousText: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS).nullable().optional(),
    finalIntent: z.boolean().optional(),
    localEdit: z.boolean().optional(),
  }).strict(),
  z.object({
    version: z.literal(1),
    kind: z.literal("turn.submit"),
    requestId: safeId,
    threadId: safeId.nullable(),
    text: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS),
    model: z.union([safeModel, cloudModelName]).nullable().optional(),
    effort: reasoningEffort.default("medium"),
    /** Browser-route cloud chats only: position on the page's reasoning slider. */
    cloudEffortIndex: z.number().int().min(0).max(9).optional(),
    followUpAction: followUpActionSchema.default("default"),
    fastMode: z.boolean().optional(),
  }).strict(),
  // Answer to a Codex "ask the user" question (an agentMessage item with `questions`).
  z.object({
    version: z.literal(1),
    kind: z.literal("question.answer"),
    requestId: safeId,
    threadId: safeId,
    questionItemId: safeId,
    questionIndex: z.number().int().min(0).max(9),
    answer: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS),
    // Fallback only: the bridge prefers the full title it can look up itself.
    question: z.string().trim().max(1_000).optional(),
  }).strict(),
  z.object({
    version: z.literal(1),
    kind: z.literal("approval.respond"),
    requestId: safeId,
    approvalId: safeId,
    decision: z.enum(["accept", "decline"]),
  }).strict(),
  z.object({
    version: z.literal(1),
    kind: z.literal("feedback.submit"),
    requestId: safeId,
    threadId: safeId,
    turnId: safeId,
    itemId: safeId,
    rating: z.enum(["liked", "disliked"]),
  }).strict(),
  z.object({
    version: z.literal(1),
    kind: z.literal("chat.watch"),
    requestId: safeId,
    threadId: safeId,
  }).strict(),
  z.object({
    version: z.literal(1),
    kind: z.literal("chat.unwatch"),
    requestId: safeId,
    threadId: safeId,
  }).strict(),
]);

export type WatchPayload = z.infer<typeof watchPayloadSchema>;

/** Bridge-to-watch event: Codex asked the user a question mid-turn. */
export const questionRequestEventSchema = z.object({
  version: z.literal(1),
  kind: z.literal("question.request"),
  eventId: z.string().min(1).max(300),
  threadId: safeId,
  title: z.string().max(100),
  detail: z.string().max(300),
  options: z.array(z.string().max(40)).max(4),
  questionItemId: safeId,
  questionIndex: z.number().int().min(0).max(9),
  occurredAt: z.number().int().nonnegative(),
}).strict();

export const relaySocketMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("envelope"), envelope: wireEnvelopeSchema }).strict(),
  z.object({
    type: z.literal("pair.status"),
    paired: z.boolean(),
    watchPublicKey: base64.max(1_024).nullable(),
    watchProof: z.string().length(43).nullable(),
  }).strict(),
  z.object({
    type: z.literal("pair.challenge"),
    watchPublicKey: base64.max(1_024),
    watchProof: z.string().length(43),
  }).strict(),
  z.object({ type: z.literal("pong"), at: z.number().int().positive() }).strict(),
]);

export const threadSchema = z.object({
  id: safeId,
  preview: z.string().default(""),
  name: z.string().nullable().optional(),
  parentThreadId: safeId.nullable().optional(),
  agentRole: z.string().min(1).max(100).nullable().optional(),
  updatedAt: z.number().int().nonnegative(),
  status: z.object({ type: z.enum(["notLoaded", "idle", "systemError", "active"]) }).passthrough(),
  canAcceptDirectInput: z.boolean().nullable().optional(),
}).passthrough();

export type CodexThread = z.infer<typeof threadSchema>;

export const threadListResponseSchema = z.object({
  data: z.array(threadSchema),
  nextCursor: z.string().nullable(),
}).passthrough();

const modelListEntrySchema = z.object({
  id: safeModel,
  model: safeModel,
  displayName: z.string().trim().min(1).max(100),
  defaultReasoningEffort: reasoningEffort,
  supportedReasoningEfforts: z.array(z.object({
    reasoningEffort,
    description: z.string().trim().max(240),
  }).passthrough()).max(16),
  hidden: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  serviceTiers: z.array(z.object({ id: safeModel, name: z.string(), description: z.string() }).passthrough()).max(16).optional(),
}).passthrough();

export const modelListResponseSchema = z.object({
  data: z.array(modelListEntrySchema).max(100),
  nextCursor: z.string().nullable().optional(),
}).passthrough();

export type CodexModel = z.infer<typeof modelListEntrySchema>;

export const realtimeVoiceListResponseSchema = z.object({
  voices: z.object({
    v1: z.array(z.string().trim().min(1)).max(32),
    v2: z.array(z.string().trim().min(1)).max(32),
    defaultV1: z.string().trim().min(1).nullable(),
    defaultV2: z.string().trim().min(1).nullable(),
  }).strict(),
}).strict();

export type RealtimeVoiceListResponse = z.infer<typeof realtimeVoiceListResponseSchema>;

export const turnCompletedSchema = z.object({
  threadId: safeId,
  turn: z.object({
    id: safeId,
    status: z.enum(["completed", "interrupted", "failed"]),
    completedAt: z.number().nullable().optional(),
    error: z.object({ message: z.string() }).passthrough().nullable().optional(),
  }).passthrough(),
}).strict();

export const turnStartedSchema = z.object({
  threadId: safeId.optional(),
  turn: z.object({ id: safeId }).passthrough(),
}).passthrough();

export const agentMessageDeltaSchema = z.object({
  threadId: safeId,
  turnId: safeId,
  itemId: safeId,
  delta: z.string(),
}).strict();

export const itemCompletedSchema = z.object({
  threadId: safeId,
  turnId: safeId,
  completedAtMs: z.number().int().nonnegative(),
  item: z.object({
    id: safeId,
    type: z.string(),
    text: z.string().optional(),
    phase: z.enum(["commentary", "final_answer"]).nullable().optional(),
  }).passthrough(),
}).strict();

export const chatTurnListResponseSchema = z.object({
  data: z.array(z.object({
    id: safeId,
    status: z.enum(["completed", "interrupted", "failed", "inProgress"]).optional(),
    completedAt: z.number().nullable().optional(),
    items: z.array(z.object({
      id: safeId,
      type: z.string(),
      clientId: safeId.nullable().optional(),
      text: z.string().optional(),
      phase: z.enum(["commentary", "final_answer"]).nullable().optional(),
      content: z.array(z.object({
        type: z.string(),
        text: z.string().optional(),
      }).passthrough()).optional(),
    }).passthrough()),
  }).passthrough()),
  nextCursor: z.string().nullable().optional(),
  backwardsCursor: z.string().nullable().optional(),
}).passthrough();

export const turnListResponseSchema = z.object({
  data: z.array(z.object({
    id: safeId,
    status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
    completedAt: z.number().nullable().optional(),
    error: z.object({ message: z.string() }).passthrough().nullable().optional(),
  }).passthrough()),
  nextCursor: z.string().nullable(),
  backwardsCursor: z.string().nullable(),
}).passthrough();

export const jsonRpcMessageSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).passthrough().optional(),
}).passthrough();
