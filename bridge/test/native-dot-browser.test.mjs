import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

async function fixture() {
  const handlers = new Map(), events = [], tracks = [], requests = [], responses = [], controls = [], timers = [];
  let microphoneRequests = 0, localResumes = 0, fetches = 0, now = 100;
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.closed = false; observers.push(this); }
    observe(options) { assert.equal(JSON.stringify(options), '{"entryTypes":["resource"]}'); }
    disconnect() { this.closed = true; }
  }
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
  const window = { RTCPeerConnection: Peer, AudioContext: Context, Request, PerformanceObserver: Observer, performance: { now: () => now },
    setTimeout(callback, delay, ...args) { const timer = { callback, delay, args, due: now + delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cleared = true; },
    addEventListener(name, handler) { handlers.set(name, handler); }, postMessage(message) { events.push(message.event); },
    async fetch(...args) { fetches++; requests.push(args); const next = responses.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(...args) : next || response; } };
  const location = { href: 'https://chatgpt.com/dots/home', origin: 'https://chatgpt.com' };
  const sandbox = { window, location, Event, EventTarget, DOMException, URL, TextDecoder, navigator: { mediaDevices: {
    getUserMedia() { microphoneRequests++; return Promise.resolve('physical'); } } },
    document: { body: null, querySelectorAll: () => controls }, Date,
    setInterval: () => 1, clearInterval() {}, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout };
  vm.runInNewContext(await readFile(new URL('../../browser-receiver/extension/remote-peer.js', import.meta.url), 'utf8'), sandbox);
  vm.runInNewContext(await readFile(new URL('../../browser-receiver/extension/voice-timing.js', import.meta.url), 'utf8'), sandbox);
  vm.runInNewContext(await readFile(new URL('../../browser-receiver/extension/native-allocation.js', import.meta.url), 'utf8'), sandbox);
  vm.runInNewContext(await readFile(new URL('../../browser-receiver/extension/voice-hook.js', import.meta.url), 'utf8'), sandbox);
  const command = value => handlers.get('message')({ source: window, origin: location.origin,
    data: { type: 'aw.native.voice.command', command: value } });
  return { window, sandbox, command, events, tracks, response, requests, responses, controls, microphoneRequests: () => microphoneRequests, localResumes: () => localResumes,
    fetches: () => fetches, advance: ms => { now += ms; }, observers, timers,
    tick(ms) { now += ms; for (const timer of timers.filter(t => !t.cleared && t.due <= now).sort((a, b) => a.due - b.due)) {
      timer.cleared = true; timer.callback(...timer.args);
    } },
    resource(entry, observer = observers.at(-1)) { observer.callback({ getEntries: () => [entry] }); } };
}
const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111';

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

test('native acceptance needs endpoint media and HTTP attachment; stale transport cannot change it', async () => {
  const f = await fixture();
  f.command({ action: 'start', callId: 'owned', sdp: offer, expiresAt: Date.now() + 45000 });
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  assert.equal(f.events.find(e => e.progressStage === 'peer').state, 'progress');
  await peer.setLocalDescription(await peer.createOffer());
  await peer.setRemoteDescription({ type: 'answer', sdp: offer });
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 2, peerState: 'connected', iceState: 'connected', channelState: 'open' } });
  assert.equal(f.events.some(e => e.state === 'active'), false);
  const response = await f.window.fetch('/backend-api/tbo/PRIVATE_OWNER/voice/calls/PRIVATE_CALL/attach', { headers: { Authorization: 'PRIVATE_CREDENTIAL' } });
  assert.equal(response, f.response);
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
test('native startup can attach after 20 seconds without prematurely ending the connected Watch media', async () => {
  const f = await fixture(); startOwned(f);
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  await peer.setLocalDescription(await peer.createOffer());
  let complete, timer;
  const startup = Promise.race([new Promise(resolve => { complete = resolve; }), new Promise((_, reject) => {
    timer = f.window.setTimeout(() => reject(Error('Your dot’s voice connection timed out')), 20000);
  })]).finally(() => f.window.clearTimeout(timer));
  f.tick(17000); await peer.setRemoteDescription({ type: 'answer', sdp: offer });
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 1, peerState: 'connected', iceState: 'connected', channelState: 'open' } });
  f.tick(4000);
  assert.equal(f.events.some(e => e.state === 'active'), false, 'media alone still cannot release Watch input');
  await f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
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
test('the requested Watch allocation uses the native instant mode while preserving SDP and authentication', async () => {
  const f = await fixture(); startOwned(f);
  const init = createInit(), originalBody = init.body;
  const response = await f.window.fetch(createUrl, init);
  assert.equal(response, f.response); assert.equal(f.requests.length, 1);
  const body = JSON.parse(f.requests[0][1].body);
  assert.deepEqual(body, { ...JSON.parse(originalBody), instant_connect: true });
  assert.equal(f.requests[0][1].headers, init.headers);
  assert.equal(f.requests[0][1].credentials, init.credentials); assert.equal(init.body, originalBody);
  f.resource(resource());
  assert.equal(f.events.find(e => e.state === 'timing').httpTiming.allocationMode, 'instant');
  assert.equal(f.events.some(e => e.state === 'active'), false);
  assert.equal(f.microphoneRequests(), 0);
  assert.equal(JSON.stringify(f.events).includes('PRIVATE_'), false);
});
test('only a documented 409 denial without allocation permits the native standard mode, with Request bodies intact', async () => {
  const f = await fixture(); startOwned(f);
  const input = new Request(createUrl, createInit());
  f.responses.push(new Response(JSON.stringify({ detail: "Your dot's voice task is still active" }), { status: 409 }));
  await f.window.fetch(input);
  assert.equal(f.requests.length, 2); assert.equal(input.bodyUsed, false);
  assert.equal(JSON.parse(f.requests[0][1].body).instant_connect, true);
  assert.deepEqual(JSON.parse(await f.requests[1][0].text()), JSON.parse(createInit().body));
  assert.equal(f.requests[0][0].headers.get('Authorization'), 'PRIVATE_CREDENTIAL');
  assert.equal(f.requests[1][0].headers.get('Authorization'), 'PRIVATE_CREDENTIAL');
  assert.equal(f.events.some(e => e.state === 'failed'), false);
  const peer = new f.window.RTCPeerConnection(); peer.createDataChannel('oai-events');
  await peer.setLocalDescription(await peer.createOffer());
  await peer.setRemoteDescription({ type: 'answer', sdp: offer });
  f.command({ action: 'transport', callId: 'owned', transport: { seq: 1, peerState: 'connected', iceState: 'connected', channelState: 'open' } });
  assert.equal(f.events.some(e => e.state === 'active'), false);
  await f.window.fetch(createUrl + '/PRIVATE_CALL/attach', { method: 'POST' });
  assert.equal(f.events.find(e => e.state === 'active').allocationMode, 'standard');
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
test('an ended call cannot perform normal allocation after reading a safe denial', async () => {
  const f = await fixture(); startOwned(f); let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  f.responses.push(new Response(body, { status: 409 }));
  const pending = f.window.fetch(createUrl, createInit());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  f.command({ action: 'stop', callId: 'owned' });
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ detail: 'Another voice call is closing' }))); controller.close();
  await assert.rejects(pending, { name: 'AbortError' });
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
  // JSDOM has no layout. Supply rendered geometry; native Chrome provides it.
  w.HTMLElement.prototype.getClientRects = function () {
    return this.closest('[hidden],[inert],[data-fixture-unrendered]') ? [] : [{ width: 36, height: 36 }];
  };
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
