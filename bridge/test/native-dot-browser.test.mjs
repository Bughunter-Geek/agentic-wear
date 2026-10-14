import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

async function fixture({ workletPostFailure = false, targetUrl = 'https://chatgpt.com/dots/home', physicalStream = false } = {}) {
  const handlers = new Map(), events = [], tracks = [], requests = [], responses = [], controls = [], timers = [];
  let microphoneRequests = 0, localResumes = 0, fetches = 0, now = 100;
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.closed = false; observers.push(this); }
    observe(options) { assert.equal(JSON.stringify(options), '{"entryTypes":["resource"]}'); }
    disconnect() { this.closed = true; }
  }
  const makeTrack = () => { const track = { kind: 'audio', stopped: false, get readyState() { return this.stopped ? 'ended' : 'live'; }, stop() { this.stopped = true; } }; tracks.push(track); return track; };
  const stream = () => { const track = makeTrack(); return { getTracks: () => [track], getAudioTracks: () => [track], clone: stream }; };
  class Context {
    createMediaStreamDestination() { return { stream: stream() }; }
    createMediaStreamSource() { return {}; }
    resume() { localResumes++; return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  class Worklet {
    constructor(context, name) {
      this.context = context; this.name = name; this.messages = [];
      this.port = { postMessage: (...values) => {
        if (workletPostFailure && values[0]?.type === 'release') throw new DOMException('Port rejected the message', 'DataCloneError');
        this.messages.push(values);
      } };
    }
  }
  class Peer extends EventTarget {
    state = 'new';
    iceConnectionState = 'new'; signalingState = 'stable'; remoteDescription = null; senders = []; offers = 0;
    get connectionState() { return this.state; }
    getSenders() { return this.senders; }
    async createOffer() { this.offers++; return { type: 'offer', sdp: offer }; }
    close() { this.state = 'closed'; }
  }
  const response = { ok: true, status: 200, privateBody: 'PRIVATE_RESPONSE' };
  const window = { RTCPeerConnection: Peer, AudioContext: Context, AudioWorkletNode: Worklet, Request, PerformanceObserver: Observer, performance: { now: () => now },
    setTimeout(callback, delay, ...args) { const timer = { callback, delay, args, due: now + delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cleared = true; },
    addEventListener(name, handler) { handlers.set(name, handler); }, postMessage(message) { events.push(message.event); },
    async fetch(...args) { fetches++; requests.push(args); const next = responses.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(...args) : next || response; } };
  const location = { href: targetUrl, origin: 'https://chatgpt.com' };
  const sandbox = { window, location, Event, EventTarget, DOMException, URL, TextDecoder, navigator: { mediaDevices: {
    getUserMedia() { microphoneRequests++; return Promise.resolve(physicalStream ? stream() : 'physical'); } } },
    document: { body: null, querySelectorAll: () => controls }, Date,
    setInterval: () => 1, clearInterval() {}, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout };
  vm.runInNewContext(await readFile(new URL('../../browser-receiver/extension/remote-peer.js', import.meta.url), 'utf8'), sandbox);
  vm.runInNewContext(await readFile(new URL('../../browser-receiver/extension/voice-timing.js', import.meta.url), 'utf8'), sandbox);
  vm.runInNewContext(await readFile(new URL('../../browser-receiver/extension/native-allocation.js', import.meta.url), 'utf8'), sandbox);
  vm.runInNewContext(await readFile(new URL('../../browser-receiver/extension/voice-hook.js', import.meta.url), 'utf8'), sandbox);
  const command = value => handlers.get('message')({ source: window, origin: location.origin,
    data: { type: 'aw.native.voice.command', command: value } });
  return { window, sandbox, command, events, tracks, response, requests, responses, controls,
    click: (label, isTrusted = true) => handlers.get('click')({ isTrusted, target: { closest: () => ({ getAttribute: () => label }) } }),
    microphoneRequests: () => microphoneRequests, localResumes: () => localResumes,
    fetches: () => fetches, advance: ms => { now += ms; }, observers, timers,
    tick(ms) { now += ms; for (const timer of timers.filter(t => !t.cleared && t.due <= now).sort((a, b) => a.due - b.due)) {
      timer.cleared = true; timer.callback(...timer.args);
    } },
    resource(entry, observer = observers.at(-1)) { observer.callback({ getEntries: () => [entry] }); } };
}
const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111';
async function nativeInput(f, name = 'codex-realtime-buffered-audio') {
  const input = await f.sandbox.navigator.mediaDevices.getUserMedia({ audio: true });
  const graph = new f.window.AudioContext(); graph.createMediaStreamSource(input);
  return new f.window.AudioWorkletNode(graph, name);
}

test('delegated capture never opens the Mac mic and only its unused input graph is virtualized', async () => {
  const f = await fixture();
  assert.equal(await f.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }), 'physical');
  f.command({ action: 'start', callId: 'owned', sdp: offer, expiresAt: Date.now() + 45000 });
  const input = await f.sandbox.navigator.mediaDevices.getUserMedia({ audio: true });
  assert.equal(f.microphoneRequests(), 1);
  assert.equal(f.events.find(e => e.state === 'progress').progressStage, 'capture');
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

test('native acceptance follows the native input release after real media/channel and attachment dispatch', async () => {
  const f = await fixture();
  f.command({ action: 'start', callId: 'owned', sdp: offer, expiresAt: Date.now() + 45000 });
  const input = await nativeInput(f);
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  assert.equal(f.events.find(e => e.progressStage === 'peer').state, 'progress');
  await peer.setLocalDescription(await peer.createOffer());
  const applied = peer.setRemoteDescription({ type: 'answer', sdp: offer });
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 2, peerState: 'connected', iceState: 'connected', channelState: 'open' } });
  await applied;
  assert.equal(f.events.some(e => e.state === 'active'), false);
  const response = await f.window.fetch('/backend-api/tbo/PRIVATE_OWNER/voice/calls/PRIVATE_CALL/attach', { method: 'POST', headers: { Authorization: 'PRIVATE_CREDENTIAL' } });
  assert.equal(response, f.response);
  assert.equal(f.events.some(e => e.state === 'active'), false, 'HTTP success does not replace native input release');
  input.port.postMessage({ type: 'release' });
  assert.equal(f.events.filter(e => e.state === 'active').length, 1);
  const timing = f.events.find(e => e.state === 'active');
  assert.equal(Number.isInteger(timing.elapsedMs), true);
  for (const key of ['peerMs', 'attachStartMs', 'attachEndMs']) assert.equal(Number.isInteger(timing.setupTiming[key]), true);
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

test('a selected Dot defers silent native prewarming through the native offer cancellation path', async () => {
  const f = await fixture(); f.command({ action: 'query', disableIdlePreparation: true });
  const cached = new f.window.RTCPeerConnection();
  // Native preparation retires its transport when offer creation rejects.
  const preparation = cached.createOffer().catch(error => { cached.close(); throw error; });
  await assert.rejects(preparation, { name: 'AbortError' });
  assert.equal(cached.offers, 0); assert.equal(cached.connectionState, 'closed');
  f.command({ action: 'start', callId: 'watch', sdp: offer, expiresAt: Date.now() + 45000 });
  assert.equal(f.events.at(-1).state, 'accepted'); assert.equal(f.microphoneRequests(), 0);
});
test('verified selection can arrive after a native idle offer begins', async () => {
  const f = await fixture(); const cached = new f.window.RTCPeerConnection();
  const preparation = cached.createOffer().catch(error => { cached.close(); throw error; });
  f.command({ action: 'query', disableIdlePreparation: true });
  await assert.rejects(preparation, { name: 'AbortError' }); assert.equal(cached.offers, 0);
});
test('unselected Dot preparation resumes at its bounded deadline', async () => {
  const f = await fixture(); const cached = new f.window.RTCPeerConnection();
  const preparation = cached.createOffer(); f.tick(1000);
  assert.equal((await preparation).sdp, offer); assert.equal(cached.offers, 1);
});
test('a personal call beginning during selection discovery keeps its native offer', async () => {
  const f = await fixture(); const personal = new f.window.RTCPeerConnection(); const pending = personal.createOffer();
  f.controls.push({ isConnected: true, getAttribute: () => 'Hang up', getClientRects: () => [{}] });
  f.command({ action: 'query', disableIdlePreparation: true });
  assert.equal((await pending).sdp, offer); assert.equal(personal.offers, 1);
});
test('a trusted personal Start call is preserved even before its Hang up control renders', async () => {
  const f = await fixture(); f.command({ action: 'query', disableIdlePreparation: true }); f.click('Start call');
  const personal = new f.window.RTCPeerConnection(); assert.equal((await personal.createOffer()).sdp, offer);
  f.click('Hang up'); personal.close(); const cached = new f.window.RTCPeerConnection();
  await assert.rejects(cached.createOffer(), { name: 'AbortError' }); cached.close();
});
test('synthetic Start call clicks do not masquerade as a personal call', async () => {
  const f = await fixture(); f.command({ action: 'query', disableIdlePreparation: true }); f.click('Start call', false);
  const cached = new f.window.RTCPeerConnection(); await assert.rejects(cached.createOffer(), { name: 'AbortError' }); cached.close();
});
test('personal microphone input, a remote answer and an active transport cannot be deferred', async () => {
  for (const state of ['microphone', 'answer', 'connected', 'sender']) {
    const f = await fixture({ physicalStream: state === 'microphone' });
    f.command({ action: 'query', disableIdlePreparation: true });
    if (state === 'microphone') await f.sandbox.navigator.mediaDevices.getUserMedia({ audio: true });
    const personal = new f.window.RTCPeerConnection();
    if (state === 'answer') personal.remoteDescription = { type: 'answer', sdp: offer };
    if (state === 'connected') personal.state = 'connected';
    if (state === 'sender') personal.senders = [{ track: { kind: 'audio', readyState: 'live' } }];
    assert.equal((await personal.createOffer()).sdp, offer, state);
    assert.equal(personal.offers, 1, state); assert.notEqual(personal.connectionState, 'closed', state);
    f.command({ action: 'start', callId: 'watch', sdp: offer, expiresAt: Date.now() + 45000 });
    assert.equal(f.events.at(-1).state, 'failed', state);
  }
});
test('the Dot preparation policy never affects native cloud chat offers', async () => {
  const f = await fixture({ targetUrl: 'https://chatgpt.com/local/11111111-1111-4111-8111-111111111111' });
  f.command({ action: 'query', disableIdlePreparation: true }); const peer = new f.window.RTCPeerConnection();
  assert.equal((await peer.createOffer()).sdp, offer); assert.equal(peer.offers, 1);
});

const createUrl = 'https://chatgpt.com/backend-api/tbo/PRIVATE_OWNER/voice/calls';
function resource(name = createUrl, overrides = {}) {
  return { name, entryType: 'resource', initiatorType: 'fetch', startTime: 100, fetchStart: 100,
    duration: 16000, domainLookupStart: 110, domainLookupEnd: 130, connectStart: 130, connectEnd: 400,
    secureConnectionStart: 200, requestStart: 450, responseStart: 16080, responseEnd: 16100,
    workerStart: 0, serverTiming: [{ name: 'PRIVATE_NAME', description: 'PRIVATE_DESCRIPTION' }], ...overrides };
}
test('HTTP timings distinguish queue, connection and response waits without extra requests or private data', async () => {
  const f = await fixture();
  f.command({ action: 'start', callId: 'owned', sdp: offer, expiresAt: Date.now() + 45000 });
  f.response.headers = { get(key) { assert.equal(key, 'x-envoy-upstream-service-time'); return '15000.4'; } };
  await f.window.fetch(createUrl, { body: 'PRIVATE_SDP', headers: { Authorization: 'PRIVATE_CREDENTIAL' } });
  f.resource(resource('https://other.example/voice/calls'));
  f.resource(resource(createUrl, { startTime: 99 }));
  assert.equal(f.events.some(e => e.state === 'timing'), false);
  f.resource(resource());
  const timings = f.events.filter(e => e.state === 'timing');
  assert.equal(timings.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(timings[0].httpTiming)), { phase: 'create', totalMs: 16000,
    dnsMs: 20, connectMs: 270, tlsMs: 200, responseWaitMs: 15630, downloadMs: 20, serverMs: 15000, queueMs: 60,
    allocationMode: 'unchanged', statusCode: 200 });
  assert.equal(JSON.stringify(f.events).includes('PRIVATE_'), false);
  f.resource(resource());
  assert.equal(f.events.filter(e => e.state === 'timing').length, 1);
  assert.equal(f.fetches(), 1); assert.equal(f.microphoneRequests(), 0);
  assert.equal(f.events.some(e => e.state === 'active'), false);
});
test('timing cleanup rejects old call entries, zero timestamps stay unknown, and absent server duration is not zero', async () => {
  const f = await fixture();
  f.command({ action: 'start', callId: 'old', sdp: offer, expiresAt: Date.now() + 45000 });
  await f.window.fetch(createUrl); const oldObserver = f.observers.at(-1);
  f.command({ action: 'stop', callId: 'old' });
  assert.equal(oldObserver.closed, true);
  f.advance(200);
  f.command({ action: 'start', callId: 'next', sdp: offer, expiresAt: Date.now() + 45000 });
  await f.window.fetch(createUrl);
  f.resource(resource(), oldObserver);
  f.resource(resource(createUrl, { startTime: 300, duration: 20, fetchStart: 0, domainLookupStart: 0,
    domainLookupEnd: 0, connectStart: 0, connectEnd: 0, secureConnectionStart: 0, requestStart: 0, responseStart: 0, responseEnd: 0 }));
  const timing = f.events.find(e => e.state === 'timing');
  assert.equal(timing.callId, 'next');
  assert.deepEqual(JSON.parse(JSON.stringify(timing.httpTiming)), { phase: 'create', totalMs: 20, allocationMode: 'unchanged', statusCode: 200 });
  assert.equal(f.fetches(), 2);
});
test('an observer completion before fetch resolves waits for the response metadata', async () => {
  const f = await fixture();
  f.command({ action: 'start', callId: 'owned', sdp: offer, expiresAt: Date.now() + 45000 });
  let finish;
  f.responses.push(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.window.fetch(createUrl);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  f.resource(resource());
  assert.equal(f.events.some(e => e.state === 'timing'), false);
  finish(f.response);
  await pending;
  assert.equal(f.events.filter(e => e.state === 'timing').length, 1);
});

const startOwned = f => f.command({ action: 'start', callId: 'owned', sdp: offer, expiresAt: Date.now() + 45000 });
test('native attachment waits for a delayed Watch to install its answer', async () => {
  const f = await fixture(); startOwned(f);
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  await peer.setLocalDescription(await peer.createOffer());
  let watchApplied = false;
  const init = { method: 'POST', headers: { Authorization: 'PRIVATE_CREDENTIAL' } };
  f.responses.push(() => watchApplied ? f.response : new Response('', { status: 502 }));
  const startup = (async () => {
    await peer.setRemoteDescription({ type: 'answer', sdp: offer });
    return f.window.fetch(createUrl + '/PRIVATE_CALL/attach', init);
  })();
  await new Promise(setImmediate);
  assert.equal(f.events.filter(e => e.state === 'answer').length, 1);
  assert.equal(peer.currentRemoteDescription, null);
  assert.equal(peer.pendingRemoteDescription.sdp, offer);
  assert.equal(peer.signalingState, 'have-local-offer');
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 1, peerState: 'new', iceState: 'new', channelState: 'connecting' } });
  f.advance(6000); await new Promise(setImmediate);
  assert.equal(f.requests.length, 0, 'forwarding the SDP must not start the backend attachment budget');
  watchApplied = true;
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 2, peerState: 'connecting', iceState: 'checking', channelState: 'connecting' } });
  assert.equal(await startup, f.response);
  assert.equal(peer.currentRemoteDescription.sdp, offer);
  assert.equal(peer.pendingRemoteDescription, null);
  assert.equal(peer.signalingState, 'stable');
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0][1], init);
  assert.equal(f.events.some(e => e.state === 'active'), false, 'SDP application does not prove usable voice');
  assert.equal(f.microphoneRequests(), 0);
});
test('foreign, stale or pre-answer transport cannot complete the pending native SDP operation', async () => {
  const f = await fixture(); startOwned(f);
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  await peer.setLocalDescription(await peer.createOffer());
  const applied = peer.setRemoteDescription({ type: 'answer', sdp: offer });
  let complete = false; applied.then(() => { complete = true; });
  const connected = { seq: 1, peerState: 'connected', iceState: 'completed', channelState: 'open' };
  f.command({ action: 'transport', callId: 'foreign', transport: connected });
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 2, peerState: 'connecting', iceState: 'new', channelState: 'connecting' } });
  f.command({ action: 'transport', callId: 'owned', transport: connected });
  await new Promise(setImmediate); assert.equal(complete, false);
  await assert.rejects(peer.setRemoteDescription({ type: 'answer', sdp: offer }), { name: 'TypeError' });
  f.command({ action: 'transport', callId: 'owned', transport: { ...connected, seq: 3 } });
  await applied; assert.equal(complete, true);
});
test('stop, transport failure and the finite startup deadline reject pending SDP without attaching', async () => {
  for (const ending of ['stop', 'failed', 'deadline']) {
    const f = await fixture(); startOwned(f);
    const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
    await peer.setLocalDescription(await peer.createOffer());
    const startup = (async () => {
      await peer.setRemoteDescription({ type: 'answer', sdp: offer });
      return f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
    })();
    const rejected = assert.rejects(startup, { name: 'AbortError' });
    if (ending === 'deadline') f.tick(30000);
    else if (ending === 'failed') f.command({ action: 'transport', callId: 'owned', transport: { seq: 1, peerState: 'failed', iceState: 'failed', channelState: 'connecting' } });
    else f.command({ action: 'stop', callId: 'owned' });
    await rejected;
    f.command({ action: 'transport', callId: 'owned', transport: { seq: 2, peerState: 'connected', iceState: 'completed', channelState: 'open' } });
    assert.equal(f.requests.length, 0); assert.equal(peer.connectionState, 'closed');
    assert.equal(peer.pendingRemoteDescription, null);
  }
});
test('cancellation during the applied-answer callback cannot attach the retired native call', async () => {
  const f = await fixture(); startOwned(f);
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  await peer.setLocalDescription(await peer.createOffer());
  peer.addEventListener('signalingstatechange', () => {
    if (peer.signalingState === 'stable') f.command({ action: 'stop', callId: 'owned' });
  });
  const startup = (async () => {
    await peer.setRemoteDescription({ type: 'answer', sdp: offer });
    return f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
  })();
  const rejected = assert.rejects(startup, { name: 'AbortError' });
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 1, peerState: 'connecting', iceState: 'checking', channelState: 'connecting' } });
  await rejected;
  assert.equal(f.requests.length, 0); assert.equal(peer.connectionState, 'closed');
});
test('native startup can attach after 20 seconds without prematurely ending the connected Watch media', async () => {
  const f = await fixture(); startOwned(f);
  const input = await nativeInput(f);
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  await peer.setLocalDescription(await peer.createOffer());
  let complete, timer;
  const startup = Promise.race([new Promise(resolve => { complete = resolve; }), new Promise((_, reject) => {
    timer = f.window.setTimeout(() => reject(Error('Your dot’s voice connection timed out')), 20000);
  })]).finally(() => f.window.clearTimeout(timer));
  f.tick(17000); const applied = peer.setRemoteDescription({ type: 'answer', sdp: offer });
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 1, peerState: 'connected', iceState: 'connected', channelState: 'open' } });
  await applied;
  f.tick(4000);
  assert.equal(f.events.some(e => e.state === 'active'), false, 'media alone still cannot release Watch input');
  await f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
  input.port.postMessage({ type: 'release' });
  complete(); await startup;
  assert.equal(f.events.filter(e => e.state === 'active').length, 1);
  assert.equal(peer.connectionState, 'connected');
  f.tick(15000); assert.equal(peer.connectionState, 'connected');
  f.command({ action: 'stop', callId: 'owned' }); assert.equal(peer.connectionState, 'closed');
  assert.equal(f.microphoneRequests(), 0);
});
test('an owned native startup that never completes still fails at a finite deadline', async () => {
  const f = await fixture(); startOwned(f); new f.window.RTCPeerConnection();
  const startup = new Promise((_, reject) => {
    f.window.setTimeout(() => reject(Error('Your dot’s voice connection timed out')), 20000);
  });
  f.tick(30000);
  await assert.rejects(startup, /Your dot’s voice connection timed out/);
  f.command({ action: 'stop', callId: 'owned' }); assert.ok(f.tracks.every(track => track.stopped));
});
test('personal calls and unrelated browser timers keep their native deadline and arguments', async () => {
  const f = await fixture(); const timeout = () => Error('Your dot’s voice connection timed out');
  assert.equal(f.window.setTimeout(timeout, 20000).delay, 20000);
  startOwned(f);
  assert.equal(f.window.setTimeout(timeout, 20000).delay, 20000, 'a reservation without native media is insufficient');
  new f.window.RTCPeerConnection();
  const unrelated = () => Error('An unrelated operation timed out');
  const timer = f.window.setTimeout(unrelated, 20000, 'argument');
  assert.equal(timer.delay, 20000); assert.deepEqual(timer.args, ['argument']);
  assert.equal(f.window.setTimeout(timeout, 5000).delay, 5000);
  f.command({ action: 'stop', callId: 'owned' });
  assert.equal(f.window.setTimeout(timeout, 20000).delay, 20000);
});
test('an ended native startup is cancelled before a peer exists and recursive closure is harmless', async () => {
  const f = await fixture(); let cancelled = 0;
  f.controls.push({ isConnected: true, disabled: false, getAttribute: () => 'Hang up', click() {
    cancelled++; f.command({ action: 'stop', callId: 'owned' });
  } });
  startOwned(f); f.command({ action: 'control', callId: 'owned' });
  f.command({ action: 'stop', callId: 'owned' });
  assert.equal(cancelled, 1); assert.equal(f.events.filter(e => e.state === 'closed').length, 1);
  assert.equal(f.microphoneRequests(), 0); assert.ok(f.tracks.every(track => track.stopped));
});
test('a stale stop cannot click the native control of a newer call', async () => {
  const f = await fixture(); let cancelled = 0;
  const hangup = { isConnected: true, disabled: false, getAttribute: () => 'Hang up', click() { cancelled++; } };
  f.controls.push(hangup);
  startOwned(f); f.command({ action: 'stop', callId: 'owned' });
  assert.equal(cancelled, 0, 'reservation alone must not cancel a native call');
  f.command({ action: 'start', callId: 'next', sdp: offer, expiresAt: Date.now() + 45000 });
  f.command({ action: 'control', callId: 'next' });
  f.command({ action: 'stop', callId: 'owned' });
  assert.equal(cancelled, 0);
  f.command({ action: 'stop', callId: 'next' }); assert.equal(cancelled, 1);
});
test('native cancellation exceptions still release every owned media resource', async () => {
  const f = await fixture(); startOwned(f);
  await f.sandbox.navigator.mediaDevices.getUserMedia({ audio: true });
  const peer = new f.window.RTCPeerConnection();
  f.controls.push({ isConnected: true, disabled: false, getAttribute: () => 'Hang up', click() { throw new Error('fixture native stop failure'); } });
  assert.throws(() => f.command({ action: 'stop', callId: 'owned' }), /fixture native stop failure/);
  assert.equal(peer.connectionState, 'closed'); assert.ok(f.tracks.every(track => track.stopped));
  assert.equal(f.events.filter(e => e.state === 'closed').length, 1);
});
test('failed previous-call cleanup is reported instead of silently waiting for capture', async () => {
  const f = await fixture(); startOwned(f);
  const response = new Response('', { status: 503 }); f.responses.push(response);
  assert.equal(await f.window.fetch(createUrl + '/PRIVATE_CALL/stop', { method: 'POST' }), response);
  assert.equal(f.events.find(e => e.state === 'progress').progressStage, 'cleanup');
  assert.equal(f.events.at(-1).statusCode, 503);
  assert.equal(f.fetches(), 1); assert.equal(f.microphoneRequests(), 0);
});
const createInit = () => ({ method: 'POST', body: JSON.stringify({ sdp: offer, debug_prompt_overrides: { fixture: true } }),
  headers: { Authorization: 'PRIVATE_CREDENTIAL', 'ChatGPT-Account-Id': 'PRIVATE_ACCOUNT' }, credentials: 'include' });
