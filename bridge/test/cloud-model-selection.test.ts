import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeService } from "../src/bridge-service.js";
import { DesktopCloudReceiver } from "../src/desktop-cloud-receiver.js";
import { DesktopCloudTransport } from "../src/desktop-cloud-adapter.js";
import { BrowserCloudObserver, BrowserCloudObservers, browserObservationSchema, cloudModelFields } from "../src/browser-cloud-observer.js";
import { cloudSendSchema, desktopCloudPairBinding, desktopCloudSocketPath, type DesktopCloudConfig } from "../src/desktop-cloud-protocol.js";
import { watchPayloadSchema } from "../src/schemas.js";

const dyn = "01a1188b-a850-755b-91ec-717f6182900b";
const pairing = { pairId: "p", bridgePublicKey: "b", watchPublicKey: "w" };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
const observationBase = { version: 1, kind: "observation", url: `https://chatgpt.com/local/${dyn}`, documentId: "01a1188b-a850-755b-91ec-717f6182900a",
  observedAt: Date.now(), extractionMs: 1, visibility: "visible", blocked: false, inputReady: true,
  turns: [{ id: "t1", reply: "", completed: false, evidence: null }] };

describe("wire schemas", () => {
  it("accepts cloud model names with spaces and cloudEffortIndex on turn.submit, still rejecting junk", () => {
    const base = { version: 1, kind: "turn.submit", requestId: "r1", threadId: dyn, text: "hi", effort: "high" };
    expect(watchPayloadSchema.parse({ ...base, model: "GPT-6.1 Sol", cloudEffortIndex: 3 })).toMatchObject({ model: "GPT-6.1 Sol", cloudEffortIndex: 3 });
    expect(watchPayloadSchema.parse({ ...base, model: "gpt-5.5" })).toMatchObject({ model: "gpt-5.5" });
    expect(watchPayloadSchema.safeParse({ ...base, cloudEffortIndex: 10 }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, model: "bad;name" }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base }).success).toBe(true);
  });
  it("carries model/effortIndex on the browser send command and bounds the observation fields", () => {
    const send = { version: 1, kind: "send", requestId: "r", threadId: dyn, text: "x", expiresAt: 1 };
    expect(cloudSendSchema.safeParse({ ...send, model: "GPT-6 Astra", effortIndex: 4 }).success).toBe(true);
    expect(cloudSendSchema.safeParse({ ...send, effortIndex: 12 }).success).toBe(false);
    expect(browserObservationSchema.safeParse({ ...observationBase, model: "GPT-6.1 Sol", effort: { label: "Medium", index: 2, max: 4 }, models: ["A"], efforts: ["a", ""] }).success).toBe(true);
    expect(browserObservationSchema.safeParse({ ...observationBase, effort: { label: "x", index: 11 } }).success).toBe(false);
  });
});

describe("observer to session fields", () => {
  const obs = browserObservationSchema.parse({ ...observationBase, model: "GPT-6.1 Sol", effort: { label: "Medium", index: 2, max: 4 },
    models: ["Default (Recommended)", "GPT-6.1 Sol", "GPT-6 Astra"], efforts: ["Minimal", "", "Medium", "High", ""] });
  it("derives options, filtering the Default entry and naming unknown levels", () => {
    expect(cloudModelFields(obs)).toEqual({ cloudModel: "GPT-6.1 Sol", cloudModels: ["GPT-6.1 Sol", "GPT-6 Astra"],
      cloudEffort: { index: 2, label: "Medium" }, cloudEfforts: ["Minimal", "Level 2", "Medium", "High", "Level 5"] });
    expect(cloudModelFields({})).toEqual({});
  });
  it("puts them in cloud snapshots but never in Dot snapshots", () => {
    const snapshot = vi.fn();
    new BrowserCloudObservers([], true, snapshot, vi.fn()).resolve(obs)!.accept(obs);
    expect(snapshot.mock.calls.at(-1)?.[0]).toMatchObject({ cloudModel: "GPT-6.1 Sol", cloudEffort: { index: 2, label: "Medium" } });
    const dot = vi.fn();
    const dotObs = browserObservationSchema.parse({ ...observationBase, url: "https://chatgpt.com/dots/home", identity: "a".repeat(32), model: "GPT-6.1 Sol", models: ["GPT-6.1 Sol"] });
    new BrowserCloudObserver({ threadId: "dot:abc", title: "Lumen", url: "https://chatgpt.com/dots/home", dotNamespace: "a".repeat(32) }, dot, vi.fn()).accept(dotObs);
    expect(dot.mock.calls.at(-1)?.[0]).not.toHaveProperty("cloudModel");
    expect(dot.mock.calls.at(-1)?.[0]).not.toHaveProperty("cloudModels");
  });
});

