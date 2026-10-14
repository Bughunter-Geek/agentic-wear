import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const extensionPath = "browser-receiver/extension/";

// Reader errors and diagnostics never include file contents or discovered IDs.
export function validateReceiverPackage(read) {
  function required(path) {
    let value;
    try { value = read(path); } catch { throw new Error(`Missing receiver file: ${path}`); }
    if (!value.trim()) throw new Error(`Empty receiver file: ${path}`);
    return value;
  }
  const manifest = JSON.parse(required("manifest.json"));
  if (!manifest.permissions?.includes("storage")) throw new Error("Receiver requires storage permission for explicit Dot selection");
  if (manifest.action?.default_popup !== "popup.html") throw new Error("Receiver must declare popup.html for explicit Dot selection");
  const popup = required("popup.html");
  if (!/<script\b[^>]*\bsrc=["']popup\.js["']/i.test(popup)) throw new Error("Receiver popup must load popup.js");
  const scripts = new Set(["popup.js", "content.js", "voice-controller.js", manifest.background?.service_worker]);
  for (const entry of manifest.content_scripts ?? []) for (const script of entry.js ?? []) scripts.add(script);
  for (const script of scripts) {
    if (typeof script !== "string" || !/^[\w./-]+\.js$/.test(script) || script.split("/").includes("..")) throw new Error("Invalid receiver script path");
    const source = required(script);
    // Dot namespaces are 32 hex characters. Receiver code must obtain them from
    // explicit per-user selection, never carry a literal default in a package.
    if (/(?<![a-f0-9])[a-f0-9]{32}(?![a-f0-9])/i.test(source)) throw new Error(`Hardcoded identifier in receiver script: ${script}`);
  }
}

export function checkReceiverPackage({ extensionDir = resolve(root, extensionPath), checkHead = true } = {}) {
  if (checkHead) {
    validateReceiverPackage(path => execFileSync("git", ["show", `HEAD:${extensionPath}${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  }
  validateReceiverPackage(path => readFileSync(resolve(extensionDir, path), "utf8"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--extension-dir")) throw new Error("Usage: check-receiver-package.mjs [--extension-dir path]");
    checkReceiverPackage(args.length ? { extensionDir: resolve(args[1]) } : {});
    console.log("Receiver packaging guard passed for committed HEAD and candidate extension.");
  } catch (error) {
    // JSON parse errors may echo input; only emit our own predictable diagnostics.
    console.error(error instanceof SyntaxError ? "Invalid receiver manifest JSON" : error.message);
    process.exitCode = 1;
  }
}
