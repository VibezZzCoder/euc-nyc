// Officer Dorkins' chase rules (js/nemesis-chase.js): ambush timing, escape clocks, giving up, and the HUD view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChaseDirector, chaseHudView, NemesisHud, CHASE_RULES as R } from '../js/nemesis-chase.js';

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

test('a corner alone never escapes; a glimpse resets both escape requirements', () => {
  const d = createChaseDirector({ random: () => 0 });
  d.soon();
  assert.deepEqual(run(d, DT, riding), ['ambush']);
  // arriving unseen does not count
  assert.deepEqual(run(d, 20, { ...riding, sees: false, distance: 100 }), []);
  run(d, 1, riding);
  assert.equal(d.state.acquired, true);
  // a glimpse resets the clock
  run(d, R.loseSeconds * 2, { ...riding, sees: false });
  assert.equal(d.state.phase, 'chasing', 'hiding nearby is insufficient, however long');
  run(d, DT, riding);
  run(d, R.loseSeconds - 1, { ...riding, sees: false, distance: 200 });
  run(d, DT, riding);
  assert.equal(d.state.unseen, 0);
  assert.equal(d.state.far, 0);
  assert.deepEqual(run(d, R.loseSeconds - 0.2, { ...riding, sees: false, distance: 200 }), []);
  assert.deepEqual(run(d, 0.4, { ...riding, sees: false, distance: 200 }), ['escaped']);
  assert.equal(d.state.phase, 'leaving');
});

test('distance alone cannot escape; distance must also stay open continuously', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, 1, riding);
  assert.deepEqual(run(d, 30, { ...riding, distance: 200 }), [], 'visible even at range: not escaped');
  run(d, R.loseSeconds, { ...riding, sees: false, distance: 100 });
  run(d, R.outrunSeconds - 1, { ...riding, sees: false, distance: 200 });
  run(d, DT, { ...riding, sees: false, distance: 100 });
  assert.equal(d.state.far, 0, 'closing the gap breaks the distance hold');
  assert.deepEqual(run(d, R.outrunSeconds - 0.2, { ...riding, sees: false, distance: 200 }), []);
  assert.deepEqual(run(d, 0.4, { ...riding, sees: false, distance: 200 }), ['escaped']);
});

test('crashing and getting up preserve the pursuit/tally, clear escape progress and allow recovery', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, 1, riding);
  d.knockedDown();
  const hidden = { ...riding, sees: false, distance: 200 };
  assert.deepEqual(run(d, R.loseSeconds * 3, { ...hidden, crashed: true }), []);
  assert.equal(d.state.phase, 'chasing');
  assert.equal(d.state.knockdowns, 1);
  assert.equal(d.state.unseen, 0);
  assert.equal(d.state.far, 0);
  assert.deepEqual(run(d, R.recoverySeconds - 0.2, hidden), []);
  assert.ok(d.state.recovery > 0);
  assert.equal(d.state.knockdowns, 1);
  run(d, 0.3, hidden);
  run(d, R.loseSeconds - 1, hidden);
  assert.equal(d.state.phase, 'chasing', 'no banked escape on get-up');
  assert.deepEqual(run(d, 1.2, hidden), ['escaped']);
});

test('never seen at all: silent withdrawal, not a false escape celebration', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, DT, riding);
  assert.deepEqual(run(d, R.acquireSeconds + 0.1, { ...riding, sees: false, distance: 400 }), ['missed']);
  assert.equal(chaseHudView(d.state, 400).banner, null);
});

test('after giving up he is gone once out of view (or after leaveSeconds), and the next ambush is a while off', () => {
  const d = createChaseDirector({ random: () => 0 });
  d.soon();
  run(d, 1, riding);
  run(d, R.loseSeconds + 0.1, { ...riding, sees: false, distance: 200 });
  assert.deepEqual(run(d, R.leaveSeconds - 0.2, { ...riding, inView: true }), []);
  assert.deepEqual(run(d, 0.4, { ...riding, inView: true }), ['gone']);
  assert.equal(d.state.phase, 'waiting');
  assert.ok(d.state.wait >= R.againMin - 1);
  assert.deepEqual(run(d, R.againMin - 1, riding), []);

  const e = createChaseDirector();
  e.soon();
  run(e, 1, riding);
  run(e, R.loseSeconds + 0.1, { ...riding, sees: false, distance: 200 });
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

test('HUD distinguishes searching nearby from genuinely losing him; escape meter needs both holds', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, DT, { ...riding, sees: false });
  let v = chaseHudView(d.state, 80);
  assert.equal(v.banner, 'ambush');
  assert.equal(v.cue, 'incoming');
  run(d, 0.5, riding);
  v = chaseHudView(d.state, 24.4);
  assert.deepEqual([v.cue, v.metres, v.losing], ['seen', 24, 0]);
  run(d, R.loseSeconds / 2, { ...riding, sees: false });
  v = chaseHudView(d.state, 40);
  assert.equal(v.cue, 'unseen');
  assert.equal(v.losing, 0, 'no green escape progress for hiding nearby');
  run(d, R.bannerSeconds, riding);
  assert.equal(chaseHudView(d.state, 10).banner, null);
  run(d, R.loseSeconds / 2, { ...riding, sees: false, distance: R.outrunDistance + 5 });
  v = chaseHudView(d.state, R.outrunDistance + 5);
  assert.equal(v.cue, 'far');
  assert.ok(Math.abs(v.losing - 0.5) < 0.02);
  run(d, R.loseSeconds / 2 + 0.1, { ...riding, sees: false, distance: R.outrunDistance + 5 });
  v = chaseHudView(d.state, 300);
  assert.deepEqual([v.banner, v.cue], ['escaped', null]);
});