test('the requested Watch allocation preserves the native direct-call mode, SDP and authentication', async () => {
  const f = await fixture(); startOwned(f);
  const init = createInit(), originalBody = init.body;
  const response = await f.window.fetch(createUrl, init);
  assert.equal(response, f.response); assert.equal(f.requests.length, 1);
  const body = JSON.parse(f.requests[0][1].body);
  assert.deepEqual(body, JSON.parse(originalBody));
  assert.equal(f.requests[0][1], init);
  assert.equal(f.requests[0][1].headers, init.headers);
  assert.equal(f.requests[0][1].credentials, init.credentials); assert.equal(init.body, originalBody);
  f.resource(resource());
  assert.equal(f.events.find(e => e.state === 'timing').httpTiming.allocationMode, 'standard');
  assert.equal(f.events.some(e => e.state === 'active'), false);
  assert.equal(f.microphoneRequests(), 0);
  assert.equal(JSON.stringify(f.events).includes('PRIVATE_'), false);
});
test('Request bodies stay unconsumed and native direct-call errors cannot cause another allocation', async () => {
  const f = await fixture(); startOwned(f);
  const input = new Request(createUrl, createInit());
  const denied = new Response(JSON.stringify({ detail: "Your dot's voice task is still active" }), { status: 409 });
  f.responses.push(denied);
  assert.equal(await f.window.fetch(input), denied);
  assert.equal(f.requests.length, 1); assert.equal(input.bodyUsed, false);
  assert.equal(f.requests[0][0], input);
  assert.deepEqual(JSON.parse(await input.clone().text()), JSON.parse(createInit().body));
  assert.equal(f.requests[0][0].headers.get('Authorization'), 'PRIVATE_CREDENTIAL');
  assert.equal(f.events.at(-1).state, 'failed');
  assert.equal(f.events.at(-1).statusCode, 409);
});
test('an explicitly selected native preparation mode is preserved without rewriting or fallback', async () => {
  const f = await fixture(); startOwned(f);
  const native = await nativeInput(f);
  const init = { ...createInit(), body: JSON.stringify({ sdp: offer, instant_connect: true }) };
  await f.window.fetch(createUrl, init);
  assert.equal(f.requests[0][1], init);
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  await peer.setLocalDescription(await peer.createOffer());
  const applied = peer.setRemoteDescription({ type: 'answer', sdp: offer });
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 1, peerState: 'connected', iceState: 'connected', channelState: 'open' } });
  await applied;
  assert.equal(f.events.some(e => e.state === 'active'), false);
  await f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
  native.port.postMessage({ type: 'release' });
  assert.equal(f.events.find(e => e.state === 'active').allocationMode, 'instant');
});

