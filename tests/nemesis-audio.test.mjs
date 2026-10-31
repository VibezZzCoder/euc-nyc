import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NemesisAudio } from '../js/nemesis-audio.js';
import { EucAudio, EUC_SAMPLE_FILES } from '../js/euc-audio.js';
import { loadModule } from './helpers/module.cjs';
import { recordLoads, withSampleRequests } from './helpers/audio-loading.cjs';

// No audio device, fetches or browser: record source lifetimes and graph connections, including scheduled stops.
function fakeContext() {
  const nodes = [], sources = [];
  const param = (value = 0) => ({ value, changes: [],
    cancelScheduledValues(at) { this.changes.push(['cancel', at]); },
    setValueAtTime(value, at) { this.value = value; this.changes.push(['set', value, at]); },
    setTargetAtTime(value, at, tc) { this.value = value; this.changes.push(['target', value, at, tc]); },
    linearRampToValueAtTime(value, at) { this.changes.push(['linear', value, at]); },
    exponentialRampToValueAtTime(value, at) { this.changes.push(['exp', value, at]); }
  });
  const node = (extra = {}) => {
    const n = { connections: [], disconnects: 0,
      connect(other) { this.connections.push(other); return other; },
      disconnect() { this.connections.length = 0; this.disconnects++; }, ...extra };
    nodes.push(n);
    return n;
  };
  const source = (extra = {}) => {
    const n = node({ stops: [], starts: [], ...extra });
    n.start = (...args) => n.starts.push(args);
    n.stop = at => n.stops.push(at ?? context.currentTime);
    sources.push(n);
    return n;
  };
  const context = {
    currentTime: 1, state: 'running', sampleRate: 48000, nodes, sources, closeCalls: 0,
    destination: node(), listener: {},
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ frequency: param(350), Q: param(1), gain: param(), detune: param() }),
    createStereoPanner: () => node({ pan: param() }),
    createConstantSource: () => source({ offset: param(1) }),
    createOscillator: () => source({ frequency: param(440), detune: param() }),
    createBufferSource: () => source({ playbackRate: param(1) }),
    createDynamicsCompressor: () => node(Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(k => [k, param()]))),
    createConvolver: () => node(),
    suspend() { this.state = 'suspended'; return Promise.resolve(); },
    resume() { this.state = 'running'; return Promise.resolve(); },
    close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
  };
  return context;
}

class OfflineCop extends NemesisAudio {
  load() { return Promise.resolve(null); } // Prevent network I/O; the production voice graph and lifecycle run intact.
}
const view = () => ({ present: true, chasing: true, range: 6, speed: 10, closing: 2, chaseTime: 2, x: 2, z: 3,
  pan: 0, sting: 0, windup: 0, swing: 0, hit: 0 });
function copHarness() {
  const context = fakeContext();
  const cop = new OfflineCop(context, context.createGain(), { noise: { duration: 4 } });
  cop.buffers.sirenClose = { duration: 4 };
  return { context, cop };
}

test('cop reset cancels/disconnects every active and scheduled one-shot, synchronizes counters, and keeps loops reusable', () => {
  const { context, cop } = copHarness(), v = view();
  cop.reset(v);
  v.sting++; v.windup++; v.swing++; v.hit++;
  cop.update(v);
  assert.equal(cop.oneShots.size, 5, 'sting, windup, swing, hit thump and slap');
  cop.sting(context.currentTime + 0.5);
  const shots = [...cop.oneShots], ended = shots.map(s => s.onended);
  const attached = shots.flatMap(s => [s, ...s.connections, ...s.connections.flatMap(n => n.connections)]).filter(n => n !== cop.out);
  context.state = 'suspended';
  cop.reset(v);
  assert.equal(cop.oneShots.size, 0);
  for (const source of shots) {
    assert.equal(source.stops.at(-1), context.currentTime, 'future/naturally scheduled sources are stopped now');
    assert.equal(source.connections.length, 0);
  }
  for (const node of attached) assert.equal(node.connections.length, 0, 'filters and envelopes disconnect too');
  for (const callback of ended) callback(); // Browser may deliver ended after resume; cleanup remains idempotent.
  for (const source of shots) assert.equal(source.disconnects, 1);
  assert.ok(cop.sources.every(s => s.stops.length === 0), 'continuous hum/air sources survive reset');
  assert.deepEqual([cop.farGain.gain.value, cop.closeGain.gain.value, cop.humGain.gain.value], [0, 0, 0]);
  context.state = 'running';
  cop.update(v);
  assert.equal(cop.oneShots.size, 0, 'unchanged counters never replay');
  v.windup++; cop.update(v);
  assert.equal(cop.oneShots.size, 1, 'the very next genuinely fresh cue plays');
  assert.ok(cop.humGain.gain.value > 0, 'continuous audio resumes from current state');
  cop.dispose();
});

