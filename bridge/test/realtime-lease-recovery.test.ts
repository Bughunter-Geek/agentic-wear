import { describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../src/app-server-client.js";
import { LiveVoice } from "../src/live-voice.js";

type Internals = {
  request: (method: string, params: unknown) => Promise<unknown>;
  handleNotification: (method: string, params: unknown) => Promise<void>;
  realtimeThreads: Set<string>;
  realtimeReleaseAfterTurn: Set<string>;
  releaseRealtimeLease: (threadId: string) => Promise<void>;
};
const task = (status = "idle") => ({ id: "task", preview: "Local QA", updatedAt: 1,
  status: { type: status }, parentThreadId: null, agentRole: null });
const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const client = new AppServerClient(new Set(), async () => {}, async () => {});
  const internals = client as unknown as Internals;
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(async (method: string) => {
    if (method === "thread/read" || method === "thread/resume") return { thread: task() };
    if (method === "thread/unsubscribe") return { status: "unsubscribed" };
    return {};
  });
  internals.request = request;
  return { client, internals, request };
}

describe("voice lease recovery", () => {
  it("releases its ended voice lease even when watch notification delivery fails", async () => {
    const f = fixture();
    f.internals.realtimeThreads.add("task");
    f.client.setRealtimeHandler(async () => { throw new Error("relay disconnected"); });
    await expect(f.internals.handleNotification("thread/realtime/closed", { threadId: "task" }))
      .rejects.toThrow("relay disconnected");
    expect(f.request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "task" });
    expect(f.internals.realtimeThreads.size).toBe(0);
    expect(f.internals.realtimeReleaseAfterTurn.size).toBe(0);
  });

  it("never unsubscribes a foreign writer after a rejected resume", async () => {
    const f = fixture();
    f.request.mockImplementation(async (method: string) => {
      if (method === "thread/resume") throw new Error("thread task already has an active writer");
      return { thread: task("notLoaded") };
    });
    await expect(f.client.startRealtime("task", offer, "sol")).rejects.toThrow("active writer");
    expect(f.request.mock.calls.map(([method]) => method)).toEqual(["thread/read", "thread/resume"]);
    expect(f.internals.realtimeThreads.size).toBe(0);
    expect(f.internals.realtimeReleaseAfterTurn.size).toBe(0);
  });

  it("releases a confirmed closed call after a lost stop acknowledgment", async () => {
    const f = fixture();
    f.internals.realtimeThreads.add("task");
    f.request.mockImplementation(async (method: string) => {
      if (method === "thread/realtime/stop") {
        await f.internals.handleNotification("thread/realtime/closed", { threadId: "task" });
        throw new Error("stop acknowledgment lost");
      }
      if (method === "thread/read") return { thread: task() };
      return { status: "unsubscribed" };
    });
    await expect(f.client.stopRealtime("task")).rejects.toThrow("stop acknowledgment lost");
    expect(f.request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "task" });
    expect(f.internals.realtimeThreads.size).toBe(0);
    expect(f.internals.realtimeReleaseAfterTurn.size).toBe(0);
  });

  it("never releases a foreign closed notification when delivery fails", async () => {
    const f = fixture();
    f.client.setRealtimeHandler(async () => { throw new Error("relay disconnected"); });
    await expect(f.internals.handleNotification("thread/realtime/closed", { threadId: "foreign" }))
      .rejects.toThrow("relay disconnected");
    expect(f.request).not.toHaveBeenCalled();
  });

  it("waits for the old lease release before resuming the same task", async () => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.request.mockImplementation(async (method: string) => {
      if (method === "thread/unsubscribe") return new Promise(resolve => { finish = resolve; });
      if (method === "thread/read" || method === "thread/resume") return { thread: task() };
      return {};
    });
    f.internals.realtimeThreads.add("task");
    const ended = f.internals.releaseRealtimeLease("task");
    await flush();
    const next = f.client.startRealtime("task", offer, "sol");
    await flush();
    expect(f.request.mock.calls.map(([method]) => method)).toEqual(["thread/read", "thread/unsubscribe"]);
    finish({ status: "unsubscribed" });
    await ended;
    await next;
    expect(f.request.mock.calls.map(([method]) => method)).toEqual([
      "thread/read", "thread/unsubscribe", "thread/read", "thread/resume", "mcpServerStatus/list", "thread/realtime/start",
    ]);
    expect(f.internals.realtimeThreads.has("task")).toBe(true);
  });

  it("keeps delegated work alive and refuses a new call while its old lease is active", async () => {
    const f = fixture();
    f.internals.realtimeThreads.add("task");
    f.request.mockImplementation(async () => ({ thread: task("active") }));
    await f.internals.releaseRealtimeLease("task");
    f.request.mockClear();
    await expect(f.client.startRealtime("task", offer, "sol")).rejects.toThrow(/previous voice|busy/iu);
    expect(f.request.mock.calls.map(([method]) => method)).toEqual(["thread/read"]);
    expect(f.internals.realtimeReleaseAfterTurn.has("task")).toBe(true);
  });

  it("duplicate starts share a pending failure and never acknowledge before the first start", async () => {
    let fail!: (error: Error) => void;
    const server = { startRealtime: vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; })),
      stopRealtime: vi.fn(async () => {}) };
    const live = new LiveVoice(server, async () => {});
    const first = live.start("call", "task", offer, "sol");
    const duplicate = live.start("call", "task", offer, "sol");
    let duplicateDone = false;
    void duplicate.then(() => { duplicateDone = true; }, () => {});
    await flush();
    expect(duplicateDone).toBe(false);
    fail(new Error("active writer"));
    await expect(first).rejects.toThrow("active writer");
    await expect(duplicate).rejects.toThrow("active writer");
    expect(server.startRealtime).toHaveBeenCalledTimes(1);
    expect(server.stopRealtime).not.toHaveBeenCalled();
  });
});
