(() => {
  'use strict';
  if (window.AgenticWearNativeAllocation) return;
  // These are the native client's explicit, non-allocated preparation denials.
  // An unknown response or network failure must never allocate a second call.
  const denials = new Set(['Another voice call is connecting', 'Another voice call is active',
    'Another voice call is closing', 'A voice call owns this child', "Your dot's voice task is still active"]);
  async function prefer(args, sdp) {
    const input = args[0], init = args[1];
    const request = typeof window.Request === 'function' && input instanceof window.Request;
    const unchanged = { args, allocationMode: 'unchanged' };
    if ((init?.method || (request ? input.method : 'GET')).toUpperCase() !== 'POST') return unchanged;
    let text = typeof init?.body === 'string' ? init.body : null;
    if (text === null && request && init?.body === undefined) text = await input.clone().text();
    if (text === null || text.length > 140000) return unchanged;
    let body;
    try { body = JSON.parse(text); } catch { return unchanged; }
    if (!body || Array.isArray(body) || body.sdp !== sdp) return unchanged;
    if (body.instant_connect === true) return { args, allocationMode: 'instant' };
    if (body.instant_connect !== undefined && body.instant_connect !== false) return unchanged;
    const fast = args.slice(), standard = args.slice();
    // Keep an unconsumed copy for the one permitted, explicitly denied retry.
    // Headers, account identity, signal and other native fetch options survive.
    if (request) { fast[0] = input.clone(); standard[0] = input.clone(); }
    fast[1] = { ...init, body: JSON.stringify({ ...body, instant_connect: true }) };
    return { args: fast, standardArgs: standard, allocationMode: 'instant' };
  }
  async function declined(response) {
    if (response.status !== 409 || response.headers?.get('location') || typeof response.clone !== 'function') return false;
    const reader = response.clone().body?.getReader();
    if (!reader) return false;
    let size = 0; const chunks = [];
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > 4096) { void reader.cancel().catch(() => {}); return false; }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return denials.has(JSON.parse(new TextDecoder().decode(bytes)).detail);
    } catch { return false; /* Unknown denial: return the original error to the native client. */ }
    finally { reader.releaseLock(); }
  }
  window.AgenticWearNativeAllocation = Object.freeze({ prefer, declined });
})();
