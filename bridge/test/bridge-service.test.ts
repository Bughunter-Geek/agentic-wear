import { describe, expect, it, vi } from "vitest";
import { ForeignThreadSelectionError, type TerminalEvent } from "../src/app-server-client.js";
import { BridgeService, publicError, publicRequestError } from "../src/bridge-service.js";

describe("BridgeService App Server transport", () => {
  it("keeps a live call's chat updating past the watch window and refreshes it when the call stops", async () => {
    vi.useFakeTimers();
    try {
      const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
      const sendChatSnapshot = vi.fn().mockResolvedValue(undefined);
      Object.assign(service, {
        appServer: { realtimeVoiceCapability: vi.fn().mockResolvedValue({ realtimeApiAvailable: true, voices: { v1: ["marin"] } }) },
        liveVoice: { start: vi.fn().mockResolvedValue(undefined), heartbeat: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) },
        sendChatSnapshot,
        watchedThreadId: null, watchAcceptedAt: 0, watchExpiresAt: 0,
      });
      const handle = (payload: unknown) => (service.handleWatchPayload as (value: unknown) => Promise<void>).call(service, payload);
      vi.setSystemTime(1_000_000);
      await handle({ version: 1, kind: "live.start", requestId: "r1", callId: "call-1", threadId: "thread-1", sdp: "v=0 m=audio", voice: "marin" });
      expect(service.watchedThreadId).toBe("thread-1");
      vi.setSystemTime(1_100_000); // past the 90 s chat window
      await handle({ version: 1, kind: "live.heartbeat", requestId: "r2", callId: "call-1" });
      expect(service.watchExpiresAt).toBe(1_190_000);
      await handle({ version: 1, kind: "live.stop", requestId: "r3", callId: "call-1" });
      expect(sendChatSnapshot).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(750);
      expect(sendChatSnapshot).toHaveBeenCalledWith("thread-1", undefined, true);
      await handle({ version: 1, kind: "live.stop", requestId: "r4", callId: "call-1" });
      await vi.advanceTimersByTimeAsync(750);
      expect(sendChatSnapshot).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses the Codex voice catalog across live.start calls for 60 s, refetching once for a missing voice and after expiry", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const catalog = (...voices: string[]) => ({ realtimeApiAvailable: true, voices: { v1: voices } });
      const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
      const realtimeVoiceCapability = vi.fn()
        .mockResolvedValueOnce(catalog("marin"))
        .mockResolvedValueOnce(catalog("marin", "sol"))
        .mockResolvedValueOnce(catalog("marin", "sol"))
        .mockResolvedValueOnce(catalog("marin", "sol"));
      const start = vi.fn().mockResolvedValue(undefined);
      const send = vi.fn().mockResolvedValue(undefined);
      Object.assign(service, {
        appServer: { realtimeVoiceCapability },
        liveVoice: { start, heartbeat: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) },
        send,
        watchedThreadId: null, watchAcceptedAt: 0, watchExpiresAt: 0,
      });
      const handle = (callId: string, voice: string) => (service.handleWatchPayload as (value: unknown) => Promise<void>).call(service,
        { version: 1, kind: "live.start", requestId: `r-${callId}`, callId, threadId: "thread-1", sdp: "v=0 m=audio", voice });
      const logged = () => log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
        .filter((entry) => entry.message === "live.voice.capability");

      vi.setSystemTime(1_000_000);
      await handle("call-1", "marin");
      expect(realtimeVoiceCapability).toHaveBeenCalledTimes(1);
      expect(logged()).toEqual([expect.objectContaining({ level: "info", callId: "call-1", cached: false, durationMs: expect.any(Number) })]);

      vi.setSystemTime(1_030_000); // within 60 s: reused
      await handle("call-2", "marin");
      expect(realtimeVoiceCapability).toHaveBeenCalledTimes(1);
      expect(logged()[1]).toEqual(expect.objectContaining({ callId: "call-2", cached: true }));
      expect(start).toHaveBeenCalledTimes(2);

      vi.setSystemTime(1_040_000); // a voice missing from the cached list: exactly one fresh fetch
      await handle("call-3", "sol");
      expect(realtimeVoiceCapability).toHaveBeenCalledTimes(2);
      expect(logged()[2]).toEqual(expect.objectContaining({ callId: "call-3", cached: false }));
      expect(start).toHaveBeenLastCalledWith("call-3", "thread-1", "v=0 m=audio", "sol", undefined);
      await handle("call-4", "sol"); // the refreshed catalog is now the cached one
      expect(realtimeVoiceCapability).toHaveBeenCalledTimes(2);

      // Still missing after the fresh fetch: one fetch, then the existing error; nothing starts.
      await handle("call-5", "cedar");
      expect(realtimeVoiceCapability).toHaveBeenCalledTimes(3);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "live.error", requestId: "r-call-5", callId: "call-5",
        message: "Codex voice or the selected voice is unavailable on this host." }));
      expect(start).toHaveBeenCalledTimes(4);

      vi.setSystemTime(1_040_000 + 59_999); // the entry refreshed at 1_040_000 is still fresh
      await handle("call-6", "sol");
      expect(realtimeVoiceCapability).toHaveBeenCalledTimes(3);
      vi.setSystemTime(1_040_000 + 60_000); // expired: refetch
      await handle("call-7", "sol");
      expect(realtimeVoiceCapability).toHaveBeenCalledTimes(4);
      expect(logged().at(-1)).toEqual(expect.objectContaining({ callId: "call-7", cached: false }));
    } finally {
      log.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not block a prompt behind an unfinished chat refresh", async () => {
    let finishRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => { finishRefresh = resolve; });
    const handled: string[] = [];
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      crypto: { decrypt: vi.fn()
        .mockResolvedValueOnce({ version: 1, kind: "chat.watch", requestId: "read-1", threadId: "thread-1" })
        .mockResolvedValueOnce({ version: 1, kind: "turn.submit", requestId: "send-1", threadId: "thread-1", text: "Continue", model: null, effort: "high" }) },
      replayGuard: { claim: vi.fn().mockResolvedValue(true) },
      handleWatchPayload: vi.fn(async (payload: { kind: string }) => {
        handled.push(payload.kind);
        if (payload.kind === "chat.watch") await refresh;
      }),
    });
    service.handleAuthenticatedCommand = service.handleWatchPayload;
    const envelope = { messageId: "envelope-1", sentAt: Date.now() };
    const receive = service.onEnvelope as (envelope: unknown) => Promise<void>;
    try {
      await receive.call(service, envelope);
      await receive.call(service, { ...envelope, messageId: "envelope-2" });
      expect(handled).toEqual(["chat.watch", "turn.submit"]);
    } finally {
      finishRefresh();
    }
  });

  it("does not dispatch a previously claimed envelope without a receipt", async () => {
    const payload = { version: 1, kind: "turn.submit", requestId: "legacy-1", threadId: null, text: "Once", model: null, effort: "high" };
    const send = vi.fn().mockResolvedValue(undefined);
    const handleWatchPayload = vi.fn();
    const begin = vi.fn();
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      crypto: { decrypt: vi.fn().mockResolvedValue(payload) },
      replayGuard: { claim: vi.fn().mockResolvedValue(false) },
      turnReceipts: { get: vi.fn().mockResolvedValue(null), begin },
      send,
      handleWatchPayload,
    });
    await (service.onEnvelope as (value: unknown) => Promise<void>).call(service, { messageId: "claimed", sentAt: Date.now() });
    expect(begin).not.toHaveBeenCalled();
    expect(handleWatchPayload).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn.error", deliveryUncertain: true }));
  });

  it("replays an accepted receipt on a duplicate instead of starting another chat", async () => {
    const accepted = { version: 1, kind: "turn.accepted", requestId: "new-chat-1", threadId: "created-once" };
    const send = vi.fn().mockResolvedValue(undefined);
    const handleWatchPayload = vi.fn();
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      crypto: { decrypt: vi.fn().mockResolvedValue({ version: 1, kind: "turn.submit", requestId: "new-chat-1", threadId: null, text: "Once", model: null, effort: "high" }) },
      replayGuard: { claim: vi.fn().mockResolvedValue(false) },
      turnReceipts: { get: vi.fn().mockResolvedValue({ response: accepted }) },
      send,
      handleWatchPayload,
    });
    await (service.onEnvelope as (value: unknown) => Promise<void>).call(service, { messageId: "claimed", sentAt: Date.now() });
    expect(handleWatchPayload).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(accepted);
  });

  it("fails a legacy pending selection mismatch durably without crashing startup", async () => {
    const payload = { requestId: "pending-selection", threadId: "thread-1", text: "Keep my draft", model: "gpt-6-astra", effort: "medium", createdAt: Date.now() };
    const pendingTurns = new Map([[payload.requestId, { payload }]]);
    const send = vi.fn().mockResolvedValue(undefined);
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      pendingTurns,
      config: { defaultCwd: "/tmp" },
      appServer: { submitTurn: vi.fn().mockRejectedValue(new ForeignThreadSelectionError("Apply Astra in Codex, then retry")) },
      savePendingTurn: vi.fn(async (blocked) => { pendingTurns.set(blocked.requestId, { payload: blocked }); }),
      removePendingTurn: vi.fn(async (id: string) => pendingTurns.delete(id)),
      send,
    });
    await expect((service.processPendingTurnsNow as () => Promise<void>).call(service)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn.error", deferred: true, draftText: "Keep my draft" }));
    expect(pendingTurns.size).toBe(0);
  });

  it("redelivers a blocked pending notice after restart without reviving the prompt", async () => {
    const payload = { requestId: "blocked-selection", threadId: "thread-1", text: "Keep my draft", blockedReason: "Apply Astra in Codex, then retry" };
    const pendingTurns = new Map([[payload.requestId, { payload }]]);
    const submitTurn = vi.fn();
    const send = vi.fn().mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValue(undefined);
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      pendingTurns,
      appServer: { submitTurn },
      removePendingTurn: vi.fn(async (id: string) => pendingTurns.delete(id)),
      send,
    });
    try {
      await (service.processPendingTurnsNow as () => Promise<void>).call(service);
      expect(pendingTurns.size).toBe(1);
      await (service.processPendingTurnsNow as () => Promise<void>).call(service);
      expect(pendingTurns.size).toBe(0);
      expect(submitTurn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it("connects to the shared Desktop daemon rather than a private stdio server", async () => {
    const stopAfterConnect = new Error("stop after transport assertion");
    const connect = vi.fn(async () => { throw stopAfterConnect; });
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      relay: {
        status: vi.fn().mockResolvedValue({ paired: true, watchPublicKey: "watch-public-key" }),
        runSocket: vi.fn().mockResolvedValue(undefined),
      },
      appServer: { connect, close: vi.fn() },
      liveVoice: { close: vi.fn().mockResolvedValue(undefined) },
      controller: new AbortController(),
      transcriber: {},
      assertWatchPublicKey: vi.fn(),
    });

    await expect((service as unknown as BridgeService).run()).rejects.toBe(stopAfterConnect);
    expect(connect).toHaveBeenCalledWith("daemon");
  });

  it("acknowledges an owner-blocked prompt as waiting after durable persistence", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const storePendingTurn = vi.fn().mockResolvedValue(undefined);
    const markHot = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      appServer: {
        markHot,
        submitTurn: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          created: false,
          state: "waiting",
          selectionApplied: false,
          followUpMode: "queue",
        }),
      },
      config: { defaultCwd: "/tmp" },
      send,
      sendSessions: vi.fn().mockResolvedValue(undefined),
      storePendingTurn,
    });

    await (service as unknown as {
      handleWatchPayload: (payload: {
        version: 1;
        kind: "turn.submit";
        requestId: string;
        threadId: string;
        text: string;
        model: string;
        effort: string;
        followUpAction: "queue";
      }) => Promise<void>;
    }).handleWatchPayload({
      version: 1,
      kind: "turn.submit",
      requestId: "watch-owner-held-1",
      threadId: "thread-1",
      text: "Continue once.",
      model: "gpt-5.6-terra",
      effort: "high",
      followUpAction: "queue",
    });

    expect(storePendingTurn).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "watch-owner-held-1",
      threadId: "thread-1",
      text: "Continue once.",
      model: "gpt-5.6-terra",
      effort: "high",
      followUpAction: "queue",
    }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      kind: "turn.accepted",
      requestId: "watch-owner-held-1",
      threadId: "thread-1",
      state: "waiting",
      selectionApplied: false,
      message: expect.stringContaining("Queued on the Watch"),
    }));
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "turn.error" }));
    // The chat the Watch just used gets the one-second fast lane.
    expect(markHot).toHaveBeenCalledExactlyOnceWith("thread-1");
    // Routing is logged with ids and states only, never the prompt text.
    const lines = log.mock.calls.map(([line]) => String(line));
    const route = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.message === "watch.turn.route");
    expect(route).toEqual({
      level: "info", message: "watch.turn.route", requestId: "watch-owner-held-1", threadId: "thread-1",
      state: "waiting", created: false, steered: false, followUpMode: "queue",
    });
    expect(lines.join("\n")).not.toContain("Continue once.");
    log.mockRestore();
  });

  it("persists and acknowledges a prompt when cross-client session sync is transiently unavailable", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const storePendingTurn = vi.fn().mockResolvedValue(undefined);
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      appServer: {
        submitTurn: vi.fn().mockRejectedValue(new Error("No rollout found for thread thread-1")),
      },
      config: { defaultCwd: "/tmp" },
      send,
      sendSessions: vi.fn().mockResolvedValue(undefined),
      storePendingTurn,
    });

    await (service as unknown as {
      handleWatchPayload: (payload: {
        version: 1;
        kind: "turn.submit";
        requestId: string;
        threadId: string;
        text: string;
        model: string;
        effort: string;
        followUpAction: "steer";
      }) => Promise<void>;
    }).handleWatchPayload({
      version: 1,
      kind: "turn.submit",
      requestId: "watch-sync-wait-1",
      threadId: "thread-1",
      text: "Deliver this once after synchronization.",
      model: "gpt-5.6-terra",
      effort: "high",
      followUpAction: "steer",
    });

    expect(storePendingTurn).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "watch-sync-wait-1",
      threadId: "thread-1",
      text: "Deliver this once after synchronization.",
      followUpAction: "steer",
    }));
    expect(storePendingTurn.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[0]!);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      kind: "turn.accepted",
      requestId: "watch-sync-wait-1",
      state: "waiting",
      selectionApplied: false,
      message: expect.stringContaining("send it once"),
    }));
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "turn.error" }));
  });

  it("durably marks an active-turn handoff before acknowledging the steer", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const markPendingExternalAttempt = vi.fn().mockResolvedValue(undefined);
    const removePendingTurn = vi.fn().mockResolvedValue(true);
    const submitTurn = vi.fn(async (...args: unknown[]) => {
      const beforeExternalDispatch = args[6] as (
        baseline: { userMessageIds: string[] },
        mode: "steer",
      ) => Promise<void>;
      await beforeExternalDispatch({ userMessageIds: ["user-before"] }, "steer");
      return {
        threadId: "thread-1",
        created: false,
        state: "running",
        selectionApplied: true,
        steered: true,
        followUpMode: "steer",
      };
    });
    const markHot = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      appServer: { submitTurn, markHot },
      config: { defaultCwd: "/tmp" },
      send,
      sendSessions: vi.fn().mockResolvedValue(undefined),
      markPendingExternalAttempt,
      removePendingTurn,
    });

    await (service as unknown as {
      handleWatchPayload: (payload: {
        version: 1;
        kind: "turn.submit";
        requestId: string;
        threadId: string;
        text: string;
        model: string;
        effort: string;
        followUpAction: "steer";
      }) => Promise<void>;
    }).handleWatchPayload({
      version: 1,
      kind: "turn.submit",
      requestId: "watch-model-change-1",
      threadId: "thread-1",
      text: "Use Luna high in this chat.",
      model: "gpt-5.6-luna",
      effort: "high",
      followUpAction: "steer",
    });

    expect(markPendingExternalAttempt).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "watch-model-change-1",
      threadId: "thread-1",
      text: "Use Luna high in this chat.",
      model: "gpt-5.6-luna",
      effort: "high",
      followUpAction: "steer",
    }), { userMessageIds: ["user-before"] });
    expect(submitTurn.mock.calls[0]?.[7]).toBe("steer");
    expect(removePendingTurn).toHaveBeenCalledWith("watch-model-change-1");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      kind: "turn.accepted",
      requestId: "watch-model-change-1",
      threadId: "thread-1",
      state: "running",
      selectionApplied: true,
      message: expect.stringContaining("Steered the active turn"),
    }));
    expect(markHot).toHaveBeenCalledExactlyOnceWith("thread-1");
    expect(log).toHaveBeenCalledWith(JSON.stringify({
      level: "info", message: "watch.turn.route", requestId: "watch-model-change-1", threadId: "thread-1",
      state: "running", created: false, steered: true, followUpMode: "steer",
    }));
    log.mockRestore();
  });

  it.each([undefined, false, true])("retries an encrypted pending prompt with its exact tier and idempotency key (%s)", async (fastMode) => {
    const send = vi.fn().mockResolvedValue(undefined);
    const persistPendingTurns = vi.fn().mockResolvedValue(undefined);
    const submitTurn = vi.fn().mockResolvedValue({
      threadId: "thread-1",
      created: false,
      state: "running",
      selectionApplied: true,
    });
    const pendingTurns = new Map([[
      "watch-pending-1",
      {
        payload: {
          requestId: "watch-pending-1",
          threadId: "thread-1",
          text: "Continue this exact chat.",
          model: "gpt-5.6-luna",
          effort: "max",
          createdAt: 1_787_900_000_000,
          ...(fastMode !== undefined ? { fastMode } : {}),
        },
        sealed: { nonce: "nonce", ciphertext: "ciphertext" },
      },
    ]]);
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      appServer: { submitTurn },
      config: { defaultCwd: "/tmp" },
      pendingTurns,
      pendingTurnTask: null,
      persistPendingTurns,
      send,
      sendSessions: vi.fn().mockResolvedValue(undefined),
    });

    await (service as unknown as { processPendingTurns: () => Promise<void> }).processPendingTurns();

    expect(submitTurn).toHaveBeenCalledWith(
      "thread-1",
      "Continue this exact chat.",
      "/tmp",
      "gpt-5.6-luna",
      "max",
      "watch-pending-1",
      expect.any(Function),
      "default",
      ...(fastMode !== undefined ? [fastMode] as const : []),
    );
    expect(pendingTurns.size).toBe(0);
    expect(persistPendingTurns).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      kind: "turn.started",
      requestId: "watch-pending-1",
      threadId: "thread-1",
      selectionApplied: true,
    }));
  });

  it("migrates a previously dispatched prompt by reconciling before retrying", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const persistPendingTurns = vi.fn().mockResolvedValue(undefined);
    const submitTurn = vi.fn();
    const reconcileExternalTurn = vi.fn().mockResolvedValue("delivered");
    const pendingTurns = new Map([[
      "watch-pending-external-1",
      {
        payload: {
          requestId: "watch-pending-external-1",
          threadId: "thread-1",
          text: "Use the requested configuration once.",
          model: "gpt-5.6-luna",
          effort: "max",
          createdAt: 1_787_900_000_000,
          externalAttempt: {
            attemptedAt: 1_787_900_001_000,
            userMessageIds: ["user-before"],
          },
        },
        sealed: { nonce: "nonce", ciphertext: "ciphertext" },
      },
    ]]);
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      appServer: { submitTurn, reconcileExternalTurn },
      config: { defaultCwd: "/tmp" },
      pendingTurns,
      pendingTurnTask: null,
      persistPendingTurns,
      send,
      sendSessions: vi.fn().mockResolvedValue(undefined),
    });

    await (service as unknown as { processPendingTurns: () => Promise<void> }).processPendingTurns();

    expect(reconcileExternalTurn).toHaveBeenCalledWith(
      "thread-1",
      "Use the requested configuration once.",
      {
        attemptedAt: 1_787_900_001_000,
        userMessageIds: ["user-before"],
      },
    );
    expect(submitTurn).not.toHaveBeenCalled();
    expect(pendingTurns.size).toBe(0);
    expect(persistPendingTurns).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      kind: "turn.started",
      requestId: "watch-pending-external-1",
      threadId: "thread-1",
    }));
  });
});

