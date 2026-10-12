import { z } from "zod";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/u);
const time = z.number().int().positive();
export const voiceTransportSchema = z.object({
  seq: z.number().int().min(1).max(10_000_000),
  peerState: z.enum(["new", "connecting", "connected", "disconnected", "failed", "closed"]),
  iceState: z.enum(["new", "checking", "connected", "completed", "disconnected", "failed", "closed"]),
  channelState: z.enum(["connecting", "open", "closing", "closed"]),
}).strict();
export type VoiceTransportState = z.infer<typeof voiceTransportSchema>;
const base = { version: z.literal(1), kind: z.literal("native-voice"), callId: id, threadId: id, expiresAt: time };
export const nativeVoiceCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("start"), sdp: z.string().min(10).max(65_536) }).strict(),
  z.object({ ...base, action: z.literal("transport"), transport: voiceTransportSchema }).strict(),
  z.object({ ...base, action: z.literal("heartbeat") }).strict(),
  z.object({ ...base, action: z.literal("stop") }).strict(),
]);
export type NativeVoiceCommand = z.infer<typeof nativeVoiceCommandSchema>;
export const nativeVoiceEventSchema = z.object({
  callId: id, threadId: id,
  state: z.enum(["accepted", "answer", "active", "closed", "failed"]),
  sdp: z.string().min(10).max(65_536).optional(),
  statusCode: z.number().int().min(0).max(599).optional(),
  elapsedMs: z.number().int().min(0).max(10_000_000).optional(),
  setupTiming: z.object({
    captureMs: z.number().int().min(0).max(120_000).optional(),
    peerMs: z.number().int().min(0).max(120_000).optional(),
    createStartMs: z.number().int().min(0).max(120_000).optional(),
    createEndMs: z.number().int().min(0).max(120_000).optional(),
    attachStartMs: z.number().int().min(0).max(120_000).optional(),
    attachEndMs: z.number().int().min(0).max(120_000).optional(),
  }).strict().optional(),
}).strict().refine(value => value.state === "answer" ? value.sdp?.startsWith("v=0") && value.sdp.includes("m=audio") : value.sdp === undefined);
export type NativeVoiceEvent = z.infer<typeof nativeVoiceEventSchema>;
