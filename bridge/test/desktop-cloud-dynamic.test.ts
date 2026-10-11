import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopCloudReceiver } from "../src/desktop-cloud-receiver.js";
import { DesktopCloudTransport } from "../src/desktop-cloud-adapter.js";
import { BrowserCloudObservers, browserObservationSchema, type BrowserObservation } from "../src/browser-cloud-observer.js";
import { CLOUD_MAX_AGE_MS, autoCloudChatsEnabled, desktopCloudConfigSchema, desktopCloudPairBinding, desktopCloudSocketPath,
  localCloudChatThreadId, type DesktopCloudConfig } from "../src/desktop-cloud-protocol.js";

const pairing = { pairId: "test-pair", bridgePublicKey: "bridge-public", watchPublicKey: "watch-public" };
const dyn = "01a1188b-a850-755b-91ec-717f6182900b";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup(extra: Partial<DesktopCloudConfig> = {}) {
  const directory = await mkdtemp("/tmp/aw-cloud-dyn-"); await chmod(directory, 0o700);
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "desktop-cloud.json");
  const config: DesktopCloudConfig = { version: 1, enabled: true, capability: "a".repeat(64), pairBinding: desktopCloudPairBinding(pairing),
    targets: [{ hostId: "durable", threadId: "cloud-1", title: "Cloud test", sendEnabled: true },
      { hostId: "durable", threadId: "dot:abc", title: "Lumen", dotNamespace: "a".repeat(32), sendEnabled: true }], reconcileMs: 2_000, ...extra };
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  const receiver = new DesktopCloudReceiver(pairing, async () => {}, vi.fn(), path, vi.fn());
  await receiver.start(); cleanup.push(() => receiver.close());
  const onSend = vi.fn(async (command: { requestId: string; threadId: string }) => ({ requestId: command.requestId, threadId: command.threadId, outcome: "accepted" as const, messageId: "posted", message: "Posted" }));
  const transport = new DesktopCloudTransport(config, desktopCloudSocketPath(path), vi.fn(), onSend);
  cleanup.push(async () => { transport.close(); }); transport.start();
  return { receiver, transport, config, onSend };
}
const snap = (threadId: string, title: string, inputReady = true, status: "idle" | "active" = "idle") => ({ threadId, title, status, inputReady, messages: [] });

describe("dynamic cloud chats in the receiver", () => {
  it("lists, reads and sends to an open local chat, tagging sources", async () => {
    const h = await setup();
    expect(h.receiver.owns(dyn)).toBe(false);
    h.transport.snapshot(snap(dyn, "My cloud task"), Date.now());
    h.transport.snapshot(snap("cloud-1", "Cloud test"), Date.now());
    h.transport.snapshot(snap("dot:abc", "Lumen"), Date.now());
    await vi.waitFor(() => expect(h.receiver.owns(dyn)).toBe(true));
    await vi.waitFor(() => expect(h.receiver.sessions().find((s) => s.id === "dot:abc")?.canAcceptDirectInput).toBe(true));
    const sessions = h.receiver.sessions();
    expect(sessions.map((s) => [s.id, s.source])).toEqual([["cloud-1", "cloud"], ["dot:abc", "dot"], [dyn, "cloud"]]);
    expect(sessions.find((s) => s.id === dyn)).toMatchObject({ title: "My cloud task", status: "idle", watchReady: true, canAcceptDirectInput: true, ownedByWear: false });
    expect(h.receiver.snapshot(dyn)).toMatchObject({ threadId: dyn, title: "My cloud task" });
    await expect(h.receiver.submitText(dyn, "req-dyn", "Hello")).resolves.toMatchObject({ outcome: "accepted" });
    expect(h.onSend.mock.calls[0]?.[0]).toMatchObject({ threadId: dyn, text: "Hello" });
  });
  it("drops a dynamic chat from sessions once its snapshot is older than the freshness window but still owns it for 10 minutes", async () => {
    const h = await setup();
    h.transport.snapshot(snap(dyn, "Task"), Date.now());
    await vi.waitFor(() => expect(h.receiver.sessions().some((s) => s.id === dyn)).toBe(true));
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + CLOUD_MAX_AGE_MS + 1_000);
    expect(h.receiver.sessions().some((s) => s.id === dyn)).toBe(false);
    expect(h.receiver.owns(dyn)).toBe(true);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(h.receiver.owns(dyn)).toBe(false);
    expect(() => h.receiver.snapshot(dyn)).toThrow();
  });
  it("rejects frames for non-uuid, non-config threads", async () => {
    const h = await setup();
    h.transport.snapshot(snap("not-a-uuid", "Nope"), Date.now()); // the receiver drops the stream
    await new Promise((r) => setTimeout(r, 300));
    expect(h.receiver.owns("not-a-uuid")).toBe(false);
    expect(h.receiver.sessions().map((s) => s.id)).toEqual(["cloud-1", "dot:abc"]);
  });
  it("keeps config-only behaviour when autoCloudChats is false", async () => {
    const h = await setup({ autoCloudChats: false });
    h.transport.snapshot(snap("cloud-1", "Cloud test"), Date.now());
    await vi.waitFor(() => expect(h.receiver.sessions().find((s) => s.id === "cloud-1")?.status).toBe("idle"));
    h.transport.snapshot(snap(dyn, "Task"), Date.now());
    await new Promise((r) => setTimeout(r, 300));
    expect(h.receiver.owns(dyn)).toBe(false);
    expect(h.receiver.sessions().map((s) => s.id)).toEqual(["cloud-1", "dot:abc"]);
    await expect(h.receiver.submitText(dyn, "r", "x")).rejects.toThrow();
  });
  it("defaults autoCloudChats to enabled and still parses the old config shape", () => {
    const old = { version: 1, enabled: true, capability: "a".repeat(64), pairBinding: "b".repeat(64), targets: [{ hostId: "durable", threadId: "cloud-1", title: "T" }] };
    const parsed = desktopCloudConfigSchema.parse(old);
    expect(parsed.autoCloudChats).toBeUndefined();
    expect(autoCloudChatsEnabled(parsed)).toBe(true);
    expect(autoCloudChatsEnabled({ autoCloudChats: false })).toBe(false);
    expect(autoCloudChatsEnabled({ autoCloudChats: true })).toBe(true);
  });
});

