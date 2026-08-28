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
  const temporary = `${plistPath}.${process.pid}.tmp`;
  await writeFile(temporary, plist(nodePath, cliPath, repoRoot, codexPath), {
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

function plist(nodePath: string, cliPath: string, repoRoot: string, codexPath: string): string {
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
  </dict>
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

async function bootout(): Promise<void> {
  await execFileAsync("launchctl", ["bootout", `${domain()}/${label}`], { timeout: 10_000, maxBuffer: 64 * 1_024 });
}

async function bootstrapWithRetry(plistPath: string): Promise<void> {
  const retryDelaysMs = [0, 500, 1_000, 2_000, 4_000, 8_000];
  let lastError: unknown;
  for (const retryDelayMs of retryDelaysMs) {
    if (retryDelayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs));
    try {
      await execFileAsync("launchctl", ["bootstrap", domain(), plistPath], {
        timeout: 15_000,
        maxBuffer: 64 * 1_024,
      });
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      // bootout can release the service label asynchronously. Retry only the
      // documented transient EIO; configuration and permission failures still
      // fail immediately with their original diagnostics.
      if (!/Bootstrap failed: 5|Input\/output error/iu.test(message)) throw error;
    }
  }
  throw lastError;
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
