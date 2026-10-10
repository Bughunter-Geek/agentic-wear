import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChatMessage, ChatSnapshot } from "./app-server-client.js";

export const CLOUD_TEXT_TARGET = {
  threadId: "01a1188b-a850-755b-91ec-717f6182900a",
  hostId: "durable",
  controllerThreadId: "01a11fdb-b3b2-7339-ab0f-73626e775079",
  title: "Extract current Claude instructions",
} as const;
export const safeCloudId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/u);
const contentSchema = z.object({ type: z.string(), text: z.string().optional(),
  codexDelegation: z.object({ sourceThreadId: z.string(), input: z.string() }).optional() }).passthrough();
export const nativeCloudReadSchema = z.object({
  thread: z.object({ id: z.literal(CLOUD_TEXT_TARGET.threadId), hostId: z.literal(CLOUD_TEXT_TARGET.hostId),
    kind: z.literal("codex"), title: z.string(), updatedAt: z.number().optional() }).passthrough(),
  page: z.object({ order: z.enum(["newest_first", "oldest_first"]), nextCursor: z.string().nullable().optional(),
    hasMore: z.boolean().optional() }).passthrough().optional(),
  observation: z.object({ readStartedAt: z.number().int().nonnegative(), readCompletedAt: z.number().int().nonnegative(),
    pageCount: z.number().int().min(1).max(3) }).refine((value) => value.readCompletedAt >= value.readStartedAt).optional(),
  turns: z.array(z.object({ id: safeCloudId, status: z.string(), startedAt: z.number().nullable().optional(),
    completedAt: z.number().nullable().optional(), items: z.array(z.object({ type: z.string(), id: safeCloudId.optional(),
      text: z.string().optional(), phase: z.string().nullable().optional(), content: z.array(contentSchema).optional(),
      ordinal: z.number().int().nonnegative().optional() }).passthrough()),
  }).passthrough()).max(20),
}).passthrough();
export type NativeCloudRead = z.infer<typeof nativeCloudReadSchema>;
export type HistoryMessage = ChatMessage & { startedAt: number; ordinal: number };
export type NativeHistory = {
  title: string; observedAt: number; nativeLatestActivityAt: number; revision: string;
  messages: HistoryMessage[]; active: boolean; hasMore: boolean; nextCursor: string | null;
  /** The wire window stays <=12 for already-running bridge versions. */
  cachedMessages?: HistoryMessage[];
  status?: ChatSnapshot["status"];
  revisionFirstObservedAt?: number;
  revisionObservation?: NativeCloudRead["observation"];
};

export function unwrapNativeCloud(value: unknown): unknown {
  if (value && typeof value === "object" && "content" in value) {
    const result = z.object({ isError: z.boolean().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()) }).parse(value);
    if (result.isError) throw new Error("Native tool rejected the operation");
    const text = result.content.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Native tool returned no structured result");
    return JSON.parse(text) as unknown;
  }
  return value;
}

export function readNativeCloud(value: unknown): NativeCloudRead {
  return nativeCloudReadSchema.parse(unwrapNativeCloud(value));
}

export function nativePrompt(requestId: string, text: string): string {
  return `Message from my paired Pixel Watch [Agentic Wear request ${safeCloudId.parse(requestId)}]:\n\n${text}`;
}

export function userText(item: NativeCloudRead["turns"][number]["items"][number]): string {
  return (item.content ?? []).map((content) => content.codexDelegation?.input ?? content.text ?? "").filter(Boolean).join("\n");
}

export function matchingNativeTurn(data: NativeCloudRead, request: { requestId: string; text: string }, baselineTurnIds: string[]) {
  const prompt = nativePrompt(request.requestId, request.text);
  const matches = data.turns.filter((turn) => !baselineTurnIds.includes(turn.id) && turn.items.some((item) =>
    item.type === "userMessage" && item.content?.some((content) =>
      content.codexDelegation?.sourceThreadId === CLOUD_TEXT_TARGET.controllerThreadId && content.codexDelegation.input === prompt)));
  if (matches.length > 1) throw new Error("More than one native turn matches this Watch request; do not resend");
  return matches[0] ?? null;
}

