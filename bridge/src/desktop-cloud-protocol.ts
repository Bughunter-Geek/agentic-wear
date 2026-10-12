import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { nativeVoiceEventSchema } from "./native-dot-protocol.js";

// Local capability, never a ChatGPT credential. Both ends must opt into the
// same explicit thread allowlist and current authenticated Watch pairing.
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/u);
const time = z.number().int().nonnegative();
export const desktopCloudConfigSchema = z.object({
  version: z.literal(1), enabled: z.boolean(),
  capability: z.string().regex(/^[a-f0-9]{64}$/u),
  pairBinding: z.string().regex(/^[a-f0-9]{64}$/u),
  targets: z.array(z.object({ hostId: z.literal("durable"), threadId: id,
    title: z.string().min(1).max(200), url: z.string().url().max(300).optional(),
    dotNamespace: z.string().regex(/^[a-f0-9]{32}$/u).optional(), sendEnabled: z.boolean().optional() }).strict()).min(1).max(4),
  reconcileMs: z.number().int().min(1_000).max(10_000).default(2_000),
  // Every open https://chatgpt.com/local/<uuid> tab becomes a session. Absent means true.
  autoCloudChats: z.boolean().optional(),
}).strict().refine((value) => new Set(value.targets.map((t) => t.threadId)).size === value.targets.length);
export type DesktopCloudConfig = z.infer<typeof desktopCloudConfigSchema>;
export const MAX_DYNAMIC_CLOUD_CHATS = 8;
export const DYNAMIC_CLOUD_OWN_MS = 10 * 60_000;
export const DEFAULT_CLOUD_CHAT_TITLE = "Codex cloud chat";
const LOCAL_CHAT_URL = /^https:\/\/chatgpt\.com\/local\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Thread id of a valid `https://chatgpt.com/local/<uuid>` URL (no query or hash), else null. */
export function localCloudChatThreadId(url: string): string | null { return LOCAL_CHAT_URL.exec(url)?.[1] ?? null; }
export function isCloudChatUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
export function autoCloudChatsEnabled(config: Pick<DesktopCloudConfig, "autoCloudChats"> | null | undefined): boolean {
  return config?.autoCloudChats !== false;
}
export const CLOUD_FRAME_BYTES = 256 * 1024;
export const CLOUD_MAX_AGE_MS = 60_000;
export function desktopCloudConfigPath(): string { return join(homedir(), ".agentic-wear", "desktop-cloud.json"); }
export function desktopCloudSocketPath(configFile: string): string { return join(dirname(configFile), "desktop-cloud.sock"); }
export function desktopCloudPairBinding(pair: { pairId: string; bridgePublicKey: string; watchPublicKey: string | null }): string {
  return createHash("sha256").update(JSON.stringify([pair.pairId, pair.bridgePublicKey, pair.watchPublicKey])).digest("hex");
}
export async function readPrivateJson(path: string): Promise<unknown | null> {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const stat = await file.stat(), parent = await lstat(dirname(path));
    if (!stat.isFile() || stat.size > CLOUD_FRAME_BYTES || (stat.mode & 0o077) !== 0 ||
        !parent.isDirectory() || (parent.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid?.() || parent.uid !== stat.uid) throw new Error("Cloud receiver files must be private and owned by this user");
    return JSON.parse(await file.readFile("utf8")) as unknown;
  } finally { await file.close(); }
}
export async function readDesktopCloudConfig(path: string): Promise<DesktopCloudConfig | null> {
  const raw = await readPrivateJson(path);
  return raw === null ? null : desktopCloudConfigSchema.parse(raw);
}
export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  try { await rename(temporary, path); }
  finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
}
const cloudModelField = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:/ -]+$/u);
export const cloudSnapshotSchema = z.object({
  threadId: id, title: z.string().max(200), status: z.enum(["active", "idle", "error", "notLoaded"]),
  inputReady: z.boolean().optional(),
  nativeVoice: z.boolean().optional(),
  cloudModel: cloudModelField.optional(), cloudModels: z.array(cloudModelField).max(24).optional(),
  cloudEffort: z.object({ index: z.number().int().min(0).max(9), label: z.string().min(1).max(64) }).strict().optional(),
  cloudEfforts: z.array(z.string().min(1).max(64)).max(10).optional(),
  messages: z.array(z.object({ id, turnId: id, watchRequestId:id.optional(), role: z.enum(["user", "assistant"]),
    kind: z.literal("message"), text: z.string().max(4_000),
    phase: z.enum(["commentary", "final_answer", "unknown"]), approvalId: z.null(),
    canControl: z.literal(false), resolved: z.literal(true) }).strict()).max(20),
}).strict();
export type CloudSnapshot = z.infer<typeof cloudSnapshotSchema>;
export const cloudTerminalSchema = z.object({
  eventId: id, threadId: id, turnId: id, requestId: id.optional(),
  kind: z.enum(["terminal.completed", "terminal.failed", "terminal.interrupted"]),
  turnScope: z.literal("topLevel"), title: z.string().max(200), detail: z.string().max(400),
  occurredAt: time, nativeCompletedAt: time.nullable(), observedAt: time,
  source: z.enum(["notification", "reconcile", "browser-ui"]),
}).strict();
export type CloudTerminal = z.infer<typeof cloudTerminalSchema>;
export function cloudEventId(threadId: string, turnId: string, kind: string): string {
  return `desktop-cloud:${createHash("sha256").update(JSON.stringify([threadId, turnId, kind])).digest("hex")}`;
}
export const cloudSendSchema = z.object({version:z.literal(1), kind:z.literal("send"),
  requestId:id, threadId:id, text:z.string().trim().min(1).max(4000), expiresAt:time, checkOnly:z.boolean().optional(),
  model:cloudModelField.optional(), effortIndex:z.number().int().min(0).max(9).optional()}).strict();
