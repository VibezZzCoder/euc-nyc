import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEntity, flat } from './helpers/euc-entity.mjs';
import { EucController } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { EUC } from '../js/euc/data/tuning.js';
import { NycTerrainSampler } from '../js/euc-terrain.js';
import { createEucDynamicWorld } from '../js/euc-dynamic.js';
import { streetZ } from '../js/city-config.js';

const DT = 1 / 120;
const road = { x: 5.2, z: streetZ(37) - 8 };

test('entity catch-up: 20/24/30/60/120 Hz preserve stock 120 Hz physics and full elapsed time', () => {
  const native = new EucController(flat);
  const entities = [20, 24, 30, 60, 120].map(hz => ({ hz, e: createTestEntity() }));
  // Integer-second phase boundaries avoid frame-rate-dependent input sampling. Exercise charge and repeated hops too.
  for (let second = 0; second < 5; second++) {
    const keys = { forward: 0.3, right: second >= 3 ? 0.2 : 0, boost: second === 0, up: second === 1 || second === 2 };
    for (let i = 0; i < 120; i++) native.step(DT, { ...NEUTRAL_ACTIONS, throttle: keys.forward, steer: keys.right,
      crouch: keys.boost, hopHeld: keys.up, hop: i === 0 && (second === 1 || second === 2) });
    for (const { hz, e } of entities) {
      for (let i = 0; i < hz; i++) e.update(1 / hz, { ...keys, hopPressed: i === 0 && (second === 1 || second === 2) });
      assert.deepEqual(e.controller.snapshot(), native.snapshot(), `${hz} Hz after ${second + 1}s`);
    }
  }
});

test('long/invalid frames are bounded to six native steps, with fractional time retained', () => {
  const e = createTestEntity();
  let steps = 0;
  const step = e.controller.step.bind(e.controller);
  e.controller.step = (...args) => { steps++; return step(...args); };
  e.update(10, {}); assert.equal(steps, 6);
  e.update(0, {}); assert.equal(steps, 6, 'long-frame debt is discarded');
  for (const dt of [NaN, Infinity, -1]) e.update(dt, {});
  assert.equal(steps, 6);
  for (let i = 0; i < 12; i++) e.update(DT / 2, {});
  assert.equal(steps, 12, 'substep frames still accumulate');
});

test('explicit hop edge accepts the rising-air second press even if the previous held level was true', () => {
  const e = createTestEntity();
  e.update(DT, { up: true });
  for (let i = 0; i < 60 && !e.controller.canAcceptSpin; i++) e.update(DT, { up: true });
  assert.equal(e.controller.canAcceptSpin, true);
  e.update(0, { up: true, hopPressed: true });
  e.update(DT, { up: true });
  assert.equal(e.controller.snapshot().spins, 1, 'explicit edge is buffered even on a zero-step frame');
});

test('explicit reset edge survives an already-true level and an early substep recovery request', () => {
  const e = createTestEntity(new NycTerrainSampler(), road);
  e.update(DT, { reset: true }); // held while mounted: no recovery request yet
  e.controller.hardKnock(0, 1);
  e.controller.crashTime = EUC.crashRecoverEarliestSeconds;
  e.update(0, { reset: true, resetPressed: true });
  e.update(DT, { reset: true });
  assert.equal(e.controller.crashed, false);
});

test('touch-boundary clearInput retains held history, cancels trick intent and does not invent a hop edge', () => {
  const e = createTestEntity();
  e.update(DT, { up: true });
  for (let i = 0; i < 60 && !e.controller.canAcceptSpin; i++) e.update(DT, { up: true });
  e.tricks.announce('180');
  e.clearInput({ up: true });
  e.update(DT, { up: true });
  assert.equal(e.tricks.label, '');
  assert.equal(e.controller.snapshot().spins, 0, 'retained keyboard hold is not a second press after touch cancellation');
});

function presentation(e) {
  return structuredClone({ snapshot: e.controller.snapshot(), pose: e.pose, position: e.position.toArray(),
    heading: e.heading, speed: e.speed, drawn: e.rig.drawn, foot: e.rig.foot,
    tricks: e.tricks, events: e.events, spawn: e.controller.spawn, serial: e.controller.placementSerial });
}

