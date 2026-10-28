// Headless: the vendored EUC controller meeting moving cars and people through js/euc-dynamic.js, on New York's real
// street layout (js/euc-terrain.js). No browser, no three.js: the bodies come from a fake bodiesNear, as js/traffic.js
// would report them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EucController } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { SIMULATION, EUC } from '../js/euc/data/tuning.js';
import { NycTerrainSampler } from '../js/euc-terrain.js';
import { streetZ } from '../js/city-config.js';
import { createEucDynamicWorld, sweepBodies, overlaps, EUC_DYNAMIC_HULL } from '../js/euc-dynamic.js';
import profiles from './car-profile-fixture.cjs';

const DT = 1 / SIMULATION.hz;
const SPAWN_Z = streetZ(37); // controllers.js: 5th Ave at 37th St
const ROAD = { x: 5.2, z: SPAWN_Z - 8 }; // on the 5th Ave roadway, heading +Z runs down the avenue

function car(x, z, headingY = 0, speed = 0) {
  return { kind: 'vehicle', x, z, headingY, halfWidthMetres: 0.86, halfLengthMetres: 2.18, minY: 0, maxY: 1.5,
    crashProfile: profiles.carCrashProfile(profiles.BODY_SPECS.sedan),
    velocityX: Math.sin(headingY) * speed, velocityZ: Math.cos(headingY) * speed };
}

function person(x, z, headingY = 0, speed = 0) {
  return { kind: 'person', x, z, headingY, halfWidthMetres: 0.3, halfLengthMetres: 0.3, minY: 0, maxY: 1.8,
    velocityX: Math.sin(headingY) * speed, velocityZ: Math.cos(headingY) * speed };
}

/** A world over a list of bodies the test moves itself, like traffic.js between frames. */
function worldOf(bodies) {
  let queries = 0;
  const world = createEucDynamicWorld({
    bodiesNear(x, z, radius, out) {
      queries++;
      for (const b of bodies) {
        const reach = radius + Math.hypot(b.halfWidthMetres, b.halfLengthMetres);
        if ((b.x - x) ** 2 + (b.z - z) ** 2 <= reach * reach) out.push(b);
      }
    },
  });
  return { world, queries: () => queries };
}

function rider(world, { x = ROAD.x, z = ROAD.z, headingY = 0, speed = 0 } = {}) {
  const euc = new EucController(new NycTerrainSampler(), {
    spawn: { position: { x, y: 0, z }, headingY },
    dynamicWorld: world,
  });
  if (speed) euc.reset(undefined, speed);
  return euc;
}

/** Step `seconds`, moving every body by its velocity each step; returns what happened. */
function ride(euc, seconds, actions, bodies = []) {
  let blocked = false, maxImpact = 0;
  for (let i = 0, n = Math.round(seconds * SIMULATION.hz); i < n; i++) {
    for (const b of bodies) {
      b.x += b.velocityX * DT;
      b.z += b.velocityZ * DT;
    }
    euc.step(DT, actions);
    const s = euc.snapshot();
    blocked ||= s.blocked;
    maxImpact = Math.max(maxImpact, s.collisionImpact);
  }
  return { snap: euc.snapshot(), blocked, maxImpact };
}

const GO = { ...NEUTRAL_ACTIONS, throttle: 1 };
const HOLD = { ...NEUTRAL_ACTIONS, throttle: 0.15 };

for (const speed of [6, 8, 12]) for (const heading of [0, Math.PI / 4, -Math.PI / 4]) {
  test(`vehicle wipeout at ${speed} m/s, heading ${heading}: bounded directional launch and deterministic fall`, () => {
    function run() {
      const parked = car(ROAD.x, ROAD.z + 4);
      const { world } = worldOf([parked]);
      // Native flat ground isolates the car face from the avenue's nearby kerbs.
      const euc = new EucController(new NycTerrainSampler().boxes, { dynamicWorld: world,
        spawn: { position: { x: ROAD.x - Math.sin(heading) * 2, y: 0, z: ROAD.z }, headingY: heading } });
      euc.reset(undefined, speed);
      for (let i = 0; i < 120 && !euc.crashed; i++) euc.step(DT, NEUTRAL_ACTIONS);
      assert.equal(euc.crashed, true);
      const start = [...euc.ragdoll.positions];
      const velocities = start.map((v, i) => (v - euc.ragdoll.previous[i]) / DT);
      for (let i = 0; i < velocities.length; i += 3) {
        assert.ok(Math.hypot(...velocities.slice(i, i + 3)) <= 15.00001, 'stock ragdoll launch cap');
        if (heading) assert.ok(velocities[i] * Math.sign(heading) > speed * 0.45, 'glance retains substantial tangential carry');
        else assert.ok(velocities[i + 2] > speed * 0.7, 'wheel stops, but the rider retains forward inertia');
      }
      for (let i = 0; i < 120; i++) euc.step(DT, NEUTRAL_ACTIONS);
      const finish = [...euc.ragdoll.positions];
      assert.ok(finish.every(Number.isFinite));
      if (heading) assert.ok((finish[0] - start[0]) * Math.sign(heading) > 0.1, 'tangential launch survives actual contact solving');
      return { start, velocities, finish };
    }
    assert.deepEqual(run(), run());
  });
}

