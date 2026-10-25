import assert from 'node:assert/strict';
import test from 'node:test';
import { createViewPreferences } from '../js/view-preferences.js';

const ids = { cameraIds: ['chase', 'action', 'pov', 'drone'], timeIds: ['golden', 'midday', 'twilight', 'midnight'] };
function harness(value = null) {
  const writes = [];
  const storage = { getItem: () => value, setItem: (key, data) => { value = data; writes.push({ key, data }); } };
  return { prefs: createViewPreferences({ ...ids, getStorage: () => storage }), writes, storage };
}

test('fresh visits use defaults; explicit camera/time choices survive the next visit', () => {
  const h = harness();
  assert.equal(h.prefs.camera, 'chase');
  assert.equal(h.prefs.time, 'golden');
  assert.equal(h.writes.length, 0);
  h.prefs.setCamera('pov');
  h.prefs.setTime('midnight');
  const next = createViewPreferences({ ...ids, getStorage: () => h.storage });
  assert.equal(next.camera, 'pov');
  assert.equal(next.time, 'midnight');
  assert.ok(h.writes.every(({ key }) => key === 'euc-newyork-view-state'), 'view settings never overwrite the rider save');
});

test('unknown ids, malformed JSON and unsupported versions fall back independently', () => {
  for (const raw of ['bad json', 'null', '[]', '{"version":2,"camera":"pov","time":"midnight"}']) {
    const { prefs } = harness(raw);
    assert.equal(prefs.camera, 'chase');
    assert.equal(prefs.time, 'golden');
  }
  const { prefs } = harness('{"version":1,"camera":"removed","time":"twilight"}');
  assert.equal(prefs.camera, 'chase');
  assert.equal(prefs.time, 'twilight');
});

test('invalid and unchanged selections do no storage work', () => {
  const h = harness();
  for (const id of ['chase', null, '__proto__', 'removed']) h.prefs.setCamera(id);
  for (const id of ['golden', null, 'constructor', 'removed']) h.prefs.setTime(id);
  assert.equal(h.writes.length, 0);
});

test('unavailable or full storage never interrupts selecting a view', () => {
  for (const getStorage of [() => { throw new Error('denied'); }, () => ({ getItem: () => null, setItem: () => { throw new Error('full'); } })]) {
    const prefs = createViewPreferences({ ...ids, getStorage });
    prefs.setCamera('action');
    prefs.setTime('twilight');
    assert.equal(prefs.camera, 'action');
    assert.equal(prefs.time, 'twilight');
  }
});
