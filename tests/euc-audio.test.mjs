// Headless: the rider's audio logic (js/euc-audio.js) without a browser. Pure mappings are checked directly. The voice
// graph is built on a small fake AudioContext, which records what would play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EUC_SAMPLE_FILES, SHARED_SAMPLE_KEYS, RiderAudioBanks, CUES, EucAudio, WHEEL_RADIUS, MOTOR, crashSampleKey, crashScale, overspeedBeepPeriod, planBeeps, wheelHz,
  motorFundamentalHz, motorDrive, motorTargets, windTargets, tyreTargets, landingScale, impactScale, WIND,
} from '../js/euc-audio.js';
import { createWindVoice } from '../js/audio-events.js';
import { COP_SAMPLE_FILES, NemesisAudio } from '../js/nemesis-audio.js';
import { AUDIO } from '../js/euc/data/tuning.js';
import { CHARACTERS } from '../js/euc/data/riders.js';
import { deferred, recordLoads, withSampleRequests } from './helpers/audio-loading.cjs';
import { loadModule } from './helpers/module.cjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_DIR = join(ROOT, 'audio/euc');
const manifest = JSON.parse(readFileSync(join(ROOT, 'js/euc/MANIFEST.json'), 'utf8'));
const inventory = manifest.inventory ?? manifest;
const SHIPPED_AUDIO = inventory.audio.filter(record => record.shipped);
const ALLOWED = SHIPPED_AUDIO.map(record => record.source.split('/').at(-1)).sort();
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('only the reviewed sample inventory ships, byte-identical to the pinned source manifest', () => {
  const files = readdirSync(SAMPLE_DIR).sort();
  assert.deepEqual(files, [...ALLOWED, 'PROVENANCE.md'].sort());
  assert.equal(inventory.audio.length, 18, 'source review includes the unshipped offroad loop');
  assert.equal(ALLOWED.length, 17);
  assert.deepEqual([...Object.values(EUC_SAMPLE_FILES), ...Object.values(COP_SAMPLE_FILES)].sort(), ALLOWED);
  assert.equal(manifest.commit, '5f45fff19b258e140833841ba2473069af751a12');
  const provenance = readFileSync(join(SAMPLE_DIR, 'PROVENANCE.md'), 'utf8');
  for (const record of SHIPPED_AUDIO) {
    const file = record.source.split('/').at(-1);
    const hash = createHash('sha256').update(readFileSync(join(SAMPLE_DIR, file))).digest('hex');
    assert.equal(hash, record.sourceSha256, `${file} preserves reviewed quality and provenance bytes`);
    assert.ok(provenance.includes(`\`${file}\``) && provenance.includes(hash), `${file} retains its provenance row`);
  }
});

test('audio modules name only reviewed crash samples and retain exported downstream guidance', () => {
  const sources = ['euc-audio.js', 'nemesis-audio.js', ...readdirSync(join(ROOT, 'js')).filter((f) => /^audio-.*\.js$/.test(f))];
  for (const file of sources) {
    const text = readFileSync(join(ROOT, 'js', file), 'utf8');
    for (const [name] of text.matchAll(/crash_[a-z0-9_]+/g)) {
      assert.ok(ALLOWED.includes(`${name}.wav`), `${file} mentions unreviewed ${name}`);
    }
  }
  const source = readFileSync(join(ROOT, 'js/euc-audio.js'), 'utf8');
  assert.match(source, /NOTICE-EUC-THRILLS\.md and FORK_GUIDE\.md/);
});

