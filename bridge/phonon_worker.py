#!/usr/bin/env python3
"""Offline Phonon-2 worker using the existing watch AAC decode and JSONL protocol.

Runs only as a bridge-owned child; no listener, microphone, or model download.
"""
from __future__ import annotations
import argparse
import base64
import os
import contextlib
import hashlib
import importlib.metadata
import json
import sys
import time
from pathlib import Path
from whisper_worker import decode_audio, emit, MAX_TEXT_LENGTH

MODEL_SHA256 = "4b6bfa3a12cc3c4e0a54f2ab3ec4ca7a842b09e5c7ecfc8e7ca0ac6cc8c11468"
MAX_REQUEST_CHARS = 1_740_000


def load_model(model_dir: str):
    # Keep this experimental integration on the version and artifact actually tested.
    if importlib.metadata.version("fermion-research") != "0.2.4":
        raise RuntimeError("Phonon integration requires the tested fermion-research 0.2.4 runtime")
    container = Path(model_dir) / "model.fermion"
    with container.open("rb") as handle:
        if hashlib.file_digest(handle, "sha256").hexdigest() != MODEL_SHA256:
            raise RuntimeError("Phonon-2 model checksum does not match the tested release")
    from fermion._speech.engine_phonon2 import load
    return load(model_dir, profile="five-value", backend="phonon2-five-value")


def transcribe_request(payload, speech, ffmpeg):
    if not isinstance(payload, dict):
        raise ValueError("Invalid transcription request")
    request_id = payload.get("id")
    if not isinstance(request_id, str) or not request_id or len(request_id) > 128:
        raise ValueError("Missing or invalid transcription request ID")
    encoded = payload.get("audioBase64")
    if not isinstance(encoded, str):
        raise ValueError("Missing transcription audio")
    mime_type = payload.get("mimeType", "audio/mp4")
    if mime_type not in ("audio/aac", "audio/mp4"):
        raise ValueError("Unsupported transcription audio format")
    started = time.perf_counter()
    audio = decode_audio(encoded, mime_type, ffmpeg)
    decoded = time.perf_counter()
    text = speech.transcribe_array_detailed(audio).triple()[0].strip()
    if not text:
        raise ValueError("The recording did not contain recognizable English speech")
    return {"type": "result", "id": request_id, "text": text[:MAX_TEXT_LENGTH],
            "timing": {"decodeMs": round((decoded - started) * 1000, 3),
                       "inferenceMs": round((time.perf_counter() - decoded) * 1000, 3),
                       "audioDurationMs": round(getattr(audio, "size", 0) / 16, 3)}}


def run(model_dir: str, ffmpeg: str):
    import numpy as np
    started = time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr):
        speech = load_model(model_dir)
        # Warm before ready: the first decode is slow even after model load.
        speech.transcribe_array_detailed(np.zeros(16_000, dtype=np.float32))
        # Silence takes a different decoder path. Optional generated speech primes
        # the real speech path before ready; it never uses user recordings.
        warmup_path = os.environ.get("AGENTIC_WEAR_PHONON_WARMUP_AUDIO")
        if warmup_path:
            path = Path(warmup_path)
            if not path.is_absolute() or not 1024 <= path.stat().st_size <= 1_300_000:
                raise ValueError("Invalid configured synthetic warm-up clip")
            warmup = decode_audio(base64.b64encode(path.read_bytes()).decode("ascii"), "audio/aac", ffmpeg)
            speech.transcribe_array_detailed(warmup)
    print(json.dumps({"backend": "phonon-2", "event": "ready", "english_only": True,
                      "warm_prepare_seconds": round(time.perf_counter() - started, 3)}), file=sys.stderr, flush=True)
    emit({"type": "ready", "model": "phonon-2"})
    while True:
        line = sys.stdin.readline(MAX_REQUEST_CHARS + 1)
        if not line:
            break
        if len(line) > MAX_REQUEST_CHARS:
            # Never interpret the remaining tail as another request.
            emit({"type": "error", "id": "", "message": "Transcription request exceeds the audio limit"})
            return
        request_id = ""
        try:
            payload = json.loads(line)
            if isinstance(payload, dict) and isinstance(payload.get("id"), str):
                request_id = payload["id"][:128]
            with contextlib.redirect_stdout(sys.stderr):
                result = transcribe_request(payload, speech, ffmpeg)
            emit(result)
        except Exception:
            # No transcripts, audio bytes, filesystem paths or backend stack traces in error envelopes.
            emit({"type": "error", "id": request_id, "message": "Local Phonon-2 could not transcribe this recording"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--ffmpeg", required=True)
    args = parser.parse_args()
    run(args.model, args.ffmpeg)
