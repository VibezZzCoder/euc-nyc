// Independent of the game module graph: even a failed import can show a useful error.
(() => {
  const overlay = document.getElementById('loading-overlay');
  const status = document.getElementById('loading-status');
  const panel = document.getElementById('startup-error');
  const retry = document.getElementById('startup-retry');
  let phase = 'download';
  let failed = false;
  let ready = false;
  let stop = () => {};

  const removeListeners = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
  const fail = (error) => {
    if (failed || ready) return;
    failed = true;
    removeListeners();
    stop();
    console.error(`[startup:${phase}]`, error);
    overlay.classList.remove('hidden');
    overlay.classList.add('has-error');
    overlay.setAttribute('role', 'alert');
    status.textContent = phase === 'graphics' ? 'Graphics could not start' : 'The city could not start';
    document.getElementById('startup-help').textContent = phase === 'graphics'
      ? 'This browser could not start WebGPU or its WebGL2 fallback. Try an up-to-date browser with hardware acceleration enabled. On a phone, try opening the link directly in Safari or Chrome.'
      : 'A required game file or graphics setup failed. Check your connection and try again. If it keeps happening, update your browser or try another browser.';
    document.getElementById('startup-detail').textContent = String(error?.message || error || 'Unknown startup error');
    panel.hidden = false;
    retry.focus({ preventScroll: true });
  };
  function onError(event) { fail(event.error || event.message); }
  function onRejection(event) { fail(event.reason); }
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  retry.addEventListener('click', () => window.location.reload());

  const startup = {
    get failed() { return failed; },
    phase(value) { phase = value; },
    onFailure(callback) { stop = callback; },
    fail,
    complete() {
      if (failed) return false;
      ready = true;
      removeListeners();
      return true;
    }
  };
  import('./main.js').then(({ initApp }) => initApp(startup)).catch(fail);
})();
