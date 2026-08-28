import { z } from "zod";

const safeId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const base64 = z.string().min(16).max(1_048_576).regex(/^[A-Za-z0-9+/]*={0,2}$/);
const pairId = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/);
const pairingProof = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/);

export const wireEnvelopeSchema = z.object({
  version: z.literal(1),
  messageId: safeId,
  sender: z.enum(["bridge", "watch"]),
  recipient: z.enum(["bridge", "watch"]),
  sentAt: z.number().int().positive(),
  nonce: base64.max(32),
  ciphertext: base64,
}).strict().refine((value) => value.sender !== value.recipient, "Sender and recipient must differ");

export type WireEnvelope = z.infer<typeof wireEnvelopeSchema>;

export const pairStartSchema = z.object({
  pairId,
  bridgePublicKey: base64.max(1_024),
}).strict();

export const pairCompleteSchema = z.object({
  pairId,
  watchPublicKey: base64.max(1_024),
  fcmInstallationId: z.string().min(20).max(4_096).optional(),
}).strict();

export const watchPairingProofSchema = z.object({ watchProof: pairingProof }).strict();

export const bridgePairingProofSchema = z.object({
  watchPublicKey: base64.max(1_024),
  watchProof: pairingProof,
  bridgeProof: pairingProof,
}).strict();

export const ackSchema = z.object({
  messageIds: z.array(safeId).min(1).max(50),
}).strict();

export const registrationSchema = z.object({
  fcmInstallationId: z.string().min(20).max(4_096),
}).strict();

export const bridgeControlSchema = z.object({
  type: z.literal("ping"),
  at: z.number().int().positive(),
}).strict();
