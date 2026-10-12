import { describe, it, expect } from "vitest";
import { NativeDotVoice, type NativeDotConnection } from "../src/native-dot-voice.js";
import { nativeVoiceEventSchema, type NativeVoiceCommand } from "../src/native-dot-protocol.js";

const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111";
function fixture() {
  let now = 1000, connected = true;
  const commands: NativeVoiceCommand[] = [], delivered: Record<string, unknown>[] = [];
  const browser: NativeDotConnection = {
    configuredDot: id => id === "dot" ? { title: "Your Dot" } : null,
    nativeVoiceAvailable: () => connected,
    voiceCommand: command => { if (!connected) throw new Error("Disconnected"); commands.push(command); },
  };
  const voice = new NativeDotVoice(browser, async payload => { delivered.push(payload); }, () => now);
  return { voice, commands, delivered, advance(ms: number) { now += ms; }, disconnect() { connected = false; } };
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
});
