import { describe, expect, it, vi } from "vitest";
import { cloudMessages, DesktopCloudObserver, type CloudReadConnection } from "../src/desktop-cloud-adapter.js";
import { cloudEventId, type CloudSnapshot, type CloudTerminal, type DesktopCloudConfig } from "../src/desktop-cloud-protocol.js";

const config: DesktopCloudConfig = { version: 1, enabled: true, capability: "a".repeat(64), pairBinding: "b".repeat(64),
  targets: [{ hostId: "durable", threadId: "cloud-1", title: "Cloud test" }], reconcileMs: 2_000 };
const finished = (id: string, reply = "CLOUD WATCH TEST") => ({ id, status: "completed", completedAt: Date.now() / 1000,
  items: [{ item: { id: `${id}-reply`, type: "agentMessage", phase: "final_answer", text: reply } }] });
function harness(initial: unknown[] = [finished("old")]) {
  let notification!: (event: unknown) => void, principal!: () => void, stateChange!: (state: string) => void;
  let state = "connected";
  const remove = vi.fn();
  const connection: CloudReadConnection = {
    readThread: vi.fn().mockResolvedValue({ id: "cloud-1" }),
    listThreadTurns: vi.fn().mockResolvedValue({ data: initial }), getConnectionState: () => state,
    registerInternalNotificationHandler: (fn) => { notification = fn; return remove; },
    registerInternalAuthenticatedPrincipalChangeHandler: (fn) => { principal = fn; return remove; },
    registerInternalConnectionStateHandler: (fn) => { stateChange = fn; return remove; },
  };
  const snapshots: CloudSnapshot[] = [], terminals: CloudTerminal[] = [], reset = vi.fn();
  const observer = new DesktopCloudObserver(config, connection, (snapshot) => snapshots.push(snapshot),
    (event) => terminals.push(event), reset, vi.fn());
  observer.start();
  return { observer, connection, snapshots, terminals, reset, remove, notify: (event: unknown) => notification(event),
    principal: () => principal(), state: (value: string) => { state = value; stateChange(value); } };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("desktop-owned cloud observer", () => {
  it("seeds with bounded shared reads, suppresses old completions and sends only the real top-level terminal", async () => {
    const h = harness();
    try {
      await settle();
      expect(h.connection.readThread).toHaveBeenCalledWith("cloud-1", { includeTurns: false, threadAccess: "shared" }, expect.objectContaining({ priority: "background" }));
      expect(h.connection.listThreadTurns).toHaveBeenCalledWith("cloud-1", { limit: 3, itemsView: "full" }, expect.anything());
      expect(h.terminals).toHaveLength(0);
      for (const method of ["item/reasoning/summaryTextDelta", "item/completed", "rawResponseItem/completed", "turn/started"]) {
        h.notify({ method, params: { threadId: "cloud-1", turn: finished("no-terminal"), item: { type: "reasoning", text: "private" } } });
      }
      h.notify({ method: "turn/completed", params: { threadId: "another-cloud", turn: finished("other") } });
      expect(h.terminals).toHaveLength(0);
      h.notify({ method: "turn/completed", params: { threadId: "cloud-1", turn: finished("new") } });
      expect(h.terminals).toEqual([expect.objectContaining({ source: "notification", detail: "CLOUD WATCH TEST", turnId: "new",
        eventId: cloudEventId("cloud-1", "new", "terminal.completed") })]);
      h.notify({ method: "turn/completed", params: { threadId: "cloud-1", turn: finished("new") } });
      vi.mocked(h.connection.listThreadTurns).mockResolvedValue({ data: [finished("new")] });
      await h.observer.reconcile();
      expect(h.terminals).toHaveLength(1);
    } finally { h.observer.dispose(); }
    expect(h.remove).toHaveBeenCalledTimes(3);
  });
  it("reconciles a completion when the desktop sends no notification", async () => {
    const h = harness();
    try {
      await settle();
      vi.mocked(h.connection.listThreadTurns).mockResolvedValue({ data: [finished("missed"), finished("old")] });
      await h.observer.reconcile();
      expect(h.terminals).toEqual([expect.objectContaining({ source: "reconcile", turnId: "missed", detail: "CLOUD WATCH TEST" })]);
      expect(h.connection.readThread).toHaveBeenCalledTimes(1);
    } finally { h.observer.dispose(); }
  });
  it("hydrates the real final answer when a terminal notification omits its items", async () => {
    const h = harness();
    try {
      await settle();
      vi.mocked(h.connection.listThreadTurns).mockResolvedValue({ data: [finished("summary-only")] });
      h.notify({ method: "turn/completed", params: { threadId: "cloud-1", turn: { ...finished("summary-only"), items: [] } } });
      await settle();
      expect(h.terminals).toEqual([expect.objectContaining({ turnId: "summary-only", detail: "CLOUD WATCH TEST", source: "notification" })]);
    } finally { h.observer.dispose(); }
  });
  it("bounds the preview hydration delay when history cannot supply the answer", async () => {
    vi.useFakeTimers();
    const h = harness();
    try {
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(h.connection.listThreadTurns).mockRejectedValue(new Error("Temporarily unavailable"));
      h.notify({ method: "turn/completed", params: { threadId: "cloud-1", turn: { ...finished("missing"), items: [] } } });
      await vi.advanceTimersByTimeAsync(2_499); expect(h.terminals).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.terminals[0]?.detail).toBe("The cloud reply is ready. Open the chat to read it.");
    } finally { h.observer.dispose(); vi.useRealTimers(); }
  });
  it("invalidates in-flight reads and history on account change", async () => {
    const h = harness();
    try {
      await settle();
      let complete!: (value: unknown) => void;
      vi.mocked(h.connection.listThreadTurns).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
      const read = h.observer.reconcile();
      h.principal(); complete({ data: [finished("retired-account")] }); await read;
      expect(h.reset).toHaveBeenCalledOnce(); expect(h.terminals).toHaveLength(0);
      vi.mocked(h.connection.readThread).mockRejectedValue(new Error("Access denied"));
      await h.observer.reconcile();
      expect(h.terminals).toHaveLength(0);
      expect(h.snapshots.at(-1)?.messages.some((m) => m.turnId === "retired-account")).toBe(false);
    } finally { h.observer.dispose(); }
  });
  it("preserves a terminal notification arriving during the initial read", async () => {
    const h = harness([finished("racing")]);
    try {
      h.notify({ method: "turn/completed", params: { threadId: "cloud-1", turn: finished("racing") } });
      await settle();
      expect(h.terminals).toHaveLength(1);
    } finally { h.observer.dispose(); }
  });
  it("never replaces newer streamed text with a stale reconciliation response", async () => {
    const h = harness();
    try {
      await settle();
      let complete!: (value: unknown) => void;
      vi.mocked(h.connection.listThreadTurns).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
      const read = h.observer.reconcile();
      h.notify({ method: "item/agentMessage/delta", params: { threadId: "cloud-1", turnId: "new", itemId: "new-item", delta: "Fresh output" } });
      complete({ data: [finished("old")] }); await read;
      expect(h.snapshots.at(-1)?.messages.at(-1)?.text).toBe("Fresh output");
    } finally { h.observer.dispose(); }
  });
  it("does not read on a disconnected native connection or replay stale completions", async () => {
    const h = harness();
    try {
      await settle(); h.state("disconnected");
      await h.observer.reconcile();
      expect(h.connection.listThreadTurns).toHaveBeenCalledTimes(1);
      vi.mocked(h.connection.listThreadTurns).mockResolvedValue({ data: [{ ...finished("stale"), completedAt: (Date.now() - 120_000) / 1000 }] });
      h.state("connected"); await settle();
      expect(h.terminals).toHaveLength(0);
    } finally { h.observer.dispose(); }
  });
  it("normalizes wrapped items and excludes tool, reasoning and approval content", () => {
    const messages = cloudMessages({ id: "t", items: [
      { item: { id: "u", type: "userMessage", content: [{ type: "text", text: "Hello" }] } },
      { id: "r", type: "reasoning", text: "private reasoning" },
      { id: "c", type: "commandExecution", text: "tool output" },
      { id: "p", type: "approval", approvalId: "secret-control" },
      { id: "a", type: "agentMessage", phase: "final_answer", text: "Visible answer" },
    ] });
    expect(messages.map((m) => m.text)).toEqual(["Hello", "Visible answer"]);
    expect(messages.every((m) => m.canControl === false && m.approvalId === null)).toBe(true);
  });
});