function observation(url: string, extra: Partial<BrowserObservation> = {}): BrowserObservation {
  const turn = { id: "t1", reply: "", completed: false, evidence: null };
  return browserObservationSchema.parse({ version: 1, kind: "observation", url, documentId: "01a1188b-a850-755b-91ec-717f6182900a",
    observedAt: Date.now(), extractionMs: 1, visibility: "visible", blocked: false, inputReady: true, turns: [turn], ...extra });
}
describe("dynamic browser observers", () => {
  const url = (id: string) => `https://chatgpt.com/local/${id}`;
  const uuidAt = (n: number) => `01a1188b-a850-755b-91ec-71${String(n).padStart(10, "0")}`;
  it("validates local chat URLs", () => {
    expect(localCloudChatThreadId(url(dyn))).toBe(dyn);
    for (const bad of [`${url(dyn)}?x=1`, `${url(dyn)}#h`, `https://chatgpt.com/c/${dyn}`, `${url(dyn)}/`, "https://chatgpt.com/local/x", `http://chatgpt.com/local/${dyn}`])
      expect(localCloudChatThreadId(bad)).toBeNull();
  });
  it("accepts a title up to 200 characters only", () => {
    expect(() => observation(url(dyn), { title: "x".repeat(200) })).not.toThrow();
    expect(() => observation(url(dyn), { title: "x".repeat(201) })).toThrow();
  });
  it("creates a send-enabled observer with the observed title, and follows title changes", () => {
    const snapshot = vi.fn();
    const registry = new BrowserCloudObservers([], true, snapshot, vi.fn());
    const first = observation(url(dyn), { title: "First" });
    registry.resolve(first)!.accept(first);
    expect(snapshot.mock.calls.at(-1)?.[0]).toMatchObject({ threadId: dyn, title: "First" });
    const second = observation(url(dyn), { title: " Renamed " });
    registry.resolve(second)!.accept(second);
    expect(snapshot.mock.calls.at(-1)?.[0]).toMatchObject({ title: "Renamed", inputReady: true });
    const untitled = observation(url(dyn));
    registry.resolve(untitled)!.accept(untitled);
    expect(snapshot.mock.calls.at(-1)?.[0].title).toBe("Codex cloud chat");
    expect(registry.isDynamicThread(dyn)).toBe(true);
  });
  it("ignores other URLs, honours the config targets and the auto flag", () => {
    const registry = new BrowserCloudObservers([{ threadId: "dot:abc", title: "Lumen", url: "https://chatgpt.com/dots/home", dotNamespace: "a".repeat(32), sendEnabled: true }], true, vi.fn(), vi.fn());
    expect(registry.resolve(observation(`https://chatgpt.com/c/${dyn}`))).toBeNull();
    expect(registry.resolve(observation("https://chatgpt.com/local/nope"))).toBeNull();
    expect(registry.resolve(observation("https://chatgpt.com/dots/home"))).not.toBeNull();
    expect(new BrowserCloudObservers([], false, vi.fn(), vi.fn()).resolve(observation(url(dyn)))).toBeNull();
  });
  it("caps at 8 dynamic chats and evicts the oldest-observed", () => {
    const evicted: string[] = [];
    const registry = new BrowserCloudObservers([], true, vi.fn(), vi.fn(), (u) => evicted.push(u));
    for (let n = 0; n < 8; n++) registry.resolve({ url: url(uuidAt(n)), observedAt: 1_000 + n });
    registry.resolve({ url: url(uuidAt(0)), observedAt: 5_000 }); // refreshed, no longer oldest
    registry.resolve({ url: url(uuidAt(99)), observedAt: 6_000 });
    expect(registry.dynamicCount).toBe(8);
    expect(evicted).toEqual([url(uuidAt(1))]);
    expect(registry.isDynamicThread(uuidAt(1))).toBe(false);
    expect(registry.isDynamicThread(uuidAt(0))).toBe(true);
  });
});
