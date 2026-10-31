const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { BODY_SPECS, carCrashProfile, carDimensions } = require('./car-profile-fixture.cjs');
const CAR_KINDS = Object.fromEntries(Object.entries(BODY_SPECS).map(([kind, spec]) => [kind, carDimensions(spec)]));

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
// Exercise the production lane query and player snapshot without creating the WebGPU scene.
const laneQuery = source.match(/  function playerInLane\(lane, pl\) \{[\s\S]*?\n  \}/)?.[0];
const boxRun = source.match(/const HWY_BOX_RUN = \d+;/)?.[0];
const laneBounds = source.match(/    lane.box = \[Infinity[^]*?(?=    lane.cars = \[\];)/)?.[0];
const playerSnapshot = source.match(/    const pl = entity[\s\S]*?\n    \} : null;/)?.[0];
assert.ok(laneQuery, 'traffic lane query is present');
assert.ok(boxRun && laneBounds, 'production highway bounds construction is present');
assert.ok(playerSnapshot, 'traffic player snapshot is present');
const { playerInLane, snapshot, prepareBounds } = vm.runInNewContext(`
  ${boxRun}
  ${laneQuery}
  function prepareBounds(lane) {
    const P = lane.pts;
    ${laneBounds}
    return lane;
  }
  function snapshot(entity, mode) {
    ${playerSnapshot}
    return pl;
  }
  ({ playerInLane, snapshot, prepareBounds });
`);

function lane(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return prepareBounds({
    pts: points,
    cum,
  });
}

// Frozen unbounded query from accepted 618ec40, independent of the new broad phase.
function originalPlayerInLane(lane, pl) {
  const P = lane.pts;
  for (let i = 0; i + 1 < P.length; i++) {
    if (P[i].y < -1 && P[i + 1].y < -1) continue;
    const ax = P[i].x, az = P[i].z;
    const sx = P[i + 1].x - ax, sz = P[i + 1].z - az;
    const horizontalLengthSq = sx * sx + sz * sz;
    if (horizontalLengthSq === 0) continue;
    const L = lane.cum[i + 1] - lane.cum[i];
    const t = ((pl.x - ax) * sx + (pl.z - az) * sz) / horizontalLengthSq;
    if (t < 0 || t > 1) continue;
    const y = P[i].y + (P[i + 1].y - P[i].y) * t;
    if (Math.abs(pl.y - y) >= 2.6) continue;
    if (Math.abs((pl.z - az) * sx - (pl.x - ax) * sz) / Math.sqrt(horizontalLengthSq) < 2.0) {
      return { u: lane.cum[i] + t * L, v: Math.max(0, ((pl.vx * sx + pl.vz * sz) / horizontalLengthSq) * L) };
    }
  }
  return null;
}

test('highway run bounds preserve exact query results at seams, turns, overlaps and layered roads', () => {
  const points = [];
  for (let i = 0; i <= 40; i++) points.push({ x: 0, y: 0, z: i * 10 });
  for (let i = 0; i <= 40; i++) points.push({ x: 200, y: 7.6, z: 400 - i * 10 });
  // Repeated vertices, a vertical segment, the same XZ at another height, and an underground return.
  points.push({ x: 200, y: 7.6, z: 0 }, { x: 200, y: 0, z: 0 });
  for (let i = 1; i <= 40; i++) points.push({ x: 200, y: 0, z: i * 10 });
  points.push({ x: 100, y: -4, z: 400 }, { x: 100, y: -4, z: 0 });
  const road = lane(points);
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    for (const t of [0, 0.5, 1]) for (const lateral of [-3.001, -2, -1.999, 0, 1.999, 2, 3.001]) {
      for (const dy of [-2.6, 0, 2.599, 2.6]) {
        const pl = { x: a.x + (b.x - a.x) * t + (b.z - a.z) / len * lateral,
          z: a.z + (b.z - a.z) * t - (b.x - a.x) / len * lateral,
          y: a.y + (b.y - a.y) * t + dy, vx: -7, vz: 11 };
        const actual = playerInLane(road, pl), expected = originalPlayerInLane(road, pl);
        assert.deepEqual(actual && { ...actual }, expected, `segment ${i}, t ${t}, lateral ${lateral}, dy ${dy}`);
      }
    }
  }
});

