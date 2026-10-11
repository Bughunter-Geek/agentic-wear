import { describe, expect, it, vi } from "vitest";
import {
  AppServerClient,
  buildQuestionReplyText,
  displayUserText,
  materializeChat,
  questionReplyItemIds,
  type QuestionEvent,
  type TerminalEvent,
} from "../src/app-server-client.js";
import { BridgeService } from "../src/bridge-service.js";
import { questionRequestEventSchema, watchPayloadSchema } from "../src/schemas.js";
import { shouldWakeWatch } from "../src/wake-policy.js";

const OPEN = "<send_user_message_question_reply>";
const CLOSE = "</send_user_message_question_reply>";
const wrapper = (entries: unknown[]) => `${OPEN}${JSON.stringify(entries)}${CLOSE}`;
const encodedId = (itemId: string, index = 0) => JSON.stringify(["request_user_input_async", itemId, index]);

describe("displayUserText", () => {
  it("renders a real-shaped question reply as quoted question plus answer", () => {
    const text = wrapper([{ questionItemId: encodedId("msg_abc"), question: "Which database?", answer: "Postgres" }]);
    expect(displayUserText(text)).toBe("> Which database?\nPostgres");
  });
  it("joins several entries with a blank line and cuts long questions at 120 characters", () => {
    const long = "q".repeat(130);
    const text = wrapper([
      { questionItemId: encodedId("a"), question: long, answer: "one" },
      { questionItemId: encodedId("b", 1), question: "Second?", answer: "two" },
    ]);
    expect(displayUserText(text)).toBe(`> ${"q".repeat(120)}…\none\n\n> Second?\ntwo`);
  });
  it("shows the inner text when it cannot be parsed", () => {
    expect(displayUserText(`${OPEN}just some text${CLOSE}`)).toBe("just some text");
    expect(displayUserText(`${OPEN}{"not":"an array"}${CLOSE}`)).toBe('{"not":"an array"}');
  });
  it("removes internal context blocks and drops a message left empty", () => {
    expect(displayUserText("Hello\n<environment_context>\n<cwd>/x</cwd>\n</environment_context>")).toBe("Hello");
    expect(displayUserText("<turn_aborted>x</turn_aborted>\n<external_codex_apps_open_page>y</external_codex_apps_open_page>")).toBe("");
    expect(displayUserText("plain")).toBe("plain");
  });
});

describe("question reply text", () => {
  it("round-trips through the wrapper, escapes < and decodes the item id", () => {
    const built = buildQuestionReplyText({ questionItemId: "msg_abc", questionIndex: 0, question: "Use <b> or not?", answer: "a </b> tag" });
    expect(built).toBe(`${OPEN}\n[{"questionItemId":"[\\"request_user_input_async\\",\\"msg_abc\\",0]","question":"Use \\u003cb> or not?","answer":"a \\u003c/b> tag"}]\n${CLOSE}`);
    const json = built.slice(OPEN.length + 1, -CLOSE.length - 1);
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual([{ questionItemId: encodedId("msg_abc"), question: "Use <b> or not?", answer: "a </b> tag" }]);
    expect(displayUserText(built)).toBe("> Use <b> or not?\na </b> tag");
    expect(questionReplyItemIds(built)).toEqual(["msg_abc"]);
    expect(questionReplyItemIds("hello")).toEqual([]);
    const bare = wrapper([{ questionItemId: encodedId("msg_abc"), question: "Q", answer: "A" }]);
    expect(questionReplyItemIds(bare)).toEqual(["msg_abc"]);
    expect(displayUserText(bare)).toBe("> Q\nA");
    expect(displayUserText(`${OPEN}\nplain\n${CLOSE}`)).toBe("plain");
  });
});

const msg = (extra: Record<string, unknown>) => ({
  turnId: "t1", kind: "message", phase: "final_answer", approvalId: null, canControl: false, resolved: false, ...extra,
});

