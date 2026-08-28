import { createHash } from "node:crypto";
import { chmod, mkdir, open, readdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { replayDirectory } from "./config.js";

const RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MALFORMED_CLAIM_RETENTION_MS = RETENTION_MS + MAX_FUTURE_SKEW_MS;
const PRUNE_INTERVAL_MS = 60 * 60 * 1_000;
const DEFAULT_MAX_CLAIMS = 10_000;

export class ReplayGuard {
  private nextPruneAt = 0;
  private claimCount = 0;

  constructor(
    private readonly directory = replayDirectory(),
    private readonly maxClaims = DEFAULT_MAX_CLAIMS,
  ) {
    if (!Number.isInteger(maxClaims) || maxClaims < 1) throw new Error("Replay ledger capacity must be positive");
  }

  async claim(messageId: string, sentAt: number, now = Date.now()): Promise<boolean> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    if (now >= this.nextPruneAt) {
      this.claimCount = await this.prune(now);
      this.nextPruneAt = now + PRUNE_INTERVAL_MS;
    }

    const path = join(this.directory, claimName(messageId));
    if (this.claimCount >= this.maxClaims) {
      try {
        await stat(path);
        return false;
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
        throw new Error("Replay ledger capacity reached; refusing new watch commands");
      }
    }
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
    } catch (error) {
      if (errorCode(error) === "EEXIST") return false;
      throw error;
    }
    this.claimCount += 1;
    try {
      const expiresAt = Math.max(now, sentAt) + RETENTION_MS;
      await handle.writeFile(`${expiresAt}\n`, { encoding: "utf8" });
      await handle.sync();
      return true;
    } finally {
      await handle.close();
    }
  }

  private async prune(now: number): Promise<number> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    let retained = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(this.directory, entry.name);
      let expiresAt = Number.NaN;
      try {
        const value = await readFile(path, "utf8");
        if (/^[0-9]{13}\n$/u.test(value)) expiresAt = Number.parseInt(value, 10);
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue;
        throw error;
      }
      if (!Number.isFinite(expiresAt)) {
        try {
          // A crash can leave a claim empty after its exclusive creation. Keep
          // that fail-closed marker through the full message acceptance window,
          // including the permitted future timestamp skew.
          expiresAt = (await stat(path)).mtimeMs + MALFORMED_CLAIM_RETENTION_MS;
        } catch (error) {
          if (errorCode(error) === "ENOENT") continue;
          throw error;
        }
      }
      if (expiresAt <= now) {
        await unlink(path).catch((error: unknown) => {
          if (errorCode(error) !== "ENOENT") throw error;
        });
      } else {
        retained += 1;
      }
    }
    return retained;
  }
}

function claimName(messageId: string): string {
  return createHash("sha256").update(messageId, "utf8").digest("hex");
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}
