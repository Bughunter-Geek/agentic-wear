import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { RelayClient } from "../src/relay-client.js";

const pairId = "A".repeat(43);
const credential = "c".repeat(40);
let server: WebSocketServer | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

async function startServer(): Promise<{ url: string; connections: () => number }> {
  server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  let count = 0;
  server.on("connection", () => {
    count += 1;
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, connections: () => count };
}

describe("RelayClient socket", () => {
  it("reconnects when a half-open relay socket stops answering pings", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The fake relay accepts the connection but never answers, like a TCP
    // connection that died during macOS sleep.
    const { url, connections } = await startServer();
    const client = new RelayClient(url, pairId, credential, {
      heartbeatMs: 20,
      livenessTimeoutMs: 60,
      initialReconnectMs: 10,
      maxReconnectMs: 20,
    });
    const controller = new AbortController();
    const task = client.runSocket(controller.signal, async () => undefined, async () => undefined);
    await vi.waitFor(() => expect(connections()).toBeGreaterThanOrEqual(2), { timeout: 3_000, interval: 20 });
    controller.abort(new Error("test done"));
    await expect(task).resolves.toBeUndefined();
  });

  it("keeps a responsive connection open", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { url, connections } = await startServer();
    server?.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string; at: number };
        if (message.type === "ping") socket.send(JSON.stringify({ type: "pong", at: message.at }));
      });
    });
    const client = new RelayClient(url, pairId, credential, {
      heartbeatMs: 20,
      livenessTimeoutMs: 80,
      initialReconnectMs: 10,
      maxReconnectMs: 20,
    });
    const controller = new AbortController();
    const task = client.runSocket(controller.signal, async () => undefined, async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(connections()).toBe(1);
    controller.abort(new Error("test done"));
    await expect(task).resolves.toBeUndefined();
  });

  it("stops cleanly when aborted during reconnect back-off and does not leak abort listeners", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Nothing listens on this port, so every attempt fails and the loop backs off.
    const probe = await startServer();
    const deadUrl = probe.url;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    const client = new RelayClient(deadUrl, pairId, credential, { initialReconnectMs: 5, maxReconnectMs: 5 });
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const task = client.runSocket(controller.signal, async () => undefined, async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort(new Error("Bridge stopped"));
    await expect(task).resolves.toBeUndefined();
    // Every listener added for a completed back-off/connection was removed again.
    expect(add.mock.calls.length - remove.mock.calls.length).toBeLessThanOrEqual(2);
    expect(add.mock.calls.length).toBeGreaterThan(4);
  });
});
