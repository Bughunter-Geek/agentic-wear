import { describe, expect, it, vi } from "vitest";
import { LiveVoice } from "../src/live-voice.js";
import { watchPayloadSchema } from "../src/schemas.js";
const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
function fixture() {
  const server = { startRealtime: vi.fn(async () => {}), stopRealtime: vi.fn(async () => {}) };
  const send = vi.fn(async (_value: unknown) => {});
  let now = 0;
  return { server, send, live: new LiveVoice(server, send, () => now, () => {}), advance: (ms: number) => { now += ms; } };
}
describe("Codex live WebRTC signaling", () => {
  it("delivers the exact SDP answer for the active call, ignoring other tasks", async () => {
    const f = fixture(); await f.live.start("call", "task", offer, "cove");
    await f.live.notification("thread/realtime/sdp", { threadId: "other", sdp: "private" });
    expect(f.send).not.toHaveBeenCalled();
    await f.live.notification("thread/realtime/sdp", { threadId: "task", sdp: "answer" });
    expect(f.send).toHaveBeenCalledWith({ version: 1, kind: "live.answer", callId: "call", sdp: "answer" });
  });
  it("deduplicates starts and does not let a stale stop end a newer call", async () => {
    const f = fixture(); await f.live.start("call", "task", offer, "cove");
    await f.live.start("call", "task", offer, "cove"); await f.live.stop("old-call");
    expect(f.server.startRealtime).toHaveBeenCalledTimes(1); expect(f.server.stopRealtime).not.toHaveBeenCalled();
    await expect(f.live.start("other", "task", offer, "cove")).rejects.toThrow("Another live");
  });
  it("continues beyond 30 seconds with heartbeats and closes when watch disappears", async () => {
    const f = fixture(); await f.live.start("call", "task", offer, "cove");
    for (let i = 0; i < 12; i++) { f.advance(10_000); f.live.heartbeat("call"); await f.live.expire(); }
    expect(f.server.stopRealtime).not.toHaveBeenCalled();
    f.advance(45_000); await f.live.expire(); expect(f.server.stopRealtime).toHaveBeenCalledWith("task");
    expect(() => f.live.heartbeat("call")).toThrow("ended");
  });
  it("does not cancel somebody else's call on a rejected start", async () => {
    const f = fixture(); f.server.startRealtime.mockRejectedValue(new Error("already active"));
    await expect(f.live.start("call", "task", offer, "cove")).rejects.toThrow("already active");
    expect(f.server.stopRealtime).not.toHaveBeenCalled();
  });
  it("does not infer ownership from another client's broadcast while start is rejected", async () => {
    const f = fixture(); let reject!: (error: Error) => void;
    f.server.startRealtime.mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const started = f.live.start("call", "task", offer, "cove");
    await f.live.notification("thread/realtime/started", { threadId: "task" });
    reject(new Error("already active"));
    await expect(started).rejects.toThrow("already active");
    expect(f.server.stopRealtime).not.toHaveBeenCalled();
  });
  it("waits for an in-flight start before ending it so negotiation cannot orphan a call", async () => {
    const f = fixture(); let ready!: () => void;
    f.server.startRealtime.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    const start = f.live.start("call", "task", offer, "cove"); const stop = f.live.stop("call");
    expect(f.server.stopRealtime).not.toHaveBeenCalled(); ready(); await start; await stop;
    expect(f.server.stopRealtime).toHaveBeenCalledTimes(1);
  });
  it("coalesces simultaneous explicit stop and watchdog expiry", async () => {
    const f = fixture(); await f.live.start("call", "task", offer, "cove");
    let finish!: () => void;
    f.server.stopRealtime.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    f.advance(45_000);
    const stop = f.live.stop("call"); const expire = f.live.expire();
    await Promise.resolve(); finish(); await stop; await expire;
    expect(f.server.stopRealtime).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("ends a failed session explicitly and suppresses unknown/raw/audio events", async () => {
    const f = fixture(); await f.live.start("call", "task", offer, "cove");
    await f.live.notification("thread/realtime/outputAudio/delta", { threadId: "task", audio: "data" });
    expect(f.send).not.toHaveBeenCalled();
    await f.live.notification("thread/realtime/error", { threadId: "task", message: "secret" });
    expect(JSON.stringify(f.send.mock.calls)).not.toContain("secret");
    await f.live.stop("call");
    await f.live.notification("thread/realtime/sdp", { threadId: "task", sdp: "late" });
    expect(f.send.mock.calls.filter(([p]) => (p as {kind: string}).kind === "live.answer")).toHaveLength(0);
  });
  it("bounds signaling and rejects PCM/audio injection or malformed offers", async () => {
    const f = fixture(); await expect(f.live.start("call", "task", "invalid", "cove")).rejects.toThrow("offer");
    expect(watchPayloadSchema.safeParse({ version: 1, kind: "live.start", requestId: "req", callId: "call", threadId: "task", voice: "cove", sdp: offer }).success).toBe(true);
    expect(watchPayloadSchema.safeParse({ version: 1, kind: "live.start", requestId: "req", callId: "call", threadId: "task", voice: "cove", sdp: offer, audio: "raw" }).success).toBe(false);
  });
});

describe("Watch voice trace", () => {
  it("accepts metadata-only trace events and rejects free text", () => {
    const base = { version: 1, kind: "live.trace", requestId: "r1", callId: "c1" };
    expect(watchPayloadSchema.safeParse({ ...base, events: [
      { stage: "NETWORK_READY", elapsedMs: 412, callHash: "0123456789ab", threadHash: "ba9876543210", state: "WIFI" },
      { stage: "OFFER_READY", elapsedMs: 900, count: 2 },
    ] }).success).toBe(true);
    expect(watchPayloadSchema.safeParse({ ...base, events: [{ stage: "END", elapsedMs: 1, state: "No network: 192.168.0.2" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, events: [{ stage: "END", elapsedMs: 1, sdp: "v=0" }] }).success).toBe(false);
  });
});

describe("Watch notification trace", () => {
  const base = {
    version: 1, kind: "notify.trace", requestId: "r1",
    pushReceivedAt: 1_787_900_001_000, fetchStartedAt: 1_787_900_001_050, fetchCompletedAt: 1_787_900_001_400,
  };
  const alert = { eventId: "turn:0198-thread:0198-turn:completed", decision: "posted", decidedAt: 1_787_900_001_450 };

  it("accepts push, fetch and per-alert decision timings", () => {
    expect(watchPayloadSchema.safeParse({ ...base, alerts: [] }).success).toBe(true);
    expect(watchPayloadSchema.safeParse({ ...base, alerts: [alert] }).success).toBe(true);
    for (const decision of ["posted", "duplicate", "suppressed_notify_off", "suppressed_before_foreground"]) {
      expect(watchPayloadSchema.safeParse({ ...base, alerts: [{ ...alert, decision }] }).success).toBe(true);
    }
    // The longest event id the bridge can produce (128-char thread and turn ids) fits.
    const longest = `turn:${"t".repeat(128)}:${"u".repeat(128)}:interrupted`;
    expect(watchPayloadSchema.safeParse({ ...base, alerts: [{ ...alert, eventId: longest }] }).success).toBe(true);
  });

  it("rejects free text, extra fields, bad numbers and oversize batches", () => {
    expect(watchPayloadSchema.safeParse({ ...base, alerts: [{ ...alert, decision: "The agent finished its work" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, alerts: [{ ...alert, title: "Private chat" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, alerts: [{ ...alert, detail: "reply text" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, alerts: [], message: "reply text" }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, alerts: [{ eventId: alert.eventId, decision: "posted" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, pushReceivedAt: -1, alerts: [] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, fetchStartedAt: 1.5, alerts: [] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, fetchCompletedAt: "1787900001400", alerts: [] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, alerts: [{ ...alert, eventId: "e".repeat(301) }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, alerts: Array.from({ length: 11 }, () => alert) }).success).toBe(false);
    const { pushReceivedAt: _omitted, ...withoutPush } = base;
    expect(watchPayloadSchema.safeParse({ ...withoutPush, alerts: [] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base }).success).toBe(false);
  });

  it("accepts the push fetch attempt when present and when an older Watch omits it", () => {
    expect(watchPayloadSchema.safeParse({ ...base, alerts: [alert] }).success).toBe(true);
    for (const fetchAttempt of [1, 2, 4, 10]) {
      expect(watchPayloadSchema.safeParse({ ...base, fetchAttempt, alerts: [alert] }).success).toBe(true);
    }
    for (const fetchAttempt of [0, -1, 11, 1.5, "2", null]) {
      expect(watchPayloadSchema.safeParse({ ...base, fetchAttempt, alerts: [alert] }).success).toBe(false);
    }
  });
});

describe("Watch relay failure log", () => {
  const base = { version: 1, kind: "relay.failures", requestId: "r1" };
  const failure = { op: "fetchInbox", status: 503, errorClass: "RelayException", at: 1_787_900_001_000 };

  it("accepts metadata-only failures for every operation, including transport errors without a status", () => {
    expect(watchPayloadSchema.safeParse({ ...base, failures: [] }).success).toBe(true);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [failure] }).success).toBe(true);
    for (const op of ["pairing", "sendToBridge", "fetchInbox", "acknowledge", "fcmRegistration"]) {
      expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, op }] }).success).toBe(true);
    }
    for (const status of [0, 401, 599]) {
      expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, status }] }).success).toBe(true);
    }
    for (const errorClass of ["SocketTimeoutException", "UnknownHostException", "java.net.SocketException", "Outer$Inner", "a".repeat(80)]) {
      expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, errorClass }] }).success).toBe(true);
    }
    expect(watchPayloadSchema.safeParse({ ...base, failures: Array.from({ length: 20 }, () => failure) }).success).toBe(true);
  });

  it("rejects free text, extra fields, bad numbers and oversize batches", () => {
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, op: "https://relay.example/v1/pairs/secret/inbox" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, op: "somethingElse" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, errorClass: "Relay request failed" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, errorClass: "" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, errorClass: "a".repeat(81) }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, message: "Relay request failed" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, url: "https://relay.example" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, status: -1 }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, status: 600 }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, status: 50.5 }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, status: "503" }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, at: -1 }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ ...failure, at: 1.5 }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [{ op: failure.op, status: failure.status, errorClass: failure.errorClass }] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: Array.from({ length: 21 }, () => failure) }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, failures: [], message: "reply text" }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, version: 2, failures: [] }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, requestId: "bad id with spaces", failures: [] }).success).toBe(false);
  });
});
