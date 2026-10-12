(() => {
  'use strict';
  if (window.AgenticWearNativeAllocation) return;
  // Preserve the native client's allocation choice. Direct calls use its
  // standard mode; preparation requests explicitly choose instant_connect.
  // Inspect only for bounded timing metadata, never mutate or retry the call.
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
    if (body.instant_connect === undefined || body.instant_connect === false) return { args, allocationMode: 'standard' };
    return unchanged;
  }
  window.AgenticWearNativeAllocation = Object.freeze({ prefer });
})();
