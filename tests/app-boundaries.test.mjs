import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlayerState } from '../js/player-state.js';

const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
function evaluate(code, env) {
  return new Function(...Object.keys(env), code)(...Object.values(env));
}

test('production map boundary gates all riding sources, clears camera capture and respects title/booking/failure', () => {
  const calls = [], record = name => (...args) => calls.push([name, ...args]);
  let options;
  const env = {
    controllerManager: { setInputEnabled: record('gate'), resetInput: record('reset') },
    cameraSystem: { _clearPointers: record('camera') }, trafficSystem: {}, cityBlocks: { allBlocks: [] },
    touchControls: { setEnabled: record('touch'), available: false }, gamepadControls: { setEnabled: record('pad') },
    titleScreen: { started: true, root: {} }, booking: { active: false }, startup: { failed: false },
    document: { getElementById: () => null }, resetFramePacing() {}, teleportTo() {},
    NYCMapSystem: class { constructor(value) { options = value; } }
  };
  const start = main.indexOf('  const mapSystem = new NYCMapSystem(');
  const end = main.indexOf('  teleportButtons.forEach', start);
  evaluate(main.slice(start, end), env);
  options.onToggle(true);
  assert.deepEqual(calls, [['gate', false], ['reset'], ['camera'], ['touch', false], ['pad', false]]);
  calls.length = 0;
  options.onToggle(false);
  assert.deepEqual(calls[0], ['gate', true]);
  for (const block of ['title', 'booking', 'failure']) {
    env.titleScreen.started = block !== 'title';
    env.booking.active = block === 'booking';
    env.startup.failed = block === 'failure';
    calls.length = 0;
    options.onToggle(false);
    assert.deepEqual(calls[0], ['gate', false], block);
  }
});

test('production save wiring preserves original bytes through init, title rider selection, hidden/pagehide until Ride', () => {
  let bytes = '{"version":99,"rider":"trollina"}';
  const original = bytes;
  const state = createPlayerState({ isPlayableRider: id => id === 'cool-rider', getStorage: () => ({
    getItem: () => bytes, setItem: (_key, value) => { bytes = value; }
  }) });
  const entity = { riderId: 'cool-rider', position: { x: 1, y: 0, z: 2 }, heading: .5 };
  const env = { playerState: state, controllerManager: { getActiveEntity: () => entity }, booking: { active: false },
    CIVIC_JAIL: { release: { x: 8, y: .22, z: 9, heading: 1 } } };
  const start = main.indexOf('  function savePlayerState()');
  const end = main.indexOf('\n  const cameraSystem', start);
  const save = evaluate(main.slice(start, end) + '\nreturn savePlayerState;', env);
  for (let i = 0; i < 3; i++) save();
  assert.equal(bytes, original);
  state.authorize(); save();
  assert.equal(JSON.parse(bytes).version, 2);
  env.booking.active = true; save();
  assert.deepEqual(JSON.parse(bytes).euc, env.CIVIC_JAIL.release, 'booking persists the outside checkpoint');
});

test('production booking placement requests checked occupancy before advancing, including sidewalk alternatives', () => {
  const calls = [], env = {
    BOOKING_SITE: { x: 12, y: .22 },
    controllerManager: {
      getActiveEntity: () => ({ placeAt(...args) { calls.push(args); return calls.length === 2; } }),
      findTeleportPosition: (x, z, heading, y) => ({ x, z, y, headingY: heading })
    }
  };
  const start = main.indexOf('  function placeAtJail('), end = main.indexOf('  function finishBooking()', start);
  const place = evaluate(main.slice(start, end) + '\nreturn placeAtJail;', env);
  assert.equal(place(20, 1), true);
  assert.equal(calls.length, 2, 'a refused occupied destination tries a nearby sidewalk alternative');
  for (const call of calls) {
    assert.equal(call[3], .22);
    assert.deepEqual(call[4], { requireClear: true, departure: 1.2 });
  }
});

test('restored time applies without writing preferences; an explicit same-value time choice is remembered', () => {
  const writes = [], applied = [];
  const env = { lightingSystem: { activePresetId: 'golden', applyPreset: id => applied.push(id) },
    colorGrade: { applyPreset() {} }, timeButtons: [], viewPreferences: { setTime: id => writes.push(id) } };
  const start = main.indexOf('  function selectTime('), end = main.indexOf('  // Popovers', start);
  const select = evaluate(main.slice(start, end) + '\nreturn selectTime;', env);
  select('golden', false);
  assert.deepEqual(applied, ['golden']); assert.deepEqual(writes, []);
  select('golden');
  assert.deepEqual(writes, ['golden']);
});
