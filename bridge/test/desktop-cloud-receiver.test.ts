import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopCloudReceiver } from "../src/desktop-cloud-receiver.js";
import { DesktopCloudTransport } from "../src/desktop-cloud-adapter.js";
import { cloudEventId, desktopCloudPairBinding, desktopCloudSocketPath, readDesktopCloudConfig,
  type CloudTerminal, type DesktopCloudConfig } from "../src/desktop-cloud-protocol.js";

const pairing = { pairId: "test-pair", bridgePublicKey: "bridge-public", watchPublicKey: "watch-public" };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup(sendEnabled=false) {
  const directory = await mkdtemp("/tmp/aw-cloud-"); await chmod(directory, 0o700);
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "desktop-cloud.json");
  const config: DesktopCloudConfig = { version: 1, enabled: true, capability: "a".repeat(64), pairBinding: desktopCloudPairBinding(pairing),
    targets: [{ hostId: "durable", threadId: "cloud-1", title: "Cloud test",sendEnabled }], reconcileMs: 2_000 };
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  const delivered: CloudTerminal[] = [], snapshot = vi.fn(), log = vi.fn();
  const receiver = new DesktopCloudReceiver(pairing, async (event) => { delivered.push(event); }, snapshot, path, log);
  await receiver.start(); cleanup.push(() => receiver.close());
  return { directory, path, config, delivered, snapshot, log, receiver };
}
function terminal(turnId = "turn-1"): CloudTerminal {
  return { eventId: cloudEventId("cloud-1", turnId, "terminal.completed"), threadId: "cloud-1", turnId,
    kind: "terminal.completed", turnScope: "topLevel", title: "Cloud test", detail: "CLOUD WATCH TEST", occurredAt: Date.now(),
    nativeCompletedAt: Date.now(), observedAt: Date.now(), source: "notification" };
}
async function raw(path: string, config: DesktopCloudConfig, changes = {}) {
  const socket = createConnection(desktopCloudSocketPath(path));
  cleanup.push(async () => { socket.destroy(); });
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  const streamId = randomUUID();
  socket.write(`${JSON.stringify({ version: 1, kind: "hello", capability: config.capability, pairBinding: config.pairBinding, streamId, ...changes })}\n`);
  return { socket, streamId };
}
function waitClose(socket: Socket): Promise<void> { return new Promise((resolve) => { socket.on("error", () => {}); socket.once("close", () => resolve()); }); }

