// Creates ~/.agentic-wear/desktop-cloud.json so the Mac companion serves your Dot.
// Usage: node ~/Downloads/setup-dot-target.mjs "<your Dot URL from Chrome>" [Dot name]
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, copyFileSync, chmodSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "";
const title = (process.argv[3] ?? "Dot").slice(0, 200);
const m = /^https:\/\/chatgpt\.com\/dots\/(?:[^~\/?#]+~)?([a-f0-9]{32})(?:[\/?#].*)?$/.exec(url);
if (!m) throw new Error("Pass your Dot address, e.g. https://chatgpt.com/dots/<account>~<32 hex characters>");
const dotNamespace = m[1];

const dir = join(homedir(), ".agentic-wear");
const pair = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
if (!pair.watchPublicKey) throw new Error("The watch is not paired yet");
const pairBinding = createHash("sha256")
  .update(JSON.stringify([pair.pairId, pair.bridgePublicKey, pair.watchPublicKey])).digest("hex");

const path = join(dir, "desktop-cloud.json");
let old = null;
if (existsSync(path)) { old = JSON.parse(readFileSync(path, "utf8")); copyFileSync(path, `${path}.bak`); }

const config = {
  version: 1,
  enabled: true,
  capability: old?.capability && /^[a-f0-9]{64}$/.test(old.capability) ? old.capability : randomBytes(32).toString("hex"),
  pairBinding,
  targets: [{ hostId: "durable", threadId: `dot-${dotNamespace.slice(0, 12)}`, title, url, dotNamespace }],
  reconcileMs: 2000,
};
const tmp = `${path}.tmp`;
writeFileSync(tmp, JSON.stringify(config) + "\n", { mode: 0o600 });
renameSync(tmp, path);
chmodSync(path, 0o600);
chmodSync(dir, 0o700);
console.log(`Wrote ${path}`);
console.log(`Dot: ${title} (namespace ${dotNamespace.slice(0, 6)}…), bound to the current watch pairing.`);
