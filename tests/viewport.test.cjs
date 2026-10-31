const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

// Exercise the production coordinator with measured host sizes and a deterministic layout-frame queue.
test('viewport events coalesce, use the host, retain valid targets while hidden and cancel stale input', () => {
  const source = readFileSync(join(__dirname, '../js/main.js'), 'utf8');
  const block = source.slice(source.indexOf('  let resizePending = false;'), source.indexOf('  // The title screen, shown once'));
  const frames = [], sizes = [], aspects = [], events = {}, resets = [], cleanup = [], mapDraws = [];
  const container = { clientWidth: 382, clientHeight: 580 };
  let observe;
  const env = {
    container, renderWidth: 382, renderHeight: 580, rendererBusy: false, dirtyView: false,
    startup: { failed: false, onStop: fn => cleanup.push(fn) },
    requestAnimationFrame: (fn) => frames.push(fn),
    window: { innerWidth: 9999, innerHeight: 9999, addEventListener: (name, fn) => { events[name] = fn; } },
    ResizeObserver: class { constructor(fn) { observe = fn; } observe(el) { assert.equal(el, container); } disconnect() { resets.push('disconnect'); } },
    renderer: { setSize: (w, h) => sizes.push([w, h]) },
    cameraSystem: { onResize: (w, h) => aspects.push(w / h) },
    touchControls: { reset: () => resets.push('touch') }, placeRiderIndicator() {}, updateSoundButton() {},
    mapSystem: { isFullMapOpen: true, cancelGestures: () => resets.push('map'),
      resizeFullCanvas() { mapDraws.push('resize-2d'); }, renderFullMap() { mapDraws.push('draw-2d'); } }
  };
  runInNewContext(block, env);
  frames.shift()();
  assert.equal(sizes.length, 0, 'initial observer does not reallocate');
  assert.equal(env.dirtyView, false);
  for (const [w, h] of [[669, 867], [951, 585], [385, 571], [382, 580], [915, 412]]) {
    env.dirtyView = false;
    const beforeMapDraws = mapDraws.length;
    container.clientWidth = w; container.clientHeight = h;
    events.resize(); observe(); events.pageshow();
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.deepEqual(sizes.at(-1), [w, h]);
    assert.equal(aspects.at(-1), w / h);
    assert.equal(env.dirtyView, true, 'even a frozen map invalidates the GPU view on an actual host-size change');
    assert.deepEqual(mapDraws.slice(beforeMapDraws), ['resize-2d', 'draw-2d'], 'map layout/canvas redraw is synchronous in the coalesced resize');
  }
  assert.deepEqual(resets, Array(5).fill(['touch', 'map']).flat());
  container.clientHeight = 0;
  observe(); frames.shift()();
  assert.equal(sizes.length, 5, 'hidden state retains the previous target');
  container.clientHeight = 412;
  env.dirtyView = false;
  observe(); frames.shift()();
  assert.equal(sizes.length, 5, 'same-size restore does not reallocate');
  assert.equal(env.dirtyView, false, 'unchanged GPU dimensions do not manufacture another scene submission');
  container.clientWidth = 594; container.clientHeight = 368;
  observe(); frames.shift()();
  assert.deepEqual(sizes.at(-1), [594, 368], 'host-only resize is sufficient');
  env.rendererBusy = true;
  container.clientWidth = 844;
  observe(); frames.shift()();
  assert.equal(sizes.length, 6, 'rider compilation owns the MRT target; resize cannot reallocate it');
  env.rendererBusy = false;
  events.resize(); frames.shift()();
  assert.deepEqual(sizes.at(-1), [844, 368], 'latest host size applies after compilation drains');
  env.startup.failed = true;
  cleanup.forEach(fn => fn());
  assert.equal(resets.at(-1), 'disconnect');
  container.clientWidth = 900;
  observe(); frames.shift()();
  assert.equal(sizes.length, 7, 'queued resize cannot recreate graphics resources after failure');
});