describe("private receive-only cloud boundary", () => {
  it("sends only on opted-in ready pages and waits for a matched browser result",async()=>{
    const h=await setup(true), onSend=vi.fn(async command=>({requestId:command.requestId,threadId:command.threadId,outcome:"accepted" as const,messageId:"posted",message:"Posted"}));
    const transport=new DesktopCloudTransport(h.config,desktopCloudSocketPath(h.path),vi.fn(),onSend);
    cleanup.push(async()=>{transport.close();});transport.start();
    await expect(h.receiver.submitText("cloud-1","before","hello")).rejects.toThrow("composer");
    transport.snapshot({threadId:"cloud-1",title:"Cloud",status:"idle",inputReady:true,messages:[]},Date.now());
    await vi.waitFor(()=>expect(h.receiver.sessions()[0]?.canAcceptDirectInput).toBe(true));
    await expect(h.receiver.submitText("cloud-1","request-1","Hello Lumen")).resolves.toMatchObject({outcome:"accepted",messageId:"posted"});
    expect(onSend).toHaveBeenCalledOnce();expect(onSend.mock.calls[0]?.[0]).toMatchObject({text:"Hello Lumen",threadId:"cloud-1"});
    transport.snapshot({threadId:"cloud-1",title:"Cloud",status:"idle",inputReady:false,messages:[]},Date.now());
    await vi.waitFor(()=>expect(h.receiver.sessions()[0]?.canAcceptDirectInput).toBe(false));
    await expect(h.receiver.submitText("cloud-1","draft","hello")).rejects.toThrow("composer");
  });
  it("reports uncertainty and never replays a send after socket loss",async()=>{
    const h=await setup(true),onSend=vi.fn(async command=>{transport.close();return {requestId:command.requestId,threadId:command.threadId,outcome:"accepted" as const,message:"lost"};});
    const transport=new DesktopCloudTransport(h.config,desktopCloudSocketPath(h.path),vi.fn(),onSend);cleanup.push(async()=>{transport.close();});transport.start();
    transport.snapshot({threadId:"cloud-1",title:"Cloud",status:"idle",inputReady:true,messages:[]},Date.now());
    await vi.waitFor(()=>expect(h.receiver.sessions()[0]?.canAcceptDirectInput).toBe(true));
    await expect(h.receiver.submitText("cloud-1","request-2","hello")).rejects.toThrow("uncertain");expect(onSend).toHaveBeenCalledOnce();
  });
  it("delivers promptly through a real Unix socket and deduplicates terminal retries across a bridge restart", async () => {
    const h = await setup(), transport = new DesktopCloudTransport(h.config, desktopCloudSocketPath(h.path), vi.fn());
    cleanup.push(async () => { transport.close(); }); transport.start();
    const event = terminal(), start = performance.now(); transport.terminal(event);
    await vi.waitFor(() => expect(h.delivered).toHaveLength(1));
    expect(performance.now() - start).toBeLessThan(1_000);
    await vi.waitFor(async () => expect(JSON.parse(await readFile(`${h.path}.receipts`, "utf8")).eventIds).toContain(event.eventId));
    transport.terminal(event);
    await vi.waitFor(() => expect(h.log).toHaveBeenCalledWith("terminal_relayed", expect.anything()));
    transport.close(); await h.receiver.close();
    const onTerminal = vi.fn().mockResolvedValue(undefined), restartedLog = vi.fn();
    const restarted = new DesktopCloudReceiver(pairing, onTerminal, vi.fn(), h.path, restartedLog);
    await restarted.start(); cleanup.push(() => restarted.close());
    const second = new DesktopCloudTransport(h.config, desktopCloudSocketPath(h.path), vi.fn());
    second.terminal(event); second.start(); cleanup.push(async () => { second.close(); });
    await vi.waitFor(() => expect(restartedLog).toHaveBeenCalledWith("terminal_duplicate", { eventId: event.eventId }));
    expect(onTerminal).not.toHaveBeenCalled(); expect(h.delivered).toHaveLength(1);
    expect((await stat(desktopCloudSocketPath(h.path))).mode & 0o777).toBe(0o600);
  });
  it("rejects an incorrect local capability and never accepts an outbound command", async () => {
    const h = await setup();
    const denied = await raw(h.path, h.config, { capability: "c".repeat(64) });
    await waitClose(denied.socket);
    const command = await raw(h.path, h.config);
    command.socket.write(`${JSON.stringify({ version: 1, id: "send", streamId: command.streamId, kind: "turn.submit", text: "must not send" })}\n`);
    await waitClose(command.socket); expect(h.delivered).toHaveLength(0);
  });
  it("rejects another chat, retired streams, stale alerts and oversized frames", async () => {
    const h = await setup();
    for (const change of ["thread", "stream", "oversize"]) {
      const wire = await raw(h.path, h.config), event = terminal();
      const payload = { version: 1, kind: "terminal", id: event.eventId, streamId: change === "stream" ? randomUUID() : wire.streamId,
        event: { ...event, threadId: change === "thread" ? "not-allowed" : event.threadId } };
      wire.socket.write(change === "oversize" ? "x".repeat(300_000) : `${JSON.stringify(payload)}\n`);
      await waitClose(wire.socket);
    }
    const transport = new DesktopCloudTransport(h.config, desktopCloudSocketPath(h.path), vi.fn());
    transport.start(); transport.terminal({ ...terminal(), observedAt: Date.now() - 120_000 });
    cleanup.push(async () => { transport.close(); });
    expect(h.delivered).toHaveLength(0);
  });
  it("exposes read-only sessions, caches chat snapshots and survives missing desktop state", async () => {
    const h = await setup(), transport = new DesktopCloudTransport(h.config, desktopCloudSocketPath(h.path), vi.fn());
    cleanup.push(async () => { transport.close(); }); transport.start();
    expect(h.receiver.owns("cloud-1")).toBe(true);
    expect(h.receiver.snapshot("cloud-1").status).toBe("notLoaded");
    transport.snapshot({ threadId: "cloud-1", title: "Cloud test", status: "idle", messages: [] }, Date.now());
    await vi.waitFor(() => expect(h.snapshot).toHaveBeenCalledWith("cloud-1"));
    expect(h.receiver.sessions()[0]).toMatchObject({ status: "idle", canAcceptDirectInput: false, watchReady: false });
    transport.reset();
    await vi.waitFor(() => expect(h.receiver.snapshot("cloud-1").status).toBe("notLoaded"));
  });
  it("fails closed on public configuration permissions or a changed watch pairing", async () => {
    const h = await setup(); await chmod(h.path, 0o644);
    await expect(readDesktopCloudConfig(h.path)).rejects.toThrow("private");
    await chmod(h.path, 0o600); await h.receiver.close();
    const wrongPair = new DesktopCloudReceiver({ ...pairing, watchPublicKey: "replacement-watch" }, vi.fn(), vi.fn(), h.path, vi.fn());
    await wrongPair.start(); cleanup.push(() => wrongPair.close());
    expect(wrongPair.owns("cloud-1")).toBe(true);
    expect(wrongPair.sessions()[0]?.status).toBe("notLoaded");
    await expect(stat(desktopCloudSocketPath(h.path))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
