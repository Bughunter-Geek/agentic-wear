import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServerClient, displayAgentText, materializeChat, parsePersistedFollowUpMode, supportsThreadQueue } from "../src/app-server-client.js";

type ClientInternals = {
  request: (method: string, params: unknown) => Promise<unknown>;
  handleNotification: (method: string, params: unknown) => Promise<void>;
  handleServerRequest: (id: string | number, method: string, params: unknown) => Promise<void>;
  write: (message: Record<string, unknown>) => void;
  controlledThreads: Set<string>;
  controlledTurnIds: Map<string, string>;
  watchReadyThreads: Set<string>;
  hotThreads: Map<string, number>;
  openDaemonSocket: () => Promise<void>;
  openStdio: () => void;
  initialize: () => Promise<void>;
  listSessions: () => Promise<unknown[]>;
  restartStalePrivateAppServer: (threadId: string) => Promise<boolean>;
  restartPrivateAppServer: () => Promise<void>;
  child: unknown;
  realtimeThreads: Set<string>;
  realtimeReleaseAfterTurn: Set<string>;
  releaseRealtimeLease: (threadId: string) => Promise<void>;
  performPrivateAppServerRestart: () => Promise<void>;
  activeThreadSynchronizations: number;
  lastStaleRestartAt: number;
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

  it("steers the App Server foreign interrupted-without-completion compatibility state", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") {
        if ((params as { itemsView?: string }).itemsView === "summary") {
          return Promise.resolve({
            data: [{
              id: "turn-mobile",
              status: "interrupted",
              completedAt: null,
              items: [{
                id: "user-mobile",
                type: "userMessage",
                content: [{ type: "text", text: "Keep working" }],
              }],
            }],
            nextCursor: null,
            backwardsCursor: null,
          });
        }
        return Promise.resolve({
          data: [{ id: "turn-mobile", status: "interrupted", completedAt: null }],
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
      "Change course now.",
      "/tmp",
      "gpt-5.6-sol",
      "high",
      "watch-compat-steer-1",
      undefined,
      "steer",
    )).resolves.toMatchObject({
      state: "running",
      steered: true,
      followUpMode: "steer",
    });

    expect(methods).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/turns/list",
      "thread/settings/update",
      "turn/steer",
    ]);
    expect(methods).not.toContain("thread/queue/add");
  });

  it("starts a new queued turn after an empty interrupted private-server remnant", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") {
        if ((params as { itemsView?: string }).itemsView === "summary") {
          return Promise.resolve({
            data: [{ id: "turn-aborted", status: "interrupted", completedAt: null, items: [] }],
            nextCursor: null,
            backwardsCursor: null,
          });
        }
        return Promise.resolve({
          data: [{ id: "turn-aborted", status: "interrupted", completedAt: null }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      if (method === "thread/queue/start") return Promise.resolve(startedQueueResponse());
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Start after the aborted empty turn.",
      "/tmp",
      null,
      "medium",
      "watch-after-abort-1",
    )).resolves.toMatchObject({ state: "running" });

    expect(methods).toContain("thread/resume");
    expect(methods).toContain("thread/queue/add");
    expect(methods).toContain("thread/queue/start");
    expect(methods).not.toContain("turn/steer");
  });

  it("never silently queues an explicit steer when no active turn is exposed", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") return Promise.resolve(terminalTurnsResponse());
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn(
      "thread-1",
      "Change course now.",
      "/tmp",
      "gpt-5.6-sol",
      "high",
      "watch-no-active-steer-1",
      undefined,
      "steer",
    )).rejects.toThrow("Codex did not expose an active turn to steer");

    expect(methods).toEqual(["thread/read", "thread/turns/list"]);
    expect(methods).not.toContain("thread/queue/add");
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

  it("merges live voice transcript segments into chat history by timeline position", async () => {
    const target = new AppServerClient(new Set(), async () => {}, async () => {});
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle", false) });
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      if (method === "thread/turns/list") return Promise.resolve({
        data: [{ id: "turn-voice", status: "completed", items: [
          { id: "delegated-user", type: "userMessage", content: [{ type: "text", text: "Check the build." }] },
          { id: "delegated-answer", type: "agentMessage", phase: "final_answer", text: "The build passes." },
        ] }, { id: "turn-text", status: "completed", items: [
          { id: "typed-user", type: "userMessage", content: [{ type: "text", text: "Typed earlier." }] },
        ] }],
        nextCursor: null, backwardsCursor: null,
      });
      if (method === "thread/timeline/list") return Promise.resolve({
        activeRealtimeSessionAtPageStart: null, nextCursor: null,
        data: [
          { type: "item", position: 2, turnId: "turn-text", item: { id: "typed-user", type: "userMessage" } },
          { type: "realtime", position: 5, item: { id: "rt-start", realtimeSessionId: "call-1", type: "realtimeSessionStarted" } },
          { type: "realtime", position: 6, item: { id: "rt-user-1", realtimeSessionId: "call-1", type: "transcriptSegment", role: "user", text: " Is the build green? " } },
          { type: "item", position: 8, turnId: "turn-voice", item: { id: "delegated-user", type: "userMessage" } },
          { type: "item", position: 9, turnId: "turn-voice", item: { id: "delegated-answer", type: "agentMessage" } },
          { type: "realtime", position: 10, item: { id: "rt-assistant-1", realtimeSessionId: "call-1", type: "transcriptSegment", role: "assistant", text: "Yes, it passes." } },
          { type: "realtime", position: 11, item: { id: "rt-empty", realtimeSessionId: "call-1", type: "transcriptSegment", role: "user", text: "   " } },
          { type: "realtime", position: 12, item: { id: "rt-closed", realtimeSessionId: "call-1", type: "realtimeSessionClosed", outcome: "ended" } },
        ],
      });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    const snapshot = await target.chatSnapshot("thread-1", true);
    expect(snapshot.messages.map(({ id, role }) => `${role}:${id}`)).toEqual([
      "user:typed-user", "user:rt-user-1", "user:delegated-user", "assistant:delegated-answer", "assistant:rt-assistant-1",
    ]);
    expect(snapshot.messages[1]).toMatchObject({ text: "Is the build green?", turnId: "realtime:call-1", kind: "message" });
    expect(snapshot.messages[4]).toMatchObject({ phase: "final_answer" });
  });

  it("keeps turn history when the voice timeline read is unavailable", async () => {
    const target = new AppServerClient(new Set(), async () => {}, async () => {});
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle", false) });
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      if (method === "thread/turns/list") return Promise.resolve({ data: [{ id: "turn-1", status: "completed", items: [
        { id: "user-1", type: "userMessage", content: [{ type: "text", text: "Hello" }] },
      ] }], nextCursor: null, backwardsCursor: null });
      return Promise.reject(new Error("method not found: thread/timeline/list"));
    });
    const snapshot = await target.chatSnapshot("thread-1", true);
    expect(snapshot.messages.map(({ id }) => id)).toEqual(["user-1"]);
  });

  it("shows an accepted Watch prompt immediately and replaces it with canonical history", async () => {
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
        if (historyReads === 1) {
          return Promise.resolve({ data: [], nextCursor: null, backwardsCursor: null });
        }
        return Promise.resolve({
          data: [{
            id: "turn-canonical",
            status: "completed",
            items: [{
              id: "canonical-user-1",
              clientId: "watch-visible-1",
              type: "userMessage",
              content: [{ type: "text", text: "Visible on the Watch immediately." }],
            }, {
              id: "canonical-assistant-1",
              type: "agentMessage",
              phase: "final_answer",
              text: "Canonical reply.",
            }],
          }],
          nextCursor: null,
          backwardsCursor: null,
        });
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
      watchRequestId: "watch-visible-1",
      role: "user",
      text: "Visible on the Watch immediately.",
    }));
    expect(historyReads).toBe(1);
    expect(onAgentOutput).toHaveBeenCalledWith("thread-1");

    const canonical = await target.chatSnapshot("thread-1", true);
    expect(canonical.messages.map(({ id }) => id)).toEqual([
      "canonical-user-1",
      "canonical-assistant-1",
    ]);
    expect(canonical.messages.filter(({ role }) => role === "user")).toHaveLength(1);
    // The Watch matches its local echo to the canonical prompt by this exact id;
    // without it the echo is appended below the reply.
    expect(canonical.messages[0]).toMatchObject({ watchRequestId: "watch-visible-1" });
    expect(canonical.messages[1]).not.toHaveProperty("watchRequestId");
    expect(historyReads).toBe(2);
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

  it("applies the watch selection before queueing behind an idle foreign writer", async () => {
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
      "thread/settings/update",
      "thread/queue/add",
    ]);
    expect(methods).not.toContain("thread/queue/delete");
    expect(vi.mocked(internals.request).mock.calls.find(([method]) => method === "thread/settings/update")?.[1])
      .toEqual({ threadId: "thread-1", model: "gpt-5.6-terra", effort: "high" });
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

  it("does not queue with the old model when foreign-writer settings cannot be updated", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") return Promise.resolve(terminalTurnsResponse());
      if (method === "thread/resume") return Promise.reject(new Error("thread thread-1 already has an active writer"));
      if (method === "thread/settings/update") return Promise.reject(new Error("Model selection rejected"));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });
    await expect(target.submitTurn("thread-1", "Use Astra", "/tmp", "gpt-6-astra", "low"))
      .rejects.toThrow("Model selection rejected");
    expect(vi.mocked(internals.request).mock.calls.map(([method]) => method)).not.toContain("thread/queue/add");
  });

  it("queues once when a private server cannot update an external owner's already matching selection", async () => {
    const target = new AppServerClient(new Set(), async () => {}, async () => {}, () => {}, async () => {},
      () => ({ model: "gpt-6-astra", effort: "medium" }));
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string, params: unknown) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") return Promise.resolve(terminalTurnsResponse());
      if (method === "thread/resume") return Promise.reject(new Error("thread thread-1 already has an active writer"));
      if (method === "thread/settings/update") return Promise.reject(new Error("thread not found: thread-1"));
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });
    await expect(target.submitTurn("thread-1", "Once", "/tmp", "gpt-6-astra", "medium", "watch-matching-private"))
      .resolves.toMatchObject({ state: "queued", selectionApplied: true });
    const calls = vi.mocked(internals.request).mock.calls;
    expect(calls.map(([method]) => method)).toEqual([
      "thread/read", "thread/turns/list", "thread/resume", "thread/settings/update", "thread/queue/add",
    ]);
    expect(calls.at(-1)?.[1]).toMatchObject({ clientUserMessageId: "watch-matching-private" });
  });

  it.each([
    { model: "gpt-5.6-terra", effort: "medium" },
    { model: "gpt-6-astra", effort: "high" },
    null,
  ])("rejects an unverified foreign selection without an endless synchronization retry: %j", async (settings) => {
    const target = new AppServerClient(new Set(), async () => {}, async () => {}, () => {}, async () => {}, () => settings);
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") return Promise.resolve(terminalTurnsResponse());
      if (method === "thread/resume") return Promise.reject(new Error("thread thread-1 already has an active writer"));
      if (method === "thread/settings/update") return Promise.reject(new Error("thread not found: thread-1"));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });
    await expect(target.submitTurn("thread-1", "Once", "/tmp", "gpt-6-astra", "medium"))
      .rejects.toThrow("owner must apply the Watch selection");
    expect(vi.mocked(internals.request).mock.calls.map(([method]) => method))
      .toEqual(["thread/read", "thread/turns/list", "thread/resume", "thread/settings/update"]);
  });

  it.each(["default", "steer"] as const)("handles foreign actor absence for active %s without synchronization retries", async (action) => {
    const target = new AppServerClient(new Set(), async () => {}, async () => {}, () => {}, async () => {},
      () => ({ model: "gpt-6-astra", effort: "medium" }), null, () => "steer");
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string, params: unknown) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/turns/list") return Promise.resolve({ data: [{ id: "active-turn", status: "inProgress" }], nextCursor: null, backwardsCursor: null });
      if (method === "thread/settings/update" || method === "turn/steer") return Promise.reject(new Error("thread not found: thread-1"));
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });
    const submitted = target.submitTurn("thread-1", "Once", "/tmp", "gpt-6-astra", "medium", "same-active-id", undefined, action);
    if (action === "default") {
      await expect(submitted).resolves.toMatchObject({ state: "queued", followUpMode: "queue", selectionApplied: true });
    } else {
      await expect(submitted).rejects.toThrow("Use Queue");
    }
    expect(vi.mocked(internals.request).mock.calls.map(([method]) => method)).toEqual([
      "thread/read", "thread/turns/list", "thread/settings/update", "turn/steer",
      ...(action === "default" ? ["thread/queue/add"] : []),
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

  it("restarts a stale private App Server when session synchronization exhausts its retries", async () => {
    vi.useFakeTimers();
    const target = client();
    const internals = target as unknown as ClientInternals;
    let readAttempts = 0;
    internals.restartStalePrivateAppServer = vi.fn().mockResolvedValue(true);
    internals.request = vi.fn((method: string, params: unknown) => {
      if (method === "thread/read") {
        readAttempts += 1;
        if (readAttempts <= 7) return Promise.reject(new Error("No rollout found for thread thread-1"));
        return Promise.resolve({ thread: thread("notLoaded") });
      }
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      if (method === "thread/turns/list") return Promise.resolve(terminalTurnsResponse());
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      if (method === "thread/queue/add") return Promise.resolve(queuedResponse(params));
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "thread/queue/start") return Promise.resolve(startedQueueResponse());
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    const submission = target.submitTurn(
      "thread-1",
      "Recover this session safely.",
      "/tmp",
      null,
      "medium",
      "watch-stale-server-1",
    );
    await vi.runAllTimersAsync();
    await expect(submission).resolves.toMatchObject({ threadId: "thread-1", state: "running" });

    expect(readAttempts).toBe(8);
    expect(internals.restartStalePrivateAppServer).toHaveBeenCalledOnce();
    expect(internals.restartStalePrivateAppServer).toHaveBeenCalledWith("thread-1");
    expect(vi.mocked(internals.request).mock.calls.filter(([method]) => method === "thread/queue/add"))
      .toHaveLength(1);
    vi.useRealTimers();
  });

  it("does not restart the shared private App Server through another active synchronization or controlled turn", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.child = {};
    internals.restartPrivateAppServer = vi.fn().mockResolvedValue(undefined);
    internals.activeThreadSynchronizations = 2;

    await expect(internals.restartStalePrivateAppServer("thread-1")).resolves.toBe(false);

    internals.activeThreadSynchronizations = 1;
    internals.controlledThreads.add("thread-running");
    await expect(internals.restartStalePrivateAppServer("thread-1")).resolves.toBe(false);

    internals.controlledThreads.clear();
    await expect(internals.restartStalePrivateAppServer("thread-1")).resolves.toBe(true);
    await expect(internals.restartStalePrivateAppServer("thread-1")).resolves.toBe(false);
    expect(internals.restartPrivateAppServer).toHaveBeenCalledTimes(1);
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

  it("refreshes the catalog so newly available models appear without a bridge restart", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    let availableModel = "gpt-5.6-luna";
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    internals.request = vi.fn(() => Promise.resolve({
      data: [{
        id: availableModel,
        model: availableModel,
        displayName: availableModel,
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }],
        hidden: false,
      }],
      nextCursor: null,
    }));
    try {
      expect((await target.listModels())[0]?.model).toBe("gpt-5.6-luna");
      availableModel = "gpt-6-astra";
      expect((await target.listModels())[0]?.model).toBe("gpt-5.6-luna");
      now.mockReturnValue(61_001);
      expect((await target.listModels())[0]?.model).toBe("gpt-6-astra");
      expect(internals.request).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it("starts realtime with WebRTC without changing thread permissions or coding model", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read" || method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/unsubscribe") return Promise.resolve({ status: "unsubscribed" });
      return Promise.resolve({});
    });
    await target.startRealtime("thread-1", "v=0 audio offer", "cove");
    expect(internals.request).toHaveBeenCalledWith("thread/resume", expect.objectContaining({ threadId: "thread-1", excludeTurns: true }));
    expect(internals.request).toHaveBeenCalledWith("thread/realtime/start", {
      threadId: "thread-1", transport: { type: "webrtc", sdp: "v=0 audio offer" },
      outputModality: "audio", voice: "cove", version: "v3", includeStartupContext: true,
      realtimeStartInstructions: expect.stringContaining("unavailable"),
    });
    await target.stopRealtime("thread-1");
    expect(internals.request).toHaveBeenCalledWith("thread/realtime/stop", { threadId: "thread-1" });
  });

  it("defers private App Server restart until voice and delegated work release their leases", async () => {
    const internals = client() as unknown as ClientInternals;
    internals.child = {};
    internals.performPrivateAppServerRestart = vi.fn(async () => {});
    internals.realtimeThreads.add("thread-1");
    await internals.restartPrivateAppServer();
    expect(internals.performPrivateAppServerRestart).not.toHaveBeenCalled();
    let active = true;
    internals.request = vi.fn(async (method: string) => method === "thread/read"
      ? { thread: thread(active ? "active" : "idle") } : { status: "unsubscribed" });
    await internals.releaseRealtimeLease("thread-1");
    expect(internals.realtimeReleaseAfterTurn.has("thread-1")).toBe(true);
    expect(internals.performPrivateAppServerRestart).not.toHaveBeenCalled();
    active = false;
    await internals.releaseRealtimeLease("thread-1");
    expect(internals.realtimeReleaseAfterTurn.size).toBe(0);
    expect(internals.performPrivateAppServerRestart).toHaveBeenCalledTimes(1);
  });

  it("releases a voice lease when the server closes the session unexpectedly", async () => {
    const internals = client() as unknown as ClientInternals;
    internals.realtimeThreads.add("thread-1");
    internals.request = vi.fn(async (method: string) => method === "thread/read"
      ? { thread: thread("idle") } : { status: "unsubscribed" });
    await internals.handleNotification("thread/realtime/closed", { threadId: "thread-1" });
    expect(internals.realtimeThreads.size).toBe(0);
    expect(internals.request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "thread-1" });
  });

  it("refuses to take over an active task for voice", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(() => Promise.resolve({ thread: thread("active") }));
    await expect(target.startRealtime("thread-1", "offer", "cove")).rejects.toThrow("busy");
    expect(internals.request).toHaveBeenCalledTimes(1);
  });

  it("discovers realtime without using the coding model catalog as a voice entitlement gate", async () => {
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
      transport: "webrtc",
      entitlement: "unverified",
      blocker: "session_not_verified",
    });
    expect(internals.request).toHaveBeenCalledWith("thread/realtime/listVoices", {});
    expect(internals.request).not.toHaveBeenCalledWith("model/list", expect.anything());
  });

  it("rejects an unavailable cloud task before voice catalog, resume or session start", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(() => Promise.reject(new Error("thread not loaded")));
    await expect(target.realtimeVoiceCapability("cloud-task")).rejects.toThrow("supported host connection");
    expect(internals.request).toHaveBeenCalledExactlyOnceWith("thread/read", { threadId: "cloud-task", includeTurns: false }, 10_000);
  });

  it("checks a local voice target without attaching or changing task settings", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn(async (method: string) => {
      methods.push(method);
      return method === "thread/read" ? { thread: thread("notLoaded") }
        : { voices: { v1: ["cove"], v2: ["marin"], defaultV1: "cove", defaultV2: "marin" } };
    });
    await expect(target.realtimeVoiceCapability("thread-1")).resolves.toMatchObject({ realtimeApiAvailable: true });
    expect(methods).toEqual(["thread/read", "thread/realtime/listVoices"]);
  });

  it("rejects a mismatched task before starting voice", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(async () => ({ thread: { ...thread("idle"), id: "different-thread" } }));
    await expect(target.startRealtime("thread-1", "offer", "cove")).rejects.toThrow("different task");
    expect(internals.request).toHaveBeenCalledTimes(1);
  });

  it("advertises Sol as the watch default when the V3 catalog supports it", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(async () => ({ voices: {
      v1: ["cove", "sol"], v2: ["marin"], defaultV1: "cove", defaultV2: "marin",
    } }));
    const capability = await target.realtimeVoiceCapability();
    expect(capability.voices).toEqual({
      v1: ["cove", "sol"], v2: ["marin"], defaultV1: "sol", defaultV2: "marin",
    });
    expect(capability.entitlement).toBe("unverified");
    expect(internals.request).toHaveBeenCalledExactlyOnceWith("thread/realtime/listVoices", {});
  });

  it("keeps voice entitlement unverified even when a coding model uses the GPT-Live name", async () => {
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
      entitlement: "unverified",
      blocker: "session_not_verified",
    });
  });

  it("reports an unavailable realtime API without checking the model catalog", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(() => Promise.reject(new Error("unknown variant")));

    await expect(target.realtimeVoiceCapability()).resolves.toMatchObject({
      available: false,
      realtimeApiAvailable: false,
      entitlement: "unverified",
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
    expect(internals.request).not.toHaveBeenCalledWith("thread/unsubscribe", { threadId: "thread-1" });
  });

  it("keeps a newer foreign summary active when the status-only view still reports the prior turn", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string, params: unknown) => {
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      if (method === "thread/turns/list") {
        const itemsView = (params as { itemsView?: string }).itemsView;
        if (itemsView === "notLoaded") {
          return Promise.resolve({
            data: [{ id: "turn-0", status: "completed", completedAt: 1_787_900_010, error: null }],
            nextCursor: null,
            backwardsCursor: null,
          });
        }
        return Promise.resolve({
          data: [{
            id: "turn-1",
            items: [{ id: "assistant-1", type: "agentMessage", phase: "commentary", text: "Still working" }],
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
    await expect(target.chatSnapshot("thread-1", true)).resolves.toMatchObject({
      status: "active",
      messages: [expect.objectContaining({ text: "Still working" })],
    });
    expect(internals.request).not.toHaveBeenCalledWith("thread/unsubscribe", { threadId: "thread-1" });
  });

  it("treats the App Server foreign interrupted-without-completion representation as active", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [{
            id: "turn-live",
            status: "interrupted",
            completedAt: null,
            items: [{
              id: "user-live",
              type: "userMessage",
              content: [{ type: "text", text: "Keep working" }],
            }],
          }],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      if (method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await target.listSessions();
    await expect(target.chatSnapshot("thread-1", true)).resolves.toMatchObject({ status: "active" });
    expect(internals.request).not.toHaveBeenCalledWith("thread/unsubscribe", { threadId: "thread-1" });
  });

  it("does not let a foreign notLoaded status notification erase an active turn", async () => {
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
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await target.chatSnapshot("thread-1");
    await internals.handleNotification("turn/started", {
      threadId: "thread-1",
      turn: { id: "turn-1" },
    });
    await internals.handleNotification("thread/status/changed", {
      threadId: "thread-1",
      status: { type: "notLoaded" },
    });

    expect(onAgentOutput).toHaveBeenCalledWith("thread-1");
    await expect(target.chatSnapshot("thread-1")).resolves.toMatchObject({ status: "active" });
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
    internals.request = vi.fn((method: string, params: unknown) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      if (method === "thread/turns/list") {
        if ((params as { itemsView?: string }).itemsView === "notLoaded") {
          return Promise.resolve({
            data: [{ id: "turn-1", status: "completed", completedAt: 1_787_900_010, error: null }],
            nextCursor: null,
            backwardsCursor: null,
          });
        }
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
    internals.request = vi.fn((method: string, params: unknown) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/list") return Promise.resolve({ data: [thread("notLoaded")], nextCursor: null });
      if (method === "thread/turns/list") {
        if ((params as { itemsView?: string }).itemsView === "notLoaded") {
          return Promise.resolve({
            data: [{ id: "turn-1", status: "completed", completedAt: 1_787_900_010, error: null }],
            nextCursor: null,
            backwardsCursor: null,
          });
        }
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
    // Only the initial fresh load reads the voice timeline; the streamed delta uses the cache.
    expect(methods).toEqual(["thread/read", "thread/turns/list", "thread/queue/list", "thread/timeline/list"]);
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

describe("AppServerClient terminal detection logging", () => {
  afterEach(() => vi.restoreAllMocks());

  function detectedLines(log: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
    return log.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((entry) => entry.message === "watch.terminal.detected");
  }

  it("logs a notification-detected terminal event once, as metadata only", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const delivered: string[] = [];
    const target = new AppServerClient(new Set(["thread-1"]), async (event) => {
      delivered.push(event.eventId);
    }, async () => {});
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: { ...thread("idle"), name: "Private chat title" } });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });
    const notification = { threadId: "thread-1", turn: { id: "turn-1", status: "completed", completedAt: 1_787_900_010, error: null } };

    const before = Date.now();
    await internals.handleNotification("turn/completed", notification);
    await internals.handleNotification("turn/completed", notification);
    const after = Date.now();

    expect(delivered).toEqual(["turn:thread-1:turn-1:completed"]);
    const lines = detectedLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      message: "watch.terminal.detected",
      eventId: "turn:thread-1:turn-1:completed",
      threadId: "thread-1",
      kind: "terminal.completed",
      source: "notification",
      occurredAt: 1_787_900_010_000,
    });
    expect(lines[0]?.detectedAt).toBeGreaterThanOrEqual(before);
    expect(lines[0]?.detectedAt).toBeLessThanOrEqual(after);
    expect(Object.keys(lines[0] ?? {}).sort()).toEqual(
      ["detectedAt", "eventId", "kind", "level", "message", "occurredAt", "source", "threadId"],
    );
    expect(log.mock.calls.map(([line]) => String(line)).join("\n")).not.toContain("Private chat title");
  });

  it("logs a monitor-detected terminal event with the monitor source", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(() => Promise.resolve({
      data: [{ id: "turn-desktop", status: "failed", completedAt: 1_787_900_020, error: { message: "Private failure text" } }],
      nextCursor: null,
      backwardsCursor: null,
    }));

    await internals.emitRecentTerminals({
      id: "thread-1",
      title: "Private chat title",
      updatedAt: 1_787_900_020_000,
      status: "notLoaded",
      ownedByWear: false,
      canAcceptDirectInput: false,
    }, 1_787_900_000_000);

    const lines = detectedLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      eventId: "turn:thread-1:turn-desktop:failed",
      threadId: "thread-1",
      kind: "terminal.failed",
      source: "monitor",
      occurredAt: 1_787_900_020_000,
    });
    expect(log.mock.calls.map(([line]) => String(line)).join("\n")).not.toMatch(/Private (failure text|chat title)/u);
  });

  it("does not log detection for a deduplicated event", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(() => Promise.resolve({
      data: [{ id: "turn-1", status: "completed", completedAt: 1_787_900_020, error: null }],
      nextCursor: null,
      backwardsCursor: null,
    }));
    const session = {
      id: "thread-1", title: "Chat", updatedAt: 1_787_900_020_000, status: "notLoaded" as const,
      ownedByWear: false, canAcceptDirectInput: false,
    };

    await internals.emitRecentTerminals(session, 1_787_900_000_000);
    await internals.emitRecentTerminals(session, 1_787_900_000_000);

    expect(detectedLines(log)).toHaveLength(1);
  });

  it("does not claim detection when delivery to the Watch fails, and retries the event", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let failNext = true;
    const delivered: string[] = [];
    const target = new AppServerClient(new Set(), async (event) => {
      if (failNext) {
        failNext = false;
        throw new Error("relay unavailable");
      }
      delivered.push(event.eventId);
    }, async () => {});
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(() => Promise.resolve({
      data: [{ id: "turn-1", status: "completed", completedAt: 1_787_900_020, error: null }],
      nextCursor: null,
      backwardsCursor: null,
    }));
    const session = {
      id: "thread-1", title: "Chat", updatedAt: 1_787_900_020_000, status: "notLoaded" as const,
      ownedByWear: false, canAcceptDirectInput: false,
    };

    await expect(internals.emitRecentTerminals(session, 1_787_900_000_000)).rejects.toThrow("relay unavailable");
    await internals.emitRecentTerminals(session, 1_787_900_000_000);

    expect(delivered).toEqual(["turn:thread-1:turn-1:completed"]);
    // Detection is logged on each attempt that is not a duplicate: first failed send, then the retry.
    expect(detectedLines(log)).toHaveLength(2);
  });
});

