import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import type { CloudTextSession } from "./cloud-text-session.js";

const MAX_WAIT_MS = 12_000;
const INTERVAL_MS = 1_000;
const terminalStages = new Set(["completed", "failed", "uncertain", "expired"]);

// One finite CLI invocation. Every check uses the existing ownership, stop,
// heartbeat and expiry guards. This helper cannot reserve or dispatch work.
export async function waitForCloudTextWork(
  session: Pick<CloudTextSession, "control">,
  input: Record<string, unknown>,
  timing = { now: () => performance.now(), sleep: (ms: number) => setTimeout(ms) },
): Promise<Record<string, unknown>> {
  const waitMs = "waitMs" in input ? input.waitMs : MAX_WAIT_MS;
  if (typeof waitMs !== "number" || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS)
    throw new Error("Queue wait must be an integer between zero and 12000 milliseconds");
  const { waitMs: _waitMs, ...handle } = input;
  const started = timing.now();
  let checks = 0;
  while (true) {
    const result = await session.control("poll", handle) as {
      next: { work: string; admissionClosed?: boolean };
      status: { sessionId: string; alive: boolean; entries: Array<{ requestId: string; stage: string; nativeTurnId?: string }> };
      terminalReceipt: { requestId: string; stage: string; nativeTurnId?: string } | null;
    };
    checks++;
    if (!result?.status || result.status.sessionId !== handle.sessionId || !Array.isArray(result.status.entries) ||
        !result.next || typeof result.next.work !== "string" || !("terminalReceipt" in result))
      throw new Error("Owned queue poll returned an invalid combined contract");
    const entry = result.status.entries.find(item => item.requestId === handle.requestId);
    const terminal = entry && terminalStages.has(entry.stage);
    const receipt = result.terminalReceipt;
    let reason: string | undefined;
    if (!result.status.alive) reason = "not_alive";
    else if (terminal && receipt && receipt.requestId === handle.requestId && receipt.stage === entry.stage &&
             (!entry.nativeTurnId || receipt.nativeTurnId === entry.nativeTurnId)) reason = "terminal_receipt";
    // A later queued request must not end the selected terminal receipt wait.
    else if (!terminal && result.next.work !== "idle") reason = "work";
    else if (!terminal && result.next.admissionClosed) reason = "admission_closed";
    const elapsed = Math.max(0, timing.now() - started);
    if (!reason && (elapsed >= waitMs || checks >= 14)) reason = "timeout";
    if (reason) return { ...result, waitTiming: { durationMs: elapsed, checks, reason, maximumWaitMs: waitMs } };
    await timing.sleep(Math.min(INTERVAL_MS, waitMs - elapsed));
  }
}