test('cop natural completion retires resources; dispose cancels remaining one-shots exactly once', () => {
  const { context, cop } = copHarness();
  cop.paddle('hit', context.currentTime);
  const [finished, active] = [...cop.oneShots];
  finished.onended();
  assert.equal(cop.oneShots.size, 1);
  const ends = active.onended;
  cop.dispose(); cop.dispose(); ends();
  assert.equal(cop.oneShots.size, 0);
  assert.equal(finished.disconnects, 1);
  assert.equal(active.disconnects, 1);
  assert.equal(active.stops.at(-1), context.currentTime);
  const allocations = context.nodes.length;
  cop.sting(context.currentTime); cop.paddle('hit', context.currentTime); cop.update(view());
  assert.equal(context.nodes.length, allocations, 'disposed voice cannot allocate fresh one-shots');
});

function cityHarness(v = view(), { initialize = true, eucClass = class { update() {} reset() {} dispose() {} }, copClass = OfflineCop } = {}) {
  const context = fakeContext(), callbacks = new Map();
  const document = { hidden: false,
    addEventListener(name, callback) { callbacks.set(name, callback); },
    removeEventListener(name) { callbacks.delete(name); }
  };
  const empty = { motors: [], sirens: [], people: [], signals: [], traffic: 0 };
  const { CityAudioSystem } = loadModule(readFileSync(new URL('../js/audio-system.js', import.meta.url), 'utf8'), {
    imports: {
      './audio-synthesis.js': { createSynthResources: () => ({}), setControlRate() {} },
      './audio-events.js': { createEventResources: () => ({ noise: { duration: 4 } }),
        createWindVoice: () => ({ update() {}, dispose() {}, useHowl(buffer) { this.howl = buffer; } }) },
      './audio-sources.js': { CityAudioSources: class { collect() { return empty; } } },
      './audio-acoustics.js': { CityAcoustics: class { update() {} } },
      './euc-audio.js': { EucAudio: eucClass },
      './nemesis-audio.js': { NemesisAudio: copClass }
    }, globals: { document, navigator: { hardwareConcurrency: 8 }, matchMedia: () => ({ matches: false }),
      localStorage: { getItem() { return 'on'; }, setItem() {} }, AudioContext: function () { return context; } }
  });
  const collisionSource = () => ({ removals: 0, setCollisionListener(fn) { this.listener = fn; if (fn === null) this.removals++; } });
  const controllerManager = { ...collisionSource(), getActiveEntity() { return null; } };
  const trafficSystem = collisionSource(), highwayTraffic = collisionSource();
  const audio = new CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic });
  audio.setChaser({ audioView: v });
  if (initialize) {
    audio.initialize();
    audio.cop.buffers.sirenClose = { duration: 4 };
    audio.ready = true;
  }
  const camera = { position: { x: 0, y: 2, z: 0 }, matrixWorld: { elements: [1, 0, 0] } };
  // Keep below the 10 Hz ambience threshold; these tests isolate the actual per-callback cop path.
  const tick = () => { audio.accumulator = 0; audio.update(1 / 60, 0, camera); };
  const cues = () => { v.sting++; v.windup++; v.swing++; v.hit++; };
  return { audio, context, document, callbacks, controllerManager, trafficSystem, highwayTraffic, v, tick, cues };
}

