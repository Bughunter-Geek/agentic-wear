import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAppToolsClient, relaySocketPath } from "../src/codex-app-tools-client.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
  delete process.env.AGENTIC_WEAR_CODEX_RELAY_SOCKET;
});

describe("Codex app relay client", () => {
  it("checks the desktop-owned route before durably dispatching the same-chat turn", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentic-wear-relay-test-"));
    const socketPath = join(directory, "relay.sock");
    let dispatchPrepared = false;
    const methods: string[] = [];
    const server = createServer((socket) => {
      let buffered = "";
      socket.on("data", (chunk) => {
        buffered += chunk.toString("utf8");
        let newline = buffered.indexOf("\n");
        while (newline >= 0) {
          const request = JSON.parse(buffered.slice(0, newline)) as {
            id: string;
            method: string;
            params?: { threadId?: string };
          };
          buffered = buffered.slice(newline + 1);
          methods.push(request.method);
          if (request.method === "native_health") {
            expect(dispatchPrepared).toBe(false);
            socket.write(`${JSON.stringify({ id: request.id, result: { ok: true } })}\n`);
          } else {
            expect(dispatchPrepared).toBe(true);
            socket.write(`${JSON.stringify({
              id: request.id,
              result: { threadId: request.params?.threadId },
            })}\n`);
          }
          newline = buffered.indexOf("\n");
        }
      });
    });
    await new Promise<void>((resolveListen) => server.listen(socketPath, resolveListen));
    cleanup.push(async () => {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await rm(directory, { recursive: true, force: true });
    });
    const client = new CodexAppToolsClient(async () => ({ socketPath }));
    const beforeDispatch = vi.fn(async () => {
      dispatchPrepared = true;
    });

    await client.sendMessageToThread({
      threadId: "thread-1",
      prompt: "watch prompt",
      model: "gpt-5.6-luna",
      thinking: "max",
      requestId: "request-1",
    }, beforeDispatch);

    expect(methods).toEqual(["native_health", "send_message_to_thread"]);
    expect(beforeDispatch).toHaveBeenCalledOnce();
    await client.close();
  });

  it("uses an explicit relay socket override", () => {
    process.env.AGENTIC_WEAR_CODEX_RELAY_SOCKET = "/tmp/agentic-wear-explicit.sock";
    expect(relaySocketPath()).toBe("/tmp/agentic-wear-explicit.sock");
  });
});
