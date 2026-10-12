import { describe, expect, it, vi } from "vitest";
import { AppServerClient, FastModeUnavailableError, supportsFastModeProtocol } from "../src/app-server-client.js";
import { watchPayloadSchema } from "../src/schemas.js";
import { LiveVoice } from "../src/live-voice.js";
import { BridgeService } from "../src/bridge-service.js";
import type { WatchPayload } from "../src/schemas.js";
import { DesktopCloudReceiver } from "../src/desktop-cloud-receiver.js";
import { NativeDotVoice } from "../src/native-dot-voice.js";

type Internals = { request: (method: string, params: unknown) => Promise<unknown>; write: (value: unknown) => void;
  fastProtocolSupported: boolean; modelCache: unknown; modelCacheExpiresAt: number; initialize: () => Promise<void> };
function setup(options: { status?: "idle" | "active" | "notLoaded"; provider?: string; account?: string; advertised?: boolean; mode?: "queue" | "steer" } = {}) {
  const client = new AppServerClient(new Set(), vi.fn(), vi.fn(), vi.fn(), vi.fn().mockResolvedValue(undefined),
    () => ({ model: "gpt-6.1-sol", effort: "max" }), null, () => options.mode ?? "steer");
  const internal = client as unknown as Internals;
  internal.fastProtocolSupported = true; internal.write = vi.fn();
  const thread = { id: "thread-fast", preview: "Fast test", updatedAt: 1, status: { type: options.status ?? "idle" },
    model: "gpt-6.1-sol", reasoningEffort: "max", modelProvider: options.provider ?? "openai", cwd: "/tmp" };
  const catalog = [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1 Sol", isDefault: true,
    defaultReasoningEffort: "max", supportedReasoningEfforts: [{ reasoningEffort: "max", description: "Max" }],
    serviceTiers: options.advertised === false ? [] : [{ id: "priority", name: "Fast", description: "Increased usage" }] }];
  internal.request = vi.fn(async (method, params) => {
    if (method === "initialize") return { userAgent: "codex/0.161.0" };
    if (method === "config/read") return { config: { model: "gpt-6.1-sol", model_provider: "openai", service_tier: "priority" } };
    if (method === "account/read") return { account: { type: options.account ?? "chatgpt" } };
    if (method === "model/list") return { data: catalog, nextCursor: null };
    if (method === "thread/start" || method === "thread/read" || method === "thread/resume") return { thread };
    if (method === "thread/settings/update" || method === "thread/unsubscribe" || method === "thread/realtime/start") return {};
    if (method === "turn/start" || method === "thread/queue/start") return { turn: { id: "turn-fast" } };
    if (method === "thread/turns/list") return { data: [{ id: "turn-active", status: "inProgress" }], nextCursor: null, backwardsCursor: null };
    if (method === "turn/steer") return { turnId: "turn-active" };
    if (method === "thread/queue/add") return { queuedSubmission: { id: "queued-fast", clientUserMessageId: (params as {clientUserMessageId: string}).clientUserMessageId, input: [] } };
    throw new Error(`Unexpected synthetic RPC: ${method}`);
  });
  const submit = (enabled?: boolean, id: string | null = "thread-fast") =>
    client.submitTurn(id, "Inspect the local fixture", "/tmp", "gpt-6.1-sol", "max", "message-fast", undefined, "default", enabled);
  const calls = () => vi.mocked(internal.request).mock.calls;
  const mutations = () => calls().filter(([method]) => !["config/read", "account/read", "model/list", "thread/read", "thread/turns/list", "initialize"].includes(method));
  return { client, internal, thread, catalog, submit, calls, mutations };
}

