import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalWhisperTranscriber } from "../src/local-whisper.js";

const workerScript = `#!/usr/bin/env node
const { createInterface } = require("node:readline");
console.log(JSON.stringify({ type: "ready" }));
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id } = JSON.parse(line);
  // Give an older worker time to exit while this request is in flight.
  setTimeout(() => console.log(JSON.stringify({ type: "result", id, text: "Test transcript" })), 100);
});
process.stdin.on("end", () => setTimeout(() => process.exit(0), 30));
`;

describe("Local Whisper worker lifecycle", () => {
  it("can retry after a failed spawn once the executable is repaired", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentic-wear-worker-"));
    const executable = join(directory, "fake-python");
    const transcriber = new LocalWhisperTranscriber(executable, "/unused/ffmpeg", "test-model");
    try {
      await assert.rejects(transcriber.prepare(), /could not start/u);
      await writeFile(executable, workerScript, { mode: 0o700 });
      assert.equal(await transcriber.transcribe(new Uint8Array(1_024), "audio/aac"), "Test transcript");
    } finally {
      await transcriber.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not let an old worker's exit reject a replacement worker's request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentic-wear-worker-"));
    const executable = join(directory, "fake-python");
    await writeFile(executable, workerScript, { mode: 0o700 });
    const transcriber = new LocalWhisperTranscriber(executable, "/unused/ffmpeg", "test-model");
    try {
      await transcriber.prepare();
      const closing = transcriber.close();
      const text = transcriber.transcribe(new Uint8Array(1_024), "audio/aac");
      const [, result] = await Promise.all([closing, text]);
      assert.equal(result, "Test transcript");
    } finally {
      await transcriber.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("still rejects invalid audio without launching a worker", async () => {
    const transcriber = new LocalWhisperTranscriber("/missing/python", "/missing/ffmpeg");
    await assert.rejects(transcriber.transcribe(new Uint8Array(12), "audio/aac"), /1 KiB/u);
    await transcriber.close();
  });
});
