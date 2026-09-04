import { describe, expect, it, vi } from "vitest";
import { AppServerClient, parsePersistedFollowUpMode, supportsThreadQueue } from "../src/app-server-client.js";

type ClientInternals = {
  request: (method: string, params: unknown) => Promise<unknown>;
  handleNotification: (method: string, params: unknown) => Promise<void>;
  handleServerRequest: (id: string | number, method: string, params: unknown) => Promise<void>;
  write: (message: Record<string, unknown>) => void;
  controlledThreads: Set<string>;
  controlledTurnIds: Map<string, string>;
  watchReadyThreads: Set<string>;
  openDaemonSocket: () => Promise<void>;
  openStdio: () => void;
  initialize: () => Promise<void>;
  listSessions: () => Promise<unknown[]>;
  emitRecentTerminals: (
    session: {
      id: string;
      title: string;
      updatedAt: number;
      status: "active" | "idle" | "error" | "notLoaded";
      ownedByWear: boolean;
      canAcceptDirectInput: boolean;
      watchReady?: boolean;
    },
    newerThanMs: number,
  ) => Promise<void>;
  rememberRecentTerminals: (session: {
    id: string;
    title: string;
    updatedAt: number;
    status: "active" | "idle" | "error" | "notLoaded";
    ownedByWear: boolean;
    canAcceptDirectInput: boolean;
    watchReady?: boolean;
  }) => Promise<void>;
};

function thread(
  status: "notLoaded" | "idle" | "active" = "idle",
  canAcceptDirectInput = status !== "notLoaded",
) {
  return {
    id: "thread-1",
    preview: "Watch session",
    name: "Watch session",
    updatedAt: 1_787_900_000,
    status: { type: status },
    canAcceptDirectInput,
    parentThreadId: null,
    agentRole: null,
  };
}

function queuedResponse(params: unknown) {
  const clientUserMessageId = (params as { clientUserMessageId?: string }).clientUserMessageId ?? "watch-request";
  return {
    queuedSubmission: {
      id: "queued-1",
      clientUserMessageId,
      input: [],
    },
  };
}

function terminalTurnsResponse() {
  return { data: [{ id: "turn-old", status: "completed", completedAt: 1_787_900_000 }], nextCursor: null, backwardsCursor: null };
}

function startedQueueResponse() {
  return { turn: { id: "turn-watch", status: "inProgress" } };
}

function client(): AppServerClient {
  return new AppServerClient(new Set(), async () => {}, async () => {});
}

