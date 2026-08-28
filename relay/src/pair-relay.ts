import { DurableObject } from "cloudflare:workers";
import { bridgeControlSchema, wireEnvelopeSchema, type WireEnvelope } from "./schemas";
import { secureEqual, sha256Hex } from "./crypto";

type MetaRow = {
  pair_id: string;
  code_proof_hash: string;
  protocol_version: number;
  bridge_public_key: string;
  watch_public_key: string | null;
  watch_proof: string | null;
  bridge_proof: string | null;
  bridge_auth_hash: string;
  watch_auth_hash: string;
  fcm_installation_id: string | null;
  expires_at: number;
  paired_at: number | null;
};

type InboxRow = {
  message_id: string;
  envelope: string;
};

export type InitializePairInput = {
  pairId: string;
  bridgePublicKey: string;
  bridgeAuthHash: string;
  watchAuthHash: string;
  expiresAt: number;
};

export type BeginPairInput = {
  pairId: string;
  watchPublicKey: string;
  fcmInstallationId: string | null;
  now: number;
};

export type ConfirmBridgeInput = {
  watchPublicKey: string;
  watchProof: string;
  bridgeProof: string;
  now: number;
};

export type EnqueueResult = { fcmInstallationId: string | null; inserted: boolean };

export class PairRelay extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  async initializePair(input: InitializePairInput): Promise<boolean> {
    const existing = this.meta();
    if (existing && (existing.paired_at !== null || existing.expires_at > Date.now())) return false;
    this.ctx.storage.sql.exec("DELETE FROM inbox");
    this.ctx.storage.sql.exec("DELETE FROM pair_meta");
    this.ctx.storage.sql.exec(
      `INSERT INTO pair_meta (
        pair_id, code_proof_hash, protocol_version, bridge_public_key,
        bridge_auth_hash, watch_auth_hash, expires_at
      ) VALUES (?, ?, 2, ?, ?, ?, ?)`,
      input.pairId,
      "retired-v2",
      input.bridgePublicKey,
      input.bridgeAuthHash,
      input.watchAuthHash,
      input.expiresAt,
    );
    await this.ctx.storage.setAlarm(input.expiresAt);
    return true;
  }

  async beginPairing(input: BeginPairInput): Promise<{ bridgePublicKey: string }> {
    const meta = this.requireV2Meta();
    this.requirePending(meta, input.now);
    if (meta.pair_id !== input.pairId) throw new PairRelayError("Pairing is invalid", 401);
    if (meta.watch_public_key !== null && !(await secureEqual(meta.watch_public_key, input.watchPublicKey))) {
      throw new PairRelayError("Pairing is already claimed", 409);
    }
    this.ctx.storage.sql.exec(
      "UPDATE pair_meta SET watch_public_key = ?, fcm_installation_id = ? WHERE pair_id = ?",
      input.watchPublicKey,
      input.fcmInstallationId,
      input.pairId,
    );
    return { bridgePublicKey: meta.bridge_public_key };
  }

  async confirmWatch(watchCredential: string, watchProof: string, now: number): Promise<void> {
    const meta = await this.authorize("watch", watchCredential, false);
    if (meta.expires_at < now) throw new PairRelayError("Pairing code expired", 410);
    if (!meta.watch_public_key) throw new PairRelayError("Pairing has not started", 409);
    if (meta.watch_proof !== null && !(await secureEqual(meta.watch_proof, watchProof))) {
      throw new PairRelayError("Pairing proof changed", 409);
    }
    if (meta.paired_at !== null) return;
    this.ctx.storage.sql.exec("UPDATE pair_meta SET watch_proof = ? WHERE pair_id = ?", watchProof, meta.pair_id);
    this.notifyBridgePairChallenge(meta.watch_public_key, watchProof);
  }

  async confirmBridge(bridgeCredential: string, input: ConfirmBridgeInput): Promise<void> {
    const meta = await this.authorize("bridge", bridgeCredential, false);
    if (meta.expires_at < input.now) throw new PairRelayError("Pairing code expired", 410);
    if (!meta.watch_public_key || !meta.watch_proof) throw new PairRelayError("Watch proof is missing", 409);
    const sameTranscript = await Promise.all([
      secureEqual(meta.watch_public_key, input.watchPublicKey),
      secureEqual(meta.watch_proof, input.watchProof),
    ]);
    if (sameTranscript.some((matches) => !matches)) throw new PairRelayError("Pairing transcript changed", 409);
    if (meta.paired_at !== null) {
      if (meta.bridge_proof && await secureEqual(meta.bridge_proof, input.bridgeProof)) return;
      throw new PairRelayError("Pairing code already used", 409);
    }
    this.ctx.storage.sql.exec(
      "UPDATE pair_meta SET bridge_proof = ?, paired_at = ? WHERE pair_id = ?",
      input.bridgeProof,
      input.now,
      meta.pair_id,
    );
    await this.ctx.storage.deleteAlarm();
  }

  async pairingStatus(bridgeCredential: string): Promise<{
    paired: boolean;
    watchPublicKey: string | null;
    watchProof: string | null;
  }> {
    const meta = await this.authorize("bridge", bridgeCredential, false);
    return { paired: meta.paired_at !== null, watchPublicKey: meta.watch_public_key, watchProof: meta.watch_proof };
  }

  async watchPairingStatus(watchCredential: string): Promise<{ paired: boolean; bridgeProof: string | null }> {
    const meta = await this.authorize("watch", watchCredential, false);
    return { paired: meta.paired_at !== null, bridgeProof: meta.bridge_proof };
  }

  async enqueueToWatch(bridgeCredential: string, envelope: WireEnvelope): Promise<EnqueueResult> {
    const meta = await this.authorize("bridge", bridgeCredential, true);
    const expiresAt = Date.now() + this.inboxTtlMs();
    this.deleteExpiredMessages();
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO inbox (message_id, sent_at, expires_at, envelope) VALUES (?, ?, ?, ?)",
      envelope.messageId,
      envelope.sentAt,
      expiresAt,
      JSON.stringify(envelope),
    );
    const inserted = this.ctx.storage.sql.exec<{ changed: number }>("SELECT changes() AS changed").one().changed > 0;
    this.ctx.storage.sql.exec(
      "DELETE FROM inbox WHERE message_id IN (SELECT message_id FROM inbox ORDER BY sent_at DESC LIMIT -1 OFFSET 100)",
    );
    await this.scheduleNextCleanup();
    return { fcmInstallationId: meta.fcm_installation_id, inserted };
  }

  async fetchInbox(watchCredential: string): Promise<WireEnvelope[]> {
    await this.authorize("watch", watchCredential, true);
    this.deleteExpiredMessages();
    return this.ctx.storage.sql.exec<InboxRow>(
      "SELECT message_id, envelope FROM inbox ORDER BY sent_at ASC LIMIT 50",
    ).toArray().map((row) => wireEnvelopeSchema.parse(JSON.parse(row.envelope)));
  }

  async acknowledge(watchCredential: string, messageIds: string[]): Promise<number> {
    await this.authorize("watch", watchCredential, true);
    const placeholders = messageIds.map(() => "?").join(",");
    this.ctx.storage.sql.exec(`DELETE FROM inbox WHERE message_id IN (${placeholders})`, ...messageIds);
    const changed = this.ctx.storage.sql.exec<{ changed: number }>("SELECT changes() AS changed").one().changed;
    await this.scheduleNextCleanup();
    return changed;
  }

  async updateFcmRegistration(watchCredential: string, fcmInstallationId: string): Promise<void> {
    const meta = await this.authorize("watch", watchCredential, true);
    this.ctx.storage.sql.exec(
      "UPDATE pair_meta SET fcm_installation_id = ? WHERE pair_id = ?",
      fcmInstallationId,
      meta.pair_id,
    );
  }

  async sendToBridge(watchCredential: string, envelope: WireEnvelope): Promise<boolean> {
    await this.authorize("watch", watchCredential, true);
    const message = JSON.stringify({ type: "envelope", envelope });
    let delivered = false;
    for (const socket of this.ctx.getWebSockets("bridge")) {
      try {
        socket.send(message);
        delivered = true;
      } catch {
        socket.close(1011, "Delivery failed");
      }
    }
    return delivered;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: "WebSocket upgrade required" }, { status: 426 });
    }
    const credential = bearer(request);
    const meta = await this.authorize("bridge", credential, false);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, ["bridge"]);
    server.send(JSON.stringify({
      type: "pair.status",
      paired: meta.paired_at !== null,
      watchPublicKey: meta.watch_public_key,
      watchProof: meta.watch_proof,
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string" || message.length > 512) {
      socket.close(1009, "Invalid control message");
      return;
    }
    const parsed: unknown = (() => {
      try {
        return JSON.parse(message);
      } catch {
        return null;
      }
    })();
    const control = bridgeControlSchema.safeParse(parsed);
    if (!control.success) {
      socket.close(1008, "Invalid control message");
      return;
    }
    socket.send(JSON.stringify({ type: "pong", at: control.data.at }));
  }

  override webSocketClose(): void {}

  override async alarm(): Promise<void> {
    const meta = this.meta();
    if (meta && meta.paired_at === null && meta.expires_at <= Date.now()) {
      this.ctx.storage.sql.exec("DELETE FROM pair_meta");
    }
    this.deleteExpiredMessages();
    await this.scheduleNextCleanup();
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS pair_meta (
        pair_id TEXT PRIMARY KEY,
        code_proof_hash TEXT NOT NULL,
        protocol_version INTEGER NOT NULL DEFAULT 2,
        bridge_public_key TEXT NOT NULL,
        watch_public_key TEXT,
        watch_proof TEXT,
        bridge_proof TEXT,
        bridge_auth_hash TEXT NOT NULL,
        watch_auth_hash TEXT NOT NULL,
        fcm_installation_id TEXT,
        expires_at INTEGER NOT NULL,
        paired_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS inbox (
        message_id TEXT PRIMARY KEY,
        sent_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        envelope TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS inbox_expiry_idx ON inbox(expires_at);
      INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (1);
    `);
    const columns = new Set(
      this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(pair_meta)").toArray().map((column) => column.name),
    );
    if (!columns.has("protocol_version")) {
      this.ctx.storage.sql.exec("ALTER TABLE pair_meta ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1");
    }
    if (!columns.has("watch_proof")) this.ctx.storage.sql.exec("ALTER TABLE pair_meta ADD COLUMN watch_proof TEXT");
    if (!columns.has("bridge_proof")) this.ctx.storage.sql.exec("ALTER TABLE pair_meta ADD COLUMN bridge_proof TEXT");
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (2)");
  }

  private meta(): MetaRow | null {
    return this.ctx.storage.sql.exec<MetaRow>("SELECT * FROM pair_meta LIMIT 1").toArray()[0] ?? null;
  }

  private requireMeta(): MetaRow {
    const meta = this.meta();
    if (!meta) throw new PairRelayError("Pairing was not found", 404);
    return meta;
  }

  private requireV2Meta(): MetaRow {
    const meta = this.requireMeta();
    if (meta.protocol_version !== 2) throw new PairRelayError("Pairing must be replaced with protocol v2", 409);
    return meta;
  }

  private requirePending(meta: MetaRow, now: number): void {
    if (meta.expires_at < now) throw new PairRelayError("Pairing code expired", 410);
    if (meta.paired_at !== null) throw new PairRelayError("Pairing code already used", 409);
  }

  private async authorize(role: "bridge" | "watch", credential: string, requirePaired: boolean): Promise<MetaRow> {
    const meta = this.requireV2Meta();
    const expected = role === "bridge" ? meta.bridge_auth_hash : meta.watch_auth_hash;
    if (!(await secureEqual(await sha256Hex(credential), expected))) {
      throw new PairRelayError("Not authorized", 401);
    }
    if (requirePaired && meta.paired_at === null) throw new PairRelayError("Watch is not paired", 409);
    return meta;
  }

  private notifyBridgePairChallenge(watchPublicKey: string, watchProof: string): void {
    const message = JSON.stringify({ type: "pair.challenge", watchPublicKey, watchProof });
    for (const socket of this.ctx.getWebSockets("bridge")) {
      try {
        socket.send(message);
      } catch {
        socket.close(1011, "Delivery failed");
      }
    }
  }

  private deleteExpiredMessages(): void {
    this.ctx.storage.sql.exec("DELETE FROM inbox WHERE expires_at <= ?", Date.now());
  }

  private async scheduleNextCleanup(): Promise<void> {
    const meta = this.meta();
    const inboxExpiry = this.ctx.storage.sql.exec<{ expires_at: number | null }>(
      "SELECT MIN(expires_at) AS expires_at FROM inbox",
    ).one().expires_at;
    const pairingExpiry = meta?.paired_at === null ? meta.expires_at : null;
    const next = [inboxExpiry, pairingExpiry].filter((value): value is number => value !== null && value !== undefined)
      .sort((left, right) => left - right)[0];
    if (next === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  private inboxTtlMs(): number {
    return Number.parseInt(this.env.INBOX_TTL_SECONDS, 10) * 1_000;
  }
}

export class PairRelayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function bearer(request: Request): string {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) throw new PairRelayError("Not authorized", 401);
  const credential = header.slice(7);
  if (credential.length < 32 || credential.length > 256) throw new PairRelayError("Not authorized", 401);
  return credential;
}
