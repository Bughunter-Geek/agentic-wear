import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CloudTextSession } from "../src/cloud-text-session.js";
import { CLOUD_TEXT_TARGET as TARGET, historyDeliveryTiming, historySnapshot, matchingNativeTurn, mergeNativeHistory, nativePrompt, readNativeCloud } from "../src/native-cloud-history.js";
import { BridgeService } from "../src/bridge-service.js";
import { AppServerClient, type SessionView } from "../src/app-server-client.js";

const native = (turns: unknown[] = []) => ({ thread: { id: TARGET.threadId, hostId: TARGET.hostId, kind: "codex", title: TARGET.title },
  page: { order: "newest_first", hasMore: true, nextCursor: "older-page" }, turns });
const message = (id: string, text: string, phase = "final_answer") => ({ type: "agentMessage", id, text, phase });
const user = (id: string, text: string) => ({ type: "userMessage", id, content: [{ type: "text", text }] });
const turn = (id: string, time: number, items: unknown[], status = "completed") => ({ id, startedAt: time, completedAt: status === "completed" ? time + 1_000 : null, status, items });
const incoming = (requestId: string, text: string, controller = TARGET.controllerThreadId) => ({ type: "userMessage", id: `native-user-${requestId}`,
  content: [{ type: "text", text: "native delegation wrapper", codexDelegation: { sourceThreadId: controller, input: nativePrompt(requestId, text) } }] });

