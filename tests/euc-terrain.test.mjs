// Headless: the vendored EUC controller riding New York's real street layout through js/euc-terrain.js.
// No browser, no three.js. Buildings here are synthetic boxes (the real colliders are built by three.js scene code);
// the curbs, parks and shore are the city's own (city-config.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EucController, createPose } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { SIMULATION } from '../js/euc/data/tuning.js';
import { NycTerrainSampler, boxesFromCityColliders, boxesFromFootprints } from '../js/euc-terrain.js';
import { blockAt, streetZ, ISLAND_BOUNDS } from '../js/city-config.js';

const DT = 1 / SIMULATION.hz;
const SPAWN_Z = streetZ(37); // controllers.js: 5th Ave at 37th St
const ROAD = { x: 5.2, z: SPAWN_Z - 8 }; // the cyclist's spawn, on the 5th Ave roadway

function ride(euc, seconds, actions) {
  for (let i = 0, n = Math.round(seconds * SIMULATION.hz); i < n; i++) euc.step(DT, actions);
  return euc.snapshot();
}

/** First x east of `x0` (on z) where the curb island begins. */
function curbEastOf(x0, z) {
  for (let x = x0; x < x0 + 60; x += 0.01) if (blockAt(x, z)) return x;
  throw new Error('no curb found');
}

test('the spawn is on the roadway, and the curb beside it is the city\'s sidewalk height', () => {
  const s = new NycTerrainSampler();
  const g = s.sampleGround(ROAD.x, ROAD.z, { height: NaN, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: true });
  assert.equal(g.height, 0);
  assert.equal(g.offCourse, false);
  const curb = curbEastOf(ROAD.x, ROAD.z);
  assert.equal(s.sampleGround(curb + 0.5, ROAD.z, g).height, ISLAND_BOUNDS.sidewalkHeight);
});

test('throttle rides south down 5th Ave (+Z) on the road without crashing', () => {
  const euc = new EucController(new NycTerrainSampler(), { spawn: { position: { x: ROAD.x, y: 0, z: ROAD.z }, headingY: 0 } });
  const snap = ride(euc, 4, { ...NEUTRAL_ACTIONS, throttle: 1 });
  assert.ok(snap.speed > 5, `speed ${snap.speed}`);
  assert.ok(snap.position.z > ROAD.z + 10, `z ${snap.position.z}`);
  assert.ok(Math.abs(snap.position.x - ROAD.x) < 1e-6);
  assert.equal(euc.crashed, false);
  const pose = createPose();
  euc.writePose(pose);
  assert.ok(Math.abs(pose.y) < 0.05, `y ${pose.y}`);
});

// Manhattan's curbs are 0.22 m (city-config.js). The stock wheel climbs 1.35 x pedal height = 0.216 m: just short.
function curbApproach(tuning) {
  const z = ROAD.z;
  const curb = curbEastOf(ROAD.x, z);
  const euc = new EucController(new NycTerrainSampler(), {
    spawn: { position: { x: curb - 6, y: 0, z }, headingY: Math.PI / 2 }, // +X: straight at the east curb
    tuning,
  });
  const snap = ride(euc, 3, { ...NEUTRAL_ACTIONS, throttle: 0.5 });
  return { curb, snap, euc };
}

test('stock tuning: an unhopped 0.22 m Manhattan curb stops the wheel at its face', () => {
  const { curb, snap } = curbApproach(undefined);
  assert.ok(snap.position.x < curb + 0.05, `x ${snap.position.x} vs curb ${curb}`);
  assert.ok(snap.position.y < 0.05);
});

// Not the game's tuning (the owner chose stock tuning: kerbs must be hopped). Kept to document the 0.22 m margin.
test('maxStepUp 0.24 (not used): the same curb would be mounted unhopped', () => {
  const { curb, snap, euc } = curbApproach({ maxStepUp: 0.24 });
  assert.ok(snap.position.x > curb + 0.5, `x ${snap.position.x} vs curb ${curb}`);
  assert.ok(Math.abs(snap.position.y - ISLAND_BOUNDS.sidewalkHeight) < 0.03, `y ${snap.position.y}`);
  assert.equal(euc.crashed, false);
});

