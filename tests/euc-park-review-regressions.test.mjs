// Independent review regressions on the actual bounded Jefferson drawing/support producer. CPU/headless only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPark } from './park-terrain.test.mjs';
import { NycTerrainSampler } from '../js/euc-terrain.js';
import { EucController, createPose, eucStepPrimitiveFieldsOf } from '../js/euc/simulation/EucController.js';
import { EUC_STEP_PRIMITIVE_FIELDS, copyEucStepPrimitives } from '../js/euc/simulation/eucStepPrimitives.js';
import { RD_PELVIS } from '../js/euc/simulation/ragdoll.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { RiderTricks } from '../js/euc-tricks.js';

const DT = 1 / 120, built = buildPark();
const sampler = extra => new NycTerrainSampler({ tops: built.rideTops, boxes: built.rideSolids, ...extra });
const spawn = (x, y, z, headingY = 0) => ({ position: { x, y, z }, headingY });
const floor = { x: 1330, y: .24, z: -5810 }, fallback = { x: 1330, y: .22, z: -5805 };
const hull = { halfWidthMetres: .3, halfLengthMetres: .4, heightMetres: 1.8 };

// Counterfactual controls retain the two prior integration mistakes without modifying any production module.
class PelvisPolicyControl extends EucController {
  fallenRecoverySpeed(shipped) {
    const p = this.ragdoll.positions;
    return this.recoverySpeedAt(this.ragdolling ? p[RD_PELVIS * 3] : this.x,
      this.ragdolling ? p[RD_PELVIS * 3 + 2] : this.z,
      this.ragdolling ? p[RD_PELVIS * 3 + 1] : this.y, shipped);
  }
}
class LostAutomaticSweepControl extends EucController {
  clipDynamicHeading(kind, fraction) {
    const remaining = this.comeBackTurn;
    super.clipDynamicHeading(kind, fraction);
    this.comeBackTurn = remaining; // The old path restored player spin only, losing refused automatic yaw.
  }
}

function fallenController(s, { Controller = EucController, lift = .8, position = floor, safe = fallback, admit = true } = {}) {
  const admissions = [];
  const world = { hull, canPlace(request) {
    admissions.push(structuredClone(request));
    return request.reason !== 'recover' || (admit && request.body.z > -5807.8);
  } };
  const c = new Controller(s, { dynamicWorld: world, spawn: spawn(position.x, position.y, position.z) });
  c.reset(undefined, 8); assert.equal(c.hardKnock(0, 1), true);
  Object.assign(c, { safeX: safe.x, safeY: safe.y, safeZ: safe.z, safeHeading: 0, safeRingCount: 0,
    crashTime: c.tuning.crashRecoverEarliestSeconds });
  c.ragdoll.positions.set([position.x, position.y + lift, position.z], RD_PELVIS * 3);
  return { c, admissions };
}

test('actual Jefferson fallen-floor rest survives .5–1.1 m pelvis height and an outside fallback; old pelvis policy fails', t => {
  const s = sampler(), results = [];
  assert.equal(s.restartsAtRest(floor.x, floor.z, floor.y), true);
  for (const lift of [.5, .8, 1.09, 1.1]) {
    for (const Controller of [EucController, PelvisPolicyControl]) {
      const { c, admissions } = fallenController(s, { Controller, lift });
      assert.equal(c.recover(), true);
      assert.deepEqual([c.x, c.y, c.z], [fallback.x, fallback.y, fallback.z]);
      const expected = Controller === EucController || lift <= .6 ? 0 : 8 * c.tuning.crashRecoverSpeedFactor;
      assert.equal(c.speed, expected, `${Controller.name}: pelvis +${lift}`);
      assert.equal(admissions.at(-1).initialSpeedMetresPerSecond, expected, 'checked admission and committed speed agree');
      results.push(`${Controller.name} pelvis +${lift}: ${c.speed} m/s`);
    }
  }
  t.diagnostic(results.join('; '));
});