test('all eleven exact crash mappings agree with the reviewed roster; invalid IDs never fall back', () => {
  assert.equal(CHARACTERS.length, 11);
  for (const rider of inventory.roster ?? manifest.roster) assert.equal(EUC_SAMPLE_FILES[crashSampleKey(rider.id)], rider.crash);
  for (const id of ['cop', undefined, 'someone-else', '__proto__']) assert.throws(() => crashSampleKey(id), /Unknown rider audio/);
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

test('wind: the howl recording plays at its own pitch, through EUC Thrills\' band (no speed-bent pitch: it whined)', () => {
  assert.equal(windTargets(20).rate, undefined);
  assert.equal(WIND.q, AUDIO.windQ);
  assert.equal(WIND.lowHz, AUDIO.windCutoffAtRest);
  assert.equal(windTargets(0).hz, AUDIO.windCutoffAtRest);
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
  const played = [], sources = [];
  const param = (value = 0) => ({
    value, setTargetAtTime(value) { this.value = value; }, setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; },
    cancelScheduledValues() {},
  });
  const node = (extra = {}) => ({ connect(target) { return target; }, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 1, sampleRate: 48000, state: 'running', played, sources,
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0), detune: param(0) }),
    createStereoPanner: () => node({ pan: param(0) }),
    createOscillator: () => node({ type: 'sine', frequency: param(440), detune: param(0), start() {}, stop() {} }),
    createConstantSource: () => node({ offset: param(1), start() {}, stop() {} }),
    createBufferSource: () => {
      const source = node({ buffer: null, loop: false, playbackRate: param(1), stops: 0, stop() { this.stops++; } });
      source.start = (when) => played.push({ buffer: source.buffer, when, loop: source.loop, rate: source.playbackRate.value });
      sources.push(source);
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

const flush = () => new Promise(resolve => setImmediate(resolve));
const bytesFor = file => Object.assign(new ArrayBuffer(8), { file });
async function withFiles(run) {
  const original = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url, { signal } = {}) => {
    const file = String(url).split('/').at(-1);
    fetched.push({ file, signal });
    if (signal?.aborted) throw signal.reason;
    return { ok: true, arrayBuffer: async () => bytesFor(file) };
  };
  const context = fakeContext();
  context.decodeAudioData = async bytes => {
    const duration = bytes.file.startsWith('stumble') ? 0.4 : 3.4;
    return { file: bytes.file, duration, length: Math.round(duration * 44100), sampleRate: 44100,
      numberOfChannels: bytes.file === 'crash_gnarwheel.wav' ? 2 : 1 };
  };
  try { return await run({ fetched, context }); } finally { globalThis.fetch = original; }
}

test('selected prefetch uses no context and preparation does not play; commit/dispose is transactional', () => withFiles(async ({ fetched, context }) => {
  let commits = 0;
  const banks = new RiderAudioBanks({ onCommit: () => commits++ });
  await banks.prefetchRider('gnarwheel');
  assert.deepEqual(fetched.map(r => r.file), ['crash_gnarwheel.wav']);
  assert.equal(banks.active, null);
  assert.equal(banks.candidate.ready, false);
  const handle = await banks.prepareRider('gnarwheel', context);
  assert.equal(fetched.length, 1, 'prefetched bytes are consumed without a second fetch');
  assert.deepEqual(context.played, []);
  assert.deepEqual(banks.candidate.bytes, {});
  handle.commit(); handle.dispose();
  const active = banks.active;
  assert.equal(active.id, 'gnarwheel');
  const next = await banks.prepareRider('drunkard', context);
  assert.equal(banks.active, active);
  assert.equal(Object.keys(banks.candidate.buffers).length, 2);
  next.dispose();
  assert.equal(banks.candidate, null);
  assert.equal(banks.active, active);
  assert.throws(() => next.commit(), { name: 'AbortError' });
  const replacement = await banks.prepareRider('maribel-vargas', context);
  replacement.commit();
  assert.deepEqual(active.buffers, {}, 'retired handle/record cannot pin the former decoded bank');
  assert.equal(banks.active.id, 'maribel-vargas');
  assert.equal(commits, 2);
  assert.throws(() => handle.commit(), { name: 'AbortError' });
  banks.dispose(); banks.dispose();
  assert.equal(banks.active, null);
}));

test('all eleven actual crash/stumble samples play at native rate, bounded through repeated roster cycles', () => withFiles(async ({ fetched, context }) => {
  class LocalAudio extends EucAudio { load() { return Promise.resolve(null); } }
  const audio = new LocalAudio(context, context.createGain(), { noise: { duration: 4 } });
  let retired = null;
  for (let cycle = 0; cycle < 3; cycle++) for (const spec of inventory.roster ?? manifest.roster) {
    const candidate = await audio.riderBanks.prepareRider(spec.id, context);
    candidate.commit();
    if (retired) assert.deepEqual(retired.buffers, {});
    retired = audio.riderBanks.active;
    assert.equal(audio.voices.size, 0, 'commit stops prior rider voices');
    const entity = rider(); entity.riderId = spec.id;
    audio.update(entity, [{ type: 'crash', rider: spec.id, speed: 18 }]);
    assert.equal(context.played.at(-1).buffer.file, spec.crash);
    assert.equal(context.played.at(-1).rate, 1);
    const voice = audio.crashVoice;
    near(voice.nodes[1].gain.value, CUES.crash.level * crashScale(18));
    const before = context.played.length;
    audio.update(entity, [{ type: 'stumble', rider: spec.id }]);
    if (spec.id === 'drunkard') {
      assert.equal(context.played.at(-1).buffer.file, 'stumble_drunkard.wav');
      assert.equal(context.played.at(-1).rate, 1);
      near([...audio.voices].at(-1).nodes[1].gain.value, CUES.stumble.level);
      near(CUES.stumble.level / CUES.crash.level, AUDIO.stumbleLevel / (AUDIO.crashLevel * AUDIO.crashSampleTrim));
    } else assert.equal(context.played.length, before, 'sober riders never use the stumble recording');
    assert.equal(audio.riderBanks.candidate, null);
    assert.equal(Object.keys(retired.buffers).length, spec.id === 'drunkard' ? 2 : 1);
    assert.equal(context.played.length > 0, true);
  }
  assert.equal(fetched.length, 36, 'eleven selected crash fetches + one stumble, per cycle; no all-roster eager load');
  for (let n = 0; n < 100; n++) audio.cue({ type: 'stumble', rider: 'gnarwheel' }, context.currentTime);
  const active = audio.riderBanks.active;
  for (let n = 0; n < 100; n++) audio.sample(active.buffers.crashGnarwheel, context.currentTime, 0.2);
  assert.equal(audio.voices.size, CUES.maxVoices);
  const sources = [...audio.voices].flatMap(voice => voice.sources);
  audio.reset();
  assert.equal(audio.voices.size, 0);
  assert.ok(sources.every(source => source.stops > 0 && source.buffer === null));
  audio.dispose();
}));

for (const failure of ['HTTP', 'body', 'decode']) test(`selected ${failure} failure rejects explicitly and preserves active bank for retry/cancel`, () => withFiles(async ({ context }) => {
  const banks = new RiderAudioBanks();
  (await banks.prepareRider('cool-rider', context)).commit();
  const active = banks.active;
  if (failure === 'decode') context.decodeAudioData = () => Promise.reject(new Error('bad WAV'));
  else globalThis.fetch = async () => ({ ok: failure !== 'HTTP', status: 503,
    arrayBuffer: async () => { throw new Error('body failed'); } });
  await assert.rejects(banks.prepareRider('wyldist', context), failure === 'HTTP' ? /HTTP 503/ : failure === 'body' ? /body failed/ : /bad WAV/);
  assert.equal(banks.active, active);
  assert.equal(banks.candidate, null);
  banks.dispose();
}));

test('supersession aborts selected fetches, rejects promptly, and permits a fresh retry', () => withSampleRequests(async ({ requests }) => {
  const banks = new RiderAudioBanks(), context = fakeContext();
  context.decodeAudioData = async bytes => ({ file: bytes.file, duration: 3.4 });
  const first = banks.prepareRider('adonisb2', context);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = banks.prepareRider('red-rider', context);
  assert.equal(requests[0].signal.aborted, true);
  await rejected;
  requests[1].resolve({ ok: true, arrayBuffer: async () => bytesFor('crash_red_rider.wav') });
  const candidate = await second;
  candidate.commit();
  assert.equal(banks.active.id, 'red-rider');
  banks.dispose();
}));

for (const mode of ['promise success', 'promise failure', 'callback success', 'callback failure']) {
  test(`selected cancellation during ${mode} rejects stale decode and serializes the replacement`, () => withFiles(async ({ context }) => {
    const decodes = [];
    let concurrent = 0, peak = 0;
    context.decodeAudioData = (bytes, yes, no) => {
      const result = deferred();
      concurrent++; peak = Math.max(peak, concurrent);
      decodes.push({ result, file: bytes.file });
      result.promise.then(() => concurrent--, () => concurrent--);
      if (mode.startsWith('callback')) { result.promise.then(yes, no); return; }
      return result.promise;
    };
    const banks = new RiderAudioBanks(), signal = new AbortController();
    const first = banks.prepareRider('drunkard', context, { signal: signal.signal });
    const rejection = assert.rejects(first, { name: 'AbortError' });
    await flush();
    assert.equal(decodes.length, 1);
    const oldRecord = banks.candidate;
    signal.abort();
    await rejection;
    const second = banks.prepareRider('gnarwheel', context);
    await flush();
    assert.equal(decodes.length, 1, 'cannot overlap the unabortable in-flight decode');
    if (mode.endsWith('success')) decodes[0].result.resolve({ duration: 3.4 });
    else decodes[0].result.reject(new Error('late decoder failure'));
    await flush();
    assert.equal(decodes.length, 2);
    assert.equal(decodes[1].file, 'crash_gnarwheel.wav', 'stale stumble decode was skipped');
    decodes[1].result.resolve({ duration: 3.4, file: decodes[1].file });
    const candidate = await second;
    candidate.commit();
    assert.equal(peak, 1);
    assert.deepEqual(oldRecord.bytes, {});
    assert.deepEqual(oldRecord.buffers, {});
    banks.dispose();
  }));
}

test('disposal/cancellation of byte prefetch rejects, does not decode, and refuses post-dispose work', () => withSampleRequests(async ({ requests }) => {
  const banks = new RiderAudioBanks();
  const selected = banks.prefetchRider('maribel-vargas');
  const rejection = assert.rejects(selected, { name: 'AbortError' });
  banks.dispose();
  await rejection;
  assert.ok(requests[0].signal.aborted);
  await assert.rejects(banks.prefetchRider('trollina'), { name: 'AbortError' });
  assert.equal(requests.length, 1);
}));

test('already committed rider preparation reuses its bank, but a new candidate invalidates the handle', () => withFiles(async ({ fetched, context }) => {
  const banks = new RiderAudioBanks();
  (await banks.prepareRider('cool-rider', context)).commit();
  const repeated = await banks.prepareRider('cool-rider', context);
  assert.equal(fetched.length, 1);
  const other = await banks.prepareRider('trollina', context);
  assert.throws(() => repeated.commit(), { name: 'AbortError' });
  other.dispose();
  const signal = new AbortController();
  const another = await banks.prepareRider('cool-rider', context, { signal: signal.signal });
  signal.abort();
  assert.throws(() => another.commit(), { name: 'AbortError' });
  banks.dispose();
}));

function cityHarness(context, { muted = false, unsupported = false, constructorError = null } = {}) {
  const callbacks = new Map(), pageCallbacks = new Map();
  const document = { hidden: false, addEventListener: (key, fn) => callbacks.set(key, fn),
    removeEventListener: key => callbacks.delete(key) };
  let contexts = 0, entity = null;
  Object.assign(context, {
    listener: {}, destination: context.createGain(),
    createDynamicsCompressor: () => Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, { value: 0 }]).concat([
      ['connect', node => node], ['disconnect', () => {}],
    ])),
    createConvolver: () => ({ connect: node => node, disconnect() {} }),
    resume() { this.state = 'running'; return Promise.resolve(); },
    suspend() { this.state = 'suspended'; return Promise.resolve(); },
    close() { this.state = 'closed'; return Promise.resolve(); },
  });
  class LocalAudio extends EucAudio { load() { return Promise.resolve(null); } }
  const { CityAudioSystem } = loadModule(readFileSync(join(ROOT, 'js/audio-system.js'), 'utf8'), {
    imports: {
      './audio-synthesis.js': { createSynthResources: () => ({}), setControlRate() {} },
      './audio-events.js': { createEventResources: () => ({ noise: { duration: 4 } }),
        createWindVoice: () => ({ update() {}, useHowl() {}, dispose() {} }) },
      './audio-sources.js': { CityAudioSources: class {} },
      './audio-acoustics.js': { CityAcoustics: class {} },
      './euc-audio.js': { EucAudio: LocalAudio, RiderAudioBanks },
      './nemesis-audio.js': { NemesisAudio: class { reset() {} dispose() {} } },
    }, globals: { document, navigator: { hardwareConcurrency: 8 }, matchMedia: () => ({ matches: false }),
      localStorage: { getItem: () => muted ? 'off' : 'on', setItem() {} }, DOMException, AbortController,
      addEventListener: (key, fn) => pageCallbacks.set(key, fn), removeEventListener: key => pageCallbacks.delete(key),
      AudioContext: unsupported ? undefined : function () {
        contexts++;
        const error = typeof constructorError === 'function' ? constructorError() : constructorError;
        if (error) throw error;
        return context;
      },
    },
  });
  const city = new CityAudioSystem({ controllerManager: { getActiveEntity: () => entity } });
  return { city, document, callbacks, pageCallbacks, contexts: () => contexts, setEntity: value => { entity = value; } };
}

