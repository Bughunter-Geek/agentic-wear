import { describe, expect, it, vi } from "vitest";
import { BridgeService } from "../src/bridge-service.js";
function fixture(backend: "phonon" | "whisper", prepare: () => Promise<void>, editorPrepare = vi.fn().mockResolvedValue(undefined)) {
  const controller = new AbortController();
  const stopped = new Promise<void>(resolve => controller.signal.addEventListener("abort", () => resolve()));
  const socket = vi.fn(() => stopped), cloudStart = vi.fn().mockResolvedValue(undefined), close = vi.fn().mockResolvedValue(undefined);
  const service = Object.create(BridgeService.prototype);
  Object.assign(service, { transcriber: { defaultBackend: backend, prepare, close }, draftEditor: { prepare: editorPrepare },
    relay: { status: async () => ({ paired: true, watchPublicKey: "synthetic-key" }), runSocket: socket },
    controller, assertWatchPublicKey: () => {},
    appServer: { connect: vi.fn().mockResolvedValue(undefined), close, monitorTerminals: () => stopped },
    desktopCloud: { start: cloudStart, close }, liveVoice: { close }, nativeDotVoice: { close }, cloudInlineTimers: new Map(),
    loadPendingTurns: vi.fn().mockResolvedValue(undefined), processPendingTurns: vi.fn().mockResolvedValue(undefined),
    reportRealtimeVoiceCapability: vi.fn().mockResolvedValue(undefined), sendSessions: vi.fn().mockResolvedValue(undefined),
  });
  return { service, socket, cloudStart, editorPrepare, close };
}
describe("local model preparation alongside cloud startup", () => {
  it("opens the relay and cloud receiver while Phonon is still loading, then prepares the editor sequentially", async () => {
    let finish!: () => void;
    const prepare = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const f = fixture("phonon", prepare); const running = f.service.run() as Promise<void>;
    try {
      await vi.waitFor(() => expect(f.cloudStart).toHaveBeenCalledTimes(1));
      expect(f.socket).toHaveBeenCalledTimes(1); expect(prepare).toHaveBeenCalledTimes(1);
      expect(f.editorPrepare).not.toHaveBeenCalled();
      finish(); await vi.waitFor(() => expect(f.editorPrepare).toHaveBeenCalledTimes(1));
    } finally { f.service.stop(); await running; }
    expect(f.close).toHaveBeenCalled();
  });
  it("prepares Whisper without the editor, and reports Phonon failure without taking the relay offline", async () => {
    const whisperPrepare = vi.fn().mockResolvedValue(undefined);
    const whisper = fixture("whisper", whisperPrepare);
    const whisperRun = whisper.service.run() as Promise<void>;
    try {
      await vi.waitFor(() => expect(whisper.cloudStart).toHaveBeenCalledTimes(1));
      expect(whisperPrepare).toHaveBeenCalledTimes(1); expect(whisper.editorPrepare).not.toHaveBeenCalled();
    } finally { whisper.service.stop(); await whisperRun; }
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const failedPrepare = vi.fn().mockRejectedValue(new Error("synthetic model unavailable"));
    const phonon = fixture("phonon", failedPrepare);
    const phononRun = phonon.service.run() as Promise<void>;
    try {
      await vi.waitFor(() => expect(phonon.cloudStart).toHaveBeenCalledTimes(1));
      expect(phonon.socket).toHaveBeenCalledTimes(1); expect(phonon.editorPrepare).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"message":"bridge.model.prepare_failed"'));
    } finally { phonon.service.stop(); await phononRun; errorLog.mockRestore(); }
  });
});
