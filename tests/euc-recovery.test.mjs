import test from 'node:test';
import assert from 'node:assert/strict';
import { EucController } from '../js/euc/simulation/EucController.js';
import { EUC, SIMULATION } from '../js/euc/data/tuning.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { NycTerrainSampler } from '../js/euc-terrain.js';
import { createEucDynamicWorld, EUC_DYNAMIC_HULL } from '../js/euc-dynamic.js';
import { streetZ, getIslandBoundsAtZ, WATER_RIDE } from '../js/city-config.js';

const DT = 1 / SIMULATION.hz;
const safe = { x: 5.2, y: 0, z: streetZ(37) - 8, headingY: 0 };
const fallen = { x: safe.x, y: 0.3, z: safe.z + 12 };
const request = (overrides = {}) => ({ fallen, safePoints: [safe], headingY: 0, maxStepUp: 0.216, ...overrides });
const top = (y, extra = {}) => ({ minX: 1, maxX: 9, minZ: fallen.z - 4, maxZ: fallen.z + 4,
  poly: [{ x: 1, z: fallen.z - 4 }, { x: 9, z: fallen.z - 4 }, { x: 9, z: fallen.z + 4 }, { x: 1, z: fallen.z + 4 }],
  top: y, surface: 'pavement', ...extra });
const box = (x, y, z, hx, hy, hz) => ({ centre: { x, y, z }, halfExtents: { x: hx, y: hy, z: hz }, rotationY: 0, surface: 'pavement', support: false });

test('placement target uses native roofs, the entire standing footprint and actual overhead/body-only solids', () => {
  const roof = { ...box(fallen.x, 3, fallen.z, 3, 3, 3), support: true };
  const s = new NycTerrainSampler({ boxes: [roof] });
  assert.deepEqual(s.findPlacementTarget({ x: fallen.x, z: fallen.z }), { x: fallen.x, y: 6, z: fallen.z, headingY: 0 });
  assert.equal(s.findPlacementTarget({ x: fallen.x, z: fallen.z, registeredSurfaceOnly: true }), null,
    'registered-only manager policy does not silently become the native recovery default');
  assert.equal(s.findRecoveryTarget(request({ fallen: { ...fallen, y: 6.3 } }), () => true).y, 6,
    'native recovery retains existing low-solid support');
  assert.equal(s.findPlacementTarget({ x: fallen.x + 2.8, z: fallen.z }), null, 'centre support cannot hide an unsupported shoulder');
  for (const solid of [box(fallen.x, 7.4, fallen.z, 3, 0.1, 3), box(fallen.x + 0.45, 7, fallen.z, 0.05, 0.5, 0.1)]) {
    const obstructed = new NycTerrainSampler({ boxes: [roof, solid] });
    assert.equal(obstructed.findPlacementTarget({ x: fallen.x, z: fallen.z }), null);
  }
});

test('placement target refuses wet/steep/unsupported perimeter even when the centre is dry and level', () => {
  const x = fallen.x, z = fallen.z;
  const small = top(6, { layered: true }); small.maxX = x + 0.2; small.poly[1].x = small.poly[2].x = small.maxX;
  assert.equal(new NycTerrainSampler({ tops: [small] }).findPlacementTarget({ x, z }), null);
  const pond = top(1, { water: { level: 1, floor: 0.88, band: 0 } });
  const dry = top(1.1); dry.maxX = x + 0.2; dry.poly[1].x = dry.poly[2].x = dry.maxX;
  assert.equal(new NycTerrainSampler({ tops: [pond, dry] }).findPlacementTarget({ x, z }), null);
  const steep = top(6, { plane: { x, y: 6, z, dx: 1, dz: 0 } });
  assert.equal(new NycTerrainSampler({ tops: [steep] }).findPlacementTarget({ x, z }), null);
  const dryBridge = new NycTerrainSampler({ tops: [pond, top(6, { layered: true })] });
  assert.equal(dryBridge.findPlacementTarget({ x, z, referenceY: 0.9 }), null);
  assert.equal(dryBridge.findPlacementTarget({ x, z, referenceY: 6 }).y, 6);
});

