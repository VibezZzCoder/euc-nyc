// Officer Dorkins' paddle swoop (js/nemesis-swing.js): phases, the arc on his right, and the hit test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwing, sweptHit, SWING as S } from '../js/nemesis-swing.js';

const DT = 1 / 120;
function step(swing, seconds) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const e = swing.update(DT);
    if (e) events.push(e);
  }
  return events;
}

test('wind-up, then the strike, then recovery and a cooldown before the next', () => {
  const swing = createSwing();
  assert.equal(swing.ready, true);
  swing.start();
  assert.deepEqual(step(swing, S.windupSeconds - 0.02), []);
  assert.ok(swing.commitment > 0.9, 'the arm is drawn back by the end of the wind-up');
  assert.deepEqual(step(swing, 0.04), ['strike']);
  assert.equal(swing.phase, 'active');
  assert.deepEqual(step(swing, S.activeSeconds + S.recoverSeconds), ['done']);
  assert.equal(swing.phase, 'idle');
  assert.equal(swing.ready, false);
  step(swing, S.cooldownSeconds + 0.01);
  assert.equal(swing.ready, true);
});

test('the sweep crosses his right-hand side, from behind to in front, at the drop height', () => {
  const swing = createSwing();
  const head = {};
  swing.start();
  step(swing, S.windupSeconds + 0.001);
  // facing +z (heading 0): his right is -x
  swing.headTarget(0, 0, 0, 0, head);
  assert.ok(head.z < 0 && head.x < 0, 'starts behind and to the right');
  let crossedRight = false;
  for (let t = 0; t < S.activeSeconds; t += DT) {
    swing.update(DT);
    swing.headTarget(0, 0, 0, 0, head);
    if (Math.abs(head.z) < 0.2 && head.x < -1.3) crossedRight = true;
  }
  assert.ok(crossedRight, 'passes straight out to his right');
  assert.ok(head.z > 0, 'ends in front');
  assert.ok(Math.abs(head.y - (1.42 - S.headDrop)) < 0.05, 'low: at the wheel and legs');
});

test('the hit test: in the arc it connects; swerved away or hopped over it does not', () => {
  const rider = { x: -1.64, z: 0, bottom: 0 };
  // the face sweeping past at 0.35 m up, 1.64 m out to his right
  const across = [-1.4, 0.35, -0.8, -1.4, 0.35, 0.8];
  assert.equal(sweptHit(...across, rider), true);
  assert.equal(sweptHit(...across, { ...rider, x: -1.64 - 0.8 }), false, 'swerved 0.8 m away');
  assert.equal(sweptHit(...across, { ...rider, bottom: 0.6 }), false, 'hopped over it');
  assert.equal(sweptHit(...across, { ...rider, bottom: 0.3 }), true, 'a hop too low');
});

test('strike admission retains both partial boundary frames, but no wind-up or return', () => {
  const swing = createSwing();
  const empty = () => assert.ok(swing.contact.from > swing.contact.to);
  swing.start();
  swing.update(0.69); empty();
  swing.update(0.05);
  assert.equal(swing.phase, 'active');
  assert.ok(Math.abs(swing.contact.from - 0.2) < 1e-10);
  assert.equal(swing.contact.to, 1);
  swing.update(0.10);
  swing.update(0.05);
  assert.equal(swing.phase, 'recover');
  assert.equal(swing.contact.from, 0);
  assert.ok(Math.abs(swing.contact.to - 0.4) < 1e-10, 'last 20 ms of the sweep must still count');
  swing.update(0.05); empty();
  swing.cancel(0); empty();
});

for (const direction of [1, -1]) test(`a moving rider crossing the paddle between frames is hit (${direction > 0 ? 'forward' : 'reverse'})`, () => {
  const previous = { x: 0, bottom: 0, z: -0.8 * direction };
  const rider = { ...previous, z: 0.8 * direction };
  const face = [0, 0.35, 0, 0, 0.35, 0.1 * direction];
  assert.equal(sweptHit(...face, rider), false, 'latest position alone misses the contact');
  assert.equal(sweptHit(...face, rider, S, previous), true);
});

for (const direction of [1, -1]) test(`matching rider/paddle motion does not hit an already-vacated position (${direction})`, () => {
  const previous = { x: 0, bottom: 0, z: 0 };
  const rider = { ...previous, z: 2 * direction };
  const face = [0, 0.35, 0.8 * direction, 0, 0.35, 2.8 * direction];
  assert.equal(sweptHit(...face, rider), true, 'the old stationary-target test creates a phantom contact');
  assert.equal(sweptHit(...face, rider, S, previous), false, 'always 0.8 m apart');
});

test('a grazing contact between the old six samples is found without enlarging reach', () => {
  const rider = { x: 0, bottom: 0, z: 0 };
  assert.equal(sweptHit(-2.3, 0.35, 0.5, 1.7, 0.35, 0.5, rider), true);
  assert.equal(sweptHit(-2.3, 0.35, S.hitRadius + 0.001, 1.7, 0.35, S.hitRadius + 0.001, rider), false);
});

test('contact must occur during the striking slice, not on wind-up or return', () => {
  const rider = { x: 0, bottom: 0, z: 0 };
  const face = [-2, 0.35, 0, 0, 0.35, 0];
  assert.equal(sweptHit(...face, rider, S, rider, { from: 0, to: 0.4 }), false);
  assert.equal(sweptHit(...face, rider, S, rider, { from: 0.8, to: 1 }), true);
  assert.equal(sweptHit(...face, rider, S, rider, { from: 1, to: 0 }), false);
});

test('moving hop height and sideways distance must overlap at the same instant', () => {
  const previous = { x: 0, bottom: 0, z: 0 }, rider = { ...previous, bottom: 1 };
  assert.equal(sweptHit(0, 0.3, 0, 0, 0.3, 0, rider, S, previous), true, 'contact before takeoff clears the face');
  assert.equal(sweptHit(0, 0.3, 0, 0, 0.3, 0, rider, S, previous, { from: 0.8, to: 1 }), false, 'already above it by the striking slice');
  assert.equal(sweptHit(0, -0.5, 0, 2, 0.1, 0, previous), false, 'by the time the paddle rises, it is sideways out of reach');
});
