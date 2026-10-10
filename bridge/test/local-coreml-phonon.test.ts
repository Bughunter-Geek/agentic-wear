import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, chmod, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertLocalCoreMLPhononInstalled, createLocalPhononTranscriber, isLocalPhononConfigured,
  LocalCoreMLPhononTranscriber, localPhononRuntime, localPhononRuntimeModel,
} from "../src/local-coreml-phonon.js";
import { LocalPhononTranscriber } from "../src/local-phonon.js";
import { MAX_AUDIO_BYTES } from "../src/limits.js";

afterEach(() => vi.unstubAllEnvs());
function pythonSettings() {
  vi.stubEnv("AGENTIC_WEAR_PHONON_PYTHON", "/existing/python");
  vi.stubEnv("AGENTIC_WEAR_PHONON_MODEL_DIR", "/existing/python-model");
}
function nativeSettings(executable = "/prepared/native-worker", model = "/prepared/coreml-model") {
  vi.stubEnv("AGENTIC_WEAR_PHONON_COREML_WORKER", executable);
  vi.stubEnv("AGENTIC_WEAR_PHONON_COREML_MODEL_DIR", model);
}

describe("app-scoped Phonon runtime selection", () => {
  it.each([undefined, "", "   ", "python"])("keeps Python for default/explicit value %s even with native paths configured", value => {
    vi.stubEnv("AGENTIC_WEAR_PHONON_RUNTIME", value); pythonSettings(); nativeSettings();
    expect(localPhononRuntime()).toBe("python");
    expect(createLocalPhononTranscriber()).toBeInstanceOf(LocalPhononTranscriber);
    expect(localPhononRuntimeModel()).toBe("/existing/python-model");
    expect(isLocalPhononConfigured()).toBe(true);
  });
  it("selects native only by explicit opt-in without needing Python model paths", () => {
    vi.stubEnv("AGENTIC_WEAR_PHONON_RUNTIME", " coreml ");
    vi.stubEnv("AGENTIC_WEAR_PHONON_PYTHON", undefined); vi.stubEnv("AGENTIC_WEAR_PHONON_MODEL_DIR", undefined);
    nativeSettings();
    expect(createLocalPhononTranscriber()).toBeInstanceOf(LocalCoreMLPhononTranscriber);
    expect(localPhononRuntimeModel()).toBe("/prepared/coreml-model");
    expect(isLocalPhononConfigured()).toBe(true);
  });
  it("rejects unknown runtime instead of switching or falling back silently", () => {
    vi.stubEnv("AGENTIC_WEAR_PHONON_RUNTIME", "automatic"); pythonSettings(); nativeSettings();
    expect(() => createLocalPhononTranscriber()).toThrow(/must be python or coreml/u);
  });
  it("does not use valid Python settings to hide missing native opt-in paths", () => {
    vi.stubEnv("AGENTIC_WEAR_PHONON_RUNTIME", "coreml"); pythonSettings();
    vi.stubEnv("AGENTIC_WEAR_PHONON_COREML_WORKER", undefined);
    vi.stubEnv("AGENTIC_WEAR_PHONON_COREML_MODEL_DIR", undefined);
    expect(isLocalPhononConfigured()).toBe(false);
    expect(() => createLocalPhononTranscriber()).toThrow(/COREML_WORKER.*absolute path/u);
  });
  it("rejects relative native paths", () => {
    vi.stubEnv("AGENTIC_WEAR_PHONON_RUNTIME", "coreml"); nativeSettings("./native-worker");
    expect(() => createLocalPhononTranscriber()).toThrow(/absolute path/u);
  });
});

