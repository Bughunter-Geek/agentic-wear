import { describe, it, expect } from "vitest";
import { NativeDotVoice, type NativeDotConnection } from "../src/native-dot-voice.js";
import { nativeVoiceEventSchema, type NativeVoiceCommand } from "../src/native-dot-protocol.js";

const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111";
function fixture() {
  let now = 1000, connected = true;
  const commands: NativeVoiceCommand[] = [], delivered: Record<string, unknown>[] = [], timing: Record<string, unknown>[] = [];
  const browser: NativeDotConnection = {
    configuredDot: id => id === "dot" ? { title: "Your Dot" } : null,
    nativeVoiceAvailable: () => connected,
    voiceCommand: command => { if (!connected) throw new Error("Disconnected"); commands.push(command); },
  };
  const voice = new NativeDotVoice(browser, async payload => { delivered.push(payload); }, () => now, fields => { timing.push({ ...fields }); });
  return { voice, commands, delivered, timing, advance(ms: number) { now += ms; }, disconnect() { connected = false; } };
}
describe("native Dot media delegation", () => {
  it("dispatches start without waiting for the peer messages needed to connect", async () => {
    const f = fixture(); f.voice.start("first", "dot", sdp);
    expect(f.commands[0]?.action).toBe("start");
    f.voice.transport("first", { seq: 1, peerState: "connecting", iceState: "checking", channelState: "connecting" });
    expect(f.commands.at(-1)?.action).toBe("transport");
    await f.voice.event({ callId: "first", threadId: "dot", state: "active" });
    expect(f.delivered).toEqual([]);
    await f.voice.event({ callId: "first", threadId: "dot", state: "accepted" });
    await f.voice.event({ callId: "first", threadId: "dot", state: "answer", sdp });
    await f.voice.event({ callId: "first", threadId: "dot", state: "active" });
    expect(f.delivered.map(value => value.kind)).toEqual(["live.answer", "live.ready"]);
  });
  it("suppresses repeated start, answer, ready and old transport states", async () => {
    const f = fixture(); f.voice.start("first", "dot", sdp); f.voice.start("first", "dot", sdp);
    expect(f.commands).toHaveLength(1);
    await f.voice.event({ callId: "first", threadId: "dot", state: "accepted" });
    for (let i = 0; i < 2; i++) await f.voice.event({ callId: "first", threadId: "dot", state: "answer", sdp });
    for (let i = 0; i < 2; i++) await f.voice.event({ callId: "first", threadId: "dot", state: "active" });
    expect(f.delivered).toHaveLength(2);
    f.voice.transport("first", { seq: 2, peerState: "connected", iceState: "connected", channelState: "open" });
    f.voice.transport("first", { seq: 1, peerState: "connecting", iceState: "checking", channelState: "connecting" });
    expect(f.commands).toHaveLength(2);
  });
  it("stale stop/events cannot affect a newer call", async () => {
    const f = fixture(); f.voice.start("first", "dot", sdp); await f.voice.stop("first"); f.voice.start("second", "dot", sdp);
    await f.voice.stop("first");
    await f.voice.event({ callId: "first", threadId: "dot", state: "failed" });
    expect(f.voice.owns("second")).toBe(true);
    expect(f.commands.filter(value => value.action === "stop")).toHaveLength(1);
  });
  it("expiry and disconnected-browser cleanup release only the current owned call", async () => {
    const f = fixture(); f.voice.start("first", "dot", sdp); f.advance(45000); await f.voice.expire();
    expect(f.voice.active).toBe(false);
    expect(f.delivered.at(-1)?.kind).toBe("live.closed");
    f.voice.start("second", "dot", sdp); f.disconnect(); await f.voice.disconnected();
    expect(f.voice.active).toBe(false);
  });
  it("unconfigured targets and wrong call/target replies are rejected without exposing messages", async () => {
    const f = fixture(); expect(() => f.voice.start("first", "other", sdp)).toThrow();
    f.voice.start("first", "dot", sdp);
    await f.voice.event({ callId: "foreign", threadId: "dot", state: "answer", sdp });
    await f.voice.event({ callId: "first", threadId: "other", state: "failed" });
    expect(f.delivered).toEqual([]);
    expect(nativeVoiceEventSchema.safeParse({ callId: "first", threadId: "dot", state: "failed", message: "PRIVATE_TOKEN" }).success).toBe(false);
  });
  it("separates browser startup and relay delivery timing without logging SDP or arbitrary page data", async () => {
    const f = fixture(); f.voice.start("first", "dot", sdp);
    f.advance(10); await f.voice.event({ callId: "first", threadId: "dot", state: "accepted", elapsedMs: 0 });
    f.advance(400); await f.voice.event({ callId: "first", threadId: "dot", state: "answer", sdp, elapsedMs: 300,
      setupTiming: { captureMs: 20, peerMs: 50, createStartMs: 55, createEndMs: 299 } });
    expect(f.timing.find(value => value.stage === "browser.answer")).toMatchObject({ sinceStartMs: 410, browserElapsedMs: 300,
      setupTiming: { captureMs: 20, peerMs: 50, createStartMs: 55, createEndMs: 299 } });
    expect(f.timing.at(-1)?.stage).toBe("relay.answer.accepted");
    expect(JSON.stringify(f.timing)).not.toContain(sdp);
    expect(nativeVoiceEventSchema.safeParse({ callId: "first", threadId: "dot", state: "accepted",
      setupTiming: { token: "PRIVATE_TOKEN" } }).success).toBe(false);
    expect(nativeVoiceEventSchema.safeParse({ callId: "first", threadId: "dot", state: "accepted", elapsedMs: -1 }).success).toBe(false);
  });
  it("records only bounded HTTP durations and does not turn a timing report into call readiness", async () => {
    const f = fixture(); f.voice.start("first", "dot", sdp);
    const event = { callId: "first", threadId: "dot", state: "timing", elapsedMs: 16000, allocationMode: "instant",
      httpTiming: { phase: "create", totalMs: 16000, responseWaitMs: 15000, allocationMode: "instant", statusCode: 201 } };
    await f.voice.event(nativeVoiceEventSchema.parse(event));
    expect(f.timing.at(-1)).toMatchObject({ stage: "browser.http.create", httpTiming: event.httpTiming });
    expect(f.delivered).toEqual([]);
    for (const httpTiming of [{ ...event.httpTiming, url: "PRIVATE_URL" }, { ...event.httpTiming, totalMs: -1 },
      { ...event.httpTiming, responseWaitMs: 120001 }, { ...event.httpTiming, serverMs: "PRIVATE_HEADER" }])
      expect(nativeVoiceEventSchema.safeParse({ ...event, httpTiming }).success).toBe(false);
    expect(nativeVoiceEventSchema.safeParse({ ...event, httpTiming: undefined }).success).toBe(false);
    expect(nativeVoiceEventSchema.safeParse({ ...event, state: "active" }).success).toBe(false);
    expect(nativeVoiceEventSchema.safeParse({ ...event, allocationMode: "PRIVATE_MODE" }).success).toBe(false);
    await f.voice.stop("first"); f.voice.start("second", "dot", sdp);
    const count = f.timing.length;
    await f.voice.event(nativeVoiceEventSchema.parse(event));
    expect(f.timing).toHaveLength(count);
  });
  it("records native control and media checkpoints without treating them as readiness", async () => {
    const f = fixture(); f.voice.start("first", "dot", sdp);
    for (const progressStage of ["control-clicked", "cleanup", "capture", "peer"] as const) {
      await f.voice.event(nativeVoiceEventSchema.parse({ callId: "first", threadId: "dot", state: "progress", progressStage }));
      expect(f.timing.at(-1)?.stage).toBe(`browser.startup.${progressStage}`);
    }
    expect(f.delivered).toEqual([]);
    expect(nativeVoiceEventSchema.safeParse({ callId: "first", threadId: "dot", state: "progress" }).success).toBe(false);
    expect(nativeVoiceEventSchema.safeParse({ callId: "first", threadId: "dot", state: "progress", progressStage: "PRIVATE_ERROR" }).success).toBe(false);
    expect(nativeVoiceEventSchema.safeParse({ callId: "first", threadId: "dot", state: "accepted", progressStage: "capture" }).success).toBe(false);
  });
  it("distinguishes previous-call cleanup failures and the actor that ended a call", async () => {
    const f = fixture(); f.voice.start("first", "dot", sdp);
    await f.voice.event({ callId: "first", threadId: "dot", state: "failed", statusCode: 503, setupTiming: { cleanupStartMs: 1 } });
    expect(f.delivered.at(-1)).toMatchObject({ kind: "live.closed", reason: "Chrome could not finish closing the previous Lumen call. Retry after it has closed." });
    expect(f.timing.at(-1)).toMatchObject({ stage: "call.closed", endReason: "native" });
    f.voice.start("second", "dot", sdp); await f.voice.stop("second");
    expect(f.timing.at(-1)).toMatchObject({ endReason: "watch" });
  });
});
