import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function fixture() {
  const handlers = new Map(), events = [], tracks = [];
  let microphoneRequests = 0, localResumes = 0;
  const makeTrack = () => { const track = { kind: 'audio', stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return track; };
  const stream = () => { const track = makeTrack(); return { getTracks: () => [track], getAudioTracks: () => [track], clone: stream }; };
  class Context {
    createMediaStreamDestination() { return { stream: stream() }; }
    createMediaStreamSource() { return {}; }
    resume() { localResumes++; return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  class Peer extends EventTarget {
    state = 'new';
    get connectionState() { return this.state; }
    close() { this.state = 'closed'; }
  }
  const response = { ok: true, status: 200, privateBody: 'PRIVATE_RESPONSE' };
  const window = { RTCPeerConnection: Peer, AudioContext: Context,
    addEventListener(name, handler) { handlers.set(name, handler); }, postMessage(message) { events.push(message.event); },
    async fetch() { return response; } };
  const location = { href: 'https://chatgpt.com/dots/home', origin: 'https://chatgpt.com' };
  const sandbox = { window, location, Event, EventTarget, DOMException, URL, navigator: { mediaDevices: {
    getUserMedia() { microphoneRequests++; return Promise.resolve('physical'); } } },
    document: { body: null }, Date,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {} };
  vm.runInNewContext(await readFile(new URL('../../browser-receiver/extension/remote-peer.js', import.meta.url), 'utf8'), sandbox);
  vm.runInNewContext(await readFile(new URL('../../browser-receiver/extension/voice-hook.js', import.meta.url), 'utf8'), sandbox);
  const command = value => handlers.get('message')({ source: window, origin: location.origin,
    data: { type: 'aw.native.voice.command', command: value } });
  return { window, sandbox, command, events, tracks, response, microphoneRequests: () => microphoneRequests, localResumes: () => localResumes };
}
const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111';

test('delegated capture never opens the Mac mic and only its unused input graph is virtualized', async () => {
  const f = await fixture();
  assert.equal(await f.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }), 'physical');
  f.command({ action: 'start', callId: 'owned', sdp: offer, expiresAt: Date.now() + 45000 });
  const input = await f.sandbox.navigator.mediaDevices.getUserMedia({ audio: true });
  assert.equal(f.microphoneRequests(), 1);
  await assert.rejects(f.sandbox.navigator.mediaDevices.getUserMedia({ audio: true, video: true }), { name: 'NotAllowedError' });
  const graph = new f.window.AudioContext(); graph.createMediaStreamSource(input); await graph.resume();
  assert.equal(f.localResumes(), 0);
  const other = new f.window.AudioContext(); await other.resume();
  assert.equal(f.localResumes(), 1);
  f.command({ action: 'stop', callId: 'foreign' });
  assert.equal(f.events.filter(e => e.state === 'closed').length, 0);
  f.command({ action: 'stop', callId: 'owned' });
  assert.ok(f.tracks.every(track => track.stopped));
  await assert.rejects(graph.resume(), { name: 'AbortError' });
  assert.throws(() => other.createMediaStreamSource(input), { name: 'AbortError' });
  await f.sandbox.navigator.mediaDevices.getUserMedia({ audio: true });
  assert.equal(f.microphoneRequests(), 2);
});

test('native acceptance needs endpoint media and HTTP attachment; stale transport cannot change it', async () => {
  const f = await fixture();
  f.command({ action: 'start', callId: 'owned', sdp: offer, expiresAt: Date.now() + 45000 });
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  await peer.setLocalDescription(await peer.createOffer());
  await peer.setRemoteDescription({ type: 'answer', sdp: offer });
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 2, peerState: 'connected', iceState: 'connected', channelState: 'open' } });
  assert.equal(f.events.some(e => e.state === 'active'), false);
  const response = await f.window.fetch('/backend-api/tbo/PRIVATE_OWNER/voice/calls/PRIVATE_CALL/attach', { headers: { Authorization: 'PRIVATE_CREDENTIAL' } });
  assert.equal(response, f.response);
  assert.equal(f.events.filter(e => e.state === 'active').length, 1);
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 1, peerState: 'failed', iceState: 'failed', channelState: 'closed' } });
  assert.equal(peer.connectionState, 'connected');
  assert.equal(JSON.stringify(f.events).includes('PRIVATE_'), false);
  f.command({ action: 'stop', callId: 'owned' });
  assert.equal(peer.connectionState, 'closed');
});

test('an existing unrelated browser peer prevents reserving a Watch call', async () => {
  const f = await fixture();
  const personal = new f.window.RTCPeerConnection();
  f.command({ action: 'start', callId: 'watch', sdp: offer, expiresAt: Date.now() + 45000 });
  assert.equal(f.events.at(-1).state, 'failed');
  assert.equal(personal.connectionState, 'new');
});