test('registered-only placement checks registration under the whole footprint and retains overhead static clearance', () => {
  const x = fallen.x, z = fallen.z, roof = { ...box(x, 13, z, 3, 13, 3), support: true };
  const narrow = { ...top(26), minX: x - 0.2, maxX: x + 0.2,
    poly: [{ x: x - 0.2, z: z - 4 }, { x: x + 0.2, z: z - 4 },
      { x: x + 0.2, z: z + 4 }, { x: x - 0.2, z: z + 4 }] };
  const centreOnly = new NycTerrainSampler({ boxes: [roof], tops: [narrow] });
  assert.equal(centreOnly.findPlacementTarget({ x, z }).y, 26, 'native collision support covers the footprint');
  assert.equal(centreOnly.findPlacementTarget({ x, z, registeredSurfaceOnly: true }), null,
    'a tiny registration cannot authorize an entire capped collision footprint');
  const full = top(26);
  assert.equal(new NycTerrainSampler({ boxes: [roof], tops: [full] })
    .findPlacementTarget({ x, z, registeredSurfaceOnly: true }).y, 26);
  const ceiling = new NycTerrainSampler({ boxes: [roof, box(x, 27.4, z, 3, 0.1, 3)], tops: [full] });
  assert.equal(ceiling.findPlacementTarget({ x, z, registeredSurfaceOnly: true }), null,
    'matching support does not bypass body-only overhead solids');
});

test('recovery uses the fallen body rather than the old wheel/safe point and checks departure', () => {
  const s = new NycTerrainSampler();
  const p = s.findRecoveryTarget(request(), () => true);
  assert.deepEqual(p, { ...fallen, y: 0, headingY: 0 });
  const blockedAhead = new NycTerrainSampler({ boxes: [box(safe.x, 1, fallen.z + 1.5, 2, 1, 0.1)] });
  const turned = blockedAhead.findRecoveryTarget(request(), () => true);
  assert.ok(turned);
  assert.notEqual(turned.headingY, 0, 'faces a clear departure instead of the nearby wall');
});

for (const hazard of ['river', 'pond', 'submerged support', 'spill', 'off-course', 'steep', 'airborne', 'overhead deck', 'low ceiling', 'edge']) {
  test(`recovery rejects ${hazard} and uses the dry recorded safe floor`, () => {
    let s = new NycTerrainSampler(), f = { ...fallen };
    if (hazard === 'river') f.x = getIslandBoundsAtZ(f.z).westX - 20;
    if (hazard === 'pond' || hazard === 'submerged support') {
      s = new NycTerrainSampler({ tops: [top(1, { water: { level: 1, floor: 1 - WATER_RIDE.floorDepth, band: 0 } }),
        ...(hazard === 'submerged support' ? [top(0.7)] : [])] });
      f.y = 1.05;
    }
    if (hazard === 'spill') s = new NycTerrainSampler({ tops: [top(0.1, { surface: 'spill' })] });
    if (hazard === 'steep') s = new NycTerrainSampler({ tops: [top(0, { plane: { x: f.x, y: 0, z: f.z, dx: 1, dz: 0 } })] });
    if (hazard === 'airborne') f.y = 5;
    if (hazard === 'overhead deck') s = new NycTerrainSampler({ tops: [top(0.6, { layered: true })] });
    if (hazard === 'low ceiling') s = new NycTerrainSampler({ boxes: [box(f.x, 1.5, f.z, 4, 0.1, 4)] });
    if (hazard === 'edge') {
      const t = top(6, { layered: true }); t.maxX = f.x + 0.2;
      t.poly[1].x = t.poly[2].x = t.maxX;
      s = new NycTerrainSampler({ tops: [t] }); f.y = 6.3;
    }
    if (hazard === 'off-course') {
      const original = s.sampleGround.bind(s);
      s.sampleGround = (x, z, out, y) => { original(x, z, out, y); out.offCourse = z > safe.z + 5; return out; };
    }
    assert.deepEqual(s.findRecoveryTarget(request({ fallen: f }), () => true), safe);
  });
}