test('a car striking a stationary rider seeds forward body motion; a pedestrian keeps the native response', () => {
  for (const kind of ['vehicle', 'person']) {
    const moving = { ...car(ROAD.x, ROAD.z - 2.6, 0, 8), kind };
    const { world } = worldOf([moving]);
    const euc = rider(world);
    euc.step(DT, NEUTRAL_ACTIONS);
    assert.equal(euc.crashed, true);
    const vz = (euc.ragdoll.positions[2] - euc.ragdoll.previous[2]) / DT;
    if (kind === 'vehicle') assert.ok(vz > 6 && vz <= 8, `vehicle launch ${vz}`);
    else assert.equal(vz, 0, 'non-vehicle response unchanged');
  }
});

test('crash-body queries cover a separated rider and keep the wheel neighbourhood', () => {
  const near = car(ROAD.x, ROAD.z), far = car(ROAD.x, ROAD.z + 20);
  const { world } = worldOf([near, far]);
  rider(world);
  const bodies = world.ragObstacleBodies({ x: ROAD.x, z: ROAD.z + 20 });
  assert.deepEqual(bodies, [near, far]);
  assert.deepEqual(world.ragObstacleBodies(), [near], 'body query did not replace wheel centre');
  world.canPlace({ reason: 'recover', body: { ...EUC_DYNAMIC_HULL, x: far.x, z: far.z, headingY: 0, minY: 0, maxY: 1.9 } });
  assert.deepEqual(world.ragObstacleBodies(), [near], 'refused speculative recovery did not replace wheel centre');
});

test('the world is the controller\'s EucDynamicWorld shape, with the shared rider hull', () => {
  const { world } = worldOf([]);
  assert.deepEqual(world.hull, { ...EUC_DYNAMIC_HULL });
  assert.equal(world.occupantKind, 'human');
  for (const key of ['resolveMotion', 'canPlace', 'didPlace', 'ragObstacleBodies']) assert.equal(typeof world[key], 'function');
  assert.ok(EUC.obstacleCrashSpeed > 3 && EUC.obstacleCrashSpeed < 4, 'the crash threshold these tests assume');
  const euc = rider(world);
  assert.equal(euc.crashed, false, 'an empty world places the rider');
});

test('riding fast into a parked car crashes (obstacle) and never passes through it', () => {
  const parked = car(ROAD.x, ROAD.z + 12);
  const { world } = worldOf([parked]);
  const euc = rider(world, { speed: 7 });
  let maxZ = -Infinity, crashed = false, recovered = false;
  for (let i = 0; i < 4 * SIMULATION.hz; i++) {
    euc.step(DT, GO);
    const s = euc.snapshot();
    recovered ||= crashed && !s.crashed;
    if (!recovered) maxZ = Math.max(maxZ, s.position.z);
    assert.equal(overlaps({ x: s.position.x, z: s.position.z, headingY: s.headingY,
      ...EUC_DYNAMIC_HULL, minY: s.position.y, maxY: s.position.y + 1.9 }, parked), false,
    'mounted/crash wheel and recovered rider never overlap the parked car');
    crashed ||= s.crashed;
  }
  const s = euc.snapshot();
  assert.ok(crashed, 'the rider crashed');
  assert.equal(s.crashCause, 'obstacle');
  assert.equal(s.crashes, 1);
  const face = parked.z - parked.halfLengthMetres - EUC_DYNAMIC_HULL.halfLengthMetres;
  assert.ok(maxZ <= face + 1e-6, `the rider stopped at the car's rear face (max z ${maxZ.toFixed(3)} vs ${face.toFixed(3)})`);
});

