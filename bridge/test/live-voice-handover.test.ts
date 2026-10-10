import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveVoice } from "../src/live-voice.js";

const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe("live voice handover boundaries", () => {
  it("does not repeat an unconfirmed stop after a later client could own the task", async () => {
    let now = 0;
    const server = { startRealtime: vi.fn(async () => {}),
      stopRealtime: vi.fn(async () => { throw new Error("stop acknowledgment lost"); }) };
    const live = new LiveVoice(server, async () => {}, () => now);
    await live.start("watch-call", "shared-task", offer, "sol");
    await expect(live.stop("watch-call")).rejects.toThrow("stop acknowledgment lost");
    // The host may have ended our call despite the lost response. Repeating
    // thread-only stop must not terminate a subsequent phone/desktop call.
    now = 90_000;
    await live.expire();
    await live.expire();
    await expect(live.stop("watch-call")).rejects.toThrow(/confirm|status|ending/iu);
    expect(server.stopRealtime).toHaveBeenCalledTimes(1);
    await expect(live.start("new-watch-call", "shared-task", offer, "sol")).rejects.toThrow();
    await live.notification("thread/realtime/closed", { threadId: "shared-task" });
    await live.start("new-watch-call", "shared-task", offer, "sol");
    expect(server.startRealtime).toHaveBeenCalledTimes(2);
  });

  it("lets a new call end while an old call's relay delivery is still pending", async () => {
    let finishDelivery!: () => void;
    const server = { startRealtime: vi.fn(async () => {}), stopRealtime: vi.fn(async () => {}) };
    const deliver = vi.fn(async (payload: Record<string, unknown> & { version: 1; kind: string }) => {
      if (payload.callId === "old-call") await new Promise<void>(resolve => { finishDelivery = resolve; });
    });
    const live = new LiveVoice(server, deliver);
    await live.start("old-call", "same-task", offer, "sol");
    const oldStop = live.stop("old-call");
    await flush();
    await live.start("new-call", "same-task", offer, "sol");
    const newStop = live.stop("new-call");
    await flush();
    const stopsBeforeOldDelivery = server.stopRealtime.mock.calls.length;
    finishDelivery();
    await Promise.all([oldStop, newStop]);
    expect(stopsBeforeOldDelivery).toBe(2);
    expect(deliver.mock.calls.map(([payload]) => payload.callId)).toEqual(["old-call", "new-call"]);
  });

  it("measures the watch lease with elapsed time across wall-clock jumps", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(1_800_000_000_000);
    const server = { startRealtime: vi.fn(async () => {}), stopRealtime: vi.fn(async () => {}) };
    const live = new LiveVoice(server, async () => {});
    await live.start("call", "task", offer, "sol");
    vi.setSystemTime(1_800_003_600_000);
    await live.expire();
    expect(server.stopRealtime).not.toHaveBeenCalled();
    vi.setSystemTime(1_700_000_000_000);
    await vi.advanceTimersByTimeAsync(45_000);
    await live.expire();
    expect(server.stopRealtime).toHaveBeenCalledExactlyOnceWith("task");
  });
});
