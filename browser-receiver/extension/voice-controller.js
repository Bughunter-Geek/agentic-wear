(() => {
  'use strict';
  window.AgenticWearVoiceController = { create({ documentId, url, identity, profileLabel, changed }) {
    const isDot = url === 'https://chatgpt.com/dots/home';
    let supported = false, owner = null, accepted = null, stopped = false, generation = 0;
    const disabled = new Map();
    const label = element => element.getAttribute('aria-label') || (element.innerText || element.textContent || '').trim();
    const buttons = () => [...document.querySelectorAll('button')];
    const usable = button => button.isConnected && !button.disabled && button.getAttribute('aria-disabled') !== 'true' &&
      !button.closest('[hidden],[inert],[aria-hidden="true"]') && button.getClientRects().length > 0 &&
      getComputedStyle(button).display !== 'none' && getComputedStyle(button).visibility === 'visible';
    function startControl() {
      const candidates = buttons().filter(button => (isDot ? label(button) === 'Start call' : /^(Start voice chat|Start Voice)$/.test(label(button))) && usable(button));
      // The profile panel can disappear while the main-world reservation is
      // acknowledged. Prefer the persistent toolbar, and resolve it at click time.
      return candidates.find(button => !button.closest('[role="dialog"]')) || candidates[0];
    }
    const hangup = () => buttons().find(button => (isDot ? label(button) === 'Hang up' : /^(End voice chat|Stop voice chat|End Voice|Ending voice chat|Cancel voice chat)$/.test(label(button))) && usable(button));
    const profileControl = () => {
      if (!isDot || buttons().some(button => label(button) === 'Start call')) return null;
      const expected = profileLabel?.();
      const candidates = [...document.querySelectorAll('[data-orbit-profile-trigger="true"]')].filter(button =>
        (expected ? label(button) === 'Open ' + expected : /^Open .+[’']s profile$/.test(label(button))) && usable(button));
      return candidates.length === 1 ? candidates[0] : null;
    };
    function revealStart(command) {
      if (startControl()) return Promise.resolve(true);
      const profile = profileControl();
      if (!profile || hangup()) return Promise.resolve(false);
      return new Promise(resolve => {
        let timer;
        const observer = new MutationObserver(check);
        function finish(value) { observer.disconnect(); clearTimeout(timer); resolve(value); }
        function check() {
          if (stopped || !identity() || hangup() || Date.now() >= command.expiresAt) finish(false);
          else if (startControl()) finish(true);
        }
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
        timer = setTimeout(() => finish(false), Math.min(1000, Math.max(0, command.expiresAt - Date.now())));
        profile.click(); check();
      });
    }

    function protectMicControls() {
      if (!owner) return;
      for (const button of buttons()) if (/^(Mute|Unmute) microphone$/.test(label(button))) {
        if (!disabled.has(button)) disabled.set(button, button.disabled);
        if (!button.disabled) button.disabled = true;
      }
    }
    function post(command) { window.postMessage({ type: 'aw.native.voice.command', command }, location.origin); }
    function release(call = owner) {
      if (owner !== call) return;
      accepted?.resolve(false);
      for (const [button, wasDisabled] of disabled) if (button.isConnected) button.disabled = wasDisabled;
      disabled.clear(); owner = null; accepted = null;
      if (!stopped) changed();
    }
    function report(event) {
      if (!owner || event.callId !== owner.callId) return;
      try { chrome.runtime.sendMessage({ version: 1, kind: 'native-voice-event', url, documentId, identity: owner.identity,
        event: { ...event, threadId: owner.threadId } }).catch(() => {}); } catch { post({ action: 'stop', callId: owner.callId }); }
    }
    function receive(message) {
      if (stopped || message.source !== window || message.origin !== location.origin || message.data?.type !== 'aw.native.voice.event') return;
      const event = message.data.event;
      if (event?.state === 'available') {
        const next = event.available === true;
        if (supported !== next) { supported = next; changed(); }
        return;
      }
      if (!owner || event?.callId !== owner.callId) return;
      report(event);
      if (event.state === 'accepted') accepted?.resolve(true);
      if (event.state === 'failed' || event.state === 'closed') {
        accepted?.resolve(false);
        if (event.state === 'failed') { console.warn('Agentic Wear voice startup refused: native-reservation-failed'); post({ action: 'stop', callId: owner.callId }); }
        release();
      }
    }
    window.addEventListener('message', receive);
    const controls = new MutationObserver(protectMicControls);
    controls.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
    const timer = setInterval(() => {
      post({ action: 'query' });
      if (owner) {
        // The browser's placeholder mic is not the physical input. Keep its
        // control visibly disabled; Watch mute operates the real native track.
        protectMicControls();
      }
    }, 2000);
    post({ action: 'query' });
    let lastReadiness = null;
    function readiness() {
      const reason = stopped ? 'controller-retired' : !supported ? 'hook-unavailable' : !identity() ? 'selection-mismatch'
        : owner ? 'ready' : hangup() ? 'previous-call-closing' : startControl() || profileControl() ? 'ready' : 'start-control-unavailable';
      // Log transitions only, using fixed codes. No Dot identity, account data,
      // private content or audio is included. General text readiness is separate.
      if (reason !== lastReadiness) {
        lastReadiness = reason;
        console.info('Agentic Wear voice readiness: ' + reason);
      }
      return reason;
    }
    return {
      available: () => readiness() === 'ready',
      async command(command) {
        if (stopped || command.documentId !== documentId || command.url !== url || Date.now() >= command.expiresAt) return false;
        if (command.action === 'start') {
          if (owner || !supported || !identity() || hangup()) { console.warn('Agentic Wear voice startup refused: controller-precondition'); return false; }
          const startingGeneration = generation;
          if (!startControl() && !await revealStart(command)) { console.warn('Agentic Wear voice startup refused: start-control-unavailable'); return false; }
          if (startingGeneration !== generation) return false;
          if (owner || stopped || !supported || !identity() || hangup()) return false;
          owner = { callId: command.callId, threadId: command.threadId, identity: identity() };
          const call = owner;
          const pending = new Promise(resolve => { accepted = { resolve }; });
          post(command);
          let timer;
          const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(false), 3000); });
          const ready = await Promise.race([pending, deadline]); clearTimeout(timer);
          if (!ready || owner !== call || Date.now() >= command.expiresAt) {
            post({ action: 'stop', callId: call.callId }); release(call); return false;
          }
          const start = startControl();
          if (!start || identity() !== call.identity || hangup()) {
            post({ action: 'stop', callId: call.callId }); release(call); return false;
          }
          start.click();
          post({ action: 'control', callId: call.callId });
          report({ callId: call.callId, state: 'progress', progressStage: 'control-clicked' });
          protectMicControls();
          changed(); return true;
        }
        if (!owner || owner.callId !== command.callId) return false;
        if (command.action === 'stop') {
          // Stop by ownership token. A delayed Hang up click could end a
          // newer personal browser call after our native call already closed.
          post(command); release(); return true;
        }
        post(command); return true;
      },
      cancel() {
        if (stopped) return;
        generation++;
        if (owner) post({ action: 'stop', callId: owner.callId });
        release();
      },
      stop() {
        if (stopped) return;
        stopped = true; generation++;
        if (owner) post({ action: 'stop', callId: owner.callId });
        release(); clearInterval(timer); controls.disconnect(); window.removeEventListener('message', receive);
      },
    };
  } };
})();