// Model audio-thread transitions separately from main-thread promise delivery. Calling resume/suspend does not
// synchronously change state, and an acknowledged resume can be delivered after a later suspension took effect.
function asyncContextState(context) {
  const operations = [];
  for (const [kind, target] of [['resume', 'running'], ['suspend', 'suspended']]) context[kind] = () => {
    const result = deferred();
    const operation = { kind, target, applied: false, settled: false,
      apply() { context.state = target; this.applied = true; },
      settle() {
        assert.equal(this.applied, true, 'native state transition precedes promise delivery');
        this.settled = true;
        result.resolve();
      },
      fail(error) {
        this.settled = true;
        result.reject(error);
      } };
    operations.push(operation);
    return result.promise;
  };
  const pending = kind => operations.filter(operation => !operation.settled && (!kind || operation.kind === kind));
  const finish = kind => { for (const operation of pending(kind)) { operation.apply(); operation.settle(); } };
  const drain = async () => {
    for (let turn = 0; turn < 12 && pending().length; turn++) { finish(); await flush(); }
    assert.equal(pending().length, 0, 'context operations settle without a resume/suspend feedback loop');
  };
  return { operations, pending, finish, drain };
}

test('Ride → Rider → Cancel → Rider → Confirm survives asynchronous gesture/pause overlap without a false unlock failure', () => withFiles(async ({ context, fetched }) => {
  context.state = 'suspended';
  const h = cityHarness(context), { city } = h, state = asyncContextState(context);
  city.setPaused(true); // title
  const rideUnlock = city.unlock();
  assert.equal(context.state, 'suspended', 'resume is genuinely asynchronous in this regression');
  state.finish('resume');
  assert.equal(await rideUnlock, true);
  (await city.prepareRider('cool-rider')).commit();
  city.setPaused(false); // Ride finishes
  await state.drain();
  assert.equal(context.state, 'running');
  city.master.gain.value = 0.65;
  const menuOperations = state.operations.length;

  h.callbacks.get('pointerdown')({ type: 'pointerdown' });
  city.setPaused(true); // Rider
  h.callbacks.get('keydown')({ type: 'keydown', repeat: false });
  city.cancelRiderPreparation();
  city.setPaused(false); // Cancel
  await state.drain();

  h.callbacks.get('pointerdown')({ type: 'pointerdown' });
  city.setPaused(true); // Rider again
  state.finish('suspend');
  await flush();
  h.callbacks.get('pointerdown')({ type: 'pointerdown' }); // document gesture listener precedes Confirm's click
  city.unlock(); // Confirm's explicit unlock
  const prepared = city.prepareRider('cool-rider').then(bank => ({ bank }), error => ({ error }));

  const resumes = state.pending('resume');
  for (const operation of resumes) operation.apply(); // both resume requests really succeeded on the audio thread
  for (const operation of resumes.slice(0, -1)) operation.settle();
  await flush(); // the old document-gesture callback re-suspended solely because the picker was paused
  state.finish('suspend');
  await flush();
  resumes.at(-1)?.settle(); // Confirm's successful resume is delivered after that suspension
  const outcome = await prepared;
  await state.drain();
  try {
    assert.equal(outcome.error, undefined, outcome.error?.message);
    assert.equal(outcome.bank.valid, true);
    assert.equal(outcome.bank.commit(), true);
    assert.equal(city.riderBanks.active.id, 'cool-rider');
    assert.equal(fetched.length, 1, 'confirming the active rider reuses its already decoded bank');
    assert.equal(city.paused, true);
    assert.equal(city.master.gain.value, 0, 'the paused city is silent regardless of native context state');
    assert.equal(state.operations.length, menuOperations, 'menus do not create native resume/suspend churn on an already unlocked context');
    city.ready = true;
    const played = context.played.length;
    city.update(1, 0, {});
    assert.equal(context.played.length, played, 'running native context does not admit voices while the menu is open');
    assert.equal(city.master.gain.value, 0);
  } finally {
    city.dispose();
  }
}));

