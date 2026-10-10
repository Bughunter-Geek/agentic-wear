import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalPhononTranscriber, localPhononEnvironment } from "../src/local-phonon.js";
import { resolveTranscriptionProvider } from "../src/local-whisper.js";

describe("experimental Phonon worker", () => {
  it("requires explicit selection and retains Whisper and hosted choices", () => {
    expect(resolveTranscriptionProvider("phonon")).toBe("phonon");
    expect(resolveTranscriptionProvider("local")).toBe("local");
    expect(resolveTranscriptionProvider("openai")).toBe("openai");
  });
  it("runs offline without implicit Hub credentials", () => {
    const env = localPhononEnvironment("/isolated/model");
    expect(env.HF_HUB_OFFLINE).toBe("1");
    expect(env.HF_HUB_DISABLE_IMPLICIT_TOKEN).toBe("1");
  });
  it("reuses a prepared child, correlates replies, and closes it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phonon-worker-"));
    const path = join(dir, "worker.cjs");
    await writeFile(path, `const r=require('node:readline'); let n=0; console.log(JSON.stringify({type:'ready'})); r.createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);console.log(JSON.stringify({type:'result',id:p.id,text:'same-worker-'+(++n)}));});`);
    const worker = new LocalPhononTranscriber(process.execPath, "/isolated/model", "/unused/ffmpeg", path);
    try {
      await worker.prepare();
      expect(await worker.transcribe(new Uint8Array(2048), "audio/aac")).toBe("same-worker-1");
      expect(await worker.transcribe(new Uint8Array(2048), "audio/mp4")).toBe("same-worker-2");
      await worker.close();
      expect(await worker.transcribe(new Uint8Array(2048), "audio/aac")).toBe("same-worker-1");
    } finally { await worker.close(); await rm(dir, {recursive:true,force:true}); }
  });
  it("accepts bounded worker timings and never logs text or worker identifiers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phonon-timing-"));
    const path = join(dir, "worker.cjs");
    await writeFile(path, `const r=require('node:readline'); console.log(JSON.stringify({type:'ready'})); r.createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);console.log(JSON.stringify({type:'result',id:p.id,text:'sensitive-result',timing:{decodeMs:12,inferenceMs:24,audioDurationMs:1600,secret:'do-not-log'}}));});`);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const worker = new LocalPhononTranscriber(process.execPath, "/isolated/model", "/unused/ffmpeg", path);
    try {
      expect(await worker.transcribe(new Uint8Array(2048), "audio/aac")).toBe("sensitive-result");
      const messages = JSON.stringify(log.mock.calls);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ decodeMs: 12, inferenceMs: 24 });
      for (const secret of ["sensitive-result", "do-not-log", "audioBase64", '"id"']) expect(messages).not.toContain(secret);
    } finally { await worker.close(); log.mockRestore(); await rm(dir, {recursive:true,force:true}); }
  });
  it("reports Phonon startup failure before accepting audio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "phonon-failed-worker-"));
    const path = join(dir, "worker.cjs");
    await writeFile(path, "process.exit(1)");
    const worker = new LocalPhononTranscriber(process.execPath, "/isolated/model", "/unused/ffmpeg", path);
    try { await expect(worker.prepare()).rejects.toThrow(/Local Phonon-2 stopped before/u); }
    finally { await worker.close(); await rm(dir, {recursive:true,force:true}); }
  });
  it("rejects malformed audio before attempting startup", async () => {
    const worker = new LocalPhononTranscriber("/missing/python", "/isolated/model");
    await expect(worker.transcribe(new Uint8Array(12), "audio/aac")).rejects.toThrow(/1 KiB/u);
  });
});