describe("publicRequestError", () => {
  it("explains a voice writer conflict without blaming a still-running turn or losing task identity", () => {
    expect(publicRequestError(new Error("thread private-task-id already has an active writer"), "live.start"))
      .toBe("Another Codex client holds this task's writer. Voice did not start. Restore the shared Desktop/bridge connection, then reconnect to this task.");
  });

  it("does not encourage another call when its voice acknowledgment timed out", () => {
    expect(publicRequestError(new Error("thread/realtime/start timed out"), "live.start"))
      .toBe("Codex did not confirm this voice request. Check the call in Codex before reconnecting.");
  });
  it("preserves a long safe error while redacting credential-shaped values", () => {
    const safeDetail = `The full diagnostic remains available. ${"detail ".repeat(120)}`;

    expect(publicError(new Error(`${safeDetail} authorization: Bearer top-secret-token`)))
      .toBe(`${safeDetail.trim()} authorization: [redacted]`);
  });

  it("states that a foreign active writer leaves the watch draft unsent", () => {
    expect(publicRequestError(new Error("active writer already attached"), "turn.submit"))
      .toBe("Another Codex client owns this active session. Agentic Wear did not queue or send your prompt. Keep the draft and retry this same chat after its turn finishes; Agentic Wear will not create another chat.");
  });

  it("maps foreign-session wording variants to the same safe recovery", () => {
    const expected = "Another Codex client owns this active session. Agentic Wear did not queue or send your prompt. Keep the draft and retry this same chat after its turn finishes; Agentic Wear will not create another chat.";

    expect(publicRequestError(new Error("Codex still owns this session in another client"), "turn.submit"))
      .toBe(expected);
    expect(publicRequestError(new Error("Desktop is actively writing this session"), "turn.submit"))
      .toBe(expected);
    expect(publicRequestError(new Error("Session is currently active in another client"), "turn.submit"))
      .toBe(expected);
  });

  it("does not suggest that restarting Codex will create queue support", () => {
    expect(publicRequestError(new Error("Invalid request: unknown variant `thread/queue/add`"), "turn.submit"))
      .toBe("This Codex App Server does not support queued watch prompts. Agentic Wear did not queue or send your prompt; keep the draft and retry after the current turn finishes.");
  });

  it("does not mislabel a delayed rollout as a permanently removed chat", () => {
    expect(publicRequestError(new Error("No rollout found for thread"), "chat.watch"))
      .toBe("The bridge could not load this session after resyncing. Agentic Wear kept your selection. Refresh sessions and retry; choose another chat only if this one no longer appears.");
  });

  it("states that a failed send was not queued instead of calling it a chat-load error", () => {
    expect(publicRequestError(new Error("thread not found"), "turn.submit"))
      .toBe("Codex could not synchronize this session after retrying. Agentic Wear did not queue or send your message, and your draft remains on the watch. Refresh sessions and retry.");
    expect(publicRequestError(new Error("thread not loaded: 00000000-0000-0000-0000-000000000000"), "turn.submit"))
      .toBe("Codex could not synchronize this session after retrying. Agentic Wear did not queue or send your message, and your draft remains on the watch. Refresh sessions and retry.");
    expect(publicRequestError(new Error("thread not loaded: 00000000-0000-0000-0000-000000000000"), "chat.watch"))
      .toBe("The bridge could not load this session after resyncing. Agentic Wear kept your selection. Refresh sessions and retry; choose another chat only if this one no longer appears.");
  });

  it("does not expose an internal cancelled task id after retries", () => {
    expect(publicRequestError(new Error("bs1 was cancelled"), "chat.watch"))
      .toBe("Codex briefly cancelled the chat-history sync after the bridge retried it. Agentic Wear kept your selection and draft; refresh sessions and retry.");
  });
});

 describe("transcription timing privacy", () => {
  it("logs only phase metadata while preserving private draft response", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, { transcriber: { defaultBackend: "phonon", transcribe: vi.fn().mockResolvedValue("uh, private-example") }, send, config: { defaultCwd: "/private-cwd" } });
    try {
      const create = service.createTranscription as (payload: unknown) => Promise<void>;
      await create.call(service, { kind: "transcription.create", requestId: "private-request-id", threadId: "private-thread-id", mimeType: "audio/aac", audioBase64: Buffer.alloc(2048).toString("base64") });
      const messages = JSON.stringify(log.mock.calls);
      expect(messages).toContain("transcription.bridge.timing");
      for (const secret of ["private-example", "private-request-id", "private-thread-id", "/private-cwd", "audioBase64"]) expect(messages).not.toContain(secret);
      expect(send.mock.calls[0]?.[0]).toMatchObject({ text: "private-example", rawText: "uh, private-example" });
    } finally { log.mockRestore(); }
  });
 });