test('recovery keeps the actual layer: street below bridge, upper deck, negative floating deck', () => {
  for (const y of [0, 6, -0.4]) {
    const s = new NycTerrainSampler({ tops: [top(y === -0.4 ? -0.4 : 6, { layered: true, shore: true })] });
    // A negative deck needs a waterfront footprint, where it replaces river support.
    if (y === -0.4) {
      const x = getIslandBoundsAtZ(fallen.z).westX - 20;
      const t = top(y, { layered: true, shore: true });
      const shift = x - fallen.x;
      t.minX += shift; t.maxX += shift; for (const p of t.poly) p.x += shift;
      const waterfront = new NycTerrainSampler({ tops: [t] });
      const p = waterfront.findRecoveryTarget(request({ fallen: { x, y: y + 0.3, z: fallen.z } }), () => true);
      assert.equal(p.y, y);
    } else {
      const p = s.findRecoveryTarget(request({ fallen: { ...fallen, y: y + 0.3 } }), () => true);
      assert.equal(p.y, y);
      assert.equal(p.z, fallen.z);
    }
  }
});

test('cars/pedestrians are rechecked on every attempt; fully blocked recovery waits, then succeeds', () => {
  let blocked = true;
  const s = new NycTerrainSampler();
  const world = createEucDynamicWorld({ bodiesNear(x, z, radius, out) {
    if (blocked) out.push({ x, z, headingY: 0, halfWidthMetres: 10, halfLengthMetres: 10, minY: 0, maxY: 2 });
  } });
  const canPlace = p => world.canPlace({ reason: 'recover', body: { ...p, ...EUC_DYNAMIC_HULL, minY: p.y, maxY: p.y + 1.9 } });
  assert.equal(s.findRecoveryTarget(request(), canPlace), null);
  blocked = false;
  assert.equal(s.findRecoveryTarget(request(), canPlace).z, fallen.z);
});

test('a dry bridge over a pond is recoverable only at its own elevation', () => {
  const s = new NycTerrainSampler({ tops: [top(1, { water: { level: 1, floor: 0.88, band: 0 } }),
    top(6, { layered: true })] });
  assert.equal(s.isOffLimits(fallen.x, fallen.z, 0.9), true);
  assert.equal(s.isOffLimits(fallen.x, fallen.z, 6), false);
  assert.equal(s.findRecoveryTarget(request({ fallen: { ...fallen, y: 6.3 } }), () => true).y, 6);
  assert.deepEqual(s.findRecoveryTarget(request({ fallen: { ...fallen, y: 1.05 } }), () => true), safe);
});

test('a thin wall blocks nearby searches rather than allowing recovery through it', () => {
  const s = new NycTerrainSampler({ boxes: [box(fallen.x, 1, fallen.z, 0.05, 1, 5)] });
  assert.deepEqual(s.findRecoveryTarget(request(), () => true), safe);
});

for (const manual of [true, false]) {
  test(`${manual ? 'manual' : 'automatic'} controller recovery uses the body and the same safe admission`, () => {
    let refuse = true;
    const s = new NycTerrainSampler();
    const world = createEucDynamicWorld({ bodiesNear() {} });
    const original = world.canPlace;
    world.canPlace = r => r.reason !== 'recover' || (!refuse && original(r));
    const euc = new EucController(s, { dynamicWorld: world, spawn: { position: safe, headingY: 0 } });
    assert.equal(euc.hardKnock(0, 1), true);
    assert.equal(euc.recover(), false, 'earliest get-up timing retained');
    // Controlled settled ragdoll 12 m from the wheel, for placement integration rather than random gameplay.
    for (let i = 0; i < euc.ragdoll.positions.length; i += 3) {
      euc.ragdoll.positions[i + 2] += 12;
      euc.ragdoll.previous[i + 2] += 12;
    }
    euc.crashTime = manual ? EUC.crashRecoverEarliestSeconds : EUC.crashRecoverAutoSeconds;
    if (manual) assert.equal(euc.recover(), false); else euc.step(DT, NEUTRAL_ACTIONS);
    assert.equal(euc.crashed, true, 'refused placement remains crashed');
    refuse = false;
    for (let i = 0; i < 25 && euc.crashed; i++) euc.step(DT, NEUTRAL_ACTIONS);
    if (manual) assert.equal(euc.recover(), true); else euc.step(DT, NEUTRAL_ACTIONS);
    assert.equal(euc.crashed, false);
    assert.ok(euc.z > safe.z + 10, 'recovered near the body, not at the wheel or old checkpoint');
  });
}
