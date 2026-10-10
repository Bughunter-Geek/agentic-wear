import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalWhisperTranscriber, resolveFfmpegPath } from "./local-whisper.js";

function requiredPath(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || !isAbsolute(value)) throw new Error(`${name} must name an absolute path to the isolated Phonon-2 installation`);
  return value;
}
export function localPhononPythonPath(): string { return requiredPath("AGENTIC_WEAR_PHONON_PYTHON"); }
export function localPhononModel(): string { return requiredPath("AGENTIC_WEAR_PHONON_MODEL_DIR"); }
export function localPhononEnvironment(model: string): NodeJS.ProcessEnv {
  const cache = process.env.AGENTIC_WEAR_PHONON_CACHE?.trim() || resolve(dirname(model), "cache");
  return {
    ...process.env,
    FERMION_CACHE_DIR: resolve(cache, "fermion"),
    HF_HOME: resolve(cache, "huggingface"),
    XDG_CACHE_HOME: cache,
    HF_HUB_OFFLINE: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
    DO_NOT_TRACK: "1",
    TOKENIZERS_PARALLELISM: "false",
  };
}
export class LocalPhononTranscriber extends LocalWhisperTranscriber {
  constructor(
    pythonPath = localPhononPythonPath(),
    model = localPhononModel(),
    ffmpegPath = resolveFfmpegPath(),
    scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "../phonon_worker.py"),
  ) {
    super(pythonPath, ffmpegPath, model, {
      path: scriptPath, environment: localPhononEnvironment(model), label: "Local Phonon-2",
    });
  }
}
export async function assertLocalPhononInstalled(): Promise<void> {
  const python = localPhononPythonPath();
  const model = localPhononModel();
  await access(python, constants.X_OK).catch(() => { throw new Error("The configured isolated Phonon Python is unavailable"); });
  await access(resolveFfmpegPath(), constants.X_OK).catch(() => { throw new Error("ffmpeg is required to decode watch AAC audio"); });
  for (const name of ["model.fermion", "config.json", "packed_manifest.json"]) {
    await access(resolve(model, name), constants.R_OK).catch(() => { throw new Error(`Phonon-2 model is missing ${name}`); });
  }
}
