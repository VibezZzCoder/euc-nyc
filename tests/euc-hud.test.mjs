// The wheel's HUD cues (js/euc-hud.js): both speed units, the power ladder dwell, tilt-back, over-speed, get-up prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHudModel, formatSpeed, overspeedLevel, getUpPrompt, GET_UP_PROMPT_DELAY, WARNING_LABELS, WARNING_MIN_VISIBLE_SECONDS }
  from '../js/euc-hud.js';
import { overspeedBeepPeriod } from '../js/euc-audio.js';

test('speed reads in whole mph and km/h, unsigned, never -0', () => {
  assert.equal(formatSpeed(10, 'mph'), '22');
  assert.equal(formatSpeed(10, 'kmh'), '36');
  assert.equal(formatSpeed(-10, 'kmh'), '36', 'reversing is not a negative speed');
  assert.equal(formatSpeed(-0.1, 'mph'), '0');
  assert.equal(formatSpeed(NaN, 'mph'), '0');
});

test('the power ladder rises at once and falls only after 0.7 s', () => {
  const hud = createHudModel();
  assert.equal(hud.update({ powerStage: 'normal' }, 0).warning, 'none');
  assert.equal(hud.update({ powerStage: 'warn' }, 1).warning, 'warn');
  assert.equal(hud.update({ powerStage: 'notice' }, 1.2).warning, 'warn', 'holds while the dwell runs');
  const down = hud.update({ powerStage: 'notice' }, 1 + WARNING_MIN_VISIBLE_SECONDS + 0.01);
  assert.equal(down.warning, 'notice');
  assert.equal(down.warningLabel, WARNING_LABELS.notice);
  assert.equal(hud.update({ powerStage: 'normal' }, 5).warning, 'none');
});

test('tilt-back overrides the ladder; a crash clears every cue', () => {
  const hud = createHudModel();
  const tilt = hud.update({ powerStage: 'notice', tiltBack: 0.5 }, 0);
  assert.equal(tilt.warning, 'tiltBack');
  assert.match(tilt.warningLabel, /Tilt-back/);
  const crashed = hud.update({ crashed: true, powerStage: 'tiltBack', tiltBack: 1, overspeed: 1 }, 0.1);
  assert.equal(crashed.warning, 'none');
  assert.equal(crashed.overspeed.visible, false);
});

test('over-speed shows with EUC Thrills colour steps and blinks at the beep period', () => {
  const hud = createHudModel();
  assert.equal(hud.update({ overspeed: 0 }, 0).overspeed.visible, false);
  const view = hud.update({ overspeed: 0.5 }, 0).overspeed;
  assert.equal(view.visible, true);
  assert.equal(view.level, 'warn');
  assert.equal(view.period, Math.round(overspeedBeepPeriod(0.5) * 100) / 100);
  assert.deepEqual([0, 0.1, 0.42, 0.78, 1].map(overspeedLevel), ['none', 'notice', 'warn', 'critical', 'critical']);
});

test('the get-up prompt waits a moment after a crash and names the button for the device in use', () => {
  assert.equal(getUpPrompt({ crashed: false, crashTime: 9 }), null);
  assert.equal(getUpPrompt({ crashed: true, crashTime: GET_UP_PROMPT_DELAY - 0.01 }), null);
  const at = { crashed: true, crashTime: GET_UP_PROMPT_DELAY };
  assert.deepEqual(getUpPrompt(at, 'keyboard').keys, ['R']);
  assert.deepEqual(getUpPrompt(at, 'gamepad').keys, ['B']);
  const touch = getUpPrompt(at, 'touch');
  assert.equal(touch.verb, 'Tap');
  assert.deepEqual(touch.keys, ['GET UP']);
});
