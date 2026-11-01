// Production entity + controller/trick/near-solid helpers; only drawing/lighting/appearance payloads are stubs.
// Submitted views are explicit: a physics callback is never treated as a draw or allowed to run view probes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEntity } from './helpers/euc-entity.mjs';
import { createPose, EucController } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { PlanTerrainSampler } from '../js/euc/simulation/planSampler.js';
import { RiderTricks } from '../js/euc-tricks.js';

const DT = 1 / 120;
function nearWorld({ stairs = false } = {}) {
  const probes = [];
  return { probes, sampleGround(_x, z, out, referenceY) {
    Object.assign(out, { height: stairs && z >= 0 ? .18 : 0, normal: { x: 0, y: 1, z: 0 },
      surface: 'pavement', offCourse: false }); return out;
  }, raycast() { return null; }, raycastObstacle(origin, direction, max, width = 0, _axis, hit) {
    if (arguments.length === 6 && width === 0) probes.push({ ...origin });
    const length = Math.hypot(direction.x, direction.y, direction.z), dx = direction.x / length;
    const distance = origin.x >= .26 ? 0 : dx > 1e-6 ? (.26 - origin.x) / dx : Infinity;
    if (distance > max) return null;
    if (hit?.normal) Object.assign(hit.normal, { x: -1, y: 0, z: 0 });
    return distance;
  } };
}
const isClear = near => near.lift === 0 && near.along === 0 && near.faces.every(v => v === Infinity)
  && near.normals.every(v => v === 0);
function physical(e) {
  const authoritative = createPose(); e.controller.writePose(authoritative);
  return structuredClone({ authoritative, snapshot: e.controller.snapshot(), interpolated: e.pose,
    position: e.position.toArray(), heading: e.heading, speed: e.speed, events: e.events,
    label: e.tricks.label, flight: e.tricks.flight, foot: e.tricks.foot, tuck: e.tricks.tuck });
}

test('submitted-view gate: skipped callbacks never probe or pose the rig; each admitted grounded view probes once', async () => {
  const s = nearWorld(), e = createTestEntity(s, { z: -1 });
  try {
    const constructedDraws = e.rig.drawCalls;
    for (let tick = 0; tick < 24; tick++) e.update(DT, { forward: .2 });
    assert.equal(s.probes.length, 0); assert.equal(e.rig.drawCalls, constructedDraws);
    assert.equal(e.rig.clearanceCalls, 0);
    const before = physical(e);
    e.prepareView(100);
    assert.equal(s.probes.length, 48); assert.equal(e.rig.drawCalls, constructedDraws + 1);
    assert.equal(e.rig.clearanceCalls, 1); assert.equal(e.rig.clearance.seconds, 0);
    assert.deepEqual(physical(e), before, 'view measurement never changes controller, interpolated pose, tricks or events');
    for (let tick = 0; tick < 3; tick++) e.update(DT, {});
    assert.equal(s.probes.length, 48, 'FPS-limited/hidden callbacks remain free of view probes');
    e.prepareView(100 + 1000 / 30);
    assert.equal(s.probes.length, 96); assert.ok(Math.abs(e.rig.clearance.seconds - 1 / 30) < 1e-12);
    e.prepareView(100000);
    assert.equal(e.rig.clearance.seconds, .05, 'resume interval is bounded');
    e.prepareView(99999);
    assert.equal(e.rig.clearance.seconds, 0, 'a backwards view clock cannot reverse easing');
    const probes = s.probes.length, draws = e.rig.drawCalls;
    const disposing = e.dispose(); e.update(DT, {}); e.prepareView(100100);
    assert.equal(s.probes.length, probes); assert.equal(e.rig.drawCalls, draws);
    await disposing;
  } finally { await e.dispose(); }
});

