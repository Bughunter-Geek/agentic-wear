#!/usr/bin/env python3
"""Bounded JSON-lines worker for local Agentic Wear transcription."""

from __future__ import annotations

import argparse
import base64
import binascii
import contextlib
import json
import os
import subprocess
import sys
from typing import Any

MAX_AUDIO_BYTES = 512 * 1024
MAX_TEXT_LENGTH = 4000


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def decode_audio(encoded: str, mime_type: str, ffmpeg_path: str):
    import numpy as np

    try:
        compressed = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("The watch sent invalid audio") from error
    if not 1024 <= len(compressed) <= MAX_AUDIO_BYTES:
        raise ValueError("Voice recordings must be between 1 KiB and 512 KiB")

    input_options = ["-f", "aac"] if mime_type == "audio/aac" else []
    result = subprocess.run(
        [
            ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            *input_options,
            "-i",
            "pipe:0",
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ac",
            "1",
            "-ar",
            "16000",
            "pipe:1",
        ],
        input=compressed,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=20,
        check=False,
    )
    compressed = b""
    if result.returncode != 0:
        raise ValueError("The watch recording could not be decoded")
    if len(result.stdout) < 1600:
        raise ValueError("The recording ended before it captured audio frames")
    return np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def load_transcriber(model: str):
    import mlx.core as mx
    from mlx_whisper.transcribe import ModelHolder, transcribe

    with contextlib.redirect_stdout(sys.stderr):
        ModelHolder.get_model(model, mx.float16)
    return transcribe


def prepare(model: str) -> None:
    load_transcriber(model)
    emit({"type": "prepared", "model": model})


def transcribe_audio(transcribe, audio, model: str):
    with contextlib.redirect_stdout(sys.stderr):
        return transcribe(
            audio,
            path_or_hf_repo=model,
            verbose=None,
            task="transcribe",
            language=None,
            temperature=0.0,
            condition_on_previous_text=False,
            without_timestamps=True,
        )


def run(model: str, ffmpeg_path: str) -> None:
    import numpy as np

    transcribe = load_transcriber(model)
    # Compile and warm the actual decoder before advertising readiness. This moves
    # Metal/JIT startup out of the first real voice request.
    transcribe_audio(transcribe, np.zeros(16_000, dtype=np.float32), model)
    emit({"type": "ready", "model": model})
    for line in sys.stdin:
        request_id = ""
        try:
            payload = json.loads(line)
            request_id = payload.get("id", "")
            if not isinstance(request_id, str) or not request_id:
                raise ValueError("Missing transcription request ID")
            encoded = payload.get("audioBase64")
            if not isinstance(encoded, str):
                raise ValueError("Missing transcription audio")
            mime_type = payload.get("mimeType", "audio/mp4")
            if mime_type not in ("audio/mp4", "audio/aac"):
                raise ValueError("Unsupported transcription audio format")
            audio = decode_audio(encoded, mime_type, ffmpeg_path)
            result = transcribe_audio(transcribe, audio, model)
            text = str(result.get("text", "")).strip()
            if not text:
                raise ValueError("The recording did not contain recognizable speech")
            emit({"type": "result", "id": request_id, "text": text[:MAX_TEXT_LENGTH]})
        except Exception as error:  # The parent receives a bounded, non-secret message.
            detail = str(error).strip().replace("\n", " ")[:240] or "Local transcription failed"
            emit({"type": "error", "id": request_id, "message": detail})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    if args.prepare:
        prepare(args.model)
    else:
        run(args.model, args.ffmpeg)


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    main()
