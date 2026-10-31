import test from 'node:test';
import assert from 'node:assert/strict';
import { EucController, createPose, copyPose } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { RiderTricks, TRICK_FEEDBACK_SECONDS } from '../js/euc-tricks.js';
import { EucHud } from '../js/euc-hud.js';
import { createTestEntity as entity } from './helpers/euc-entity.mjs';

const DT = 1 / 120;
const flat = { sampleGround(x, z, out) {
  Object.assign(out, { height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false }); return out;
}, raycast() { return null; } };

function flight({ foot = false, tuck = false, spin = false, cancel = false, crash = false, charged = true } = {}) {
  const c = new EucController(flat), pose = createPose(), tricks = new RiderTricks();
  c.reset({ position: { x: 0, y: 0, z: 0 }, headingY: 0 }, 5);
  let airSteps = 0, maxFoot = 0, maxTuck = 0, landed = false, landingLabel = '', beforeLandingFoot = 0;
  const labels = new Set();
  for (let i = 0; i < 420; i++) {
    // Charge before hopping; keep crouch only for the intentional air tuck.
    const hop = i === 70 || (spin && airSteps === 6);
    const hopHeld = foot && (!spin || airSteps >= 6);
    c.step(DT, { ...NEUTRAL_ACTIONS, crouch: (charged && i < 70) || (tuck && i >= 70), hop, hopHeld });
    c.writePose(pose);
    if (c.groundClearance > 0) airSteps++;
    if (cancel && airSteps === 32) tricks.cancel();
    if (crash && airSteps === 32) { c.hardKnock(1, 0); c.writePose(pose); }
    tricks.step(DT, c, pose, hopHeld, (charged && i < 70) || (tuck && i >= 70));
    maxFoot = Math.max(maxFoot, tricks.foot.oneFoot);
    maxTuck = Math.max(maxTuck, tricks.tuck.oneFoot);
    if (tricks.label) labels.add(tricks.label);
    if (c.touchedDown) {
      landed = true; landingLabel = tricks.label;
      beforeLandingFoot = tricks.previousFoot;
    }
  }
  return { c, pose, tricks, labels: [...labels], maxFoot, maxTuck, landed, landingLabel, beforeLandingFoot };
}

test('real flight: a tap is a normal hop; held Hop shows one foot and returns before landing', () => {
  const tap = flight(), held = flight({ foot: true });
  assert.ok(tap.landed && held.landed);
  assert.equal(tap.maxFoot, 0);
  assert.equal(tap.maxTuck, 0);
  assert.deepEqual(tap.labels, []);
  assert.equal(held.maxFoot, 1);
  assert.equal(held.landingLabel, 'One-foot air');
  assert.equal(held.beforeLandingFoot, 0);
  assert.equal(held.tricks.foot.oneFoot, 0, 'holding through landing does not keep a foot off the pedal');
});

test('real rising second press: spin plus held foot, tuck and continuous fakie ride-out', () => {
  for (const options of [{ spin: true }, { spin: true, foot: true }, { spin: true, foot: true, tuck: true }]) {
    const r = flight(options);
    assert.ok(r.landed && !r.c.crashed);
    const label = (options.foot ? 'One-foot 180' : '180') + (options.tuck ? ' + Air tuck' : '');
    assert.equal(r.landingLabel, label);
    assert.deepEqual(r.labels, [label, `${label} → Fakie`]);
  }
});

test('air tuck uses a separate hold and cannot accidentally count as one-foot', () => {
  const r = flight({ tuck: true });
  assert.equal(r.maxTuck, 1);
  assert.equal(r.maxFoot, 0);
  assert.equal(r.landingLabel, 'Air tuck');
});

test('ordinary uncharged jumps have enough airtime for the held foot and early 180 combination', () => {
  for (const spin of [false, true]) {
    const r = flight({ foot: true, spin, charged: false });
    assert.equal(r.maxFoot, 1);
    assert.equal(r.landingLabel, spin ? 'One-foot 180' : 'One-foot air');
  }
});

test('cancelled or crashed flights never receive landing/fakie feedback', () => {
  assert.deepEqual(flight({ foot: true, spin: true, cancel: true }).labels, []);
  assert.deepEqual(flight({ foot: true, spin: true, crash: true }).labels, []);
});

