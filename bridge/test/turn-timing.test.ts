import { describe, expect, it } from "vitest";
import { TurnTiming } from "../src/turn-timing.js";

function fixture() {
  const lines: Record<string, unknown>[] = [];
  let now = 1_000;
  const timing = new TurnTiming((line) => lines.push(JSON.parse(line)), () => now);
  return { timing, lines, at: (ms: number) => { now = ms; }, summary: () => lines.find((l) => l.message === "watch.turn.timing.summary") };
}

describe("Watch turn stage timing", () => {
  it("summarises each stage once, from watch send to final snapshot", () => {
    const { timing, at, summary } = fixture();
    at(1_000); timing.begin("r1", "t1", 400);
    at(1_050); timing.markRequest("r1", "appServerAccepted");
    at(1_080); timing.markRequest("r1", "watchAckSent");
    at(1_200); timing.markThread("t1", "turnStarted");
    at(1_300); timing.markThread("t1", "firstStreamSnapshotSent"); // prompt echo: ignored before any reply token
    at(2_000); timing.markThread("t1", "firstDelta");
    at(2_100); timing.markThread("t1", "firstDelta");
    at(2_700); timing.markThread("t1", "firstStreamSnapshotSent");
    at(4_000); timing.markThread("t1", "turnCompleted");
    at(4_020); timing.markThread("t1", "terminalSentToWatch");
    at(4_300); timing.markThread("t1", "finalSnapshotSent");
    timing.finishThread("t1");
    expect(summary()).toMatchObject({
      requestId: "r1", watchToBridgeMs: 600, bridgeToAppServerAcceptMs: 50, bridgeToWatchAckMs: 80,
      bridgeToTurnStartMs: 200, bridgeToFirstDeltaMs: 1_000, bridgeToFirstStreamSnapshotMs: 1_700,
      bridgeToTurnCompletedMs: 3_000, turnCompletedToFinalSnapshotMs: 300, watchSendToFinalSnapshotMs: 3_900,
    });
  });

  it("binds a new chat's thread after creation and never logs text", () => {
    const { timing, lines, at, summary } = fixture();
    timing.begin("r2", null, null);
    timing.bindThread("r2", "t9");
    at(1_500); timing.markThread("t9", "turnCompleted");
    timing.finishThread("t9");
    expect(summary()).toMatchObject({ threadId: "t9", watchToBridgeMs: null, bridgeToTurnCompletedMs: 500 });
    expect(Object.keys(lines[0]!).sort()).toEqual(["at", "level", "message", "requestId", "sinceBridgeReceivedMs", "stage", "threadId"]);
  });

  it("ignores threads with no open Watch request", () => {
    const { timing, lines } = fixture();
    timing.markThread("other", "turnCompleted");
    timing.finishThread("other");
    expect(lines).toEqual([]);
  });
});
