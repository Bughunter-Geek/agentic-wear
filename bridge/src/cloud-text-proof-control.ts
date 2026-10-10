import { mkdir, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { CLOUD_PROOF, CLOUD_PROOF_PROMPT_SHA, CloudTextProof, cloudProofDirectory,
  proofAcceptedSchema, proofClaimSchema, proofReplySchema, proofRequestSchema } from "./cloud-text-proof.js";

const identity = { proofId: CLOUD_PROOF.id, threadId: CLOUD_PROOF.threadId, hostId: CLOUD_PROOF.hostId };
const nativeReadSchema = z.object({
  thread: z.object({ id: z.literal(CLOUD_PROOF.threadId), hostId: z.literal(CLOUD_PROOF.hostId), kind: z.literal("codex") }),
  turns: z.array(z.object({ id: z.string(), status: z.string(), completedAt: z.number().nullable().optional(),
    items: z.array(z.object({ type: z.string(), id: z.string().optional(), text: z.string().optional(), phase: z.string().nullable().optional() }).passthrough()),
  }).passthrough()).max(20),
}).passthrough();

export function unwrapNative(value: unknown): unknown {
  if (value && typeof value === "object" && "content" in value) {
    const envelope = z.object({ isError: z.boolean().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()) }).parse(value);
    if (envelope.isError) throw new Error("Native tool rejected the operation");
    const text = envelope.content.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Native tool returned no structured text");
    return JSON.parse(text) as unknown;
  }
  return value;
}

export function verifiedReply(value: unknown, baselineTurnIds: string[], requestedAt: number) {
  const data = nativeReadSchema.parse(unwrapNative(value));
  for (const turn of data.turns) {
    if (turn.status !== "completed" || baselineTurnIds.includes(turn.id) || turn.completedAt == null) continue;
    const completedAt = turn.completedAt < 1e12 ? turn.completedAt * 1000 : turn.completedAt;
    if (completedAt < requestedAt) continue;
    const item = turn.items.find((candidate) => candidate.type === "agentMessage" && candidate.phase === "final_answer" &&
      (candidate.text?.trim() === CLOUD_PROOF.acknowledgement || candidate.text?.trim() === `${CLOUD_PROOF.acknowledgement}.`) && candidate.id);
    if (item?.id) return { nativeTurnId: turn.id, nativeItemId: item.id, reply: CLOUD_PROOF.acknowledgement };
  }
  throw new Error("No new completed native final acknowledgement matches this Watch proof");
}

async function inputJson(path: string | undefined): Promise<unknown> {
  if (!path) throw new Error("Pass the saved native tool result JSON path");
  if ((await stat(path)).size > 4 * 1024 * 1024) throw new Error("Native result exceeds the bounded proof input");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function control(command: string, input: string | undefined, proof = new CloudTextProof()) {
  if (command === "activate") {
    await mkdir(proof.directory, { recursive: true, mode: 0o700 });
    const now = Date.now();
    await proof.writeOnce("approval.json", { ...identity, enabled: true, activatedAt: now, expiresAt: now + 30 * 60_000 });
    return { active: true, expiresAt: new Date(now + 30 * 60_000).toISOString(), target: CLOUD_PROOF.title, watchText: CLOUD_PROOF.watchText };
  }
  if (command === "disable") {
    if (!await proof.readJson("disabled.json")) await proof.writeOnce("disabled.json", { disabledAt: Date.now() });
    return { active: false, filesPreserved: true };
  }
  const approval = await proof.approval();
  if (command === "status") {
    if (!approval) return { active: false };
    const request = await proof.readJson("request.json");
    return { active: true, expiresAt: new Date(approval.expiresAt).toISOString(),
      watchRequestPresent: request !== null, requestId: request ? proofRequestSchema.parse(request).requestId : null,
      claimed: await proof.readJson("claim.json") !== null, nativeAccepted: await proof.readJson("accepted.json") !== null,
      nativeReplyVerified: await proof.readJson("reply.json") !== null,
      replyAcceptedByWatchRelay: await proof.readJson("delivery.json") !== null, watchReceiptStillUnverified: true };
  }
  if (!approval) throw new Error("Cloud proof is disabled or expired");
  const request = proofRequestSchema.parse(await proof.readJson("request.json"));
  if (request.receivedAt < approval.activatedAt || request.receivedAt >= approval.expiresAt) throw new Error("Watch request is outside this approval window");
  if (command === "claim") {
    const baseline = nativeReadSchema.parse(unwrapNative(await inputJson(input)));
    await proof.writeOnce("claim.json", proofClaimSchema.parse({ ...identity, requestId: request.requestId,
      claimedAt: Date.now(), baselineTurnIds: baseline.turns.map((turn) => turn.id) }));
    return { oneTimeDispatch: true, watchRequestId: request.requestId, tool: "send_message_to_thread",
      arguments: { threadId: CLOUD_PROOF.threadId, hostId: CLOUD_PROOF.hostId, prompt: request.nativePrompt },
      noAutomaticRetry: true, modelOverrides: "omitted" };
  }
  const claim = proofClaimSchema.parse(await proof.readJson("claim.json"));
  if (claim.requestId !== request.requestId) throw new Error("Claim does not match the Watch request");
  if (command === "accepted") {
    z.object({ threadId: z.literal(CLOUD_PROOF.threadId) }).parse(unwrapNative(await inputJson(input)));
    await proof.writeOnce("accepted.json", { ...identity, requestId: request.requestId, acceptedAt: Date.now() });
    return { nativeAccepted: true, watchReplyStillUnverified: true };
  }
  if (command === "complete") {
    const accepted = proofAcceptedSchema.parse(await proof.readJson("accepted.json"));
    if (accepted.requestId !== request.requestId) throw new Error("Native acceptance does not match the Watch request");
    const reply = verifiedReply(await inputJson(input), claim.baselineTurnIds, request.receivedAt);
    await proof.writeOnce("reply.json", proofReplySchema.parse({ ...identity, requestId: request.requestId,
      promptSha256: CLOUD_PROOF_PROMPT_SHA, ...reply, observedAt: Date.now() }));
    return { nativeReplyVerified: true, nativeTurnId: reply.nativeTurnId, reply: reply.reply, watchReceiptStillUnverified: true };
  }
  throw new Error("Use activate, status, claim <baseline>, accepted <send-result>, complete <read-result>, or disable");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  control(process.argv[2] ?? "status", process.argv[3], new CloudTextProof(cloudProofDirectory()))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Cloud proof operation failed"); process.exitCode = 1; });
}
