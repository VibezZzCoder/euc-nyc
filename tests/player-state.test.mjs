import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayerState, PLAYER_STATE_KEY } from '../js/player-state.js';

const isPlayableRider = (id) => ['cool-rider', 'trollina'].includes(id);
const pose = { x: 12.5, y: 6, z: -30, heading: -0.75 };
const record = (version = 2, rider = 'trollina', euc = pose) => version === 1
  ? { version, rider, entities: { euc } } : { version, rider, euc };

function harness(value = null) {
  const reads = [], writes = [];
  let accesses = 0;
  const storage = {
    getItem(key) { reads.push(key); return value; },
    setItem(key, data) { writes.push({ key, data }); value = data; }
  };
  const state = createPlayerState({ isPlayableRider, getStorage: () => { accesses++; return storage; } });
  return { state, reads, writes, storage, get value() { return value; }, get accesses() { return accesses; } };
}

test('fresh visits have no saved rider or pose and do not create a save', () => {
  const h = harness();
  assert.equal(h.state.rider, null);
  assert.equal(h.state.pose, null);
  let placements = 0;
  assert.equal(h.state.restore(() => { placements++; return true; }), false);
  assert.equal(placements, 0);
  assert.equal(h.state.save(pose, 'cool-rider'), false);
  assert.equal(h.value, null);
  assert.deepEqual(h.reads, [PLAYER_STATE_KEY]);
  assert.equal(h.accesses, 1);
  assert.deepEqual(h.writes, []);
});

for (const version of [1, 2]) {
  test(`version ${version} restores only its EUC pose, keeping the original bytes before Ride`, () => {
    const source = record(version);
    // Ignore obsolete modes and the other version's layout, rather than using them as fallback.
    if (version === 1) source.euc = { ...pose, y: 200 };
    else source.entities = { euc: { ...pose, y: 200 } };
    const raw = ` \n${JSON.stringify(source, null, 2)}\n`;
    const h = harness(raw), placements = [];
    assert.equal(h.state.rider, 'trollina');
    assert.deepEqual(h.state.pose, pose);
    assert.equal(h.state.restore((savedPose) => { placements.push(savedPose); return true; }), true);
    assert.deepEqual(placements, [pose]);
    for (let i = 0; i < 3; i++) assert.equal(h.state.save({ ...pose, x: 99 }, 'cool-rider'), false);
    assert.equal(h.value, raw, 'restoration/lifecycle saves never migrate or replace bytes before Ride');
    assert.deepEqual(h.writes, []);
    assert.equal(h.accesses, 1, 'reading the snapshot, restoring and gated saves do no further storage work');
  });

  test(`version ${version} defaults missing Y to zero and accepts finite zero/negative/elevated poses`, () => {
    for (const euc of [{ x: 0, z: 0, heading: 0 }, { ...pose, y: -0.6 }, pose]) {
      const { state } = harness(JSON.stringify(record(version, 'cool-rider', euc)));
      assert.equal(state.rider, 'cool-rider');
      assert.deepEqual(state.pose, { ...euc, y: euc.y ?? 0 });
    }
  });
}

test('malformed JSON, primitives, unsupported versions and unsupported riders are never restored', () => {
  const invalid = ['{bad json', '', 'null', 'true', 'false', '42', '"saved"', '[]', '[{}]', '{}'];
  for (const version of [undefined, null, 0, 3, '1', '2']) invalid.push(JSON.stringify({ ...record(), version }));
  for (const rider of [undefined, null, '', 'removed-rider', '__proto__', 'constructor', 1, {}, []]) {
    for (const version of [1, 2]) invalid.push(JSON.stringify({ ...record(version), rider }));
  }
  for (const raw of invalid) {
    const h = harness(raw);
    assert.equal(h.state.rider, null, raw);
    assert.equal(h.state.pose, null, raw);
    let placements = 0;
    assert.equal(h.state.restore(() => { placements++; return true; }), false);
    assert.equal(placements, 0, raw);
    assert.equal(h.state.save(pose, 'cool-rider'), false);
    assert.equal(h.value, raw);
    assert.deepEqual(h.writes, []);
  }
});

test('a save requires the correct pose layout and strictly finite numeric coordinates', () => {
  const invalidPoses = [null, false, 7, 'pose', [], {}, { y: 0 }];
  for (const field of ['x', 'z', 'heading']) {
    const missing = { ...pose };
    delete missing[field];
    invalidPoses.push(missing);
  }
  for (const field of ['x', 'y', 'z', 'heading']) {
    for (const value of [null, '0', false, {}, [], NaN, Infinity, -Infinity]) {
      invalidPoses.push({ ...pose, [field]: value });
    }
  }
  for (const version of [1, 2]) {
    const invalidRecords = invalidPoses.map((euc) => JSON.stringify(record(version, 'cool-rider', euc)));
    for (const field of ['x', 'y', 'z', 'heading']) {
      // Unlike JSON.stringify(Infinity), valid JSON can decode an overflowing number to Infinity.
      invalidRecords.push(JSON.stringify(record(version)).replace(`"${field}":${pose[field]}`, `"${field}":1e999`));
    }
    const wrongLayout = version === 1 ? { version, rider: 'cool-rider', euc: pose }
      : { version, rider: 'cool-rider', entities: { euc: pose } };
    invalidRecords.push(JSON.stringify(wrongLayout));
    for (const raw of invalidRecords) {
      const h = harness(raw);
      assert.equal(h.state.rider, null, raw);
      assert.equal(h.state.pose, null, raw);
      let placements = 0;
      assert.equal(h.state.restore(() => { placements++; return true; }), false);
      assert.equal(placements, 0, raw);
      assert.equal(h.value, raw);
    }
  }
});

