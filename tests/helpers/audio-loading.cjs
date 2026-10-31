function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Observe constructor-started production loads without adding a runtime testing hook.
function recordLoads(Audio) {
  return class extends Audio {
    load(key) {
      const pending = super.load(key);
      (this.pendingLoads ??= []).push(pending);
      return pending;
    }
  };
}

async function withSampleRequests(run) {
  const fetch = globalThis.fetch, warn = console.warn;
  const requests = [], warnings = [];
  globalThis.fetch = (url, { signal } = {}) => {
    const pending = deferred();
    const request = { url, signal, aborts: 0, ...pending };
    const abort = () => { request.aborts++; pending.reject(signal.reason); };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const remove = () => signal?.removeEventListener('abort', abort);
    pending.promise.then(remove, remove);
    requests.push(request);
    return pending.promise;
  };
  console.warn = (...args) => warnings.push(args);
  try {
    return await run({ requests, warnings });
  } finally {
    globalThis.fetch = fetch;
    console.warn = warn;
  }
}

module.exports = { deferred, recordLoads, withSampleRequests };