describe("receiver pass-through", () => {
  it("lists model options on cloud sessions and snapshots, and forwards the selection to the browser", async () => {
    const directory = await mkdtemp("/tmp/aw-cloud-model-"); await chmod(directory, 0o700);
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "desktop-cloud.json");
    const config: DesktopCloudConfig = { version: 1, enabled: true, capability: "a".repeat(64), pairBinding: desktopCloudPairBinding(pairing),
      targets: [{ hostId: "durable", threadId: "cloud-1", title: "C", sendEnabled: true }], reconcileMs: 2_000 };
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    const receiver = new DesktopCloudReceiver(pairing, async () => {}, vi.fn(), path, vi.fn());
    await receiver.start(); cleanup.push(() => receiver.close());
    const onSend = vi.fn(async (c: { requestId: string; threadId: string }) => ({ requestId: c.requestId, threadId: c.threadId, outcome: "accepted" as const, message: "ok" }));
    const transport = new DesktopCloudTransport(config, desktopCloudSocketPath(path), vi.fn(), onSend);
    cleanup.push(async () => { transport.close(); }); transport.start();
    transport.snapshot({ threadId: "cloud-1", title: "C", status: "idle", inputReady: true, cloudModel: "GPT-6.1 Sol", cloudModels: ["GPT-6.1 Sol", "GPT-6 Astra"],
      cloudEffort: { index: 2, label: "Medium" }, cloudEfforts: ["Minimal", "Low", "Medium", "High", "Max"], messages: [] }, Date.now());
    await vi.waitFor(() => expect(receiver.sessions()[0]?.cloudModel).toBe("GPT-6.1 Sol"));
    expect(receiver.sessions()[0]).toMatchObject({ source: "cloud", cloudModels: ["GPT-6.1 Sol", "GPT-6 Astra"], cloudEffort: { index: 2, label: "Medium" }, cloudEfforts: ["Minimal", "Low", "Medium", "High", "Max"] });
    expect(receiver.snapshot("cloud-1")).toMatchObject({ cloudModel: "GPT-6.1 Sol", cloudEfforts: ["Minimal", "Low", "Medium", "High", "Max"] });
    expect(receiver.cloudOptions("cloud-1")).toEqual({ models: ["GPT-6.1 Sol", "GPT-6 Astra"], efforts: ["Minimal", "Low", "Medium", "High", "Max"] });
    await receiver.submitText("cloud-1", "r1", "Hi", false, { model: "GPT-6 Astra", effortIndex: 4 });
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({ text: "Hi", model: "GPT-6 Astra", effortIndex: 4 });
    await receiver.submitText("cloud-1", "r2", "Hi again");
    expect(onSend.mock.calls[1]?.[0]).not.toHaveProperty("model");
  });
});

describe("bridge-service validation", () => {
  function service(options: { models: string[]; efforts: string[] } | null) {
    const svc = Object.create(BridgeService.prototype) as Record<string, unknown>;
    const send = vi.fn().mockResolvedValue(undefined), submitText = vi.fn().mockResolvedValue({ outcome: "accepted" });
    Object.assign(svc, { desktopCloud: { owns: (id: unknown) => id === "cloud", cloudOptions: () => options, submitText }, cloudTextRoute: vi.fn(),
      sendChatSnapshot: vi.fn().mockResolvedValue(undefined), appServer: { submitTurn: vi.fn() }, send, sendSessions: vi.fn().mockResolvedValue(undefined) });
    const handle = (extra: Record<string, unknown>) => (svc.handleWatchPayload as (v: unknown) => Promise<void>).call(svc,
      { version: 1, kind: "turn.submit", requestId: "r", threadId: "cloud", text: "Hello", effort: "high", ...extra });
    return { handle, send, submitText };
  }
  const options = { models: ["GPT-6.1 Sol", "GPT-6 Astra"], efforts: ["Minimal", "Low", "Medium"] };
  it("passes a reported model and effort index to the browser send", async () => {
    const s = service(options);
    await s.handle({ model: "GPT-6 Astra", cloudEffortIndex: 2 });
    expect(s.submitText).toHaveBeenCalledWith("cloud", "r", "Hello", false, { model: "GPT-6 Astra", effortIndex: 2 });
  });
  it("sends nothing when unchanged, and passes an empty selection", async () => {
    const s = service(options);
    await s.handle({});
    expect(s.submitText).toHaveBeenCalledWith("cloud", "r", "Hello", false, {});
  });
  it("rejects a model or reasoning level the chat did not report, without sending", async () => {
    for (const extra of [{ model: "GPT-9 Nope" }, { cloudEffortIndex: 3 }]) {
      const s = service(options);
      await s.handle(extra);
      expect(s.submitText).not.toHaveBeenCalled();
      expect(s.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn.error", requestId: "r" }));
    }
    const none = service(null);
    await none.handle({ model: "GPT-6.1 Sol" });
    expect(none.submitText).not.toHaveBeenCalled();
  });
});
