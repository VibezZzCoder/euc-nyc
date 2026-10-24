// Headless: the rider's audio logic (js/euc-audio.js) without a browser. Pure mappings are checked directly. The voice
// graph is built on a small fake AudioContext, which records what would play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EUC_SAMPLE_FILES, EucAudio, WHEEL_RADIUS, MOTOR, crashSampleKey, overspeedBeepPeriod, planBeeps, wheelHz,
  motorFundamentalHz, motorDrive, motorTargets, windTargets, tyreTargets, landingScale, impactScale, WIND,
} from '../js/euc-audio.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_DIR = join(ROOT, 'audio/euc');
const ALLOWED = ['crash_trollina.wav', 'crash_wipeout.wav', 'overspeed_beep.wav', 'tyre_solid_loop.wav', 'wind_howl_loop.wav'];
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('only the five approved sample files ship, matching PROVENANCE.md hashes', () => {
  const files = readdirSync(SAMPLE_DIR).sort();
  assert.deepEqual(files, [...ALLOWED, 'PROVENANCE.md'].sort());
  assert.deepEqual(Object.values(EUC_SAMPLE_FILES).sort(), ALLOWED);
  const provenance = readFileSync(join(SAMPLE_DIR, 'PROVENANCE.md'), 'utf8');
  assert.match(provenance, /Assets from EUC Thrills by VibezZzCoder — CC BY 4\.0 — https:\/\/github\.com\/VibezZzCoder\/EUC-thrills/);
  assert.match(provenance, /5f45fff/);
  assert.match(provenance, /gpt-audio/, 'the machine-generated vocal in crash_trollina is declared');
  for (const file of ALLOWED) {
    const hash = createHash('sha256').update(readFileSync(join(SAMPLE_DIR, file))).digest('hex');
    assert.ok(provenance.includes(`\`${file}\``) && provenance.includes(hash), `${file} is listed with sha256 ${hash}`);
  }
});

test('the audio modules name no crash sample other than the two in scope', () => {
  const sources = ['euc-audio.js', ...readdirSync(join(ROOT, 'js')).filter((f) => /^audio-.*\.js$/.test(f))];
  for (const file of sources) {
    const text = readFileSync(join(ROOT, 'js', file), 'utf8');
    for (const [name] of text.matchAll(/crash_[a-z_]+/g)) {
      assert.ok(name === 'crash_wipeout' || name === 'crash_trollina', `${file} mentions ${name}`);
    }
  }
});

test('crash voice by rider: Trollina has her own, everyone else gets the wipeout', () => {
  assert.equal(EUC_SAMPLE_FILES[crashSampleKey('trollina')], 'crash_trollina.wav');
  for (const id of ['cool-rider', 'cop', undefined, 'someone-else']) {
    assert.equal(EUC_SAMPLE_FILES[crashSampleKey(id)], 'crash_wipeout.wav');
  }
});

test('over-speed beep period: geometric from 1.10 s to 0.14 s, clamped', () => {
  near(overspeedBeepPeriod(0), 1.1);
  near(overspeedBeepPeriod(1), 0.14);
  near(overspeedBeepPeriod(-3), 1.1);
  near(overspeedBeepPeriod(7), 0.14);
  near(overspeedBeepPeriod(0.5), Math.sqrt(1.1 * 0.14));
  // equal steps of factor give equal ratios
  near(overspeedBeepPeriod(0.25) / overspeedBeepPeriod(0), overspeedBeepPeriod(0.75) / overspeedBeepPeriod(0.5), 1e-12);
  near(overspeedBeepPeriod(0.5, 0, 0), 1, 1e-12); // bad endpoints never give NaN or a zero period
});

test('beep schedule: silent at factor 0, immediate on crossing, then one per period on the audio clock', () => {
  assert.deepEqual(planBeeps(-Infinity, 0, 10), { times: [], next: -Infinity });
  assert.deepEqual(planBeeps(10.5, 0, 10).times, [], 'dropping below the threshold disarms a pending beep');
  let plan = planBeeps(-Infinity, 0.5, 10, 0.05);
  assert.deepEqual(plan.times, [10]);
  const period = overspeedBeepPeriod(0.5);
  near(plan.next, 10 + period);
  plan = planBeeps(plan.next, 0.5, 10.1, 0.05);
  assert.deepEqual(plan.times, [], 'nothing due yet');
  plan = planBeeps(plan.next, 0.5, 10 + period - 0.01, 0.05);
  assert.equal(plan.times.length, 1);
  near(plan.times[0], 10 + period);
  // Across a long simulated ride at the cutout, the count matches the period.
  let next = -Infinity, count = 0;
  for (let t = 0; t < 10; t += 1 / 60) {
    const p = planBeeps(next, 1, t, 0.05);
    next = p.next;
    count += p.times.length;
  }
  assert.ok(Math.abs(count - 10 / 0.14) <= 2, `${count} beeps in 10 s at 0.14 s`);
});

