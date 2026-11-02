import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraphicsQualityPreference, createGraphicsQuality, GRAPHICS_QUALITY_KEY } from '../js/graphics-quality.js';

test('quality storage validates choices, writes only explicit changes and leaves other preferences alone', () => {
  const data = new Map([['euc-newyork-render-resolution', '75']]);
  let reads = 0, writes = 0;
  const storage = { getItem: key => { reads++; return data.get(key); },
    setItem: (key, value) => { writes++; data.set(key, value); } };
  const preference = createGraphicsQualityPreference(() => storage);
  assert.equal(preference.value, 'high');
  for (const invalid of [null, '', 'auto', 'HIGH', '__proto__', 1]) assert.equal(preference.set(invalid), false);
  assert.equal(preference.set('low'), true);
  assert.equal(preference.set('low'), false);
  for (let i = 0; i < 100; i++) assert.equal(preference.value, 'low');
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  assert.equal(createGraphicsQualityPreference(() => storage).value, 'low');
  assert.equal(data.get('euc-newyork-render-resolution'), '75');
  data.set(GRAPHICS_QUALITY_KEY, 'broken');
  assert.equal(createGraphicsQualityPreference(() => storage).value, 'high');
  const blocked = createGraphicsQualityPreference(() => { throw Error('blocked storage'); });
  assert.equal(blocked.set('medium'), true);
  assert.equal(blocked.value, 'medium');
});

function fixture(fail = false) {
  const allocations = [], sizes = [];
  const shadow = { intensity: 0.8, autoUpdate: true, needsUpdate: false,
    mapSize: { x: 3072, y: 3072, set(x, y) { this.x = x; this.y = y; } },
    getFrameExtents: () => ({ x: 2, y: 1 }), map: { setSize: (...size) => sizes.push(size) } };
  const graphics = createGraphicsQuality({ shadow, createPipeline(quality) {
    if (fail && quality === 'medium') throw Error('factory failed');
    const entry = { quality, parks: 0, disposed: 0, time: null,
      park() { this.parks++; }, dispose() { this.disposed++; }, applyTime(time) { this.time = time; } };
    allocations.push(entry);
    return entry;
  } });
  return { graphics, allocations, sizes, shadow };
}

test('repeated switching has three owners, parks old buffers, restores High and disposes exactly once', () => {
  const { graphics, allocations, sizes, shadow } = fixture();
  graphics.applyTime('midnight');
  graphics.apply('high');
  const original = graphics.current;
  for (let i = 0; i < 100; i++) {
    graphics.apply('medium');
    assert.deepEqual(sizes.at(-1), [2048, 1024]);
    assert.equal(shadow.autoUpdate, true);
    graphics.apply('low');
    assert.deepEqual(sizes.at(-1), [32, 16]);
    assert.equal(shadow.autoUpdate, false);
    assert.equal(shadow.needsUpdate, false);
    assert.equal(shadow.intensity, 0);
    graphics.apply('high');
    assert.equal(graphics.current, original);
    assert.deepEqual(sizes.at(-1), [6144, 3072]);
    assert.equal(shadow.autoUpdate, true);
    assert.equal(shadow.needsUpdate, true);
    assert.equal(shadow.intensity, 0.8);
  }
  assert.equal(allocations.length, 3);
  for (const entry of allocations) {
    assert.equal(entry.parks, 100);
    assert.equal(entry.time, 'midnight');
  }
  assert.equal(graphics.apply('high'), false);
  assert.equal(graphics.apply('nonsense'), false);
  assert.equal(sizes.length, 301);
  graphics.applyTime('twilight');
  assert.ok(allocations.every(entry => entry.time === 'twilight'));
  graphics.dispose(); graphics.dispose();
  assert.ok(allocations.every(entry => entry.disposed === 1));
  assert.equal(graphics.current, null);
  assert.equal(graphics.apply('low'), false);
  graphics.applyTime('golden');
  assert.ok(allocations.every(entry => entry.time === 'twilight'));
});

test('a factory failure leaves current resources owned and available for teardown', () => {
  const { graphics, allocations, sizes } = fixture(true);
  graphics.apply('high');
  assert.throws(() => graphics.apply('medium'), /factory failed/);
  assert.equal(graphics.value, 'high');
  assert.equal(graphics.current, allocations[0]);
  assert.equal(allocations[0].parks, 0);
  assert.equal(sizes.length, 1);
  graphics.dispose();
  assert.equal(allocations[0].disposed, 1);
});
