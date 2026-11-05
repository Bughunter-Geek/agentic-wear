// Asks Codex's app server for the realtime voice list and prints the real error.
// Usage: node ~/Downloads/codex-voice-probe.mjs
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const codex = process.env.CODEX ||
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
const child = spawn(codex, ["app-server"], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
let nextId = 1;
const send = (method, params) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
createInterface({ input: child.stdout }).on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const timeout = setTimeout(() => { console.log("TIMEOUT"); child.kill(); process.exit(1); }, 30000);

const init = await send("initialize", {
  clientInfo: { name: "agentic_wear_probe", title: "probe", version: "0.0.1" },
  capabilities: { experimentalApi: true, requestAttestation: false },
});
console.log("server:", init.result?.userAgent ?? JSON.stringify(init.error));
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");

const voices = await send("thread/realtime/listVoices", {});
console.log("listVoices:", JSON.stringify(voices.error ?? voices.result, null, 2).slice(0, 2000));

const account = await send("account/read", {});
console.log("account:", JSON.stringify(account.error ?? account.result).replace(/"(email|token|accessToken|idToken)":"[^"]*"/g, '"$1":"***"').slice(0, 600));

clearTimeout(timeout);
child.kill();
process.exit(0);