test('motor pitch: wheel revolutions x 15 pole pairs, floored, capped, spinning up in the air', () => {
  near(WHEEL_RADIUS, 0.25);
  near(wheelHz(Math.PI * 0.5), 1); // one circumference per second
  near(motorFundamentalHz(10), 10 / (2 * Math.PI * 0.25) * 15, 1e-9);
  near(motorFundamentalHz(-10), motorFundamentalHz(10));
  assert.equal(motorFundamentalHz(0), MOTOR.idleHz);
  assert.equal(motorFundamentalHz(1000), MOTOR.maxHz);
  near(motorFundamentalHz(10, true), motorFundamentalHz(10) * MOTOR.airSpin, 1e-9);
  assert.equal(motorFundamentalHz(NaN), MOTOR.idleHz);
});

test('motor level and brightness rise with load and speed; crashed and absent are silent', () => {
  const idle = motorTargets({ speed: 0, drive: 0 });
  const cruise = motorTargets({ speed: 12, drive: 0.3 });
  const pushing = motorTargets({ speed: 12, drive: 1.1 });
  assert.ok(idle.level > 0 && idle.level < 0.03, 'a gentle hum at rest');
  assert.ok(cruise.level > idle.level && pushing.level > cruise.level);
  assert.ok(pushing.cutoff > cruise.cutoff && cruise.cutoff > idle.cutoff);
  assert.ok(pushing.coil > cruise.coil && idle.coil === 0);
  assert.ok(pushing.level < 0.2, 'kept low in the mix');
  const air = motorTargets({ speed: 12, drive: 1.1, grounded: false });
  assert.ok(air.hz > pushing.hz && air.level < pushing.level, 'free spin: higher and lighter');
  assert.equal(motorTargets({ speed: 12, drive: 1, crashed: true }).level, 0);
  assert.equal(motorTargets({ speed: 12, drive: 1, present: false }).level, 0);
});

test('motor drive: power load first, lean as throttle, braking at half, acceleration as fallback', () => {
  assert.equal(motorDrive({ powerLoad: 0.7, lean: 0.2 }), 0.7);
  near(motorDrive({ powerLoad: 0, lean: 1 }), 0.9);
  near(motorDrive({ powerLoad: 0, lean: -1 }), 0.45);
  assert.equal(motorDrive({ powerLoad: 5 }), 1.2);
  assert.ok(motorDrive({ accel: 8 }) > 0.3);
  assert.equal(motorDrive({}), 0);
});

test('wind: silent when stopped, noticeable from about 6 m/s, strong from about 15 m/s', () => {
  assert.equal(windTargets(0).gain, 0);
  assert.equal(windTargets(2.5).gain, 0);
  // Relative to the table's level, so a balance pass does not break the shape test
  assert.ok(windTargets(6).gain > 0.02 * WIND.level && windTargets(6).gain < 0.25 * WIND.level);
  assert.ok(windTargets(15).gain > 0.7 * WIND.level);
  let previous = -1;
  for (let v = 0; v <= 30; v += 0.5) {
    const { gain, hz } = windTargets(v);
    assert.ok(gain >= previous && Number.isFinite(hz));
    previous = gain;
  }
  assert.ok(windTargets(10, false).gain > windTargets(10).gain, 'louder in the air');
});

test('tyre: rolls on the ground only; the toko tick follows wheel speed on pavement and not on grass', () => {
  assert.equal(tyreTargets(0).noise, 0);
  assert.ok(tyreTargets(8).noise > 0 && tyreTargets(8).toko > 0);
  near(tyreTargets(9).tokoRate, 1);
  assert.equal(tyreTargets(8, 'grass').toko, 0);
  assert.equal(tyreTargets(8, 'pavement', false).noise, 0);
  assert.equal(tyreTargets(8, 'pavement', true, true).toko, 0);
  assert.ok(tyreTargets(8, 'no-such-surface').noise > 0, 'unknown surfaces fall back to pavement');
});

