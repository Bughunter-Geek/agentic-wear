import { describe, expect, it } from "vitest";
import {
  isTerminalNewerThan,
  isTopLevelUserThread,
  parseTerminalNotification,
} from "../src/app-server-client.js";
import type { CodexThread } from "../src/schemas.js";

const completed = {
  threadId: "0198-agent-thread",
  turn: {
    id: "0198-agent-turn",
    status: "completed",
    completedAt: 1_787_876_400,
    error: null,
    items: [],
  },
};

describe("terminal event classification", () => {
  it("accepts only the official full-turn terminal notification", () => {
    expect(parseTerminalNotification("turn/completed", completed)).toMatchObject({
      threadId: completed.threadId,
      turn: { id: completed.turn.id, status: "completed" },
    });
  });

  it.each([
    "item/completed",
    "rawResponseItem/completed",
    "rawResponse/completed",
    "item/reasoning/summaryPartAdded",
    "item/reasoning/summaryTextDelta",
    "item/agentMessage/delta",
    "error",
  ])("does not treat %s as a finished response", (method) => {
    expect(parseTerminalNotification(method, completed)).toBeNull();
  });

  it("accepts only top-level user threads as notification sources", () => {
    const root: CodexThread = {
      id: "root-thread",
      preview: "Root",
      updatedAt: 1,
      status: { type: "active" },
      parentThreadId: null,
      agentRole: null,
    };
    expect(isTopLevelUserThread(root)).toBe(true);
    expect(isTopLevelUserThread({ ...root, id: "nested-thread", parentThreadId: root.id })).toBe(false);
    expect(isTopLevelUserThread({ ...root, id: "agent-thread", agentRole: "worker" })).toBe(false);
  });

  it("does not replay an old interrupted turn after an unrelated idle-thread update", () => {
    const observedAtMs = 1_787_876_500_000;
    expect(isTerminalNewerThan(1_787_876_400, observedAtMs)).toBe(false);
    expect(isTerminalNewerThan(null, observedAtMs)).toBe(false);
    expect(isTerminalNewerThan(1_787_876_600, observedAtMs)).toBe(true);
  });
});
