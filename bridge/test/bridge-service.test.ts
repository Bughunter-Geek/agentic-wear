import { describe, expect, it, vi } from "vitest";
import { BridgeService, publicError, publicRequestError } from "../src/bridge-service.js";

describe("BridgeService App Server transport", () => {
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
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      appServer: {
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
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      appServer: { submitTurn },
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
  });

  it("retries an encrypted pending prompt on the original thread with the same idempotency key", async () => {
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
