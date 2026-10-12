(() => {
  'use strict';
  if (window.AgenticWearVoiceTiming) return;
  const bounded = value => Number.isFinite(value) && value >= 0 && value <= 120000 ? Math.round(value) : undefined;
  const span = (end, start) => Number.isFinite(start) && start > 0 && end >= start ? bounded(end - start) : undefined;
  function summarize(entry, phase, serverMs) {
    const result = { phase, totalMs: bounded(entry.duration) };
    if (result.totalMs === undefined) return null;
    // A response wait includes network RTT as well as service work. It is not
    // presented as server compute time. Zero/redacted timestamps stay unknown.
    const fields = {
      dnsMs: span(entry.domainLookupEnd, entry.domainLookupStart),
      connectMs: span(entry.connectEnd, entry.connectStart),
      tlsMs: span(entry.connectEnd, entry.secureConnectionStart),
      responseWaitMs: span(entry.responseStart, entry.requestStart),
      downloadMs: span(entry.responseEnd, entry.responseStart),
      workerMs: span(entry.fetchStart, entry.workerStart),
      serverMs,
    };
    if (entry.fetchStart > 0 && entry.requestStart >= entry.fetchStart && fields.dnsMs !== undefined && fields.connectMs !== undefined)
      fields.queueMs = bounded(Math.max(0, entry.requestStart - entry.fetchStart - fields.dnsMs - fields.connectMs));
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) result[key] = value;
    return result;
  }
  function create({ current, record }) {
    const requests = new Set();
    let stopped = false, observer = null;
    function flush(request) {
      if (stopped || !current() || !requests.has(request) || !request.entry || !request.responded) return;
      requests.delete(request);
      const timing = summarize(request.entry, request.phase, request.serverMs);
      if (timing) record({ ...timing, ...(request.allocationMode ? { allocationMode: request.allocationMode } : {}),
        ...(request.statusCode !== undefined ? { statusCode: request.statusCode } : {}) });
    }
    if (window.PerformanceObserver && window.performance?.now) {
      observer = new window.PerformanceObserver(list => {
        if (stopped || !current()) return;
        for (const entry of list.getEntries()) {
          if (entry.entryType !== 'resource' || entry.initiatorType !== 'fetch') continue;
          // Exact private URLs are used only in memory to correlate this call.
          // Neither URLs, headers, Server-Timing descriptions nor body data are
          // copied into the emitted fixed numeric record.
          const request = [...requests].find(item => !item.entry && entry.name === item.url && entry.startTime >= item.started);
          if (request) { request.entry = entry; flush(request); }
        }
      });
      observer.observe({ entryTypes: ['resource'] });
    }
    return {
      request(url, phase, allocationMode) {
        if (stopped || !current() || !observer || !['create', 'attach'].includes(phase) || requests.size >= 4) return null;
        const request = { url, phase, started: window.performance.now(), responded: false,
          ...(['instant', 'standard', 'unchanged'].includes(allocationMode) ? { allocationMode } : {}) };
        requests.add(request); return request;
      },
      response(request, response) {
        if (!request || !requests.has(request) || stopped || !current()) return;
        request.responded = true;
        if (Number.isInteger(response.status) && response.status >= 0 && response.status <= 599) request.statusCode = response.status;
        // Envoy's duration is optional and numeric only. Absence is unknown,
        // never zero. It still includes upstream work, not model-only compute.
        const value = response.headers?.get('x-envoy-upstream-service-time');
        if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) request.serverMs = bounded(Number(value));
        flush(request);
      },
      close() { stopped = true; requests.clear(); observer?.disconnect(); },
    };
  }
  window.AgenticWearVoiceTiming = Object.freeze({ create });
})();
