import { describe, expect, it, vi } from "vitest";
import { BridgeService, publicError, publicRequestError } from "../src/bridge-service.js";

describe("BridgeService App Server transport", () => {
  it("connects to the shared Desktop daemon rather than a private stdio server", async () => {
    const stopAfterConnect = new Error("stop after transport assertion");
    const connect = vi.fn(async () => { throw stopAfterConnect; });
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    Object.assign(service, {
      relay: {
        status: vi.fn().mockResolvedValue({ paired: true, watchPublicKey: "watch-public-key" }),
        runSocket: vi.fn().mockResolvedValue(undefined),
      },
      appServer: { connect, close: vi.fn() },
      controller: new AbortController(),
      transcriber: {},
      assertWatchPublicKey: vi.fn(),
    });

    await expect((service as unknown as BridgeService).run()).rejects.toBe(stopAfterConnect);
    expect(connect).toHaveBeenCalledWith("daemon");
  });
});

describe("publicRequestError", () => {
  it("preserves a long safe error while redacting credential-shaped values", () => {
    const safeDetail = `The full diagnostic remains available. ${"detail ".repeat(120)}`;

    expect(publicError(new Error(`${safeDetail} authorization: Bearer top-secret-token`)))
      .toBe(`${safeDetail.trim()} authorization: [redacted]`);
  });

  it("states that a foreign active writer leaves the watch draft unsent", () => {
    expect(publicRequestError(new Error("active writer already attached"), "turn.submit"))
      .toBe("Another Codex client owns this active session. Agentic Wear did not queue or send your prompt. Keep the draft, refresh sessions, then retry after its turn finishes. If it stays busy, start a new session; Send remains explicit.");
  });

  it("maps foreign-session wording variants to the same safe recovery", () => {
    const expected = "Another Codex client owns this active session. Agentic Wear did not queue or send your prompt. Keep the draft, refresh sessions, then retry after its turn finishes. If it stays busy, start a new session; Send remains explicit.";

    expect(publicRequestError(new Error("Codex still owns this session in another client"), "turn.submit"))
      .toBe(expected);
    expect(publicRequestError(new Error("Desktop is actively writing this session"), "turn.submit"))
      .toBe(expected);
    expect(publicRequestError(new Error("Session is currently active in another client"), "turn.submit"))
      .toBe(expected);
  });

  it("does not suggest that restarting Codex will create queue support", () => {
    expect(publicRequestError(new Error("Invalid request: unknown variant `thread/queue/add`"), "turn.submit"))
      .toBe("This Codex App Server does not support queued watch prompts. Agentic Wear did not queue or send your prompt; keep the draft and retry after the current turn finishes.");
  });

  it("does not mislabel a delayed rollout as a permanently removed chat", () => {
    expect(publicRequestError(new Error("No rollout found for thread"), "chat.watch"))
      .toBe("The bridge could not load this session after resyncing. Agentic Wear kept your selection. Refresh sessions and retry; choose another chat only if this one no longer appears.");
  });
});
