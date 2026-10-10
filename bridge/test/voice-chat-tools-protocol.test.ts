import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function exchange(requests: unknown[]): Promise<{ replies: Array<{ id: number; result?: unknown; error?: unknown }>; stderr: string }> {
  const helper = fileURLToPath(new URL("../src/voice-chat-tools-mcp.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", helper, "--source-thread", "protocol-only-qa",
    "--ledger", "/tmp/agentic-wear-protocol-test-unused"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => { if (code === 0) resolve(); else reject(new Error(`MCP helper exited ${code}: ${stderr}`)); });
  });
  child.stdin.end(requests.map(request => JSON.stringify(request)).join("\n") + "\n");
  await exited;
  return { replies: stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { id: number; result?: unknown; error?: unknown }), stderr };
}

describe("voice tool response transport", () => {
  it("returns an error for malformed initialization and still delivers subsequent tool results", async () => {
    const { replies } = await exchange([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-11-25" } },
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "send_local_codex_message", arguments: {} } },
      { jsonrpc: "2.0", id: 5, method: "ping" },
    ]);
    expect(replies.map(reply => reply.id)).toEqual([1, 2, 3, 4, 5]);
    expect(replies[0]).toMatchObject({ error: { code: -32602 } });
    expect(replies[1]).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
    expect(replies[2]).toMatchObject({ result: { tools: expect.arrayContaining([
      expect.objectContaining({ name: "send_local_codex_message" }),
    ]) } });
    expect(replies[3]).toMatchObject({ result: { isError: true, content: [{ type: "text", text: "Invalid voice chat tool arguments. Nothing was sent." }] } });
    expect(replies[4]).toMatchObject({ result: {} });
  });

  it.each([false, true])("delivers the send result over real stdio with lost acknowledgment = %s", async lostAck => {
    const directory = await mkdtemp(join(tmpdir(), "agentic-wear-mcp-result-qa-"));
    const fakeCodex = join(directory, "fake-codex.mjs");
    const attempts = join(directory, "queue-attempts.txt");
    // Only this disposable fake CLI is spawned; no live Codex, audio, model or
    // destination is contacted. The helper still exercises its real RPC pipe.
    await writeFile(fakeCodex, `#!${process.execPath}\n` + `
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const qaThread = { id: "destination", name: "QA destination", preview: "QA", updatedAt: 1, status: { type: "idle" }, parentThreadId: null, agentRole: null };
createInterface({ input: process.stdin }).on("line", line => {
  const p = JSON.parse(line);
  if (p.id === undefined) return;
  let result = {};
  if (p.method === "initialize") result = { userAgent: "codex-cli/0.160.1" };
  else if (p.method === "thread/list") result = { data: [qaThread], nextCursor: null };
  else if (p.method === "thread/read") result = { thread: qaThread };
  else if (p.method === "thread/queue/add") {
    appendFileSync(${JSON.stringify(attempts)}, "one synthetic dispatch\\n");
    if (${lostAck}) process.exit(0);
    result = { queuedSubmission: { id: "qa-queued", clientUserMessageId: p.params.clientUserMessageId, input: [] } };
  }
  process.stdout.write(JSON.stringify({ id: p.id, result }) + "\\n");
});
`, { mode: 0o700 });
    const helper = fileURLToPath(new URL("../src/voice-chat-tools-mcp.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", helper, "--source-thread", "qa-source",
      "--ledger", join(directory, "ledger")], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, AGENTIC_WEAR_CODEX_PATH: fakeCodex } });
    const responses = new Map<number, (value: unknown) => void>();
    let serial = 0;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => {
      const value = JSON.parse(line) as { id: number; result: unknown };
      responses.get(value.id)?.(value.result);
      responses.delete(value.id);
    });
    const request = (method: string, params: unknown) => new Promise<unknown>(resolve => {
      const id = ++serial;
      responses.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    const call = async (name: string, args: unknown) => {
      const result = await request("tools/call", { name, arguments: args }) as { isError: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(false);
      return JSON.parse(result.content[0]!.text) as { token?: string; status?: string; candidates?: unknown[] };
    };
    const exited = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => { if (code === 0) resolve(); else reject(new Error(`QA helper exited ${code}`)); });
    });
    try {
      await request("initialize", { protocolVersion: "2025-11-25" });
      expect(await call("find_local_codex_chats", { query: "QA destination" }))
        .toMatchObject({ candidates: [{ id: "destination", title: "QA destination" }] });
      const prepared = await call("prepare_local_codex_message", { destinationId: "destination",
        destinationTitle: "QA destination", message: "Synthetic MCP result test" });
      const args = { token: prepared.token, userConfirmed: true };
      const expected = { status: lostAck ? "delivery_uncertain" : "queued", destinationId: "destination" };
      expect(await call("send_local_codex_message", args)).toMatchObject(expected);
      expect(await call("send_local_codex_message", args)).toMatchObject(expected);
      expect(await readFile(attempts, "utf8")).toBe("one synthetic dispatch\n");
    } finally {
      child.stdin.end();
      await exited;
      lines.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