for (const boundary of ['mute', 'visibility', 'interrupted', 'not-ready']) {
  test(`city/cop ${boundary}: cancels active cues, consumes silent counters and resumes only fresh events`, async () => {
    const h = cityHarness();
    h.tick(); h.cues(); h.tick();
    assert.equal(h.audio.cop.oneShots.size, 5);
    const active = [...h.audio.cop.oneShots];
    if (boundary === 'mute') h.audio.setEnabled(false);
    if (boundary === 'visibility') { h.document.hidden = true; h.callbacks.get('visibilitychange')(); }
    if (boundary === 'interrupted') h.context.state = 'interrupted';
    if (boundary === 'not-ready') h.audio.ready = false;
    h.cues(); h.tick();
    assert.equal(h.audio.cop.oneShots.size, 0);
    assert.ok(active.every(s => s.stops.at(-1) === h.context.currentTime && s.connections.length === 0));
    h.cues(); // No callback between this silent event and the mute/visibility resume boundary.
    if (boundary === 'mute') h.audio.setEnabled(true);
    if (boundary === 'visibility') { h.document.hidden = false; h.callbacks.get('visibilitychange')(); }
    // For context/readiness changes, consume the final silent frame before the external owner resumes it.
    if (boundary === 'interrupted' || boundary === 'not-ready') {
      h.tick(); h.context.state = 'running'; h.audio.ready = true;
    }
    await Promise.resolve();
    h.tick();
    assert.equal(h.audio.cop.oneShots.size, 0, 'silent increments never replay on resume');
    h.cues(); h.tick();
    assert.equal(h.audio.cop.oneShots.size, 5, 'next current-frame cues play exactly once');
    h.tick();
    assert.equal(h.audio.cop.oneShots.size, 5);
    h.audio.dispose();
  });
}

test('city/cop initial counters and chaser replacement/removal never replay old cues or retain old voices', () => {
  const h = cityHarness({ ...view(), sting: 10, windup: 11, swing: 12, hit: 13 });
  h.tick();
  assert.equal(h.audio.cop.oneShots.size, 0);
  h.cues(); h.tick();
  assert.equal(h.audio.cop.oneShots.size, 5);
  const replacement = { audioView: { ...view(), sting: 40, windup: 41, swing: 42, hit: 43 } };
  h.audio.setChaser(replacement); h.tick();
  assert.equal(h.audio.cop.oneShots.size, 0);
  replacement.audioView.hit++; h.tick();
  assert.equal(h.audio.cop.oneShots.size, 2);
  h.audio.setChaser(null); h.tick();
  assert.equal(h.audio.cop.oneShots.size, 0);
  h.audio.dispose();
});

test('an ambush sting still plays on the spawn frame before nemesis publishes present/range', () => {
  const h = cityHarness();
  Object.assign(h.v, { present: false, chasing: false, range: Infinity });
  h.tick(); h.v.sting++; h.tick();
  assert.equal(h.audio.cop.oneShots.size, 1, 'spawn returns before the next present/range update');
  h.audio.dispose();
});

test('city subscribes highway contact to the shared symmetric crash gate and detaches all listeners on disposal', () => {
  const h = cityHarness(), emitted = [];
  h.audio.haveListener = true;
  h.audio.emit = (...args) => { emitted.push(args); return true; };
  const rider = { type: 'euc' }, car = {};
  const hit = { a: rider, b: car, kind: 'vehicle', x: 0, y: 0.58, z: 2, speed: 8 };
  assert.equal(h.highwayTraffic.listener, h.trafficSystem.listener);
  assert.equal(h.highwayTraffic.listener, h.controllerManager.listener);
  h.highwayTraffic.listener(hit);
  h.controllerManager.listener({ ...hit, a: car, b: rider });
  assert.equal(emitted.length, 1, 'traffic and controller reports of the same contact share one voice');
  h.context.currentTime += 0.2; h.highwayTraffic.listener(hit);
  assert.equal(emitted.length, 1, 'sustained contact remains quiet');
  h.context.currentTime += 0.4; h.highwayTraffic.listener(hit);
  assert.equal(emitted.length, 2, 'separation permits a later impact');
  h.audio.setEnabled(false); h.highwayTraffic.listener(hit);
  assert.equal(emitted.length, 2, 'muted highway contact is dropped');
  h.audio.dispose();
  for (const source of [h.controllerManager, h.trafficSystem, h.highwayTraffic]) assert.equal(source.listener, null);
});

