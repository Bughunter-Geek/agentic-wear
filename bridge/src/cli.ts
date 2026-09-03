#!/usr/bin/env node
import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BridgeService } from "./bridge-service.js";
import { configPath, readConfig, writeConfig, type BridgeConfig } from "./config.js";
import { generateBridgeKeyPair } from "./crypto-box.js";
import {
  bridgeCredentialAccount,
  deleteKeychainSecret,
  pairingAuthenticatorAccount,
  privateKeyAccount,
  readKeychainSecret,
  relayBootstrapAccount,
  setKeychainSecret,
} from "./keychain.js";
import {
  formatPairingCode,
  generatePairingCode,
  PairingAuthenticator,
} from "./pairing-auth.js";
import { RelayClient } from "./relay-client.js";
import { OpenAITranscriber } from "./transcriber.js";
import type { Transcriber } from "./transcriber.js";
import {
  assertLocalWhisperInstalled,
  LocalWhisperTranscriber,
  localWhisperModel,
  resolveTranscriptionProvider,
  setupLocalWhisper,
} from "./local-whisper.js";
import {
  inspectLaunchAgent,
  installLaunchAgent,
  uninstallLaunchAgent,
} from "./launchd.js";
import { uninstallCodexRelayConfig } from "./codex-relay-config.js";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  loadLocalEnvironment();
  const [command, ...args] = process.argv.slice(2);
  if (command === "pair") await pair(args);
  else if (command === "start") await start();
  else if (command === "doctor") await doctor();
  else if (command === "service") await service(args);
  else if (command === "transcription") await transcription(args);
  else if (command === "help" || command === "--help" || command === undefined) usage();
  else throw new Error(`Unknown command: ${command}`);
}

async function transcription(args: string[]): Promise<void> {
  const action = args[0];
  if (args.length !== 1 || action !== "setup") throw new Error("Use `agentic-wear transcription setup`");
  console.log(`Preparing free Local Whisper transcription (${localWhisperModel()})…`);
  await setupLocalWhisper();
  console.log("Local Whisper is ready. No OpenAI API key or per-minute transcription billing is required.");
}

async function service(args: string[]): Promise<void> {
  const action = args[0];
  if (args.length !== 1 || !action) throw new Error("Use `agentic-wear service install|uninstall|status`");
  if (action === "install") {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const builtCli = resolve(root, "bridge", "dist", "cli.js");
    if (!existsSync(builtCli)) throw new Error("Build the bridge first with `npm --prefix bridge run build`");
    const codexPath = await resolveCodexExecutable();
    // Current releases submit canonical user turns through the shared App
    // Server. Remove the legacy native-tool relay block during upgrade so no
    // background MCP process can recreate tool-context-only prompts.
    await uninstallCodexRelayConfig();
    const path = await installLaunchAgent(root, process.execPath, codexPath);
    const verification = await inspectLaunchAgent(root);
    if (!verification.matchesRepo) {
      throw new Error(`Service installation failed verification: plist points to ${verification.workingDirectory ?? "unknown"} instead of ${root}`);
    }
    console.log(`Background bridge installed and verified: ${path} (PID ${verification.pid ?? "active"})`);
    return;
  }
  if (action === "uninstall") {
    await uninstallLaunchAgent();
    await uninstallCodexRelayConfig();
    console.log("Background bridge removed. Pairing and Keychain data were preserved.");
    return;
  }
  if (action === "status") {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const inspection = await inspectLaunchAgent(root);
    if (!inspection.installed) {
      console.log("Background bridge is not installed.");
      if (process.platform === "darwin") process.exitCode = 1;
      return;
    }
    if (!inspection.matchesRepo) {
      console.warn(`WARNING: Background bridge is installed from a different checkout: ${inspection.workingDirectory ?? "unknown"} (current repo: ${root})`);
      console.warn("Run `agentic-wear service install` to migrate to this checkout.");
      process.exitCode = 1;
      return;
    }
    console.log(
      inspection.running
        ? `Background bridge is running (PID ${inspection.pid ?? "active"}). Working directory: ${inspection.workingDirectory}`
        : "Background bridge is loaded but not running.",
    );
    if (!inspection.running) process.exitCode = 1;
    return;
  }
  throw new Error("Use `agentic-wear service install|uninstall|status`");
}