test('successful placement snaps clearance/time; a refused native placement retains the current channel and clock', async () => {
  let refuse = false;
  const s = nearWorld({ stairs: true });
  const world = { hull: { halfWidthMetres: .3, halfLengthMetres: .4, heightMetres: 1.8 },
    canPlace: request => !(refuse && request.reason === 'reset') };
  const e = createTestEntity(s, { z: -.08, dynamicWorld: world });
  try {
    e.prepareView(100); e.prepareView(116);
    assert.ok(e.rig.clearance.lift > .1);
    assert.ok(e.rig.clearance.faces.some(Number.isFinite));
    const prior = structuredClone(e.rig.clearance), state = physical(e), calls = e.rig.clearanceCalls;
    refuse = true;
    assert.equal(e.placeAt(-3, -1), false);
    assert.deepEqual(e.rig.clearance, prior); assert.equal(e.rig.clearanceCalls, calls);
    assert.deepEqual(physical(e), state);
    e.prepareView(132); assert.ok(Math.abs(e.rig.clearance.seconds - .016) < 1e-12);
    refuse = false;
    assert.equal(e.placeAt(-3, -1), true);
    assert.ok(isClear(e.rig.clearance)); assert.equal(e.rig.clearance.seconds, 0);
    assert.equal(e.rig.drawPose.x, -3); assert.equal(e.pose.x, -3);
    const probes = s.probes.length;
    assert.equal(probes, 144, 'placements do not run presentation queries');
    e.prepareView(100000);
    assert.ok(isClear(e.rig.clearance)); assert.equal(e.rig.clearance.seconds, 0, 'first view after teleport is a hard snap');
  } finally { await e.dispose(); }
});

test('manual and automatic native recovery clear stale view state without drawing/probing inside update', async () => {
  for (const manual of [true, false]) {
    const s = nearWorld();
    const target = { x: -3, y: 0, z: -1, headingY: 0 };
    s.findRecoveryTarget = (_request, canPlace) => canPlace(target) ? target : null;
    const e = createTestEntity(s, { z: -1 });
    try {
      e.prepareView(100); e.prepareView(116);
      assert.ok(!isClear(e.rig.clearance));
      e.controller.hardKnock(0, 1);
      e.controller.crashTime = manual ? e.controller.tuning.crashRecoverEarliestSeconds : e.controller.tuning.crashRecoverAutoSeconds;
      const probes = s.probes.length, draws = e.rig.drawCalls, serial = e.controller.placementSerial;
      e.update(DT, manual ? { resetPressed: true } : {});
      assert.equal(e.controller.crashed, false, manual ? 'manual Get Up' : 'native automatic recovery');
      assert.equal(e.controller.placementSerial, serial + 1);
      assert.ok(isClear(e.rig.clearance)); assert.equal(e.rig.clearance.seconds, 0);
      assert.equal(s.probes.length, probes); assert.equal(e.rig.drawCalls, draws);
      assert.deepEqual([e.pose.x, e.pose.y, e.pose.z], [-3, 0, -1], 'recovery drops pre-placement interpolation');
      e.prepareView(100000);
      assert.ok(isClear(e.rig.clearance)); assert.equal(e.rig.clearance.seconds, 0);
      assert.equal(e.rig.drawPose.x, -3);
    } finally { await e.dispose(); }
  }
});

test('candidate cancellation preserves committed clearance; rider commit clears channel/time before its first view', async () => {
  const s = nearWorld(), e = createTestEntity(s, { z: -1 });
  try {
    e.prepareView(100); e.prepareView(116);
    const old = e.rig, clearance = structuredClone(old.clearance), probes = s.probes.length;
    const pending = await e.prepareRider('trollina', { compile() {} });
    assert.equal(e.rig, old); assert.deepEqual(old.clearance, clearance);
    pending.dispose();
    assert.equal(e.rig, old); assert.deepEqual(old.clearance, clearance); assert.equal(s.probes.length, probes);
    const candidate = await e.prepareRider('red-rider', { compile() {} });
    const state = e.controller.snapshot();
    assert.equal(candidate.commit(), true); candidate.dispose();
    assert.equal(old.disposed, true); assert.notEqual(e.rig, old);
    assert.ok(isClear(e.rig.clearance)); assert.equal(e.rig.clearance.seconds, 0);
    assert.equal(s.probes.length, probes); assert.deepEqual(e.controller.snapshot(), state, 'same-style swap preserves physical motion');
    e.prepareView(100000);
    assert.equal(e.rig.clearance.seconds, 0); assert.ok(!isClear(e.rig.clearance));
    assert.deepEqual(old.clearance, clearance, 'a retired rig receives no later channel writes');
  } finally { await e.dispose(); }
});