describe("AppServerClient hot-thread terminal fast lane", () => {
  const T0 = 1_787_900_000_000;
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function session(id: string) {
    return {
      id,
      title: `Chat ${id}`,
      updatedAt: T0,
      status: "notLoaded" as const,
      ownedByWear: false,
      canAcceptDirectInput: false,
    };
  }

  // A monitored client over fake time. `finished` lists the threads whose newest
  // turn has completed (desktop-style, outside the bridge's own connection).
  function monitored(threadIds: string[]) {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const delivered: string[] = [];
    const target = new AppServerClient(new Set(), async (event) => {
      delivered.push(event.eventId);
    }, async () => {});
    const internals = target as unknown as ClientInternals;
    const listed = [...threadIds];
    const finished = new Set<string>();
    const listCalls = { count: 0 };
    const scans = new Map<string, number>();
    internals.listSessions = vi.fn(async () => {
      listCalls.count += 1;
      return listed.map(session);
    });
    internals.request = vi.fn(async (method: string, params: unknown) => {
      if (method !== "thread/turns/list") throw new Error(`Unexpected method ${method}`);
      const { threadId } = params as { threadId: string };
      scans.set(threadId, (scans.get(threadId) ?? 0) + 1);
      return {
        data: [
          ...(finished.has(threadId)
            ? [{ id: "turn-new", status: "completed", completedAt: T0 / 1_000 + 2, error: null }]
            : []),
          { id: "turn-old", status: "completed", completedAt: T0 / 1_000 - 600, error: null },
        ],
        nextCursor: null,
        backwardsCursor: null,
      };
    });
    const abort = new AbortController();
    const running = target.monitorTerminals(abort.signal);
    return {
      target,
      internals,
      delivered,
      listed,
      finished,
      listCalls,
      scans,
      advance: (ms: number) => vi.advanceTimersByTimeAsync(ms),
      stop: async () => {
        abort.abort();
        await vi.advanceTimersByTimeAsync(0);
        await running;
      },
    };
  }

  it("emits a hot thread's finished turn on the next tick while a cold thread waits for the full scan", async () => {
    const f = monitored(["hot", "cold"]);
    await f.advance(0); // baseline
    expect(f.scans.get("hot")).toBe(1);
    f.target.markHot("hot");
    f.finished.add("hot").add("cold");

    await f.advance(999);
    expect(f.delivered).toEqual([]);
    await f.advance(1); // first one-second tick
    expect(f.delivered).toEqual(["turn:hot:turn-new:completed"]);

    // The cold thread is not looked at again until the five-second full scan.
    await f.advance(3_000); // t = 4 s
    expect(f.delivered).toEqual(["turn:hot:turn-new:completed"]);
    expect(f.scans.get("cold")).toBe(1);
    expect(f.listCalls.count).toBe(1);
    await f.advance(1_000); // t = 5 s: full scan
    expect(f.delivered).toEqual(["turn:hot:turn-new:completed", "turn:cold:turn-new:completed"]);
    expect(f.listCalls.count).toBe(2);
    await f.stop();
  });

  it("never emits the same turn twice, and scans a hot thread once per tick including full-scan ticks", async () => {
    const f = monitored(["hot", "cold"]);
    await f.advance(0);
    f.target.markHot("hot");
    f.finished.add("hot").add("cold");

    await f.advance(5_000);
    // baseline + four hot-lane ticks + one full scan (not a second hot pass on that tick)
    expect(f.scans.get("hot")).toBe(1 + 4 + 1);
    expect(f.scans.get("cold")).toBe(1 + 1);

    await f.advance(20_000);
    expect(f.delivered).toEqual(["turn:hot:turn-new:completed", "turn:cold:turn-new:completed"]);
    expect(new Set(f.delivered).size).toBe(f.delivered.length);
    await f.stop();
  });

  it("does not poll a hot thread that is missing from the last full listing until the next full scan", async () => {
    const f = monitored(["cold"]);
    await f.advance(0);
    f.target.markHot("unlisted");
    f.finished.add("unlisted");

    await f.advance(4_000);
    expect(f.scans.get("unlisted")).toBeUndefined();
    expect(f.delivered).toEqual([]);

    f.listed.push("unlisted");
    await f.advance(1_000); // full scan finds it
    expect(f.delivered).toEqual(["turn:unlisted:turn-new:completed"]);
    // From then on it is a listed hot thread again and rides the one-second lane.
    await f.advance(2_000);
    expect(f.scans.get("unlisted")).toBe(1 + 2);
    await f.stop();
  });

  it("stops the fast lane when a hot entry expires after two minutes", async () => {
    const f = monitored(["hot", "cold"]);
    await f.advance(0);
    f.target.markHot("hot");
    expect(f.internals.hotThreads.get("hot")).toBe(T0 + 120_000);

    await f.advance(119_000);
    expect(f.internals.hotThreads.has("hot")).toBe(true);
    const beforeExpiry = f.scans.get("hot") ?? 0;
    await f.advance(1_000); // 120 s: expired and pruned on this tick
    expect(f.internals.hotThreads.has("hot")).toBe(false);
    // The expiring tick (120 s) is also a full scan, so exactly one more scan happened.
    expect(f.scans.get("hot")).toBe(beforeExpiry + 1);

    // Afterwards only the five-second full scan visits the thread.
    const afterExpiry = f.scans.get("hot") ?? 0;
    await f.advance(10_000);
    expect(f.scans.get("hot")).toBe(afterExpiry + 2);
    await f.stop();
  });

  it("honours a custom hot duration and refreshes an existing entry", async () => {
    const f = monitored(["hot"]);
    await f.advance(0);
    f.target.markHot("hot", 3_000);
    await f.advance(2_000);
    f.target.markHot("hot", 3_000); // extended to t = 5 s
    expect(f.internals.hotThreads.get("hot")).toBe(T0 + 5_000);
    await f.advance(2_000);
    expect(f.internals.hotThreads.has("hot")).toBe(true);
    await f.advance(1_000);
    expect(f.internals.hotThreads.has("hot")).toBe(false);
    await f.stop();
  });

  it("keeps at most 32 hot threads, dropping the oldest", () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    for (let index = 0; index < 40; index += 1) target.markHot(`thread-${index}`);
    expect(internals.hotThreads.size).toBe(32);
    expect(internals.hotThreads.has("thread-7")).toBe(false);
    expect(internals.hotThreads.has("thread-8")).toBe(true);
    expect(internals.hotThreads.has("thread-39")).toBe(true);
    // Re-marking makes an entry the newest rather than adding a duplicate.
    target.markHot("thread-8");
    target.markHot("thread-40");
    expect(internals.hotThreads.size).toBe(32);
    expect(internals.hotThreads.has("thread-8")).toBe(true);
    expect(internals.hotThreads.has("thread-9")).toBe(false);
  });

  it("leaves bridge-controlled turns to the notification path on hot ticks but still covers them on the full scan", async () => {
    const f = monitored(["controlled", "foreign"]);
    await f.advance(0); // baseline: one scan each
    f.target.markHot("controlled");
    f.target.markHot("foreign");
    f.internals.controlledTurnIds.set("controlled", "turn-running");

    await f.advance(4_000); // four hot ticks, no full scan yet
    expect(f.scans.get("controlled")).toBe(1);
    expect(f.scans.get("foreign")).toBe(1 + 4);

    await f.advance(1_000); // full scan at 5 s covers both
    expect(f.scans.get("controlled")).toBe(1 + 1);
    expect(f.scans.get("foreign")).toBe(1 + 4 + 1);

    // Once the bridge no longer controls the thread, the hot lane picks it up again.
    f.internals.controlledTurnIds.delete("controlled");
    await f.advance(2_000);
    expect(f.scans.get("controlled")).toBe(1 + 1 + 2);
    expect(f.scans.get("foreign")).toBe(1 + 4 + 1 + 2);
    await f.stop();
  });

  it("keeps the monitor alive when a hot-lane scan fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = monitored(["hot"]);
    await f.advance(0);
    f.target.markHot("hot");
    const request = f.internals.request;
    let fail = true;
    f.internals.request = vi.fn(async (method: string, params: unknown) => {
      if (fail) {
        fail = false;
        throw new Error("app server busy");
      }
      return request(method, params);
    });
    f.finished.add("hot");

    await f.advance(1_000); // fails
    expect(f.delivered).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("terminal monitor retrying"));
    await f.advance(1_000); // recovers on the next tick
    expect(f.delivered).toEqual(["turn:hot:turn-new:completed"]);
    await f.stop();
  });
});