async function pair(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const relayUrl = option(options, "relay") ?? process.env.AGENTIC_WEAR_RELAY_URL;
  if (!relayUrl) throw new Error("Pass --relay https://your-relay.example or set AGENTIC_WEAR_RELAY_URL");
  const bootstrapSecret = process.env.AGENTIC_WEAR_BOOTSTRAP_SECRET ??
    await readKeychainSecret(relayBootstrapAccount).catch(() => null);
  if (!bootstrapSecret || bootstrapSecret.length < 20) throw new Error("AGENTIC_WEAR_BOOTSTRAP_SECRET is missing");
  if (existsSync(configPath()) && !options.has("replace")) {
    throw new Error("Agentic Wear is already configured. Pass --replace to intentionally create a new pairing.");
  }
  const defaultCwd = resolve(option(options, "cwd") ?? process.cwd());
  if (!(await stat(defaultCwd)).isDirectory()) throw new Error("--cwd must point to a directory");

  const code = generatePairingCode();
  const authenticator = await PairingAuthenticator.fromCode(code);
  const keyPair = await generateBridgeKeyPair();
  const relay = new RelayClient(relayUrl);
  const result = await relay.startPairing(authenticator.pairId, keyPair.publicKeyBase64, bootstrapSecret);
  await setKeychainSecret(privateKeyAccount(result.pairId), keyPair.privateKeyMaterial);
  await setKeychainSecret(bridgeCredentialAccount(result.pairId), result.bridgeCredential);
  await setKeychainSecret(pairingAuthenticatorAccount(result.pairId), authenticator.encodedSecret);
  const config: BridgeConfig = {
    version: 2,
    relayUrl,
    pairId: result.pairId,
    bridgePublicKey: keyPair.publicKeyBase64,
    watchPublicKey: null,
    defaultCwd,
    watchOwnedThreadIds: [],
  };
  await writeConfig(config);
  console.log(`Pairing code: ${formatPairingCode(code)}`);
  console.log(`Expires in: ${Math.ceil(result.expiresInSeconds / 60)} minutes`);
  console.log("Open Agentic Wear on the watch and enter this code and your relay URL. Waiting for mutual authentication…");
  const pairedRelay = new RelayClient(relayUrl, result.pairId, result.bridgeCredential);
  config.watchPublicKey = await completeAuthenticatedPairing(
    config,
    pairedRelay,
    authenticator,
    result.expiresInSeconds * 1_000,
  );
  await writeConfig(config);
  await deleteKeychainSecret(pairingAuthenticatorAccount(result.pairId));
  console.log("Authenticated pairing complete. Run `agentic-wear start` or install the background service.");
}

async function start(): Promise<void> {
  process.env.AGENTIC_WEAR_CODEX_PATH ||= await resolveCodexExecutable();
  const config = await readConfig();
  const [privateKey, credential] = await Promise.all([
    readKeychainSecret(privateKeyAccount(config.pairId)),
    readKeychainSecret(bridgeCredentialAccount(config.pairId)),
  ]);
  const relay = new RelayClient(config.relayUrl, config.pairId, credential);
  if (!config.watchPublicKey) {
    const authenticator = await PairingAuthenticator.fromEncodedSecret(
      await readKeychainSecret(pairingAuthenticatorAccount(config.pairId)),
    );
    config.watchPublicKey = await completeAuthenticatedPairing(config, relay, authenticator, 10 * 60 * 1_000);
    await writeConfig(config);
    await deleteKeychainSecret(pairingAuthenticatorAccount(config.pairId));
  }
  const provider = resolveTranscriptionProvider();
  const transcriber: Transcriber = provider === "local"
    ? new LocalWhisperTranscriber()
    : openAiTranscriber();
  if (provider === "local") await assertLocalWhisperInstalled();
  try {
    await (transcriber.prepare?.() ?? Promise.resolve());
  } catch (error) {
    await transcriber.close?.();
    throw error;
  }
  const service = new BridgeService(
    config,
    relay,
    privateKey,
    transcriber,
  );
  const stop = () => service.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(JSON.stringify({ level: "info", message: "Agentic Wear bridge starting" }));
  await service.run();
}

