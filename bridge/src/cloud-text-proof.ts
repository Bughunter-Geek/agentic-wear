import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChatMessage, ChatSnapshot, SessionView } from "./app-server-client.js";

// A finite supervised proof, not a general cloud gateway or native voice adapter.
export const CLOUD_PROOF = {
  id: "AW-WATCH-20261009-01",
  threadId: "01a1188b-a850-755b-91ec-717f6182900a",
  hostId: "durable",
  title: "Extract current Claude instructions",
  watchText: "Cloud proof 47",
  acknowledgement: "AW-WATCH-20261009-01 acknowledged",
} as const;
export const CLOUD_PROOF_PROMPT = "Message from my paired Pixel Watch for Agentic Wear proof AW-WATCH-20261009-01: Cloud proof 47. Reply exactly: AW-WATCH-20261009-01 acknowledged. Do not use tools, change model settings, or create another task.";
export const CLOUD_PROOF_PROMPT_SHA = createHash("sha256").update(CLOUD_PROOF_PROMPT).digest("hex");
export const cloudProofDirectory = () => join(homedir(), ".agentic-wear", "cloud-text-proof-v1");
const safeId = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/u);
const identity = {
  proofId: z.literal(CLOUD_PROOF.id),
  threadId: z.literal(CLOUD_PROOF.threadId),
  hostId: z.literal(CLOUD_PROOF.hostId),
};
export const proofApprovalSchema = z.object({
  ...identity, enabled: z.literal(true), activatedAt: z.number().int().positive(), expiresAt: z.number().int().positive(),
}).strict();
export const proofRequestSchema = z.object({
  ...identity, requestId: safeId, watchText: z.string().min(1).max(80),
  nativePrompt: z.literal(CLOUD_PROOF_PROMPT), promptSha256: z.literal(CLOUD_PROOF_PROMPT_SHA),
  receivedAt: z.number().int().positive(),
}).strict();
export type ProofRequest = z.infer<typeof proofRequestSchema>;
export const proofClaimSchema = z.object({
  ...identity, requestId: safeId, claimedAt: z.number().int().positive(),
  baselineTurnIds: z.array(safeId).max(20),
}).strict();
export const proofAcceptedSchema = z.object({
  ...identity, requestId: safeId, acceptedAt: z.number().int().positive(),
}).strict();
export const proofReplySchema = z.object({
  ...identity, requestId: safeId, promptSha256: z.literal(CLOUD_PROOF_PROMPT_SHA),
  nativeTurnId: safeId, nativeItemId: safeId, reply: z.literal(CLOUD_PROOF.acknowledgement),
  observedAt: z.number().int().positive(),
}).strict();
type ProofPayload = Record<string, unknown> & { version: 1; kind: string };
type Delivery = (payload: ProofPayload) => Promise<void>;

export class CloudTextProof {
  private publishedState = "";
  private publishing: Promise<void> | null = null;

  constructor(readonly directory = cloudProofDirectory(), private readonly now = Date.now) {}

  owns(threadId: unknown): boolean { return threadId === CLOUD_PROOF.threadId; }

  async readJson(name: string): Promise<unknown | null> {
    await this.checkDirectory();
    let file;
    try { file = await open(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (isMissing(error)) return null; throw error; }
    try {
      const info = await file.stat();
      if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 32_768)
        throw new Error("Cloud proof record is not a private bounded file");
      return JSON.parse(await file.readFile("utf8")) as unknown;
    } finally { await file.close(); }
  }

