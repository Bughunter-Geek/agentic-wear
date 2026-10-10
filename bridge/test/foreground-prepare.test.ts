import { describe, expect, it, vi } from "vitest";
import { BridgeService } from "../src/bridge-service.js";

function fixture(defaultBackend: "phonon" | "whisper", prepare: () => Promise<void>) {
  const service = Object.create(BridgeService.prototype) as { handleWatchPayload: (payload: unknown) => Promise<void> };
  const sendSessions = vi.fn().mockResolvedValue(undefined);
  Object.assign(service, { transcriber: { defaultBackend }, draftEditor: { prepare }, sendSessions });
  return { service, sendSessions };
}

describe("foreground Phonon preparation", () => {
  it("starts warm-up before the session reply and returns without waiting for a cold load", async () => {
    let finish!: () => void;
    const calls: string[] = [];
    const prepare = vi.fn(() => { calls.push("prepare"); return new Promise<void>(resolve => { finish = resolve; }); });
    const { service, sendSessions } = fixture("phonon", prepare);
    sendSessions.mockImplementation(async () => { calls.push("sessions"); });
    await service.handleWatchPayload({ version: 1, kind: "session.sync", requestId: "synthetic-foreground" });
    expect(calls).toEqual(["prepare", "sessions"]);
    expect(prepare).toHaveBeenCalledTimes(1);
    finish();
  });
  it("does not load the editor for the configured Whisper route", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const { service, sendSessions } = fixture("whisper", prepare);
    await service.handleWatchPayload({ version: 1, kind: "session.sync", requestId: "synthetic-whisper" });
    expect(prepare).not.toHaveBeenCalled();
    expect(sendSessions).toHaveBeenCalledTimes(1);
  });
  it("preserves session refresh when optional preparation fails", async () => {
    const prepare = vi.fn().mockRejectedValue(new Error("synthetic warm-up unavailable"));
    const { service, sendSessions } = fixture("phonon", prepare);
    await service.handleWatchPayload({ version: 1, kind: "session.sync", requestId: "synthetic-failure" });
    expect(sendSessions).toHaveBeenCalledTimes(1);
  });
});
