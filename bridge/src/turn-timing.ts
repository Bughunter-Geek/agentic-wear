// Stage timing for direct (Mac-hosted) Watch turns. Logs only ids, stage
// names and timestamps — never prompt or reply text.

export type TurnStage =
  | "bridgeReceived"
  | "appServerAccepted"
  | "watchAckSent"
  | "turnStarted"
  | "firstDelta"
  | "firstStreamSnapshotSent"
  | "turnCompleted"
  | "terminalSentToWatch"
  | "finalSnapshotSent";

interface ActiveTiming {
  requestId: string;
  threadId: string | null;
  watchSentAt: number | null;
  receivedAt: number;
  stages: Partial<Record<TurnStage, number>>;
}

const MAX_ACTIVE = 32;
const STALE_MS = 15 * 60_000;

export class TurnTiming {
  private readonly active = new Map<string, ActiveTiming>();

  constructor(
    private readonly log: (line: string) => void = (line) => console.log(line),
    private readonly now: () => number = Date.now,
  ) {}

  begin(requestId: string, threadId: string | null, watchSentAt: number | null): void {
    this.prune();
    const receivedAt = this.now();
    this.active.set(requestId, { requestId, threadId, watchSentAt, receivedAt, stages: { bridgeReceived: receivedAt } });
    this.emit(this.active.get(requestId)!, "bridgeReceived", receivedAt);
  }

  bindThread(requestId: string, threadId: string): void {
    const entry = this.active.get(requestId);
    if (entry) entry.threadId = threadId;
  }

  markRequest(requestId: string, stage: TurnStage): void {
    const entry = this.active.get(requestId);
    if (entry) this.record(entry, stage);
  }

  /** Marks the newest open request on this thread; later repeats of a stage are ignored. */
  markThread(threadId: string, stage: TurnStage): void {
    const entry = this.forThread(threadId);
    if (entry) this.record(entry, stage);
  }

  finishThread(threadId: string): void {
    const entry = this.forThread(threadId);
    if (!entry || entry.stages.turnCompleted === undefined) return;
    this.active.delete(entry.requestId);
    const s = entry.stages;
    const span = (a?: number, b?: number) => (a !== undefined && b !== undefined ? b - a : null);
    this.log(JSON.stringify({
      level: "info",
      message: "watch.turn.timing.summary",
      requestId: entry.requestId,
      threadId: entry.threadId,
      watchSentAt: entry.watchSentAt,
      watchToBridgeMs: entry.watchSentAt === null ? null : entry.receivedAt - entry.watchSentAt,
      bridgeToAppServerAcceptMs: span(s.bridgeReceived, s.appServerAccepted),
      bridgeToWatchAckMs: span(s.bridgeReceived, s.watchAckSent),
      bridgeToTurnStartMs: span(s.bridgeReceived, s.turnStarted),
      bridgeToFirstDeltaMs: span(s.bridgeReceived, s.firstDelta),
      bridgeToFirstStreamSnapshotMs: span(s.bridgeReceived, s.firstStreamSnapshotSent),
      bridgeToTurnCompletedMs: span(s.bridgeReceived, s.turnCompleted),
      turnCompletedToFinalSnapshotMs: span(s.turnCompleted, s.finalSnapshotSent),
      bridgeToFinalSnapshotMs: span(s.bridgeReceived, s.finalSnapshotSent),
      watchSendToFinalSnapshotMs: entry.watchSentAt === null || s.finalSnapshotSent === undefined
        ? null : s.finalSnapshotSent - entry.watchSentAt,
    }));
  }

  private forThread(threadId: string): ActiveTiming | undefined {
    let newest: ActiveTiming | undefined;
    for (const entry of this.active.values()) {
      if (entry.threadId === threadId && (!newest || entry.receivedAt > newest.receivedAt)) newest = entry;
    }
    return newest;
  }

  private record(entry: ActiveTiming, stage: TurnStage): void {
    if (entry.stages[stage] !== undefined) return;
    // A snapshot before the first reply token is the echo of the prompt, not a reply.
    if (stage === "firstStreamSnapshotSent" && entry.stages.firstDelta === undefined) return;
    const at = this.now();
    entry.stages[stage] = at;
    this.emit(entry, stage, at);
  }

  private emit(entry: ActiveTiming, stage: TurnStage, at: number): void {
    this.log(JSON.stringify({
      level: "info", message: "watch.turn.timing", requestId: entry.requestId, threadId: entry.threadId,
      stage, at, sinceBridgeReceivedMs: at - entry.receivedAt,
    }));
  }

  private prune(): void {
    const cutoff = this.now() - STALE_MS;
    for (const [id, entry] of this.active) if (entry.receivedAt < cutoff) this.active.delete(id);
    while (this.active.size >= MAX_ACTIVE) this.active.delete(this.active.keys().next().value!);
  }
}