export function mergeNativeHistory(previous: NativeHistory | null, data: NativeCloudRead, observedAt: number): NativeHistory {
  // Progress is ephemeral. Never let a long run's commentary evict the conversation.
  const messages = new Map((previous?.cachedMessages ?? previous?.messages ?? [])
    .filter((message) => message.role === "user" || message.phase === "final_answer").map((message) => [message.id, message]));
  const progress: HistoryMessage[] = [];
  const turns = data.page?.order === "oldest_first" ? data.turns : [...data.turns].reverse();
  for (const turn of turns) {
    for (const [index, item] of turn.items.entries()) {
      if (!item.id || (item.type !== "userMessage" && item.type !== "agentMessage")) continue;
      if (item.type === "agentMessage" && item.phase !== "commentary" && item.phase !== "final_answer") continue;
      let text = item.type === "userMessage" ? userText(item) : item.text ?? "";
      // Correlate only the known controller's delegation, before hiding its wrapper.
      // A coincidental Desktop prefix or another task's delegation is not a receipt.
      const prefix = item.type === "userMessage"
        ? /^Message from my paired Pixel Watch \[Agentic Wear request ([A-Za-z0-9_.:-]+)\]:\n\n/u.exec(text) : null;
      const watchRequestId = prefix && safeCloudId.safeParse(prefix[1]).success && item.content?.some((content) =>
        content.codexDelegation?.sourceThreadId === CLOUD_TEXT_TARGET.controllerThreadId && content.codexDelegation.input === text)
        ? prefix[1] : undefined;
      text = text.replace(/^Message from my paired Pixel Watch \[Agentic Wear request [A-Za-z0-9_.:-]+\]:\n\n/u, "").trim();
      if (!text) continue;
      if (text.length > 6_000) text = text.slice(0, 5_930) + "\n\n[Message continues in Codex.]";
      const old = messages.get(item.id);
      if (old && old.turnId !== turn.id) throw new Error("Native message identity changed turns");
      const message: HistoryMessage = { id: item.id, turnId: turn.id, role: item.type === "userMessage" ? "user" : "assistant",
        kind: "message", text, ...(watchRequestId ? { watchRequestId } : {}),
        phase: item.phase === "commentary" ? "commentary" : "final_answer",
        approvalId: null, canControl: false, resolved: true, startedAt: toMillis(turn.startedAt ?? 0), ordinal: item.ordinal ?? index };
      if (message.role === "assistant" && message.phase === "commentary") {
        if (turn.status === "inProgress") progress.push(message);
      } else messages.set(item.id, message);
    }
  }
  const cachedMessages = [...messages.values()].sort(compareHistory).slice(-24);
  const latestProgress = progress.sort(compareHistory).at(-1);
  const visible = selectHistoryWindow(cachedMessages, latestProgress);
  const active = data.turns.some((turn) => turn.status === "inProgress");
  const latest = turns.at(-1);
  const status = active ? "active" : latest && ["failed", "interrupted"].includes(latest.status) ? "error" : "idle";
  const title = data.thread.title || CLOUD_TEXT_TARGET.title;
  const revision = createHash("sha256").update(JSON.stringify({ title, status, messages: visible })).digest("hex");
  const unchanged = revision === previous?.revision;
  return { title, active, status, messages: visible, cachedMessages, revision, observedAt,
    revisionFirstObservedAt: unchanged ? previous.revisionFirstObservedAt ?? previous.observedAt : observedAt,
    revisionObservation: unchanged ? previous.revisionObservation : data.observation,
    nativeLatestActivityAt: Math.max(0, ...data.turns.map((turn) => toMillis(turn.completedAt ?? turn.startedAt ?? 0))),
    hasMore: data.page?.hasMore ?? previous?.hasMore ?? false, nextCursor: data.page?.nextCursor ?? null };
}

