import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { readConfig } from "./config.js";
import { bridgeCredentialAccount, readKeychainSecret } from "./keychain.js";
import { z } from "zod";
const expectedSigner = "bc70f367781d453b8dd22eb4daf5b735c291656a0d64137f974094aefdb6cda8";
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 && !(args.length === 2 && args[1] === "--dry-run")) throw new Error("Invalid arguments");
  const config = await readConfig(); const relay = new URL(config.relayUrl);
  if (relay.protocol !== "https:" || relay.username || relay.password || relay.search || relay.hash) throw new Error("HTTPS relay required");
  const endpoint = `${config.relayUrl.replace(/\/$/u, "")}/v1/pairs/${config.pairId}/private-update`;
  const headers: Record<string, string> = { "User-Agent": "OpenAI File Downloader, XaiImageApiFetch/1.0" }; let body: Buffer | undefined;
  if (args[0] !== "--revoke") {
    const path = resolve(args[0]!);
    // Keep in sync with relay MAX_PRIVATE_APK_BYTES (16 MiB).
    if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error("APK exceeds private limit");
    body = await readFile(path); const digest = createHash("sha256").update(body).digest("hex");
    const release = z.object({ versionCode: z.number().int().positive(), versionName: z.string().max(40), sha256: z.string(), apkSize: z.number().int() }).parse(JSON.parse(await readFile(join(dirname(path), "update.json"), "utf8")) as unknown);
    if (digest !== release.sha256 || body.byteLength !== release.apkSize) throw new Error("Manifest integrity mismatch");
    const tool = process.env.AGENTIC_WEAR_APKSIGNER ?? join(homedir(), "Library/Android/sdk/build-tools/37.0.0/apksigner");
    const { stdout } = await promisify(execFile)(tool, ["verify", "--print-certs", path], { maxBuffer: 16 * 1024 });
    const signers = [...stdout.matchAll(/certificate SHA-256 digest: ([a-f0-9]{64})/gu)].map(match => match[1]);
    if (signers.length !== 1 || signers[0] !== expectedSigner) throw new Error("Unexpected APK signer");
    Object.assign(headers, { "Content-Type": "application/vnd.android.package-archive", "X-Update-Version-Code": String(release.versionCode), "X-Update-Version-Name": release.versionName, "X-Update-Sha256": digest, "X-Update-Expires-At": String(Date.now() + 24 * 60 * 60 * 1000) });
    if (args[1] === "--dry-run") { console.log(JSON.stringify({ validated: true, private: true, versionCode: release.versionCode, apkBytes: body.byteLength, signerMatches: true, sha256: digest, uploaded: false })); return; }
  }
  // Existing Keychain credential stays in memory; never print it or place it in a URL.
  headers.Authorization = `Bearer ${await readKeychainSecret(bridgeCredentialAccount(config.pairId))}`;
  const response = await fetch(endpoint, { method: args[0] === "--revoke" ? "DELETE" : "PUT", headers, body: body ? new Uint8Array(body).buffer : undefined, redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  console.log(JSON.stringify({ private: true, published: args[0] !== "--revoke", revoked: args[0] === "--revoke" }));
}
void main().catch(() => { console.error("Private update failed. Usage: APK_PATH [--dry-run] or --revoke. Check APK, signer, relay deployment and authorization. No credentials were printed."); process.exitCode = 1; });
