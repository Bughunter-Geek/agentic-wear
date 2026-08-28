import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const bridgeConfigSchema = z.object({
  version: z.literal(2),
  relayUrl: z.string().url(),
  pairId: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/u),
  bridgePublicKey: z.string().min(32).max(1_024),
  watchPublicKey: z.string().min(32).max(1_024).nullable(),
  defaultCwd: z.string().min(1).max(4_096),
  watchOwnedThreadIds: z.array(z.string().min(1).max(128)).max(200),
}).strict();

export type BridgeConfig = z.infer<typeof bridgeConfigSchema>;

export function configPath(): string {
  return process.env.AGENTIC_WEAR_CONFIG_PATH ?? join(homedir(), ".agentic-wear", "config.json");
}

export function replayDirectory(): string {
  return `${configPath()}.replay-v2`;
}

export async function readConfig(): Promise<BridgeConfig> {
  const path = configPath();
  const data = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(data);
  if (typeof parsed === "object" && parsed !== null && Reflect.get(parsed, "version") !== 2) {
    throw new Error("This pairing uses the retired unauthenticated protocol. Run `agentic-wear pair --replace` to pair securely.");
  }
  return bridgeConfigSchema.parse(parsed);
}

export async function writeConfig(config: BridgeConfig): Promise<void> {
  const path = configPath();
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(bridgeConfigSchema.parse(config), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "w",
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}
