import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayClient } from "../src/relay-client.js";

const registry = vi.hoisted(() => ({ sockets: [] as unknown[] }));
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class Transport extends EventEmitter {
    static OPEN = 1;
    readyState = 0;
    sent: Array<{ type: string; at: number }> = [];
    sendError: Error | undefined;
    constructor() { super(); registry.sockets.push(this); }
    send = vi.fn((message: string, callback?: (error?: Error) => void) => {
      this.sent.push(JSON.parse(message)); callback?.(this.sendError);
    });
    terminate = vi.fn(() => {
      if (this.readyState === 3) return;
      this.readyState = 3; this.emit("close", 1006);
    });
    close = vi.fn((code: number) => { this.readyState = 3; this.emit("close", code); });
  }
  return { default: Transport };
});
type Socket = {
  readyState: number;
  sent: Array<{ type: string; at: number }>;
  sendError?: Error;
  emit: (name: string, ...args: unknown[]) => boolean;
  terminate: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
const controllers: AbortController[] = [];
const runs: Promise<void>[] = [];
function start(onKey = vi.fn(async (_key: string) => {})) {
  const controller = new AbortController(); controllers.push(controller);
  const envelope = vi.fn(async () => {});
  const done = new RelayClient("http://127.0.0.1", "fixture-pair", "fixture-credential")
    .runSocket(controller.signal, envelope, onKey);
  runs.push(done);
  return { controller, done, envelope, onKey, socket: registry.sockets.at(-1) as Socket };
}
function open(socket: Socket) { socket.readyState = 1; socket.emit("open"); }
function message(socket: Socket, value: unknown) { socket.emit("message", Buffer.from(JSON.stringify(value)), false); }
function pong(socket: Socket, at = socket.sent.at(-1)!.at) { message(socket, { type: "pong", at }); }
const paired = { type: "pair.status", paired: true, watchPublicKey: Buffer.alloc(32).toString("base64"), watchProof: "p".repeat(43) };

beforeEach(() => {
  registry.sockets.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  vi.setSystemTime(1_780_000_000_000);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  for (const c of controllers.splice(0)) c.abort();
  await vi.runOnlyPendingTimersAsync();
  await Promise.allSettled(runs.splice(0));
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe("Relay connection lifecycle", () => {
  it("keeps a healthy socket open when each outstanding heartbeat is acknowledged", async () => {
    const f = start(); open(f.socket);
    for (let i = 0; i < 5; i++) { await vi.advanceTimersByTimeAsync(25_000); pong(f.socket); }
    expect(f.socket.sent).toHaveLength(5);
    expect(f.socket.terminate).not.toHaveBeenCalled();
    expect(registry.sockets).toHaveLength(1);
  });
  it("bounds an unresponsive socket and reconnects without replaying application work", async () => {
    const f = start(); open(f.socket);
    await vi.advanceTimersByTimeAsync(74_999);
    expect(f.socket.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.socket.terminate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(registry.sockets).toHaveLength(2);
    expect(f.envelope).not.toHaveBeenCalled(); expect(f.onKey).not.toHaveBeenCalled();
    expect(f.socket.sent).toHaveLength(1);
  });
  it("ignores a previous heartbeat's reply rather than keeping a stalled socket alive", async () => {
    const f = start(); open(f.socket);
    await vi.advanceTimersByTimeAsync(25_000); const first = f.socket.sent[0]!.at; pong(f.socket);
    vi.setSystemTime(first - 25_000);
    await vi.advanceTimersByTimeAsync(25_000); expect(f.socket.sent.at(-1)!.at).toBeGreaterThan(first); pong(f.socket, first);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(f.socket.terminate).toHaveBeenCalledOnce();
  });
  it("handles pong outside the ordered work queue while preserving key-handler order", async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const onKey = vi.fn(async () => { await blocked; });
    const f = start(onKey); open(f.socket); message(f.socket, paired); message(f.socket, paired);
    await Promise.resolve(); expect(onKey).toHaveBeenCalledOnce();
    for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(25_000); pong(f.socket); }
    expect(f.socket.terminate).not.toHaveBeenCalled(); expect(onKey).toHaveBeenCalledOnce();
    release(); await vi.advanceTimersByTimeAsync(0); expect(onKey).toHaveBeenCalledTimes(2);
  });
  it("aborts a connecting socket immediately without a handshake wait or reconnect", async () => {
    const f = start(); f.controller.abort(); await f.done;
    expect(f.socket.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(f.controller.signal, "abort")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(30_000); expect(registry.sockets).toHaveLength(1);
  });
  it("resets reconnect delay after a successful open and ignores late events from the old socket", async () => {
    const f = start(); f.socket.emit("error", new Error("offline"));
    await vi.advanceTimersByTimeAsync(500);
    const second = registry.sockets[1] as Socket; second.emit("error", new Error("offline"));
    await vi.advanceTimersByTimeAsync(1_000);
    const third = registry.sockets[2] as Socket; open(third); third.emit("close", 1006);
    await vi.advanceTimersByTimeAsync(499); expect(registry.sockets).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1); expect(registry.sockets).toHaveLength(4);
    open(f.socket); message(f.socket, paired); await vi.advanceTimersByTimeAsync(0);
    expect(f.onKey).not.toHaveBeenCalled();
  });
  it("bounds backoff at 15 seconds and removes abort listeners across repeated failures", async () => {
    const f = start();
    for (const wait of [500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000]) {
      const old = registry.sockets.at(-1) as Socket; old.emit("error", new Error("offline"));
      await vi.advanceTimersByTimeAsync(0);
      expect(getEventListeners(f.controller.signal, "abort")).toHaveLength(1);
      const count = registry.sockets.length;
      await vi.advanceTimersByTimeAsync(wait - 1); expect(registry.sockets).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1); expect(registry.sockets).toHaveLength(count + 1);
    }
    (registry.sockets.at(-1) as Socket).emit("error", new Error("offline"));
    await vi.advanceTimersByTimeAsync(0); f.controller.abort(); await f.done;
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(f.controller.signal, "abort")).toHaveLength(0);
  });
  it("cleans up heartbeat send failure with a generic diagnostic", async () => {
    const f = start(); open(f.socket); f.socket.sendError = new Error("fixture-private-diagnostic");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(f.socket.terminate).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("Relay heartbeat send failed");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("fixture-private-diagnostic");
  });
  it("rejects invalid frames before handlers and keeps the close reason generic", async () => {
    const f = start(); open(f.socket);
    f.socket.emit("message", Buffer.from("fixture-private-invalid-data"), false);
    expect(f.socket.close).toHaveBeenCalledWith(1008, "Invalid relay message");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.envelope).not.toHaveBeenCalled(); expect(f.onKey).not.toHaveBeenCalled();
  });
  it("uses elapsed monotonic time even if the wall clock jumps backwards", async () => {
    const f = start(); open(f.socket);
    await vi.advanceTimersByTimeAsync(25_000); vi.setSystemTime(1_700_000_000_000);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(f.socket.terminate).toHaveBeenCalledOnce();
  });
});