describe("Watch terminal and notification diagnostics", () => {
  it("logs when a terminal event is sent to the Watch, without its title or detail", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      send,
      watchedThreadId: null,
      watchExpiresAt: 0,
      processPendingTurns: vi.fn().mockResolvedValue(undefined),
      sendSessions: vi.fn().mockResolvedValue(undefined),
    });
    const event: TerminalEvent = {
      eventId: "turn:thread-1:turn-9:completed",
      kind: "terminal.completed",
      turnScope: "topLevel",
      threadId: "thread-1",
      title: "Private title",
      detail: "Private reply text",
      occurredAt: 1_787_900_000_000,
    };

    const before = Date.now();
    await (service as unknown as { onTerminal: (event: TerminalEvent) => Promise<void> }).onTerminal(event);
    const after = Date.now();

    expect(send).toHaveBeenCalledWith({ version: 1, ...event });
    const entries = log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    const sent = entries.find((entry) => entry.message === "watch.terminal.sent");
    expect(sent).toMatchObject({ level: "info", eventId: event.eventId, threadId: "thread-1" });
    expect(sent?.sentAt).toBeGreaterThanOrEqual(before);
    expect(sent?.sentAt).toBeLessThanOrEqual(after);
    expect(Object.keys(sent ?? {}).sort()).toEqual(["eventId", "level", "message", "sentAt", "threadId"]);
    expect(log.mock.calls.map(([line]) => String(line)).join("\n")).not.toMatch(/Private (title|reply text)/u);
    log.mockRestore();
  });

  it("logs the Watch notification trace as metadata and sends nothing back", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, { send });
    const payload = {
      version: 1 as const,
      kind: "notify.trace" as const,
      requestId: "trace-1",
      pushReceivedAt: 1_787_900_001_000,
      fetchStartedAt: 1_787_900_001_050,
      fetchCompletedAt: 1_787_900_001_400,
      alerts: [{ eventId: "turn:thread-1:turn-9:completed", decision: "posted" as const, decidedAt: 1_787_900_001_450 }],
    };

    const before = Date.now();
    await (service as unknown as { handleWatchPayload: (payload: unknown) => Promise<void> }).handleWatchPayload(payload);

    const entry = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "info",
      message: "watch.notify.trace",
      pushReceivedAt: payload.pushReceivedAt,
      fetchStartedAt: payload.fetchStartedAt,
      fetchCompletedAt: payload.fetchCompletedAt,
      alerts: payload.alerts,
    });
    expect(entry.receivedAt).toBeGreaterThanOrEqual(before);
    expect(send).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("includes the push fetch attempt in the notification trace log when the Watch sends it", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, { send });
    const payload = {
      version: 1 as const,
      kind: "notify.trace" as const,
      requestId: "trace-2",
      pushReceivedAt: 1_787_900_001_000,
      fetchStartedAt: 1_787_900_003_050,
      fetchCompletedAt: 1_787_900_003_400,
      fetchAttempt: 3,
      alerts: [],
    };

    await (service as unknown as { handleWatchPayload: (payload: unknown) => Promise<void> }).handleWatchPayload(payload);

    const entry = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({ message: "watch.notify.trace", fetchAttempt: 3 });
    expect(send).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("logs Watch relay failures as metadata and sends nothing back", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, { send });
    const payload = {
      version: 1 as const,
      kind: "relay.failures" as const,
      requestId: "failures-1",
      failures: [
        { op: "fetchInbox" as const, status: 503, errorClass: "RelayException", at: 1_787_900_001_000 },
        { op: "sendToBridge" as const, status: 0, errorClass: "SocketTimeoutException", at: 1_787_900_001_500 },
      ],
    };

    const before = Date.now();
    await (service as unknown as { handleWatchPayload: (payload: unknown) => Promise<void> }).handleWatchPayload(payload);

    expect(log).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: "info", message: "watch.relay.failures", failures: payload.failures });
    expect(entry.receivedAt).toBeGreaterThanOrEqual(before);
    expect(Object.keys(entry).sort()).toEqual(["failures", "level", "message", "receivedAt"]);
    expect(send).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("new local draft protocol versus legacy watch", () => {
 it("retains raw recognition and never invokes Codex for new local editing", async () => {
  const send=vi.fn().mockResolvedValue(undefined);
  const reviseDraft=vi.fn();
  const rewrite=vi.fn().mockResolvedValue({text:"Yesterday I bought green flowers.",notice:"Review before Send."});
  const service=Object.create(BridgeService.prototype) as Record<string,unknown>;
  Object.assign(service,{send,config:{defaultCwd:"/tmp"},appServer:{reviseDraft},draftEditor:{rewrite},transcriber:{defaultBackend:"phonon",transcribe:vi.fn().mockResolvedValue("Yesterday red, no green flowers.")}});
  const create=service.createTranscription as (p:unknown)=>Promise<void>;
  const base={kind:"transcription.create",requestId:"new-test",threadId:null,mimeType:"audio/aac",audioBase64:Buffer.alloc(2048).toString("base64")};
  await create.call(service,{...base,finalIntent:true});
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({text:"Yesterday I bought green flowers.",rawText:"Yesterday red, no green flowers."}));
  await create.call(service,{...base,localEdit:true,previousText:"current draft"});
  expect(rewrite).toHaveBeenLastCalledWith("Yesterday red, no green flowers.","current draft");
  expect(reviseDraft).not.toHaveBeenCalled();
 });
 it("does not introduce model editing for legacy build 51 requests",async()=>{
  const send=vi.fn().mockResolvedValue(undefined),rewrite=vi.fn(),reviseDraft=vi.fn().mockResolvedValue("legacy revision");
  const service=Object.create(BridgeService.prototype) as Record<string,unknown>;
  Object.assign(service,{send,config:{defaultCwd:"/tmp"},draftEditor:{rewrite},appServer:{reviseDraft},transcriber:{defaultBackend:"phonon",transcribe:vi.fn().mockResolvedValue("plain words")}});
  const create=service.createTranscription as (p:unknown)=>Promise<void>;
  const base={kind:"transcription.create",requestId:"old-test",threadId:null,mimeType:"audio/aac",audioBase64:Buffer.alloc(2048).toString("base64")};
  await create.call(service,base);
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({text:"plain words"}));
  await create.call(service,{...base,previousText:"old draft"});
  expect(reviseDraft).toHaveBeenCalledOnce();
  expect(rewrite).not.toHaveBeenCalled();
 });
});