test('automatic recovery speed/support validation is identical through direct and prepared admission', () => {
  const direct = fallenController(sampler()), staged = fallenController(sampler());
  for (const { c } of [direct, staged]) c.crashTime = c.tuning.crashRecoverAutoSeconds;
  direct.c.step(DT, NEUTRAL_ACTIONS);
  const before = staged.c.snapshot(), token = staged.c.prepareStep(DT, NEUTRAL_ACTIONS);
  assert.deepEqual(staged.c.snapshot(), before);
  staged.c.resolvePreparedStep(token); staged.c.commitPreparedStep(token);
  assert.equal(direct.c.crashed, false); assert.equal(direct.c.speed, 0); assert.equal(direct.c.z, fallback.z);
  assert.deepEqual(staged.c.snapshot(), direct.c.snapshot());
  const a = createPose(), b = createPose(); direct.c.writePose(a); staged.c.writePose(b); assert.deepEqual(a, b);
  assert.equal(staged.admissions.at(-1).initialSpeedMetresPerSecond, 0);
});

test('fallen-support speed policy retains layer, overhead/water/unsupported rejection and no-safe retry', () => {
  const deck = { minX: 1327, maxX: 1333, minZ: -5813, maxZ: -5807, top: 6, surface: 'wood', layered: true,
    poly: [{ x: 1327, z: -5813 }, { x: 1333, z: -5813 }, { x: 1333, z: -5807 }, { x: 1327, z: -5807 }] };
  for (const kind of ['above-park-deck', 'overhead-snap', 'water', 'mid-fall', 'off-course', 'no-safe']) {
    const s = sampler(kind === 'above-park-deck' ? { tops: [...built.rideTops, deck] }
      : kind === 'overhead-snap' ? { tops: [...built.rideTops, { ...deck, top: .6 }] } : {});
    if (kind === 'water') {
      const isWater = s.isWater.bind(s);
      s.isWater = (x, z, y) => z <= -5808 || isWater(x, z, y);
    }
    if (kind === 'off-course') {
      const sample = s.sampleGround.bind(s);
      s.sampleGround = (x, z, out, y) => { sample(x, z, out, y); out.offCourse ||= z <= -5808; return out; };
    }
    const position = kind === 'above-park-deck' ? { ...floor, y: 6 } : floor;
    const lift = kind === 'overhead-snap' ? .1 : kind === 'mid-fall' ? 2 : .8;
    const { c, admissions } = fallenController(s, { position, lift, admit: kind !== 'no-safe' });
    const serial = c.placementSerial;
    assert.equal(c.recover(), kind !== 'no-safe', kind);
    if (kind === 'no-safe') {
      assert.equal(c.crashed, true); assert.equal(c.placementSerial, serial);
      const queries = admissions.length; assert.equal(c.recover(), false);
      assert.equal(admissions.length, queries, 'bounded no-safe retry does not repeat placement admission');
    } else {
      assert.equal(c.speed, 8 * c.tuning.crashRecoverSpeedFactor, `${kind}: an invalid/unrelated floor cannot request park rest`);
      assert.equal(c.y, fallback.y); assert.equal(c.z, fallback.z);
    }
  }
});

