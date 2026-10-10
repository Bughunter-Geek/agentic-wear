import { describe, expect, it, vi } from "vitest";
import { AppServerClient, previewText, type TerminalEvent } from "../src/app-server-client.js";

const GENERIC = "The agent finished its full response.";

type Internals = {
  request: (method: string, params: unknown, timeoutMs?: number) => Promise<unknown>;
  handleNotification: (method: string, params: unknown) => Promise<void>;
  emitRecentTerminals: (session: unknown, newerThanMs: number) => Promise<void>;
  chatCaches: Map<string, unknown>;
  threadCache: Map<string, unknown>;
};

const thread = {
  id: "thread-1",
  preview: "Watch session",
  name: "Watch session",
  updatedAt: 1_787_900_000,
  status: { type: "idle" },
  parentThreadId: null,
  agentRole: null,
};
const session = {
  id: "thread-1",
  title: "Watch session",
  updatedAt: 1_787_900_020_000,
  status: "notLoaded",
  ownedByWear: false,
  canAcceptDirectInput: false,
};
const turnsList = {
  data: [{ id: "turn-1", status: "completed", completedAt: 1_787_900_010, error: null }],
  nextCursor: null,
  backwardsCursor: null,
};

function setup() {
  const events: TerminalEvent[] = [];
  const client = new AppServerClient(new Set(), async (event) => {
    events.push(event);
  }, async () => {});
  const internals = client as unknown as Internals;
  vi.spyOn(console, "log").mockImplementation(() => {});
  return { events, internals };
}

function cacheWith(messages: Array<Record<string, unknown>>) {
  return {
    threadId: "thread-1",
    title: "Watch session",
    status: "idle",
    messages: messages.map((m, i) => ({
      id: `m${i}`,
      turnId: "turn-1",
      role: "assistant",
      kind: "message",
      phase: "unknown",
      approvalId: null,
      canControl: false,
      resolved: false,
      ...m,
    })),
  };
}

const completedNotification = {
  threadId: "thread-1",
  turn: { id: "turn-1", status: "completed", completedAt: 1_787_900_010, error: null },
};

describe("previewText", () => {
  it("strips directives, collapses whitespace and trims", () => {
    expect(previewText('Done.\n\n  All   good\t here.\n::inbox-item{title="T" summary="S"}')).toBe("Done. All good here.");
  });
  it("returns null for empty or whitespace-only text", () => {
    expect(previewText("")).toBeNull();
    expect(previewText(" \n\t ")).toBeNull();
  });
  it("uses the inbox summary for a directive-only reply", () => {
    expect(previewText('::inbox-item{title="Build" summary="Passed"}')).toBe("Build: Passed");
  });
  it("keeps up to 30 words unchanged", () => {
    const text = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    expect(previewText(text)).toBe(text);
  });
  it("truncates 31 or more words to the first 30 with an ellipsis", () => {
    const words = Array.from({ length: 31 }, (_, i) => `w${i}`);
    expect(previewText(words.join(" "))).toBe(`${words.slice(0, 30).join(" ")}…`);
  });
  it("caps very long single tokens at 400 characters", () => {
    expect(previewText("x".repeat(700))).toBe(`${"x".repeat(400)}…`);
  });
});

describe("terminal.completed preview", () => {
  it("notification path prefers the chat cache final answer", async () => {
    const { events, internals } = setup();
    internals.threadCache.set("thread-1", thread);
    internals.chatCaches.set("thread-1", cacheWith([
      { text: "Working on it", phase: "commentary" },
      { text: "Here is the\nfinal   answer.", phase: "final_answer" },
      { text: "trailing commentary", phase: "commentary" },
    ]));
    internals.request = vi.fn(() => Promise.reject(new Error("request must not be called")));
    await internals.handleNotification("turn/completed", completedNotification);
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toBe("Here is the final answer.");
    expect(internals.request).not.toHaveBeenCalled();
  });

  it("monitor path lists items with a short timeout and uses the newest final answer", async () => {
    const { events, internals } = setup();
    internals.request = vi.fn((method: string) => {
      if (method === "thread/turns/list") return Promise.resolve(turnsList);
      if (method === "thread/items/list") {
        return Promise.resolve({
          data: [
            { type: "agentMessage", id: "a2", text: "Later note", phase: "commentary" },
            { type: "agentMessage", id: "a1", text: "The real   answer", phase: "final_answer" },
            { type: "userMessage", id: "u1" },
          ],
          nextCursor: null,
        });
      }
      return Promise.reject(new Error(`Unexpected ${method}`));
    });
    await internals.emitRecentTerminals(session, 1_787_900_000_000);
    expect(events.map((e) => e.detail)).toEqual(["The real answer"]);
    const call = vi.mocked(internals.request).mock.calls.find(([m]) => m === "thread/items/list");
    expect(call?.[1]).toEqual({ threadId: "thread-1", turnId: "turn-1", sortDirection: "desc", limit: 20 });
    expect(call?.[2]).toBe(1_500);
  });

  it("falls back to the generic detail on failure, malformed data, or no text", async () => {
    for (const items of [
      () => Promise.reject(new Error("timeout")),
      () => Promise.resolve({ nope: true }),
      () => Promise.resolve({ data: [{ type: "agentMessage", text: "  " }] }),
    ]) {
      const { events, internals } = setup();
      internals.request = vi.fn((method: string) =>
        method === "thread/turns/list" ? Promise.resolve(turnsList) : items());
      await internals.emitRecentTerminals(session, 1_787_900_000_000);
      expect(events.map((e) => e.detail)).toEqual([GENERIC]);
    }
  });

  it("shows the inbox title and summary for a directive-only reply", async () => {
    const { events, internals } = setup();
    internals.request = vi.fn((method: string) =>
      method === "thread/turns/list"
        ? Promise.resolve(turnsList)
        : Promise.resolve({ data: [{ type: "agentMessage", text: '::inbox-item{title="Nightly" summary="All green"}', phase: "final_answer" }] }));
    await internals.emitRecentTerminals(session, 1_787_900_000_000);
    expect(events[0]?.detail).toBe("Nightly: All green");
  });

  it("leaves failed and interrupted details unchanged without fetching items", async () => {
    const { events, internals } = setup();
    internals.request = vi.fn((method: string) => {
      if (method === "thread/turns/list") {
        return Promise.resolve({
          data: [
            { id: "turn-f", status: "failed", completedAt: 1_787_900_011, error: { message: "boom" } },
            { id: "turn-i", status: "interrupted", completedAt: 1_787_900_012, error: null },
          ],
          nextCursor: null,
          backwardsCursor: null,
        });
      }
      return Promise.reject(new Error("items must not be fetched"));
    });
    await internals.emitRecentTerminals(session, 1_787_900_000_000);
    expect(events.map((e) => e.detail)).toEqual(["The agent was interrupted before finishing.", "boom"]);
  });

  it("keeps a maximal terminal envelope under the relay attachment budget", () => {
    const preview = previewText("x".repeat(900))!;
    expect(preview.length).toBeLessThanOrEqual(401);
    const event: TerminalEvent = {
      eventId: "turn:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b:019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7c:completed",
      kind: "terminal.completed",
      turnScope: "topLevel",
      threadId: "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b",
      title: "t".repeat(100),
      detail: preview,
      occurredAt: 1_787_900_010_000,
    };
    expect(JSON.stringify({ version: 1, ...event }).length).toBeLessThan(1_900);
  });
});
