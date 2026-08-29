import { describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../src/app-server-client.js";

type ClientInternals = {
  request: (method: string, params: unknown) => Promise<unknown>;
  handleNotification: (method: string, params: unknown) => Promise<void>;
  handleServerRequest: (id: string | number, method: string, params: unknown) => Promise<void>;
  write: (message: Record<string, unknown>) => void;
  emitRecentTerminals: (
    session: {
      id: string;
      title: string;
      updatedAt: number;
      status: "active" | "idle" | "error" | "notLoaded";
      ownedByWear: boolean;
      canAcceptDirectInput: boolean;
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
  }) => Promise<void>;
};

function thread(status: "notLoaded" | "idle" | "active" = "idle") {
  return {
    id: "thread-1",
    preview: "Watch session",
    name: "Watch session",
    updatedAt: 1_787_900_000,
    status: { type: status },
    canAcceptDirectInput: status !== "notLoaded",
    parentThreadId: null,
    agentRole: null,
  };
}

function client(): AppServerClient {
  return new AppServerClient(new Set(), async () => {}, async () => {});
}

describe("AppServerClient session delivery", () => {
  it("does not resume a thread again when thread/started already proves it is loaded", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn(() => Promise.reject(new Error("request must not be called")));

    await internals.handleNotification("thread/started", { thread: thread("idle") });

    expect(internals.request).not.toHaveBeenCalled();
  });

  it("performs one resume before starting a turn in an unloaded session", async () => {
    const target = new AppServerClient(new Set(["thread-1"]), async () => {}, async () => {});
    const internals = target as unknown as ClientInternals;
    const methods: string[] = [];
    internals.request = vi.fn((method: string) => {
      methods.push(method);
      if (method === "thread/read") return Promise.resolve({ thread: thread("notLoaded") });
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "turn/start") return Promise.resolve({ turn: { id: "turn-1" } });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Please continue.", "/tmp")).resolves.toEqual({
      threadId: "thread-1",
      created: false,
    });

    expect(methods).toEqual(["thread/read", "thread/resume", "turn/start"]);
  });

  it("forwards the selected model and reasoning effort when starting a turn", async () => {
    const target = new AppServerClient(new Set(["thread-1"]), async () => {}, async () => {});
    const internals = target as unknown as ClientInternals;
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "turn/start") return Promise.resolve({ turn: { id: "turn-1" } });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Use the selected settings.", "/tmp", "gpt-5.6-terra", "xhigh"))
      .resolves.toEqual({ threadId: "thread-1", created: false });

    expect(requests.at(-1)).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        model: "gpt-5.6-terra",
        effort: "xhigh",
      },
    });
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

  it("rejoins and starts an idle session owned by another Codex client", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "turn/start") return Promise.resolve({ turn: { id: "turn-1" } });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Please continue.", "/tmp", "gpt-5.6-sol", "high")).resolves.toEqual({
      threadId: "thread-1",
      created: false,
    });

    expect(requests).toHaveLength(3);
    expect(requests[0]).toEqual({
      method: "thread/resume",
      params: { threadId: "thread-1", excludeTurns: true },
    });
    expect(requests[1]).toEqual({
      method: "thread/settings/update",
      params: {
        threadId: "thread-1",
        model: "gpt-5.6-sol",
        effort: "high",
      },
    });
    expect(requests[2]?.method).toBe("turn/start");
    expect(requests[2]?.params).toMatchObject({
      threadId: "thread-1",
      input: [{ type: "text", text: "Please continue." }],
      model: "gpt-5.6-sol",
      effort: "high",
    });
  });

  it("does not start a foreign-thread prompt when its sticky settings update fails", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.reject(new Error("settings denied"));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Do not send this.", "/tmp", "gpt-5.6-sol", "max"))
      .rejects.toThrow("settings denied");
    expect(internals.request).toHaveBeenCalledTimes(2);
  });

  it("keeps a foreign prompt unsent when Codex reports another active writer", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/resume") return Promise.reject(new Error("active writer already attached"));
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Do not queue this.", "/tmp"))
      .rejects.toThrow("Your watch prompt was not queued or sent");
    expect(internals.request).toHaveBeenCalledTimes(1);
  });

  it("does not interrupt an active session owned by another Codex client", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/resume") return Promise.resolve({ thread: thread("active") });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Wait for the next turn.", "/tmp", "gpt-5.6-sol", "high"))
      .rejects.toThrow("session is busy");
    expect(internals.request).toHaveBeenCalledTimes(1);
  });

  it("keeps the owning client's model when Auto is selected", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/resume") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/settings/update") return Promise.resolve({});
      if (method === "turn/start") return Promise.resolve({ turn: { id: "turn-1" } });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Use Auto.", "/tmp", null, "medium"))
      .resolves.toEqual({ threadId: "thread-1", created: false });

    expect(requests[1]?.params).toEqual({ threadId: "thread-1", effort: "medium" });
    expect(requests[2]?.params).not.toHaveProperty("model");
  });

  it("preserves user and assistant roles plus Markdown in chat snapshots", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("idle") });
      if (method === "thread/turns/list") {
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

  it("returns only the newest five assistant paragraphs in chronological order", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    let page = 0;
    internals.request = vi.fn((method: string) => {
      if (method === "thread/read") return Promise.resolve({ thread: thread("active") });
      if (method !== "thread/turns/list") return Promise.reject(new Error(`Unexpected method ${method}`));
      page += 1;
      if (page === 1) {
        return Promise.resolve({
          data: [{
            id: "turn-2",
            items: [{ id: "message-2", type: "agentMessage", phase: "final_answer", text: "Fourth\n\nFifth\n\nSixth" }],
          }],
          nextCursor: "older",
        });
      }
      return Promise.resolve({
        data: [{
          id: "turn-1",
          items: [
            { id: "message-1", type: "agentMessage", phase: "commentary", text: "First\n\nSecond\n\nThird" },
            { id: "tool-1", type: "commandExecution" },
          ],
        }],
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
    expect(methods).toEqual(["thread/read", "thread/turns/list"]);
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
});
