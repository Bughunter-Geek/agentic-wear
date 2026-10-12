import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { DesktopCloudReceiver } from "../src/desktop-cloud-receiver.js";
import { DesktopCloudTransport } from "../src/desktop-cloud-adapter.js";
import { cloudEventId, desktopCloudPairBinding, desktopCloudSocketPath, type DesktopCloudConfig } from "../src/desktop-cloud-protocol.js";

function gate() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); return { wait, release }; }

describe("native voice admission alongside cloud notifications", () => {
  it("does not block ordered voice events behind a slow alert, and still matches both lanes' acknowledgements", async () => {
    const home = await mkdtemp("/tmp/aw-native-priority-"); const path = join(home, "desktop-cloud.json");
    const pairing = { pairId: "fixture", bridgePublicKey: "fixture", watchPublicKey: "fixture" };
    const threadId = "dot-fixture";
    const config: DesktopCloudConfig = { version: 1, enabled: true, capability: "a".repeat(64), pairBinding: desktopCloudPairBinding(pairing),
      targets: [{ hostId: "durable", threadId, title: "Fixture Dot", url: "https://chatgpt.com/dots/home", dotNamespace: "c".repeat(32), sendEnabled: true }], reconcileMs: 2000 };
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    const alert = gate(), answer = gate(); let alertStarted = false, answerStarted = false;
    const events: string[] = [], disconnected = vi.fn();
    const receiver = new DesktopCloudReceiver(pairing, async () => { alertStarted = true; await alert.wait; }, () => {}, path, () => {});
    receiver.setVoiceHandlers(async event => {
      if (event.state === "answer") { answerStarted = true; await answer.wait; }
      events.push(event.state);
    }, async () => { disconnected(); });
    await receiver.start();
    const transport = new DesktopCloudTransport(config, desktopCloudSocketPath(path), () => {});
    try {
      expect(transport.connected).toBe(false);
      transport.start();
      transport.snapshot({ threadId, title: "Fixture", status: "idle", nativeVoice: true, messages: [] }, Date.now());
      await vi.waitFor(() => expect(receiver.nativeVoiceAvailable(threadId)).toBe(true));
      await vi.waitFor(() => expect(transport.connected).toBe(true));
      const now = Date.now();
      transport.terminal({ eventId: cloudEventId(threadId, "turn", "terminal.completed"), threadId, turnId: "turn", kind: "terminal.completed",
        turnScope: "topLevel", title: "Fixture", detail: "Fixture reply", occurredAt: now, observedAt: now, nativeCompletedAt: null, source: "browser-ui" });
      await vi.waitFor(() => expect(alertStarted).toBe(true));
      transport.voiceEvent({ callId: "call", threadId, state: "accepted" });
      await vi.waitFor(() => expect(events).toEqual(["accepted"]));
      transport.voiceEvent({ callId: "call", threadId, state: "answer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111" });
      transport.voiceEvent({ callId: "call", threadId, state: "active" });
      await vi.waitFor(() => expect(answerStarted).toBe(true));
      expect(events).toEqual(["accepted"]); answer.release();
      await vi.waitFor(() => expect(events).toEqual(["accepted", "answer", "active"]));
      // The blocked alert still owns the normal acknowledgement. Completing
      // it must allow the next snapshot; voice acks cannot retire its frame.
      transport.snapshot({ threadId, title: "After alert", status: "idle", nativeVoice: true, messages: [] }, Date.now());
      alert.release();
      await vi.waitFor(() => expect(receiver.sessions()[0]?.title).toBe("Fixture Dot"));
      await vi.waitFor(() => expect(receiver.snapshot(threadId).title).toBe("After alert"));
      expect(disconnected).not.toHaveBeenCalled();
    } finally {
      alert.release(); answer.release(); transport.close(); expect(transport.connected).toBe(false);
      await receiver.close(); await rm(home, { recursive: true, force: true });
    }
  });
});