async function fixture(initial: unknown = native()) {
  const parent = join(process.cwd(), ".automatic-cloud-tests");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "case-"));
  let now = 1_800_000_000_000;
  const session = new CloudTextSession(directory, () => now, () => now);
  const handle = await session.control("start", { native: initial }) as { sessionId: string; owner: string; expiresAt: number; drainUntil: number };
  return { directory, session, handle, now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("bounded automatic existing-cloud-task text", () => {
  it("polls queued work and status in one owned call without reading or claiming native work", async () => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Hello");
    const before = await f.session.read(`${f.handle.sessionId}-history.json`);
    f.advance(46_000);
    const poll = await f.session.control("poll", f.handle) as Record<string, any>;
    expect(poll.next).toEqual({ work: "reserve", requestId: "watch-one" });
    expect(poll.status).toMatchObject({ alive: true, entries: [{ requestId: "watch-one", stage: "queued" }] });
    expect(poll.terminalReceipt).toBeNull();
    expect(poll.controlTiming).toMatchObject({ controlStartedAt: f.now(), controlCompletedAt: f.now(), durationMs: 0 });
    expect(await f.session.read(`${f.handle.sessionId}-history.json`)).toEqual(before);
    expect(await f.session.read(`${f.handle.sessionId}-claim-0.json`)).toBeNull();
  });

  it("rejects foreign, stopped and exhausted pollers before renewing their heartbeat", async () => {
    const f = await fixture();
    const heartbeat = await f.session.read(`${f.handle.sessionId}-heartbeat.json`);
    f.advance(100);
    await expect(f.session.control("poll", { ...f.handle, owner: "foreign" })).rejects.toThrow("does not own");
    expect(await f.session.read(`${f.handle.sessionId}-heartbeat.json`)).toEqual(heartbeat);
    await f.session.control("stop", f.handle);
    await expect(f.session.control("poll", f.handle)).rejects.toThrow("ended");
    expect(await f.session.read(`${f.handle.sessionId}-heartbeat.json`)).toEqual(heartbeat);
    const expired = await fixture();
    expired.advance(32 * 60_000);
    await expect(expired.session.control("poll", expired.handle)).rejects.toThrow("ended");
  });

  it("combined sync reports newly completed progress and exact receipt without a second status call", async () => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Hello");
    await f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() });
    const result = await f.session.control("sync", { ...f.handle, requestId: "watch-one",
      native: native([turn("native-turn", f.now(), [incoming("watch-one", "Hello"), message("native-final", "Reply")])]) }) as Record<string, any>;
    expect(result.next).toMatchObject({ work: "idle" });
    expect(result.status.entries).toEqual([expect.objectContaining({ requestId: "watch-one", stage: "completed", nativeTurnId: "native-turn" })]);
    expect(result.terminalReceipt).toBeNull();
    await f.session.publish(async () => {}, true);
    const poll = await f.session.control("poll", { ...f.handle, requestId: "watch-one" }) as Record<string, any>;
    expect(poll.terminalReceipt).toMatchObject({ requestId: "watch-one", stage: "completed", nativeItemId: "native-final", physicalDisplayVerified: false });
    expect((await f.session.control("poll", { ...f.handle, requestId: "other-request" }) as Record<string, any>).terminalReceipt).toBeNull();
    await expect(f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() })).rejects.toThrow("already claimed");
  });

  it("never adopts a receipt belonging to another request or claiming physical display proof", async () => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Hello");
    const file = join(f.directory, `${f.handle.sessionId}-delivery-0.json`);
    for (const bad of [{ requestId: "other", stage: "completed", watchReceivedAt: f.now(), relayAcceptedAt: f.now(), physicalDisplayVerified: false },
      { requestId: "watch-one", stage: "completed", watchReceivedAt: f.now(), relayAcceptedAt: f.now(), physicalDisplayVerified: true }]) {
      await writeFile(file, JSON.stringify(bad), { mode: 0o600 });
      const poll = await f.session.control("poll", { ...f.handle, requestId: "watch-one" }) as Record<string, any>;
      expect(poll.terminalReceipt).toBeNull();
    }
  });

  it("combined sync writes one heartbeat, observes uncertainty without authorizing a resend, and retains expiry", async () => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Hello");
    await f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() });
    await f.session.control("uncertain", { ...f.handle, requestId: "watch-one" });
    const read = vi.spyOn(f.session, "read");
    const writer = vi.spyOn(f.session as unknown as {
      write: (name: string, value: unknown, once?: boolean) => Promise<void>;
    }, "write");
    await f.session.control("sync", { ...f.handle, requestId: "watch-one", native: native() });
    expect(writer.mock.calls.filter(([name]) => name === `${f.handle.sessionId}-heartbeat.json`)).toHaveLength(1);
    // Recursive next previously read the complete request queue twice and renewed its heartbeat twice.
    expect(read.mock.calls.filter(([name]) => name === `${f.handle.sessionId}-request-0.json`)).toHaveLength(2);
    const poll = await f.session.control("poll", { ...f.handle, requestId: "watch-one" }) as Record<string, any>;
    expect(poll.next.work).toBe("idle");
    expect(poll.status.entries[0].stage).toBe("uncertain");
    await expect(f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() })).rejects.toThrow("already claimed");
    const ended = await fixture();
    await ended.session.enqueue("waiting", "Draft");
    ended.advance(30 * 60_000);
    const expired = await ended.session.control("poll", ended.handle) as Record<string, any>;
    expect(expired.next.work).toBe("expired");
    await expect(ended.session.control("reserve", { ...ended.handle, requestId: "waiting", native: native() })).rejects.toThrow("admission window ended");
  });

  it("uses the same epoch-millisecond session contract as normal App Server mapping, including empty history", async () => {
    const seconds = 1_791_577_579;
    const f = await fixture(native([{ id: "recent", status: "completed", startedAt: seconds - 10, completedAt: seconds, items: [] }]));
    const local = Object.create(AppServerClient.prototype) as { sessionView: (thread: unknown) => SessionView };
    Object.assign(local, { watchOwnedThreadIds: new Set(), watchReadyThreads: new Set() });
    const normal = local.sessionView({ id: TARGET.threadId, name: "Normal", preview: "", updatedAt: seconds, status: { type: "idle" } });
    expect((await f.session.session())?.updatedAt).toBe(normal.updatedAt);
    expect(normal.updatedAt).toBe(seconds * 1000);
    const empty = await fixture();
    expect((await empty.session.session())?.updatedAt).toBe(empty.now());
  });

  it("correlates native cloud user history only with the exact trusted controller request", () => {
    const data = readNativeCloud(native([turn("real", 1000, [incoming("watch-one", "Preserve my text"), message("reply", "Answer")]),
      turn("foreign", 2000, [incoming("other", "Different task", "other-controller" as typeof TARGET.controllerThreadId)]),
      turn("desktop", 3000, [user("plain", nativePrompt("coincidence", "Desktop text"))])]));
    const history = mergeNativeHistory(null, data, 5000);
    const snapshot = historySnapshot(history);
    expect(snapshot.messages.find((m) => m.id === "native-user-watch-one")).toMatchObject({ text: "Preserve my text", watchRequestId: "watch-one" });
    expect(snapshot.messages.find((m) => m.id === "native-user-other")).not.toHaveProperty("watchRequestId");
    expect(snapshot.messages.find((m) => m.id === "plain")).not.toHaveProperty("watchRequestId");
    expect(snapshot.messages.find((m) => m.id === "reply")).not.toHaveProperty("watchRequestId");
    expect(historySnapshot(mergeNativeHistory(history, data, 6000)).messages.filter((m) => m.watchRequestId === "watch-one")).toHaveLength(1);
  });

  it("publishes precise cloud stages and exact terminal correlation without inventing a running turn", async () => {
    const f = await fixture();
    const events: Array<Record<string, unknown>> = [];
    const send = async (payload: Record<string, unknown>) => { events.push(payload); };
    await f.session.enqueue("watch-one", "Hello");
    await f.session.publish(send, false);
    expect(events.at(-1)).toMatchObject({ kind: "turn.started", requestId: "watch-one", deliveryState: "queued" });
    expect(events.at(-1)).not.toHaveProperty("nativeTurnId");
    f.advance(46_000);
    await f.session.publish(send, false);
    expect(events.at(-1)?.deliveryState).toBe("paused");
    await f.session.control("next", f.handle);
    await f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() });
    await f.session.publish(send, false);
    expect(events.at(-1)?.deliveryState).toBe("dispatching");
    f.advance(46_000);
    await f.session.publish(send, false);
    expect(events.at(-1)?.deliveryState).toBe("reconnecting");
    await f.session.control("accepted", { ...f.handle, requestId: "watch-one", native: { threadId: TARGET.threadId } });
    await f.session.publish(send, false);
    expect(events.at(-1)?.deliveryState).toBe("accepted");
    const observed = native([turn("native-turn", f.now(), [incoming("watch-one", "Hello")], "inProgress")]);
    await f.session.control("sync", { ...f.handle, native: observed });
    await f.session.publish(send, false);
    expect(events.at(-1)).toMatchObject({ deliveryState: "running", nativeTurnId: "native-turn" });
    await f.session.control("sync", { ...f.handle, native: native([turn("native-turn", f.now(), [incoming("watch-one", "Hello"), message("native-final", "Reply")])]) });
    await f.session.publish(send, true);
    expect(events.slice(-3).map((event) => event.kind)).toEqual(["turn.started", "terminal.completed", "chat.snapshot"]);
    expect(events.at(-3)).toMatchObject({ deliveryState: "completed", requestId: "watch-one", nativeTurnId: "native-turn" });
    expect(events.at(-2)).toMatchObject({ requestId: "watch-one", detail: "Reply" });
    const count = events.length;
    await f.session.publish(send, true);
    expect(events).toHaveLength(count);
    await expect(f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() })).rejects.toThrow("already claimed");
  });

  it("delivers completion before a failed bulk snapshot and never repeats the native dispatch", async () => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Hello");
    await f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() });
    await f.session.control("sync", { ...f.handle, native: native([turn("native-turn", f.now(), [incoming("watch-one", "Hello"), message("native-final", "Reply")])]) });
    const delivered: string[] = [];
    await expect(f.session.publish(async (payload) => {
      if (payload.kind === "chat.snapshot") throw Error("snapshot offline");
      delivered.push(payload.kind);
    }, true)).rejects.toThrow("snapshot offline");
    expect(delivered).toEqual(["turn.started", "terminal.completed"]);
    expect(await f.session.read(`${f.handle.sessionId}-delivery-0.json`)).toMatchObject({ requestId: "watch-one", stage: "completed", nativeItemId: "native-final" });
    expect(await f.session.read(`${f.handle.sessionId}-history-delivery.json`)).toBeNull();
    const retry = vi.fn().mockResolvedValue(undefined);
    await f.session.publish(retry, true);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ kind: "chat.snapshot" }));
    await expect(f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() })).rejects.toThrow("already claimed");
  });

  it.each(["uncertain", "failed", "expired"])("keeps the %s cloud state typed and correlated", async (stage) => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Hello");
    if (stage === "expired") await f.session.control("stop", f.handle);
    else {
      await f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() });
      if (stage === "uncertain") await f.session.control("uncertain", { ...f.handle, requestId: "watch-one" });
      else await f.session.control("sync", { ...f.handle, native: native([turn("native-turn", f.now(), [incoming("watch-one", "Hello")], "failed")]) });
    }
    const send = vi.fn().mockResolvedValue(undefined);
    await f.session.publish(send, false);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn.started", requestId: "watch-one", deliveryState: stage }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "terminal.failed", requestId: "watch-one", deliveryState: stage }));
  });

  it("requires exact native task identity before activation and imports its real history", async () => {
    const f = await fixture(native([turn("old", 1_700_000_000_000, [user("u-old", "Desktop message"), message("a-old", "Existing answer")])]));
    expect((await f.session.snapshot()).messages.map((m) => m.id)).toEqual(["u-old", "a-old"]);
    expect((await f.session.session())?.id).toBe(TARGET.threadId);
    const wrong = { ...native(), thread: { ...native().thread, id: "unrelated" } };
    await expect(f.session.control("start", { native: wrong })).rejects.toThrow();
    await expect(f.session.control("start", { native: native() })).rejects.toThrow("existing bounded");
  });

  it("persists duplicate request identity, serializes slots, and enforces the five-message bound", async () => {
    const f = await fixture();
    const requests = await Promise.all(Array.from({ length: 5 }, (_, n) => f.session.enqueue(`watch-${n}`, `Question ${n}`)));
    expect(new Set(requests.map((r) => r.requestId)).size).toBe(5);
    expect(await f.session.enqueue("watch-0", "Question 0")).toEqual(requests[0]);
    await expect(f.session.enqueue("watch-0", "different")).rejects.toThrow("different text");
    await expect(f.session.enqueue("watch-six", "One more")).rejects.toThrow("five-message");
    const restarted = new CloudTextSession(f.directory, f.now);
    expect(await restarted.enqueue("watch-0", "Question 0")).toEqual(requests[0]);
  });

  it("does not claim a busy native task, never claims twice, and omits every model override", async () => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Continue the work");
    const busy = native([turn("desktop-current", f.now(), [user("desktop-u", "Existing work")], "inProgress")]);
    expect(await f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: busy })).toEqual({ reserved: false, reason: "native_task_busy" });
    const claim = await f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() }) as { arguments: Record<string, unknown> };
    expect(Object.keys(claim.arguments).sort()).toEqual(["hostId", "prompt", "threadId"]);
    expect(claim.arguments.prompt).toBe(nativePrompt("watch-one", "Continue the work"));
    await expect(f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() })).rejects.toThrow("already claimed");
  });

  it("distinguishes native acceptance from observed running and completed reply", async () => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Explain the plan");
    await f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() });
    await f.session.control("accepted", { ...f.handle, requestId: "watch-one", native: { threadId: TARGET.threadId } });
    expect((await f.session.control("status") as { entries: Array<{ stage: string }> }).entries[0]?.stage).toBe("accepted");
    f.advance(1000);
    await f.session.control("sync", { ...f.handle, native: native([turn("native-turn", f.now(), [incoming("watch-one", "Explain the plan")], "inProgress")]) });
    expect((await f.session.control("status") as { entries: Array<{ stage: string }> }).entries[0]?.stage).toBe("running");
    await f.session.control("sync", { ...f.handle, native: native([turn("native-turn", f.now(), [incoming("watch-one", "Explain the plan"), message("native-final", "Here is the plan.")])]) });
    expect((await f.session.snapshot()).messages.map((m) => m.text)).toEqual(["Explain the plan", "Here is the plan."]);
    expect((await f.session.control("status") as { entries: Array<{ stage: string }> }).entries[0]?.stage).toBe("completed");
  });

  it("does not adopt a coincidental desktop reply or a message from another controller", async () => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Hello");
    await f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() });
    const read = native([turn("different", f.now(), [incoming("watch-one", "Hello", "other-controller" as typeof TARGET.controllerThreadId), message("wrong-final", "Unrelated")])]);
    await f.session.control("sync", { ...f.handle, native: read });
    expect((await f.session.control("status") as { entries: Array<{ stage: string }> }).entries[0]?.stage).toBe("dispatching");
    expect(matchingNativeTurn(readNativeCloud(read), { requestId: "watch-one", text: "Hello" }, [])).toBeNull();
  });

  it("reconciles a lost acknowledgement from native evidence without resending", async () => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Hello");
    await f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() });
    await f.session.control("uncertain", { ...f.handle, requestId: "watch-one" });
    f.advance(1000);
    await f.session.control("sync", { ...f.handle, native: native([turn("real", f.now(), [incoming("watch-one", "Hello"), message("real-final", "Hello back")])]) });
    expect((await f.session.control("status") as { entries: Array<{ stage: string }> }).entries[0]?.stage).toBe("completed");
    await expect(f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() })).rejects.toThrow("already claimed");
  });

  it("pauses on stale controller heartbeat and preserves strict expiry and records", async () => {
    const f = await fixture();
    await f.session.enqueue("watch-one", "Hello");
    f.advance(46_000);
    expect((await f.session.session())?.watchReady).toBe(false);
    await expect(f.session.enqueue("watch-two", "More")).rejects.toThrow("paused or ended");
    await f.session.control("next", f.handle);
    expect((await f.session.session())?.watchReady).toBe(true);
    f.advance(30 * 60_000);
    await expect(f.session.control("reserve", { ...f.handle, requestId: "watch-one", native: native() })).rejects.toThrow("window ended");
    await f.session.control("stop", f.handle);
    expect((await f.session.control("status") as { entries: Array<{ stage: string }> }).entries[0]?.stage).toBe("expired");
    expect(await f.session.read(`${f.handle.sessionId}-request-0.json`)).not.toBeNull();
  });

  it("retains native history across reconnects, deduplicates IDs, and updates partial assistant text", () => {
    const first = readNativeCloud(native([turn("t-1", 1000, [user("u-1", "Desktop question"), message("a-1", "First part", "commentary")], "inProgress")]));
    const h1 = mergeNativeHistory(null, first, 10000);
    const liveUpdate = readNativeCloud(native([turn("t-1", 1000,
      [user("u-1", "Desktop question"), message("a-1", "First part updated", "commentary")], "inProgress")]));
    const h1Updated = mergeNativeHistory(h1, liveUpdate, 15000);
    expect(h1Updated.messages.map((m) => m.id)).toEqual(["u-1", "a-1"]);
    expect(h1Updated.messages[1]?.text).toBe("First part updated");
    const second = readNativeCloud(native([turn("t-2", 2000, [user("u-2", "New desktop message"), message("a-2", "Answer")]),
      turn("t-1", 1000, [user("u-1", "Desktop question"), message("a-1", "First part updated", "commentary"), message("a-final", "Final answer")])]));
    const h2 = mergeNativeHistory(h1Updated, second, 20000);
    const h3 = mergeNativeHistory(h2, second, 30000);
    expect(h2.revision).toBe(h3.revision);
    expect(h3.messages.map((m) => m.id)).toEqual(["u-1", "a-final", "u-2", "a-2"]);
    expect(h3.messages[1]?.text).toBe("Final answer");
    expect(h3.messages.filter((m) => m.id === "u-1")).toHaveLength(1);
    expect(historySnapshot(h3).threadId).toBe(TARGET.threadId);
  });

  it("keeps the latest twelve visible messages in order and labels long-message truncation", () => {
    const data = readNativeCloud(native(Array.from({ length: 10 }, (_, i) => turn(`t-${i}`, 10000 + i,
      [user(`u-${i}`, `User ${i}`), message(`a-${i}`, i === 9 ? "x".repeat(7000) : `Answer ${i}`)])).reverse()));
    const snapshot = historySnapshot(mergeNativeHistory(null, data, 100000));
    expect(snapshot.messages).toHaveLength(12);
    expect(snapshot.messages[0]?.id).toBe("u-4");
    expect(snapshot.messages.at(-1)?.id).toBe("a-9");
    expect(snapshot.messages.at(-1)?.text).toContain("continues in Codex");
  });

  it("records history relay acceptance only after a successful send and republishes after restart", async () => {
    const f = await fixture(native([turn("t", fakedTime(), [user("u", "Desktop"), message("a", "Reply")])]));
    await expect(f.session.publish(async () => { throw new Error("offline"); }, true)).rejects.toThrow("offline");
    expect(await f.session.read(`${f.handle.sessionId}-history-delivery.json`)).toBeNull();
    const send = vi.fn().mockResolvedValue(undefined);
    await f.session.publish(send, true);
    await f.session.publish(send, true);
    expect(send).toHaveBeenCalledTimes(1);
    const restarted = new CloudTextSession(f.directory, f.now);
    await restarted.publish(send, true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await f.session.read(`${f.handle.sessionId}-history-delivery.json`)).toMatchObject({ messageIds: ["u", "a"], physicalDisplayVerified: false });
  });

  it("separates subscription waiting from send time and records direct chat-watch acceptance", async () => {
    const base = 1_800_000_000_000;
    const f = await fixture({ ...native([turn("t", base - 1000, [user("u", "Desktop"), message("a", "Reply")])]),
      observation: { readStartedAt: base - 100, readCompletedAt: base, pageCount: 1 } });
    const send = vi.fn(async () => { f.advance(230); });
    f.advance(193_000);
    await f.session.publish(send, false);
    expect(send).not.toHaveBeenCalled();
    expect(await f.session.read(`${f.handle.sessionId}-history-delivery.json`)).toBeNull();
    await f.session.control("stop", f.handle);
    await f.session.deliverSnapshot(send, "watch-refresh", { trigger: "direct",
      subscriptionAcceptedAt: f.now(), subscriptionExpiresAt: f.now() + 90_000 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ requestId: "watch-refresh", status: "notLoaded",
      messages: [expect.objectContaining({ id: "u" }), expect.objectContaining({ id: "a" })] }));
    const status = await f.session.control("status") as { alive: boolean; entries: unknown[]; timing: unknown };
    expect(status).toMatchObject({ alive: false, entries: [], timing: {
      localPersistToRelayAcceptedMs: 193_230, localPersistToPublishStartMs: 193_000, publishToRelayAcceptedMs: 230,
      trigger: "direct", publishDurationMs: 230, callbackLatenessMs: null,
      subscriptionAcceptedAt: base + 193_000, subscriptionExpiresAt: base + 283_000 } });
    await f.session.publish(send, true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("records no false direct receipt on failed send and preserves historical timing uncertainty", async () => {
    const f = await fixture(native([turn("t", fakedTime(), [user("u", "Desktop")])]));
    await expect(f.session.deliverSnapshot(async () => { throw new Error("offline"); }, "refresh")).rejects.toThrow("offline");
    expect(await f.session.read(`${f.handle.sessionId}-history-delivery.json`)).toBeNull();
    const data = { ...native(), observation: { readStartedAt: 100, readCompletedAt: 200, pageCount: 1 } };
    const history = mergeNativeHistory(null, readNativeCloud(data), 300);
    expect(historyDeliveryTiming(history, { revision: history.revision, relayAcceptedAt: 1000 })).toMatchObject({
      localPersistToRelayAcceptedMs: 700, localPersistToPublishStartMs: null, publishToRelayAcceptedMs: null });
  });

  it("keeps periodic callback lateness and subscription evidence separate from measured send duration", async () => {
    const base = 1_800_000_000_000;
    const f = await fixture({ ...native([turn("t", base - 1000, [user("u", "Desktop")])]),
      observation: { readStartedAt: base - 100, readCompletedAt: base, pageCount: 1 } });
    f.advance(2350);
    await f.session.publish(async () => { f.advance(80); }, true, { trigger: "periodic",
      subscriptionAcceptedAt: base + 500, subscriptionExpiresAt: base + 90_500, callbackLatenessMs: 350 });
    expect(await f.session.control("status")).toMatchObject({ timing: {
      localPersistToPublishStartMs: 2350, publishDurationMs: 80, trigger: "periodic", callbackLatenessMs: 350,
      subscriptionAcceptedAt: base + 500, subscriptionExpiresAt: base + 90_500 } });
  });

  it("uses the receipt-aware direct snapshot route without creating requests or touching native sends", async () => {
    const f = await fixture(native([turn("t", fakedTime(), [user("u", "Desktop")])]));
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    const localSnapshot = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    Object.assign(service, { cloudTextSession: f.session, cloudTextProof: null, appServer: { chatSnapshot: localSnapshot }, send });
    await (service.sendChatSnapshot as (threadId: string, requestId: string) => Promise<void>).call(service, TARGET.threadId, "watch-refresh");
    expect(localSnapshot).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ requestId: "watch-refresh", kind: "chat.snapshot" }));
    expect(await f.session.read(`${f.handle.sessionId}-history-delivery.json`)).toMatchObject({ messageIds: ["u"], physicalDisplayVerified: false });
    expect(await f.session.read(`${f.handle.sessionId}-request-0.json`)).toBeNull();
  });

  it("refuses symlinked state and invalid controller ownership", async () => {
    const f = await fixture();
    await expect(f.session.control("next", { ...f.handle, owner: "wrong" })).rejects.toThrow("does not own");
    const other = join(f.directory, "other.json");
    await writeFile(other, "{}", { mode: 0o600 });
    await symlink(other, join(f.directory, "link.json"));
    await expect(f.session.read("link.json")).rejects.toThrow();
  });

  it("timestamps a cloud snapshot by its native observation, so delayed old snapshots cannot look newer", async () => {
    const f = await fixture(native([turn("old", 1000, [user("u-old", "Old desktop message")])]));
    const original = await f.session.snapshot();
    f.advance(1000);
    expect((await f.session.snapshot()).generatedAt).toBe(original.generatedAt);
    await f.session.control("sync", { ...f.handle, native: native([turn("new", 2000, [user("u-new", "New desktop message")])]) });
    const updated = await f.session.snapshot();
    expect(updated.generatedAt).toBeGreaterThan(original.generatedAt);
    f.advance(5000);
    const sent: Array<Record<string, unknown>> = [];
    await f.session.publish(async (payload) => { sent.push(payload); }, true);
    expect(sent[0]?.generatedAt).toBe(updated.generatedAt);
  });

  it("routes this cloud session ahead of the retired proof and preserves native history/model settings", async () => {
    const f = await fixture(native([turn("old", 1000, [user("u-old", "Existing history")])]));
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    const localSubmit = vi.fn();
    const oldProof = { owns: () => true, enqueue: vi.fn(), snapshot: vi.fn() };
    const send = vi.fn().mockResolvedValue(undefined);
    Object.assign(service, { cloudTextSession: f.session, cloudTextProof: oldProof, appServer: { submitTurn: localSubmit }, send });
    await (service.handleWatchPayload as (payload: unknown) => Promise<void>).call(service, { version: 1, kind: "turn.submit",
      requestId: "watch-one", threadId: TARGET.threadId, text: "Hello", model: "different-model", effort: "low", fastMode: false });
    expect(localSubmit).not.toHaveBeenCalled();
    expect(oldProof.enqueue).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([payload]) => payload.kind)).toEqual(["turn.accepted", "turn.started", "chat.snapshot"]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn.started", requestId: "watch-one", deliveryState: "queued" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "chat.snapshot", messages: [expect.objectContaining({ id: "u-old" })] }));
    const stored = await f.session.read(`${f.handle.sessionId}-request-0.json`);
    expect(stored).not.toHaveProperty("model");
    expect(stored).not.toHaveProperty("effort");
    expect(stored).not.toHaveProperty("fastMode");
  });
});

function fakedTime() { return 1_700_000_000_000; }