async function endpoint(f, channelState = 'open') {
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  await peer.setLocalDescription(await peer.createOffer());
  const applied = peer.setRemoteDescription({ type: 'answer', sdp: offer });
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 1, peerState: 'connected', iceState: 'connected', channelState } });
  await applied;
  return peer;
}
test('native input release overlaps pending attachment without inventing media or channel readiness', async () => {
  const f = await fixture(); startOwned(f);
  const input = await nativeInput(f); await endpoint(f, 'connecting');
  let finish;
  f.responses.push(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
  input.port.postMessage({ type: 'release' });
  assert.equal(f.events.some(e => e.state === 'active'), false, 'connected media does not prove channel readiness');
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 2, peerState: 'connected', iceState: 'completed', channelState: 'open' } });
  const ready = f.events.filter(e => e.state === 'active');
  assert.equal(ready.length, 1);
  assert.equal(Number.isInteger(ready[0].setupTiming.attachStartMs), true);
  assert.equal(ready[0].setupTiming.attachEndMs, undefined, 'attachment HTTP result remains pending');
  assert.equal(f.requests.length, 1); assert.equal(f.microphoneRequests(), 0);
  f.advance(3119); finish(f.response); assert.equal(await pending, f.response);
  input.port.postMessage({ type: 'release' });
  assert.equal(f.events.filter(e => e.state === 'active').length, 1);
  f.tick(30000); assert.equal(f.events.some(e => e.state === 'failed'), false);
});
test('native policy that withholds input until attachment remains authoritative', async () => {
  const f = await fixture(); startOwned(f);
  const input = await nativeInput(f); await endpoint(f);
  let finish;
  f.responses.push(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
  f.advance(3119); assert.equal(f.events.some(e => e.state === 'active'), false);
  finish(f.response); await pending;
  assert.equal(f.events.some(e => e.state === 'active'), false);
  input.port.postMessage({ type: 'release' });
  assert.equal(f.events.filter(e => e.state === 'active').length, 1);
});
test('personal graphs, unknown processors, non-release messages and stale owned releases cannot activate a call', async () => {
  const f = await fixture();
  const personal = new f.window.AudioWorkletNode(new f.window.AudioContext(), 'codex-realtime-buffered-audio');
  startOwned(f); const input = await nativeInput(f), unknown = await nativeInput(f, 'another-processor');
  await endpoint(f); await f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
  personal.port.postMessage({ type: 'release' }); unknown.port.postMessage({ type: 'release' });
  input.port.postMessage.call(personal.port, { type: 'release' });
  input.port.postMessage({ type: 'mute', muted: false }); input.port.postMessage({ type: 'release', extra: true });
  assert.equal(f.events.some(e => e.state === 'active'), false);
  f.command({ action: 'stop', callId: 'owned' });
  startOwned(f); const current = await nativeInput(f); await endpoint(f);
  await f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
  input.port.postMessage({ type: 'release' }); assert.equal(f.events.some(e => e.state === 'active'), false);
  current.port.postMessage({ type: 'release' }); assert.equal(f.events.filter(e => e.state === 'active').length, 1);
});
test('a native release rejected by its port cannot announce readiness', async () => {
  const f = await fixture({ workletPostFailure: true }); startOwned(f);
  const input = await nativeInput(f); await endpoint(f);
  await f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
  assert.throws(() => input.port.postMessage({ type: 'release' }), { name: 'DataCloneError' });
  assert.equal(f.events.some(e => e.state === 'active'), false);
});
test('attachment failure after native activation still propagates and cannot release a later call', async () => {
  for (const result of [new Response('', { status: 503 }), new TypeError('network unavailable')]) {
    const f = await fixture(); startOwned(f);
    const input = await nativeInput(f); await endpoint(f);
    let finish, fail;
    f.responses.push(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const pending = f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
    input.port.postMessage({ type: 'release' }); assert.equal(f.events.filter(e => e.state === 'active').length, 1);
    if (result instanceof Error) { fail(result); await assert.rejects(pending, error => error === result); }
    else { finish(result); assert.equal(await pending, result); }
    assert.equal(f.events.at(-1).state, 'failed');
    assert.equal(f.events.at(-1).statusCode, result instanceof Error ? 0 : 503);
    f.command({ action: 'stop', callId: 'owned' });
    const active = f.events.filter(e => e.state === 'active').length;
    startOwned(f); input.port.postMessage({ type: 'release' });
    assert.equal(f.events.filter(e => e.state === 'active').length, active);
    assert.equal(f.microphoneRequests(), 0);
  }
});
test('attachment that hangs after native activation still closes at the finite deadline', async () => {
  const f = await fixture(); startOwned(f);
  const input = await nativeInput(f), peer = await endpoint(f);
  let finish;
  f.responses.push(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
  input.port.postMessage({ type: 'release' }); assert.equal(f.events.filter(e => e.state === 'active').length, 1);
  f.tick(30000);
  assert.equal(f.events.some(e => e.state === 'failed'), true); assert.equal(peer.connectionState, 'closed');
  assert.ok(f.tracks.every(track => track.stopped));
  const active = f.events.filter(e => e.state === 'active').length;
  startOwned(f); finish(f.response); await pending; input.port.postMessage({ type: 'release' });
  assert.equal(f.events.filter(e => e.state === 'active').length, active);
});
test('unknown conflicts, allocated responses, rate limits and server errors never issue another allocation', async () => {
  for (const [status, detail, headers] of [[409, 'Unknown conflict', {}], [409, 'Another voice call is active', { Location: '/PRIVATE_CALL' }],
    [429, 'Another voice call is active', {}], [503, 'Another voice call is active', {}], [403, 'Forbidden', {}]]) {
    const f = await fixture(); startOwned(f);
    const error = new Response(JSON.stringify({ detail }), { status, headers }); f.responses.push(error);
    assert.equal(await f.window.fetch(createUrl, createInit()), error);
    assert.equal(f.requests.length, 1); assert.equal(f.events.at(-1).state, 'failed');
    assert.equal(f.events.at(-1).statusCode, status);
  }
});
test('a network failure never retries the possibly allocated call', async () => {
  const f = await fixture(); startOwned(f);
  const error = new TypeError('network unavailable'); f.responses.push(error);
  await assert.rejects(f.window.fetch(createUrl, createInit()), error);
  assert.equal(f.requests.length, 1); assert.equal(f.events.at(-1).statusCode, 0);
});
test('malformed or oversized denial data leaves the original native failure visible without another request', async () => {
  for (const text of ['not JSON', JSON.stringify({ detail: 'Another voice call is active', extra: 'x'.repeat(4096) })]) {
    const f = await fixture(); startOwned(f);
    const response = new Response(text, { status: 409 }); f.responses.push(response);
    assert.equal(await f.window.fetch(createUrl, createInit()), response);
    assert.equal(f.requests.length, 1); assert.equal(f.events.at(-1).state, 'failed');
  }
});
test('cancelling during Request body preparation prevents even the first allocation', async () => {
  const f = await fixture(); startOwned(f); let release;
  class DelayedRequest extends Request {
    clone() { const request = super.clone(); request.text = () => new Promise(resolve => { release = resolve; }); return request; }
  }
  const pending = f.window.fetch(new DelayedRequest(createUrl, createInit()));
  f.command({ action: 'stop', callId: 'owned' }); release(createInit().body);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.requests.length, 0);
});
test('a native denial response is returned untouched, without inspecting or retrying its body', async () => {
  const f = await fixture(); startOwned(f); let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  const response = new Response(body, { status: 409 });
  f.responses.push(response);
  assert.equal(await f.window.fetch(createUrl, createInit()), response);
  assert.equal(f.requests.length, 1);
  assert.equal(response.bodyUsed, false);
  f.command({ action: 'stop', callId: 'owned' });
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ detail: 'Another voice call is closing' }))); controller.close();
  assert.equal(response.bodyUsed, false);
  assert.equal(f.requests.length, 1);
});
test('other browser requests and mismatched offers retain their native behavior', async () => {
  const f = await fixture();
  const personal = createInit(); await f.window.fetch(createUrl, personal);
  assert.equal(f.requests[0][1], personal);
  startOwned(f);
  const otherUrl = 'https://other.example/backend-api/tbo/fixture/voice/calls';
  await f.window.fetch(otherUrl, personal); assert.equal(f.requests[1][1], personal);
  const foreign = { ...personal, body: JSON.stringify({ sdp: offer + '\r\na=FOREIGN' }) };
  await f.window.fetch(createUrl, foreign); assert.equal(f.requests[2][1], foreign);
  const nativeInstant = { ...personal, body: JSON.stringify({ sdp: offer, instant_connect: true }) };
  f.responses.push(new Response(JSON.stringify({ detail: 'Another voice call is active' }), { status: 409 }));
  await f.window.fetch(createUrl, nativeInstant);
  assert.equal(f.requests.length, 4); assert.equal(f.requests[3][1], nativeInstant);
});

