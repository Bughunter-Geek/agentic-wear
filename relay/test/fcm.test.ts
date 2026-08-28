import { describe, expect, it } from "vitest";
import { buildWakeMessage, wakeTargetForNewEnvelope } from "../src/fcm";

describe("Firebase wake message", () => {
  it("targets the registered installation with a high-priority data-only wake", () => {
    expect(buildWakeMessage("installation-id", "pair-id")).toEqual({
      message: {
        fid: "installation-id",
        data: { kind: "inbox.ready", pairId: "pair-id" },
        android: { priority: "high", ttl: "60s" },
      },
    });
  });

  it("wakes only for a newly inserted envelope", () => {
    expect(wakeTargetForNewEnvelope("installation-id", true)).toBe("installation-id");
    expect(wakeTargetForNewEnvelope("installation-id", false)).toBeNull();
    expect(wakeTargetForNewEnvelope(null, true)).toBeNull();
  });
});