test('city startup disposal before the first unlock is idempotent and cannot initialize a late audio graph', () => {
  const h = cityHarness(view(), { initialize: false });
  const nodes = h.context.nodes.length;
  h.audio.dispose(); h.audio.dispose();
  h.audio.unlock(); h.audio.initialize();
  assert.equal(h.context.nodes.length, nodes);
  assert.equal(h.audio.context, null);
  assert.equal(h.audio.euc, null);
  assert.equal(h.audio.cop, null);
  assert.equal(h.context.closeCalls, 0);
  assert.equal(h.callbacks.size, 0);
  for (const source of [h.controllerManager, h.trafficSystem, h.highwayTraffic]) assert.equal(source.removals, 1);
});

test('city startup disposal cancels both real audio loaders once and releases its graph once', () =>
  withSampleRequests(async ({ requests, warnings }) => {
    const h = cityHarness(view(), { eucClass: recordLoads(EucAudio), copClass: recordLoads(NemesisAudio) });
    const pending = [...h.audio.euc.pendingLoads, ...h.audio.cop.pendingLoads];
    assert.equal(requests.length, pending.length);
    assert.equal(new Set(requests.map(r => r.signal)).size, 2, 'rider and cop own independent controllers');
    h.audio.initialize();
    assert.equal(requests.length, pending.length, 'duplicate initialize does not restart loading');
    h.cues(); h.tick();
    assert.equal(h.audio.cop.oneShots.size, 5);
    h.audio.dispose();
    assert.equal(h.audio.cop.oneShots.size, 0);
    const disconnects = h.context.nodes.map(n => n.disconnects), count = h.context.nodes.length;
    const buffers = { ...h.audio.cop.buffers };
    h.audio.dispose(); h.audio.unlock(); h.audio.initialize();
    assert.equal(h.context.closeCalls, 1);
    assert.equal(h.context.nodes.length, count);
    assert.deepEqual(h.context.nodes.map(n => n.disconnects), disconnects);
    assert.ok(requests.every(r => r.signal.aborted && r.aborts === 1));
    await Promise.all(pending);
    assert.deepEqual(h.audio.euc.buffers, {});
    assert.deepEqual(h.audio.cop.buffers, buffers, 'aborted loads do not change the existing cache');
    assert.equal(h.audio.wind.howl, undefined, 'disposed rider never calls the shared wind attachment');
    assert.deepEqual(warnings, []);
    assert.equal(h.callbacks.size, 0);
    for (const source of [h.controllerManager, h.trafficSystem, h.highwayTraffic]) assert.equal(source.removals, 1);
  }));

test('city mute keeps real sample fetches/cache alive while actual cop counters consume silent events', () =>
  withSampleRequests(async ({ requests, warnings }) => {
    const h = cityHarness(view(), { eucClass: recordLoads(EucAudio), copClass: recordLoads(NemesisAudio) });
    const buffer = { duration: 4 };
    h.context.decodeAudioData = () => Promise.resolve(buffer);
    h.audio.setEnabled(false);
    h.cues(); h.tick();
    assert.ok(requests.every(r => !r.signal.aborted));
    for (const r of requests) r.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    await Promise.all([...h.audio.euc.pendingLoads, ...h.audio.cop.pendingLoads]);
    for (const key of Object.keys(EUC_SAMPLE_FILES)) assert.equal(h.audio.euc.buffers[key], buffer);
    assert.equal(h.audio.wind.howl, buffer);
    assert.equal(h.audio.cop.far.buffer, buffer);
    assert.equal(h.audio.cop.close.buffer, buffer);
    const fetches = requests.length;
    h.cues(); // Muted event after the last silent update; unmute must synchronize this counter as well.
    h.audio.setEnabled(true);
    await Promise.resolve();
    h.tick();
    assert.equal(h.audio.cop.oneShots.size, 0, 'actual NemesisAudio does not replay muted counters');
    h.cues(); h.tick();
    assert.equal(h.audio.cop.oneShots.size, 5, 'fresh sting, windup, swing and hit still play');
    assert.equal(requests.length, fetches, 'unmute reuses the loaded samples');
    assert.ok(requests.every(r => !r.signal.aborted));
    assert.deepEqual(warnings, []);
    h.audio.dispose();
  }));