describe("displayAgentText", () => {
  const directive = '::inbox-item{title="One word response delivered" summary="Acknowledged your test message with one word."}';

  it("removes the automation directive line", () => {
    expect(displayAgentText(`Acknowledged\n${directive}`)).toBe("Acknowledged");
    expect(displayAgentText(`A\n\n${directive}\n\n\nB`)).toBe("A\n\nB");
  });

  it("shows the summary of a directive-only reply", () => {
    expect(displayAgentText(directive)).toBe("One word response delivered: Acknowledged your test message with one word.");
    expect(displayAgentText('::inbox-item{summary="Only summary"}')).toBe("Only summary");
    expect(displayAgentText('::inbox-item{title="Only title"}')).toBe("Only title");
    expect(displayAgentText('::inbox-item{title="Same" summary="Same"}')).toBe("Same");
  });

  it("keeps directives inside code fences", () => {
    const text = `Example:\n\`\`\`\n${directive}\n\`\`\`\n${directive}`;
    expect(displayAgentText(text)).toBe(`Example:\n\`\`\`\n${directive}\n\`\`\``);
  });

  it("removes unknown directives and handles escaped quotes", () => {
    expect(displayAgentText('Hi\n::other-thing{a="1"}')).toBe("Hi");
    expect(displayAgentText('::inbox-item{title="Say \\"hi\\"" summary="Done"}')).toBe('Say "hi": Done');
    expect(displayAgentText('::unknown{a="1"}')).toBe('::unknown{a="1"}');
  });

  it("leaves text without directives unchanged", () => {
    expect(displayAgentText("  plain\n\n\ntext ::x{y}  ")).toBe("  plain\n\n\ntext ::x{y}  ");
    expect(displayAgentText("")).toBe("");
  });

  it("materializes messages and paragraphs without directives, leaving user text alone", () => {
    const snapshot = materializeChat({
      threadId: "t1", title: "T", status: "idle",
      messages: [
        { id: "u", turnId: "x", role: "user", kind: "message", text: directive, phase: "unknown" },
        { id: "a", turnId: "x", role: "assistant", kind: "message", text: `Acknowledged\n\n${directive}`, phase: "final_answer" },
      ],
    } as unknown as Parameters<typeof materializeChat>[0]);
    expect(snapshot.messages[1]?.text).toBe("Acknowledged");
    expect(snapshot.messages[0]?.text).toBe(directive);
    expect(snapshot.paragraphs.map((p) => p.text)).toEqual(["Acknowledged"]);
    expect(JSON.stringify(snapshot.paragraphs)).not.toContain("::inbox-item");
  });
});
