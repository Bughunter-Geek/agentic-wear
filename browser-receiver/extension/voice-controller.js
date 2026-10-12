(() => {
  'use strict';
  window.AgenticWearVoiceController = { create({ documentId, url, identity, changed }) {
    let supported = false, owner = null, accepted = null;
    const disabled = new Map();
    const label = element => element.getAttribute('aria-label') || (element.innerText || element.textContent || '').trim();
    const buttons = () => [...document.querySelectorAll('button')];
    const hangup = () => buttons().find(button => label(button) === 'Hang up' && !button.disabled);
    function protectMicControls() {
      if (!owner) return;
      for (const button of buttons()) if (/^(Mute|Unmute) microphone$/.test(label(button))) {
        if (!disabled.has(button)) disabled.set(button, button.disabled);
        if (!button.disabled) button.disabled = true;
      }
    }
    function post(command) { window.postMessage({ type: 'aw.native.voice.command', command }, location.origin); }
    function release() {
      for (const [button, wasDisabled] of disabled) if (button.isConnected) button.disabled = wasDisabled;
      disabled.clear(); owner = null; accepted = null; changed();
    }
    function report(event) {
      if (!owner || event.callId !== owner.callId) return;
      try { chrome.runtime.sendMessage({ version: 1, kind: 'native-voice-event', url, documentId, identity: owner.identity,
        event: { ...event, threadId: owner.threadId } }).catch(() => {}); } catch { post({ action: 'stop', callId: owner.callId }); }
    }
    function receive(message) {
      if (message.source !== window || message.origin !== location.origin || message.data?.type !== 'aw.native.voice.event') return;
      const event = message.data.event;
      if (event?.state === 'available') { supported = event.available === true; changed(); return; }
      if (!owner || event?.callId !== owner.callId) return;
      report(event);
      if (event.state === 'accepted') accepted?.resolve(true);
      if (event.state === 'failed' || event.state === 'closed') {
        accepted?.resolve(false);
        if (event.state === 'failed') post({ action: 'stop', callId: owner.callId });
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
    return {
      available: () => supported && Boolean(identity()) && (Boolean(owner) || !hangup()),
      async command(command) {
        if (command.documentId !== documentId || command.url !== url || Date.now() >= command.expiresAt) return false;
        if (command.action === 'start') {
          if (owner || !supported || !identity() || hangup()) return false;
          const start = buttons().filter(button => label(button) === 'Start call' && !button.disabled).at(-1);
          if (!start) return false;
          owner = { callId: command.callId, threadId: command.threadId, identity: identity() };
          const call = owner;
          const pending = new Promise(resolve => { accepted = { resolve }; });
          post(command);
          const deadline = new Promise(resolve => setTimeout(() => resolve(false), 3000));
          if (!await Promise.race([pending, deadline]) || owner !== call || Date.now() >= command.expiresAt) {
            post({ action: 'stop', callId: call.callId }); release(); return false;
          }
          start.click();
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
      stop() {
        if (owner) post({ action: 'stop', callId: owner.callId });
        release(); clearInterval(timer); controls.disconnect(); window.removeEventListener('message', receive);
      },
    };
  } };
})();