test('checked placement refuses static standing-volume obstructions before reset and leaves state/presentation intact', () => {
  const s = new NycTerrainSampler({ boxes: [{ centre: { x: road.x, y: 1.4, z: road.z + 10 },
    halfExtents: { x: 3, y: 0.1, z: 3 }, rotationY: 0, surface: 'pavement', support: false }] });
  const e = createTestEntity(s, road);
  e.update(DT * 1.5, { forward: 0.6 }); e.tricks.announce('180');
  const before = presentation(e);
  let resets = 0;
  const reset = e.controller.reset.bind(e.controller);
  e.controller.reset = (...args) => { resets++; return reset(...args); };
  assert.equal(e.placeAt(road.x, road.z + 10, 0, 0, { requireClear: true }), false);
  assert.equal(resets, 0);
  assert.deepEqual(presentation(e), before);
  e.update(DT / 2, { forward: 0.6 });
  assert.ok(e.controller.snapshot().position.z > before.snapshot.position.z, 'failed placement kept fractional simulation time');
});

test('checked placement uses recover-reason dynamic occupancy locally; ordinary reset policy stays permissive', () => {
  let blocked = true;
  const world = createEucDynamicWorld({ bodiesNear(x, z, _radius, out) {
    if (blocked && z > road.z + 5) out.push({ x, z, headingY: 0, halfWidthMetres: 1, halfLengthMetres: 1, minY: 0, maxY: 2 });
  } });
  const reasons = [], canPlace = world.canPlace;
  world.canPlace = r => { reasons.push(r.reason); return canPlace(r); };
  const e = createTestEntity(new NycTerrainSampler(), { ...road, dynamicWorld: world });
  e.update(DT * 1.5, { forward: 0.3 }); e.tricks.announce('180');
  const before = presentation(e), lastCentre = world.ragObstacleBodies();
  reasons.length = 0;
  assert.equal(e.placeAt(road.x, road.z + 10, 0, 0, { requireClear: true }), false);
  assert.deepEqual(reasons, ['recover'], 'refusal happens before native reset');
  assert.deepEqual(presentation(e), before);
  assert.deepEqual(world.ragObstacleBodies(), lastCentre, 'speculative refusal keeps the wheel query centre');
  blocked = false;
  assert.equal(e.placeAt(road.x, road.z + 10, 0, 0, { requireClear: true }), true);
  assert.equal(e.tricks.label, '');
  assert.equal(e.position.z, road.z + 10);
  blocked = true;
  assert.equal(e.placeAt(road.x, road.z + 20), true, 'ordinary reset retains the original permissive policy');
  assert.equal(reasons.at(-1), 'reset');
});

test('native reset refusal leaves entity presentation untouched too', () => {
  const world = createEucDynamicWorld({ bodiesNear() {} });
  let refused = false;
  world.canPlace = r => !refused || r.reason !== 'reset';
  const e = createTestEntity(new NycTerrainSampler(), { ...road, dynamicWorld: world });
  e.update(DT * 1.5, { forward: 0.6 }); e.tricks.announce('180');
  const before = presentation(e);
  refused = true;
  assert.equal(e.placeAt(road.x, road.z + 10), false);
  assert.equal(e.controller.dynamicPlacementBlocked, true, 'native refusal diagnostic remains controller-owned');
  assert.deepEqual(presentation(e), before, 'entity retains interpolation, speed and tricks');
});

test('checked placement preserves selected floor and checks occupied body at that floor, not street height', () => {
  const { x, z } = road;
  const deck = { minX: x - 4, maxX: x + 4, minZ: z + 6, maxZ: z + 14,
    poly: [{ x: x - 4, z: z + 6 }, { x: x + 4, z: z + 6 }, { x: x + 4, z: z + 14 }, { x: x - 4, z: z + 14 }],
    top: 6, surface: 'wood', layered: true };
  const s = new NycTerrainSampler({ tops: [deck] });
  const queries = [];
  const world = createEucDynamicWorld({ bodiesNear(_x, _z, _r, out) {
    out.push({ x, z: z + 10, headingY: 0, halfWidthMetres: 1, halfLengthMetres: 1, minY: 0, maxY: 2 });
  } });
  const canPlace = world.canPlace;
  world.canPlace = r => { if (r.reason === 'recover') queries.push(structuredClone(r)); return canPlace(r); };
  const e = createTestEntity(s, { ...road, dynamicWorld: world });
  assert.equal(e.placeAt(x, z + 10, 0, 0, { requireClear: true }), false);
  assert.equal(e.placeAt(x, z + 10, 0, 6, { requireClear: true }), true);
  assert.equal(e.position.y, 6);
  assert.equal(e.pose.y, 6, 'placement drops the old interpolation history');
  assert.equal(queries[0].body.minY, 0);
  assert.equal(queries[1].body.minY, 6);
  assert.equal(queries[1].occupancyPose.y, 6);
  assert.equal(e.placeAt(x, z + 10, 0, Infinity, { requireClear: true }), true);
  assert.equal(e.position.y, 6);
});

