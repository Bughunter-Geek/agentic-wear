import { describe, expect, it, vi } from "vitest";
import { BridgeService } from "../src/bridge-service.js";
function fixture(backend: "phonon" | "whisper", prepare: () => Promise<void>) {
  const stopped = new Error("synthetic stop at socket creation");
  const socket = vi.fn(() => { throw stopped; });
  const service = Object.create(BridgeService.prototype);
  Object.assign(service, { transcriber: { defaultBackend: backend }, draftEditor: { prepare },
    relay: { status: async () => ({ paired: true, watchPublicKey: "synthetic-key" }), runSocket: socket },
    controller: new AbortController(), assertWatchPublicKey: () => {} });
  return { service, socket, stopped };
}
describe("resident voice editor startup", () => {
  it("preloads Phonon's editor before accepting Watch requests", async () => {
    let finish!: () => void;
    const prepare = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { service, socket, stopped } = fixture("phonon", prepare);
    const running = service.run() as Promise<void>;
    const rejected = expect(running).rejects.toBe(stopped);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(socket).not.toHaveBeenCalled();finish();await rejected;
    expect(socket).toHaveBeenCalledTimes(1);
  });
  it("retains Whisper startup and proceeds if optional editor warmup fails", async () => {
    const whisperPrepare = vi.fn().mockResolvedValue(undefined);
    const whisper = fixture("whisper", whisperPrepare);
    await expect(whisper.service.run()).rejects.toBe(whisper.stopped);
    expect(whisperPrepare).not.toHaveBeenCalled();expect(whisper.socket).toHaveBeenCalledTimes(1);
    const failedPrepare = vi.fn().mockRejectedValue(new Error("synthetic model unavailable"));
    const phonon = fixture("phonon", failedPrepare);
    await expect(phonon.service.run()).rejects.toBe(phonon.stopped);
    expect(failedPrepare).toHaveBeenCalledTimes(1);expect(phonon.socket).toHaveBeenCalledTimes(1);
  });
});