export type CloudSend = z.infer<typeof cloudSendSchema>;
export const cloudSendResultSchema = z.object({requestId:id, threadId:id,
  outcome:z.enum(["accepted","rejected","uncertain"]), messageId:id.optional(), nativeTurnId:id.optional(),
  message:z.string().max(400),
  verifiedSelection:z.object({model:cloudModelField,effortIndex:z.number().int().min(0).max(9).optional(),effortLabel:z.string().min(1).max(64).optional()}).strict().optional()}).strict();
export type CloudSendResult = z.infer<typeof cloudSendResultSchema>;
const frame = { version: z.literal(1), id, streamId: z.string().uuid() };
export const cloudFrameSchema = z.discriminatedUnion("kind", [
  z.object({ ...frame, kind: z.literal("snapshot"), observedAt: time, snapshot: cloudSnapshotSchema }).strict(),
  z.object({ ...frame, kind: z.literal("terminal"), event: cloudTerminalSchema }).strict(),
  z.object({ ...frame, kind: z.literal("reset") }).strict(),
  z.object({ ...frame, kind: z.literal("send-result"), result:cloudSendResultSchema }).strict(),
  z.object({ ...frame, kind: z.literal("native-voice-event"), event: nativeVoiceEventSchema }).strict(),
]);
export type CloudFrame = z.infer<typeof cloudFrameSchema>;
export const cloudHelloSchema = z.object({ version: z.literal(1), kind: z.literal("hello"),
  capability: z.string().length(64), pairBinding: z.string().length(64), streamId: z.string().uuid() }).strict();
export const cloudAckSchema = z.object({ version: z.literal(1), kind: z.literal("ack"), id }).strict();
export type CloudLog = (event: string, fields?: Record<string, string | number | boolean | null>) => void;
export const logDesktopCloud: CloudLog = (event, fields = {}) => console.info(JSON.stringify({
  level: "info", message: `desktop.cloud.${event}`, at: Date.now(), ...fields,
}));
