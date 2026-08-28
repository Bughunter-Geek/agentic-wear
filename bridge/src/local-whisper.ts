import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { AudioMimeType, Transcriber } from "./transcriber.js";

const defaultModel = "mlx-community/whisper-turbo";
const installDirectory = join(homedir(), ".agentic-wear", "transcription");
const modelCacheDirectory = join(homedir(), ".agentic-wear", "models");
const requestTimeoutMs = 120_000;

type PendingRequest = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class LocalWhisperTranscriber implements Transcriber {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly pythonPath = localWhisperPythonPath(),
    private readonly ffmpegPath = resolveFfmpegPath(),
    private readonly model = localWhisperModel(),
  ) {}

  async prepare(): Promise<void> {
    await this.ensureWorker();
  }

  async transcribe(audio: Uint8Array, mimeType: AudioMimeType): Promise<string> {
    if (!isSupportedAudioMimeType(mimeType) || audio.byteLength < 1_024 || audio.byteLength > 512 * 1_024) {
      throw new Error("Voice recordings must be between 1 KiB and 512 KiB");
    }
    const worker = await this.ensureWorker();
    const id = randomUUID();
    return new Promise<string>((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error("Local Whisper took too long to respond"));
      }, requestTimeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout });
      worker.stdin.write(`${JSON.stringify({ id, audioBase64: Buffer.from(audio).toString("base64"), mimeType })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(new Error("Could not send audio to Local Whisper"));
      });
    });
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    this.failPending(new Error("Local Whisper stopped"));
    if (!worker || worker.killed || worker.exitCode !== null) return;
    const cleanExit = await new Promise<boolean>((resolveExit) => {
      const timeout = setTimeout(() => resolveExit(false), 2_000);
      worker.once("exit", () => {
        clearTimeout(timeout);
        resolveExit(true);
      });
      worker.stdin.end();
    });
    if (!cleanExit && !worker.killed && worker.exitCode === null) worker.kill("SIGTERM");
  }

  private async ensureWorker(): Promise<ChildProcessWithoutNullStreams> {
    if (!this.worker || !this.ready) this.startWorker();
    await this.ready;
    if (!this.worker) throw new Error("Local Whisper is unavailable");
    return this.worker;
  }

  private startWorker(): void {
    const worker = spawn(
      this.pythonPath,
      [workerPath(), "--model", this.model, "--ffmpeg", this.ffmpegPath],
      { env: localWhisperEnvironment(), stdio: ["pipe", "pipe", "pipe"] },
    );
    this.worker = worker;
    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      let settled = false;
      const failStart = (message: string) => {
        if (settled) return;
        settled = true;
        rejectReady(new Error(message));
      };
      createInterface({ input: worker.stdout }).on("line", (line) => {
        const message = parseWorkerMessage(line);
        if (message?.type === "ready") {
          if (!settled) {
            settled = true;
            resolveReady();
          }
          return;
        }
        if (message?.type !== "result" && message?.type !== "error") return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (message.type === "result") pending.resolve(message.text);
        else pending.reject(new Error(message.message));
      });
      worker.stderr.on("data", (chunk: Buffer) => {
        const detail = chunk.toString("utf8").trim();
        if (detail) console.error(JSON.stringify({ level: "info", message: "Local Whisper", detail: detail.slice(0, 500) }));
      });
      worker.once("error", () => failStart("Local Whisper could not start; run `agentic-wear transcription setup`"));
      worker.once("exit", (code, signal) => {
        this.worker = null;
        this.ready = null;
        failStart("Local Whisper stopped before it was ready; run `agentic-wear transcription setup`");
        this.failPending(new Error(`Local Whisper stopped (${signal ?? code ?? "unknown"})`));
      });
    });
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function isSupportedAudioMimeType(value: string): value is AudioMimeType {
  return value === "audio/mp4" || value === "audio/aac";
}

export function localWhisperModel(): string {
  return process.env.AGENTIC_WEAR_WHISPER_MODEL?.trim() || defaultModel;
}

export function localWhisperPythonPath(): string {
  return process.env.AGENTIC_WEAR_WHISPER_PYTHON?.trim() || join(installDirectory, "bin", "python3");
}

export function localWhisperEnvironment(offline = true): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HF_HOME: process.env.AGENTIC_WEAR_WHISPER_CACHE?.trim() || modelCacheDirectory,
    HF_HUB_DISABLE_PROGRESS_BARS: "1",
    TOKENIZERS_PARALLELISM: "false",
  };
  if (offline) environment.HF_HUB_OFFLINE = "1";
  else delete environment.HF_HUB_OFFLINE;
  return environment;
}

export async function assertLocalWhisperInstalled(): Promise<void> {
  await access(localWhisperPythonPath(), constants.X_OK).catch(() => {
    throw new Error("Local Whisper is not installed; run `agentic-wear transcription setup`");
  });
  await access(resolveFfmpegPath(), constants.X_OK).catch(() => {
    throw new Error("ffmpeg is missing; install it with `brew install ffmpeg`");
  });
}

export async function setupLocalWhisper(): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Automatic Local Whisper setup currently requires an Apple-silicon Mac");
  }
  const ffmpeg = resolveFfmpegPath();
  await access(ffmpeg, constants.X_OK).catch(() => {
    throw new Error("ffmpeg is required; install it with `brew install ffmpeg`, then run setup again");
  });
  const bootstrapPython = await resolveBootstrapPython();
  await mkdir(dirname(installDirectory), { recursive: true, mode: 0o700 });
  if (!existsSync(localWhisperPythonPath())) {
    await runVisible(bootstrapPython, ["-m", "venv", installDirectory]);
  }
  await runVisible(localWhisperPythonPath(), [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "mlx-whisper==0.4.3",
  ]);
  await runVisible(
    localWhisperPythonPath(),
    [workerPath(), "--model", localWhisperModel(), "--ffmpeg", ffmpeg, "--prepare"],
    localWhisperEnvironment(false),
  );
}

export function resolveTranscriptionProvider(value = process.env.AGENTIC_WEAR_TRANSCRIPTION_PROVIDER): "local" | "openai" {
  const normalized = value?.trim().toLowerCase() || "local";
  if (normalized === "local" || normalized === "openai") return normalized;
  throw new Error("AGENTIC_WEAR_TRANSCRIPTION_PROVIDER must be `local` or `openai`");
}

function resolveFfmpegPath(): string {
  const configured = process.env.AGENTIC_WEAR_FFMPEG_PATH?.trim();
  if (configured) return configured;
  for (const candidate of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]) {
    if (existsSync(candidate)) return candidate;
  }
  return "/opt/homebrew/bin/ffmpeg";
}

async function resolveBootstrapPython(): Promise<string> {
  const configured = process.env.AGENTIC_WEAR_WHISPER_BOOTSTRAP_PYTHON?.trim();
  const candidates = [configured, "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next well-known absolute path.
    }
  }
  throw new Error("Python 3 is required to install Local Whisper");
}

function workerPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../whisper_worker.py");
}

function runVisible(executable: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, { env, stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${executable} failed (${signal ?? code ?? "unknown"})`));
    });
  });
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "result"; id: string; text: string }
  | { type: "error"; id: string; message: string };

function parseWorkerMessage(line: string): WorkerMessage | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null) return null;
    const type = Reflect.get(value, "type");
    if (type === "ready") return { type };
    const id = Reflect.get(value, "id");
    if (typeof id !== "string" || !id) return null;
    if (type === "result") {
      const text = Reflect.get(value, "text");
      return typeof text === "string" && text.trim() ? { type, id, text: text.trim().slice(0, 4_000) } : null;
    }
    if (type === "error") {
      const message = Reflect.get(value, "message");
      return typeof message === "string" && message.trim()
        ? { type, id, message: message.trim().slice(0, 240) }
        : null;
    }
    return null;
  } catch {
    return null;
  }
}