test('the same car without the dynamic world is ridden straight through (negative control)', () => {
  const parked = car(ROAD.x, ROAD.z + 12);
  const euc = rider(undefined, { speed: 7 });
  const { snap } = ride(euc, 4, GO);
  assert.ok(snap.position.z > parked.z + parked.halfLengthMetres, 'no world, no contact');
  assert.equal(snap.crashed, false);
});

test('rolling slowly into a parked car is blocked without a crash', () => {
  const parked = car(ROAD.x, ROAD.z + 2.2 + 0.5 + 0.6);
  const { world } = worldOf([parked]);
  const euc = rider(world, { speed: 1.5 });
  const { snap, blocked, maxImpact } = ride(euc, 3, HOLD);
  assert.ok(blocked, 'the car blocked the wheel');
  assert.ok(maxImpact < EUC.obstacleCrashSpeed, `impact ${maxImpact}`);
  assert.equal(snap.crashed, false);
  assert.ok(snap.position.z <= parked.z - parked.halfLengthMetres - EUC_DYNAMIC_HULL.halfLengthMetres + 1e-6);
});

test('a car driving into a standing rider at 8 m/s crashes them', () => {
  // a car coming up the avenue behind the rider (heading +Z), its nose 3 m behind the rider's back
  const moving = car(ROAD.x, ROAD.z - 3 - 2.18 - 0.5, 0, 8);
  const { world } = worldOf([moving]);
  const euc = rider(world);
  const { snap, maxImpact } = ride(euc, 1, NEUTRAL_ACTIONS, [moving]);
  assert.equal(snap.crashed, true);
  assert.equal(snap.crashCause, 'obstacle');
  assert.ok(maxImpact >= 7.9, `closing speed ${maxImpact}`);
});

test('a car creeping into a standing rider at 1 m/s only blocks them', () => {
  const creeping = car(ROAD.x, ROAD.z - 0.3 - 2.18 - 0.5, 0, 1);
  const { world } = worldOf([creeping]);
  const euc = rider(world);
  const { snap, maxImpact } = ride(euc, 1, NEUTRAL_ACTIONS, [creeping]);
  assert.ok(maxImpact > 0.5 && maxImpact < EUC.obstacleCrashSpeed, `closing speed ${maxImpact}`);
  assert.equal(snap.crashed, false);
});

test('a car passing 3 m to the side changes nothing', () => {
  const passing = car(ROAD.x + 3, ROAD.z - 20, 0, 10);
  const { world } = worldOf([passing]);
  const euc = rider(world, { speed: 2 });
  const control = rider(undefined, { speed: 2 });
  const hit = ride(euc, 4, HOLD, [passing]);
  const ref = ride(control, 4, HOLD);
  assert.ok(passing.z > ROAD.z + 10, 'the car really went by');
  assert.equal(hit.blocked, false);
  assert.equal(hit.maxImpact, 0);
  assert.equal(hit.snap.crashed, false);
  assert.deepEqual(hit.snap.position, ref.snap.position, 'identical ride to the no-world control');
});

test('riding into a pedestrian at speed crashes the rider', () => {
  const walker = person(ROAD.x, ROAD.z + 10, Math.PI, 1.4); // walking toward the rider
  const { world } = worldOf([walker]);
  const euc = rider(world, { speed: 6 });
  let atCrash = null;
  for (let i = 0; i < 3 * SIMULATION.hz && !atCrash; i++) {
    walker.z += walker.velocityZ * DT;
    euc.step(DT, GO);
    if (euc.crashed) atCrash = euc.snapshot();
  }
  assert.ok(atCrash, 'the rider crashed');
  assert.equal(atCrash.crashCause, 'obstacle');
  assert.ok(atCrash.collisionImpact >= 6, `closing speed ${atCrash.collisionImpact}: the rider's and the walker's`);
  // (the walker's own step toward the rider may overlap them by its 1.2 cm per step)
  assert.ok(atCrash.position.z <= walker.z - 0.3 - 0.5 + 0.02, 'the rider stopped at the person, not through them');
});

test('the crashed rider\'s ragdoll is offered the nearby bodies, in the ragdoll\'s prism shape', () => {
  const parked = car(ROAD.x, ROAD.z + 12);
  const far = car(ROAD.x + 40, ROAD.z);
  const { world } = worldOf([parked, far]);
  assert.deepEqual(world.ragObstacleBodies(), [], 'nothing known before the first query');
  const euc = rider(world, { speed: 7 });
  ride(euc, 2, GO);
  const bodies = world.ragObstacleBodies();
  assert.deepEqual(bodies, [parked]);
  for (const key of ['x', 'z', 'headingY', 'halfWidthMetres', 'halfLengthMetres', 'minY', 'maxY']) {
    assert.ok(Number.isFinite(bodies[0][key]), key);
  }
});

