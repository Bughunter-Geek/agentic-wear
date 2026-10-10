import { describe, expect, it, vi } from "vitest";
import { SelectableTranscriber } from "../src/selectable-transcriber.js";
import { watchPayloadSchema } from "../src/schemas.js";

describe("watch backend selection", () => {
  it("routes explicit choices and preserves build-51 default behavior", async () => {
    const phonon={transcribe:vi.fn(async()=>"phonon"),close:vi.fn()};
    const whisper={transcribe:vi.fn(async()=>"whisper"),close:vi.fn()};
    const router=new SelectableTranscriber(phonon,{phonon,whisper});
    expect(await router.transcribe(new Uint8Array(2048),"audio/aac")).toBe("phonon");
    expect(await router.transcribe(new Uint8Array(2048),"audio/aac","whisper")).toBe("whisper");
    expect(await router.transcribe(new Uint8Array(2048),"audio/aac","phonon")).toBe("phonon");
    await router.close();expect(phonon.close).toHaveBeenCalledTimes(1);expect(whisper.close).toHaveBeenCalledTimes(1);
  });
  it("refuses unavailable choices instead of silently using a different model", async()=>{
    const fallback={transcribe:vi.fn(async()=>"default")};
    const router=new SelectableTranscriber(fallback,{});
    await expect(router.transcribe(new Uint8Array(2048),"audio/aac","phonon")).rejects.toThrow(/not configured/u);
    expect(fallback.transcribe).not.toHaveBeenCalled();
  });
  it("accepts the optional field, keeps legacy payloads, and rejects unknown backends",()=>{
    const p={version:1,kind:"transcription.create",requestId:"request-1",audioBase64:"a".repeat(24),mimeType:"audio/aac",threadId:null};
    expect(watchPayloadSchema.safeParse(p).success).toBe(true);
    expect(watchPayloadSchema.safeParse({...p,backend:"phonon"}).success).toBe(true);
    expect(watchPayloadSchema.safeParse({...p,backend:"whisper"}).success).toBe(true);
    expect(watchPayloadSchema.safeParse({...p,backend:"unknown"}).success).toBe(false);
  });
});