describe("explicit Fast coding tier", () => {
  it("requires a verified protocol version", () => {
    expect(supportsFastModeProtocol("codex/0.161.0")).toBe(true);
    expect(supportsFastModeProtocol("codex/0.162.0-alpha.2")).toBe(true);
    expect(supportsFastModeProtocol("codex/0.160.1")).toBe(false);
    expect(supportsFastModeProtocol("unknown")).toBe(false);
  });
  it("accepts only a boolean opt-in on the authenticated watch payload", () => {
    const payload = { version: 1, kind: "turn.submit", requestId: "fixture", threadId: null, text: "Inspect", model: "gpt-6.1-sol", effort: "max" };
    for (const fastMode of [undefined, false, true]) expect(watchPayloadSchema.safeParse({ ...payload, ...(fastMode === undefined ? {} : { fastMode }) }).success).toBe(true);
    for (const fastMode of ["priority", "ultrafast", null, 1]) expect(watchPayloadSchema.safeParse({ ...payload, fastMode }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...payload, serviceTier: "ultrafast" }).success).toBe(false);
  });
  it("explicitly overrides an inherited Fast default with Standard on new tasks", async () => {
    const s = setup(); await s.submit(false, null);
    for (const method of ["thread/start", "thread/settings/update", "turn/start"])
      expect(s.calls().find(([m]) => m === method)?.[1]).toMatchObject({ serviceTier: "default" });
    expect(s.calls().find(([m]) => m === "turn/start")?.[1]).toMatchObject({ model: "gpt-6.1-sol", effort: "max" });
    expect(s.calls().some(([m]) => m.startsWith("config/") || m === "account/read")).toBe(false);
  });
  it("uses the advertised priority tier with the exact selected model and effort", async () => {
    const s = setup(); await s.submit(true, null);
    expect(s.calls().find(([m]) => m === "turn/start")?.[1]).toMatchObject({ serviceTier: "priority", model: "gpt-6.1-sol", effort: "max" });
    expect(s.calls().find(([m]) => m === "account/read")?.[1]).toEqual({ refreshToken: false });
    expect(s.calls().some(([m]) => m === "config/write" || m === "config/batchWrite")).toBe(false);
  });
  it("round trips On then Off in the same task without altering model or reasoning", async () => {
    const s = setup(); await s.submit(true); await s.submit(false);
    expect(s.calls().filter(([m]) => m === "thread/settings/update").map(([,p]) => p)).toEqual([
      { threadId: "thread-fast", effort: "max", model: "gpt-6.1-sol", serviceTier: "priority" },
      { threadId: "thread-fast", effort: "max", model: "gpt-6.1-sol", serviceTier: "default" },
    ]);
  });
  it.each([true, false])("keeps an active steer boundary intact (%s)", async enabled => {
    const s = setup({ status: "active" }); await s.submit(enabled);
    expect(s.calls().find(([m]) => m === "thread/settings/update")?.[1]).toMatchObject({ serviceTier: enabled ? "priority" : "default" });
    expect(s.calls().find(([m]) => m === "turn/steer")?.[1]).not.toHaveProperty("serviceTier");
    expect(s.calls().some(([m]) => ["turn/start", "turn/interrupt", "thread/resume", "thread/realtime/stop"].includes(m))).toBe(false);
  });
  it("sets the subsequent tier before durable active-turn queue acceptance", async () => {
    const s = setup({ status: "active", mode: "queue" }); await s.submit(true);
    const methods = s.calls().map(([m]) => m);
    expect(methods.indexOf("thread/settings/update")).toBeLessThan(methods.indexOf("thread/queue/add"));
    expect(methods).not.toContain("turn/interrupt"); expect(methods).not.toContain("turn/start");
  });
  it.each([{ provider: "other" }, { account: "apiKey" }, { advertised: false }])("rejects unsupported routes before any mutation %j", async options => {
    const s = setup(options); await expect(s.submit(true)).rejects.toBeInstanceOf(FastModeUnavailableError);
    expect(s.mutations()).toEqual([]);
  });
  it("does not guess support from the model name or the deprecated speed metadata", async () => {
    const s = setup({ advertised: false }); Object.assign(s.catalog[0]!, { additionalSpeedTiers: ["fast"] });
    await expect(s.submit(true)).rejects.toThrow("does not advertise Fast"); expect(s.mutations()).toEqual([]);
  });
  it("rejects catalog failure instead of retrying Standard", async () => {
    const s = setup(); const original = s.internal.request;
    s.internal.request = vi.fn((m,p) => m === "model/list" ? Promise.reject(new Error("catalog unavailable")) : original(m,p));
    await expect(s.submit(true)).rejects.toThrow("catalog unavailable"); expect(s.mutations()).toEqual([]);
  });
  it("refreshes stale advertised Fast entitlement before a paid-tier request", async () => {
    const s = setup(); await s.client.listModels(); s.catalog[0]!.serviceTiers = [];
    await expect(s.submit(true)).rejects.toThrow("does not advertise Fast"); expect(s.mutations()).toEqual([]);
    expect(s.calls().filter(([m]) => m === "model/list")).toHaveLength(2);
  });
  it("invalidates the model cache after reconnect initialization", async () => {
    const s = setup(); await s.client.listModels(); expect(s.internal.modelCache).not.toBeNull();
    await s.internal.initialize(); expect(s.internal.modelCache).toBeNull();
  });
  it("does not enqueue an unverifiable tier when a foreign writer rejects settings", async () => {
    const s = setup({ status: "notLoaded", mode: "queue" }); const original = s.internal.request;
    s.internal.request = vi.fn((m,p) => m === "thread/settings/update" ? Promise.reject(new Error("thread not found: thread-fast")) : original(m,p));
    await expect(s.submit(true)).rejects.toThrow("owner must apply the Watch selection");
    expect(s.calls().some(([m]) => m === "thread/queue/add")).toBe(false);
  });
  it("does not dispatch or silently fall back after a tier settings error", async () => {
    const s = setup(); const original = s.internal.request;
    s.internal.request = vi.fn((m,p) => m === "thread/settings/update" ? Promise.reject(new Error("Fast denied by host")) : original(m,p));
    await expect(s.submit(true)).rejects.toThrow("Fast denied by host");
    expect(s.calls().filter(([m]) => m === "thread/settings/update")).toHaveLength(1);
    expect(s.calls().some(([m]) => m === "thread/queue/add" || m === "turn/start")).toBe(false);
  });
  it("retains legacy sends without introducing a tier override", async () => {
    const s = setup(); s.internal.fastProtocolSupported = false; await s.submit();
    expect(s.calls().find(([m]) => m === "thread/settings/update")?.[1]).not.toHaveProperty("serviceTier");
    await expect(s.submit(true)).rejects.toThrow("cannot set Fast or Standard safely");
  });
  it("preserves a cross-chat destination's settings and writer", async () => {
    const s = setup(); await s.client.queueVoiceMessage("thread-fast", "User-requested message", "cross-chat-message");
    expect(s.calls().map(([m]) => m)).toEqual(["thread/read", "thread/queue/add"]);
  });
  it("applies coding tier at explicit voice connect without changing the realtime audio model", async () => {
    const s = setup(); await s.client.startRealtime("thread-fast", "synthetic", "sol", true);
    expect(s.calls().find(([m]) => m === "thread/settings/update")?.[1]).toEqual({ threadId: "thread-fast", serviceTier: "priority" });
    const audio = s.calls().find(([m]) => m === "thread/realtime/start")?.[1];
    expect(audio).not.toHaveProperty("model"); expect(audio).not.toHaveProperty("serviceTier"); expect(audio).not.toHaveProperty("effort");
  });
  it("cannot change the tier of an already busy task when connecting voice", async () => {
    const s = setup({ status: "active" }); await expect(s.client.startRealtime("thread-fast", "synthetic", "sol", true)).rejects.toThrow("task is busy");
    expect(s.mutations()).toEqual([]);
  });
  it("does not reapply a changed preference to an already acknowledged live connection", async () => {
    const backend = { startRealtime: vi.fn().mockResolvedValue(undefined), stopRealtime: vi.fn() };
    const voice = new LiveVoice(backend, vi.fn()); const sdp = "v=0\r\nm=audio synthetic\r\n";
    await voice.start("call", "thread-fast", sdp, "sol", true); await voice.start("call", "thread-fast", sdp, "sol", false);
    expect(backend.startRealtime).toHaveBeenCalledExactlyOnceWith("thread-fast", sdp, "sol", true);
    expect(backend.stopRealtime).not.toHaveBeenCalled();
  });
});

