import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRenderResolutionPreference, drawingBufferRatio, RENDER_RESOLUTION_KEY } from '../js/render-resolution.js';

test('tiny drawing buffers retain legal five-mip half-resolution reflections without changing normal scale choices', () => {
  for (const [width, height] of [[1,1], [1,844], [20,20], [32,32], [320,568], [385,571], [951,585]]) {
    for (const scale of [1, 0.75, 0.5]) {
      const ratio = drawingBufferRatio(width, height, scale);
      const w = Math.floor(width * ratio), h = Math.floor(height * ratio);
      assert.ok(w >= 1 && h >= 1);
      assert.ok(Math.round(Math.max(w,h) * 0.5) >= 16, 'SSR mip level four needs a longest edge of at least 16');
      if (width >= 320 && height >= 320) assert.equal(ratio, scale, 'ordinary game viewports retain exact selected ratios');
    }
  }
});

test('3D resolution restores only supported choices and survives blocked storage independently of other saves', () => {
  const data = new Map([['euc-newyork-frame-rate', '30']]), writes = [];
  let reads = 0;
  const storage = { getItem(key) { reads++; return data.get(key); },
    setItem(key, value) { writes.push([key, value]); data.set(key, value); } };
  const pref = createRenderResolutionPreference(() => storage);
  assert.equal(pref.value, '100');
  assert.equal(pref.scale, 1);
  for (const bad of ['auto', '0', '25', '150', 75, '', null, '__proto__']) assert.equal(pref.set(bad), false);
  assert.equal(pref.set('75'), true);
  assert.equal(pref.set('75'), false);
  for (let i = 0; i < 1000; i++) assert.equal(pref.scale, 0.75);
  assert.equal(reads, 1, 'no frame-by-frame storage reads');
  assert.deepEqual(writes, [[RENDER_RESOLUTION_KEY, '75']]);
  assert.equal(createRenderResolutionPreference(() => storage).scale, 0.75);
  pref.set('50');
  assert.equal(createRenderResolutionPreference(() => storage).scale, 0.5);
  pref.set('100');
  assert.equal(createRenderResolutionPreference(() => storage).scale, 1);
  assert.equal(data.get('euc-newyork-frame-rate'), '30');
  data.set(RENDER_RESOLUTION_KEY, 'bad');
  assert.equal(createRenderResolutionPreference(() => storage).scale, 1);
  const blocked = createRenderResolutionPreference(() => { throw Error('blocked'); });
  assert.equal(blocked.scale, 1);
  assert.equal(blocked.set('50'), true);
  assert.equal(blocked.scale, 0.5);
});

test('native resolution selector resets held input, coalesces changes and preserves keyboard focus', () => {
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const wiring = main.slice(main.indexOf('  const resolutionLimit ='), main.indexOf('  const elMode ='));
  const handlers = {}, writes = [];
  let inputReset = 0, scheduled = 0, blur = 0;
  const select = { value: '', addEventListener: (key, fn) => { handlers[key] = fn; }, blur: () => { blur++; } };
  const pref = createRenderResolutionPreference(() => ({ getItem: () => '75', setItem: (...args) => writes.push(args) }));
  new Function('document', 'resolutionPreference', 'controllerManager', 'scheduleViewportResize', wiring)(
    { getElementById: id => { assert.equal(id, 'render-resolution'); return select; } }, pref,
    { resetInput: () => { inputReset++; } }, () => { scheduled++; });
  assert.equal(select.value, '75');
  handlers.focus();
  assert.equal(inputReset, 1);
  handlers.pointerdown(); select.value = '50'; handlers.change();
  assert.equal(blur, 1);
  assert.equal(scheduled, 1);
  handlers.pointerdown(); handlers.keydown(); select.value = '100'; handlers.change();
  assert.equal(blur, 1, 'keyboard selection retains native focus');
  assert.equal(scheduled, 2);
  handlers.change();
  assert.equal(scheduled, 2, 'same value cannot manufacture another resize');
  assert.deepEqual(writes, [[RENDER_RESOLUTION_KEY, '50'], [RENDER_RESOLUTION_KEY, '100']]);
});
