(() => {
  'use strict';
  if (window.__agenticWearNativeVoiceInstalled || location.href !== 'https://chatgpt.com/dots/home') return;
  window.__agenticWearNativeVoiceInstalled = true;
  const Peer = window.RTCPeerConnection, Context = window.AudioContext;
  const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  const available = Boolean(Peer && Context && gum && window.AgenticWearRemotePeer);
  const peers = new Set();
  const trackOwners = new WeakMap(), graphOwners = new WeakMap();
  let owner = null;
  const emit = event => window.postMessage({ type: 'aw.native.voice.event', event }, location.origin);
  const elapsed = call => Math.max(0, Math.min(10_000_000, Date.now() - call.startedAt));
  function stamp(call, key) { if (owner === call && call.setupTiming[key] === undefined) call.setupTiming[key] = Math.min(120_000, elapsed(call)); }
  function event(call, state, extra = {}) {
    if (owner === call) emit({ callId: call.id, state, elapsedMs: elapsed(call), setupTiming: { ...call.setupTiming },
      ...(call.allocationMode ? { allocationMode: call.allocationMode } : {}), ...extra });
  }
  function active(call) {
    if (owner === call && call.connected && call.attached && !call.active) { call.active = true; event(call, 'active'); }
  }
  function stop(call) {
    if (owner !== call) return;
    call.ended = true;
    owner = null;
    clearInterval(call.timer); clearTimeout(call.startup);
    call.timing?.close();
    call.remote?.close();
    for (const track of call.clones) track.stop();
    call.placeholder.stream.getTracks().forEach(track => track.stop());
    void call.context.close();
    call.banner?.remove();
    emit({ callId: call.id, state: 'closed' });
  }
  if (available) {
    // The native client's local input graph is unused for delegated media.
    // Only graphs fed by this call's placeholder are marked. Other contexts
    // retain normal browser playback/permission behavior.
    const source = Context.prototype.createMediaStreamSource, resume = Context.prototype.resume, destination = Context.prototype.createMediaStreamDestination;
    Context.prototype.createMediaStreamSource = function (...args) {
      const call = args[0]?.getAudioTracks?.().map(track => trackOwners.get(track)).find(Boolean);
      if (call?.ended) throw new DOMException('The delegated call ended during input setup', 'AbortError');
      const node = source.apply(this, args);
      if (call) graphOwners.set(this, call);
      return node;
    };
    Context.prototype.createMediaStreamDestination = function (...args) {
      const result = destination.apply(this, args), call = graphOwners.get(this);
      if (call) for (const track of result.stream.getAudioTracks()) trackOwners.set(track, call);
      return result;
    };
    Context.prototype.resume = function (...args) {
      const call = graphOwners.get(this);
      if (call?.ended) return Promise.reject(new DOMException('The delegated input setup was cancelled', 'AbortError'));
      if (call && owner === call) return Promise.resolve();
      return resume.apply(this, args);
    };
    navigator.mediaDevices.getUserMedia = async constraints => {
      const call = owner;
      if (!call) return gum(constraints);
      if (!constraints?.audio || constraints.video) throw new DOMException('This call delegates audio only to the Watch', 'NotAllowedError');
      stamp(call, 'captureMs');
      event(call, 'progress', { progressStage: 'capture' });
      const stream = call.placeholder.stream.clone(); call.clones.push(...stream.getTracks());
      for (const track of stream.getAudioTracks()) trackOwners.set(track, call);
      return stream;
    };
    window.RTCPeerConnection = new Proxy(Peer, {
      construct(target, args) {
        const call = owner;
        if (call?.peer) { event(call, 'failed'); throw new DOMException('One native Dot call is supported', 'InvalidStateError'); }
        const peer = Reflect.construct(target, args); peers.add(peer);
        const close = peer.close;
        peer.close = function (...values) { peers.delete(peer); return close.apply(this, values); };
        if (typeof peer.addTrack === 'function') {
          const addTrack = peer.addTrack;
          peer.addTrack = function (track, ...streams) {
            if (trackOwners.get(track)?.ended) throw new DOMException('The delegated track belongs to an ended call', 'AbortError');
            return addTrack.call(this, track, ...streams);
          };
        }
        if (call) {
          stamp(call, 'peerMs');
          event(call, 'progress', { progressStage: 'peer' });
          call.peer = peer;
          call.remote = window.AgenticWearRemotePeer.attach(peer, call.sdp, {
            current: () => owner === call,
            answer: sdp => event(call, 'answer', { sdp }),
            closed: () => stop(call),
          });
          peer.addEventListener('connectionstatechange', () => {
            if (owner !== call) return;
            call.connected = peer.connectionState === 'connected'; active(call);
          });
        }
        return peer;
      },
    });
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const call = owner;
      let phase = null, requestUrl = null;
      if (call) {
        try {
          const input = args[0], url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
          const match = url.origin === location.origin && url.pathname.match(/\/tbo\/[^/]+\/voice\/calls(?:\/[^/]+\/(attach|stop))?$/);
          if (match) { phase = match[1] || 'create'; requestUrl = url.href; }
        } catch { /* Unknown request shapes retain native fetch behavior. */ }
      }
      if (call && phase && phase !== 'stop') stamp(call, phase === 'create' ? 'createStartMs' : 'attachStartMs');
      try {
        const prepared = call && phase === 'create' && window.AgenticWearNativeAllocation
          ? await window.AgenticWearNativeAllocation.prefer(args, call.sdp) : { args };
        if (call && phase === 'create' && owner !== call) throw new DOMException('The delegated call was cancelled before allocation', 'AbortError');
        if (call && phase === 'create') call.allocationMode = prepared.allocationMode || 'unchanged';
        const fetchOnce = async (values, allocationMode) => {
          const timingRequest = requestUrl ? call?.timing?.request(requestUrl, phase, allocationMode) : null;
          const response = await originalFetch.apply(this, values);
          if (owner === call) call?.timing?.response(timingRequest, response);
          return response;
        };
        let response = await fetchOnce(prepared.args, prepared.allocationMode);
        if (prepared.standardArgs && await window.AgenticWearNativeAllocation.declined(response)) {
          if (owner !== call) throw new DOMException('The delegated call ended before normal allocation', 'AbortError');
          call.allocationMode = 'standard';
          response = await fetchOnce(prepared.standardArgs, 'standard');
        }
        if (owner === call && phase && phase !== 'stop') {
          stamp(call, phase === 'create' ? 'createEndMs' : 'attachEndMs');
          if (!response.ok) event(call, 'failed', { statusCode: response.status });
          else if (phase === 'attach') { call.attached = true; active(call); }
        }
        return response;
      } catch (error) {
        if (owner === call && phase && phase !== 'stop') event(call, 'failed', { statusCode: 0 });
        throw error;
      }
    };
  }
  window.addEventListener('message', message => {
    if (message.source !== window || message.origin !== location.origin || message.data?.type !== 'aw.native.voice.command') return;
    const command = message.data.command;
    if (command?.action === 'query') { emit({ state: 'available', available }); return; }
    if (!command || !/^[A-Za-z0-9_.:-]{1,128}$/.test(command.callId || '')) return;
    if (command.action === 'start') {
      if (!available || owner || [...peers].some(peer => peer.connectionState !== 'closed') ||
          typeof command.sdp !== 'string' || !command.sdp.startsWith('v=0') || !command.sdp.includes('m=audio') || command.sdp.length > 65536 ||
          Date.now() >= command.expiresAt || command.expiresAt > Date.now() + 60000) { emit({ callId: command.callId, state: 'failed' }); return; }
      const context = new Context({ sampleRate: 48000 });
      const call = { id: command.callId, sdp: command.sdp, context, startedAt: Date.now(), setupTiming: {}, placeholder: context.createMediaStreamDestination(),
        clones: [], lastPing: Date.now(), seq: 0, connected: false, attached: false, active: false, ended: false };
      owner = call;
      call.timing = window.AgenticWearVoiceTiming?.create({ current: () => owner === call,
        record: httpTiming => event(call, 'timing', { httpTiming }) });
      if (document.body) {
        const banner = document.createElement('div'); banner.setAttribute('role', 'status');
        banner.textContent = 'Agentic Wear · Watch microphone and speaker · Mute on the Watch';
        Object.assign(banner.style, { position: 'fixed', bottom: '8px', left: '8px', zIndex: '2147483647', background: '#234537', color: '#fff', padding: '8px 12px', borderRadius: '10px', font: '13px system-ui', pointerEvents: 'none' });
        document.body.append(banner); call.banner = banner;
      }
      call.timer = setInterval(() => { if (location.href !== 'https://chatgpt.com/dots/home' || Date.now() - call.lastPing > 45000) stop(call); }, 1000);
      call.startup = setTimeout(() => { if (owner === call && !call.active) { event(call, 'failed'); stop(call); } }, 60000);
      event(call, 'accepted');
    } else if (owner?.id === command.callId) {
      const call = owner;
      if (command.action === 'transport' && command.transport?.seq > call.seq) { call.seq = command.transport.seq; call.remote?.update(command.transport); }
      if (command.action === 'heartbeat') call.lastPing = Date.now();
      if (command.action === 'stop') stop(call);
    }
  });
  // Either world can be injected first on an existing SPA tab. Announce here
  // as well as answering queries so a delayed hook needs no background timer.
  emit({ state: 'available', available });
  window.addEventListener('pagehide', () => { if (owner) stop(owner); });
})();
