(() => {
  'use strict';
  const supportedUrl = url => url === 'https://chatgpt.com/dots/home' || /^https:\/\/chatgpt\.com\/local\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(url);
  if (window.__agenticWearNativeVoiceInstalled || !supportedUrl(location.href)) return;
  window.__agenticWearNativeVoiceInstalled = true;
  const Peer = window.RTCPeerConnection, Context = window.AudioContext, Worklet = window.AudioWorkletNode;
  const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  const available = Boolean(Peer && Context && Worklet && gum && window.AgenticWearRemotePeer);
  const peers = new Set();
  const preparationWaiters = new Set(), physicalInputs = new Set();
  let disableIdlePreparation = false, physicalRequests = 0, personalStartUntil = 0;
  const trackOwners = new WeakMap(), graphOwners = new WeakMap();
  let owner = null;
  const emit = event => window.postMessage({ type: 'aw.native.voice.event', event }, location.origin);
  window.addEventListener('click', event => {
    if (!event.isTrusted || location.href !== 'https://chatgpt.com/dots/home') return;
    const button = event.target?.closest?.('button');
    const label = button && (button.getAttribute('aria-label') || (button.innerText || button.textContent || '').trim());
    if (label === 'Start call' && !owner) personalStartUntil = Date.now() + 45000;
    if (label === 'Hang up') personalStartUntil = 0;
  }, true);
  function idlePreparation(peer) {
    try {
      return !owner && location.href === 'https://chatgpt.com/dots/home' && Date.now() >= personalStartUntil && physicalRequests === 0 &&
        ![...physicalInputs].some(stream => stream.getAudioTracks().some(track => track.readyState !== 'ended')) &&
        peer.connectionState === 'new' && peer.iceConnectionState === 'new' && !peer.remoteDescription &&
        ['stable', 'have-local-offer'].includes(peer.signalingState) && typeof peer.getSenders === 'function' &&
        peer.getSenders().every(sender => sender.track == null) &&
        ![...document.querySelectorAll('button')].some(button => button.isConnected &&
          (button.getAttribute('aria-label') || (button.innerText || button.textContent || '').trim()) === 'Hang up' &&
          (!button.getClientRects || button.getClientRects().length > 0));
    } catch { return false; }
  }
  async function preparationPolicy(peer) {
    if (!idlePreparation(peer)) return;
    // Selection loads in the isolated world. Give its verified identity query
    // one bounded chance to arrive before the native client allocates a cache.
    if (!disableIdlePreparation) await new Promise(resolve => {
      let timer;
      const finish = () => { clearTimeout(timer); preparationWaiters.delete(finish); resolve(); };
      preparationWaiters.add(finish); timer = setTimeout(finish, 1000);
    });
    if (disableIdlePreparation && idlePreparation(peer)) {
      // The native preparation's offer rejection invokes its own stop(), marks
      // that cache retired and makes Start call use a fresh native allocation.
      // Never close an unrelated peer or send a private cancellation request.
      console.info('Agentic Wear voice preparation: selected-dot-cache-deferred');
      throw new DOMException('Idle voice preparation is deferred for the selected Watch Dot', 'AbortError');
    }
  }
  const elapsed = call => Math.max(0, Math.min(10_000_000, Date.now() - call.startedAt));
  function stamp(call, key) { if (owner === call && call.setupTiming[key] === undefined) call.setupTiming[key] = Math.min(120_000, elapsed(call)); }
  function event(call, state, extra = {}) {
    if (owner === call) emit({ callId: call.id, state, elapsedMs: elapsed(call), setupTiming: { ...call.setupTiming },
      ...(call.allocationMode ? { allocationMode: call.allocationMode } : {}), ...extra });
  }
  function active(call) {
    if (owner === call && !call.ended && call.connected && call.remote?.channelOpen &&
        call.attachStarted && call.nativeReleased && !call.active) { call.active = true; event(call, 'active'); }
  }
  function stop(call) {
    if (owner !== call || call.ended) return;
    call.ended = true;
    try {
      // Media may not exist yet. Cancel the native startup while its matching
      // main-world ownership token is still held; never schedule a later click.
      if (call.nativeStarted && location.href === call.url) {
        const hangup = [...document.querySelectorAll('button')].find(button => button.isConnected && !button.disabled &&
          (call.isDot ? (button.getAttribute('aria-label') || (button.innerText || button.textContent || '').trim()) === 'Hang up' : /^(End voice chat|Stop voice chat|End Voice|Cancel voice chat)$/.test(button.getAttribute('aria-label') || (button.innerText || button.textContent || '').trim())));
        hangup?.click();
      }
    } finally {
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
  }
  if (available) {
    window.AudioWorkletNode = new Proxy(Worklet, {
      construct(target, args, newTarget) {
        const node = Reflect.construct(target, args, newTarget), call = graphOwners.get(args[0]);
        // Observe the native client's own permission to release input. Its
        // activation policy can wait for attachment or activate on connected
        // media/channel; do not infer that policy or fabricate a release.
        if (call && args[1] === 'codex-realtime-buffered-audio') {
          const post = node.port.postMessage;
          node.port.postMessage = function (...values) {
            const result = post.apply(this, values);
            if (this === node.port && owner === call && !call.ended && values[0]?.type === 'release' && Object.keys(values[0]).length === 1) {
              call.nativeReleased = true; active(call);
            }
            return result;
          };
        }
        return node;
      },
    });
    const nativeTimeout = window.setTimeout;
    window.setTimeout = function (callback, delay, ...args) {
      const call = owner;
      // Native negotiation includes allocation, attachment and the delegated
      // endpoint round trip. Its 20 s budget can expire after Watch ICE already
      // connected. Match only this owned native watchdog; retain a finite
      // deadline and the Watch's existing 30 s startup/cancellation contract.
      if (call?.peer && !call.ended && !call.active && delay === 20000 && typeof callback === 'function' &&
          Function.prototype.toString.call(callback).includes('Your dot’s voice connection timed out')) delay = 30000;
      return nativeTimeout.call(this, callback, delay, ...args);
    };
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
      if (!call) {
        physicalRequests++;
        if (constraints?.audio) personalStartUntil = 0;
        try {
          const stream = await gum(constraints);
          if (stream?.getAudioTracks?.().length) {
            physicalInputs.add(stream);
            for (const track of stream.getAudioTracks()) track.addEventListener?.('ended', () => {
              if (stream.getAudioTracks().every(value => value.readyState === 'ended')) physicalInputs.delete(stream);
            }, { once: true });
          }
          return stream;
        } finally { physicalRequests--; }
      }
      if (call.ended) throw new DOMException('The delegated input setup was cancelled', 'AbortError');
      if (!constraints?.audio || constraints.video) throw new DOMException('This call delegates audio only to the Watch', 'NotAllowedError');
      stamp(call, 'captureMs');
      call.nativeStarted = true;
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
        if (!call && typeof peer.createOffer === 'function') {
          const createOffer = peer.createOffer;
          peer.createOffer = async function (...values) { await preparationPolicy(peer); return createOffer.apply(this, values); };
        }
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
            answer: sdp => { if (!call.isDot) call.attachStarted = true; event(call, 'answer', { sdp }); },
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
      const cleanup = call && phase === 'stop' && !call.peer;
      if (cleanup) { stamp(call, 'cleanupStartMs'); event(call, 'progress', { progressStage: 'cleanup' }); }
      try {
        const prepared = call && phase === 'create' && window.AgenticWearNativeAllocation
          ? await window.AgenticWearNativeAllocation.prefer(args, call.sdp) : { args };
        if (call && phase === 'create' && owner !== call) throw new DOMException('The delegated call was cancelled before allocation', 'AbortError');
        if (call && phase === 'create') call.allocationMode = prepared.allocationMode || 'unchanged';
        const fetchOnce = async (values, allocationMode) => {
          const timingRequest = requestUrl ? call?.timing?.request(requestUrl, phase, allocationMode) : null;
          const pending = originalFetch.apply(this, values);
          const input = values[0], request = typeof window.Request === 'function' && input instanceof window.Request;
          if (owner === call && phase === 'attach' && (values[1]?.method || (request ? input.method : 'GET')).toUpperCase() === 'POST') {
            call.attachStarted = true; active(call);
          }
          const response = await pending;
          if (owner === call) call?.timing?.response(timingRequest, response);
          return response;
        };
        const response = await fetchOnce(prepared.args, prepared.allocationMode);
        if (owner === call && phase && phase !== 'stop') {
          stamp(call, phase === 'create' ? 'createEndMs' : 'attachEndMs');
          if (!response.ok) event(call, 'failed', { statusCode: response.status });
          else if (phase === 'attach') { call.attached = true; active(call); }
        }
        if (owner === call && cleanup && !response.ok) event(call, 'failed', { statusCode: response.status });
        return response;
      } catch (error) {
        if (owner === call && phase && (phase !== 'stop' || cleanup)) event(call, 'failed', { statusCode: 0 });
        throw error;
      }
    };
    window.__agenticWearNativeVoiceReadiness = 'native-client-input-release';
    window.__agenticWearNativeVoiceAllocationPolicy = 'native-client-default';
  }
  window.addEventListener('message', message => {
    if (message.source !== window || message.origin !== location.origin || message.data?.type !== 'aw.native.voice.command') return;
    const command = message.data.command;
    if (command?.action === 'query') {
      if (typeof command.disableIdlePreparation === 'boolean') {
        disableIdlePreparation = command.disableIdlePreparation;
        if (disableIdlePreparation) for (const finish of [...preparationWaiters]) finish();
      }
      emit({ state: 'available', available }); return;
    }
    if (!command || !/^[A-Za-z0-9_.:-]{1,128}$/.test(command.callId || '')) return;
    if (command.action === 'start') {
      const refused = !available ? 'runtime-unavailable'
        : !supportedUrl(location.href) || (command.url !== undefined && command.url !== location.href) ? 'page-changed'
        : owner ? 'owned-call-present'
        : [...peers].some(peer => peer.connectionState !== 'closed') ? 'browser-peer-present'
        : typeof command.sdp !== 'string' || !command.sdp.startsWith('v=0') || !command.sdp.includes('m=audio') || command.sdp.length > 65536 ? 'offer-invalid'
        : Date.now() >= command.expiresAt || command.expiresAt > Date.now() + 60000 ? 'command-expired' : null;
      if (refused) {
        // Fixed reason codes only: never log call IDs, SDP, account data or audio.
        console.warn('Agentic Wear voice startup refused: ' + refused);
        emit({ callId: command.callId, state: 'failed' }); return;
      }
      const context = new Context({ sampleRate: 48000 });
      const call = { id: command.callId, url: location.href, isDot: location.href === 'https://chatgpt.com/dots/home', sdp: command.sdp, context, startedAt: Date.now(), setupTiming: {}, placeholder: context.createMediaStreamDestination(),
        clones: [], lastPing: Date.now(), seq: 0, connected: false, attached: false, attachStarted: false,
        nativeReleased: false, active: false, ended: false, nativeStarted: false };
      owner = call;
      call.timing = window.AgenticWearVoiceTiming?.create({ current: () => owner === call,
        record: httpTiming => event(call, 'timing', { httpTiming }) });
      if (document.body) {
        const banner = document.createElement('div'); banner.setAttribute('role', 'status');
        banner.textContent = 'Agentic Wear · Watch microphone and speaker · Mute on the Watch';
        Object.assign(banner.style, { position: 'fixed', bottom: '8px', left: '8px', zIndex: '2147483647', background: '#234537', color: '#fff', padding: '8px 12px', borderRadius: '10px', font: '13px system-ui', pointerEvents: 'none' });
        document.body.append(banner); call.banner = banner;
      }
      call.timer = setInterval(() => { if (location.href !== call.url || Date.now() - call.lastPing > 45000) stop(call); }, 1000);
      call.startup = setTimeout(() => { if (owner === call && (!call.active || !call.attached)) { event(call, 'failed'); stop(call); } }, 30000);
      event(call, 'accepted');
    } else if (owner?.id === command.callId) {
      const call = owner;
      if (command.action === 'transport' && command.transport?.seq > call.seq) {
        call.seq = command.transport.seq; call.remote?.update(command.transport); active(call);
      }
      if (command.action === 'heartbeat') call.lastPing = Date.now();
      if (command.action === 'control') call.nativeStarted = true;
      if (command.action === 'stop') stop(call);
    }
  });
  // Either world can be injected first on an existing SPA tab. Announce here
  // as well as answering queries so a delayed hook needs no background timer.
  emit({ state: 'available', available });
  window.addEventListener('pagehide', () => { if (owner) stop(owner); });
})();
