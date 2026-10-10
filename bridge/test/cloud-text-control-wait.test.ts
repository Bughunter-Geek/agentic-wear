import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { CloudTextSession } from "../src/cloud-text-session.js";
import { waitForCloudTextWork } from "../src/cloud-text-control-wait.js";
import { CLOUD_TEXT_TARGET as target } from "../src/native-cloud-history.js";

async function fixture() {
  const parent = join(process.cwd(), ".bounded-poll-tests");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "case-"));
  let now = 1_800_000_000_000;
  const session = new CloudTextSession(directory, () => now, () => now);
  const native = { thread: { id: target.threadId, hostId: target.hostId, kind: "codex", title: target.title },
    page: { order: "newest_first", hasMore: false }, turns: [] };
  const handle = await session.control("start", { native }) as { sessionId: string; owner: string; drainUntil: number };
  const sleeps: number[] = [];
  let onSleep = async () => {};
  return { directory, session, handle, native, sleeps, now: () => now, advance: (ms: number) => { now += ms; },
    onSleep: (callback: () => Promise<void>) => { onSleep = callback; },
    timing: { now: () => now, sleep: async (ms: number) => { sleeps.push(ms); now += ms; await onSleep(); } } };
}

it("returns queued work immediately, without claiming or reading native history", async () => {
  const f = await fixture();
  await f.session.enqueue("wait-request", "Synthetic queued text");
  const before = await f.session.read(`${f.handle.sessionId}-history.json`);
  const result = await waitForCloudTextWork(f.session, f.handle, f.timing);
  expect(result.next).toEqual({ work: "reserve", requestId: "wait-request" });
  expect(result.waitTiming).toMatchObject({ checks: 1, reason: "work", durationMs: 0 });
  expect(f.sleeps).toEqual([]);
  expect(await f.session.read(`${f.handle.sessionId}-claim-0.json`)).toBeNull();
  expect(await f.session.read(`${f.handle.sessionId}-history.json`)).toEqual(before);
});

it("keeps heartbeat alive during a twelve-second finite idle wait without native work", async () => {
  const f = await fixture();
  const before = await f.session.read(`${f.handle.sessionId}-history.json`);
  const result = await waitForCloudTextWork(f.session, f.handle, f.timing);
  expect(result.waitTiming).toEqual({ durationMs: 12_000, checks: 13, reason: "timeout", maximumWaitMs: 12_000 });
  expect(f.sleeps).toEqual(Array(12).fill(1000));
  expect(await f.session.read(`${f.handle.sessionId}-heartbeat.json`)).toMatchObject({ owner: f.handle.owner, at: f.now() });
  expect(await f.session.read(`${f.handle.sessionId}-history.json`)).toEqual(before);
});

it("observes a request arriving inside the same CLI invocation at the next local check", async () => {
  const f = await fixture();
  f.onSleep(async () => { if (f.sleeps.length === 2) await f.session.enqueue("arrived-request", "Arrived during local wait"); });
  const result = await waitForCloudTextWork(f.session, f.handle, f.timing);
  expect(result.next).toEqual({ work: "reserve", requestId: "arrived-request" });
  expect(result.waitTiming).toMatchObject({ durationMs: 2000, checks: 3, reason: "work" });
  expect(await f.session.read(`${f.handle.sessionId}-claim-0.json`)).toBeNull();
});

it("rejects a foreign owner before heartbeat renewal or waiting", async () => {
  const f = await fixture();
  const before = await f.session.read(`${f.handle.sessionId}-heartbeat.json`);
  f.advance(2000);
  await expect(waitForCloudTextWork(f.session, { ...f.handle, owner: "foreign" }, f.timing)).rejects.toThrow("does not own");
  expect(await f.session.read(`${f.handle.sessionId}-heartbeat.json`)).toEqual(before);
  expect(f.sleeps).toEqual([]);
});

it("rechecks ownership and stop state on every local iteration", async () => {
  const f = await fixture();
  f.onSleep(async () => { await f.session.control("stop", f.handle); });
  await expect(waitForCloudTextWork(f.session, f.handle, f.timing)).rejects.toThrow("ended");
  expect(f.sleeps).toEqual([1000]);
  expect(await f.session.read(`${f.handle.sessionId}-disabled.json`)).toBeTruthy();
});

it("enforces drain expiry even while waiting for a terminal receipt", async () => {
  const f = await fixture();
  await f.session.enqueue("wait-request", "Synthetic queued text");
  await f.session.control("reserve", { ...f.handle, requestId: "wait-request", native: f.native });
  await f.session.control("uncertain", { ...f.handle, requestId: "wait-request" });
  f.advance(f.handle.drainUntil - f.now() - 500);
  await expect(waitForCloudTextWork(f.session, { ...f.handle, requestId: "wait-request" }, f.timing)).rejects.toThrow("ended");
  expect(await f.session.read(`${f.handle.sessionId}-claim-0.json`)).toBeTruthy();
});

it("waits for the exact uncertain receipt and cannot adopt a later queued request", async () => {
  const f = await fixture();
  await f.session.enqueue("wait-request", "Synthetic queued text");
  await f.session.control("reserve", { ...f.handle, requestId: "wait-request", native: f.native });
  await f.session.control("uncertain", { ...f.handle, requestId: "wait-request" });
  await f.session.enqueue("later-request", "Do not dispatch this fixture");
  const claim = await f.session.read(`${f.handle.sessionId}-claim-0.json`);
  f.onSleep(async () => { if (f.sleeps.length === 2) await f.session.publish(async () => {}, true); });
  const result = await waitForCloudTextWork(f.session, { ...f.handle, requestId: "wait-request" }, f.timing);
  expect(result.waitTiming).toMatchObject({ checks: 3, reason: "terminal_receipt", durationMs: 2000 });
  expect(result.terminalReceipt).toMatchObject({ requestId: "wait-request", stage: "uncertain", physicalDisplayVerified: false });
  expect(await f.session.read(`${f.handle.sessionId}-claim-0.json`)).toEqual(claim);
  expect(await f.session.read(`${f.handle.sessionId}-claim-1.json`)).toBeNull();
});

it.each([-1, 12001, 100.5, "12000", null])("rejects invalid wait bound %s before touching state", async waitMs => {
  let called = false;
  const stub = { control: async () => { called = true; return {}; } };
  // Null is rejected rather than silently opting into the default.
  await expect(waitForCloudTextWork(stub, { waitMs })).rejects.toThrow("Queue wait");
  expect(called).toBe(false);
});

it("retains the non-controller caller rejection for the new CLI operation", () => {
  expect(process.env.CODEX_THREAD_ID).not.toBe(target.controllerThreadId);
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/cloud-text-session-control.ts", import.meta.url)), "poll-wait", "{}"], { encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("existing approved controller task");
});
