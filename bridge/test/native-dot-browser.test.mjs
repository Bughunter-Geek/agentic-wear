import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

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

const controllerSource = await readFile(new URL('../../browser-receiver/extension/voice-controller.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../../browser-receiver/extension/content.js', import.meta.url), 'utf8');
const dotNamespace = 'fa24ed5a57dc8199b97f68f7d0098d11';
function controllerPage() {
  const dom = new JSDOM(`<main><button data-orbit-profile-trigger="true" aria-label="Open Lumen’s profile"></button>
    <article class="message-row" data-message-id="${dotNamespace}~${dotNamespace}~CalpicoMessage~Sentinel_${'a'.repeat(32)}">
      <div class="message-body">Previous reply<button data-action="reply">Reply</button></div></article>
    <div class="ProseMirror" contenteditable="true" aria-label="Message"></div><button aria-label="Start call"></button></main>`,
  { url: 'https://chatgpt.com/dots/home', runScripts: 'outside-only' });
  const observations = [], commands = []; let listener, clears = 0;
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  const clear = w.clearInterval.bind(w);
  w.clearInterval = id => { clears++; clear(id); };
  w.chrome = { runtime: { id: 'extension', sendMessage(value) { observations.push(value); return Promise.resolve(); },
    onMessage: { addListener(value) { listener = value; }, removeListener() { listener = null; } } } };
  w.postMessage = value => { commands.push(value.command); };
  const announce = available => w.dispatchEvent(new w.MessageEvent('message', { source: w, origin: w.location.origin,
    data: { type: 'aw.native.voice.event', event: { state: 'available', available } } }));
  w.eval(controllerSource);
  return { dom, w, observations, commands, announce, clears: () => clears,
    signal: command => listener(command, { id: 'extension' }, () => {}) };
}

test('controller teardown is idempotent, stops polling and cannot reschedule a retired observer', async () => {
  const f = controllerPage(); let changes = 0;
  try {
    const controller = f.w.AgenticWearVoiceController.create({ documentId: 'document', url: f.w.location.href,
      identity: () => dotNamespace, changed() { changes++; } });
    f.announce(false); assert.equal(changes, 0);
    f.announce(true); f.announce(true); assert.equal(changes, 1); assert.equal(controller.available(), true);
    controller.cancel(); assert.equal(controller.available(), true);
    const beforeStop = changes;
    controller.stop(); controller.stop(); f.announce(true);
    assert.equal(changes, beforeStop); assert.equal(f.clears(), 1); assert.equal(controller.available(), false);
    assert.equal(await controller.command({ documentId: 'document', url: f.w.location.href, action: 'start', expiresAt: Date.now() + 1000 }), false);
  } finally { f.dom.window.close(); }
});

test('native-host loss before the first ready signal cancels a call without disposing the receiver', async () => {
  const f = controllerPage();
  try {
    f.w.eval(contentSource); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.observations.at(-1).nativeVoice, false);
    f.signal({ kind: 'native-voice-lost' });
    f.announce(true); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.observations.at(-1).nativeVoice, true); assert.equal(f.clears(), 0);
    assert.equal(f.w.__agenticWearCloudReceiver.alive, true);
    f.w.__agenticWearCloudReceiver.stop(); assert.equal(f.clears(), 2);
  } finally { f.dom.window.close(); }
});

test('invalidating the extension retires both timers once and does not trigger a shutdown microtask loop', async () => {
  const f = controllerPage();
  try {
    f.w.eval(contentSource); f.announce(true); await new Promise(resolve => setImmediate(resolve));
    f.w.chrome.runtime.id = undefined;
    f.w.document.body.append(f.w.document.createElement('p'));
    await new Promise(resolve => setImmediate(resolve));
    const count = f.observations.length;
    assert.equal(f.w.__agenticWearCloudReceiver.alive, false); assert.equal(f.clears(), 2);
    f.w.__agenticWearCloudReceiver.stop(); f.announce(true);
    f.w.document.body.append(f.w.document.createElement('p'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.clears(), 2); assert.equal(f.observations.length, count);
  } finally { f.dom.window.close(); }
});

test('a cancelled startup cannot release the next Watch call when its promise settles', async () => {
  const f = controllerPage(); let clicks = 0;
  try {
    f.w.document.querySelector('[aria-label="Start call"]').onclick = () => { clicks++; };
    const controller = f.w.AgenticWearVoiceController.create({ documentId: 'document', url: f.w.location.href,
      identity: () => dotNamespace, changed() {} });
    f.announce(true);
    const start = callId => controller.command({ documentId: 'document', url: f.w.location.href,
      action: 'start', callId, threadId: 'dot:lumen', sdp: offer, expiresAt: Date.now() + 10000 });
    const old = start('old'); controller.cancel();
    f.w.postMessage = value => {
      f.commands.push(value.command);
      if (value.command.action === 'start') queueMicrotask(() => f.w.dispatchEvent(new f.w.MessageEvent('message', {
        source: f.w, origin: f.w.location.origin,
        data: { type: 'aw.native.voice.event', event: { state: 'accepted', callId: value.command.callId } },
      })));
    };
    const next = start('next');
    assert.equal(await old, false); assert.equal(await next, true); assert.equal(clicks, 1);
    assert.equal(await controller.command({ documentId: 'document', url: f.w.location.href,
      action: 'heartbeat', callId: 'next', expiresAt: Date.now() + 1000 }), true);
    assert.equal(await controller.command({ documentId: 'document', url: f.w.location.href,
      action: 'stop', callId: 'old', expiresAt: Date.now() + 1000 }), false);
    controller.stop(); assert.equal(f.commands.at(-1).callId, 'next');
  } finally { f.dom.window.close(); }
});