  async writeOnce(name: string, value: unknown): Promise<void> {
    await this.checkDirectory();
    const file = await open(join(this.directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(JSON.stringify(value) + "\n"); await file.sync(); }
    finally { await file.close(); }
  }

  async approval(): Promise<z.infer<typeof proofApprovalSchema> | null> {
    try {
      if (await this.readJson("disabled.json") !== null) return null;
      const value = proofApprovalSchema.safeParse(await this.readJson("approval.json"));
      if (!value.success) return null;
      const { activatedAt, expiresAt } = value.data;
      if (activatedAt > this.now() || expiresAt <= this.now() || expiresAt - activatedAt > 30 * 60_000) return null;
      return value.data;
    } catch { return null; }
  }

  async session(): Promise<SessionView | null> {
    const approval = await this.approval();
    if (!approval) return null;
    return { id: CLOUD_PROOF.threadId, title: CLOUD_PROOF.title, updatedAt: Math.floor(approval.activatedAt / 1000),
      status: "idle", ownedByWear: false, canAcceptDirectInput: true, watchReady: true };
  }

  async enqueue(requestId: string, text: string): Promise<ProofRequest> {
    const approval = await this.requireApproval();
    if (text.trim().toLowerCase().replace(/[.!?]+$/u, "") !== CLOUD_PROOF.watchText.toLowerCase())
      throw new Error('This one-message cloud proof accepts only "Cloud proof 47". Your draft was not sent.');
    const request = proofRequestSchema.parse({ proofId: CLOUD_PROOF.id, threadId: CLOUD_PROOF.threadId,
      hostId: CLOUD_PROOF.hostId, requestId, watchText: text.trim(), nativePrompt: CLOUD_PROOF_PROMPT,
      promptSha256: CLOUD_PROOF_PROMPT_SHA, receivedAt: this.now() });
    if (request.receivedAt >= approval.expiresAt) throw new Error("Cloud proof expired before submission");
    try { await this.writeOnce("request.json", request); }
    catch (error) {
      if (!isExists(error)) throw error;
      const previous = proofRequestSchema.parse(await this.readJson("request.json"));
      if (previous.requestId !== requestId || previous.watchText !== request.watchText)
        throw new Error("This cloud proof already has its single Watch message; no second message was queued.");
      return previous;
    }
    return request;
  }

  async snapshot(): Promise<ChatSnapshot> {
    const state = await this.state();
    const messages: ChatMessage[] = [];
    if (state.request) messages.push({ id: state.request.requestId, turnId: state.request.requestId, role: "user", kind: "message",
      text: state.request.watchText, phase: "final_answer", approvalId: null, canControl: false, resolved: true });
    if (state.reply) messages.push({ id: state.reply.nativeItemId, turnId: state.reply.nativeTurnId, role: "assistant", kind: "message",
      text: state.reply.reply, phase: "final_answer", approvalId: null, canControl: false, resolved: true });
    return { threadId: CLOUD_PROOF.threadId, title: CLOUD_PROOF.title,
      status: state.request && !state.reply ? "active" : "idle", messages,
      paragraphs: state.reply ? [{ id: state.reply.nativeItemId, text: state.reply.reply, phase: "final_answer" }] : [] };
  }

  publish(deliver: Delivery, includeSnapshot: boolean): Promise<void> {
    if (this.publishing) return this.publishing;
    this.publishing = this.publishNow(deliver, includeSnapshot).finally(() => { this.publishing = null; });
    return this.publishing;
  }

  private async publishNow(deliver: Delivery, includeSnapshot: boolean): Promise<void> {
    if (!await this.approval()) return;
    const { request, accepted, reply } = await this.state();
    if (!request) return;
    const stage = reply ? `reply:${reply.nativeItemId}` : accepted ? "accepted" : "waiting";
    if (stage === this.publishedState || stage === "waiting") return;
    await deliver({ version: 1, kind: "turn.started", requestId: request.requestId, threadId: CLOUD_PROOF.threadId,
      selectionApplied: false, message: "Submitted to this existing cloud task. Its current model settings were kept." });
    if (includeSnapshot) await deliver({ version: 1, kind: "chat.snapshot", ...await this.snapshot(), generatedAt: this.now() });
    if (reply) {
      await deliver({ version: 1, kind: "terminal.completed", eventId: `${CLOUD_PROOF.id}:reply`,
        turnScope: "topLevel", threadId: CLOUD_PROOF.threadId, title: CLOUD_PROOF.title, detail: reply.reply, occurredAt: reply.observedAt });
      try {
        await this.writeOnce("delivery.json", { proofId: CLOUD_PROOF.id, threadId: CLOUD_PROOF.threadId,
          hostId: CLOUD_PROOF.hostId, requestId: request.requestId, nativeTurnId: reply.nativeTurnId,
          nativeItemId: reply.nativeItemId, relayAcceptedAt: this.now(), snapshotIncluded: includeSnapshot,
          watchReceiptVerified: false });
      } catch (error) { if (!isExists(error)) throw error; }
    }
    this.publishedState = stage;
  }

  private async state() {
    const approval = await this.requireApproval();
    const requestData = await this.readJson("request.json");
    const request = requestData === null ? null : proofRequestSchema.parse(requestData);
    if (request && (request.receivedAt < approval.activatedAt || request.receivedAt >= approval.expiresAt))
      throw new Error("Cloud proof request belongs to a different approval window");
    const acceptedData = await this.readJson("accepted.json");
    const accepted = acceptedData === null ? null : proofAcceptedSchema.parse(acceptedData);
    const replyData = await this.readJson("reply.json");
    const reply = replyData === null ? null : proofReplySchema.parse(replyData);
    if ((accepted && accepted.requestId !== request?.requestId) || (reply && reply.requestId !== request?.requestId) || (reply && !accepted))
      throw new Error("Cloud proof reply does not match the Watch request");
    return { request, accepted, reply };
  }

  private async requireApproval() {
    const approval = await this.approval();
    if (!approval) throw new Error("The supervised cloud text proof is not active. No prompt was sent.");
    return approval;
  }

  private async checkDirectory(): Promise<void> {
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
      throw new Error("Cloud proof directory is not private and owned by this user");
  }
}

function isMissing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
function isExists(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "EEXIST"; }
