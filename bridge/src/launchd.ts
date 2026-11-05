import { execFile } from "node:child_process";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const label = "io.github.sirbughunter.agenticwear.bridge";

export async function installLaunchAgent(
  repoRoot: string,
  nodePath: string,
  codexPath: string,
): Promise<string> {
  requireMac();
  const plistPath = launchAgentPath();
  const directory = dirname(plistPath);
  const cliPath = resolve(repoRoot, "bridge", "dist", "cli.js");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(logDirectory(), { recursive: true, mode: 0o700 });
  const temporary = `${plistPath}.${process.pid}.tmp`;
  await writeFile(temporary, plist(nodePath, cliPath, repoRoot, codexPath, logDirectory()), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, plistPath);
  await chmod(plistPath, 0o600);
  await bootout().catch(() => undefined);
  await bootstrapWithRetry(plistPath);
  await execFileAsync("launchctl", ["kickstart", "-k", `${domain()}/${label}`], {
    timeout: 15_000,
    maxBuffer: 64 * 1_024,
  });
  return plistPath;
}

export async function uninstallLaunchAgent(): Promise<void> {
  requireMac();
  await bootout().catch(() => undefined);
  await unlink(launchAgentPath()).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function launchAgentStatus(): Promise<boolean> {
  requireMac();
  try {
    await execFileAsync("launchctl", ["print", `${domain()}/${label}`], { timeout: 10_000, maxBuffer: 64 * 1_024 });
    return true;
  } catch {
    return false;
  }
}

/**
 * launchd starts agents with PATH=/usr/bin:/bin:/usr/sbin:/sbin. An npm- or
 * Homebrew-installed `codex` is a `#!/usr/bin/env node` script, so without the
 * Node and Codex directories on PATH the managed App Server cannot start from
 * the LaunchAgent even though it works from an interactive shell.
 */
export function launchAgentPathVariable(nodePath: string, codexPath: string): string {
  const entries = [
    dirname(nodePath),
    dirname(codexPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return [...new Set(entries)].join(":");
}

export function logDirectory(): string {
  return join(homedir(), "Library", "Logs", "AgenticWear");
}

export function plist(
  nodePath: string,
  cliPath: string,
  repoRoot: string,
  codexPath: string,
  logs: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(cliPath)}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENTIC_WEAR_CODEX_PATH</key>
    <string>${escapeXml(codexPath)}</string>
    <key>AGENTIC_WEAR_ENV_FILE</key>
    <string>${escapeXml(join(repoRoot, ".env.local"))}</string>
    <key>PATH</key>
    <string>${escapeXml(launchAgentPathVariable(nodePath, codexPath))}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(logs, "bridge.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(logs, "bridge.err.log"))}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
`;
}

function launchAgentPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function domain(): string {
  return `gui/${process.getuid?.() ?? 0}`;
}

/**
 * `launchctl bootout` returns before the old job is fully torn down, so an
 * immediate `bootstrap` often fails with "Bootstrap failed: 5: Input/output
 * error" (frequent on macOS betas). Retry briefly instead of failing install.
 */
async function bootstrapWithRetry(plistPath: string): Promise<void> {
  let lastError: unknown;
  for (const waitMs of [0, 500, 1_000, 2_000, 4_000]) {
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      await execFileAsync("launchctl", ["bootstrap", domain(), plistPath], { timeout: 15_000, maxBuffer: 64 * 1_024 });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("launchctl bootstrap failed");
}

async function bootout(): Promise<void> {
  await execFileAsync("launchctl", ["bootout", `${domain()}/${label}`], { timeout: 10_000, maxBuffer: 64 * 1_024 });
}

function requireMac(): void {
  if (process.platform !== "darwin") throw new Error("The v0.1 background bridge requires macOS launchd");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