test('highway query skips distant segment reads inside the whole-lane bounds', () => {
  const points = [];
  for (let i = 0; i <= 400; i++) points.push({ x: 0, y: 0, z: i * 10 });
  for (let i = 0; i <= 400; i++) points.push({ x: 200, y: 0, z: 4000 - i * 10 });
  const road = lane(points);
  let reads = 0;
  road.pts = new Proxy(points, { get(target, key) { if (/^\d+$/.test(String(key))) reads++; return target[key]; } });
  assert.equal(playerInLane(road, player(100, 0, 2000)), null);
  assert.equal(reads, 0, 'off-road rider requires no detailed segment tests');
  const actual = playerInLane(road, player(200, 0, 55));
  const boundedReads = reads;
  reads = 0;
  const expected = originalPlayerInLane(road, player(200, 0, 55));
  assert.deepEqual({ ...actual }, expected);
  assert.ok(boundedReads < reads / 10, `${boundedReads} vs ${reads} point reads`);
});

test('whole-lane bounds retain distant-run cars for EUC contact, ragdolls and recovery', async () => {
  const points = Array.from({ length: 70 }, (_, i) => ({ x: 0, y: 0, z: i * 10 }));
  const road = lane(points);
  assert.deepEqual([...road.box], [0, 0, 0, 690]);
  assert.ok(road.playerBoxes.length > 4);
  const makeCar = (z, y = 0) => ({ kind: 'sedan', x: 0, z, y, yaw: 0, v: 8, placed: true, hitTimer: 0 });
  const near = makeCar(10), far = makeCar(650), underground = makeCar(650, -2), elevated = makeCar(650, 7.6);
  road.cars = [near, far, underground, elevated];
  const highway = source.slice(source.indexOf('function createHighwayTraffic('));
  const dynamicQuery = highway.match(/  function dynamicBodiesNear\([^]*?\n  \}/)?.[0];
  assert.ok(dynamicQuery);
  const constants = [...highway.matchAll(/  const HWY_(?:HALF_W|HEIGHT|MAX_HALF) = [^;]+;/g)].map(m => m[0]).join('\n');
  const carLength = source.match(/const HWY_CAR_LEN = [^;]+;/)[0];
  const bodiesNear = vm.runInNewContext(`${carLength}\n${constants}\n(${dynamicQuery.trim()})`, { lanes: [road], BODY_SPECS, carCrashProfile, CAR_KINDS });
  const out = [];
  bodiesNear(0, 645, 6, out);
  assert.deepEqual(out.map(b => b.source), [far, elevated], 'late run retained; distant and underground cars omitted');
  assert.equal(out[0].velocityZ, 8);
  assert.equal(out[1].minY, 7.6, 'vertical separation is forwarded to the controller');
  const { createEucDynamicWorld } = await import('../js/euc-dynamic.js');
  const world = createEucDynamicWorld({ bodiesNear });
  const body = { x: 0, z: 645, headingY: 0, minY: 0, maxY: 1.9,
    halfWidthMetres: 0.35, halfLengthMetres: 0.5, velocityX: 0, velocityZ: 12 };
  const hit = world.resolveMotion({ previous: body, proposed: { ...body, z: 649 } });
  assert.ok(hit && hit.allowedMoveFraction < 1 && hit.closingSpeedMetresPerSecond === 4);
  assert.equal(world.ragObstacleBodies()[0].source, far);
  assert.equal(world.canPlace({ reason: 'recover', body: { ...body, z: 650 } }), false);
});

