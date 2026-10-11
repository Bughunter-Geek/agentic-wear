#!/usr/bin/env node
// Read-only correlation. Never prints chat text, pairing credentials or tokens.
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
const [logPath, requestedId = "latest", probePath] = process.argv.slice(2);
if (!logPath) throw new Error("Usage: report-cloud-latency.mjs BRIDGE_LOG [EVENT_ID|latest] [PROBE_JSON]");
const relayed = new Map(), traces = new Map(), ingress = new Map();
for await (const line of createInterface({ input: createReadStream(logPath), crlfDelay: Infinity })) {
  let value;
  try { value = JSON.parse(line); } catch { continue; }
  if (value.message === "desktop.cloud.terminal_relayed") relayed.set(value.eventId, value);
  if (value.message === "watch.notify.trace") for (const alert of value.alerts ?? []) {
    // Keep the first handling decision; a duplicate fetch is not a later delivery.
    if (!traces.has(alert.eventId)) traces.set(alert.eventId, { trace: value, alert });
  }
  if (value.message === "watch.notify.trace.ingress") for (const id of value.eventIds ?? []) if (!ingress.has(id)) ingress.set(id, value);
}
const eventId = requestedId === "latest" ? [...relayed.keys()].at(-1) : requestedId;
const sent = relayed.get(eventId), received = traces.get(eventId), envelope = ingress.get(eventId);
const probe = probePath ? JSON.parse(await readFile(probePath, "utf8")) : null;
const matchingProbe = probe && sent && probe.targetThreadId === sent.threadId && probe.turnId === sent.turnId &&
  Number.isFinite(probe.submittedAt) && probe.submittedAt <= sent.desktopObservedAt;
const nonnegative = (value) => Number.isFinite(value) && value >= 0 ? value : null;
const result = { eventId: eventId ?? null,
  state: !sent ? "awaiting_desktop_delivery" : !received ? "awaiting_watch_trace" : "watch_handling_recorded",
  source: sent?.source ?? null, desktopToRelayMs: sent?.desktopToRelayMs ?? null,
  watchDecision: received?.alert.decision ?? null, watchDeliveredVia: received?.trace.deliveredVia ?? null,
  desktopObservationToWatchRoundTripUpperBoundMs: received && sent ? nonnegative(received.trace.receivedAt - sent.desktopObservedAt) : null,
  testPromptToWatchRoundTripUpperBoundMs: received && matchingProbe ? nonnegative(received.trace.receivedAt - probe.submittedAt) : null,
  nativeCompletionToWatchClockEstimateMs: received && sent?.nativeCompletedAt ? received.alert.decidedAt - sent.nativeCompletedAt : null,
  watchTraceReturnClockEstimateMs: envelope ? envelope.receivedAt - envelope.watchSentAt : null,
  limitations: ["Round-trip bounds use the Mac clock at both ends; they include the Watch telemetry return trip.",
    "The prompt bound is populated only for a probe with the same confirmed target thread and turn IDs.",
    "Cross-device clock estimates are not clock-calibrated; native completion timestamps may have one-second precision.",
    "Build 84 traces record Watch handling decisions, not rendered pixels or OS notification permission. Confirm visible display on the physical Watch."] };
console.log(JSON.stringify(result, null, 2));