describe("chat snapshot questions", () => {
  const asking = msg({ id: "msg_q", role: "assistant", text: "Pick one", questions: [{ title: "Which?", options: ["A", "B"] }], questionTitles: ["Which?"] });
  it("carries questions, item id and unanswered state", () => {
    const chat = materializeChat({ threadId: "t", title: "T", status: "active", messages: [asking] as never });
    expect(chat.messages[0]).toMatchObject({ questions: [{ title: "Which?", options: ["A", "B"] }], questionItemId: "msg_q", answered: false });
    expect(chat.messages[0]).not.toHaveProperty("questionTitles");
  });
  it("marks answered only by a later reply to this item, and shows clean user text", () => {
    const reply = msg({ id: "u1", role: "user", phase: "unknown", text: buildQuestionReplyText({ questionItemId: "msg_q", questionIndex: 0, question: "Which?", answer: "A" }) });
    const other = msg({ id: "u0", role: "user", phase: "unknown", text: buildQuestionReplyText({ questionItemId: "other", questionIndex: 0, question: "Q", answer: "A" }) });
    const before = materializeChat({ threadId: "t", title: "T", status: "idle", messages: [reply, asking] as never });
    expect(before.messages.find((m) => m.id === "msg_q")?.answered).toBe(false);
    const after = materializeChat({ threadId: "t", title: "T", status: "idle", messages: [other, asking, reply] as never });
    expect(after.messages.find((m) => m.id === "msg_q")?.answered).toBe(true);
    expect(after.messages.find((m) => m.id === "u1")?.text).toBe("> Which?\nA");
  });
  it("drops user messages with nothing visible and leaves plain messages without question fields", () => {
    const hidden = msg({ id: "u2", role: "user", phase: "unknown", text: "<environment_context>x</environment_context>" });
    const plain = msg({ id: "a1", role: "assistant", text: "Hi" });
    const chat = materializeChat({ threadId: "t", title: "T", status: "idle", messages: [hidden, plain] as never });
    expect(chat.messages.map((m) => m.id)).toEqual(["a1"]);
    expect(chat.messages[0]).not.toHaveProperty("questions");
    expect(chat.messages[0]).not.toHaveProperty("answered");
  });
});

type Internals = {
  request: (method: string, params: unknown, timeoutMs?: number) => Promise<unknown>;
  handleNotification: (method: string, params: unknown) => Promise<void>;
  emitRecentTerminals: (session: unknown, newerThanMs: number) => Promise<void>;
  chatCaches: Map<string, unknown>;
  threadCache: Map<string, unknown>;
  findQuestionTitle: (threadId: string, itemId: string, index: number) => Promise<string | null>;
};
const thread = { id: "thread-1", preview: "p", name: "Watch session", updatedAt: 1_787_900_000, status: { type: "idle" }, parentThreadId: null, agentRole: null };
const session = { id: "thread-1", title: "Watch session", updatedAt: 1_787_900_020_000, status: "active", ownedByWear: false, canAcceptDirectInput: false };
const question = { title: "Which database should I use for this service?", options: ["Postgres", "SQLite"] };

function setup() {
  const questions: QuestionEvent[] = [];
  const terminals: TerminalEvent[] = [];
  const client = new AppServerClient(new Set(), async (e) => { terminals.push(e); }, async () => {});
  client.setQuestionHandler(async (e) => { questions.push(e); });
  const internals = client as unknown as Internals;
  internals.threadCache.set("thread-1", thread);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  return { questions, terminals, internals, log };
}
const itemCompleted = (completedAtMs = Date.now(), id = "msg_q1") => ({
  threadId: "thread-1", turnId: "turn-1", completedAtMs,
  item: { id, type: "agentMessage", text: "Which database?", phase: "final_answer", delivery: "async", questions: [question] },
});