test('crash recovery refuses a spot inside a car; teleports are never refused', () => {
  const blocker = car(0, 0);
  const { world } = worldOf([blocker]);
  const body = { x: 0, z: 0.5, headingY: 0, minY: 0, maxY: 1.9, halfWidthMetres: 0.35, halfLengthMetres: 0.5, velocityX: 0, velocityZ: 0 };
  assert.equal(world.canPlace({ reason: 'recover', body }), false);
  assert.equal(world.canPlace({ reason: 'reset', body }), true);
  assert.equal(world.canPlace({ reason: 'recover', body: { ...body, x: 3 } }), true);
});

test('sweep geometry: rotated boxes, heights and the outward normal', () => {
  const out = { fraction: 1, nx: 0, nz: 0, closing: 0 };
  const hull = { headingY: 0, minY: 0, maxY: 1.9, halfWidthMetres: 0.35, halfLengthMetres: 0.5 };
  // moving +X into a car turned across the way (heading 90 degrees: its length along X)
  const across = car(5, 0, Math.PI / 2);
  const a = { ...hull, x: 0, z: 0, velocityX: 0, velocityZ: 0 };
  const b = { ...hull, x: 4, z: 0, velocityX: 40, velocityZ: 0 };
  assert.equal(sweepBodies(a, b, [across], out), true);
  // contact when the rider's +X face (0.35) meets the car's -X end (5 - 2.18)
  assert.ok(Math.abs(out.fraction * 4 - (5 - 2.18 - 0.35)) < 0.01, `fraction ${out.fraction}`);
  assert.equal(out.nx, -1);
  assert.ok(Math.abs(out.nz) < 1e-12);
  assert.equal(out.closing, 40);
  // the same move high above the car's roof is clear
  assert.equal(sweepBodies({ ...a, minY: 2, maxY: 3.9 }, { ...b, minY: 2, maxY: 3.9 }, [across], out), false);
  // already inside, moving out: allowed in full
  const inside = { ...hull, x: 3, z: 0, velocityX: 0, velocityZ: 0 };
  const out1 = { ...hull, x: 2.9, z: 0, velocityX: -12, velocityZ: 0 };
  assert.equal(sweepBodies(inside, out1, [across], out), false);
  assert.equal(overlaps(inside, across), true);
  assert.equal(overlaps({ ...inside, x: 2 }, across), false);
});

test('a version getter lets one bodies query serve many steps', () => {
  let version = 0, queries = 0;
  const parked = car(ROAD.x, ROAD.z + 30);
  const world = createEucDynamicWorld({
    bodiesNear(x, z, radius, out) { queries++; out.push(parked); },
    version: () => version,
  });
  const euc = rider(world);
  ride(euc, 0.5, NEUTRAL_ACTIONS);
  assert.equal(queries, 1, 'standing still within one traffic frame: one query');
  version++;
  ride(euc, 0.1, NEUTRAL_ACTIONS);
  assert.equal(queries, 2, 'the bodies moved: queried again');
  assert.ok(world.stats.resolves > 60);
});

test('combineBodySources joins street and highway traffic, including late-bound sources', async () => {
  const { combineBodySources } = await import('../js/euc-dynamic.js');
  let streetVersion = 3, highway = null;
  const street = { dynamicBodiesNear: (x, z, r, out) => out.push(car(0, 0)), bodyVersion: () => streetVersion };
  const joined = combineBodySources(street, () => highway);
  const out = [];
  joined.bodiesNear(0, 0, 6, out);
  assert.equal(out.length, 1, 'a missing source is skipped');
  const before = joined.version();
  highway = { dynamicBodiesNear: (x, z, r, list) => list.push(car(5, 0)), bodyVersion: () => 0 };
  out.length = 0;
  joined.bodiesNear(0, 0, 6, out);
  assert.equal(out.length, 2);
  streetVersion++;
  assert.notEqual(joined.version(), before);
  assert.equal(combineBodySources({ dynamicBodiesNear() {} }).version, null, 'unversioned: query every call');
  const world = createEucDynamicWorld(joined);
  assert.equal(typeof world.resolveMotion, 'function');
});
