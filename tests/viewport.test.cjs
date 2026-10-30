const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

// Exercise the production coordinator with measured host sizes and a deterministic layout-frame queue.
test('viewport events coalesce, use the host, retain valid targets while hidden and cancel stale input', () => {
  const source = readFileSync(join(__dirname, '../js/main.js'), 'utf8');
  const block = source.slice(source.indexOf('  let resizePending = false;'), source.indexOf('  // The title screen, shown once'));
  const frames = [], sizes = [], aspects = [], events = {}, resets = [];
  const container = { clientWidth: 382, clientHeight: 580 };
  let observe;
  const env = {
    container, renderWidth: 382, renderHeight: 580,
    requestAnimationFrame: (fn) => frames.push(fn),
    window: { innerWidth: 9999, innerHeight: 9999, addEventListener: (name, fn) => { events[name] = fn; } },
    ResizeObserver: class { constructor(fn) { observe = fn; } observe(el) { assert.equal(el, container); } },
    renderer: { setSize: (w, h) => sizes.push([w, h]) },
    cameraSystem: { onResize: (w, h) => aspects.push(w / h) },
    touchControls: { reset: () => resets.push('touch') }, placeRiderIndicator() {},
    mapSystem: { isFullMapOpen: true, cancelPan: () => resets.push('map'), resizeFullCanvas() {}, renderFullMap() {} }
  };
  runInNewContext(block, env);
  frames.shift()();
  assert.equal(sizes.length, 0, 'initial observer does not reallocate');
  for (const [w, h] of [[669, 867], [951, 585], [385, 571], [382, 580]]) {
    container.clientWidth = w; container.clientHeight = h;
    events.resize(); observe(); events.pageshow();
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.deepEqual(sizes.at(-1), [w, h]);
    assert.equal(aspects.at(-1), w / h);
  }
  assert.deepEqual(resets, Array(4).fill(['touch', 'map']).flat());
  container.clientHeight = 0;
  observe(); frames.shift()();
  assert.equal(sizes.length, 4, 'hidden state retains the previous target');
  container.clientHeight = 580;
  observe(); frames.shift()();
  assert.equal(sizes.length, 4, 'same-size restore does not reallocate');
  container.clientWidth = 594; container.clientHeight = 368;
  observe(); frames.shift()();
  assert.deepEqual(sizes.at(-1), [594, 368], 'host-only resize is sufficient');
});