test('cold paused confirmation still rejects a genuinely failed asynchronous resume and can retry in a fresh gesture', () => withFiles(async ({ context, fetched }) => {
  context.state = 'suspended';
  const h = cityHarness(context), { city } = h, state = asyncContextState(context);
  city.setPaused(true);
  h.callbacks.get('pointerdown')({ type: 'pointerdown' });
  const unlock = city.unlock();
  const selection = assert.rejects(city.prepareRider('cool-rider'), /Audio could not be unlocked/);
  assert.equal(state.pending('resume').length, 2, 'document and confirmation requests overlap asynchronously');
  for (const operation of state.pending('resume')) operation.fail(new Error('user activation rejected'));
  assert.equal(await unlock, false);
  await selection;
  assert.equal(city.riderBanks.active, null);
  assert.equal(fetched.length, 0, 'a real unlock failure does not silently commit a recording or identity');
  assert.equal(city.audioUnavailable, false);

  h.callbacks.get('keydown')({ type: 'keydown', repeat: false });
  city.unlock();
  const retry = city.prepareRider('cool-rider');
  state.finish('resume');
  const bank = await retry;
  assert.equal(bank.valid, true);
  assert.equal(bank.silent, false);
  bank.commit();
  assert.equal(context.state, 'running');
  assert.equal(city.paused, true);
  assert.equal(city.master.gain.value, 0);
  assert.equal(state.operations.filter(operation => operation.kind === 'suspend').length, 0);
  city.dispose();
}));

test('city API prefetches before context, unlocks synchronously in a paused gesture, and prepares before Ride', () => withFiles(async ({ context, fetched }) => {
  const h = cityHarness(context), { city } = h;
  city.setPaused(true);
  await assert.rejects(city.prepareRider('gnarwheel'), /Unlock audio/);
  await city.prefetchRider('gnarwheel');
  assert.equal(h.contexts(), 0);
  context.state = 'suspended';
  const unlocked = city.unlock();
  assert.equal(h.contexts(), 1, 'context creation happens in the gesture call, before any await');
  assert.equal(context.state, 'running', 'resume is invoked in that same gesture even from a paused picker');
  await unlocked;
  const handle = await city.prepareRider('gnarwheel');
  assert.equal(context.state, 'running', 'a menu does not immediately undo its successful gesture unlock');
  assert.equal(city.master.gain.value, 0, 'the menu stays silent through its zeroed master and playback gate');
  assert.equal(fetched.length, 1);
  handle.commit();
  assert.equal(city.riderBanks.active.id, 'gnarwheel');
  city.setPaused(false);
  await city.unlockPending;
  assert.equal(context.state, 'running');
  city.dispose();
  assert.equal(h.callbacks.size + h.pageCallbacks.size, 0);
}));

test('muted confirmation prepares its exact bank on a suspended context without enabling the city mix', () => withFiles(async ({ context }) => {
  const { city } = cityHarness(context, { muted: true });
  await city.unlock();
  const handle = await city.prepareRider('drunkard');
  handle.commit();
  assert.equal(context.state, 'suspended');
  assert.equal(city.enabled, false);
  assert.equal(Object.keys(city.riderBanks.active.buffers).length, 2);
  city.dispose();
}));

