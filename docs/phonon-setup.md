# Optional Phonon-2 dictation — Mac 0.3.15

Phonon-2 recognizes recorded English speech on your Mac for the Watch's record/review/send flow. It is **optional**, not a prerequisite for native Dot or local Codex live voice. Whisper remains the default multilingual dictation backend. The Watch can explicitly select a configured Phonon backend; an unavailable selection returns an error rather than silently switching to Whisper or paid transcription.

Local/offline describes inference after setup, not the whole app: Watch recordings still need the paired encrypted relay connection to reach the Mac, and sending text to a chat needs connectivity.

The Mac ZIP includes `bridge/phonon_worker.py` and the bridge integration, **not** Python, Fermion, Phonon weights, ffmpeg, Ollama or Qwen. Extracting/registering the ZIP installs none of these. `node bridge/dist/cli.js transcription setup` installs **Whisper**, even when you intend to configure Phonon.

## Python/MLX setup on Apple silicon

The released Python worker requires **fermion-research 0.2.4** exactly. The tested host was an Apple-silicon Mac with Python 3.13; Intel Macs, Windows/Linux bridge installations and a minimum RAM requirement have not been validated here. Upstream offers other engines, but those are not interchangeable with this MLX worker. English only; use Whisper for other languages.

Install ffmpeg (`brew install ffmpeg`) and have an arm64 Python 3.13 available. Keep an isolated environment outside the checkout. These commands install the runtime and the main MLX dependencies at the versions used by the existing tested installation:

```sh
python3.13 -m venv "$HOME/.agentic-wear/phonon-2/.venv"
"$HOME/.agentic-wear/phonon-2/.venv/bin/python" -m pip install \
  'fermion-research==0.2.4' 'mlx==0.32.3' 'mlx-audio==0.5.7' \
  'mlx-lm==0.31.3' 'numpy==2.5.3' 'soundfile==0.14.0' \
  'scipy==1.18.1' 'zstandard==0.25.0'
```

Pip also installs the runtime's declared dependencies (including Torch/transformers). This is not a complete transitive lock or a newly exercised clean-install recipe. The existing isolated installation, released worker and upstream instructions were inspected for this documentation correction.

## Acquire the weights before bridge activation

Use the upstream command below with a short English WAV you intentionally choose for local setup. **This separate setup command downloads and unpacks the model if absent**; the Agentic Wear worker never downloads weights. Run it in a normal local Terminal with Metal access:

```sh
FERMION_CACHE_DIR="$HOME/.agentic-wear/phonon-2/cache/fermion" \
  "$HOME/.agentic-wear/phonon-2/.venv/bin/fermion" \
  transcribe phonon-2 /absolute/path/to/english.wav
```

The inspected 0.2.4 runtime verifies its pinned archive and unpacked members. With that cache setting its model directory is:

```text
~/.agentic-wear/phonon-2/cache/fermion/speech/FermionResearch__Phonon-2/model_phonon2_c4c_int6
```

The bridge requires `model.fermion`, `config.json` and `packed_manifest.json` together. Its worker additionally requires the container SHA-256 `4b6bfa3a12cc3c4e0a54f2ab3ec4ca7a842b09e5c7ecfc8e7ca0ac6cc8c11468`. The tested upstream archive is about 164 MB (178 MB unpacked), SHA-256 `98125795b6dda72f5c6eee9ba33d19815df65dcb18b50a357bf9f73c9935309e`, from revision `9c7fef3584499a88fe8d394427f45851bbb8b446`. The Python environment needs additional disk space; download size is not a RAM requirement. A changed upstream artifact must not be substituted by disabling the checksum.

Sources: [pinned model card](https://huggingface.co/FermionResearch/Phonon-2/blob/9c7fef3584499a88fe8d394427f45851bbb8b446/README.md), [upstream runtime](https://github.com/fermionresearch/phonon).

## Configure the private bridge

Add these to the `.env.local` actually read by your installed bridge. Replace `/Users/YOUR_NAME` with your real absolute home path; environment values must not contain `~` or shell variable expressions.

```dotenv
AGENTIC_WEAR_TRANSCRIPTION_PROVIDER=phonon
AGENTIC_WEAR_PHONON_RUNTIME=python
AGENTIC_WEAR_PHONON_PYTHON=/Users/YOUR_NAME/.agentic-wear/phonon-2/.venv/bin/python
AGENTIC_WEAR_PHONON_MODEL_DIR=/Users/YOUR_NAME/.agentic-wear/phonon-2/cache/fermion/speech/FermionResearch__Phonon-2/model_phonon2_c4c_int6
AGENTIC_WEAR_PHONON_CACHE=/Users/YOUR_NAME/.agentic-wear/phonon-2/cache
```

Run `node bridge/dist/cli.js doctor` from the matching package/source root to check configured paths. It is a prerequisite check, not a transcription acceptance test. End calls before restarting the existing bridge service; preserve pairing and registration. The worker decodes Watch AAC/MP4 through ffmpeg into mono 16 kHz audio, warms the model and reports ready. Its Hub networking and implicit tokens are disabled during inference. Initial preparation can take tens of seconds.

To restore Whisper, set `AGENTIC_WEAR_TRANSCRIPTION_PROVIDER=local`, ensure Whisper setup is complete and choose Whisper on the Watch too. OpenAI transcription requires explicit `openai` configuration and an API key; it is never a silent fallback. A missing configured default runtime/model can prevent bridge startup, even though live voice itself does not use Phonon.

## Qwen cleanup and Core ML are separate

**Qwen edits text after recognition; it does not transcribe audio.** Optional draft cleanup uses an already-running local Ollama service at `127.0.0.1:11434` and an already-installed model selected by `AGENTIC_WEAR_DRAFT_MODEL`. The maintainer uses `qwen3:4b-instruct-2507-q4_K_M`; the source default is `llama3.1:latest`. Neither is downloaded by the bridge/ZIP. Configure Ollama separately if you want model-assisted corrections. Busy, unavailable or rejected model output retains the draft for review; deterministic Phonon filler cleanup is separate, and original recognition remains available when changed.

The bridge also supports explicit `AGENTIC_WEAR_PHONON_RUNTIME=coreml`. That route requires a separately supplied compatible executable (`AGENTIC_WEAR_PHONON_COREML_WORKER`) and prepared model directory (`AGENTIC_WEAR_PHONON_COREML_MODEL_DIR`) containing `manifest.json`, `decoder.bin` and `Phonon-2.mlmodelc` compiled at its permanent path. **The public ZIP does not supply a Core ML worker, model or installer.** Use the Python route above unless you already have that matching prepared installation; do not point Core ML settings at the Python model.