describe("watch Fast capability negotiation", () => {
  function serviceFixture(supported = true) {
    const send = vi.fn().mockResolvedValue(undefined);
    const service = Object.create(BridgeService.prototype) as {
      handleWatchPayload: (payload: WatchPayload) => Promise<void>;
    };
    const appServer = {
      supportsFastMode: supported,
      listSessions: vi.fn().mockResolvedValue([]),
      listModels: vi.fn().mockResolvedValue([]),
      fastModeCapability: vi.fn().mockResolvedValue({ supported, eligible: supported, defaultModel: "gpt-6.1-sol" }),
      realtimeVoiceCapability: vi.fn().mockResolvedValue({ realtimeApiAvailable: true, voices: { defaultV1: "sol", v1: ["sol"] } }),
      submitTurn: vi.fn(), startRealtime: vi.fn(),
    };
    const desktopCloud = new DesktopCloudReceiver({ pairId: "fixture", bridgePublicKey: "fixture", watchPublicKey: "fixture" }, async () => {}, () => {});
    Object.assign(service, { config: { defaultCwd: "/tmp" }, appServer, send,
      desktopCloud, nativeDotVoice: new NativeDotVoice(desktopCloud, send) });
    return { service, appServer, send };
  }
  it("correlates the existing strict session.sync request without extending its payload", async () => {
    const s = serviceFixture();
    const request = { version: 1, kind: "session.sync", requestId: "current-refresh" } as const;
    expect(watchPayloadSchema.safeParse(request).success).toBe(true);
    expect(watchPayloadSchema.safeParse({ ...request, fastMode: false }).success).toBe(false);
    await s.service.handleWatchPayload(request);
    expect(s.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: "sessions.snapshot", requestId: "current-refresh",
      fastMode: { protocolVersion: 1, supported: true, eligible: true, defaultModel: "gpt-6.1-sol" },
    }));
    expect(s.appServer.submitTurn).not.toHaveBeenCalled();
    expect(s.appServer.startRealtime).not.toHaveBeenCalled();
  });
  it("advertises an unsupported host without enabling Fast", async () => {
    const s = serviceFixture(false);
    await s.service.handleWatchPayload({ version: 1, kind: "session.sync", requestId: "current-refresh" });
    expect(s.send).toHaveBeenCalledWith(expect.objectContaining({
      fastMode: { protocolVersion: 1, supported: false, eligible: false, defaultModel: "gpt-6.1-sol" },
    }));
  });
  it("a metadata error cannot advertise eligible Fast", async () => {
    const s = serviceFixture(); s.appServer.fastModeCapability.mockRejectedValueOnce(new Error("metadata unavailable"));
    await s.service.handleWatchPayload({ version: 1, kind: "session.sync", requestId: "current-refresh" });
    expect(s.send).toHaveBeenCalledWith(expect.objectContaining({
      fastMode: { protocolVersion: 1, supported: true, eligible: false, defaultModel: null },
    }));
    expect(s.appServer.submitTurn).not.toHaveBeenCalled();
  });
  it("the existing voice capability response negotiates before any voice start", async () => {
    const s = serviceFixture();
    await s.service.handleWatchPayload({ version: 1, kind: "live.capability", requestId: "voice-refresh", threadId: "thread-fast" });
    expect(s.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: "live.capability", requestId: "voice-refresh",
      fastMode: { protocolVersion: 1, supported: true, eligible: true, defaultModel: "gpt-6.1-sol" },
    }));
    expect(s.appServer.startRealtime).not.toHaveBeenCalled();
    expect(s.appServer.submitTurn).not.toHaveBeenCalled();
  });
});
