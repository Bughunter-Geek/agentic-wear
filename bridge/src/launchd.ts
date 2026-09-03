import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const label = "io.github.sirbughunter.agenticwear.bridge";

export type LaunchAgentMetadata = {
  workingDirectory: string | null;
  cliPath: string | null;
  codexPath: string | null;
  nodePath: string | null;
};

export type LaunchAgentInspection = {
  installed: boolean;
  running: boolean;
  plistPath: string;
  workingDirectory: string | null;
  cliPath: string | null;
  codexPath: string | null;
  matchesRepo: boolean;
  pid: number | null;
};

export function parseLaunchAgentPlist(content: string): LaunchAgentMetadata {
  const workingDirMatch = /<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/u.exec(content);
  const workingDirectory = workingDirMatch?.[1]?.trim() ?? null;
  const programArgsMatch = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/u.exec(content);
  let nodePath: string | null = null;
  let cliPath: string | null = null;
  const argsBlock = programArgsMatch?.[1];
  if (argsBlock) {
    const stringTags = [...argsBlock.matchAll(/<string>([^<]+)<\/string>/gu)]
      .map((m) => m[1]?.trim())
      .filter((s): s is string => typeof s === "string");
    if (stringTags.length >= 1) nodePath = stringTags[0] ?? null;
    if (stringTags.length >= 2) cliPath = stringTags[1] ?? null;
  }
  const codexPathMatch = /<key>AGENTIC_WEAR_CODEX_PATH<\/key>\s*<string>([^<]+)<\/string>/u.exec(content);
  const codexPath = codexPathMatch?.[1]?.trim() ?? null;
  return { workingDirectory, cliPath, codexPath, nodePath };
}

export async function inspectLaunchAgent(expectedRepoRoot: string): Promise<LaunchAgentInspection> {
  if (process.platform !== "darwin") {
    return {
      installed: false,
      running: false,
      plistPath: launchAgentPath(),
      workingDirectory: null,
      cliPath: null,
      codexPath: null,
      matchesRepo: false,
      pid: null,
    };
  }
  const plistPath = launchAgentPath();
  if (!existsSync(plistPath)) {
    return {
      installed: false,
      running: false,
      plistPath,
      workingDirectory: null,
      cliPath: null,
      codexPath: null,
      matchesRepo: false,
      pid: null,
    };
  }
  let content = "";
  try {
    content = await readFile(plistPath, "utf8");
  } catch {
    // If unreadable, proceed with empty metadata
  }
  const { workingDirectory, cliPath, codexPath } = parseLaunchAgentPlist(content);

  const normalizedExpected = resolve(expectedRepoRoot);
  const normalizedWorking = workingDirectory ? resolve(workingDirectory) : null;
  const expectedCli = resolve(normalizedExpected, "bridge", "dist", "cli.js");
  const normalizedCli = cliPath ? resolve(cliPath) : null;

  const matchesRepo = normalizedWorking === normalizedExpected && normalizedCli === expectedCli;

  let running = false;
  let pid: number | null = null;
  try {
    const { stdout } = await execFileAsync("launchctl", ["print", `${domain()}/${label}`], {
      timeout: 10_000,
      maxBuffer: 64 * 1_024,
    });
    const pidMatch = /\bpid = (\d+)/u.exec(stdout);
    const rawPid = pidMatch?.[1];
    if (rawPid) {
      pid = Number.parseInt(rawPid, 10);
      running = pid > 0;
    } else {
      running = /state = running/u.test(stdout);
    }
  } catch {
    running = false;
  }

  return {
    installed: true,
    running,
    plistPath,
    workingDirectory,
    cliPath,
    codexPath,
    matchesRepo,
    pid,
  };
}

export function generateLaunchAgentPlist(
  nodePath: string,
  cliPath: string,
  repoRoot: string,
  codexPath: string,
): string {
  return plist(nodePath, cliPath, repoRoot, codexPath);
}

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