test('observer and render overlays never change native controller pose or motion', () => {
  const c = new EucController(flat), pose = createPose(), render = createPose(), tricks = new RiderTricks();
  let visible = false;
  for (let i = 0; i < 200; i++) {
    c.step(DT, { ...NEUTRAL_ACTIONS, crouch: true, hop: i === 70, hopHeld: true });
    c.writePose(pose);
    const before = structuredClone(pose);
    tricks.step(DT, c, pose, true, true);
    copyPose(pose, render);
    tricks.apply(render, 0.5, { setTrickPose() {} });
    visible ||= render.tuck > pose.tuck + 0.5;
    c.writePose(pose);
    assert.deepEqual(pose, before);
    for (const k of ['x', 'y', 'z', 'headingY', 'wheelSpin', 'speed']) assert.equal(render[k], pose[k]);
  }
  assert.ok(visible, 'the held tuck visibly deepens the native airborne pose');
});

test('short remaining airtime refuses a foot/tuck rather than leaving a leg out at touchdown', () => {
  const t = new RiderTricks();
  const c = { flightIndex: 1, groundClearance: 0.02, verticalRate: -2, secondsToTouchdown: 0.01,
    crashed: false, canAcceptHop: false, spinCompleted: false, isGrounded: false };
  for (let i = 0; i < 60; i++) t.step(DT, c, { recoverBlend: 1, speed: 4 }, true, true);
  assert.equal(t.foot.oneFoot, 0);
  assert.equal(t.tuck.oneFoot, 0);
  assert.equal(t.label, '');
});

test('fakie requires a landed spin and continuous moving ground time; reset clears everything', () => {
  const c = { flightIndex: 1, groundClearance: 0, verticalRate: 0, secondsToTouchdown: 0,
    crashed: false, canAcceptHop: true, spinCompleted: false, isGrounded: true, touchedDown: false };
  const pose = { recoverBlend: 1, speed: -4 }, t = new RiderTricks();
  for (let i = 0; i < 180; i++) t.step(DT, c, pose, false, false);
  assert.equal(t.label, '', 'ordinary reverse is not a fakie trick');
  c.spinCompleted = true; c.touchedDown = true;
  t.step(DT, c, pose, false, false);
  c.touchedDown = false;
  for (let i = 0; i < 20; i++) t.step(DT, c, pose, false, false);
  pose.speed = 0; t.step(DT, c, pose, false, false);
  pose.speed = -4;
  for (let i = 0; i < 150; i++) t.step(DT, c, pose, false, false);
  assert.equal(t.label, '180', 'stopping breaks the ride-out');
  for (let i = 0; i < TRICK_FEEDBACK_SECONDS * 120; i++) t.step(DT, c, pose, false, false);
  assert.equal(t.label, '');
  t.announce('Air tuck'); t.reset();
  assert.equal(t.label, ''); assert.equal(t.fakieBase, '');
  assert.equal(t.previousFoot, 0); assert.equal(t.previousTuck, 0);
});

test('production entity: held input reaches interpolated rig, native jump is immediate, swap/placement clear tricks', () => {
  for (const hz of [30, 60, 120]) {
    const e = entity();
    for (let i = 0; i < hz; i++) e.update(1 / hz, { boost: true });
    e.update(1 / hz, { up: true });
    assert.equal(e.controller.canAcceptHop, false, 'hop accepted immediately into native preload');
    let foot = 0;
    for (let i = 0; i < hz; i++) { e.update(1 / hz, { up: true }); foot = Math.max(foot, e.rig.foot); }
    assert.equal(foot, 1, `${hz} Hz one foot reaches the rendered rig`);
    assert.equal(e.tricks.label, 'One-foot air');
    e.clearInput(); assert.equal(e.tricks.label, '');
    e.tricks.announce('180'); e.setRider('trollina'); assert.equal(e.tricks.label, '');
    e.tricks.announce('180'); e.placeAt(0, 0); assert.equal(e.tricks.label, '');
    assert.equal(e.rig.foot, 0);
    e.dispose();
  }
});

test('landing feedback DOM clears on crash and only writes changed labels', () => {
  let writes = 0;
  const el = { hidden: true, set textContent(v) { this.text = v; writes++; } };
  const hud = new EucHud({ getElementById: id => id === 'hud-trick' ? el : null });
  hud.update({}, 0, 'keyboard', 'One-foot 180');
  assert.equal(el.text, 'Landed · One-foot 180'); assert.equal(el.hidden, false);
  hud.update({}, 0.1, 'keyboard', 'One-foot 180'); assert.equal(writes, 1);
  hud.update({ crashed: true }, 0.2, 'keyboard', 'One-foot 180'); assert.equal(el.hidden, true);
});
