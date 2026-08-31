import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { relaySocketPath } from "./codex-app-tools-client.js";

const START_MARKER = "# BEGIN AGENTIC WEAR CODEX APP RELAY";
const END_MARKER = "# END AGENTIC WEAR CODEX APP RELAY";
const SERVER_HEADER = "[mcp_servers.agentic_wear_relay]";

export async function installCodexRelayConfig(repoRoot: string, codexPath: string): Promise<string> {
  const configFile = codexConfigPath();
  const nodePath = join(dirname(codexPath), "cua_node", "bin", "node");
  const scriptPath = resolve(repoRoot, "bridge", "dist", "codex-app-tools-relay.js");
  await Promise.all([
    access(nodePath, constants.X_OK),
    access(scriptPath, constants.R_OK),
  ]);
  const current = await readFile(configFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const next = upsertCodexRelayConfig(current, {
    nodePath,
    scriptPath,
    socketPath: relaySocketPath(),
  });
  if (next !== current) await writeConfigAtomically(configFile, next);
  return configFile;
}

export async function uninstallCodexRelayConfig(): Promise<void> {
  const configFile = codexConfigPath();
  const current = await readFile(configFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (current === null) return;
  const next = removeCodexRelayConfig(current);
  if (next !== current) await writeConfigAtomically(configFile, next);
}

export function upsertCodexRelayConfig(
  current: string,
  values: { nodePath: string; scriptPath: string; socketPath: string },
): string {
  const block = relayConfigBlock(values);
  const start = current.indexOf(START_MARKER);
  const end = current.indexOf(END_MARKER);
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) {
    throw new Error("Codex config contains an incomplete Agentic Wear relay block");
  }
  if (start >= 0) {
    const after = end + END_MARKER.length;
    return `${current.slice(0, start)}${block}${current.slice(after)}`;
  }
  if (current.split(/\r?\n/u).some((line) => line.trim() === SERVER_HEADER)) {
    throw new Error("Codex config already defines mcp_servers.agentic_wear_relay outside the managed block");
  }
  const prefix = current.length === 0 ? "" : `${current.trimEnd()}\n\n`;
  return `${prefix}${block}\n`;
}

export function removeCodexRelayConfig(current: string): string {
  const start = current.indexOf(START_MARKER);
  if (start < 0) return current;
  const end = current.indexOf(END_MARKER, start);
  if (end < 0) throw new Error("Codex config contains an incomplete Agentic Wear relay block");
  const after = end + END_MARKER.length;
  const beforeText = current.slice(0, start).trimEnd();
  const afterText = current.slice(after).trimStart();
  return [beforeText, afterText].filter(Boolean).join("\n\n") + (beforeText || afterText ? "\n" : "");
}

export function relayConfigBlock(
  values: { nodePath: string; scriptPath: string; socketPath: string },
): string {
  return [
    START_MARKER,
    SERVER_HEADER,
    `command = ${tomlString(values.nodePath)}`,
    `args = [${tomlString(values.scriptPath)}]`,
    "enabled = true",
    "startup_timeout_sec = 10",
    "tool_timeout_sec = 60",
    "env_vars = [\"CODEX_APP_TOOLS_PIPE_PATH\"]",
    "omit_tools_from = [\"deferred\"]",
    "",
    "[mcp_servers.agentic_wear_relay.env]",
    `AGENTIC_WEAR_CODEX_RELAY_SOCKET = ${tomlString(values.socketPath)}`,
    END_MARKER,
  ].join("\n");
}

function codexConfigPath(): string {
  return join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "config.toml");
}

async function writeConfigAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const currentMode = await stat(path).then(({ mode }) => mode & 0o777).catch(() => 0o600);
  const temporary = `${path}.${process.pid}.agentic-wear.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: currentMode });
    await chmod(temporary, currentMode);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
