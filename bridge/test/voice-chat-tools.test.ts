import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceChatTools } from "../src/voice-chat-tools.js";
import { callVoiceChatTool } from "../src/voice-chat-tools-mcp.js";
import { AppServerClient } from "../src/app-server-client.js";
import { voiceChatToolsConfig } from "../src/voice-chat-tools-config.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function setup() {
  const ledger = await mkdtemp(join(tmpdir(), "agentic-voice-chat-unit-")); directories.push(ledger);
  const chats = [{ id: "source", title: "Voice source", status: "idle" },
    { id: "destination", title: "QA destination", status: "active" },
    { id: "another", title: "QA destination", status: "idle" }];
  const backend = { listSessions: vi.fn(async () => chats),
    queueVoiceMessage: vi.fn(async (threadId: string, _text: string, _id: string) => ({ threadId, queuedSubmissionId: "q1" })) };
  let now = 1000;
  const tools = new VoiceChatTools(backend, "source", ledger, () => now);
  return { ledger, chats, backend, tools, advance: (ms: number) => { now += ms; } };
}
async function prepare(tools: VoiceChatTools) {
  return await tools.prepare("destination", "QA destination", "Wear OS voice-mode TEST: queue only.") as { token: string };
}
describe("voice cross-chat message tools", () => {
  it("returns duplicate titles for disambiguation and omits the source", async () => {
    const { tools, backend } = await setup();
    expect(await tools.find("QA destination")).toMatchObject({ candidates: [{ id: "destination" }, { id: "another" }] });
    expect(await tools.find("Voice source")).toMatchObject({ candidates: [] });
    expect(backend.queueVoiceMessage).not.toHaveBeenCalled();
  });
  it("rejects a guessed ID, mismatched title and source without sending", async () => {
    const { tools, backend } = await setup();
    await expect(tools.prepare("missing", "QA destination", "test")).rejects.toThrow("available local");
    await expect(tools.prepare("destination", "wrong", "test")).rejects.toThrow("title changed");
    await expect(tools.prepare("source", "Voice source", "test")).rejects.toThrow("another destination");
    expect(backend.queueVoiceMessage).not.toHaveBeenCalled();
  });
  it("does not send on preparation or without explicit user intent", async () => {
    const { tools, backend } = await setup(); const { token } = await prepare(tools);
    expect(backend.queueVoiceMessage).not.toHaveBeenCalled();
    await expect(tools.send(token, false)).rejects.toThrow("explicitly request");
    expect(backend.queueVoiceMessage).not.toHaveBeenCalled();
  });
  it("persists one token and queues once across concurrent sends and restart", async () => {
    const { tools, backend, ledger } = await setup();
    const [first, second] = await Promise.all([prepare(tools), prepare(tools)]);
    expect(first.token).toBe(second.token);
    const results = await Promise.all([tools.send(first.token, true), tools.send(first.token, true)]);
    expect(results).toContainEqual(expect.objectContaining({ status: "queued", destinationId: "destination" }));
    const restarted = new VoiceChatTools(backend, "source", ledger);
    expect(await restarted.send(first.token, true)).toMatchObject({ status: "queued", queuedSubmissionId: "q1" });
    expect(backend.queueVoiceMessage).toHaveBeenCalledExactlyOnceWith("destination",
      "[Agentic Wear / Wear OS voice-mode message]\nWear OS voice-mode TEST: queue only.", first.token);
    const key = (await readFile(join(ledger, `${first.token}.ref`), "utf8")).trim();
    expect((await stat(join(ledger, `${key}.json`))).mode & 0o777).toBe(0o600);
  });
  it("never resends after a lost acknowledgment even after restart", async () => {
    const { tools, backend, ledger } = await setup();
    backend.queueVoiceMessage.mockRejectedValueOnce(new Error("Disconnected after acceptance"));
    const { token } = await prepare(tools);
    expect(await tools.send(token, true)).toMatchObject({ status: "delivery_uncertain" });
    const restarted = new VoiceChatTools(backend, "source", ledger);
    expect(await restarted.send(token, true)).toMatchObject({ status: "delivery_uncertain" });
    expect(backend.queueVoiceMessage).toHaveBeenCalledTimes(1);
  });
  it("rejects expired, renamed and cross-source tokens before dispatch", async () => {
    const expired = await setup(); const { token } = await prepare(expired.tools);
    expired.advance(600001);
    await expect(expired.tools.send(token, true)).rejects.toThrow("expired");
    expect(expired.backend.queueVoiceMessage).not.toHaveBeenCalled();
    const renamed = await setup(); const p = await prepare(renamed.tools);
    renamed.chats[1]!.title = "Different title";
    await expect(renamed.tools.send(p.token, true)).rejects.toThrow("title changed");
    const other = new VoiceChatTools(renamed.backend, "another-source", renamed.ledger);
    await expect(other.send(p.token, true)).rejects.toThrow("different voice chat");
    expect(renamed.backend.queueVoiceMessage).not.toHaveBeenCalled();
  });
  it("does not claim queued if Codex acknowledges another destination", async () => {
    const { tools, backend } = await setup();
    backend.queueVoiceMessage.mockResolvedValueOnce({ threadId: "wrong", queuedSubmissionId: "q1" });
    const { token } = await prepare(tools);
    expect(await tools.send(token, true)).toMatchObject({ status: "delivery_uncertain" });
  });
  it("uses only read and durable queue RPCs, preserving writer and model", async () => {
    const backend = new AppServerClient(new Set(), async () => {}, async () => {});
    const internals = backend as unknown as { request: ReturnType<typeof vi.fn> };
    internals.request = vi.fn(async (method: string) => method === "thread/read"
      ? { thread: { id: "destination", name: "QA destination", preview: "", updatedAt: 1, status: { type: "notLoaded" } } }
      : { queuedSubmission: { id: "q1", clientUserMessageId: "stable-id" } });
    expect(await backend.queueVoiceMessage("destination", "TEST", "stable-id")).toEqual({ threadId: "destination", queuedSubmissionId: "q1" });
    expect(internals.request.mock.calls.map(c => c[0])).toEqual(["thread/read", "thread/queue/add"]);
    expect(internals.request.mock.calls[1]![1]).toMatchObject({ threadId: "destination", clientUserMessageId: "stable-id" });
    expect(internals.request.mock.calls[1]![1]).not.toHaveProperty("model");
  });
  it("paginates destinations without resuming any chat", async () => {
    const backend = new AppServerClient(new Set(), async () => {}, async () => {});
    const internals = backend as unknown as { request: ReturnType<typeof vi.fn> };
    const thread = (id: string) => ({ id, name: id, preview: "", updatedAt: 1, status: { type: "notLoaded" } });
    internals.request = vi.fn().mockResolvedValueOnce({ data: [thread("a")], nextCursor: "next" })
      .mockResolvedValueOnce({ data: [thread("b")], nextCursor: null });
    expect((await backend.listVoiceChats()).map(c => c.id)).toEqual(["a", "b"]);
    expect(internals.request.mock.calls.map(c => c[0])).toEqual(["thread/list", "thread/list"]);
    expect(internals.request.mock.calls[1]![1]).toMatchObject({ cursor: "next", archived: false });
  });
  it("exposes scoped MCP configuration and rejects extra tool arguments", async () => {
    const { tools } = await setup();
    const config = voiceChatToolsConfig("source");
    expect(config).toMatchObject({ "mcp_servers.agentic_wear_voice_chats": { enabled: true,
      args: expect.arrayContaining(["--source-thread", "source", "--ledger"]) } });
    expect(Object.keys(config)).toEqual(["mcp_servers.agentic_wear_voice_chats"]);
    await expect(callVoiceChatTool(tools, "find_local_codex_chats", { query: "QA", force: true })).rejects.toThrow();
  });
  it("resolves an empty local chat by exact UUID without relying on listing", async () => {
    const { tools, backend, ledger } = await setup();
    const id = "01a10713-7b5d-7633-98d1-4419c7cd387e";
    const getChat = vi.fn(async () => ({ id, title: "Empty QA", status: "idle" }));
    const direct = new VoiceChatTools({ ...backend, getChat }, "source", ledger);
    expect(await direct.find(id)).toMatchObject({ candidates: [{ id, title: "Empty QA" }] });
    expect(getChat).toHaveBeenCalledExactlyOnceWith(id);
    expect(backend.listSessions).not.toHaveBeenCalled();
    expect(await tools.find("QA")).toHaveProperty("candidates");
  });
  it("preserves observed effort and ordinary voice when tool discovery fails", async () => {
    const backend = new AppServerClient(new Set(), async () => {}, async () => {});
    const internals = backend as unknown as { request: ReturnType<typeof vi.fn>; controlledThreads: Set<string> };
    internals.controlledThreads.add("source");
    internals.request = vi.fn(async (method: string) => {
      if (method === "thread/read" || method === "thread/resume") return { thread: {
        id: "source", name: "QA source", updatedAt: 1, reasoningEffort: "medium", status: { type: "idle" },
      } };
      if (method === "thread/unsubscribe") return { status: "unsubscribed" };
      if (method === "mcpServerStatus/list") throw new Error("Catalog unavailable");
      return {};
    });
    await backend.startRealtime("source", "v=0 mock", "sol");
    expect(internals.request.mock.calls.map(c => c[0])).toEqual([
      "thread/read", "thread/unsubscribe", "thread/resume", "mcpServerStatus/list", "thread/realtime/start",
    ]);
    expect(internals.request.mock.calls[2]![1]).toMatchObject({ config: { model_reasoning_effort: "medium" } });
    expect(internals.request.mock.calls[4]![1]).toMatchObject({ voice: "sol", realtimeStartInstructions: expect.stringContaining("unavailable") });
    expect(internals.request.mock.calls[2]![1]).not.toHaveProperty("approvalPolicy");
    expect(internals.request.mock.calls[2]![1]).not.toHaveProperty("sandbox");
  });
});