describe("question.request events", () => {
  it("emits for a live item/completed once, with trimmed fields and metadata-only logs", async () => {
    const { questions, internals, log } = setup();
    await internals.handleNotification("item/completed", itemCompleted());
    await internals.handleNotification("item/completed", itemCompleted());
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      eventId: "question:thread-1:msg_q1", kind: "question.request", threadId: "thread-1", title: "Watch session",
      detail: question.title, options: ["Postgres", "SQLite"], questionItemId: "msg_q1", questionIndex: 0,
    });
    expect(questionRequestEventSchema.safeParse({ version: 1, ...questions[0] }).success).toBe(true);
    const logged = log.mock.calls.map(([l]) => String(l)).filter((l) => l.includes("watch.question."));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("watch.question.detected");
    expect(logged[0]).not.toContain("database");
  });
  it("skips items older than 10 minutes and items already answered", async () => {
    const { questions, internals } = setup();
    await internals.handleNotification("item/completed", itemCompleted(Date.now() - 11 * 60_000, "old"));
    expect(questions).toHaveLength(0);
    internals.chatCaches.set("thread-1", { threadId: "thread-1", title: "T", status: "active", messages: [
      msg({ id: "msg_q2", role: "assistant", text: "x" }),
      msg({ id: "u", role: "user", phase: "unknown", text: buildQuestionReplyText({ questionItemId: "msg_q2", questionIndex: 0, question: "Q", answer: "A" }) }),
    ] });
    await internals.handleNotification("item/completed", itemCompleted(Date.now(), "msg_q2"));
    expect(questions).toHaveLength(0);
  });
  it("detects questions in a running turn through the monitor, deduping against later completion", async () => {
    const { questions, terminals, internals } = setup();
    const turns = (status: string) => ({ data: [{ id: "turn-1", status, completedAt: status === "inProgress" ? null : 1_787_900_010, error: null }], nextCursor: null, backwardsCursor: null });
    const item = { turnId: "turn-1", completedAtMs: Date.now(), item: { id: "msg_q3", type: "agentMessage", text: "Which?", phase: "final_answer", questions: [question] } };
    let status = "inProgress";
    internals.request = vi.fn((method: string) => method === "thread/turns/list" ? Promise.resolve(turns(status))
      : Promise.resolve({ data: [item, { turnId: "turn-1", item: { id: "c1", type: "commandExecution" } }], nextCursor: null }));
    await internals.emitRecentTerminals(session, 1_787_900_000_000);
    await internals.emitRecentTerminals(session, 1_787_900_000_000);
    expect(questions.map((q) => q.questionItemId)).toEqual(["msg_q3"]);
    const call = vi.mocked(internals.request).mock.calls.find(([m]) => m === "thread/items/list");
    expect(call?.[1]).toEqual({ threadId: "thread-1", turnId: "turn-1", sortDirection: "desc", limit: 10 });
    expect(call?.[2]).toBe(1_500);
    status = "completed";
    await internals.emitRecentTerminals(session, 1_787_900_000_000);
    expect(questions).toHaveLength(1);
    expect(terminals[0]?.hasQuestion).toBe(true);
  });
  it("does not re-announce a question answered inside the running turn, and never throws on list failure", async () => {
    const { questions, internals } = setup();
    const running = { data: [{ id: "turn-1", status: "inProgress", completedAt: null, error: null }], nextCursor: null, backwardsCursor: null };
    const reply = buildQuestionReplyText({ questionItemId: "msg_q4", questionIndex: 0, question: "Q", answer: "A" });
    internals.request = vi.fn((method: string) => method === "thread/turns/list" ? Promise.resolve(running) : Promise.resolve({ data: [
      { turnId: "turn-1", item: { id: "u9", type: "userMessage", content: [{ type: "text", text: reply }] } },
      { turnId: "turn-1", completedAtMs: Date.now(), item: { id: "msg_q4", type: "agentMessage", text: "x", questions: [question] } },
    ] }));
    await internals.emitRecentTerminals(session, 0);
    expect(questions).toHaveLength(0);
    internals.request = vi.fn((method: string) => method === "thread/turns/list" ? Promise.resolve(running) : Promise.reject(new Error("timeout")));
    await expect(internals.emitRecentTerminals(session, 0)).resolves.toBeUndefined();
  });
  it("emits at turn completion when the final answer asks and was not seen mid-turn, with hasQuestion", async () => {
    const { questions, terminals, internals } = setup();
    internals.chatCaches.set("thread-1", { threadId: "thread-1", title: "T", status: "idle", messages: [
      msg({ id: "msg_q5", role: "assistant", text: "Which?", questions: [question], questionTitles: [question.title] }),
    ] });
    await internals.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "t1", status: "completed", completedAt: 1_787_900_010, error: null } });
    expect(questions.map((q) => q.questionItemId)).toEqual(["msg_q5"]);
    expect(terminals[0]?.hasQuestion).toBe(true);
  });
  it("omits hasQuestion for ordinary answers", async () => {
    const { terminals, internals } = setup();
    internals.chatCaches.set("thread-1", { threadId: "thread-1", title: "T", status: "idle", messages: [msg({ id: "a", role: "assistant", text: "Done" })] });
    await internals.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "t1", status: "completed", completedAt: 1_787_900_010, error: null } });
    expect(terminals[0]).not.toHaveProperty("hasQuestion");
  });
  it("wakes the watch", () => {
    expect(shouldWakeWatch("question.request")).toBe(true);
  });
  it("keeps the worst-case encrypted envelope within 3000 characters", () => {
    const uuid = "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b";
    const payload = {
      version: 1, kind: "question.request", eventId: `question:${uuid}:${uuid}`, threadId: uuid,
      title: "日".repeat(100), detail: "日".repeat(300), options: Array.from({ length: 4 }, () => "日".repeat(40)),
      questionItemId: uuid, questionIndex: 0, occurredAt: 1_787_900_010_000,
    };
    expect(questionRequestEventSchema.safeParse(payload).success).toBe(true);
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    const envelope = {
      version: 1, messageId: "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b", sender: "bridge", recipient: "watch", sentAt: 1_787_900_010_000,
      nonce: "A".repeat(16), ciphertext: "A".repeat(4 * Math.ceil((bytes + 16) / 3)),
    };
    expect(JSON.stringify(envelope).length).toBeLessThanOrEqual(3_000);
  });
});

