import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CryptoBox } from "./crypto-box.js";

const recordSchema = z.object({
  fingerprint: z.string(),
  response: z.record(z.string(), z.unknown()).nullable(),
}).strict();
type Receipt = z.infer<typeof recordSchema>;

/** Durable at-most-once dispatch with encrypted, replayable acknowledgments. */
export class TurnReceipts {
  constructor(private readonly directory: string, private readonly crypto: Pick<CryptoBox, "sealLocal" | "openLocal">) {}

  private path(id: string): string {
    return join(this.directory, createHash("sha256").update(id).digest("hex"));
  }

  async get(id: string, request: unknown): Promise<Receipt | null> {
    const fingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    let bytes: string;
    try { bytes = await readFile(this.path(id), "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!bytes) return { fingerprint, response: null };
    const record = recordSchema.parse(await this.crypto.openLocal(id, JSON.parse(bytes)));
    if (record.fingerprint !== fingerprint) throw new Error("Watch request identity was reused with different content");
    return record;
  }

  async begin(id: string, request: unknown): Promise<Receipt | null> {
    const fingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let file;
    try {
      file = await open(this.path(id), "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return await this.get(id, request) ?? { fingerprint, response: null };
    }
    try {
      const record: Receipt = { fingerprint, response: null };
      await file.writeFile(JSON.stringify(await this.crypto.sealLocal(id, record)), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await this.syncDirectory();
    return null;
  }

  private async syncDirectory(): Promise<void> {
    const directory = await open(this.directory, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }

  async finish(id: string, response: Record<string, unknown>, recordResponse = true, replaceWaiting = false): Promise<Record<string, unknown>> {
    const path = this.path(id);
    let bytes: string;
    try { bytes = await readFile(path, "utf8"); } catch (error) {
      // Legacy non-turn request errors use the same wire kind.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return response;
      throw error;
    }
    // A crash can leave only the exclusive claim. Preserve uncertainty rather
    // than trying to parse that unfinished record as an acknowledgment.
    if (!bytes && !recordResponse) return response;
    const record = recordSchema.parse(await this.crypto.openLocal(id, JSON.parse(bytes)));
    if (record.response && !(replaceWaiting && record.response.kind === "turn.accepted" && record.response.state === "waiting")) {
      return record.response;
    }
    if (!recordResponse) return response;
    const temporary = `${path}.tmp`;
    const file = await open(temporary, "w", 0o600);
    try {
      await file.writeFile(JSON.stringify(await this.crypto.sealLocal(id, { ...record, response })), "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    await this.syncDirectory();
    return response;
  }
}
