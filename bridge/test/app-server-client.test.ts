import { describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../src/app-server-client.js";

type ClientInternals = {
  request: (method: string, params: unknown) => Promise<unknown>;
  handleNotification: (method: string, params: unknown) => Promise<void>;
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

  it("queues input for a session owned by another Codex client without competing for its writer", async () => {
    const target = client();
    const internals = target as unknown as ClientInternals;
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    internals.request = vi.fn((method: string, params: unknown) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/queue/add") return Promise.resolve({ queuedSubmission: { id: "queued-1" } });
      return Promise.reject(new Error(`Unexpected method ${method}`));
    });

    await expect(target.submitTurn("thread-1", "Please continue.", "/tmp")).resolves.toEqual({
      threadId: "thread-1",
      created: false,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("thread/queue/add");
    expect(requests[0]?.params).toMatchObject({
      threadId: "thread-1",
      input: [{ type: "text", text: "Please continue." }],
    });
    expect(requests[0]?.params.clientUserMessageId).toEqual(expect.any(String));
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
