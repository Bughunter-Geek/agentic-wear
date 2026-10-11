#!/usr/bin/env node
// Run only when activating the prepared receiver for the user's selected chat.
// This creates a local IPC capability, never copies an account credential.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { readConfig } from "../dist/config.js";
import { desktopCloudConfigPath, desktopCloudConfigSchema, desktopCloudPairBinding } from "../dist/desktop-cloud-protocol.js";
const [threadId, title] = process.argv.slice(2);
if (!threadId || !title) throw new Error("Usage: configure-desktop-cloud.mjs THREAD_ID TITLE");
const pairing = await readConfig();
if (!pairing.watchPublicKey) throw new Error("Complete authenticated Watch pairing first");
const path = desktopCloudConfigPath();
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
const parent = await lstat(dirname(path));
if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o077) !== 0) throw new Error("Receiver directory must be private and owned by this user");
const config = desktopCloudConfigSchema.parse({ version: 1, enabled: true, capability: randomBytes(32).toString("hex"),
  pairBinding: desktopCloudPairBinding(pairing), targets: [{ hostId: "durable", threadId, title }], reconcileMs: 2_000 });
// Refuse to overwrite an existing allowlist or capability. Rotation is an
// explicit deployment operation with the old configuration backed up first.
await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ configured: true, targets: config.targets.length, receiveOnly: true }));