for (const boundary of ['menu', 'mute', 'hidden', 'pagehide', 'interrupted']) {
  test(`city ${boundary} stops old rider voices; silent events never replay after resuming`, () => withFiles(async ({ context }) => {
    const h = cityHarness(context), { city } = h;
    await city.unlock();
    (await city.prepareRider('drunkard')).commit();
    const entity = rider(); entity.riderId = 'drunkard';
    let events = [{ type: 'stumble', rider: 'drunkard' }];
    entity.drainEvents = () => { const batch = events; events = []; return batch; };
    h.setEntity(entity);
    city.updateRider(true);
    assert.equal(city.euc.voices.size, 1);
    const sources = [...city.euc.voices].flatMap(voice => voice.sources);
    if (boundary === 'menu') city.setPaused(true);
    if (boundary === 'mute') city.setEnabled(false);
    if (boundary === 'hidden') { h.document.hidden = true; h.callbacks.get('visibilitychange')(); }
    if (boundary === 'pagehide') h.pageCallbacks.get('pagehide')();
    if (boundary === 'interrupted') context.state = 'interrupted';
    events = [{ type: 'stumble', rider: 'drunkard' }];
    city.updateRider(false);
    assert.equal(city.euc.voices.size, 0);
    assert.ok(sources.every(source => source.stops > 0 && source.buffer === null));
    const played = context.played.length;
    if (boundary === 'menu') city.setPaused(false);
    if (boundary === 'mute') city.setEnabled(true);
    if (boundary === 'hidden') { h.document.hidden = false; h.callbacks.get('visibilitychange')(); }
    if (boundary === 'pagehide') h.pageCallbacks.get('pageshow')();
    if (boundary === 'interrupted') await city.unlock();
    await city.unlockPending;
    city.updateRider(true);
    assert.equal(context.played.length, played);
    events = [{ type: 'stumble', rider: 'drunkard' }];
    city.updateRider(true);
    assert.equal(context.played.length, played + 1);
    city.dispose();
  }));
}

for (const paused of [false, true]) test(`city explicit unlock failure ${paused ? 'in a menu' : 'while riding'} throws to retry UI; stale pending unlock cannot prepare after a later selection`, () => withFiles(async ({ context }) => {
  const { city } = cityHarness(context);
  city.setPaused(paused);
  await city.prefetchRider('trollina');
  context.state = 'suspended';
  context.resume = () => Promise.reject(new Error('autoplay denied'));
  await city.unlock();
  await assert.rejects(city.prepareRider('trollina'), /could not be unlocked/);
  assert.equal(city.riderBanks.candidate, null);
  assert.equal(city.riderBanks.stats.prefetchedBytes, 0, 'a failed confirmation retires its prefetched candidate');
  const old = deferred();
  context.resume = () => old.promise;
  city.unlock();
  const first = city.prepareRider('trollina');
  const stale = assert.rejects(first, { name: 'AbortError' });
  context.resume = () => { context.state = 'running'; return Promise.resolve(); };
  city.unlock();
  const selected = await city.prepareRider('gnarwheel');
  selected.commit();
  old.resolve();
  await stale;
  assert.equal(city.riderBanks.active.id, 'gnarwheel');
  city.dispose();
}));

test('city rejects a stale ready handle, including same-rider supersession and cancellation after prepare', () => withFiles(async ({ context }) => {
  const { city } = cityHarness(context);
  await city.unlock();
  const first = await city.prepareRider('drunkard');
  const second = await city.prepareRider('drunkard');
  assert.throws(() => first.commit(), { name: 'AbortError' });
  first.dispose();
  second.commit();
  assert.equal(city.riderBanks.active.id, 'drunkard');
  const signal = new AbortController();
  const next = await city.prepareRider('gnarwheel', { signal: signal.signal });
  signal.abort();
  assert.throws(() => next.commit(), { name: 'AbortError' });
  assert.equal(city.riderBanks.active.id, 'drunkard');
  assert.equal(city.riderBanks.candidate, null);
  city.dispose();
}));

test('a late selected body read is discarded after cancellation, without even entering the serial decoder', () => withFiles(async ({ context }) => {
  const body = deferred(), started = deferred();
  let decodes = 0;
  context.decodeAudioData = async () => { decodes++; return { duration: 3.4 }; };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: () => { started.resolve(); return body.promise; } });
  const banks = new RiderAudioBanks(), signal = new AbortController();
  const first = banks.prepareRider('wyldist', context, { signal: signal.signal });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await started.promise;
  const record = banks.candidate;
  signal.abort();
  await rejected;
  body.resolve(bytesFor('crash_wyldist.wav'));
  await flush();
  assert.equal(decodes, 0);
  assert.deepEqual(record.bytes, {});
  assert.equal(banks.candidate, null);
  banks.dispose();
}));

test('bank.valid is a side-effect-free commit preflight, false after commit/dispose/supersession/context closure', () => withFiles(async ({ context }) => {
  const banks = new RiderAudioBanks();
  const first = await banks.prepareRider('gnarwheel', context);
  assert.equal(first.valid, true);
  assert.equal(first.valid, true, 'reading validity does not consume the transaction');
  assert.equal(first.silent, false);
  assert.equal(first.commit(), true);
  assert.equal(first.valid, false);
  assert.throws(() => first.commit(), { name: 'AbortError' });
  first.dispose();
  const same = await banks.prepareRider('gnarwheel', context);
  assert.equal(same.valid, true);
  same.dispose();
  assert.equal(same.valid, false);
  assert.equal(banks.active.id, 'gnarwheel');
  const replacement = await banks.prepareRider('trollina', context);
  assert.equal(replacement.valid, true);
  context.state = 'closed';
  assert.equal(replacement.valid, false);
  assert.throws(() => replacement.commit(), { name: 'AbortError' });
  replacement.dispose();
  assert.equal(banks.active.id, 'gnarwheel');
  banks.dispose();
}));

