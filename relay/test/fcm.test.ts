import { describe, expect, it } from "vitest";
import { buildWakeMessage } from "../src/fcm";

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
});