test('held one-foot/tuck/player-180 coexist with view preparation; drawn and skipped schedules have identical physics/trick awards', async () => {
  const drawn = createTestEntity(), skipped = createTestEntity();
  let maxFoot = 0, maxTuck = 0, spinPressed = false, landed = '';
  try {
    for (let tick = 0; tick < 400; tick++) {
      const spin = !spinPressed && drawn.controller.canAcceptSpin && drawn.controller.secondsToTouchdown > .3;
      spinPressed ||= spin;
      const keys = { forward: .3, boost: true, up: tick >= 70, hopPressed: tick === 70 || spin };
      drawn.update(DT, keys); skipped.update(DT, keys);
      if (tick % 4 === 0) {
        const state = physical(drawn); drawn.prepareView(tick * 1000 / 120);
        assert.deepEqual(physical(drawn), state);
        assert.deepEqual(drawn.rig.drawPose, drawn.pose);
        maxFoot = Math.max(maxFoot, drawn.rig.foot); maxTuck = Math.max(maxTuck, drawn.rig.drawn.tuck);
        if (drawn.pose.airHeight > 1e-4) assert.ok(isClear(drawn.rig.clearance));
      }
      assert.deepEqual(drawn.controller.snapshot(), skipped.controller.snapshot());
      assert.equal(drawn.tricks.label, skipped.tricks.label);
      if (drawn.controller.touchedDown) landed = drawn.tricks.label;
    }
    assert.ok(spinPressed); assert.equal(maxFoot, 1); assert.equal(maxTuck, 1);
    assert.equal(landed, 'One-foot 180 + Air tuck');
    assert.equal(skipped.rig.drawCalls, 1, 'construction only: no implicit drawing from physics');
  } finally { await drawn.dispose(); await skipped.dispose(); }
});

function transitionWorld() {
  const spacing = .125, columns = 81, rows = 241, end = 2 * Math.sin(70 * Math.PI / 180);
  const height = z => z <= 20 ? 0 : 2 - Math.sqrt(4 - Math.min(z - 20, end) ** 2);
  const native = new PlanTerrainSampler({ id: 'view-transition-probe', spawn: { position: { x: 0, y: 0, z: 15 }, headingY: 0 },
    surround: { height: 0, surface: 'pavement' }, heightfield: { originX: -5, originZ: 0, spacing, columns, rows,
      heights: Array.from({ length: rows }, (_, row) => Array(columns).fill(height(row * spacing))).flat(),
      surfaces: Array((columns - 1) * (rows - 1)).fill('pavement') }, segments: [], checkpoints: [] });
  return { sampleGround: (...args) => native.sampleGround(...args), raycast: (...args) => native.raycast(...args),
    transitionAt(_x, z, referenceY) { assert.ok(Number.isFinite(referenceY)); return z >= 20 && z < 20 + end; } };
}

test('real RiderTricks: automatic come-back yaw never earns a player 180/fakie; an added native player spin still does', () => {
  for (const spin of [false, true]) for (const held of [false, true]) {
    const s = transitionWorld(), c = new EucController(s), p = createPose(), tricks = new RiderTricks();
    c.reset({ position: { x: 0, y: 0, z: 15 }, headingY: 0 }, 9);
    let began = -1, landed = false, yaw = 0, last = 0, label = '';
    const labels = [];
    for (let tick = 0; tick < 600; tick++) {
      const hop = spin && began >= 0 && tick === began + 3;
      c.step(DT, { ...NEUTRAL_ACTIONS, hop, hopHeld: held }); c.writePose(p);
      tricks.step(DT, c, p, held, held);
      if (began < 0 && c.inComeBackAir) {
        began = tick; last = c.headingY;
        s.transitionAt = () => false; // Already-authorized flight may leave its source feature.
      } else if (began >= 0 && !landed) { yaw += Math.abs(c.headingY - last); last = c.headingY; }
      if (began >= 0 && c.touchedDown && !landed) { landed = true; label = tricks.label; }
      if (tricks.label && labels.at(-1) !== tricks.label) labels.push(tricks.label);
    }
    assert.ok(began >= 0 && landed); assert.ok(yaw > (spin ? 5 : 2.8), `real yaw ${yaw}`);
    if (spin) assert.equal(label, held ? 'One-foot 180 + Air tuck' : '180');
    else {
      assert.equal(label, held ? 'One-foot air + Air tuck' : '');
      assert.ok(labels.every(value => !/180|Fakie/.test(value)), 'automatic half turn never fabricates player credit');
      assert.equal(tricks.hasSpin, false);
    }
  }
});
