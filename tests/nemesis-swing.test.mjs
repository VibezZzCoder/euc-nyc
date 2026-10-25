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
