// Officer Dorkins' chase rules (js/nemesis-chase.js): ambush timing, escape clocks, giving up, and the HUD view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChaseDirector, chaseHudView, CHASE_RULES as R } from '../js/nemesis-chase.js';

const DT = 0.05;
/** Step `seconds` with the same facts; returns the events fired, in order. */
function run(director, seconds, facts) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const e = director.update(DT, facts);
    if (e) events.push(e);
  }
  return events;
}
const riding = { riding: true, crashed: false, distance: 20, sees: true, inView: true };

test('the first ambush comes within its window after Ride, and not before Ride', () => {
  const d = createChaseDirector({ random: () => 0.5 });
  const first = (R.firstMin + R.firstMax) / 2;
  assert.deepEqual(run(d, 60, { riding: false }), []);
  assert.deepEqual(run(d, first - 0.2, riding), []);
  assert.deepEqual(run(d, 0.4, riding), ['ambush']);
  assert.equal(d.state.phase, 'chasing');
});

test('never while the rider is down, nor just after getting up', () => {
  const d = createChaseDirector({ random: () => 0 });
  assert.deepEqual(run(d, R.firstMin + 5, { ...riding, crashed: true }), []);
  assert.deepEqual(run(d, R.calmSeconds - 0.2, riding), []);
  assert.deepEqual(run(d, 0.4, riding), ['ambush']);
});

test('the clocks wait until he has seen the player; out of sight long enough loses him', () => {
  const d = createChaseDirector({ random: () => 0 });
  d.soon();
  assert.deepEqual(run(d, DT, riding), ['ambush']);
  // arriving unseen does not count
  assert.deepEqual(run(d, 20, { ...riding, sees: false, distance: 100 }), []);
  run(d, 1, riding);
  assert.equal(d.state.acquired, true);
  // a glimpse resets the clock
  run(d, R.loseSeconds - 1, { ...riding, sees: false });
  run(d, DT, riding);
  assert.deepEqual(run(d, R.loseSeconds - 0.2, { ...riding, sees: false }), []);
  assert.deepEqual(run(d, 0.4, { ...riding, sees: false }), ['escaped']);
  assert.equal(d.state.phase, 'leaving');
});

test('outrunning him: far enough, long enough', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, 1, riding);
  assert.deepEqual(run(d, R.outrunSeconds - 0.2, { ...riding, distance: R.outrunDistance + 1 }), []);
  assert.deepEqual(run(d, 0.4, { ...riding, distance: R.outrunDistance + 1 }), ['escaped']);
});

test('a crash is no hiding place: the clocks stand still while the rider is down', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, 1, riding);
  assert.deepEqual(run(d, R.loseSeconds * 3, { ...riding, sees: false, crashed: true }), []);
  assert.equal(d.state.phase, 'chasing');
});

test('never seen at all: he gives up in the end', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, DT, riding);
  assert.deepEqual(run(d, R.acquireSeconds + 0.1, { ...riding, sees: false, distance: 400 }), ['escaped']);
});

test('after giving up he is gone once out of view (or after leaveSeconds), and the next ambush is a while off', () => {
  const d = createChaseDirector({ random: () => 0 });
  d.soon();
  run(d, 1, riding);
  run(d, R.loseSeconds + 0.1, { ...riding, sees: false });
  assert.deepEqual(run(d, R.leaveSeconds - 0.2, { ...riding, inView: true }), []);
  assert.deepEqual(run(d, 0.4, { ...riding, inView: true }), ['gone']);
  assert.equal(d.state.phase, 'waiting');
  assert.ok(d.state.wait >= R.againMin - 1);
  assert.deepEqual(run(d, R.againMin - 1, riding), []);

  const e = createChaseDirector();
  e.soon();
  run(e, 1, riding);
  run(e, R.loseSeconds + 0.1, { ...riding, sees: false });
  assert.deepEqual(run(e, R.leaveMinSeconds + 0.1, { ...riding, inView: false }), ['gone']);
});

test('postpone keeps him waiting and retries', () => {
  const d = createChaseDirector();
  d.soon();
  assert.deepEqual(run(d, DT, riding), ['ambush']);
  d.postpone(1);
  assert.equal(d.state.phase, 'waiting');
  assert.deepEqual(run(d, 0.9, riding), []);
  assert.deepEqual(run(d, 0.2, riding), ['ambush']);
});

test('HUD view: banner on ambush and escape; the cue only once he has seen the player; losing fills', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, DT, { ...riding, sees: false });
  let v = chaseHudView(d.state, 80);
  assert.equal(v.banner, 'ambush');
  assert.equal(v.cue, null);
  run(d, 0.5, riding);
  v = chaseHudView(d.state, 24.4);
  assert.deepEqual([v.cue, v.metres, v.losing], ['seen', 24, 0]);
  run(d, R.loseSeconds / 2, { ...riding, sees: false });
  v = chaseHudView(d.state, 40);
  assert.equal(v.cue, 'unseen');
  assert.ok(Math.abs(v.losing - 0.5) < 0.02);
  run(d, R.bannerSeconds, riding);
  assert.equal(chaseHudView(d.state, 10).banner, null);
  run(d, R.outrunSeconds / 2, { ...riding, distance: R.outrunDistance + 5 });
  v = chaseHudView(d.state, R.outrunDistance + 5);
  assert.equal(v.cue, 'far');
  run(d, R.outrunSeconds, { ...riding, distance: R.outrunDistance + 5 });
  v = chaseHudView(d.state, 300);
  assert.deepEqual([v.banner, v.cue], ['escaped', null]);
});

test('busted: the chase ends with his hit, he hovers a moment, then leaves; the banners', () => {
  const d = createChaseDirector({ random: () => 0 });
  d.soon();
  run(d, 1, riding);
  assert.equal(chaseHudView(d.state, 3, R, 'windup').banner, 'paddle');
  d.busted();
  assert.equal(d.state.phase, 'leaving');
  assert.ok(d.state.leaveTime < 0, 'hovering first');
  assert.equal(chaseHudView(d.state, 3, R, 'recover').banner, 'busted');
  assert.deepEqual(run(d, R.bustedHoverSeconds + R.leaveMinSeconds - 0.1, { ...riding, crashed: true, inView: false }), []);
  assert.deepEqual(run(d, 0.2, { ...riding, crashed: true, inView: false }), ['gone']);
  assert.ok(d.state.wait >= R.againMin - 1, 'and the next ambush is a while off');
  d.busted(); // not chasing: nothing
  assert.equal(d.state.phase, 'waiting');
});