test('direct checked entity placement retains native low-solid support without a city-top registration', () => {
  const { x, z } = road;
  const s = new NycTerrainSampler({ boxes: [{ centre: { x, y: 0.3, z: z + 10 },
    halfExtents: { x: 3, y: 0.3, z: 3 }, rotationY: 0, surface: 'pavement' }] });
  const e = createTestEntity(s, road);
  assert.equal(s.findPlacementTarget({ x, z: z + 10, registeredSurfaceOnly: true }), null);
  assert.equal(e.placeAt(x, z + 10, 0, 0.6, { requireClear: true }), true);
  assert.equal(e.position.y, 0.6);
  assert.equal(s.findRecoveryTarget({ fallen: { x, y: 0.9, z: z + 10 }, safePoints: [],
    headingY: 0, maxStepUp: e.controller.tuning.maxStepUp }, () => true).y, 0.6);
});

test('optional short departure refuses a nearby static wall before reset, preserving all placement state', () => {
  const { x, z } = road, destination = z + 10;
  const s = new NycTerrainSampler({ boxes: [{ centre: { x, y: 1, z: destination + 1.7 },
    halfExtents: { x: 3, y: 1, z: 0.05 }, rotationY: 0, surface: 'pavement', support: false }] });
  const e = createTestEntity(s, road);
  e.update(DT * 1.5, { forward: 0.4 }); e.tricks.announce('180');
  const before = presentation(e);
  let resets = 0;
  const reset = e.controller.reset.bind(e.controller);
  e.controller.reset = (...args) => { resets++; return reset(...args); };
  assert.ok(s.findPlacementTarget({ x, z: destination }), 'standing target itself is clear');
  assert.equal(e.placeAt(x, destination, 0, 0, { requireClear: true, departure: 1.2 }), false);
  assert.equal(resets, 0);
  assert.deepEqual(presentation(e), before);
  assert.equal(e.placeAt(x, destination, Math.PI, 0, { requireClear: true, departure: 1.2 }), true,
    'the same clear target facing away from the wall has a checked departure');
});

test('short departure rechecks moving-body occupancy ahead and succeeds only after it clears', () => {
  const { x, z } = road, destination = z + 10;
  let blocked = true;
  const requests = [];
  const world = createEucDynamicWorld({ bodiesNear(_x, _z, _r, out) {
    if (blocked) out.push({ x, z: destination + 1.7, headingY: 0, halfWidthMetres: 1, halfLengthMetres: 0.05, minY: 0, maxY: 2 });
  } });
  const canPlace = world.canPlace;
  world.canPlace = r => { requests.push(structuredClone(r)); return canPlace(r); };
  const e = createTestEntity(new NycTerrainSampler(), { ...road, dynamicWorld: world });
  e.update(DT * 1.5, { forward: 0.4 }); e.tricks.announce('180');
  const before = presentation(e);
  requests.length = 0;
  assert.equal(e.placeAt(x, destination, 0, 0, { requireClear: true, departure: 1.2 }), false);
  assert.deepEqual(presentation(e), before);
  assert.ok(requests.every(r => r.reason === 'recover'), 'refusal happened before native reset');
  assert.ok(requests.some(r => r.body.z > destination + 0.8), 'occupancy is checked ahead, not only at the arrival');
  blocked = false; requests.length = 0;
  assert.equal(e.placeAt(x, destination, 0, 0, { requireClear: true, departure: 1.2 }), true);
  assert.equal(requests.filter(r => r.reason === 'recover').length, 7, 'bounded origin plus six forward samples');
  assert.equal(requests.at(-1).reason, 'reset');
  assert.equal(e.position.z, destination, 'preflight does not move the rider along the checked route');
});

test('short departure refuses an unsupported deck edge and invalid/unbounded distances', () => {
  const { x, z } = road, destination = z + 10;
  const top = { minX: x - 3, maxX: x + 3, minZ: destination - 3, maxZ: destination + 1.4,
    poly: [{ x: x - 3, z: destination - 3 }, { x: x + 3, z: destination - 3 },
      { x: x + 3, z: destination + 1.4 }, { x: x - 3, z: destination + 1.4 }],
    top: 6, surface: 'pavement', layered: true };
  const e = createTestEntity(new NycTerrainSampler({ tops: [top] }), road);
  const before = presentation(e);
  assert.equal(e.placeAt(x, destination, 0, 6, { requireClear: true, departure: 1.2 }), false);
  for (const departure of [-1, NaN, Infinity, 1000]) {
    assert.equal(e.placeAt(x, z, 0, 0, { requireClear: true, departure }), false);
  }
  assert.deepEqual(presentation(e), before);
  assert.equal(e.placeAt(x, destination, 0, 6, { requireClear: true }), true, 'departure remains opt-in');
});
