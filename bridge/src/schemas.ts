import { z } from "zod";
import {
  MAX_AUDIO_BASE64_CHARS,
  MAX_INBOUND_CIPHERTEXT_BASE64_CHARS,
  MAX_TRANSCRIPT_CHARS,
} from "./limits.js";

const safeId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/u);
const safeModel = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:/-]+$/u);
const reasoningEffort = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_.:-]+$/u);
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
}).strict();

export type WireEnvelope = z.infer<typeof wireEnvelopeSchema>;

export const watchPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ version: z.literal(1), kind: z.literal("session.sync"), requestId: safeId }).strict(),
  z.object({
    version: z.literal(1),
    kind: z.literal("transcription.create"),
    requestId: safeId,
    audioBase64,
    mimeType: z.enum(["audio/mp4", "audio/aac"]),
    threadId: safeId.nullable(),
    previousText: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS).nullable().optional(),
  }).strict(),
  z.object({
    version: z.literal(1),
    kind: z.literal("turn.submit"),
    requestId: safeId,
    threadId: safeId.nullable(),
    text: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS),
    model: safeModel.nullable().optional(),
    effort: reasoningEffort.default("medium"),
    followUpAction: followUpActionSchema.default("default"),
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