test('stock tuning: a hop clears the curb', () => {
  const z = ROAD.z;
  const curb = curbEastOf(ROAD.x, z);
  const euc = new EucController(new NycTerrainSampler(), { spawn: { position: { x: curb - 12, y: 0, z }, headingY: Math.PI / 2 } });
  const go = { ...NEUTRAL_ACTIONS, throttle: 0.6 };
  let hopped = false;
  for (let i = 0; i < 4 * SIMULATION.hz; i++) {
    const s = euc.snapshot();
    const hop = !hopped && s.position.x > curb - 1.6 && euc.canAcceptHop;
    if (hop) hopped = true;
    euc.step(DT, hop ? { ...go, hop: true, hopHeld: true } : go);
  }
  const snap = euc.snapshot();
  assert.ok(hopped, 'the hop was accepted');
  assert.ok(snap.position.x > curb + 0.5, `x ${snap.position.x} vs curb ${curb}`);
  assert.ok(Math.abs(snap.position.y - ISLAND_BOUNDS.sidewalkHeight) < 0.03, `y ${snap.position.y}`);
});

test('a building collider (OBB) is a wall: the wheel does not pass through it', () => {
  const z = ROAD.z + 20;
  // A 10 m box across the roadway, rotated 20 degrees, in controllers.js collider format
  const cs = Math.cos(0.35), sn = Math.sin(0.35);
  const obb = { cx: ROAD.x, cz: z, hx: 6, hz: 3, cs, sn };
  const boxes = boxesFromCityColliders([{ minX: ROAD.x - 8, maxX: ROAD.x + 8, minZ: z - 8, maxZ: z + 8, maxY: 40, obb }]);
  const sampler = new NycTerrainSampler({ boxes });
  const euc = new EucController(sampler, { spawn: { position: { x: ROAD.x, y: 0, z: ROAD.z }, headingY: 0 } });
  const snap = ride(euc, 6, { ...NEUTRAL_ACTIONS, throttle: 1 });
  // Local frame of the box (same transform as controllers.js)
  const dx = snap.position.x - obb.cx, dz = snap.position.z - obb.cz;
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  assert.ok(!(Math.abs(lx) < obb.hx && Math.abs(lz) < obb.hz), `inside the box at local (${lx}, ${lz})`);
  assert.ok(snap.position.z < z, `z ${snap.position.z}`);
});

test('a lamp post footprint is solid to the wheel and does not occlude the camera ray', () => {
  const z = ROAD.z + 15;
  const post = { minX: ROAD.x - 0.2, maxX: ROAD.x + 0.2, minZ: z - 0.2, maxZ: z + 0.2 };
  const sampler = new NycTerrainSampler({ boxes: boxesFromFootprints([post]) });
  const origin = { x: ROAD.x, y: 0.5, z: ROAD.z };
  assert.ok(sampler.raycastObstacle(origin, { x: 0, y: 0, z: 1 }, 30) !== null);
  assert.equal(sampler.raycast({ ...origin, y: 1.5 }, { x: 0, y: 0, z: 1 }, 30), null);
  const euc = new EucController(sampler, { spawn: { position: { x: ROAD.x, y: 0, z: ROAD.z }, headingY: 0 } });
  const snap = ride(euc, 5, { ...NEUTRAL_ACTIONS, throttle: 1 });
  assert.ok(snap.position.z < post.minZ, `z ${snap.position.z}`);
});

test('the shore is a wall: riding at the Hudson stops short of the water', () => {
  const sampler = new NycTerrainSampler();
  const g = { height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false };
  assert.ok(sampler.sampleGround(ISLAND_BOUNDS.minX - 50, ROAD.z, g).height > 1);
});

// ---- Central Park: raised behind its real wall, ridden in by the gates (city-config.js CENTRAL_PARK_GATES) ----------
import { CENTRAL_PARK_GATES, CENTRAL_PARK_GATE_SIZE, CENTRAL_PARK_TOP, inCentralPark } from '../js/city-config.js';

const probe = () => ({ height: NaN, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: true });

test('Central Park follows its wall, not its bounding box: Grand Army Plaza\'s corner is outside', () => {
  const s = new NycTerrainSampler();
  assert.equal(inCentralPark(-400, -2000), true);
  assert.equal(s.sampleGround(-400, -2000, probe()).height, CENTRAL_PARK_TOP);
  assert.equal(inCentralPark(-40, -1420), false, 'the plaza at 5th Ave & 59th St');
  assert.ok(s.sampleGround(-40, -1420, probe()).height < 1, 'not the park lawn');
});