function flight({ Controller = EucController, fraction = .1, clips = 10, prepared = false, spin = false } = {}) {
  let clipped = 0;
  const world = { hull, resolveMotion(request) {
    if (request.kind !== 'move' || !request.airborne || clipped >= clips
      || Math.abs(request.proposed.headingY - request.previous.headingY) < 1e-8) return null;
    clipped++;
    return { allowedMoveFraction: fraction, closingSpeedMetresPerSecond: 0, normalX: 0, normalZ: 1, chargeImpact: false };
  } };
  const c = new Controller(sampler(), { dynamicWorld: world, spawn: spawn(1322, .24, -5829, Math.PI) });
  c.reset(undefined, 9);
  const pose = createPose(), tricks = new RiderTricks(), history = [];
  let began = -1, last = 0, yaw = 0, landed = false, label = '';
  for (let tick = 0; tick < 500; tick++) {
    const actions = { ...NEUTRAL_ACTIONS, hop: spin && began >= 0 && tick === began + 3 };
    if (prepared) {
      const before = c.snapshot(), token = c.prepareStep(DT, actions);
      assert.deepEqual(c.snapshot(), before, 'preparation is observational');
      c.resolvePreparedStep(token); c.commitPreparedStep(token);
    } else c.step(DT, actions);
    c.writePose(pose); tricks.step(DT, c, pose, false, false);
    history.push({ snapshot: c.snapshot(), pose: structuredClone(pose), remaining: c.comeBackTurn,
      applied: c.dynamicComeBackApplied, spinRemaining: c.spinRemaining, spinCompleted: c.spinCompleted, label: tricks.label });
    if (began < 0 && c.inComeBackAir) { began = tick; last = c.headingY; }
    else if (began >= 0) { yaw += Math.abs(c.headingY - last); last = c.headingY; }
    assert.equal(c.crashed, false, 'zero-impact admission clipping must not crash the flight');
    if (began >= 0 && c.touchedDown) { landed = true; label = tricks.label; break; }
  }
  assert.ok(began >= 0 && landed, 'actual Jefferson quarter launches and lands');
  assert.equal(clipped, clips);
  return { c, history, yaw, label };
}

test('actual Jefferson early admission clips retain the full automatic 180; prior control loses 33.75 degrees', t => {
  const old = flight({ Controller: LostAutomaticSweepControl });
  assert.ok(Math.abs(old.yaw * 180 / Math.PI - 146.25) < 1e-6);
  assert.equal(old.c.lastLandingQuality, 'heavy');
  const fixed = flight();
  assert.ok(Math.abs(fixed.yaw - Math.PI) < 1e-9, `actual admitted yaw ${fixed.yaw * 180 / Math.PI}`);
  assert.notEqual(fixed.c.lastLandingQuality, 'heavy');
  assert.equal(fixed.c.snapshot().spins, 0); assert.equal(fixed.c.spinCompleted, false); assert.equal(fixed.label, '');
  t.diagnostic(`Jefferson admitted automatic yaw: prior ${old.yaw * 180 / Math.PI}°, fixed ${fixed.yaw * 180 / Math.PI}°`);
});

test('zero/partial early clipping is direct/prepared identical and preserves separate player-180 credit', () => {
  for (const fraction of [0, .1, .5]) for (const spin of [false, true]) {
    const direct = flight({ fraction, spin }), staged = flight({ fraction, spin, prepared: true });
    assert.deepEqual(staged.history, direct.history, `fraction ${fraction}, player spin ${spin}`);
    assert.ok(Math.abs(direct.yaw - Math.PI * (spin ? 2 : 1)) < 1e-9);
    assert.equal(direct.c.snapshot().spins, spin ? 1 : 0);
    assert.equal(direct.c.spinCompleted, spin); assert.equal(direct.label, spin ? '180' : '');
  }
});

test('automatic admission sweep is explicit primitive state and clears at held transactions/reset/recovery', () => {
  const { c } = flight(), other = new EucController(sampler(), { spawn: spawn(1330, .24, -5810) });
  assert.ok(EUC_STEP_PRIMITIVE_FIELDS.includes('dynamicComeBackApplied'));
  assert.deepEqual([...eucStepPrimitiveFieldsOf(c)].sort(), [...EUC_STEP_PRIMITIVE_FIELDS].sort());
  c.dynamicComeBackApplied = .123; copyEucStepPrimitives(other, c);
  assert.equal(other.dynamicComeBackApplied, .123);
  other.comeBackTurn = .9; other.comeBackFlight = true;
  const token = other.prepareStep(DT, NEUTRAL_ACTIONS);
  other.holdPreparedStep(token); other.commitPreparedStep(token);
  assert.equal(other.dynamicComeBackApplied, 0); assert.equal(other.comeBackTurn, .9, 'holding a transaction consumes no pending automatic yaw');
  c.reset(); assert.equal(c.dynamicComeBackApplied, 0);
  const recovery = fallenController(sampler()).c;
  recovery.dynamicComeBackApplied = .123; assert.equal(recovery.recover(), true);
  assert.equal(recovery.dynamicComeBackApplied, 0);
});
