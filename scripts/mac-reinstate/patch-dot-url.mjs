// Lets the Agentic Wear Cloud Receiver accept ChatGPT's new Dot addresses
// (https://chatgpt.com/dots/<account>~<dot>) as well as the old /dots/home.
// Usage: node ~/Downloads/patch-dot-url.mjs "$HOME/Agentic Wear Mac 0.3.17/browser-receiver/extension"
import { readFileSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir || !existsSync(join(dir, "manifest.json"))) throw new Error("Pass the extension folder");
const backup = `${dir}.backup-before-dot-patch`;
if (!existsSync(backup)) cpSync(dir, backup, { recursive: true });

const RE = "/^https:\\/\\/chatgpt\\.com\\/dots\\/./";
const OLD = "'https://chatgpt.com/dots/home'";
let total = 0;

function patch(file, fn) {
  const path = join(dir, file);
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after !== before) { writeFileSync(path, after); console.log("patched", file); total++; }
}
// x === 'https://chatgpt.com/dots/home'  /  x !== '...'  /  x === DOT / DOT_URL
const cmp = (src, rhs) => src.replace(
  new RegExp(`([A-Za-z_$][\\w$.?]*)\\s*(===|!==)\\s*${rhs}(?![\\w$])`, "g"),
  (_, lhs, op) => `${op === "!==" ? "!" : ""}${RE}.test(${lhs}||'')`);
const esc = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

patch("manifest.json", s => s.replaceAll('"https://chatgpt.com/dots/home"', '"https://chatgpt.com/dots/*"'));
for (const f of ["popup.js", "content.js", "voice-controller.js", "voice-hook.js", "worker.js"]) {
  patch(f, s => {
    s = cmp(s, esc(OLD));
    s = cmp(s, "DOT_URL");
    s = cmp(s, "DOT");
    // tabs.query match pattern
    s = s.replace("chrome.tabs.query({url:['https://chatgpt.com/local/*',DOT_URL]})",
                  "chrome.tabs.query({url:['https://chatgpt.com/local/*','https://chatgpt.com/dots/*']})");
    return s;
  });
}
console.log(total ? `Done (${total} files). Backup: ${backup}` : "Nothing to patch (already patched?)");