test('unsupported Web Audio is an explicit silent transaction for all eleven riders, without fetch/decode/context', () => withFiles(async ({ context, fetched }) => {
  const h = cityHarness(context, { unsupported: true }), { city } = h;
  assert.equal(city.supported, false);
  assert.match(city.unavailableReason, /unavailable.*silently/);
  assert.equal(await city.unlock(), false);
  for (const spec of CHARACTERS) {
    await city.prefetchRider(spec.id);
    const handle = await city.prepareRider(spec.id);
    assert.equal(handle.valid, true);
    assert.equal(handle.silent, true);
    assert.equal(handle.commit(), true);
    assert.equal(handle.valid, false);
    handle.dispose();
    assert.equal(city.riderBanks.active.id, spec.id);
    assert.equal(city.riderBanks.stats.activeBanks, 1);
    assert.equal(city.riderBanks.stats.decodedBuffers, 0);
    assert.equal(city.riderBanks.stats.prefetchedBytes, 0);
  }
  const stale = await city.prepareRider('gnarwheel');
  const current = await city.prepareRider('drunkard');
  assert.equal(stale.valid, false);
  assert.throws(() => stale.commit(), { name: 'AbortError' });
  current.dispose();
  assert.equal(current.valid, false);
  assert.equal(city.riderBanks.active.id, 'gnarwheel');
  await assert.rejects(city.prepareRider('cop'), /Unknown rider audio/);
  assert.equal(fetched.length, 0);
  assert.equal(h.contexts(), 0);
  city.dispose();
}));

test('transient context-constructor failure remains an error and can retry; it never produces a silent bank', () => withFiles(async ({ context }) => {
  let fail = true;
  const h = cityHarness(context, { constructorError: () => fail ? new Error('temporary audio device failure') : null });
  const { city } = h;
  assert.equal(await city.unlock(), false);
  assert.equal(city.supported, true);
  assert.equal(city.unavailableReason, null);
  await assert.rejects(city.prepareRider('trollina'), /Unlock audio/);
  assert.equal(city.riderBanks.active, null);
  fail = false;
  assert.equal(await city.unlock(), true);
  const handle = await city.prepareRider('trollina');
  assert.equal(handle.silent, false);
  assert.equal(handle.valid, true);
  handle.commit();
  assert.equal(h.contexts(), 2);
  city.dispose();
}));

for (const boundary of ['abort', 'cancel', 'pagehide', 'dispose', 'supersede']) {
  test(`city ${boundary} promptly rejects an unresolved unlock, without stale fetches or unhandled resume rejection`, () => withFiles(async ({ context, fetched }) => {
    const { city, pageCallbacks } = cityHarness(context);
    const resume = deferred(), signal = new AbortController();
    context.state = 'suspended';
    city.unlock(); // construct, then install the controlled suspended-context resume
    await city.unlockPending;
    context.state = 'suspended';
    context.resume = () => resume.promise;
    city.unlock();
    const pending = city.prepareRider('drunkard', { signal: signal.signal });
    const rejection = assert.rejects(pending, { name: 'AbortError' });
    if (boundary === 'abort') signal.abort();
    if (boundary === 'cancel') city.cancelRiderPreparation();
    if (boundary === 'pagehide') pageCallbacks.get('pagehide')({ persisted: true });
    if (boundary === 'dispose') city.dispose();
    if (boundary === 'supersede') {
      city.setEnabled(false);
      await city.unlock(); // suspended decoding is allowed for a muted confirmation
      (await city.prepareRider('trollina')).commit();
    }
    await rejection; // must settle BEFORE the browser's pending resume completes
    assert.equal(fetched.length, boundary === 'supersede' ? 1 : 0);
    resume.reject(new Error('late resume rejection'));
    await flush();
    if (boundary !== 'supersede') assert.equal(city.riderBanks.candidate, null);
    city.dispose();
  }));
}

test('muted preparation never calls resume, including muted persisted pageshow; paused restore stays parked', () => withFiles(async ({ context }) => {
  const h = cityHarness(context, { muted: true }), { city } = h;
  let resumes = 0;
  context.resume = () => { resumes++; throw new Error('mute must not resume'); };
  await city.unlock();
  const bank = await city.prepareRider('drunkard');
  assert.equal(bank.valid, true);
  bank.commit();
  const active = city.riderBanks.active;
  h.pageCallbacks.get('pagehide')({ persisted: true });
  h.pageCallbacks.get('pageshow')({ persisted: true });
  assert.equal(city.riderBanks.active, active);
  assert.equal(context.state, 'suspended');
  assert.equal(resumes, 0);
  city.setPaused(true);
  city.setEnabled(true); // an explicit unmute may try unlocking; lifecycle restore below must not
  await city.unlockPending;
  resumes = 0;
  h.pageCallbacks.get('pagehide')({ persisted: true });
  h.pageCallbacks.get('pageshow')({ persisted: true });
  h.document.hidden = true; h.callbacks.get('visibilitychange')();
  h.document.hidden = false; h.callbacks.get('visibilitychange')();
  assert.equal(resumes, 0, 'lifecycle callbacks do not resume an enabled but paused menu');
  assert.equal(city.paused, true);
  assert.equal(city.riderBanks.active, active);
  city.dispose();
}));

test('menu/mute/BFCache boundaries drain queued events even when no silent animation callback occurs', () => withFiles(async ({ context }) => {
  const h = cityHarness(context), { city } = h;
  await city.unlock();
  (await city.prepareRider('drunkard')).commit();
  const entity = rider(); entity.riderId = 'drunkard';
  let queue = [];
  entity.drainEvents = () => { const events = queue; queue = []; return events; };
  h.setEntity(entity);
  for (const boundary of ['menu', 'mute', 'pagehide']) {
    queue = [{ type: 'stumble', rider: 'drunkard' }];
    if (boundary === 'menu') { city.setPaused(true); city.setPaused(false); }
    if (boundary === 'mute') {
      city.setEnabled(false);
      queue = [{ type: 'stumble', rider: 'drunkard' }]; // last muted fixed step before the unmute gesture
      city.setEnabled(true);
    }
    if (boundary === 'pagehide') {
      h.pageCallbacks.get('pagehide')({ persisted: true });
      h.pageCallbacks.get('pageshow')({ persisted: true });
    }
    await city.unlockPending;
    const played = context.played.length;
    city.updateRider(true);
    assert.equal(context.played.length, played, `${boundary} must not replay its stale queue`);
    queue = [{ type: 'stumble', rider: 'drunkard' }];
    city.updateRider(true);
    assert.equal(context.played.length, played + 1, 'next fresh event still plays');
  }
  city.dispose();
}));