test('refused, throwing and non-boolean restoration never authorizes or changes the original save', () => {
  const raw = JSON.stringify(record(1), null, 2), h = harness(raw);
  for (const result of [false, undefined, null, 0, 1, 'true', {}, Promise.resolve(true)]) {
    assert.equal(h.state.restore(() => result), false);
    assert.equal(h.state.save(pose, 'cool-rider'), false);
  }
  assert.equal(h.state.restore(() => { throw new Error('unsafe placement'); }), false);
  for (const placeFn of [undefined, null, {}, true]) assert.equal(h.state.restore(placeFn), false);
  assert.equal(h.state.restore(() => true), true, 'a refused placement can be retried');
  assert.equal(h.state.save(pose, 'cool-rider'), false, 'even successful restoration is not Ride acceptance');
  assert.equal(h.value, raw);
  assert.deepEqual(h.writes, []);
});

test('only an explicit session start allows a current safe pose to replace failed or unknown saves', () => {
  for (const raw of [JSON.stringify(record(1), null, 2), JSON.stringify({ ...record(), version: 99 }), '{bad json', null]) {
    const h = harness(raw), current = { x: 100, y: -0.6, z: -200, heading: 2 };
    assert.equal(h.state.restore(() => false), false);
    assert.equal(h.state.save(current, 'cool-rider'), false);
    h.state.authorize();
    h.state.authorize();
    assert.equal(h.value, raw, 'authorization does not flush an earlier blocked save');
    assert.deepEqual(h.writes, []);
    assert.equal(h.state.save(current, 'cool-rider'), true);
    assert.deepEqual(JSON.parse(h.value), { version: 2, rider: 'cool-rider', euc: current });
    assert.deepEqual(h.writes.map(({ key }) => key), [PLAYER_STATE_KEY], 'no backup or unrelated storage keys');
    assert.deepEqual(h.reads, [PLAYER_STATE_KEY], 'saving never rereads storage');
  }
});

test('authorized writes validate rider/pose and persist only the canonical version 2 fields', () => {
  const h = harness(JSON.stringify(record()));
  h.state.authorize();
  for (const rider of [undefined, null, 'removed-rider', '__proto__', 'constructor', {}, 1]) {
    assert.equal(h.state.save(pose, rider), false);
  }
  const invalidPoses = [undefined, null, false, 0, 'pose', [], {}, { ...pose, y: null }];
  for (const field of ['x', 'y', 'z', 'heading']) {
    for (const value of ['0', false, NaN, Infinity, -Infinity]) invalidPoses.push({ ...pose, [field]: value });
  }
  for (const invalid of invalidPoses) assert.equal(h.state.save(invalid, 'cool-rider'), false);
  assert.equal(h.state.save({ get x() { throw new Error('bad pose'); } }, 'cool-rider'), false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.accesses, 1, 'invalid writes never access storage');
  assert.equal(h.state.save({ x: 0, z: 0, heading: 0, speed: 99, toJSON() { throw new Error('untrusted payload'); } }, 'cool-rider'), true);
  assert.deepEqual(JSON.parse(h.value), { version: 2, rider: 'cool-rider', euc: { x: 0, y: 0, z: 0, heading: 0 } });
  assert.equal(h.state.save(pose, 'trollina'), true);
  assert.deepEqual(JSON.parse(h.value), record());
});

test('the startup snapshot cannot be corrupted by callers or replaced by subsequent saves', () => {
  const { state } = harness(JSON.stringify(record()));
  assert.throws(() => { state.pose.x = Infinity; }, TypeError);
  assert.throws(() => { state.rider = 'removed-rider'; }, TypeError);
  assert.equal(state.restore((savedPose) => { savedPose.y = Infinity; return true; }), false);
  assert.deepEqual(state.pose, pose);
  state.authorize();
  assert.equal(state.save({ ...pose, x: 99 }, 'cool-rider'), true);
  assert.equal(state.rider, 'trollina');
  assert.deepEqual(state.pose, pose, 'rider/pose describe the startup read, not the latest write');
});

test('disabled, missing, unreadable or quota-limited storage never interrupts riding', () => {
  for (const getStorage of [
    () => { throw new Error('denied'); },
    () => undefined,
    () => null,
    () => ({}),
    () => ({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }),
    () => ({ getItem: () => JSON.stringify(record()), setItem() { throw new Error('quota'); } })
  ]) {
    const state = createPlayerState({ isPlayableRider, getStorage });
    assert.equal(state.save(pose, 'cool-rider'), false);
    state.authorize();
    assert.equal(state.save(pose, 'cool-rider'), false);
  }
});

test('storage can recover after startup or a failed write without another authorization', () => {
  const h = harness(), writes = h.writes;
  let available = false;
  const state = createPlayerState({ isPlayableRider, getStorage: () => {
    if (!available) throw new Error('denied');
    return h.storage;
  } });
  state.authorize();
  assert.equal(state.save(pose, 'trollina'), false);
  assert.deepEqual(writes, []);
  available = true;
  const setItem = h.storage.setItem;
  h.storage.setItem = () => { throw new Error('quota'); };
  assert.equal(state.save(pose, 'trollina'), false);
  h.storage.setItem = setItem;
  assert.equal(state.save(pose, 'trollina'), true);
  assert.deepEqual(JSON.parse(h.value), record());
});
