import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServerClient, buildQuestionReplyText, type SessionView } from "../src/app-server-client.js";

type Internals = {
  request: (method: string, params?: unknown) => Promise<unknown>;
  emitRecentTerminals: (session: SessionView, newerThanMs: number) => Promise<void>;
  handleNotification: (method: string, params: unknown) => Promise<void>;
  sessionView: (thread: unknown) => SessionView;
  controlledTurnIds: Map<string, string>;
  approvals: Map<string, unknown>;
  noteDerivedState: (threadId: string) => void;
  chatCaches: Map<string, unknown>;
  runningTurns: Map<string, { turnId: string; seenAt: number }>;
};
const thread = { id: "t1", preview: "p", name: "Chat", updatedAt: 1_787_900_000, status: { type: "notLoaded" }, parentThreadId: null, agentRole: null };
const session = { id: "t1", title: "Chat", updatedAt: 1_787_900_020_000, status: "notLoaded", ownedByWear: false, canAcceptDirectInput: false, watchReady: false } as SessionView;
const question = { title: "Which database?", options: ["Postgres", "SQLite"] };

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(1_787_900_100_000);
  vi.spyOn(console, "log").mockImplementation(() => {});
  const client = new AppServerClient(new Set(), async () => {}, async () => {});
  const changed = vi.fn();
  client.setSessionsChangedHandler(changed);
  client.setQuestionHandler(async () => {});
  const internals = client as unknown as Internals;
  let turns: { id: string; status: string }[] = [];
  let items: unknown[] = [];
  internals.request = vi.fn(async (method: string) => method === "thread/turns/list"
    ? { data: turns.map((t) => ({ ...t, completedAt: t.status === "inProgress" ? null : 1_787_900_050, error: null })), nextCursor: null, backwardsCursor: null }
    : { data: items, nextCursor: null });
  return {
    internals, changed,
    setTurns: (value: typeof turns) => { turns = value; },
    setItems: (value: unknown[]) => { items = value; },
    view: () => internals.sessionView(thread),
  };
}
const asking = (turnId = "u1") => ({ turnId, completedAtMs: Date.now(), item: { id: "msg_q", type: "agentMessage", text: "Which?", phase: "final_answer", questions: [question] } });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("running status from the terminal monitor", () => {
  it("reports active while the newest turn is inProgress and clears when it is not", async () => {
    const f = setup();
    expect(f.view().status).toBe("notLoaded");
    f.setTurns([{ id: "u1", status: "inProgress" }]);
    await f.internals.emitRecentTerminals(session, 0);
    expect(f.view().status).toBe("active");
    f.setTurns([{ id: "u1", status: "completed" }]);
    await f.internals.emitRecentTerminals(session, 0);
    expect(f.view().status).toBe("notLoaded");
  });
  it("reports active for a controlled (watch-started) turn and ignores stale monitor evidence", async () => {
    const f = setup();
    f.internals.controlledTurnIds.set("t1", "turn-w");
    expect(f.view().status).toBe("active");
    f.internals.controlledTurnIds.clear();
    f.setTurns([{ id: "u1", status: "inProgress" }]);
    await f.internals.emitRecentTerminals(session, 0);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(f.view().status).toBe("notLoaded");
  });
  it("keeps App Server active and error statuses", () => {
    const f = setup();
    expect(f.internals.sessionView({ ...thread, status: { type: "active" } }).status).toBe("active");
    expect(f.internals.sessionView({ ...thread, status: { type: "systemError" } }).status).toBe("error");
  });
  it("clears running state on turn/completed for that turn", async () => {
    const f = setup();
    f.setTurns([{ id: "u1", status: "inProgress" }]);
    await f.internals.emitRecentTerminals(session, 0);
    await f.internals.handleNotification("turn/completed", { threadId: "t1", turn: { id: "u1", status: "completed", completedAt: 1_787_900_060, error: null } }).catch(() => {});
    expect(f.internals.runningTurns.has("t1")).toBe(false);
  });
});

describe("question and approval attention", () => {
  async function asked(f: ReturnType<typeof setup>) {
    f.internals.chatCaches.clear();
    f.setTurns([{ id: "u1", status: "inProgress" }]);
    f.setItems([asking()]);
    await f.internals.emitRecentTerminals(session, 0);
  }
  it("marks a question until a newer turn starts in that chat", async () => {
    const f = setup();
    await asked(f);
    expect(f.view().attention).toBe("question");
    f.setTurns([{ id: "u2", status: "inProgress" }, { id: "u1", status: "completed" }]);
    f.setItems([]);
    await f.internals.emitRecentTerminals(session, 0);
    expect(f.view().attention).toBeUndefined();
  });
  it("keeps the question after its own turn completes", async () => {
    const f = setup();
    await asked(f);
    f.setTurns([{ id: "u1", status: "completed" }]);
    await f.internals.emitRecentTerminals(session, 0);
    expect(f.view().attention).toBe("question");
  });
  it("clears when a reply wrapper for that item is seen", async () => {
    const f = setup();
    await asked(f);
    const reply = buildQuestionReplyText({ questionItemId: "msg_q", questionIndex: 0, question: "Q", answer: "A" });
    f.setItems([{ turnId: "u1", item: { id: "r1", type: "userMessage", content: [{ type: "text", text: reply }] } }, asking()]);
    await f.internals.emitRecentTerminals(session, 0);
    expect(f.view().attention).toBeUndefined();
  });
  it("clears when the chat cache holds the reply", async () => {
    const f = setup();
    await asked(f);
    const reply = buildQuestionReplyText({ questionItemId: "msg_q", questionIndex: 0, question: "Q", answer: "A" });
    const m = { turnId: "u1", kind: "message", phase: "unknown", approvalId: null, canControl: false, resolved: true };
    f.internals.chatCaches.set("t1", { threadId: "t1", title: "T", status: "idle", messages: [{ ...m, id: "msg_q", role: "assistant", text: "x" }, { ...m, id: "r", role: "user", text: reply }] });
    expect(f.view().attention).toBeUndefined();
  });
  it("expires after 24 hours", async () => {
    const f = setup();
    await asked(f);
    await vi.advanceTimersByTimeAsync(24 * 3_600_000 + 1_000);
    expect(f.view().attention).toBeUndefined();
  });
  it("shows approval while an approval is held and prefers it over a question", async () => {
    const f = setup();
    await asked(f);
    f.internals.approvals.set("a1", { rpcId: 1, method: "command", threadId: "t1" });
    expect(f.view().attention).toBe("approval");
    f.internals.approvals.delete("a1");
    expect(f.view().attention).toBe("question");
    f.internals.approvals.set("a2", { rpcId: 2, method: "command", threadId: "other" });
    expect(f.view().attention).toBe("question");
  });
});

describe("sessions refresh trigger", () => {
  it("fires once, debounced, when status or attention changes, and stays quiet otherwise", async () => {
    const f = setup();
    f.setTurns([{ id: "u1", status: "inProgress" }]);
    await f.internals.emitRecentTerminals(session, 0);
    await f.internals.emitRecentTerminals(session, 0);
    f.setItems([asking()]);
    await f.internals.emitRecentTerminals(session, 0);
    expect(f.changed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.changed).toHaveBeenCalledTimes(1);
    await f.internals.emitRecentTerminals(session, 0); // unchanged
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.changed).toHaveBeenCalledTimes(1);
    f.internals.approvals.set("a1", { rpcId: 1, method: "command", threadId: "t1" });
    f.internals.noteDerivedState("t1");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.changed).toHaveBeenCalledTimes(2);
  });
});