test('on-demand memory stats count stereo PCM and plateau across full roster cycles with bounded graph ownership', () => withFiles(async ({ context }) => {
  class LocalAudio extends EucAudio { load() { return Promise.resolve(null); } }
  const audio = new LocalAudio(context, context.createGain(), { noise: { duration: 4, length: 192000, numberOfChannels: 1 } });
  const fixed = audio.stats.fixedNodes;
  for (let round = 0; round < 4; round++) for (const spec of CHARACTERS) {
    const handle = await audio.riderBanks.prepareRider(spec.id, context);
    const before = audio.riderBanks.stats;
    assert.equal(before.candidateBanks, 1);
    assert.ok(before.decodedBuffers <= 3, 'one prior bank plus candidate; Drunkard owns the extra stumble');
    assert.ok(before.decodedBytes <= 1_869_840, 'at most stereo Gnarwheel + Drunkard mono crash/stumble');
    handle.commit();
    const stats = audio.stats;
    const expected = spec.id === 'gnarwheel' ? 1_199_520 : spec.id === 'drunkard' ? 670_320 : 599_760;
    assert.equal(stats.riderBanks.decodedBytes, expected);
    assert.equal(stats.riderBanks.prefetchedBytes, 0);
    assert.equal(stats.riderBanks.candidateBanks, 0);
    assert.equal(stats.riderBanks.queuedDecodes, 0);
    assert.equal(stats.riderBanks.decoding, 0);
    assert.equal(stats.fixedNodes, fixed, 'no permanent per-character graph');
    assert.equal(stats.noiseBytes, 768000);
    audio.crash(context.currentTime, spec.id, 18);
    assert.equal(audio.stats.voices, 1);
    assert.equal(audio.stats.voiceNodes, 2);
  }
  audio.reset();
  assert.equal(audio.stats.voiceNodes, 0);
  const loops = [...audio.loops];
  audio.dispose();
  assert.equal(audio.stats.riderBanks.decodedBytes, 0);
  assert.equal(audio.stats.noiseBytes, 0);
  assert.ok(loops.every(source => !('buffer' in source) || source.buffer === null));
}));

test('rapid cancelled selections retain only the latest queued decode behind one unabortable native decode', () => withFiles(async ({ context }) => {
  const banks = new RiderAudioBanks();
  (await banks.prepareRider('cool-rider', context)).commit();
  const held = deferred();
  let decodes = 0;
  context.decodeAudioData = () => { decodes++; return held.promise; };
  let pending = banks.prepareRider('trollina', context);
  let rejected = assert.rejects(pending, { name: 'AbortError' });
  await flush();
  for (let i = 0; i < 40; i++) {
    pending = banks.prepareRider(i % 2 ? 'wyldist' : 'gnarwheel', context);
    const nextRejected = assert.rejects(pending, { name: 'AbortError' });
    await rejected;
    rejected = nextRejected;
    await flush();
    const stats = banks.stats;
    assert.equal(stats.decoding, 1);
    assert.equal(stats.queuedDecodes, 1);
    assert.equal(stats.candidateBanks, 1);
    assert.equal(stats.prefetchedBytes, 8);
    assert.equal(stats.decodedBuffers, 1, 'only the committed bank is retained while candidates await decoding');
  }
  banks.cancel();
  await rejected;
  assert.equal(banks.stats.queuedDecodes, 0);
  held.resolve({ duration: 3.4 });
  await flush();
  assert.equal(decodes, 1, 'cancelled queued decodes were removed, not executed');
  assert.equal(banks.stats.decoding, 0);
  banks.dispose();
}));

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

