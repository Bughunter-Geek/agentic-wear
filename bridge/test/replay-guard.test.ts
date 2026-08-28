import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReplayGuard } from "../src/replay-guard.js";

describe("ReplayGuard", () => {
  it("persists claims across restarts and beyond the former 512-entry limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentic-wear-replay-"));
    try {
      const now = Date.now();
      const original = "original-message";
      expect(await new ReplayGuard(root).claim(original, now, now)).toBe(true);
      const writer = new ReplayGuard(root);
      for (let index = 0; index < 600; index += 1) {
        expect(await writer.claim(`later-message-${index}`, now, now)).toBe(true);
      }
      expect(await new ReplayGuard(root).claim(original, now, now)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows only one concurrent process to claim the same envelope", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentic-wear-replay-"));
    try {
      const now = Date.now();
      const results = await Promise.all([
        new ReplayGuard(root).claim("same-message", now, now),
        new ReplayGuard(root).claim("same-message", now, now),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the bounded ledger is full without forgetting replays", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentic-wear-replay-"));
    try {
      const now = Date.now();
      const guard = new ReplayGuard(root, 2);
      expect(await guard.claim("message-1", now, now)).toBe(true);
      expect(await guard.claim("message-2", now, now)).toBe(true);
      expect(await guard.claim("message-1", now, now)).toBe(false);
      await expect(guard.claim("message-3", now, now)).rejects.toThrow("capacity reached");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retains a crash-truncated claim through the accepted future-skew window", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentic-wear-replay-"));
    try {
      const now = Date.now();
      expect(await new ReplayGuard(root).claim("future-message", now, now)).toBe(true);
      const [claimFile] = await readdir(root);
      if (!claimFile) throw new Error("Replay claim was not created");
      const claimPath = join(root, claimFile);
      await writeFile(claimPath, "");
      const fourMinutesPastNormalRetention = new Date(now - (24 * 60 + 4) * 60 * 1_000);
      await utimes(claimPath, fourMinutesPastNormalRetention, fourMinutesPastNormalRetention);

      expect(await new ReplayGuard(root).claim("future-message", now, now)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
