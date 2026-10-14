import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { it, expect, vi } from "vitest";
import { DesktopCloudReceiver } from "../src/desktop-cloud-receiver.js";
import { desktopCloudPairBinding } from "../src/desktop-cloud-protocol.js";

it("the authenticated native host carries a scoped offer and answer without changing text receipts", async () => {
  const home = await mkdtemp("/tmp/aw-dot-native-host-");
  const dir = join(home, ".agentic-wear"); await mkdir(dir, { mode: 0o700 });
  const pairing = { pairId: "fixture", bridgePublicKey: "fixture", watchPublicKey: "fixture" };
  const namespace = "c".repeat(32), threadId = "dot-fixture", url = "https://chatgpt.com/dots/home", documentId = randomUUID();
  const path = join(dir, "desktop-cloud.json");
  await writeFile(path, JSON.stringify({ version: 1, enabled: true, capability: "a".repeat(64), pairBinding: desktopCloudPairBinding(pairing),
    targets: [{ hostId: "durable", threadId, title: "Fixture Dot", url, dotNamespace: namespace, sendEnabled: true }], reconcileMs: 2000 }), { mode: 0o600 });
  const events: string[] = [], commands: Record<string, unknown>[] = [];
  const receiver = new DesktopCloudReceiver(pairing, async () => {}, () => {}, path, () => {});
  receiver.setVoiceHandlers(async event => { events.push(event.state); }, async () => {});
  await receiver.start();
  const manifest = JSON.parse(await readFile("../browser-receiver/extension/manifest.json", "utf8")) as { key: string };
  const id = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0,32).split("").map(c => String.fromCharCode(97+parseInt(c,16))).join("");
  const child = spawn(process.execPath, [resolve("../browser-receiver/native-host.bundle.mjs"), `chrome-extension://${id}/`], { env: { ...process.env, HOME: home } });
  let bytes = Buffer.alloc(0);
  const write = (value: unknown) => { const body = Buffer.from(JSON.stringify(value)), length = Buffer.alloc(4); length.writeUInt32LE(body.length); child.stdin.write(Buffer.concat([length,body])); };
  child.stdout.on("data", (chunk: Buffer) => {
    bytes = Buffer.concat([bytes,chunk]);
    while (bytes.length >= 4) {
      const length = bytes.readUInt32LE(0); if (bytes.length < length+4) return;
      const value = JSON.parse(bytes.subarray(4,length+4).toString()) as Record<string, unknown>; bytes = bytes.subarray(length+4);
      if (value.kind === "native-voice") commands.push(value);
    }
  });
  try {
    write({ version: 1, kind: "observation", url, documentId, observedAt: Date.now(), extractionMs: 1, identity: namespace,
      visibility: "hidden", blocked: false, inputReady: true, nativeVoice: true,
      turns: [{ id: "fixture-message", role: "user", reply: "Fixture", completed: true, evidence: "response-actions-without-stop" }] });
    await vi.waitFor(() => expect(receiver.nativeVoiceAvailable(threadId)).toBe(true));
    const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111";
    receiver.voiceCommand({ version: 1, kind: "native-voice", action: "start", callId: "fixture-call", threadId, sdp, expiresAt: Date.now()+45000 });
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ url, documentId, callId: "fixture-call", sdp });
    const frame = (state: string, identity = namespace) => ({ version: 1, kind: "native-voice-event", url, documentId, identity,
      event: { callId: "fixture-call", threadId, state, ...(state === "answer" ? { sdp } : {}) } });
    write(frame("accepted")); write(frame("answer")); write(frame("active"));
    await vi.waitFor(() => expect(events).toEqual(["accepted", "answer", "active"]));
    write(frame("failed", "d".repeat(32)));
    await new Promise(resolve => setTimeout(resolve,30));
    expect(events).toHaveLength(3);
  } finally {
    child.kill(); await new Promise<void>(resolve => child.once("exit", () => resolve()));
    await receiver.close(); await rm(home, { recursive: true, force: true });
  }
});