describe("findQuestionTitle", () => {
  it("prefers the chat cache, then the newest items, else null", async () => {
    const { internals } = setup();
    internals.request = vi.fn(() => Promise.reject(new Error("no request")));
    internals.chatCaches.set("thread-1", { threadId: "thread-1", title: "T", status: "idle", messages: [
      msg({ id: "msg_q", role: "assistant", text: "x", questions: [question], questionTitles: ["Full cached title"] }),
    ] });
    expect(await internals.findQuestionTitle("thread-1", "msg_q", 0)).toBe("Full cached title");
    expect(internals.request).not.toHaveBeenCalled();
    internals.request = vi.fn(() => Promise.resolve({ data: [{ turnId: "t", item: { id: "msg_z", type: "agentMessage", text: "x", questions: [{ title: "  From items  " }] } }] }));
    expect(await internals.findQuestionTitle("thread-1", "msg_z", 0)).toBe("From items");
    expect(vi.mocked(internals.request).mock.calls[0]).toEqual(["thread/items/list", { threadId: "thread-1", sortDirection: "desc", limit: 100 }, 1_500]);
    expect(await internals.findQuestionTitle("thread-1", "missing", 0)).toBeNull();
    internals.request = vi.fn(() => Promise.reject(new Error("timeout")));
    expect(await internals.findQuestionTitle("thread-1", "msg_z", 0)).toBeNull();
  });
});

describe("question.answer payload", () => {
  const base = { version: 1, kind: "question.answer", requestId: "req-1", threadId: "thread-1", questionItemId: "msg_q", questionIndex: 0, answer: "  Postgres " };
  it("validates", () => {
    expect(watchPayloadSchema.parse(base)).toMatchObject({ answer: "Postgres" });
    expect(watchPayloadSchema.safeParse({ ...base, questionItemId: "bad id!" }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, questionIndex: 10 }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, answer: "  " }).success).toBe(false);
    expect(watchPayloadSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
  function service(title: string | null, settings: { model: string | null; effort: string | null } | null = null) {
    const svc = Object.create(BridgeService.prototype) as Record<string, unknown>;
    const submitTurn = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    Object.assign(svc, { appServer: { findQuestionTitle: vi.fn().mockResolvedValue(title), persistedThreadSettings: vi.fn().mockReturnValue(settings) }, submitTurn, send });
    const handle = (payload: unknown) => (svc.handleWatchPayload as (v: unknown) => Promise<void>).call(svc, payload);
    return { submitTurn, send, handle };
  }
  it("submits the built reply through the turn.submit path with defaults", async () => {
    const { submitTurn, handle } = service("Looked-up title");
    await handle(watchPayloadSchema.parse({ ...base, question: "watch copy" }));
    const submitted = submitTurn.mock.calls[0]![0] as { requestId: string; threadId: string; text: string; effort: string; followUpAction: string };
    expect(submitted).toMatchObject({ kind: "turn.submit", requestId: "req-1", threadId: "thread-1", effort: "medium", followUpAction: "default" });
    expect(displayUserText(submitted.text)).toBe("> Looked-up title\nPostgres");
    expect(questionReplyItemIds(submitted.text)).toEqual(["msg_q"]);
  });
  it("keeps the chat's persisted effort and model, falling back to medium", async () => {
    for (const [settings, effort] of [
      [{ model: "gpt-x", effort: "high" }, "high"], [null, "medium"], [{ model: null, effort: null }, "medium"],
      [{ model: null, effort: "bad effort!" }, "medium"],
    ] as const) {
      const { submitTurn, handle } = service("T", settings);
      await handle(watchPayloadSchema.parse(base));
      expect(submitTurn.mock.calls[0]![0]).toMatchObject({ effort, model: null });
      expect(submitTurn.mock.calls[0]![0]).not.toHaveProperty("fastMode");
    }
  });
  it("falls back to the watch's question, else replies with turn.error", async () => {
    const withFallback = service(null);
    await withFallback.handle(watchPayloadSchema.parse({ ...base, question: "watch copy" }));
    expect(displayUserText((withFallback.submitTurn.mock.calls[0]![0] as { text: string }).text)).toBe("> watch copy\nPostgres");
    const missing = service(null);
    await missing.handle(watchPayloadSchema.parse(base));
    expect(missing.submitTurn).not.toHaveBeenCalled();
    expect(missing.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn.error", requestId: "req-1", threadId: "thread-1" }));
  });
});