describe("AppServerClient session delivery", () => {
  it("falls back to a private App Server when Codex Desktop is closed", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.openDaemonSocket = vi.fn().mockRejectedValue(new Error("connect ENOENT app-server-control.sock"));
    internals.openStdio = vi.fn();
    internals.initialize = vi.fn().mockResolvedValue(undefined);
    internals.listSessions = vi.fn().mockResolvedValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await target.connect("daemon");

    expect(internals.openStdio).toHaveBeenCalledTimes(1);
    expect(internals.initialize).toHaveBeenCalledTimes(1);
    expect(internals.listSessions).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("private background App Server"));
    warn.mockRestore();
  });

  it("requires the App Server release that provides cross-client queueing", () => {
    expect(supportsThreadQueue("codex_cli_rs/0.149.0")).toBe(false);
    expect(supportsThreadQueue("codex_cli_rs/0.150.0-alpha.12.2")).toBe(true);
    expect(supportsThreadQueue("codex_cli_rs/1.0.0")).toBe(true);
    expect(supportsThreadQueue("unknown")).toBe(false);
  });

  it("reads the active follow-up preference only from the Codex desktop section", () => {
    expect(parsePersistedFollowUpMode([
      "followUpQueueMode = \"steer\"",
      "[desktop]",
      "followUpQueueMode = \"queue\"",
      "[desktop.appearanceDarkChromeTheme]",
      "followUpQueueMode = \"steer\"",
    ].join("\n"))).toBe("queue");
    expect(parsePersistedFollowUpMode("[desktop]\nfollowUpQueueMode = \"interrupt\"\n")).toBe("steer");
    expect(parsePersistedFollowUpMode("[desktop]\nappearanceTheme = \"system\"\n")).toBe("steer");
  });

  it("does not resume a thread again when thread/started already proves it is loaded", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(() => Promise.reject(new Error("request must not be called")));

    await internals.handleNotification("thread/started", { thread: thread("idle") });

    expect(internals.request).not.toHaveBeenCalled();
  });

  it("wakes an idle unloaded session and starts the exact queued submission", async () => {
    const target = new AppServerClient(new Set(["thread-1"]), async () => {}, async () => {});
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") return Promise.resolve(terminalTurnsResponse());
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/start") return Promise.resolve(startedQueueResponse());
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Please continue.", "/tmp")).resolves.toEqual({
      threadId: "thread-1",
      created: false,
      state: "running",
      selectionApplied: true,
    });

    expect(methods).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/resume",
      "thread/settings/update",
      "thread/queue/add",
      "thread/queue/start",
    ]);
    expect(vi.mocked(internals.request).mock.calls.at(-1)?.[1]).toEqual({
      threadId: "thread-1",
      queuedSubmissionId: "queued-1",
    });
    expect(vi.mocked(internals.request).mock.calls.find(([method]) => method === "thread/resume")?.[1])
      .toEqual({
        threadId: "thread-1",
        excludeTurns: true,
        config: { model_reasoning_effort: "medium" },
      });
    expect(internals.controlledTurnIds.get("thread-1")).toBe("turn-watch");
    expect(internals.watchReadyThreads.has("thread-1")).toBe(true);
  });

  it("steers a foreign active turn immediately with the selected configuration", async () => {
    const sendMessageToThread = vi.fn(async (
      _message: unknown,
      beforeDispatch: () => Promise<void>,
    ) => beforeDispatch());
    const beforeExternalDispatch = vi.fn().mockResolvedValue(undefined);
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      async () => {},
      () => ({ model: "gpt-5.6-sol", effort: "max" }),
      { sendMessageToThread, close: vi.fn().mockResolvedValue(undefined) },
      () => "queue",
    );
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list" && (params as { itemsView?: string }).itemsView === "notLoaded") {
        return Promise.resolve({
          data: [{ id: "turn-mobile", status: "inProgress", completedAt: null }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{
            id: "turn-mobile",
            status: "inProgress",
            items: [{
              id: "user-before",
              type: "userMessage",
              content: [{ type: "text", text: "Earlier phone prompt" }],
            }],
          }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "turn/steer") return Promise.resolve({ turnId: "turn-mobile" });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "After the phone finishes.",
      "/tmp",
      "gpt-5.6-sol",
      "xhigh",
      "watch-active-owner-1",
      beforeExternalDispatch,
      "steer",
    )).resolves.toEqual({
      threadId: "thread-1",
      created: false,
      state: "running",
      selectionApplied: true,
      steered: true,
      followUpMode: "steer",
    });

    expect(methods).toEqual(["thread/read", "thread/turns/list", "thread/settings/update", "turn/steer"]);
    expect(sendMessageToThread).not.toHaveBeenCalled();
    expect(beforeExternalDispatch).not.toHaveBeenCalled();
    expect(methods).not.toContain("thread/resume");
    expect(methods).not.toContain("thread/queue/start");
    expect(methods).not.toContain("thread/queue/delete");
  });

  it("uses the Codex default to queue behind a foreign active turn", async () => {
    const sendMessageToThread = vi.fn();
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      async () => {},
      () => ({ model: "gpt-5.6-luna", effort: "high" }),
      { sendMessageToThread, close: vi.fn().mockResolvedValue(undefined) },
      () => "queue",
    );
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{ id: "turn-mobile", status: "inProgress", completedAt: null }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      if (method === "thread/settings/update") return Promise.resolve({});
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Run this after the current turn.",
      "/tmp",
      "gpt-5.6-luna",
      "high",
      "watch-default-queue-1",
    )).resolves.toEqual({
      threadId: "thread-1",
      created: false,
      state: "queued",
      selectionApplied: true,
      followUpMode: "queue",
    });

    expect(methods).toEqual(["thread/read", "thread/turns/list", "thread/settings/update", "thread/queue/add"]);
    expect(sendMessageToThread).not.toHaveBeenCalled();
  });

  it("queues an explicit model change canonically behind the foreign turn", async () => {
    const sendMessageToThread = vi.fn();
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      async () => {},
      () => ({ model: "gpt-5.6-sol", effort: "max" }),
      { sendMessageToThread, close: vi.fn().mockResolvedValue(undefined) },
      () => "steer",
    );
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("active", false) });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Use Luna next.",
      "/tmp",
      "gpt-5.6-luna",
      "high",
      "watch-explicit-queue-1",
      undefined,
      "queue",
    )).resolves.toEqual({
      threadId: "thread-1",
      created: false,
      state: "queued",
      selectionApplied: true,
      followUpMode: "queue",
    });

    expect(methods).toEqual(["thread/read", "thread/settings/update", "thread/queue/add"]);
    expect(sendMessageToThread).not.toHaveBeenCalled();
  });

  it("shows an accepted Watch prompt immediately while canonical history catches up", async () => {
    const onAgentOutput = vi.fn().mockResolvedValue(undefined);
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      onAgentOutput,
      () => ({ model: "gpt-5.6-luna", effort: "high" }),
      null,
      () => "queue",
    );
    const internals = target as unknown as ClientInternals;
    let historyReads = 0;
    internals.request = vi.fn((method: string, params: unknown) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("active", false) });
      if (method === "thread/turns/list") {
        historyReads += 1;
        return Promise.resolve({ data: [], nextCursor: null, backwardsCursor: null });
      }
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await target.chatSnapshot("thread-1", true);
    await target.submitTurn(
      "thread-1",
      "Visible on the Watch immediately.",
      "/tmp",
      "gpt-5.6-luna",
      "high",
      "watch-visible-1",
      undefined,
      "queue",
    );

    const snapshot = await target.chatSnapshot("thread-1");
    expect(snapshot.messages).toContainEqual(expect.objectContaining({
      id: "watch-visible-1",
      role: "user",
      text: "Visible on the Watch immediately.",
    }));
    expect(historyReads).toBe(1);
    expect(onAgentOutput).toHaveBeenCalledWith("thread-1");
  });

  it("submits a different Watch configuration through the same-chat desktop route", async () => {
    const sendMessageToThread = vi.fn(async (
      _message: unknown,
      beforeDispatch: () => Promise<void>,
    ) => beforeDispatch());
    const beforeExternalDispatch = vi.fn().mockResolvedValue(undefined);
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      async () => {},
      () => ({ model: "gpt-5.6-sol", effort: "max" }),
      { sendMessageToThread, close: vi.fn().mockResolvedValue(undefined) },
    );
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list" && (params as { itemsView?: string }).itemsView === "notLoaded") {
        return Promise.resolve({
          data: [{ id: "turn-mobile", status: "completed", completedAt: 1_787_900_000 }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{
            id: "turn-mobile",
            status: "completed",
            items: [{
              id: "user-before",
              type: "userMessage",
              content: [{ type: "text", text: "Earlier phone prompt" }],
            }],
          }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle", true) });
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      if (method === "thread/queue/start") return Promise.resolve({ turn: { id: "turn-watch" } });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Use Luna at high reasoning.",
      "/tmp",
      "gpt-5.6-luna",
      "high",
      "watch-model-change-1",
      beforeExternalDispatch,
    )).resolves.toEqual({
      threadId: "thread-1",
      created: false,
      state: "running",
      selectionApplied: true,
    });

    expect(sendMessageToThread).not.toHaveBeenCalled();
    expect(beforeExternalDispatch).not.toHaveBeenCalled();
    expect(methods).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/resume",
      "thread/settings/update",
      "thread/queue/add",
      "thread/queue/start",
    ]);
  });

  it("routes a configuration change without waiting for a queue probe", async () => {
    const sendMessageToThread = vi.fn(async (
      _message: unknown,
      beforeDispatch: () => Promise<void>,
    ) => beforeDispatch());
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      async () => {},
      () => ({ model: "gpt-5.6-sol", effort: "max" }),
      { sendMessageToThread, close: vi.fn().mockResolvedValue(undefined) },
    );
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list" && (params as { itemsView?: string }).itemsView === "notLoaded") {
        return Promise.resolve(terminalTurnsResponse());
      }
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{ id: "turn-old", status: "completed", items: [] }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle", true) });
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      if (method === "thread/queue/start") return Promise.resolve({ turn: { id: "turn-watch" } });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Use Terra after the queued turn.",
      "/tmp",
      "gpt-5.6-terra",
      "high",
      "watch-model-change-queued-1",
    )).resolves.toEqual({
      threadId: "thread-1",
      created: false,
      state: "running",
      selectionApplied: true,
    });

    expect(methods).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/resume",
      "thread/settings/update",
      "thread/queue/add",
      "thread/queue/start",
    ]);
    expect(methods).not.toContain("thread/queue/list");
    expect(sendMessageToThread).not.toHaveBeenCalled();
  });

  it("reconciles a same-turn desktop handoff before any retry", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      expect(method).toBe("thread/turns/list");
      return Promise.resolve({
        data: [{
          id: "turn-mobile",
          status: "inProgress",
          items: [
            {
              id: "user-before",
              type: "userMessage",
              content: [{ type: "text", text: "Earlier phone prompt" }],
            },
            {
              id: "user-watch",
              type: "userMessage",
              content: [{
                type: "text",
                text: [
                  "<codex_delegation>",
                  "  <source_thread_id>thread-1</source_thread_id>",
                  "  <input>Use &lt;Luna&gt; &amp; max.</input>",
                  "</codex_delegation>",
                ].join("\n"),
              }],
            },
          ],
        }],
        nextCursor: null,
        backwardsCursor: null,
      });
    });

    await expect(target.reconcileExternalTurn(
      "thread-1",
      "Use <Luna> & max.",
      { attemptedAt: Date.now(), userMessageIds: ["user-before"] },
    )).resolves.toBe("delivered");
  });

  it("waits through the reconciliation grace period before allowing a retry", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn().mockResolvedValue({
      data: [{ id: "turn-mobile", status: "inProgress", items: [] }],
      nextCursor: null,
      backwardsCursor: null,
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);

    await expect(target.reconcileExternalTurn(
      "thread-1",
      "One exact Watch prompt.",
      { attemptedAt: 1_799_999_970_001, userMessageIds: [] },
    )).resolves.toBe("waiting");
    await expect(target.reconcileExternalTurn(
      "thread-1",
      "One exact Watch prompt.",
      { attemptedAt: 1_799_999_939_999, userMessageIds: [] },
    )).resolves.toBe("retry");

    now.mockRestore();
  });

  it("steers a foreign active turn even when its persisted settings already match", async () => {
    const sendMessageToThread = vi.fn(async (
      _message: unknown,
      beforeDispatch: () => Promise<void>,
    ) => beforeDispatch());
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      async () => {},
      () => ({ model: "gpt-5.6-luna", effort: "max" }),
      { sendMessageToThread, close: vi.fn().mockResolvedValue(undefined) },
    );
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list" && (params as { itemsView?: string }).itemsView === "notLoaded") {
        return Promise.resolve({
          data: [{ id: "turn-mobile", status: "inProgress", completedAt: null }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{ id: "turn-mobile", status: "inProgress", items: [] }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "turn/steer") return Promise.resolve({ turnId: "turn-mobile" });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Use the already-selected configuration.",
      "/tmp",
      "gpt-5.6-luna",
      "max",
      "watch-matching-owner-1",
    )).resolves.toEqual({
      threadId: "thread-1",
      created: false,
      state: "running",
      selectionApplied: true,
      steered: true,
      followUpMode: "steer",
    });

    expect(methods).toEqual(["thread/read", "thread/turns/list", "thread/settings/update", "turn/steer"]);
    expect(sendMessageToThread).not.toHaveBeenCalled();
  });

  it("waits without queueing when an idle owner blocks the requested settings", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") return Promise.resolve(terminalTurnsResponse());
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/resume") {
        return Promise.reject(new Error("thread thread-1 already has an active writer"));
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Continue when the owning client is ready.",
      "/tmp",
      "gpt-5.6-terra",
      "high",
      "watch-owner-held-1",
    )).resolves.toEqual({
      threadId: "thread-1",
      created: false,
      state: "queued",
      selectionApplied: true,
    });

    expect(methods).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/resume",
      "thread/queue/add",
    ]);
    expect(methods).not.toContain("thread/queue/delete");
    expect(internals.controlledThreads.has("thread-1")).toBe(false);
    expect(internals.watchReadyThreads.has("thread-1")).toBe(true);
    expect(vi.mocked(internals.request).mock.calls.find(([method]) => method === "thread/resume")?.[1])
      .toEqual({
        threadId: "thread-1",
        excludeTurns: true,
        model: "gpt-5.6-terra",
        config: { model_reasoning_effort: "high" },
      });

    internals.request = vi.fn((method: string) => {
      if (method === "thread/list") {
        return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });
    await expect(target.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: "thread-1", watchReady: false }),
    ]);
  });

  it("recognizes resume auto-start without retrying the Watch message", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    let turnReads = 0;
    let queueAdds = 0;
    internals.request = vi.fn((method: string, params: unknown) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") {
        turnReads += 1;
        return Promise.resolve({
          data: [{
            id: turnReads === 1 ? "turn-old" : "turn-watch",
            status: turnReads === 1 ? "completed" : "completed",
            completedAt: 1_787_900_000 + turnReads,
          }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      if (method === "thread/queue/add") {
        queueAdds += 1;
        return Promise.resolve(queuedResponse(params));
      }
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/start") return Promise.reject(new Error("queued submission not found: queued-1"));
      if (method === "thread/queue/delete") return Promise.resolve({ deleted: false });
      if (method === "thread/unsubscribe") return Promise.resolve({ status: "unsubscribed" });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Run once despite the resume race.",
      "/tmp",
      null,
      "medium",
      "watch-race-1",
    )).resolves.toMatchObject({ threadId: "thread-1", created: false, state: "running" });

    expect(queueAdds).toBe(1);
    expect(turnReads).toBe(2);
    expect(vi.mocked(internals.request).mock.calls.find(([method]) => method === "thread/resume")?.[1])
      .toEqual({
        threadId: "thread-1",
        excludeTurns: true,
        config: { model_reasoning_effort: "medium" },
      });
    expect(internals.controlledTurnIds.has("thread-1")).toBe(false);
  });

  it("retries transient synchronization before queueing an existing session exactly once", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    let readAttempts = 0;
    let queuedParams: Record<string, unknown> | null = null;
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") {
        readAttempts += 1;
        if (readAttempts === 1) return Promise.reject(new Error("No rollout found for thread thread-1"));
        return Promise.resolve({ thread: thread("notLoaded") });
      }
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      if (method === "thread/turns/list") return Promise.resolve(terminalTurnsResponse());
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      if (method === "thread/queue/add") {
        queuedParams = params as Record<string, unknown>;
        return Promise.resolve(queuedResponse(params));
      }
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/start") return Promise.resolve(startedQueueResponse());
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Continue safely.",
      "/tmp",
      "gpt-5.6-luna",
      "low",
      "watch-request-1",
    )).resolves.toMatchObject({ threadId: "thread-1", created: false, state: "running" });

    expect(readAttempts).toBe(2);
    expect(methods.filter((method) => method === "thread/queue/add")).toHaveLength(1);
    expect(queuedParams).toMatchObject({
      threadId: "thread-1",
      clientUserMessageId: "watch-request-1",
    });
  });

  it("reuses the watch idempotency key when queue serialization is cancelled", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const queueIds: unknown[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      if (method === "thread/turns/list") return Promise.resolve(terminalTurnsResponse());
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      if (method === "thread/queue/add") {
        queueIds.push((params as Record<string, unknown>).clientUserMessageId);
        if (queueIds.length === 1) return Promise.reject(new Error("bs1 was cancelled"));
        return Promise.resolve(queuedResponse(params));
      }
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/start") return Promise.resolve(startedQueueResponse());
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Continue once.",
      "/tmp",
      null,
      "medium",
      "watch-request-2",
    )).resolves.toMatchObject({ threadId: "thread-1", created: false, state: "running" });

    expect(queueIds).toEqual(["watch-request-2", "watch-request-2"]);
  });

  it("applies the selected model and reasoning effort before queueing", async () => {
    const target = new AppServerClient(new Set(["thread-1"]), async () => {}, async () => {});
    const internals = target as unknown as ClientInternals;
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Use the selected settings.", "/tmp", "gpt-5.6-terra", "xhigh"))
      .resolves.toMatchObject({ threadId: "thread-1", created: false, state: "queued" });

    expect(requests[1]).toMatchObject({
      method: "thread/settings/update",
      params: {
        threadId: "thread-1",
        model: "gpt-5.6-terra",
        effort: "xhigh",
      },
    });
    expect(requests.at(-1)?.method).toBe("thread/queue/add");
  });

  it("forwards the watch request ID as the App Server user-message idempotency key", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await target.submitTurn(
      "thread-1",
      "Send this once.",
      "/tmp",
      null,
      "medium",
      "watch-request-1",
    );

    expect(requests.find(({ method }) => method === "thread/queue/add")?.params)
      .toMatchObject({ clientUserMessageId: "watch-request-1" });
  });

  it("normalizes the model catalog into watch-safe picker entries", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      expect(method).toBe("model/list");
      return Promise.resolve({
        data: [{
          id: "gpt-5.6-terra",
          model: "gpt-5.6-terra",
          displayName: "GPT-5.6-Terra",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Fast" },
            { reasoningEffort: "xhigh", description: "Deep" },
          ],
          hidden: false,
        }],
        nextCursor: null,
      });
    });

    await expect(target.listModels()).resolves.toEqual([{
      id: "gpt-5.6-terra",
      model: "gpt-5.6-terra",
      displayName: "GPT-5.6-Terra",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "xhigh"],
    }]);
  });

  it("reports realtime voice as unavailable when GPT-Live-1 is absent from the Codex catalog", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/realtime/listVoices") {
        return Promise.resolve({
          voices: { v1: ["cove"], v2: ["marin"], defaultV1: "cove", defaultV2: "marin" },
        });
      }
      if (method === "model/list") {
        return Promise.resolve({
          data: [{
            id: "gpt-5.6-terra",
            model: "gpt-5.6-terra",
            displayName: "GPT-5.6-Terra",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [],
          }],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.realtimeVoiceCapability()).resolves.toEqual({
      available: false,
      realtimeApiAvailable: true,
      voices: { v1: ["cove"], v2: ["marin"], defaultV1: "cove", defaultV2: "marin" },
      gptLiveModelAvailable: false,
      blocker: "gpt_live_model_unavailable",
    });
    expect(internals.request).toHaveBeenCalledWith("thread/realtime/listVoices", {});
  });

  it("keeps realtime voice disabled when GPT-Live-1 is cataloged but no watch transport exists", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/realtime/listVoices") {
        return Promise.resolve({
          voices: { v1: ["cove"], v2: ["marin"], defaultV1: "cove", defaultV2: "marin" },
        });
      }
      if (method === "model/list") {
        return Promise.resolve({
          data: [{
            id: "gpt-live-1",
            model: "gpt-live-1",
            displayName: "GPT-Live-1",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [],
          }],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.realtimeVoiceCapability()).resolves.toMatchObject({
      available: false,
      realtimeApiAvailable: true,
      gptLiveModelAvailable: true,
      blocker: "watch_transport_not_implemented",
    });
  });

  it("reports an unavailable realtime API without checking the model catalog", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(() => Promise.reject(new Error("unknown variant")));

    await expect(target.realtimeVoiceCapability()).resolves.toMatchObject({
      available: false,
      realtimeApiAvailable: false,
      gptLiveModelAvailable: false,
      blocker: "realtime_api_unavailable",
    });
    expect(internals.request).toHaveBeenCalledTimes(1);
  });

  it("queues an idle foreign session without resume, start, or steer", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Please continue.",
      "/tmp",
      "gpt-5.6-sol",
      "high",
      "watch-request-idle",
    )).resolves.toMatchObject({
      threadId: "thread-1",
      created: false,
      state: "queued",
    });

    expect(requests.map(({ method }) => method)).toEqual([
      "thread/read",
      "thread/settings/update",
      "thread/queue/add",
    ]);
    expect(requests[1]?.params).toEqual({
      threadId: "thread-1",
      model: "gpt-5.6-sol",
      effort: "high",
    });
    expect(requests[2]?.params).toEqual({
      threadId: "thread-1",
      clientUserMessageId: "watch-request-idle",
      input: [{ type: "text", text: "Please continue.", text_elements: [] }],
    });
  });

  it("steers an active foreign prompt directly through the shared App Server", async () => {
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      async () => {},
      () => ({ model: "gpt-5.6-sol", effort: "medium" }),
    );
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("active", false) });
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{ id: "turn-mobile", status: "inProgress", completedAt: null }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "turn/steer") return Promise.resolve({ turnId: "turn-mobile" });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Run after the current turn.", "/tmp")).resolves.toMatchObject({
      threadId: "thread-1",
      created: false,
      state: "running",
      selectionApplied: true,
      steered: true,
    });
    expect(methods).toEqual(["thread/read", "thread/turns/list", "thread/settings/update", "turn/steer"]);
    expect(methods).not.toContain("thread/resume");
    expect(methods).toContain("turn/steer");
    expect(methods).not.toContain("turn/start");
  });

  it("steers an observed foreign turn using the current active turn id", async () => {
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      async () => {},
      () => ({ model: "gpt-5.6-sol", effort: "medium" }),
    );
    const internals = target as unknown as ClientInternals;
    await internals.handleNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-stale" },
    });
    const methods: string[] = [];
    internals.request = vi.fn((method: string) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("active", true) });
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{ id: "turn-current", status: "inProgress", completedAt: null }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "turn/steer") return Promise.resolve({ turnId: "turn-current" });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Steer only through an authorized route.", "/tmp"))
      .resolves.toMatchObject({ threadId: "thread-1", created: false, state: "running", steered: true });
    expect(methods).toEqual(["thread/read", "thread/turns/list", "thread/settings/update", "turn/steer"]);
  });

  it("steers a Watch-controlled active turn directly with the exact turn id", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.controlledThreads.add("thread-1");
    internals.controlledTurnIds.set("thread-1", "turn-watch");
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/read") return Promise.resolve({ thread: thread("active", true) });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "turn/steer") return Promise.resolve({ turnId: "turn-watch" });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Adjust the work in progress.",
      "/tmp",
      "gpt-5.6-luna",
      "high",
      "watch-steer-1",
    )).resolves.toEqual({
      threadId: "thread-1",
      created: false,
      state: "running",
      selectionApplied: true,
      steered: true,
      followUpMode: "steer",
    });

    expect(requests).toEqual([
      {
        method: "thread/read",
        params: { threadId: "thread-1", includeTurns: false },
      },
      {
        method: "thread/settings/update",
        params: { threadId: "thread-1", model: "gpt-5.6-luna", effort: "high" },
      },
      {
        method: "turn/steer",
        params: {
          threadId: "thread-1",
          expectedTurnId: "turn-watch",
          input: [{ type: "text", text: "Adjust the work in progress.", text_elements: [] }],
          clientUserMessageId: "watch-steer-1",
        },
      },
    ]);
    expect(internals.watchReadyThreads.has("thread-1")).toBe(true);
  });

  it("queues behind a Watch-controlled turn with the selected next-turn configuration", async () => {
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      async () => {},
      () => ({ model: "gpt-5.6-sol", effort: "high" }),
      null,
      () => "steer",
    );
    const internals = target as unknown as ClientInternals;
    internals.controlledThreads.add("thread-1");
    internals.controlledTurnIds.set("thread-1", "turn-watch");
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/read") return Promise.resolve({ thread: thread("active", true) });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Do this after the current work.",
      "/tmp",
      "gpt-5.6-luna",
      "max",
      "watch-controlled-queue-1",
      undefined,
      "queue",
    )).resolves.toEqual({
      threadId: "thread-1",
      created: false,
      state: "queued",
      selectionApplied: true,
      followUpMode: "queue",
    });

    expect(requests.map(({ method }) => method)).toEqual([
      "thread/read",
      "thread/settings/update",
      "thread/queue/add",
    ]);
    expect(requests[1]?.params).toEqual({
      threadId: "thread-1",
      model: "gpt-5.6-luna",
      effort: "max",
    });
    expect(requests.map(({ method }) => method)).not.toContain("turn/steer");
  });

  it("does not start or steer when queue insertion fails", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/add") return Promise.reject(new Error("queue unavailable"));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Do not duplicate this.", "/tmp"))
      .rejects.toThrow("queue unavailable");
    const methods = vi.mocked(internals.request).mock.calls.map(([method]) => method);
    expect(methods).toEqual(["thread/read", "thread/settings/update", "thread/queue/add"]);
  });

  it("starts a newly created session with the exact selected configuration", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, _params: unknown) => {
      methods.push(method);
      if (method === "thread/start") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "turn/start") return Promise.resolve({ threadId: "thread-1", turn: { id: "turn-watch" } });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(null, "First watch message.", "/tmp", null, "low", "watch-new-1"))
      .resolves.toEqual({
        threadId: "thread-1",
        created: true,
        state: "running",
        selectionApplied: true,
      });
    expect(methods).toEqual([
      "thread/start",
      "thread/settings/update",
      "turn/start",
    ]);
    expect(vi.mocked(internals.request).mock.calls.at(-1)?.[1]).toMatchObject({
      threadId: "thread-1",
      clientUserMessageId: "watch-new-1",
      effort: "low",
    });
  });

  it("delivers the terminal event before releasing its thread subscription", async () => {
    const order: string[] = [];
    const target = new AppServerClient(new Set(["thread-1"]), async () => {
      order.push("terminal");
    }, async () => {});
    const internals = target as unknown as ClientInternals;
    internals.controlledThreads.add("thread-1");
    internals.controlledTurnIds.set("thread-1", "turn-1");
    internals.watchReadyThreads.add("thread-1");
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/unsubscribe") {
        order.push("unsubscribe");
        return Promise.resolve({ status: "unsubscribed" });
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await internals.handleNotification("turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        completedAt: 1_787_900_010,
        error: null,
      },
    });

    expect(order).toEqual(["terminal", "unsubscribe"]);
    expect(internals.controlledThreads.has("thread-1")).toBe(false);
    expect(internals.watchReadyThreads.has("thread-1")).toBe(false);
  });

  it("makes unsubscribe failures visible and retries without duplicating a turn", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    internals.controlledThreads.add("thread-1");
    internals.controlledTurnIds.set("thread-1", "turn-1");
    internals.request = vi.fn((method: string) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/unsubscribe") return Promise.reject(new Error("writer lease retained"));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await internals.handleNotification("turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        completedAt: 1_787_900_010,
        error: null,
      },
    });

    expect(methods).toEqual([
      "thread/read",
      "thread/unsubscribe",
      "thread/unsubscribe",
      "thread/unsubscribe",
    ]);
    expect(methods).not.toContain("turn/start");
    expect(methods).not.toContain("turn/steer");
    expect(internals.controlledThreads.has("thread-1")).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("subscription remains held"));
    vi.restoreAllMocks();
  });

  it("best-effort releases retained thread subscriptions before close", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.controlledThreads.add("thread-1");
    internals.request = vi.fn((method: string, params: unknown) => {
      expect(method).toBe("thread/unsubscribe");
      expect(params).toEqual({ threadId: "thread-1" });
      return Promise.resolve({ status: "unsubscribed" });
    });

    await target.close();

    expect(internals.request).toHaveBeenCalledTimes(1);
    expect(internals.controlledThreads.size).toBe(0);
  });

  it("does not acquire ownership when another client's status notification is observed", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(() => Promise.reject(new Error("must remain observation-only")));

    await internals.handleNotification("thread/status/changed", {
      threadId: "thread-1",
      status: { type: "active" },
    });

    expect(internals.request).not.toHaveBeenCalled();
    expect(internals.controlledThreads.size).toBe(0);
  });

  it("streams the active indicator as soon as an observed turn starts", async () => {
    const onAgentOutput = vi.fn().mockResolvedValue(undefined);
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      onAgentOutput,
    );
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/turns/list") return Promise.resolve({ data: [], nextCursor: null, backwardsCursor: null });
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await target.chatSnapshot("thread-1");
    await internals.handleNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1" },
    });

    expect(onAgentOutput).toHaveBeenCalledWith("thread-1");
    await expect(target.chatSnapshot("thread-1")).resolves.toMatchObject({ status: "active" });
  });

  it("keeps a foreign active turn working across forced chat refreshes", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    let newestStatus: "completed" | "inProgress" = "completed";
    internals.request = vi.fn((method: string) => {
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{
            id: "turn-1",
            status: newestStatus,
            items: [{ id: "assistant-1", type: "agentMessage", phase: "final_answer", text: "Latest reply" }],
          }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      if (method === "thread/unsubscribe") return Promise.resolve({ status: "unsubscribed" });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await target.listSessions();
    await expect(target.chatSnapshot("thread-1", true)).resolves.toMatchObject({ status: "idle" });
    await internals.handleNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1" },
    });
    newestStatus = "inProgress";

    await expect(target.chatSnapshot("thread-1", true)).resolves.toMatchObject({ status: "active" });

    newestStatus = "completed";
    await expect(target.chatSnapshot("thread-1", true)).resolves.toMatchObject({ status: "idle" });
  });

  it("streams observed thread status changes without waiting for the idle poll", async () => {
    const onAgentOutput = vi.fn().mockResolvedValue(undefined);
    const target = new AppServerClient(
      new Set(),
      async () => {},
      async () => {},
      () => {},
      onAgentOutput,
    );
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/turns/list") return Promise.resolve({ data: [], nextCursor: null, backwardsCursor: null });
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      if (method === "thread/list") return Promise.resolve({ data: [thread("active")], nextCursor: null });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await target.chatSnapshot("thread-1");
    await internals.handleNotification("thread/status/changed", {
      threadId: "thread-1",
      status: { type: "active" },
    });

    expect(onAgentOutput).toHaveBeenCalledWith("thread-1");
    expect(internals.controlledThreads.size).toBe(0);
    await expect(target.chatSnapshot("thread-1")).resolves.toMatchObject({ status: "active" });
  });

  it("does not start a foreign-thread prompt when its sticky settings update fails", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.reject(new Error("settings denied"));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Do not send this.", "/tmp", "gpt-5.6-sol", "max"))
      .rejects.toThrow("settings denied");
    expect(internals.request).toHaveBeenCalledTimes(2);
  });

  it("keeps the owning client's model when Auto is selected", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Use Auto.", "/tmp", null, "medium"))
      .resolves.toMatchObject({ threadId: "thread-1", created: false, state: "queued" });

    expect(requests[1]?.params).toEqual({ threadId: "thread-1", effort: "medium" });
    expect(requests[2]?.params).not.toHaveProperty("model");
  });

  it("preserves user and assistant roles plus Markdown in chat snapshots", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string, params: unknown) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/turns/list") {
        expect(params).toEqual({
          threadId: "thread-1",
          limit: 6,
          sortDirection: "desc",
          itemsView: "summary",
        });
        return Promise.resolve({
          data: [{
            id: "turn-1",
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [{ type: "text", text: "Please keep **this** formatting.\n\n- One\n- Two" }],
              },
              {
                id: "assistant-1",
                type: "agentMessage",
                phase: "final_answer",
                text: "## Done\n\nUsed `code` and **bold**.",
              },
            ],
          }],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    const snapshot = await target.chatSnapshot("thread-1");

    expect(snapshot.messages).toEqual([
      {
        id: "user-1",
        turnId: "turn-1",
        role: "user",
        kind: "message",
        text: "Please keep **this** formatting.\n\n- One\n- Two",
        phase: "unknown",
        approvalId: null,
        canControl: false,
        resolved: false,
      },
      {
        id: "assistant-1",
        turnId: "turn-1",
        role: "assistant",
        kind: "message",
        text: "## Done\n\nUsed `code` and **bold**.",
        phase: "final_answer",
        approvalId: null,
        canControl: false,
        resolved: false,
      },
    ]);
  });

  it("replaces attachment metadata and local image paths with a compact watch notice", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{
            id: "turn-images",
            items: [{
              id: "user-images",
              type: "userMessage",
              content: [
                {
                  type: "text",
                  text: "# Files mentioned by the user:\n\n## Photo 1.jpg: /tmp/codex-remote-attachments/secret/Photo-1.jpg\n## Photo 2.jpg: /tmp/codex-remote-attachments/secret/Photo-2.jpg\n\n## My request:\nPlease diagnose these screenshots.",
                },
                { type: "localImage", path: "/tmp/codex-remote-attachments/secret/Photo-1.jpg" },
                { type: "localImage", path: "/tmp/codex-remote-attachments/secret/Photo-2.jpg" },
              ],
            }],
          }],
          nextCursor: null,
        });
      }
      if (method === "thread/list") {
        return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    const snapshot = await target.chatSnapshot("thread-1", true);
    expect(snapshot.messages[0]?.text).toBe(
      "Please diagnose these screenshots.\n\n2 images attached. View on Android or iOS.",
    );
    expect(snapshot.messages[0]?.text).not.toContain("/tmp/");
    expect(snapshot.messages[0]?.text).not.toContain("Files mentioned");

    const sessions = await target.listSessions();
    expect(sessions[0]?.watchReady).toBe(false);
  });

  it("retries a transient missing rollout before declaring a listed chat unavailable", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    let historyAttempts = 0;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      if (method === "thread/turns/list") {
        historyAttempts += 1;
        if (historyAttempts === 1) return Promise.reject(new Error("No rollout found for thread thread-1"));
        return Promise.resolve({
          data: [{
            id: "turn-1",
            items: [{ id: "assistant-1", type: "agentMessage", phase: "final_answer", text: "Recovered" }],
          }],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.chatSnapshot("thread-1", true)).resolves.toEqual(expect.objectContaining({
      threadId: "thread-1",
      messages: [expect.objectContaining({ text: "Recovered" })],
    }));
    expect(historyAttempts).toBe(2);
    expect(internals.request).toHaveBeenCalledWith("thread/list", expect.objectContaining({ limit: 50 }));
  });

  it("retries a cancelled history serialization instead of leaking its internal task id", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    let historyAttempts = 0;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      if (method === "thread/turns/list") {
        historyAttempts += 1;
        if (historyAttempts === 1) return Promise.reject(new Error("bs1 was cancelled"));
        return Promise.resolve({
          data: [{
            id: "turn-1",
            items: [{ id: "assistant-1", type: "agentMessage", phase: "final_answer", text: "Recovered" }],
          }],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.chatSnapshot("thread-1", true)).resolves.toEqual(expect.objectContaining({
      messages: [expect.objectContaining({ text: "Recovered" })],
    }));
    expect(historyAttempts).toBe(2);
  });

  it("returns only the newest five assistant paragraphs in chronological order", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("active") });
      if (method !== "thread/turns/list") return Promise.reject(new Error(`Unexpected method ${method}`));
      return Promise.resolve({
        data: [
          {
            id: "turn-2",
            items: [{ id: "message-2", type: "agentMessage", phase: "final_answer", text: "Fourth\n\nFifth\n\nSixth" }],
          },
          {
            id: "turn-1",
            items: [
              { id: "message-1", type: "agentMessage", phase: "commentary", text: "First\n\nSecond\n\nThird" },
            ],
          },
        ],
        nextCursor: null,
      });
    });

    const snapshot = await target.chatSnapshot("thread-1");

    expect(snapshot.paragraphs.map(({ text }) => text)).toEqual(["Second", "Third", "Fourth", "Fifth", "Sixth"]);
    expect(snapshot.paragraphs.at(-1)?.phase).toBe("final_answer");
  });

  it("streams agent deltas from its bounded cache without reloading full turn history", async () => {
    const outputThreads: string[] = [];
    const target = new AppServerClient(new Set(), async () => {}, async () => {}, () => {}, async (threadId) => {
      outputThreads.push(threadId);
    });
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("active") });
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{ id: "turn-1", items: [{ id: "message-1", type: "agentMessage", phase: "commentary", text: "Working" }] }],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await target.chatSnapshot("thread-1");
    await internals.handleNotification("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "message-1",
      delta: " safely",
    });
    const snapshot = await target.chatSnapshot("thread-1");

    expect(snapshot.paragraphs.at(-1)?.text).toBe("Working safely");
    expect(outputThreads).toEqual(["thread-1"]);
    expect(methods).toEqual(["thread/read", "thread/turns/list", "thread/queue/list"]);
  });

  it("uploads explicit thumbs feedback without logs and tags the exact response", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string, params: unknown) => {
      expect(method).toBe("feedback/upload");
      expect(params).toEqual({
        classification: "bad_result",
        threadId: "thread-1",
        includeLogs: false,
        tags: {
          turn_id: "turn-1",
          item_id: "assistant-1",
          source: "agentic-wear",
        },
      });
      return Promise.resolve({ threadId: "feedback-1" });
    });

    await expect(target.submitFeedback("thread-1", "turn-1", "assistant-1", "disliked"))
      .resolves.toBeUndefined();
  });

  it("grants the exact requested permission profile for only the current turn", async () => {
    const approvals: Array<{ approvalId: string; canControl: boolean }> = [];
    const longReason = `Allow this turn to write its test artifact? ${"detail ".repeat(120)}`;
    const target = new AppServerClient(new Set(["thread-1"]), async () => {}, async (event) => {
      approvals.push({ approvalId: event.approvalId, canControl: event.canControl });
    });
    const internals = target as unknown as ClientInternals;
    const writes: Array<Record<string, unknown>> = [];
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("active") });
      if (method === "thread/turns/list") return Promise.resolve({ data: [], nextCursor: null });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });
    internals.write = vi.fn((message: Record<string, unknown>) => writes.push(message));
    const permissions = {
      network: { enabled: true },
      fileSystem: {
        read: ["/tmp/readable"],
        write: ["/tmp/writable"],
        entries: [{ path: { type: "special", value: { kind: "tmpdir" } }, access: "write" }],
      },
    };

    await target.chatSnapshot("thread-1");
    await internals.handleServerRequest(41, "item/permissions/requestApproval", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "permission-1",
      environmentId: null,
      startedAtMs: 1_787_900_000_000,
      cwd: "/tmp",
      reason: longReason,
      permissions,
    });
    const permissionSnapshot = await target.chatSnapshot("thread-1");
    target.respondToApproval("permission-1", "accept");

    expect(approvals).toEqual([{ approvalId: "permission-1", canControl: true }]);
    expect(permissionSnapshot.messages).toEqual([expect.objectContaining({
      id: "permission-1",
      turnId: "turn-1",
      role: "assistant",
      kind: "permission",
      text: longReason.trim(),
      approvalId: "permission-1",
      canControl: true,
      resolved: false,
    })]);
    expect(writes).toEqual([{ id: 41, result: { permissions, scope: "turn" } }]);
  });

  it("declines permission requests with an empty one-turn grant", async () => {
    const target = new AppServerClient(new Set(["thread-1"]), async () => {}, async () => {});
    const internals = target as unknown as ClientInternals;
    const writes: Array<Record<string, unknown>> = [];
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("active") });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });
    internals.write = vi.fn((message: Record<string, unknown>) => writes.push(message));

    await internals.handleServerRequest(42, "item/permissions/requestApproval", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "permission-2",
      environmentId: null,
      startedAtMs: 1_787_900_000_000,
      cwd: "/tmp",
      reason: null,
      permissions: { network: { enabled: true }, fileSystem: null },
    });
    target.respondToApproval("permission-2", "decline");

    expect(writes).toEqual([{ id: 42, result: { permissions: {}, scope: "turn" } }]);
  });

  it("keeps permission requests from another client's thread alert-only", async () => {
    const approvals: Array<{ approvalId: string; canControl: boolean }> = [];
    const target = new AppServerClient(new Set(), async () => {}, async (event) => {
      approvals.push({ approvalId: event.approvalId, canControl: event.canControl });
    });
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("active") });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await internals.handleServerRequest(43, "item/permissions/requestApproval", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "permission-3",
      environmentId: null,
      startedAtMs: 1_787_900_000_000,
      cwd: "/tmp",
      reason: "Allow access?",
      permissions: { network: { enabled: true }, fileSystem: null },
    });

    expect(approvals).toEqual([{ approvalId: "permission-3", canControl: false }]);
    expect(() => target.respondToApproval("permission-3", "accept")).toThrow("no longer active");
  });

  it("finds a completed response hidden beneath a newer interrupted turn", async () => {
    const events: Array<{ eventId: string; kind: string }> = [];
    const target = new AppServerClient(new Set(), async (event) => {
      events.push({ eventId: event.eventId, kind: event.kind });
    }, async () => {});
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method !== "thread/turns/list") return Promise.reject(new Error(`Unexpected method ${method}`));
      return Promise.resolve({
        data: [
          {
            id: "turn-newer-interrupted",
            status: "interrupted",
            completedAt: null,
            error: null,
          },
          {
            id: "turn-completed",
            status: "completed",
            completedAt: 1_787_900_010,
            error: null,
          },
          {
            id: "turn-old",
            status: "completed",
            completedAt: 1_787_899_900,
            error: null,
          },
        ],
        nextCursor: null,
        backwardsCursor: null,
      });
    });

    await internals.emitRecentTerminals({
      id: "thread-1",
      title: "Watch session",
      updatedAt: 1_787_900_020_000,
      status: "notLoaded",
      ownedByWear: false,
      canAcceptDirectInput: false,
    }, 1_787_900_000_000);
    await internals.emitRecentTerminals({
      id: "thread-1",
      title: "Watch session",
      updatedAt: 1_787_900_020_000,
      status: "notLoaded",
      ownedByWear: false,
      canAcceptDirectInput: false,
    }, 1_787_900_000_000);

    expect(events).toEqual([{
      eventId: "turn:thread-1:turn-completed:completed",
      kind: "terminal.completed",
    }]);
  });

  it("baselines existing terminal turns without alerting, then emits only a later completion", async () => {
    const events: string[] = [];
    const target = new AppServerClient(new Set(), async (event) => {
      events.push(event.eventId);
    }, async () => {});
    const internals = target as unknown as ClientInternals;
    let includeNew = false;
    internals.request = vi.fn((method: string) => {
      if (method !== "thread/turns/list") return Promise.reject(new Error(`Unexpected method ${method}`));
      return Promise.resolve({
        data: [
          ...(includeNew ? [{ id: "turn-new", status: "completed", completedAt: 1_787_900_020, error: null }] : []),
          { id: "turn-old", status: "completed", completedAt: 1_787_900_000, error: null },
        ],
        nextCursor: null,
        backwardsCursor: null,
      });
    });
    const session = {
      id: "thread-1",
      title: "Watch session",
      updatedAt: 1_787_900_020_000,
      status: "notLoaded" as const,
      ownedByWear: false,
      canAcceptDirectInput: false,
    };

    await internals.rememberRecentTerminals(session);
    await internals.emitRecentTerminals(session, 1_787_899_900_000);
    includeNew = true;
    await internals.emitRecentTerminals(session, 1_787_900_010_000);

    expect(events).toEqual(["turn:thread-1:turn-new:completed"]);
  });

  it("suppresses foreign internal cancellation task ids instead of alerting the Watch", async () => {
    const events: Array<{ kind: string; detail: string }> = [];
    const target = new AppServerClient(new Set(), async (event) => {
      events.push({ kind: event.kind, detail: event.detail });
    }, async () => {});
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method !== "thread/turns/list") return Promise.reject(new Error(`Unexpected method ${method}`));
      return Promise.resolve({
        data: [{
          id: "turn-cancelled",
          status: "failed",
          completedAt: 1_787_900_020,
          error: { message: "bs1 was cancelled" },
        }],
        nextCursor: null,
        backwardsCursor: null,
      });
    });

    await internals.emitRecentTerminals({
      id: "thread-1",
      title: "Foreign session",
      updatedAt: 1_787_900_020_000,
      status: "notLoaded",
      ownedByWear: false,
      canAcceptDirectInput: false,
    }, 1_787_900_000_000);

    expect(events).toEqual([]);
  });

  it("turns a controlled internal cancellation into a generic interrupted result", async () => {
    const events: Array<{ kind: string; detail: string }> = [];
    const target = new AppServerClient(new Set(["thread-1"]), async (event) => {
      events.push({ kind: event.kind, detail: event.detail });
    }, async () => {});
    const internals = target as unknown as ClientInternals;
    internals.controlledThreads.add("thread-1");
    internals.controlledTurnIds.set("thread-1", "turn-cancelled");
    internals.request = vi.fn((method: string) => {
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{
            id: "turn-cancelled",
            status: "failed",
            completedAt: 1_787_900_020,
            error: { message: "bs1 was cancelled" },
          }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/unsubscribe") return Promise.resolve({ status: "unsubscribed" });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await internals.emitRecentTerminals({
      id: "thread-1",
      title: "Watch session",
      updatedAt: 1_787_900_020_000,
      status: "idle",
      ownedByWear: true,
      canAcceptDirectInput: true,
    }, 1_787_900_000_000);

    expect(events).toEqual([{
      kind: "terminal.interrupted",
      detail: "Codex cancelled an internal response task. Open the session and retry only if no reply appears.",
    }]);
  });

  it("polling releases only the exact controlled turn after terminal delivery", async () => {
    const order: string[] = [];
    const target = new AppServerClient(new Set(), async (event) => {
      order.push(`terminal:${event.eventId}`);
    }, async () => {});
    const internals = target as unknown as ClientInternals;
    internals.controlledThreads.add("thread-1");
    internals.controlledTurnIds.set("thread-1", "turn-controlled");
    internals.request = vi.fn((method: string) => {
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [
            { id: "turn-controlled", status: "completed", completedAt: 1_787_900_020, error: null },
            { id: "turn-older", status: "completed", completedAt: 1_787_900_010, error: null },
          ],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/unsubscribe") {
        order.push("unsubscribe");
        return Promise.resolve({ status: "unsubscribed" });
      }
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await internals.emitRecentTerminals({
      id: "thread-1",
      title: "Watch session",
      updatedAt: 1_787_900_020_000,
      status: "idle",
      ownedByWear: true,
      canAcceptDirectInput: true,
    }, 1_787_900_000_000);

    expect(order).toEqual([
      "terminal:turn:thread-1:turn-older:completed",
      "terminal:turn:thread-1:turn-controlled:completed",
      "unsubscribe",
    ]);
    expect(internals.controlledThreads.has("thread-1")).toBe(false);
    expect(internals.controlledTurnIds.has("thread-1")).toBe(false);
  });
});