test('EucAudio: shared failures keep fallbacks; selected crash identity is explicit; beeps follow overspeed', () =>
  withQuietFetch(async () => {
    const ctx = fakeContext();
    const audio = new EucAudio(ctx, ctx.createGain(), {});
    await new Promise((resolve) => setTimeout(resolve, 10)); // let the rejected loads settle
    for (const key of SHARED_SAMPLE_KEYS) assert.equal(audio.buffers[key], null, `${key} fell back`);
    assert.ok(audio.windSource, 'wind falls back to noise');

    // With a committed bank in place only its matching rider may play a recording.
    const tagged = (name) => ({ name, duration: 3.4 });
    audio.riderBanks.active = { id: 'trollina', buffers: { crashTrollina: tagged('trollina') }, controller: new AbortController(), listeners: [] };
    audio.buffers.overspeedBeep = tagged('beep');
    const entity = rider();
    audio.update(entity, [{ type: 'crash', speed: 9, rider: 'trollina' }]);
    assert.equal(ctx.played.at(-1).buffer.name, 'trollina');
    const plays = ctx.played.length;
    audio.update(entity, [{ type: 'crash', speed: 9, rider: 'cop' }]);
    audio.update(entity, [{ type: 'crash', speed: 9, rider: 'cool-rider' }]);
    assert.equal(ctx.played.length, plays, 'no wrong-rider or synthesized crash fallback');

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

test('city wind: the synthesized noise gives way to the EUC Thrills howl once it is decoded (one wind sound)', () => {
  const ctx = fakeContext();
  const buffer = (seconds) => ctx.createBuffer(1, Math.round(seconds * 100), 100);
  const resources = { noise: buffer(2), gusts: buffer(3) };
  const wind = createWindVoice(ctx, resources, ctx.createGain());
  const howl = buffer(4);
  assert.equal(ctx.played.filter((p) => p.buffer === resources.noise).length, 2, 'two noise channels before');
  wind.useHowl(howl);
  wind.useHowl(howl); // only once
  const howls = ctx.played.filter((p) => p.buffer === howl);
  assert.equal(howls.length, 2, 'one howl per channel');
  assert.ok(howls.every((p) => p.loop));
  wind.update({ altitude: 2, traffic: 0.4, enclosure: 0.5 });
  wind.dispose(true);
});

for (const [name, Audio, files] of [['EUC', EucAudio, Object.fromEntries(SHARED_SAMPLE_KEYS.map(key => [key, EUC_SAMPLE_FILES[key]]))], ['cop', NemesisAudio, COP_SAMPLE_FILES]]) {
  const keys = Object.keys(files), LoadingAudio = recordLoads(Audio);
  const make = (ctx, onWindHowl = () => {}) => new LoadingAudio(ctx, ctx.createGain(), { noise: { duration: 4 }, onWindHowl });
  const untouched = audio => {
    assert.deepEqual(audio.buffers, {}, 'cancelled loads neither cache samples nor install fallback markers');
    if (name === 'EUC') assert.equal(audio.windSource, null);
    else assert.deepEqual([audio.far, audio.close], [null, null]);
  };

  test(`${name} sample disposal aborts every pending fetch once, remains quiet, and refuses new loads`, () =>
    withSampleRequests(async ({ requests, warnings }) => {
      const ctx = fakeContext(), audio = make(ctx);
      assert.equal(requests.length, keys.length);
      assert.ok(requests.every(r => r.signal instanceof AbortSignal && !r.signal.aborted));
      assert.equal(new Set(requests.map(r => r.signal)).size, 1, 'one controller owns the object load cycle');
      audio.dispose(); audio.dispose();
      const played = ctx.played.length;
      assert.ok(requests.every(r => r.signal.aborted && r.aborts === 1));
      assert.deepEqual(await Promise.all(audio.pendingLoads), keys.map(() => null));
      assert.equal(await audio.load(keys[0]), null);
      assert.equal(requests.length, keys.length, 'post-dispose load cannot start another fetch');
      assert.equal(ctx.played.length, played);
      untouched(audio);
      assert.deepEqual(warnings, []);
    }));

  test(`${name} mute/reset preserves pending loads and decoded sample cache`, () =>
    withSampleRequests(async ({ requests, warnings }) => {
      const ctx = fakeContext(), buffer = { duration: 4 };
      ctx.decodeAudioData = () => Promise.resolve(buffer);
      const audio = make(ctx);
      audio.reset(); audio.reset();
      assert.ok(requests.every(r => !r.signal.aborted));
      for (const r of requests) r.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      await Promise.all(audio.pendingLoads);
      for (const key of keys) assert.equal(audio.buffers[key], buffer);
      audio.reset();
      for (const key of keys) assert.equal(audio.buffers[key], buffer, 'reset retains the decoded asset');
      assert.ok(requests.every(r => !r.signal.aborted));
      assert.equal(requests.length, keys.length);
      assert.deepEqual(warnings, []);
      audio.dispose();
    }));

  test(`${name} disposal before a queued fetch response skips body reads and decoding`, () =>
    withSampleRequests(async ({ requests, warnings }) => {
      const ctx = fakeContext();
      let bodies = 0, decodes = 0;
      ctx.decodeAudioData = () => { decodes++; return Promise.resolve({ duration: 4 }); };
      const audio = make(ctx);
      for (const r of requests) r.resolve({ ok: true, arrayBuffer() { bodies++; return Promise.resolve(new ArrayBuffer(8)); } });
      audio.dispose();
      await Promise.all(audio.pendingLoads);
      assert.equal(bodies, 0);
      assert.equal(decodes, 0);
      untouched(audio);
      assert.deepEqual(warnings, []);
    }));

  test(`${name} disposal during body download skips decoding even if the body resolves late`, { timeout: 2000 }, () =>
    withSampleRequests(async ({ requests, warnings }) => {
      const ctx = fakeContext(), downloading = deferred(), bodies = [];
      let decodes = 0;
      ctx.decodeAudioData = () => { decodes++; return Promise.resolve({ duration: 4 }); };
      const audio = make(ctx);
      for (const r of requests) r.resolve({ ok: true, arrayBuffer() {
        const body = deferred(); bodies.push(body);
        if (bodies.length === keys.length) downloading.resolve();
        return body.promise;
      } });
      await downloading.promise;
      audio.dispose();
      for (const body of bodies) body.resolve(new ArrayBuffer(8));
      await Promise.all(audio.pendingLoads);
      assert.equal(decodes, 0);
      untouched(audio);
      assert.deepEqual(warnings, []);
    }));

  for (const mode of ['promise success', 'promise failure', 'callback success', 'callback failure']) {
    test(`${name} disposal ignores late decode ${mode} without starting a loop or fallback`, { timeout: 2000 }, () =>
      withSampleRequests(async ({ requests, warnings }) => {
        const ctx = fakeContext(), decoding = deferred(), decodes = [];
        let windCallbacks = 0;
        ctx.decodeAudioData = (_bytes, yes, no) => {
          const result = deferred(); decodes.push(result);
          if (decodes.length === (name === 'EUC' ? 1 : keys.length)) decoding.resolve();
          if (mode.startsWith('callback')) { result.promise.then(yes, no); return undefined; }
          return result.promise;
        };
        const audio = make(ctx, () => windCallbacks++);
        for (const r of requests) r.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
        await decoding.promise;
        audio.dispose(); audio.dispose();
        const played = ctx.played.length;
        for (const result of decodes) {
          if (mode.endsWith('success')) result.resolve({ duration: 4 });
          else result.reject(new Error('decode finished after disposal'));
        }
        await Promise.all(audio.pendingLoads);
        assert.equal(ctx.played.length, played);
        assert.equal(windCallbacks, 0);
        untouched(audio);
        assert.deepEqual(warnings, []);
      }));
  }

  test(`${name} expected AbortError is quiet and does not activate a fallback`, () =>
    withSampleRequests(async ({ requests, warnings }) => {
      const audio = make(fakeContext());
      for (const r of requests) r.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
      await Promise.all(audio.pendingLoads);
      untouched(audio);
      assert.deepEqual(warnings, []);
      audio.dispose();
    }));

  for (const stage of ['fetch', 'HTTP', 'decode']) {
    test(`${name} genuine ${stage} failure retains its warning and normal fallback policy`, () =>
      withSampleRequests(async ({ requests, warnings }) => {
        const ctx = fakeContext(), audio = make(ctx);
        for (const r of requests) {
          if (stage === 'fetch') r.reject(new Error('offline'));
          else r.resolve({ ok: stage !== 'HTTP', status: 503, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
        }
        await Promise.all(audio.pendingLoads);
        assert.equal(warnings.length, keys.length);
        if (name === 'EUC') {
          for (const key of keys) assert.equal(audio.buffers[key], null);
          assert.equal(audio.windSource.buffer, audio.noise, 'genuine failure still installs synthesized wind');
        } else {
          assert.deepEqual([audio.far, audio.close], [null, null], 'unavailable cop samples stay silent');
        }
        audio.dispose();
      }));
  }
}
