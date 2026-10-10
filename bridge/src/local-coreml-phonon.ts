import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { assertLocalPhononInstalled, LocalPhononTranscriber, localPhononModel } from "./local-phonon.js";
import { LocalWhisperTranscriber, resolveFfmpegPath } from "./local-whisper.js";

/** Native runtime is an explicit app-scoped opt-in. Existing installs stay Python. */
export function localPhononRuntime(): "python" | "coreml" {
  const value = process.env.AGENTIC_WEAR_PHONON_RUNTIME?.trim();
  if (!value || value === "python") return "python";
  if (value === "coreml") return "coreml";
  throw new Error("AGENTIC_WEAR_PHONON_RUNTIME must be python or coreml");
}

function requiredNativePath(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || !isAbsolute(value)) throw new Error(`${name} must name an absolute path to the prepared Core ML installation`);
  return value;
}

export function localCoreMLWorkerPath(): string { return requiredNativePath("AGENTIC_WEAR_PHONON_COREML_WORKER"); }
export function localCoreMLModel(): string { return requiredNativePath("AGENTIC_WEAR_PHONON_COREML_MODEL_DIR"); }

/** Same Phonon JSONL/error/timeout lifecycle; only executable/arguments differ. */
export class LocalCoreMLPhononTranscriber extends LocalWhisperTranscriber {
  constructor(executable = localCoreMLWorkerPath(), model = localCoreMLModel(), ffmpeg = resolveFfmpegPath()) {
    super(executable, ffmpeg, model, {
      label: "Local Phonon-2",
      environment: process.env,
      command: { executable, args: ["--model", model, "--ffmpeg", ffmpeg, "--eager", "15"] },
    });
  }
}

export function createLocalPhononTranscriber(): LocalWhisperTranscriber {
  return localPhononRuntime() === "coreml" ? new LocalCoreMLPhononTranscriber() : new LocalPhononTranscriber();
}

export function isLocalPhononConfigured(): boolean {
  return localPhononRuntime() === "coreml"
    ? Boolean(process.env.AGENTIC_WEAR_PHONON_COREML_WORKER && process.env.AGENTIC_WEAR_PHONON_COREML_MODEL_DIR)
    : Boolean(process.env.AGENTIC_WEAR_PHONON_PYTHON && process.env.AGENTIC_WEAR_PHONON_MODEL_DIR);
}

export function localPhononRuntimeModel(): string {
  return localPhononRuntime() === "coreml" ? localCoreMLModel() : localPhononModel();
}

export async function assertLocalCoreMLPhononInstalled(): Promise<void> {
  const executable = localCoreMLWorkerPath();
  const model = localCoreMLModel();
  await access(executable, constants.X_OK).catch(() => { throw new Error("The configured Core ML Phonon worker is unavailable"); });
  if (!(await stat(executable)).isFile()) throw new Error("Core ML Phonon worker must be an executable file");
  await access(resolveFfmpegPath(), constants.X_OK).catch(() => { throw new Error("ffmpeg is required to decode watch AAC audio"); });
  for (const name of ["manifest.json", "decoder.bin"]) {
    await access(resolve(model, name), constants.R_OK).catch(() => { throw new Error(`Core ML Phonon model is missing ${name}`); });
  }
  const compiled = resolve(model, "Phonon-2.mlmodelc");
  const prepared = await stat(compiled).catch(() => null);
  if (!prepared?.isDirectory()) throw new Error("Core ML Phonon model must be compiled at its final stable path before activation");
}

export async function assertLocalPhononRuntimeInstalled(): Promise<void> {
  if (localPhononRuntime() === "coreml") await assertLocalCoreMLPhononInstalled();
  else await assertLocalPhononInstalled();
}