async function completeAuthenticatedPairing(
  config: { pairId: string; bridgePublicKey: string },
  relay: RelayClient,
  authenticator: PairingAuthenticator,
  timeoutMs: number,
): Promise<string> {
  if (authenticator.pairId !== config.pairId) throw new Error("Stored pairing authenticator does not match this pairing");
  const deadline = Date.now() + timeoutMs;
  let lastConfirmationError: unknown;
  while (Date.now() < deadline) {
    const status = await relay.status();
    if (status.watchPublicKey && status.watchProof) {
      const valid = await authenticator.verifyProof(
        "watch",
        config.bridgePublicKey,
        status.watchPublicKey,
        status.watchProof,
      );
      if (!valid) throw new Error("Pairing authentication failed: the relay presented an invalid watch proof");
      if (status.paired) return status.watchPublicKey;
      const bridgeProof = await authenticator.createProof(
        "bridge",
        config.bridgePublicKey,
        status.watchPublicKey,
      );
      try {
        await relay.confirmPairing(status.watchPublicKey, status.watchProof, bridgeProof);
        return status.watchPublicKey;
      } catch (error) {
        lastConfirmationError = error;
      }
    }
    await wait(500);
  }
  const detail = lastConfirmationError instanceof Error ? `: ${lastConfirmationError.message}` : "";
  throw new Error(`Authenticated pairing timed out${detail}`);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function doctor(): Promise<void> {
  const checks: Array<{ check: string; ok: boolean; detail: string }> = [];
  try {
    const executable = await resolveCodexExecutable();
    const { stdout } = await execFileAsync(executable, ["--version"], {
      timeout: 10_000,
      maxBuffer: 64 * 1_024,
    });
    checks.push({ check: "codex", ok: true, detail: `${stdout.trim().slice(0, 100)} · ${executable}` });
  } catch {
    checks.push({ check: "codex", ok: false, detail: "Codex CLI was not found" });
  }
  try {
    const config = await readConfig();
    checks.push({ check: "config", ok: true, detail: configPath() });
    await Promise.all([
      readKeychainSecret(privateKeyAccount(config.pairId)),
      readKeychainSecret(bridgeCredentialAccount(config.pairId)),
    ]);
    checks.push({ check: "keychain", ok: true, detail: "Bridge credentials are present" });
    const status = await new RelayClient(
      config.relayUrl,
      config.pairId,
      await readKeychainSecret(bridgeCredentialAccount(config.pairId)),
    ).status();
    checks.push({ check: "relay", ok: status.paired, detail: status.paired ? "Watch is paired" : "Waiting for watch pairing" });
  } catch (error) {
    checks.push({ check: "configuration", ok: false, detail: safeMessage(error) });
  }
  try {
    const provider = resolveTranscriptionProvider();
    if (provider === "local") {
      await assertLocalWhisperInstalled();
      checks.push({ check: "transcription", ok: true, detail: `Local Whisper · ${localWhisperModel()} · no API billing` });
    } else {
      openAiTranscriber();
      checks.push({ check: "transcription", ok: true, detail: "OpenAI API · paid opt-in" });
    }
  } catch (error) {
    checks.push({ check: "transcription", ok: false, detail: safeMessage(error) });
  }
  for (const check of checks) console.log(`${check.ok ? "✓" : "✗"} ${check.check}: ${check.detail}`);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

async function resolveCodexExecutable(): Promise<string> {
  const configured = process.env.AGENTIC_WEAR_CODEX_PATH?.trim();
  const desktopCandidates = [
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    join(homedir(), "Applications", "ChatGPT.app", "Contents", "Resources", "codex"),
  ];
  let candidate = configured;
  if (!candidate) {
    for (const desktopCandidate of desktopCandidates) {
      try {
        await access(desktopCandidate, constants.X_OK);
        candidate = desktopCandidate;
        break;
      } catch {
        // Keep looking for a current desktop-bundled Codex runtime.
      }
    }
  }
  candidate ||= (await execFileAsync("/usr/bin/which", ["codex"], {
    timeout: 10_000,
    maxBuffer: 64 * 1_024,
  })).stdout.trim().split(/\r?\n/u)[0];
  if (!candidate || !isAbsolute(candidate)) {
    throw new Error("Codex executable could not be resolved to an absolute path");
  }
  await access(candidate, constants.X_OK);
  return candidate;
}

function loadLocalEnvironment(): void {
  const path = process.env.AGENTIC_WEAR_ENV_FILE ?? resolve(process.cwd(), ".env.local");
  if (existsSync(path)) loadEnvFile(path);
}

function parseOptions(args: string[]): Map<string, string | true> {
  const options = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current?.startsWith("--")) throw new Error(`Unexpected argument: ${current ?? ""}`);
    const name = current.slice(2);
    if (["replace"].includes(name)) {
      options.set(name, true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
    options.set(name, value);
    index += 1;
  }
  return options;
}

function option(options: Map<string, string | true>, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === "string" ? value : undefined;
}

function usage(): void {
  console.log(`Agentic Wear bridge

Usage:
  agentic-wear pair --relay <https-url> [--cwd <directory>] [--replace]
  agentic-wear start
  agentic-wear doctor
  agentic-wear transcription setup
  agentic-wear service install|uninstall|status`);
}

function openAiTranscriber(): OpenAITranscriber {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required only when AGENTIC_WEAR_TRANSCRIPTION_PROVIDER=openai");
  return new OpenAITranscriber(apiKey, process.env.AGENTIC_WEAR_TRANSCRIPTION_MODEL ?? "gpt-transcribe");
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown error").trim().replace(/\s+/gu, " ").slice(0, 260);
}

void main().catch((error: unknown) => {
  console.error(`Agentic Wear: ${safeMessage(error)}`);
  process.exitCode = 1;
});