test('every gate is a ramp from the sidewalk or road outside to the lawn, gentle enough to ride up', () => {
  const s = new NycTerrainSampler();
  const { width, length } = CENTRAL_PARK_GATE_SIZE;
  assert.ok(CENTRAL_PARK_GATES.length >= 10);
  for (const g of CENTRAL_PARK_GATES) {
    const at = (d, u = 0) => s.sampleGround(g.x + g.nx * d + g.tx * u, g.z + g.nz * d + g.tz * u, probe()).height;
    assert.ok(g.base === 0 || g.base === 0.22, `${g.name}: base ${g.base}`);
    assert.ok(Math.abs(at(0.05) - g.base) < 0.02, `${g.name}: starts level with what is outside (${at(0.05)})`);
    assert.ok(Math.abs(at(-0.3) - g.base) < 1e-9, `${g.name}: outside the wall is ${g.base}`);
    assert.ok(Math.abs(at(length - 0.05) - CENTRAL_PARK_TOP) < 0.02, `${g.name}: ends at the lawn`);
    let prev = at(0.05);
    for (let d = 0.5; d < length; d += 0.5) {
      const h = at(d);
      assert.ok(h - prev < 0.06 && h >= prev - 1e-9, `${g.name}: smooth climb at d=${d}`);
      prev = h;
    }
    assert.equal(at(length / 2, width / 2 + 0.6), CENTRAL_PARK_TOP, `${g.name}: the wall either side stays a wall`);
  }
});

test('the wheel rides up Artists\' Gate (6th Ave) into the park without crashing', () => {
  const g = CENTRAL_PARK_GATES.find((t) => t.name === "Artists' Gate");
  const s = new NycTerrainSampler();
  // on the perimeter sidewalk, 3 m short of the gate, facing in
  const euc = new EucController(s, {
    spawn: { position: { x: g.x - g.nx * 3, y: 0.22, z: g.z - g.nz * 3 }, headingY: Math.atan2(g.nx, g.nz) }
  });
  const snap = ride(euc, 5, { ...NEUTRAL_ACTIONS, throttle: 0.6 });
  assert.equal(euc.crashed, false);
  assert.ok(inCentralPark(snap.position.x, snap.position.z), 'inside the wall');
  assert.ok(Math.abs(snap.position.y - CENTRAL_PARK_TOP) < 0.1, `on the lawn (y ${snap.position.y})`);
});

test('without a gate the wall stops the wheel at the sidewalk', () => {
  const g = CENTRAL_PARK_GATES.find((t) => t.name === "Artists' Gate");
  const s = new NycTerrainSampler();
  const x = g.x + g.tx * 40; // 40 m along the wall from the gate
  const z = g.z + g.tz * 40;
  const euc = new EucController(s, {
    spawn: { position: { x: x - g.nx * 3, y: 0.22, z: z - g.nz * 3 }, headingY: Math.atan2(g.nx, g.nz) }
  });
  const snap = ride(euc, 3, { ...NEUTRAL_ACTIONS, throttle: 0.4 });
  assert.equal(inCentralPark(snap.position.x, snap.position.z), false);
});

test('raised tops from city-grid.js lift the ground (the highest wins) and a pond is a wall', () => {
  const sq = (x0, z0, w, top, surface) => ({
    poly: [{ x: x0, z: z0 }, { x: x0 + w, z: z0 }, { x: x0 + w, z: z0 + w }, { x: x0, z: z0 + w }],
    top, surface, minX: x0, maxX: x0 + w, minZ: z0, maxZ: z0 + w
  });
  // a park walk with a lawn bed on it, on the 5th Ave roadway near the spawn (synthetic)
  const s = new NycTerrainSampler({ tops: [sq(0, SPAWN_Z - 40, 20, 0.26, 'brick'), sq(5, SPAWN_Z - 35, 10, 0.41, 'grass')] });
  const walk = s.sampleGround(2, SPAWN_Z - 38, probe());
  assert.equal(walk.height, 0.26);
  assert.equal(walk.surface, 'brick');
  const bed = s.sampleGround(10, SPAWN_Z - 30, probe());
  assert.equal(bed.height, 0.41);
  assert.equal(bed.surface, 'grass');
  assert.equal(s.sampleGround(30, SPAWN_Z - 30, probe()).height < 0.3, true, 'outside: the city as before');
});
