// Headless: the vendored EUC controller riding New York's real street layout through js/euc-terrain.js.
// No browser, no three.js. Buildings here are synthetic boxes (the real colliders are built by three.js scene code);
// the curbs, parks and shore are the city's own (city-config.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EucController, createPose } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { SIMULATION } from '../js/euc/data/tuning.js';
import { NycTerrainSampler, boxesFromCityColliders, boxesFromFootprints } from '../js/euc-terrain.js';
import {
  blockAt, streetZ, ISLAND_BOUNDS, WATER_RIDE, getIslandBoundsAtZ, ESPLANADE_RAIL, BATTERY_RAIL, NORTH_BARRIER, CUT_Z,
  MANHATTAN_COASTLINE
} from '../js/city-config.js';

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

test('riding at the Hudson goes out on the esplanade and stops at its railing, short of the water', () => {
  const west = getIslandBoundsAtZ(ROAD.z).westX;
  // heading -pi/2 rides toward -x (x += sin(heading)), at the Hudson, on the road west of the last kerb
  const euc = new EucController(new NycTerrainSampler(), { spawn: { position: { x: west + 18, y: 0, z: ROAD.z }, headingY: -Math.PI / 2 } });
  ride(euc, 8, { ...NEUTRAL_ACTIONS, throttle: 0.6 });
  const rail = ESPLANADE_RAIL.d; // m inland of the bulkhead (out on the coping)
  assert.ok(euc.x - west < rail + 1.2, `reached the railing, x ${(euc.x - west).toFixed(2)} m inside the bulkhead`);
  assert.ok(euc.x - west > rail + 0.2, `stopped short of it, x ${(euc.x - west).toFixed(2)} m inside the bulkhead`);
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

test('a pond is a wall along its shore only: inside, its floor sits under the surface, and it counts as water', () => {
  const level = 1.24;
  const x0 = 0, z0 = SPAWN_Z - 40, w = 20;
  const pond = {
    poly: [{ x: x0, z: z0 }, { x: x0 + w, z: z0 }, { x: x0 + w, z: z0 + w }, { x: x0, z: z0 + w }],
    top: level + WATER_RIDE.wall, surface: 'stone', minX: x0, maxX: x0 + w, minZ: z0, maxZ: z0 + w,
    water: { level, floor: level - WATER_RIDE.floorDepth },
  };
  const s = new NycTerrainSampler({ tops: [pond] });
  const shore = s.sampleGround(x0 + WATER_RIDE.band / 2, z0 + w / 2, probe());
  assert.equal(shore.height, level + WATER_RIDE.wall, 'the shore band is a wall');
  assert.ok(WATER_RIDE.wall > 0.64, 'higher than a charged hop (3 m/s launch: 0.46 m, +40%)');
  const middle = s.sampleGround(x0 + w / 2, z0 + w / 2, probe());
  assert.equal(middle.height, level - WATER_RIDE.floorDepth, 'inside: the floor, under the surface');
  assert.equal(s.isWater(x0 + w / 2, z0 + w / 2), true);
  assert.equal(s.isWater(x0 + 0.2, z0 + w / 2), true, 'the band counts as water too');
  assert.equal(s.isWater(x0 - 1, z0 + w / 2), false);

  // The wheel rolling at the pond stops at the band (it never reaches the floor)
  const euc = new EucController(s, { spawn: { position: { x: x0 - 6, y: 0, z: z0 + w / 2 }, headingY: Math.PI / 2 } });
  ride(euc, 4, { ...NEUTRAL_ACTIONS, throttle: 0.5 });
  assert.ok(euc.x > x0 - 3, `reached the shore, x ${euc.x.toFixed(2)}`);
  assert.ok(euc.x < x0 + WATER_RIDE.band, `stopped at the shore, x ${euc.x.toFixed(2)}`);
});

test('Bryant Park: the terrace is ridden at its drawn top, a ramp climbs to it from the sidewalk, the lawn above', () => {
  const z0 = SPAWN_Z - 60;
  const lawn = {
    minX: 10, maxX: 30, minZ: z0 + 5, maxZ: z0 + 25, top: 1.32,
    terrace: { minX: 0, maxX: 40, minZ: z0, maxZ: z0 + 30, top: 1.06, ramps: [{ fromX: 0, toX: 8, minZ: z0 + 2, maxZ: z0 + 4 }] },
  };
  const s = new NycTerrainSampler({ lawn });
  assert.equal(s.sampleGround(35, z0 + 15, probe()).height, 1.06, 'terrace');
  assert.equal(s.sampleGround(20, z0 + 15, probe()).height, 1.32, 'lawn');
  assert.equal(s.sampleGround(0.5, z0 + 3, probe()).height, s.sidewalkHeight, 'ramp foot: the sidewalk slab');
  assert.ok(Math.abs(s.sampleGround(6, z0 + 3, probe()).height - 1.06 * 0.75) < 1e-9, 'ramp: three quarters up');
  assert.equal(s.sampleGround(0.5, z0 + 10, probe()).height, 1.06, 'beside the ramp: the terrace face');
});

test('the shore: the esplanade is ridden out to its railing, the coping past it is a wall, then the river', () => {
  const s = new NycTerrainSampler();
  const z = ROAD.z;
  const west = getIslandBoundsAtZ(z).westX;
  const at = (inland) => s.sampleGround(west + inland, z, probe()).height;
  const rail = ESPLANADE_RAIL.d;
  for (const inland of [4, 0, -3]) assert.ok(at(inland) <= ISLAND_BOUNDS.sidewalkHeight, `${inland}: the ground as drawn (${at(inland)})`);
  assert.equal(at(rail + 0.2), 3.0, 'just inside the railing: the wall the wheel stops at');
  assert.equal(at(rail - 0.1), 3.0, 'the coping past the railing');
  assert.ok(at(-10) < ISLAND_BOUNDS.waterLevel, 'the river: just under its surface');
  for (const inland of [rail + 0.6, -10]) assert.equal(s.isOffLimits(west + inland, z), true, `${inland}: no getting up here`);
  for (const inland of [-3, 4, 20]) assert.equal(s.isOffLimits(west + inland, z), false, `${inland}: a place to get up`);
});

test('round the Battery the wall follows its railing, inset from the bulkhead line, not a west or east shore x', () => {
  const s = new NycTerrainSampler();
  const tip = BATTERY_RAIL.tip;
  const C = MANHATTAN_COASTLINE;
  let area = 0;
  for (let i = 0, j = C.length - 1; i < C.length; j = i++) area += C[j].x * C[i].z - C[i].x * C[j].z;
  const s0 = area > 0 ? 1 : -1;
  let checked = 0;
  for (let i = 0; i + 1 < tip.length; i++) {
    const a = tip[i], b = tip[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 12) continue;
    const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (Math.hypot(m.x - BATTERY_RAIL.terminal.x, m.z - BATTERY_RAIL.terminal.z) < BATTERY_RAIL.terminalR + 15) continue;
    const n = { x: (-s0 * (b.z - a.z)) / len, z: (s0 * (b.x - a.x)) / len }; // inward
    const at = (d) => s.sampleGround(m.x + n.x * d, m.z + n.z * d, probe()).height;
    assert.ok(at(3) < 1, `segment ${i}: ground 3 m inside the bulkhead (${at(3)})`);
    assert.equal(at(BATTERY_RAIL.inset + 0.2), 3.0, `segment ${i}: the wall at the railing`);
    assert.ok(at(-12) < ISLAND_BOUNDS.waterLevel, `segment ${i}: the harbor past it`);
    checked++;
  }
  assert.ok(checked >= 5, `checked ${checked} stretches of the tip`);
});

test('the north end: a wall at the barricades along the cut, Upper Manhattan past them off limits', () => {
  const s = new NycTerrainSampler();
  const x = ROAD.x; // the 5th Ave roadway
  assert.ok(s.sampleGround(x, CUT_Z + 3, probe()).height < 0.3, 'the avenue runs up to the cut');
  assert.equal(s.sampleGround(x, NORTH_BARRIER.z, probe()).height, 3.0, 'the barricade line is a wall');
  assert.equal(s.sampleGround(x, CUT_Z - 10, probe()).height, 0, 'past it, the ground as drawn');
  assert.equal(s.isOffLimits(x, CUT_Z - 10), true);
  assert.equal(s.isOffLimits(x, CUT_Z + 6), false);
  // heading pi rides north (-z)
  const euc = new EucController(s, { spawn: { position: { x, y: 0, z: CUT_Z + 25 }, headingY: Math.PI } });
  ride(euc, 8, { ...NEUTRAL_ACTIONS, throttle: 0.6 });
  assert.ok(euc.z < CUT_Z + 1.5, `reached the barricades, ${(euc.z - CUT_Z).toFixed(2)} m short of the cut`);
  assert.ok(euc.z > NORTH_BARRIER.band[1], `stopped at them, ${(euc.z - CUT_Z).toFixed(2)} m short of the cut`);
});

test('an inlet in the bulkhead line is water, not the island\'s ground', () => {
  // On z = 3950 the coastline crosses at the outer Hudson shore and twice more round an inlet (a slip) inside it
  const s = new NycTerrainSampler();
  const z = 3950;
  const xs = [];
  const C = MANHATTAN_COASTLINE;
  for (let i = 0, j = C.length - 1; i < C.length; j = i++) {
    const a = C[j], b = C[i];
    if ((a.z > z) !== (b.z > z)) xs.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
  }
  xs.sort((p, q) => p - q);
  assert.ok(xs.length >= 4, `crossings ${xs.map(Math.round)}`);
  const mid = (xs[1] + xs[2]) / 2;
  assert.ok(s.sampleGround(mid, z, probe()).height < ISLAND_BOUNDS.waterLevel, 'the middle of the inlet is water');
});