function player(x, y, z, mode = 'car') {
  return snapshot({ position: { x, y, z }, heading: Math.PI / 2, speed: 10 }, mode);
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test('highway following accounts for both vehicle lengths and stops a van at its own nose', () => {
  const highway = source.slice(source.indexOf('function createHighwayTraffic('));
  const motion = highway.slice(highway.indexOf('    // 1. Car following'), highway.indexOf('    // 2. Instances:'));
  const D = { a: 1.6, b: 3, T: 1.4, s0: 2 };
  const make = len => ({ len, u: 100, v: 8, acc: 0, seg: 0, hitTimer: 0 });
  const step = (cars, rider = null, dt = 1/60) => vm.runInNewContext(`(function(dt,entity){${motion}})`, {
    lanes: [{ cars, len: 1000, speed: 20 }], playerInLane: () => rider,
    D, brakeTerm: 2*Math.sqrt(D.a*D.b), HWY_CAR_LEN: 4.6, HWY_RIDER_HALF_LEN: .5,
    HWY_CONTACT: .4, HWY_HIT_MEMORY: .25,
    reportCollision() {},
  })(dt, rider ? { position: {x:0,y:0,z:rider.u}, speed:rider.v, heading:0 } : null);
  const short = make(4.6), long = make(CAR_KINDS.van.halfLength*2);
  step([short,{...make(4.6),u:120}]);step([long,{...make(CAR_KINDS.van.halfLength*2),u:120}]);
  assert.ok(long.acc < short.acc, 'longer nose/tail gap causes stronger braking at equal centres');
  const van = make(CAR_KINDS.van.halfLength*2);
  step([van], {u:100+van.len/2+.5+.1,v:0});
  assert.equal(van.touching,true);assert.equal(van.v,0);assert.equal(van.hitV,8);
  assert.equal(van.u,100,'traffic holds itself rather than pushing the rider');
});

test('street traffic recognizes players on its own road, including sidewalk height', () => {
  const road = lane([{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }]);
  for (const y of [0, 0.22]) {
    const result = playerInLane(road, player(50, y, 0));
    close(result.u, 50);
    close(result.v, 10);
  }
  assert.equal(playerInLane(road, player(50, 7.6, 0)), null);
  assert.equal(playerInLane(road, player(50, 0, 2.1)), null);
});

test('viaduct traffic ignores players below it and recognizes players at deck height', () => {
  const road = lane([{ x: 0, y: 7.6, z: 0 }, { x: 100, y: 7.6, z: 0 }]);
  assert.equal(playerInLane(road, player(50, 0, 0)), null);
  const result = playerInLane(road, player(50, 7.6, 0));
  close(result.u, 50);
  close(result.v, 10);
});

test('sloped lanes use horizontal projection and compare interpolated road height', () => {
  const road = lane([{ x: 0, y: 0, z: 0 }, { x: 100, y: 7.6, z: 0 }]);
  for (const t of [0, 0.5, 1]) {
    const result = playerInLane(road, player(100 * t, 7.6 * t, 0));
    close(result.u, road.cum[1] * t);
    close(result.v, road.cum[1] / 10);
  }
  assert.equal(playerInLane(road, player(50, 0, 0)), null);
  assert.equal(playerInLane(road, player(100.1, 7.6, 0)), null);
  assert.equal(playerInLane(road, player(50, 3.8, 2.001)), null);
});

test('overlapping road segments select the matching elevation', () => {
  const road = lane([{ x: 0, y: 7.6, z: 0 }, { x: 100, y: 7.6, z: 0 },
    { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]);
  const result = playerInLane(road, player(50, 0, 0));
  close(result.u, 157.6);
  close(result.v, 0);
});

test('underground lanes remain excluded, and no rider means no snapshot', () => {
  const road = lane([{ x: 0, y: -4.5, z: 0 }, { x: 100, y: -4.5, z: 0 }]);
  assert.equal(playerInLane(road, player(50, -4.5, 0)), null);
  assert.equal(snapshot(null), null);
});

test('the highway snapshot is the EUC rider\'s whatever mode string a caller still passes', () => {
  for (const mode of [undefined, 'euc', 'car', 'helicopter']) {
    const pl = player(50, 0, 0, mode);
    close(pl.x, 50);
    close(pl.vx, 10);
    assert.ok(Math.abs(pl.vz) < 1e-9);
  }
});

function trafficFunction(name, context) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} is present`);
  return vm.runInNewContext(`(${match[0].trim()})`, context);
}

function intersectionHarness() {
  const n = { signal: true, in: [] };
  const exit = { lanes: [0], outSide: 1 };
  const edge = { to: n, axisIndex: 0, occ: [[]], opposite: null, inSide: 0, len: 100 };
  const car = { edge, move: { to: exit, out: [0], turn: 'S' }, lane: 0, s: 80, speed: 4,
    driver: { b: 3 }, half: 2.25, wait: 0, commit: null, isNYPD: false };
  const state = { phase: 'red', occupied: false, pedestrians: false, space: true, conflict: false };
  const context = {
    LOOKAHEAD: 70,
    phaseOf: () => state.phase,
    canStopBefore: () => true,
    stopAt: () => -3,
    boxBusy: () => state.occupied,
    ahead: () => null,
    connector: () => ({ len: 20 }),
    yieldToCrossTraffic: () => state.conflict,
    pedestrianOn: () => state.pedestrians,
    laneCoord: () => 0,
    timeTo: () => 1,
    room: () => state.space,
    alongside: () => false,
    mergingAhead: () => null
  };
  return { car, state, mayEnter: trafficFunction('mayEnter', context), signalAhead: trafficFunction('signalAhead', context) };
}

test('police pass red and amber signals while ordinary cars stop', () => {
  const { car, state, mayEnter, signalAhead } = intersectionHarness();
  for (const phase of ['red', 'amber']) {
    state.phase = phase;
    car.isNYPD = false;
    assert.equal(mayEnter(car, 18), false);
    assert.equal(signalAhead(car, car.edge, 18), -3);
    car.isNYPD = true;
    assert.equal(mayEnter(car, 18), true);
    assert.equal(signalAhead(car, car.edge, 18), 0);
  }
});

test('police still wait for crossing traffic, pedestrians and a blocked exit', () => {
  const { car, state, mayEnter } = intersectionHarness();
  car.isNYPD = true;
  for (const [key, blocked] of [['occupied', true], ['pedestrians', true], ['space', false], ['conflict', true]]) {
    const initial = state[key];
    state[key] = blocked;
    assert.equal(mayEnter(car, 18), false, key);
    state[key] = initial;
  }
  assert.equal(mayEnter(car, 18), true);
});

test('police running a red yield to fast cross traffic regardless of how long they waited', () => {
  const car = { edge: { axisIndex: 0 }, wait: 20 };
  const lead = { s: 85, v: { speed: 10 } };
  const side = { axisIndex: 1, occ: [[lead]], len: 100 };
  const node = { signal: true, in: [{ axisIndex: 0, occ: [[lead]] }, side] };
  const context = {
    leadOf: (list) => list.at(-1),
    canStopBefore: () => true
  };
  lead.v.half = 2.25;
  context.canStop = trafficFunction('canStop', context);
  const yieldToCrossTraffic = trafficFunction('yieldToCrossTraffic', context);
  assert.equal(yieldToCrossTraffic(car, node), true);
  lead.v.speed = 0;
  assert.equal(yieldToCrossTraffic(car, node), false);
  lead.v.speed = 10;
  lead.s = 10;
  assert.equal(yieldToCrossTraffic(car, node), false);
});

test('left turns account for oncoming police even when their signal is red', () => {
  const edge = { to: { signal: true }, through: 0, len: 100, occ: [] };
  const car = { edge, move: { turn: 'S', out: [0] }, lane: 0, speed: 10, half: 2.25, isNYPD: false };
  edge.occ.push([{ v: car, s: 85 }]);
  const context = { phaseOf: () => 'red', leadOf: (list) => list.at(-1) };
  context.canStop = trafficFunction('canStop', context);
  const yieldOncoming = trafficFunction('yieldOncoming', context);
  assert.equal(yieldOncoming(edge, false), false);
  car.isNYPD = true;
  assert.equal(yieldOncoming(edge, false), true);
  car.speed = 0;
  assert.equal(yieldOncoming(edge, false), false);
});

function populationContext() {
  const context = {
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    hasView: true, camX: 0, camY: 10, camZ: 0, visible: () => true,
    focusX: 0, focusZ: 0, player: { active: false },
    clock: 0,
    VEHICLE_SPAWN_DISTANCE: 250, PED_SPAWN_DISTANCE: 150, NEAR_RADIUS: 350,
    nearEdges: [], nearSignals: [], track: {}, KERB: 1.6, QUEUE_GAP: 0.62,
    atCurb: () => {}, laneClear: () => true,
    place: (v, e, lane, s) => Object.assign(v, { edge: e, lane, s })
  };
  context.nearView = trafficFunction('nearView', context);
  return context;
}

function straightEdge(z, len = 20) {
  return { sx: 0, sz: z, dx: 0, dz: 1, rx: -1, rz: 0, len, lanes: [0], occ: [[]] };
}

test('cars replenish the road ahead while nearby visible spawning stays blocked', () => {
  const context = populationContext();
  const edge = straightEdge(140);
  context.nearEdges.push(edge);
  const spawnVehicle = trafficFunction('spawnVehicle', context);
  const car = { half: 2.25 };
  assert.equal(spawnVehicle(car, 100, 350, true), false);
  edge.sz = 290;
  assert.equal(spawnVehicle(car, 100, 350, true), true);
  assert.equal(edge.sz + car.s, 300);
  edge.sz = 140;
  context.visible = () => false;
  assert.equal(spawnVehicle(car, 100, 350, true), true);
});

test('pedestrians replenish visible sidewalks ahead without appearing nearby', () => {
  const context = populationContext();
  context.nearEdges.push(straightEdge(0));
  let z = 100;
  context.sidewalkTrack = () => {
    Object.assign(context.track, { ax: 0, az: z - 10, ux: 0, uz: 1, len: 20, node: null });
    return true;
  };
  const spawnPed = trafficFunction('spawnPed', context);
  const ped = { crossesStreets: false, speed: 1.4, rig: {} };
  assert.equal(spawnPed(ped, 60, 280, true), false);
  z = 220;
  assert.equal(spawnPed(ped, 60, 280, true), true);
  assert.equal(ped.z, 220);
  assert.equal(ped.v, ped.speed);
});

test('long roads are available near their ends and spawn only in the local section', () => {
  const context = populationContext();
  const edge = straightEdge(100, 2000);
  Object.assign(context, { edges: [edge, straightEdge(2000)], nodes: [], nearX: Infinity, nearZ: Infinity });
  trafficFunction('refreshNear', context)();
  assert.deepEqual(context.nearEdges, [edge]);
  const car = { half: 2.25 };
  assert.equal(trafficFunction('spawnVehicle', context)(car, 0, 350, false), true);
  assert.ok(edge.sz + car.s <= 350);
  assert.ok(car.s >= car.half + 5);
});

test('crossing pedestrians fall back to a sidewalk when nearby crosswalks are unusable', () => {
  const context = populationContext();
  context.nearSignals.push({});
  context.nearEdges.push(straightEdge(200));
  let crossings = 0;
  context.crosswalkTrack = () => { crossings++; return false; };
  context.sidewalkTrack = () => {
    Object.assign(context.track, { ax: 0, az: 200, ux: 0, uz: 1, len: 20, node: null });
    return true;
  };
  const ped = { crossesStreets: true, speed: 1.4, rig: {} };
  assert.equal(trafficFunction('spawnPed', context)(ped, 60, 280, true), true);
  assert.equal(crossings, 5);
  assert.equal(ped.node, null);
  assert.equal(ped.z, 210);
});

// ---------------------------------------------------------------------------------------------------------------
// The EUC rider: traffic reads the rider, never writes it (the EUC controller is the authority)
// ---------------------------------------------------------------------------------------------------------------

test('no traffic code writes the player entity\'s position, speed, velocity or mesh', () => {
  assert.doesNotMatch(source, /\b(pe|entity|playerEntity|player\.entity)\.(position|mesh)\.(x|y|z|copy|set)\b\s*(\(|[-+*]?=(?!=))/);
  assert.doesNotMatch(source, /\b(pe|entity|playerEntity|player\.entity)\.(speed|vx|vz|heading|angularVel|pitchVel|rollVel|heaveVel|lastCollisionSpark)\s*[-+*]?=(?!=)/);
  assert.doesNotMatch(source, /activeMode|'helicopter'|'cyclist'/, 'the retired player modes are gone');
});

test('bus destination signs carry a generic route, not a real operator\'s', () => {
  const sign = source.match(/function createBusDestinationTexture\(\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(sign, /#0058b8|'M1'|HARLEM|5 AV/i);
  const labels = [];
  const ctx = { fillRect() {}, fillText(text) { labels.push(text); } };
  vm.runInNewContext(`(${sign})()`, { document: { createElement: () => ({ getContext: () => ctx }) },
    THREE: { CanvasTexture: class {}, SRGBColorSpace: 'srgb' } });
  for (let i = 1; i <= 8; i++) assert.ok(labels.includes(`X${i}`));
  assert.ok(labels.includes('UPTOWN') && labels.includes('CITY LOOP'));
});

function riderHarness() {
  const entity = Object.freeze({ type: 'euc', position: Object.freeze({ x: 0, y: 0, z: 0 }), heading: 0, speed: 0 });
  const player = { active: true, entity, x: 0, z: 0, vx: 0, vz: 0, heading: 0, speed: 0, halfW: 0.35, halfL: 0.5 };
  const reports = [];
  const context = {
    Math, player, CONTACT_SKIN: 0.08, HIT_MEMORY: 0.25,
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    satHit: { nx: 0, nz: 0, pen: 0, localX: 0, localZ: 0, pSin: 0, pCos: 1 },
    reportCollision: (...args) => reports.push(args),
    spawnCollisionSparks: () => {}
  };
  context.overlapWithPlayer = trafficFunction('overlapWithPlayer', context);
  const collideWithPlayer = trafficFunction('collideWithPlayer', context);
  // a car coming up behind the rider along +Z
  const car = (z, speed) => ({ x: 0, z, tx: 0, tz: 1, speed, vx: 0, vz: 0, dlv: 0, bus: false, isSUV: false,
    hold: false, hitVX: 0, hitVZ: 0, hitTimer: 0, pitchVel: 0, rollVel: 0 });
  return { entity, player, reports, collideWithPlayer, car, context };
}

test('recycled cars clear holds and impact memory, expose fresh velocity, and report their next contact', () => {
  const h = riderHarness(), v = h.car(-2.6, 8);
  h.collideWithPlayer(v, 0, 0.86, 2.18, 1 / 60);
  assert.equal(v.touch, true);
  const body = { source: v }, paint = [0.2, 0.3, 0.4], edge = { occ: [[]] };
  Object.assign(v, { body, paint, bodyType: 'sedan', style: 197, v0: 16, wheelSpin: 1.7 });
  Object.assign(h.context, {
    locate(car) { Object.assign(car, { x: 100, z: 100, tx: 1, tz: 0 }); },
    chooseMove: () => ({ turn: 'S' }), occupy() {}
  });
  trafficFunction('place', h.context)(v, edge, 0, 20);
  assert.equal(v.touch, false);
  assert.equal(v.hold, false);
  assert.deepEqual([v.hitTimer, v.hitVX, v.hitVZ], [0, 0, 0]);
  assert.equal(v.body, body, 'cached body identity survives recycling');
  assert.equal(v.paint, paint);
  assert.equal(v.style, 197);
  assert.equal(v.wheelSpin, 1.7, 'persistent wheel phase is retained');
  const bodies = [];
  trafficFunction('dynamicBodiesNear', { Math, vehicles: [v], peds: [], BODY_SPECS, carCrashProfile, CAR_KINDS,
    vehicleHalfW: () => 0.86, vehicleHalfL: () => 2.18, PED_HALF: 0.3 })(100, 100, 5, bodies);
  assert.equal(bodies[0], body);
  assert.equal(body.velocityX, 8, 'new heading and speed replace old impact velocity');
  assert.equal(body.velocityZ, 0);
  Object.assign(h.player, { x: 102.5, z: 100 });
  h.collideWithPlayer(v, Math.PI / 2, 0.86, 2.18, 1 / 60);
  assert.equal(h.reports.length, 2, 'new contact is not swallowed by the old touching flag');
});

test('respawn clears pedestrian dodge/stumble state without resetting identity or complaint count', () => {
  const context = populationContext();
  context.nearEdges.push(straightEdge(200));
  context.sidewalkTrack = () => {
    Object.assign(context.track, { ax: 0, az: 200, ux: 0, uz: 1, len: 20, node: null });
    return true;
  };
  const p = { speed: 1.4, crossesStreets: false, rig: { placed: true }, waiting: true,
    dodge: 0.6, bumpOX: 0.4, bumpOZ: -0.3, bumpVX: 2, bumpVZ: -1, bumpCooldown: 2, bumped: 7 };
  const rig = p.rig;
  assert.equal(trafficFunction('spawnPed', context)(p, 60, 280, true), true);
  assert.deepEqual([p.dodge, p.bumpOX, p.bumpOZ, p.bumpVX, p.bumpVZ, p.bumpCooldown], [0, 0, 0, 0, 0, 0]);
  assert.equal(p.waiting, false);
  assert.equal(p.bumped, 7, 'resetting this monotonic counter would create a false audio complaint');
  assert.equal(p.rig, rig);
  assert.equal(rig.placed, false);
  trafficFunction('stumble', { Math, BUMP_FRICTION: 7, BUMP_RETURN: 0.5 })(p, 1 / 60);
  assert.deepEqual([p.x, p.z], [0, 210], 'first new pose stays on its new track');
});

test('a car that runs into the rider stops, remembers its impact velocity and reports it, never moving the rider', () => {
  const { entity, reports, collideWithPlayer, car } = riderHarness();
  const v = car(-2.6, 8); // its nose (2.18 m ahead of centre) 0.08 m into the rider's back (0.5 m behind)
  collideWithPlayer(v, 0, 0.86, 2.18, 1 / 60);
  assert.equal(v.hold, true);
  assert.equal(v.speed, 0);
  assert.equal(v.hitVZ, 8);
  assert.equal(v.hitTimer, 0.25);
  assert.equal(reports.length, 1);
  assert.equal(reports[0][0], entity);
  assert.equal(reports[0][1], v);
  assert.ok(Math.abs(reports[0][7] - 8) < 1e-9, 'approach speed');
  // still touching next frame: holding, no second report, the impact memory runs down
  collideWithPlayer(v, 0, 0.86, 2.18, 0.1);
  assert.equal(v.hold, true);
  assert.equal(reports.length, 1);
  assert.ok(Math.abs(v.hitTimer - 0.15) < 1e-12);
  assert.deepEqual(entity.position, { x: 0, y: 0, z: 0 });
  assert.equal(entity.speed, 0);
});

test('a fast car within the contact skin is not held short of the rider; a slow one is', () => {
  const { collideWithPlayer, car } = riderHarness();
  const fast = car(-2.72, 8); // 0.04 m short of the rider: inside the 0.08 m skin
  collideWithPlayer(fast, 0, 0.86, 2.18, 1 / 60);
  assert.equal(fast.hold, false);
  assert.equal(fast.speed, 8);
  const slow = car(-2.72, 0.5);
  collideWithPlayer(slow, 0, 0.86, 2.18, 1 / 60);
  assert.equal(slow.hold, true);
  assert.equal(slow.hitTimer, 0, 'creeping up is no impact');
});

test('a car driving on past a rider who brushes its side is not stopped, and sounds once', () => {
  const { player, reports, collideWithPlayer, car } = riderHarness();
  const v = car(0, 10);
  v.x = -(0.86 + 0.35 - 0.02); // its right side 2 cm into the rider, both heading +Z
  player.vx = -1.5; // the rider (on the car's +X side) drifting into it
  collideWithPlayer(v, 0, 0.86, 2.18, 1 / 60);
  assert.equal(v.hold, false);
  assert.equal(v.speed, 10);
  assert.equal(reports.length, 1);
  collideWithPlayer(v, 0, 0.86, 2.18, 1 / 60);
  assert.equal(reports.length, 1, 'continued contact is not a new impact');
  assert.equal(v.hitTimer, 0, 'the car did not drive into the rider');
});

test('the hold is released once the rider has moved away or is inactive', () => {
  const { player, collideWithPlayer, car } = riderHarness();
  const v = car(-2.6, 0);
  collideWithPlayer(v, 0, 0.86, 2.18, 1 / 60);
  assert.equal(v.hold, true);
  player.x = 3;
  collideWithPlayer(v, 0, 0.86, 2.18, 1 / 60);
  assert.equal(v.hold, false);
  player.x = 0;
  player.active = false;
  collideWithPlayer(v, 0, 0.86, 2.18, 1 / 60);
  assert.equal(v.hold, false);
});

test('drivers yield to a rider about to cross their lane, not to one riding away from it', () => {
  const playerGap = trafficFunction('playerGap', { Math, LOOKAHEAD: 70, PLAYER_CUT_IN: 0.8, player: { halfW: 0.35, halfL: 0.5 } });
  const v = { pAhead: 20, pRight: 4, pLat: 0, half: 2.25, halfWidth: 0.86, speed: 10 };
  assert.equal(playerGap(v, 0), Infinity, 'beside the lane, riding along it');
  v.pLat = -6;
  close(playerGap(v, 0), 20 - 2.25 - 0.5);
  v.pLat = 6;
  assert.equal(playerGap(v, 0), Infinity, 'riding away');
  v.pRight = 0.5;
  v.pLat = 0;
  close(playerGap(v, 0), 20 - 2.25 - 0.5);
  v.pAhead = -3;
  assert.equal(playerGap(v, 0), Infinity, 'behind the car');
});

test('dynamicBodiesNear reports nearby vehicles and pedestrians as reusable upright prisms', () => {
  const vehicles = [
    { edge: {}, x: 3, z: 0, yaw: 0, yawOffset: 0.1, tx: 0, tz: 1, speed: 5, vx: 0, vz: 0, bus: false, bodyType: 'suv', hitTimer: 0 },
    { edge: {}, x: 2, z: 4, yaw: 0, yawOffset: 0, tx: 0, tz: 1, speed: 0, vx: 0, vz: 0, bus: false, bodyType: 'sedan', hitTimer: 0.1, hitVX: 0, hitVZ: 7 },
    { edge: {}, x: 300, z: 0, yaw: 0, yawOffset: 0, tx: 0, tz: 1, speed: 5, vx: 0, vz: 0, bus: true, isSUV: false, hitTimer: 0 },
    { edge: null, x: 0, z: 0 }
  ];
  const peds = [
    { placed: true, x: -1, z: 1, ux: 1, uz: 0, dir: -1, v: 1.4 },
    { placed: false, x: 0, z: 0 },
    { placed: true, x: 0, z: 50, ux: 1, uz: 0, dir: 1, v: 1.4 }
  ];
  const context = {
    Math, vehicles, peds, BODY_SPECS, carCrashProfile, CAR_KINDS, BUS_HEIGHT: 3.25, BUS_HALF_L: 6.27, PED_HALF: 0.3, PED_HEIGHT: 1.8,
    pedGround: () => 0.22
  };
  for (const name of ['vehicleHalfW', 'vehicleHalfL']) {
    const code = source.match(new RegExp(`  const ${name} = [^;]+;`))[0];
    context[name] = vm.runInNewContext(`${code}\n${name}`, context);
  }
  const dynamicBodiesNear = trafficFunction('dynamicBodiesNear', context);
  const out = [];
  dynamicBodiesNear(0, 0, 6, out);
  assert.equal(out.length, 3);
  const [suv, stopped, walker] = out;
  assert.equal(suv.kind, 'vehicle');
  assert.equal(suv.source, vehicles[0]);
  close(suv.headingY, 0.1);
  assert.equal(suv.halfWidthMetres, CAR_KINDS.suv.halfWidth);
  assert.equal(suv.halfLengthMetres, CAR_KINDS.suv.halfLength);
  assert.equal(suv.maxY, CAR_KINDS.suv.height);
  assert.equal(suv.velocityZ, 5);
  assert.equal(stopped.velocityZ, 7, 'a car that just hit the rider reports its impact velocity');
  assert.equal(walker.kind, 'person');
  assert.equal(walker.halfWidthMetres, walker.halfLengthMetres, 'square: the ragdoll treats it as a person');
  close(walker.headingY, -Math.PI / 2);
  close(walker.velocityX, -1.4);
  assert.equal(walker.minY, 0.22);
  close(walker.maxY, 2.02);
  const again = [];
  vehicles[0].x = 3.5;
  dynamicBodiesNear(0, 0, 6, again);
  assert.equal(again[0], suv, 'records are reused, not reallocated');
  assert.equal(suv.x, 3.5);
});

test('pedestrians step aside from a rider coming up behind them, then back onto their track', () => {
  const player = { active: true, x: 0, z: 0, vx: 0, vz: 5, speed: 5 };
  const dodgeRider = trafficFunction('dodgeRider', {
    Math, player, DODGE_AHEAD: 3, DODGE_MAX: 0.6, DODGE_RATE: 1.4, BUMP_MIN_SPEED: 1.5, BUMP_MAX_PUSH: 4.5,
    BUMP_COOLDOWN: 3, stumble: () => {},
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x))
  });
  const p = { x: 0.3, z: 2, ux: 0, uz: 1, dir: 1, v: 1.3, pause: 0, dodge: 0 };
  for (let i = 0; i < 60; i++) {
    p.x = 0.3; // walk() puts it back on its track every frame
    dodgeRider(p, 1 / 60);
  }
  close(p.dodge, -0.6);
  close(p.x, 0.9); // away from the rider's way, to its right
  player.active = false;
  for (let i = 0; i < 60; i++) {
    p.x = 0.3;
    dodgeRider(p, 1 / 60);
  }
  assert.equal(p.dodge, 0);
  assert.equal(p.x, 0.3);
});

test('a pedestrian bumped by a moving wheel stumbles away, stands, complains once, then walks back to its track', () => {
  const player = { active: true, x: 0, z: 0, vx: 0, vz: 4, speed: 4 };
  const consts = { BUMP_MIN_SPEED: 1.5, BUMP_MAX_PUSH: 4.5, BUMP_FRICTION: 7, BUMP_RETURN: 0.5, BUMP_COOLDOWN: 3 };
  const stumble = trafficFunction('stumble', { Math, ...consts });
  const dodgeRider = trafficFunction('dodgeRider', {
    Math, player, DODGE_AHEAD: 3, DODGE_MAX: 0.6, DODGE_RATE: 1.4, stumble, ...consts,
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x))
  });
  const p = { x: 0, z: 0.5, ux: 1, uz: 0, dir: 1, v: 1.3, pause: 0, dodge: 0 };
  const frame = () => { p.x = 0; p.z = 0.5; dodgeRider(p, 1 / 60); }; // walk() puts it back on its track
  frame();
  assert.equal(p.bumped, 1, 'counted once, for the audio');
  assert.ok(p.pause >= 2, 'it stops');
  for (let i = 0; i < 20; i++) frame();
  assert.equal(p.bumped, 1, 'no second complaint while the wheel is still touching (cooldown)');
  assert.ok(p.z > 0.9, `shoved away from the wheel (z ${p.z})`);
  player.active = false;
  for (let i = 0; i < 60 * 8; i++) { p.pause = Math.max(0, p.pause - 1 / 60); frame(); }
  assert.ok(Math.abs(p.z - 0.5) < 1e-9 && Math.abs(p.x) < 1e-9, 'back on its track');
});