export function historySnapshot(history: NativeHistory): ChatSnapshot {
  const messages = selectHistoryWindow(history.messages.filter((message) => message.role === "user" || message.phase === "final_answer"),
    history.active ? history.messages.filter((message) => message.role === "assistant" && message.phase === "commentary").sort(compareHistory).at(-1) : undefined)
    .map(({ startedAt: _startedAt, ordinal: _ordinal, ...message }) => message);
  return { threadId: CLOUD_TEXT_TARGET.threadId, title: history.title, status: history.status ?? (history.active ? "active" : "idle"), messages,
    paragraphs: messages.filter((m) => m.role === "assistant").slice(-5).map(({ id, text, phase }) => ({ id, text, phase })) };
}

/** Times a known source observation, never an inferred token-generation time. */
export function historyDeliveryTiming(history: NativeHistory | null, delivery: unknown) {
  const parsed = z.object({ revision: z.string(), relayAcceptedAt: z.number().int().nonnegative(),
    publishStartedAt: z.number().int().nonnegative().optional(),
    publishDurationMs: z.number().nonnegative().optional(),
    trigger: z.enum(["direct", "periodic"]).optional(),
    subscriptionAcceptedAt: z.number().int().nonnegative().optional(),
    subscriptionExpiresAt: z.number().int().nonnegative().optional(),
    callbackLatenessMs: z.number().nonnegative().optional() }).safeParse(delivery);
  if (!history || !parsed.success || parsed.data.revision !== history.revision || !history.revisionObservation) return null;
  const { readStartedAt, readCompletedAt, pageCount } = history.revisionObservation;
  const persistedAt = history.revisionFirstObservedAt ?? history.observedAt;
  const acceptedAt = parsed.data.relayAcceptedAt;
  if (readCompletedAt > persistedAt || persistedAt > acceptedAt) return null;
  const startedAt = parsed.data.publishStartedAt;
  const measuredPublish = startedAt !== undefined && persistedAt <= startedAt && startedAt <= acceptedAt;
  return { source: "native snapshot polling", pageCount,
    sourceReadMs: readCompletedAt - readStartedAt,
    sourceReadCompletedToLocalPersistMs: persistedAt - readCompletedAt,
    localPersistToRelayAcceptedMs: acceptedAt - persistedAt,
    localPersistToPublishStartMs: measuredPublish ? startedAt - persistedAt : null,
    publishToRelayAcceptedMs: measuredPublish ? acceptedAt - startedAt : null,
    publishDurationMs: parsed.data.publishDurationMs ?? null,
    trigger: parsed.data.trigger ?? null,
    subscriptionAcceptedAt: parsed.data.subscriptionAcceptedAt ?? null,
    subscriptionExpiresAt: parsed.data.subscriptionExpiresAt ?? null,
    callbackLatenessMs: parsed.data.callbackLatenessMs ?? null,
    sourceReadCompletedToRelayAcceptedMs: acceptedAt - readCompletedAt,
    nativeGenerationToRelayMs: null, physicalDisplayLatencyMs: null };
}

function compareHistory(a: HistoryMessage, b: HistoryMessage): number {
  return a.startedAt - b.startedAt || a.turnId.localeCompare(b.turnId) || a.ordinal - b.ordinal || a.id.localeCompare(b.id);
}

function selectHistoryWindow(conversation: HistoryMessage[], progress?: HistoryMessage): HistoryMessage[] {
  // Preserve the latest real prompt if the 12-slot boundary would split it from its reply.
  const ordered = [...conversation].sort(compareHistory);
  const selected = ordered.slice(-(progress ? 11 : 12));
  const latestUser = ordered.findLast((message) => message.role === "user");
  if (latestUser && !selected.some((message) => message.id === latestUser.id)) {
    selected.shift();
    selected.push(latestUser);
  }
  return [...selected, ...(progress ? [progress] : [])].sort(compareHistory);
}

export function toMillis(value: number): number { return value < 1e12 ? value * 1000 : value; }
