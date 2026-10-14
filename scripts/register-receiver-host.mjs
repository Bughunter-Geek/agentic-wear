#!/usr/bin/env node
// Explicit user-run setup only. Without --apply this is a read-only preview.
import { readFile, writeFile, mkdir, lstat, copyFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
if (args.length > 1 || args.length === 1 && args[0] !== "--apply") throw new Error("Usage: register-receiver-host.mjs [--apply]");
if (process.platform !== "darwin") throw new Error("This receiver helper package supports macOS Chrome.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const receiver = resolve(root, "browser-receiver");
const manifest = JSON.parse(await readFile(resolve(receiver, "extension/manifest.json"), "utf8"));
const id = [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join("");
const name = "io.github.sirbughunter.agenticwear.cloud";
const registration = resolve(homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts", `${name}.json`);
const origin = `chrome-extension://${id}/`;
let exists = false;
try {
  const st = await lstat(registration);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error("Unsafe existing native host registration");
  const old = JSON.parse(await readFile(registration, "utf8"));
  if (old.name !== name || !Array.isArray(old.allowed_origins) || old.allowed_origins.length !== 1 || old.allowed_origins[0] !== origin) throw new Error("Existing native host identity differs; no registration changed");
  exists = true;
} catch (e) { if (e.code !== "ENOENT") throw e; }
const host = resolve(receiver, "host");
const body = { name, description: "Agentic Wear Cloud Receiver", path: host, type: "stdio", allowed_origins: [origin] };
if (!args.length) {
  console.log(JSON.stringify({ preview: true, version: manifest.version, existingRegistration: exists, nativeHostName: name, action: "Run with --apply only after all calls end; keep this package at its permanent path." }));
} else {
  await mkdir(dirname(registration), { recursive: true, mode: 0o700 });
  const parent = await lstat(dirname(registration));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid()) throw new Error("Unsafe native host directory");
  const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  try { const st = await lstat(host); if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error("Unsafe helper wrapper"); } catch(e) { if(e.code !== "ENOENT") throw e; }
  const script = `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve(receiver, "native-host.bundle.mjs"))} "$@"\n`;
  await writeFile(host, script, { mode: 0o700, flag: "w" });
  if (exists) await copyFile(registration, registration + `.backup-${Date.now()}`);
  const tmp = registration + `.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(body, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(tmp, registration);
  console.log(JSON.stringify({ registered: true, version: manifest.version, pairingChanged: false, bridgeRestarted: false, browserReloaded: false }));
}
