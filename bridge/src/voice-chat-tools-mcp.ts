import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AppServerClient } from "./app-server-client.js";
import { VoiceChatTools, voiceChatToolDefinitions } from "./voice-chat-tools.js";

export async function callVoiceChatTool(tools: VoiceChatTools, name: string, args: unknown): Promise<unknown> {
  if (name === "find_local_codex_chats") {
    const p = z.object({ query: z.string() }).strict().parse(args);
    return tools.find(p.query);
  }
  if (name === "prepare_local_codex_message") {
    const p = z.object({ destinationId: z.string(), destinationTitle: z.string(), message: z.string() }).strict().parse(args);
    return tools.prepare(p.destinationId, p.destinationTitle, p.message);
  }
  if (name === "send_local_codex_message") {
    const p = z.object({ token: z.string(), userConfirmed: z.boolean() }).strict().parse(args);
    return tools.send(p.token, p.userConfirmed);
  }
  throw new Error("Unknown Agentic Wear voice chat tool");
}

async function main(): Promise<void> {
  const argument = (name: string) => process.argv[process.argv.indexOf(name) + 1];
  const sourceThreadId = argument("--source-thread");
  const ledger = argument("--ledger");
  if (!sourceThreadId || !ledger || !process.argv.includes("--source-thread") || !process.argv.includes("--ledger"))
    throw new Error("Voice chat tools require their source thread and private ledger");
  const backend = new AppServerClient(new Set(), async () => {}, async () => {});
  let connected: Promise<void> | null = null;
  const connect = () => connected ??= backend.connect("stdio");
  const tools = new VoiceChatTools({
    listSessions: async () => { await connect(); return backend.listVoiceChats(); },
    getChat: async id => { await connect(); return backend.getVoiceChat(id); },
    queueVoiceMessage: async (...args) => { await connect(); return backend.queueVoiceMessage(...args); },
  }, sourceThreadId, ledger);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const stop = () => { lines.close(); void backend.close(); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  let sequence: Promise<void> = Promise.resolve();
  const respond = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const handle = async (line: string) => {
    if (Buffer.byteLength(line) > 64 * 1024) return;
    let request: { id?: string | number; method: string; params?: unknown };
    try { request = z.object({ id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.unknown().optional() }).parse(JSON.parse(line)); }
    catch { respond({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC request" } }); return; }
    if (request.id === undefined) return;
    let result: unknown;
    if (request.method === "initialize") {
      const p = z.object({ protocolVersion: z.string() }).passthrough().safeParse(request.params);
      if (!p.success) {
        respond({ jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Invalid voice chat protocol parameters" } });
        return;
      }
      result = { protocolVersion: p.data.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "agentic-wear-voice-chats", version: "1.0.0" } };
    } else if (request.method === "ping") result = {};
    else if (request.method === "tools/list") result = { tools: voiceChatToolDefinitions };
    else if (request.method === "tools/call") {
      try {
        const p = z.object({ name: z.string(), arguments: z.unknown() }).passthrough().parse(request.params);
        result = { content: [{ type: "text", text: JSON.stringify(await callVoiceChatTool(tools, p.name, p.arguments)) }], isError: false };
      } catch (error) {
        // Validation errors are useful; never return raw backend transport, auth or source dumps.
        const message = error instanceof z.ZodError ? "Invalid voice chat tool arguments. Nothing was sent." :
          error instanceof Error && /Nothing was sent|different voice chat|expired|Unknown Agentic Wear|Invalid message ledger/u.test(error.message)
            ? error.message : "Local Codex chat tools are unavailable. No confirmed delivery; check Codex before retrying.";
        result = { content: [{ type: "text", text: message }], isError: true };
      }
    } else {
      respond({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } }); return;
    }
    respond({ jsonrpc: "2.0", id: request.id, result });
  };
  lines.on("line", line => { sequence = sequence.then(() => handle(line)).catch(() => {
    process.stderr.write("Agentic Wear voice tool request failed\n");
  }); });
  await new Promise<void>(resolveEnd => lines.once("close", resolveEnd));
  await sequence;
  await backend.close();
  process.removeListener("SIGTERM", stop);
  process.removeListener("SIGINT", stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => { process.stderr.write("Agentic Wear voice chat tools could not start\n"); process.exitCode = 1; });
}