const controllerSource = await readFile(new URL('../../browser-receiver/extension/voice-controller.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../../browser-receiver/extension/content.js', import.meta.url), 'utf8');
const dotNamespace = '11111111111111111111111111111111';
function controllerPage(targetUrl = 'https://chatgpt.com/dots/home') {
  const dom = new JSDOM(`<main><button data-orbit-profile-trigger="true" aria-label="Open Lumen’s profile"></button>
    <article class="message-row" data-message-id="${dotNamespace}~${dotNamespace}~CalpicoMessage~Sentinel_${'a'.repeat(32)}">
      <div class="message-body">Previous reply<button data-action="reply">Reply</button></div></article>
    <div class="ProseMirror" contenteditable="true" aria-label="Message"></div><button aria-label="Start call"></button></main>`,
  { url: targetUrl, runScripts: 'outside-only' });
  const observations = [], commands = []; let listener, clears = 0;
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  // JSDOM has no layout. Supply rendered geometry; native Chrome provides it.
  w.HTMLElement.prototype.getClientRects = function () {
    return this.closest('[hidden],[inert],[data-fixture-unrendered]') ? [] : [{ width: 36, height: 36 }];
  };
  const clear = w.clearInterval.bind(w);
  w.clearInterval = id => { clears++; clear(id); };
  w.chrome = { storage: { local: { get: async () => ({ dotSelection: { namespace: '1'.repeat(32), profileLabel: 'Lumen’s profile' } }) } }, runtime: { id: 'extension', sendMessage(value) { observations.push(value); return Promise.resolve(); },
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

function acknowledgeStarts(f, beforeAcceptance = () => {}) {
  f.w.postMessage = value => {
    f.commands.push(value.command);
    if (value.command.action === 'start') {
      beforeAcceptance();
      queueMicrotask(() => f.w.dispatchEvent(new f.w.MessageEvent('message', { source: f.w, origin: f.w.location.origin,
        data: { type: 'aw.native.voice.event', event: { state: 'accepted', callId: value.command.callId } } })));
    }
  };
}
const startController = f => f.w.AgenticWearVoiceController.create({ documentId: 'document', url: f.w.location.href,
  identity: () => dotNamespace, changed() {} });
const controllerStart = f => ({ documentId: 'document', url: f.w.location.href,
  action: 'start', callId: 'owned', threadId: 'dot:lumen', sdp: offer, expiresAt: Date.now() + 10000 });

test('consecutive calls retain selection and distinguish a closing call from missing setup', async () => {
  const f = controllerPage(); let controller;
  const logs = []; f.w.console.info = value => logs.push(value);
  try {
    acknowledgeStarts(f); controller = startController(f); f.announce(true);
    assert.equal(await controller.command(controllerStart(f)), true);
    assert.equal(await controller.command({ ...controllerStart(f), action: 'stop' }), true);
    const closing = f.w.document.createElement('button'); closing.setAttribute('aria-label', 'Hang up');
    f.w.document.querySelector('main').append(closing);
    assert.equal(controller.available(), false);
    assert.equal(logs.at(-1), 'Agentic Wear voice readiness: previous-call-closing');
    closing.remove(); assert.equal(controller.available(), true);
    assert.equal(await controller.command({ ...controllerStart(f), callId: 'second' }), true);
    assert.equal(logs.at(-1), 'Agentic Wear voice readiness: ready');
    assert.equal(logs.some(value => value.includes(dotNamespace)), false);
  } finally { controller?.stop(); f.dom.window.close(); }
});

test('native startup chooses the persistent toolbar rather than the profile panel', async () => {
  const f = controllerPage(); let controller;
  try {
    const clicked = [];
    f.w.document.querySelector('[aria-label="Start call"]').onclick = () => clicked.push('toolbar');
    const panel = f.w.document.createElement('div'); panel.setAttribute('role', 'dialog');
    panel.innerHTML = '<button aria-label="Start call"></button>';
    panel.firstChild.onclick = () => clicked.push('profile'); f.w.document.body.append(panel);
    controller = startController(f); f.announce(true); acknowledgeStarts(f);
    assert.equal(await controller.command(controllerStart(f)), true);
    assert.deepEqual(clicked, ['toolbar']);
    assert.equal(f.observations.at(-1).event.progressStage, 'control-clicked');
  } finally { controller?.stop(); f.dom.window.close(); }
});

test('native startup resolves a redrawn toolbar after reservation and never clicks the detached element', async () => {
  const f = controllerPage(); let controller, clicked = 0;
  try {
    const old = f.w.document.querySelector('[aria-label="Start call"]');
    old.onclick = () => assert.fail('detached start control was clicked');
    acknowledgeStarts(f, () => {
      const replacement = old.cloneNode(); replacement.onclick = () => clicked++;
      old.replaceWith(replacement);
    });
    controller = startController(f); f.announce(true);
    assert.equal(await controller.command(controllerStart(f)), true); assert.equal(clicked, 1);
  } finally { controller?.stop(); f.dom.window.close(); }
});

test('a missing or disabled control after reservation releases the owned startup without a native click', async () => {
  for (const change of ['remove', 'disable']) {
    const f = controllerPage(); let controller, clicks = 0;
    try {
      const button = f.w.document.querySelector('[aria-label="Start call"]'); button.onclick = () => clicks++;
      acknowledgeStarts(f, () => change === 'remove' ? button.remove() : button.disabled = true);
      controller = startController(f); f.announce(true);
      assert.equal(await controller.command(controllerStart(f)), false); assert.equal(clicks, 0);
      assert.equal(f.commands.at(-1).action, 'stop');
      assert.equal(f.observations.some(value => value.event.progressStage === 'control-clicked'), false);
    } finally { controller?.stop(); f.dom.window.close(); }
  }
});

test('hidden, inert, disabled and unrendered native controls do not advertise Watch voice readiness', async () => {
  for (const state of ['hidden', 'inert', 'disabled', 'aria-disabled', 'data-fixture-unrendered', 'visibility']) {
    const f = controllerPage(); let controller;
    try {
      const button = f.w.document.querySelector('[aria-label="Start call"]');
      if (state === 'visibility') button.style.visibility = 'hidden';
      else if (state === 'disabled') button.disabled = true;
      else button.setAttribute(state, state === 'aria-disabled' ? 'true' : '');
      controller = startController(f); f.announce(true);
      assert.equal(controller.available(), false, state);
      assert.equal(await controller.command(controllerStart(f)), false);
      assert.equal(f.commands.some(value => value.action === 'start'), false);
    } finally { controller?.stop(); f.dom.window.close(); }
  }
});

test('a closed Lumen profile reveals and verifies Start call before reserving native media', async () => {
  for (const opens of [true, false]) {
    const f = controllerPage(); let controller;
    try {
      const start = f.w.document.querySelector('[aria-label="Start call"]'); start.remove();
      const profile = f.w.document.querySelector('[data-orbit-profile-trigger]');
      let clicks = 0; start.onclick = () => clicks++;
      profile.onclick = () => { if (opens) f.w.document.querySelector('main').append(start); };
      acknowledgeStarts(f); controller = startController(f); f.announce(true);
      assert.equal(controller.available(), true);
      assert.equal(await controller.command(controllerStart(f)), opens);
      assert.equal(clicks, opens ? 1 : 0);
      assert.equal(f.commands.some(value => value.action === 'start'), opens);
    } finally { controller?.stop(); f.dom.window.close(); }
  }
});

test('cancellation while revealing the profile cannot reserve a later native call', async () => {
  const f = controllerPage(); let controller;
  try {
    const start = f.w.document.querySelector('[aria-label="Start call"]'); start.remove();
    controller = startController(f); f.announce(true);
    const pending = controller.command(controllerStart(f));
    controller.cancel(); f.w.document.querySelector('main').append(start);
    assert.equal(await pending, false);
    assert.equal(f.commands.some(value => value.action === 'start'), false);
  } finally { controller?.stop(); f.dom.window.close(); }
});

test('retired hidden Hang up controls cannot block the next Watch call', async () => {
  for (const state of ['hidden', 'inert', 'aria-hidden', 'aria-disabled', 'data-fixture-unrendered', 'visibility', 'display']) {
    const f = controllerPage(); let controller;
    try {
      const retired = f.w.document.createElement('button'); retired.setAttribute('aria-label', 'Hang up');
      if (state === 'visibility') retired.style.visibility = 'hidden';
      else if (state === 'display') retired.style.display = 'none';
      else retired.setAttribute(state, ['aria-hidden', 'aria-disabled'].includes(state) ? 'true' : '');
      f.w.document.querySelector('main').append(retired);
      acknowledgeStarts(f); controller = startController(f); f.announce(true);
      assert.equal(controller.available(), true, state);
      assert.equal(await controller.command(controllerStart(f)), true, state);
    } finally { controller?.stop(); f.dom.window.close(); }
  }
});

test('a rendered personal Hang up control still prevents Watch takeover', async () => {
  const f = controllerPage(); let controller;
  try {
    const hangup = f.w.document.createElement('button'); hangup.setAttribute('aria-label', 'Hang up');
    f.w.document.querySelector('main').append(hangup);
    controller = startController(f); f.announce(true);
    assert.equal(controller.available(), false);
    assert.equal(await controller.command(controllerStart(f)), false);
    assert.equal(f.commands.some(value => value.action === 'start'), false);
  } finally { controller?.stop(); f.dom.window.close(); }
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

const cloudUrl = 'https://chatgpt.com/local/00000000-0000-4000-8000-000000000001';
test('cloud RPC answer delegates Watch media and waits for real input release without a Dot HTTP attach', async () => {
  const f = await fixture({ targetUrl: cloudUrl });
  f.command({ action: 'start', callId: 'cloud', sdp: offer, expiresAt: Date.now() + 45000 });
  const input = await nativeInput(f), peer = new f.window.RTCPeerConnection();
  peer.createDataChannel('oai-events'); await peer.setLocalDescription(await peer.createOffer());
  const applied = peer.setRemoteDescription({ type: 'answer', sdp: offer });
  f.command({ action: 'transport', callId: 'cloud', transport: { seq: 1, peerState: 'connected', iceState: 'connected', channelState: 'open' } });
  await applied;
  assert.equal(f.events.some(e => e.state === 'active'), false);
  input.port.postMessage({ type: 'release' });
  assert.equal(f.events.filter(e => e.state === 'active').length, 1);
  assert.equal(f.microphoneRequests(), 0); assert.equal(f.fetches(), 0);
  const end = { isConnected: true, disabled: false, getAttribute: () => 'End voice chat', click() { end.clicked = true; } };
  f.controls.push(end); f.command({ action: 'stop', callId: 'cloud' });
  assert.equal(end.clicked, true); assert.equal(peer.connectionState, 'closed');
});
test('a cloud call cancelled during SDP negotiation never becomes ready or opens the desktop microphone', async () => {
  const f = await fixture({ targetUrl: cloudUrl });
  f.command({ action: 'start', callId: 'cloud', sdp: offer, expiresAt: Date.now() + 45000 });
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  await peer.setLocalDescription(await peer.createOffer());
  const pending = peer.setRemoteDescription({ type: 'answer', sdp: offer });
  f.command({ action: 'stop', callId: 'cloud' });
  await assert.rejects(pending, { name: 'AbortError' });
  f.command({ action: 'transport', callId: 'cloud', transport: { seq: 1, peerState: 'connected', iceState: 'connected', channelState: 'open' } });
  assert.equal(f.events.some(e => e.state === 'active'), false); assert.equal(f.microphoneRequests(), 0);
});

test('a cloud Talk command clicks only its native voice control and refuses an existing personal call', async () => {
 const f=controllerPage(cloudUrl);let clicks=0;
 try{
  const button=f.w.document.querySelector('[aria-label="Start call"]');button.setAttribute('aria-label','Start voice chat');button.onclick=()=>clicks++;
  const controller=f.w.AgenticWearVoiceController.create({documentId:'document',url:cloudUrl,identity:()=>f.w.location.href===cloudUrl?cloudUrl:null,changed(){}});
  f.announce(true);assert.equal(controller.available(),true);acknowledgeStarts(f);
  assert.equal(await controller.command({action:'start',documentId:'document',url:cloudUrl,callId:'cloud',threadId:'selected',sdp:offer,expiresAt:Date.now()+45000}),true);
  assert.equal(clicks,1);controller.cancel();
  const end=f.w.document.createElement('button');end.setAttribute('aria-label','End voice chat');f.w.document.body.append(end);
  assert.equal(controller.available(),false);assert.equal(await controller.command({action:'start',documentId:'document',url:cloudUrl,callId:'other',expiresAt:Date.now()+45000}),false);
  assert.equal(clicks,1);controller.stop();
 }finally{f.dom.window.close();}
});

test('cancelling a cloud startup clicks its native Cancel control and never a call on a different chat',async()=>{
 for(const navigate of [false,true]){
  const f=await fixture({targetUrl:cloudUrl});
  f.command({action:'start',callId:'cloud',url:cloudUrl,sdp:offer,expiresAt:Date.now()+45000});
  f.command({action:'control',callId:'cloud'});
  const cancel={isConnected:true,disabled:false,getAttribute:()=> 'Cancel voice chat',click(){cancel.clicked=true;}};f.controls.push(cancel);
  if(navigate)f.sandbox.location.href=cloudUrl.replace(/1$/,'2');
  f.command({action:'stop',callId:'cloud'});assert.equal(cancel.clicked===true,!navigate);
 }
});
test('the installed hook supports a later cloud navigation while refusing an offer for a different URL',async()=>{
 const f=await fixture();f.sandbox.location.href=cloudUrl;
 f.command({action:'start',callId:'wrong',url:cloudUrl.replace(/1$/,'2'),sdp:offer,expiresAt:Date.now()+45000});assert.equal(f.events.at(-1).state,'failed');
 f.command({action:'start',callId:'cloud',url:cloudUrl,sdp:offer,expiresAt:Date.now()+45000});assert.equal(f.events.at(-1).state,'accepted');
 const input=await nativeInput(f),peer=new f.window.RTCPeerConnection();peer.createDataChannel('oai-events');await peer.setLocalDescription(await peer.createOffer());
 const applied=peer.setRemoteDescription({type:'answer',sdp:offer});
 f.command({action:'transport',callId:'cloud',transport:{seq:1,peerState:'connected',iceState:'connected',channelState:'open'}});await applied;input.port.postMessage({type:'release'});
 assert.equal(f.events.filter(e=>e.state==='active').length,1);f.command({action:'stop',callId:'cloud'});
});
