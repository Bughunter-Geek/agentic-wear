import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

type Chat = { id: string; title: string; status: string };
export interface VoiceChatBackend {
  listSessions(): Promise<Chat[]>;
  getChat?(id: string): Promise<Chat>;
  queueVoiceMessage(threadId: string, text: string, messageId: string): Promise<{
    threadId: string; queuedSubmissionId: string;
  }>;
}
const entrySchema = z.object({
  token: z.string().uuid(), sourceThreadId: z.string(), destinationId: z.string(),
  destinationTitle: z.string(), prompt: z.string(), createdAt: z.number(),
  state: z.enum(["prepared", "dispatching", "queued"]),
  queuedSubmissionId: z.string().optional(),
}).strict();
type Entry = z.infer<typeof entrySchema>;
const promptSchema = z.string().trim().min(1).max(12_000);
const tokenSchema = z.string().uuid();
const preparedLifetimeMs = 10 * 60_000;

/** The ledger claims dispatch before RPC; ambiguous errors never trigger a resend. */
export class VoiceChatTools {
  constructor(private readonly backend: VoiceChatBackend,
    private readonly sourceThreadId: string, private readonly ledger: string,
    private readonly now = Date.now) {}

  async find(query: string): Promise<unknown> {
    const q = z.string().trim().min(1).max(200).parse(query).toLocaleLowerCase();
    if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(query.trim()) && this.backend.getChat) {
      const chat = await this.backend.getChat(query.trim());
      return { candidates: chat.id === this.sourceThreadId ? [] : [chat], moreMatches: false };
    }
    const chats = (await this.backend.listSessions()).filter(c => c.id !== this.sourceThreadId);
    const exact = chats.filter(c => c.id === query || c.title.toLocaleLowerCase() === q);
    const candidates = exact.length ? exact : chats.filter(c => c.title.toLocaleLowerCase().includes(q));
    return { candidates: candidates.slice(0, 8), moreMatches: candidates.length > 8,
      instruction: "Ask the user to distinguish multiple matches. Never guess a destination from a partial title." };
  }

  async prepare(destinationId: string, destinationTitle: string, prompt: string): Promise<unknown> {
    prompt = promptSchema.parse(prompt);
    const chat = await this.destination(destinationId, destinationTitle);
    await mkdir(this.ledger, { recursive: true, mode: 0o700 });
    // Repeat preparation uses one durable token, including across process restarts.
    const key = createHash("sha256").update(JSON.stringify([this.sourceThreadId, chat.id, prompt])).digest("hex");
    const path = join(this.ledger, `${key}.json`);
    let entry = await this.readOptional(path);
    if (!entry || (entry.state === "prepared" && this.now() - entry.createdAt > preparedLifetimeMs)) {
      const next: Entry = { token: randomUUID(), sourceThreadId: this.sourceThreadId,
        destinationId: chat.id, destinationTitle: chat.title, prompt, createdAt: this.now(), state: "prepared" };
      // The content key prevents concurrent preparation from minting two send tokens.
      if (!entry) {
        try { await writeFile(path, JSON.stringify(next), { flag: "wx", mode: 0o600 }); entry = next; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; entry = await this.read(path); }
      } else {
        // An expired prepared token stays invalid; use a fresh request after explicit user intent.
        throw new Error("This prepared message expired. Change or restate the message before preparing again.");
      }
    }
    await writeFile(join(this.ledger, `${entry.token}.ref`), key, { mode: 0o600 });
    return { token: entry.token, destinationId: entry.destinationId, destinationTitle: entry.destinationTitle,
      message: entry.prompt, state: entry.state,
      instruction: "Send only when the user has explicitly requested this exact message in the matched destination. A clear original send request is sufficient; ask only if the destination or message is ambiguous. Reuse this token for retries; do not prepare a new message to evade an uncertain or already queued result." };
  }

  async send(token: string, userConfirmed: boolean): Promise<unknown> {
    tokenSchema.parse(token);
    if (userConfirmed !== true) throw new Error("The user must explicitly request this destination and message. Nothing was sent.");
    const key = (await readFile(join(this.ledger, `${token}.ref`), "utf8")).trim();
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("Invalid message ledger reference. Nothing was sent.");
    const path = join(this.ledger, `${key}.json`);
    const entry = await this.read(path);
    if (entry.sourceThreadId !== this.sourceThreadId || entry.token !== token)
      throw new Error("This message belongs to a different voice chat. Nothing was sent.");
    if (entry.state === "queued") return this.accepted(entry);
    if (entry.state === "dispatching") return this.uncertain(entry);
    if (this.now() - entry.createdAt > preparedLifetimeMs) throw new Error("Prepared message expired. Nothing was sent.");
    await this.destination(entry.destinationId, entry.destinationTitle);
    // An atomic persistent claim is never removed: even a crash cannot cause automatic duplicate dispatch.
    try { await writeFile(join(this.ledger, `${token}.claim`), "dispatch claimed", { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const latest = await this.read(path);
      return latest.state === "queued" ? this.accepted(latest) : this.uncertain(latest);
    }
    entry.state = "dispatching";
    await this.save(path, entry);
    try {
      const result = await this.backend.queueVoiceMessage(entry.destinationId,
        `[Agentic Wear / Wear OS voice-mode message]\n${entry.prompt}`, entry.token);
      if (result.threadId !== entry.destinationId) throw new Error("Wrong destination acknowledgment");
      entry.state = "queued";
      entry.queuedSubmissionId = result.queuedSubmissionId;
      await this.save(path, entry);
      return this.accepted(entry);
    } catch {
      return this.uncertain(entry);
    }
  }

  private async destination(id: string, title: string): Promise<Chat> {
    if (id === this.sourceThreadId) throw new Error("Use ordinary voice for this chat; choose another destination.");
    const chat = this.backend.getChat ? await this.backend.getChat(id)
      : (await this.backend.listSessions()).find(c => c.id === id);
    if (!chat) throw new Error("Destination is not an available local Codex chat. Nothing was sent; no replacement chat was created.");
    if (chat.title !== title) throw new Error("Destination title changed or did not match. Find and confirm the chat again. Nothing was sent.");
    if (chat.status === "error") throw new Error("Destination needs recovery. Nothing was sent.");
    return chat;
  }
  private accepted(entry: Entry): unknown {
    return { status: "queued", destinationId: entry.destinationId, destinationTitle: entry.destinationTitle,
      queuedSubmissionId: entry.queuedSubmissionId,
      instruction: "Codex accepted this message into the destination's durable queue. Say queued, not started or completed. The destination's owning client controls execution; an unopened chat may need opening in Codex." };
  }
  private uncertain(entry: Entry): unknown {
    return { status: "delivery_uncertain", destinationId: entry.destinationId, destinationTitle: entry.destinationTitle,
      instruction: "A send was claimed but its acknowledgment could not be confirmed. Do not resend or claim success. Check the destination's queue/history in Codex first." };
  }
  private async read(path: string): Promise<Entry> { return entrySchema.parse(JSON.parse(await readFile(path, "utf8"))); }
  private async readOptional(path: string): Promise<Entry | null> {
    try { return await this.read(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  private async save(path: string, entry: Entry): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
    await rename(temporary, path);
  }
}

export const voiceChatToolDefinitions = [
  { name: "find_local_codex_chats", description: "Find an existing local Codex destination by exact title, distinctive title phrase or ID. Returns IDs and titles. Ask the user to disambiguate multiple matches. This does not send anything or provide cloud/dot access.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { name: "prepare_local_codex_message", description: "Prepare a user-requested message to a chat found by find_local_codex_chats. Supply its exact ID and title. A clear original user request to send the exact content to this destination is sufficient. Ask only for missing content or ambiguous destination. Returns a persistent token; no send occurs.",
    inputSchema: { type: "object", properties: { destinationId: { type: "string" }, destinationTitle: { type: "string" }, message: { type: "string" } }, required: ["destinationId", "destinationTitle", "message"], additionalProperties: false } },
  { name: "send_local_codex_message", description: "Queue the prepared message only when the user explicitly requests that exact message in that destination. userConfirmed is an assistant assertion, not a technical proof of consent. Reuse the prepared token, never recreate it to retry. Report queued only after acknowledgment; delivery_uncertain means check Codex before any further send. Does not take writer ownership, start or interrupt inference, or alter the destination model/permissions.",
    inputSchema: { type: "object", properties: { token: { type: "string" }, userConfirmed: { type: "boolean" } }, required: ["token", "userConfirmed"], additionalProperties: false } },
];
