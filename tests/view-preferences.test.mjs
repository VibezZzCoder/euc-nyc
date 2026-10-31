import assert from 'node:assert/strict';
import test from 'node:test';
import { createViewPreferences } from '../js/view-preferences.js';

const ids = { cameraIds: ['chase', 'action', 'pov', 'drone'], timeIds: ['golden', 'midday', 'twilight', 'midnight'] };
function harness(value = null) {
  const reads = [], writes = [];
  const storage = { getItem: (key) => { reads.push(key); return value; },
    setItem: (key, data) => { value = data; writes.push({ key, data }); } };
  return { prefs: createViewPreferences({ ...ids, getStorage: () => storage }), reads, writes, storage,
    get value() { return value; } };
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
  for (const raw of ['bad json', 'null', '[]', 'true', '42', '"saved"', '{"version":2,"camera":"pov","time":"midnight"}']) {
    const { prefs } = harness(raw);
    assert.equal(prefs.camera, 'chase');
    assert.equal(prefs.time, 'golden');
  }
  const { prefs } = harness('{"version":1,"camera":"removed","time":"twilight"}');
  assert.equal(prefs.camera, 'chase');
  assert.equal(prefs.time, 'twilight');
});

test('invalid selections and repeated getter reads do no storage work', () => {
  const h = harness();
  for (const id of [null, undefined, {}, 1, '__proto__', 'removed']) h.prefs.setCamera(id);
  for (const id of [null, undefined, {}, 1, 'constructor', 'removed']) h.prefs.setTime(id);
  for (let i = 0; i < 1000; i++) {
    assert.equal(h.prefs.camera, 'chase');
    assert.equal(h.prefs.time, 'golden');
  }
  assert.deepEqual(h.reads, ['euc-newyork-view-state']);
  assert.equal(h.writes.length, 0);
});

test('two tabs preserve the latest valid counterpart on explicit selections in either direction', () => {
  const h = harness(), a = h.prefs, b = createViewPreferences({ ...ids, getStorage: () => h.storage });
  a.setCamera('pov');
  assert.equal(b.camera, 'chase', 'there is no background/per-frame storage polling');
  b.setTime('midnight');
  assert.equal(b.camera, 'pov');
  assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'pov', time: 'midnight' });
  a.setCamera('action');
  assert.equal(a.time, 'midnight');
  assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'action', time: 'midnight' });
  b.setTime('twilight');
  assert.equal(b.camera, 'action');
  const next = createViewPreferences({ ...ids, getStorage: () => h.storage });
  assert.equal(next.camera, 'action');
  assert.equal(next.time, 'twilight');
});

test('same-value explicit selections refresh the counterpart and reassert the selected field', () => {
  const h = harness(), a = h.prefs, b = createViewPreferences({ ...ids, getStorage: () => h.storage });
  a.setCamera('pov');
  b.setTime('golden');
  assert.equal(b.camera, 'pov');
  assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'pov', time: 'golden' });
  b.setTime('midnight');
  a.setCamera('pov');
  assert.equal(a.time, 'midnight');
  assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'pov', time: 'midnight' });
  b.setCamera('action');
  a.setCamera('pov');
  assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'pov', time: 'midnight' }, 'the explicit selection wins over a newer value in its own field');
  assert.equal(h.reads.length, 8, 'one read per construction/valid explicit selection');
  assert.equal(h.writes.length, 6);
});

test('merge validates the latest counterpart independently and retains good in-memory fallbacks', () => {
  const invalid = ['bad json', 'null', 'true', '42', '[]', '{}',
    '{"version":2,"camera":"chase","time":"golden"}',
    '{"version":"1","camera":"chase","time":"golden"}',
    '{"version":1,"camera":"removed","time":"removed"}',
    '{"version":1,"camera":"__proto__","time":"constructor"}'];
  for (const raw of invalid) {
    const h = harness('{"version":1,"camera":"pov","time":"midnight"}');
    h.storage.getItem = () => raw;
    h.prefs.setCamera('action');
    assert.equal(h.prefs.time, 'midnight', raw);
    h.prefs.setTime('twilight');
    assert.equal(h.prefs.camera, 'action', raw);
    assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'action', time: 'twilight' });
  }
  const h = harness();
  h.storage.getItem = () => '{"version":1,"camera":"removed","time":"midnight"}';
  h.prefs.setCamera('action');
  assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'action', time: 'midnight' });
  h.storage.getItem = () => '{"version":1,"camera":"pov","time":"removed"}';
  h.prefs.setTime('twilight');
  assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'pov', time: 'twilight' });
});

test('unavailable or full storage never interrupts selecting a view', () => {
  for (const getStorage of [() => { throw new Error('denied'); }, () => null, () => undefined, () => ({}),
    () => ({ getItem: () => null, setItem: () => { throw new Error('full'); } })]) {
    const prefs = createViewPreferences({ ...ids, getStorage });
    prefs.setCamera('action');
    prefs.setTime('twilight');
    assert.equal(prefs.camera, 'action');
    assert.equal(prefs.time, 'twilight');
  }
});

test('a failed storage read keeps the in-memory counterpart instead of resetting it to a default', () => {
  const h = harness('{"version":1,"camera":"pov","time":"midnight"}');
  h.storage.getItem = () => { throw new Error('unreadable'); };
  h.prefs.setCamera('action');
  assert.equal(h.prefs.time, 'midnight');
  assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'action', time: 'midnight' });
  h.prefs.setTime('twilight');
  assert.equal(h.prefs.camera, 'action');
  assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'action', time: 'twilight' });
});

test('quota failures retain unsaved local choices across counterpart updates and retry them later', () => {
  for (const first of ['camera', 'time']) {
    const h = harness('{"version":1,"camera":"pov","time":"midnight"}'), setItem = h.storage.setItem;
    h.storage.setItem = () => { throw new Error('full'); };
    if (first === 'camera') {
      h.prefs.setCamera('action');
      h.prefs.setTime('twilight');
    } else {
      h.prefs.setTime('twilight');
      h.prefs.setCamera('action');
    }
    assert.equal(h.prefs.camera, 'action', first);
    assert.equal(h.prefs.time, 'twilight', first);
    assert.equal(h.writes.length, 0);
    assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'pov', time: 'midnight' });
    h.storage.setItem = setItem;
    h.prefs.setTime('twilight');
    assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'action', time: 'twilight' });
    const other = createViewPreferences({ ...ids, getStorage: () => h.storage });
    other.setCamera('drone');
    h.prefs.setTime('midday');
    assert.equal(h.prefs.camera, 'drone', 'a successful retry clears pending local precedence');
  }
});

test('a temporarily inaccessible storage accessor preserves local choices until it recovers', () => {
  const h = harness('{"version":1,"camera":"pov","time":"midnight"}');
  let available = true;
  const prefs = createViewPreferences({ ...ids, getStorage: () => {
    if (!available) throw new Error('denied');
    return h.storage;
  } });
  available = false;
  prefs.setCamera('action');
  prefs.setTime('twilight');
  assert.equal(prefs.camera, 'action');
  assert.equal(prefs.time, 'twilight');
  available = true;
  prefs.setCamera('action');
  assert.deepEqual(JSON.parse(h.value), { version: 1, camera: 'action', time: 'twilight' });
});
