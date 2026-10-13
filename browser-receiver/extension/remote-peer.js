(() => {
  'use strict';
  // Delegate standard SDP/media state to the endpoint that owns the real
  // microphone and speaker. The native Dot client keeps call authentication.
  function attach(peer, offerSdp, { answer, closed, current = () => true }) {
    if (!offerSdp.startsWith('v=0') || !offerSdp.includes('m=audio') || offerSdp.length > 65536) throw new TypeError('Invalid remote audio offer');
    let ended = false, local = null, remote = null, pendingRemote = null, applyingRemote = null;
    let peerState = 'new', iceState = 'new', channelState = 'connecting';
    let channel = null, channelCloseDelivered = false;
    const originalClose = peer.close.bind(peer);
    const ensureOpen = () => { if (ended || !current()) throw new DOMException('Remote call ended', 'InvalidStateError'); };
    const notify = (target, type) => {
      const event = new Event(type);
      target.dispatchEvent(event);
      // A native RTCDataChannel exposes event handler properties. Our endpoint
      // channel uses EventTarget and supplies those properties explicitly.
      if (target !== peer) target['on' + type]?.call(target, event);
    };
    for (const [name, get] of Object.entries({
      connectionState: () => peerState, iceConnectionState: () => iceState,
      iceGatheringState: () => 'complete', signalingState: () => ended ? 'closed' : remote ? 'stable' : local ? 'have-local-offer' : 'stable',
      localDescription: () => local, remoteDescription: () => remote || pendingRemote,
      currentLocalDescription: () => remote ? local : null, currentRemoteDescription: () => remote,
      pendingLocalDescription: () => remote ? null : local, pendingRemoteDescription: () => pendingRemote,
    })) Object.defineProperty(peer, name, { configurable: true, get });
    peer.createOffer = async options => {
      ensureOpen();
      if (options?.iceRestart) throw new DOMException('Reconnect the remote endpoint to restart ICE', 'NotSupportedError');
      return { type: 'offer', sdp: offerSdp };
    };
    peer.setLocalDescription = async description => {
      ensureOpen();
      if (description?.type !== 'offer' || description.sdp !== offerSdp) throw new TypeError('The remote endpoint owns this offer');
      local = Object.freeze({ type: 'offer', sdp: offerSdp });
      notify(peer, 'signalingstatechange');
    };
    peer.setRemoteDescription = async description => {
      ensureOpen();
      if (!local || remote || pendingRemote || description?.type !== 'answer' || typeof description.sdp !== 'string' || !description.sdp.startsWith('v=0') || !description.sdp.includes('m=audio') || description.sdp.length > 65536) throw new TypeError('Invalid remote audio answer');
      pendingRemote = Object.freeze({ type: 'answer', sdp: description.sdp });
      // The native SDK attaches the call after this promise completes. Forwarding
      // its answer is not proof that the Watch installed it: delivery can be
      // slower with the display off. Await this live peer's negotiation progress.
      // The owned call's existing startup deadline and close bound this wait.
      const applied = new Promise((resolve, reject) => { applyingRemote = { resolve, reject }; });
      try { answer(description.sdp); }
      catch (error) {
        pendingRemote = null;
        const waiting = applyingRemote; applyingRemote = null; waiting.reject(error);
      }
      return applied;
    };
    peer.createDataChannel = label => {
      ensureOpen();
      if (channel || label !== 'oai-events') throw new DOMException('One native voice event channel is supported', 'NotSupportedError');
      channel = new EventTarget();
      Object.defineProperties(channel, { label: { value: label }, readyState: { get: () => channelState }, bufferedAmount: { value: 0 } });
      channel.binaryType = 'arraybuffer';
      channel.close = () => peer.close();
      // Dot's client observes this channel and does not send through it. Fail
      // explicitly if a future native client changes that contract.
      channel.send = () => { throw new DOMException('Native client channel sending is not supported by this adapter', 'NotSupportedError'); };
      return channel;
    };
    peer.close = () => {
      if (ended) return;
      ended = true; peerState = 'closed'; iceState = 'closed';
      channelState = 'closed';
      if (applyingRemote) {
        const waiting = applyingRemote; applyingRemote = null; pendingRemote = null;
        waiting.reject(new DOMException('Remote call ended before its answer was applied', 'AbortError'));
      }
      originalClose();
      if (channel && !channelCloseDelivered) { channelCloseDelivered = true; notify(channel, 'close'); }
      notify(peer, 'connectionstatechange'); notify(peer, 'iceconnectionstatechange');
      closed();
    };
    return {
      get channelOpen() { return !ended && channelState === 'open'; },
      update(value) {
        if (ended || !current() || (!remote && !pendingRemote)) return false;
        if (!['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'].includes(value.peerState) ||
            !['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed'].includes(value.iceState) ||
            !['connecting', 'open', 'closing', 'closed'].includes(value.channelState)) throw new TypeError('Invalid remote transport state');
        const beforePeer = peerState, beforeIce = iceState, beforeChannel = channelState;
        peerState = value.peerState; iceState = value.iceState; channelState = value.channelState;
        if (applyingRemote && ['connecting', 'connected'].includes(peerState) &&
            ['checking', 'connected', 'completed'].includes(iceState) && channelState !== 'closed') {
          remote = pendingRemote; pendingRemote = null;
          const waiting = applyingRemote; applyingRemote = null;
          notify(peer, 'signalingstatechange');
          if (ended || !current()) waiting.reject(new DOMException('Remote call ended while applying its answer', 'AbortError'));
          else waiting.resolve();
        }
        if (beforePeer !== peerState) notify(peer, 'connectionstatechange');
        if (ended) return true;
        if (beforeIce !== iceState) notify(peer, 'iceconnectionstatechange');
        if (ended) return true;
        if (channel && beforeChannel !== channelState && ['open', 'closed'].includes(channelState)) {
          if (channelState === 'closed') channelCloseDelivered = true;
          notify(channel, channelState === 'open' ? 'open' : 'close');
        }
        if (!ended && (peerState === 'closed' || channelState === 'closed' ||
            (applyingRemote && (peerState === 'failed' || iceState === 'failed')))) peer.close();
        return true;
      },
      close: () => peer.close(),
    };
  }
  window.AgenticWearRemotePeer = Object.freeze({ attach });
})();