describe("native Phonon launch and unchanged JSONL lifecycle", () => {
  async function fixture(script: string) {
    const dir = await mkdtemp(join(tmpdir(), "coreml-bridge-fixture-"));
    const executable = join(dir, "native worker.cjs");
    await writeFile(executable, "#!/usr/bin/env node\n" + script);
    await chmod(executable, 0o700);
    return { dir, executable };
  }
  it("passes native argv without a Python script, reuses one child, accepts both MIME types and diagnostics", async () => {
    const f = await fixture(`const r=require('node:readline');let n=0;console.log(JSON.stringify({type:'ready',model:'phonon-2',diagnostics:{ignored:true}}));const lines=r.createInterface({input:process.stdin});lines.on('line',line=>{const p=JSON.parse(line);console.log(JSON.stringify({type:'result',id:p.id,text:JSON.stringify({argv:process.argv.slice(2),n:++n,mime:p.mimeType}),diagnostics:{memory:{footprintBytes:123}}}));});`);
    const worker = new LocalCoreMLPhononTranscriber(f.executable, "/prepared/model with spaces", "/prepared/ffmpeg with spaces");
    try {
      await worker.prepare();
      const first = JSON.parse(await worker.transcribe(new Uint8Array(2048), "audio/aac")) as {argv:string[];n:number;mime:string};
      expect(first).toEqual({argv:["--model","/prepared/model with spaces","--ffmpeg","/prepared/ffmpeg with spaces","--eager","15"],n:1,mime:"audio/aac"});
      const second = JSON.parse(await worker.transcribe(new Uint8Array(2048), "audio/mp4")) as {n:number;mime:string};
      expect(second.n).toBe(2); expect(second.mime).toBe("audio/mp4");
    } finally { await worker.close(); await rm(f.dir,{recursive:true,force:true}); }
  });
  it("propagates a worker error without automatic Python/model/provider fallback", async () => {
    const f = await fixture(`const r=require('node:readline');console.log(JSON.stringify({type:'ready'}));r.createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);console.log(JSON.stringify({type:'error',id:p.id,message:'Native fixture rejected audio'}));});`);
    vi.stubEnv("AGENTIC_WEAR_PHONON_RUNTIME", "coreml"); pythonSettings(); nativeSettings(f.executable);
    const worker = createLocalPhononTranscriber();
    try { await expect(worker.transcribe(new Uint8Array(2048),"audio/aac")).rejects.toThrow("Native fixture rejected audio"); }
    finally { await worker.close(); await rm(f.dir,{recursive:true,force:true}); }
  });
  it("rejects startup failure before accepting audio", async () => {
    const f = await fixture("process.exit(1);");
    const worker = new LocalCoreMLPhononTranscriber(f.executable,"/prepared/model","/unused/ffmpeg");
    try { await expect(worker.prepare()).rejects.toThrow(/Local Phonon-2 stopped before/u); }
    finally { await worker.close(); await rm(f.dir,{recursive:true,force:true}); }
  });
  it("rejects bounded/malformed input before spawning a native worker", async () => {
    const worker = new LocalCoreMLPhononTranscriber("/missing/native-worker","/prepared/model","/unused/ffmpeg");
    await expect(worker.transcribe(new Uint8Array(12),"audio/aac")).rejects.toThrow(/1 KiB/u);
    await expect(worker.transcribe(new Uint8Array(MAX_AUDIO_BYTES+1),"audio/mp4")).rejects.toThrow(/four-minute/u);
  });
  it("rejects a pending caller when close is requested and closes only its owned child", async () => {
    const f = await fixture(`const r=require('node:readline');console.log(JSON.stringify({type:'ready'}));const lines=r.createInterface({input:process.stdin});lines.on('line',()=>{});`);
    const worker = new LocalCoreMLPhononTranscriber(f.executable,"/prepared/model","/unused/ffmpeg");
    try {
      await worker.prepare();
      const pending = worker.transcribe(new Uint8Array(2048),"audio/aac");
      const rejection = expect(pending).rejects.toThrow(/Local Phonon-2 stopped/u);
      await new Promise<void>(resolve => setImmediate(resolve));
      await worker.close(); await rejection;
    } finally { await worker.close(); await rm(f.dir,{recursive:true,force:true}); }
  });
  it("checks prepared assets without downloading, compiling, or loading a model", async () => {
    const f = await fixture("process.exit(99);");
    const model = join(f.dir,"model");
    await mkdir(model);
    await writeFile(join(model,"manifest.json"),"{}"); await writeFile(join(model,"decoder.bin"),"fixture");
    vi.stubEnv("AGENTIC_WEAR_FFMPEG_PATH",process.execPath); nativeSettings(f.executable,model);
    try {
      await expect(assertLocalCoreMLPhononInstalled()).rejects.toThrow(/compiled at its final stable path/u);
      await mkdir(join(model,"Phonon-2.mlmodelc"));
      await expect(assertLocalCoreMLPhononInstalled()).resolves.toBeUndefined();
    } finally { await rm(f.dir,{recursive:true,force:true}); }
  });
});