test('cue scaling: landing normalised by EUC.landingImpactReference (5 m/s), kerb hits by 6 m/s', () => {
  near(landingScale(0), 0.28);
  near(landingScale(5), 1);
  near(landingScale(50), 1);
  near(impactScale(3), 0.5);
  assert.equal(impactScale(NaN), 0);
});

// ---- the voice graph, on a fake AudioContext --------------------------------------------------------------------

function fakeContext() {
  const played = [];
  const param = (value = 0) => ({
    value, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
    cancelScheduledValues() {},
  });
  const node = (extra = {}) => ({ connect(target) { return target; }, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 1, sampleRate: 48000, state: 'running', played,
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0), detune: param(0) }),
    createOscillator: () => node({ type: 'sine', frequency: param(440), detune: param(0), start() {}, stop() {} }),
    createConstantSource: () => node({ offset: param(1), start() {}, stop() {} }),
    createBufferSource: () => {
      const source = node({ buffer: null, loop: false, playbackRate: param(1), stop() {} });
      source.start = (when) => played.push({ buffer: source.buffer, when, loop: source.loop });
      return source;
    },
    createBuffer: (channels, length, rate) => {
      const data = new Float32Array(length);
      return { duration: length / rate, length, sampleRate: rate, getChannelData: () => data };
    },
    decodeAudioData: () => Promise.reject(new Error('fake context cannot decode')),
  };
  return ctx;
}

function withQuietFetch(fn) {
  const fetch = globalThis.fetch, warn = console.warn;
  globalThis.fetch = () => Promise.reject(new Error('offline'));
  console.warn = () => {};
  return Promise.resolve().then(fn).finally(() => {
    globalThis.fetch = fetch;
    console.warn = warn;
  });
}

function rider(overrides = {}) {
  const controller = { isGrounded: true, crashed: false, overspeed: 0, powerLoad: 0.3, leanPitch: 0.1, currentSurface: 'pavement' };
  return { type: 'euc', speed: 8, riderId: 'cool-rider', controller: Object.assign(controller, overrides) };
}

test('EucAudio: failed fetches fall back without throwing; crash picks the rider\'s sample; beeps follow overspeed', () =>
  withQuietFetch(async () => {
    const ctx = fakeContext();
    const audio = new EucAudio(ctx, ctx.createGain(), {});
    await new Promise((resolve) => setTimeout(resolve, 10)); // let the rejected loads settle
    for (const key of Object.keys(EUC_SAMPLE_FILES)) assert.equal(audio.buffers[key], null, `${key} fell back`);
    assert.ok(audio.windSource, 'wind falls back to noise');

    // With real buffers in place, the crash voice is chosen by event.rider.
    const tagged = (name) => ({ name, duration: 3.4 });
    audio.buffers.crashWipeout = tagged('wipeout');
    audio.buffers.crashTrollina = tagged('trollina');
    audio.buffers.overspeedBeep = tagged('beep');
    const entity = rider();
    audio.update(entity, [{ type: 'crash', speed: 9, rider: 'trollina' }]);
    assert.equal(ctx.played.at(-1).buffer.name, 'trollina');
    audio.update(entity, [{ type: 'crash', speed: 9, rider: 'cop' }]);
    assert.equal(ctx.played.at(-1).buffer.name, 'wipeout');

    // Over-speed: no beep at 0, a beep as soon as it rises, none while crashed.
    const before = ctx.played.length;
    audio.update(entity, []);
    assert.equal(ctx.played.length, before);
    entity.controller.overspeed = 0.4;
    ctx.currentTime = 2;
    audio.update(entity, []);
    assert.equal(ctx.played.at(-1).buffer.name, 'beep');
    entity.controller.crashed = true;
    ctx.currentTime = 4;
    const crashed = ctx.played.length;
    audio.update(entity, []);
    assert.equal(ctx.played.length, crashed);

    // Every cue type, odd values, and a non-EUC entity: no throws.
    entity.controller.crashed = false;
    audio.update(entity, [{ type: 'hop', charge: 1 }, { type: 'land', impact: 7, surface: 'grass' }, { type: 'impact', speed: 5 },
      { type: 'impact', speed: 5 }, { type: 'recover' }, { type: 'mystery' }, null]);
    audio.update({ type: 'car', speed: 30 }, []);
    audio.update(null, []);
    assert.ok(!audio.warned.has('update'), 'update() never hit its error guard');
    audio.reset();
    audio.dispose();
    audio.update(entity, [{ type: 'hop', charge: 1 }]);
  }));