test('first three knockdowns are warnings; only the fourth successful knockdown captures', () => {
  const d = createChaseDirector({ random: () => 0 });
  d.soon();
  run(d, 1, riding);
  assert.equal(chaseHudView(d.state, 3, R, 'windup').banner, 'paddle');
  for (let hit = 1; hit <= 3; hit++) {
    assert.equal(d.knockedDown(), true);
    assert.equal(d.knockedDown(), false, 'duplicate / recovery contact cannot double count');
    const v = chaseHudView(d.state, 3, R, 'recover');
    assert.equal(d.state.phase, 'chasing');
    assert.equal(v.knockdowns, hit);
    assert.equal(v.heat, Math.min(hit, 3));
    assert.equal(v.hot, hit >= 3);
    assert.equal(v.banner, 'warning');
    assert.equal(v.cue, 'recovering');
    assert.ok(!v.bannerText.includes('Busted'));
    assert.deepEqual(run(d, 2, { ...riding, crashed: true }), []);
    assert.deepEqual(run(d, R.recoverySeconds + 0.2, riding), []);
    assert.equal(d.state.recovery, 0);
  }
  assert.match(chaseHudView(d.state, 3).heatText, /arrest risk/);
  assert.match(chaseHudView(d.state, 3, R, 'windup').bannerText, /Arrest risk/);
  assert.equal(d.knockedDown(), true);
  assert.equal(d.state.knockdowns, 4);
  assert.equal(d.state.phase, 'captured');
  assert.equal(d.state.lastEvent, 'captured');
  const captured = { ...d.state };
  run(d, 100, { ...riding, sees: false, distance: 999 });
  assert.deepEqual(d.state, captured, 'capture hands control to booking; escape/ambush clocks cannot continue');
  assert.equal(d.knockedDown(), false, 'no repeated capture or fifth tally during booking');
  assert.equal(d.release(), true);
  assert.equal(d.state.phase, 'waiting');
  assert.equal(d.state.knockdowns, 0);
  assert.ok(d.state.wait >= R.againMin, 'release starts a proper quiet spell');
  assert.equal(d.release(), false, 'release is idempotent');
});

test('a genuine escape clears warnings only on the next pursuit, with capture still avoidable', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, 1, riding);
  d.knockedDown();
  run(d, R.recoverySeconds + 0.1, riding);
  run(d, R.loseSeconds + 0.1, { ...riding, sees: false, distance: 200 });
  assert.equal(d.state.knockdowns, 1, 'retained through the escape banner');
  run(d, R.leaveMinSeconds + 0.1, { ...riding, inView: false });
  assert.equal(d.knockedDown(), false, 'no hits while waiting');
  d.soon();
  run(d, 1, riding);
  assert.equal(d.state.knockdowns, 0, 'only a fresh pursuit resets the warnings');
});

test('menus/hidden-tab gate freeze pursuit, tally, banner age and escape clocks', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, 1, riding);
  d.knockedDown();
  const before = { ...d.state };
  run(d, 90, { ...riding, riding: false, sees: false, distance: 999 });
  assert.deepEqual(d.state, before);
});

test('an unrelated crash does not count as a paddle strike', () => {
  const d = createChaseDirector();
  d.soon();
  run(d, 1, riding);
  run(d, 10, { ...riding, crashed: true });
  run(d, 4, riding);
  assert.equal(d.state.knockdowns, 0);
});

test('HUD writer updates warning text even if two hits share the same banner kind', () => {
  const nodes = Object.fromEntries(['banner', 'chase', 'text', 'meter', 'heat', 'heat-text'].map((id) => [
    id === 'chase' ? 'hud-chase' : `hud-chase-${id}`, { hidden: true, dataset: {}, style: {}, textContent: '' },
  ]));
  // The normal text id is hud-chase-text, all other ids follow the same convention.
  const hud = new NemesisHud({ getElementById: (id) => nodes[id] });
  const d = createChaseDirector();
  d.soon();
  run(d, 1, riding);
  d.knockedDown();
  hud.update(chaseHudView(d.state, 3));
  assert.match(nodes['hud-chase-banner'].textContent, /1\/3/);
  run(d, R.recoverySeconds + 0.1, riding);
  d.knockedDown();
  hud.update(chaseHudView(d.state, 3));
  assert.match(nodes['hud-chase-banner'].textContent, /2\/3/);
  assert.equal(nodes['hud-chase-heat'].dataset.level, '2');
  assert.equal(nodes['hud-chase'].dataset.hot, 'false');
});
