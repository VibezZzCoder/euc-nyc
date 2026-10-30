import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createFramePacer, createFrameRatePreference, frameRateHealth, FRAME_RATE_KEY } from '../js/frame-rate.js';

test('FPS health respects the 30 cap and sample quantization without requiring a high-refresh display', () => {
  for (const fps of [27, 28, 30, 32]) assert.equal(frameRateHealth(fps, '30'), 'fps-ok');
  for (const fps of [20, 24, 26]) assert.equal(frameRateHealth(fps, '30'), 'fps-warn');
  for (const fps of [0, 15, 19]) assert.equal(frameRateHealth(fps, '30'), 'fps-bad');
  for (const choice of ['auto', '60', '120']) {
    for (const fps of [50, 58, 60, 120]) assert.equal(frameRateHealth(fps, choice), 'fps-ok');
    for (const fps of [30, 32, 49]) assert.equal(frameRateHealth(fps, choice), 'fps-warn');
    for (const fps of [0, 20, 28, 29]) assert.equal(frameRateHealth(fps, choice), 'fps-bad');
  }
});

function schedule(hz, choice, seconds = 600, jitter = false) {
  const pacer = createFramePacer(choice), renders = [];
  for (let i = 0; i <= hz * seconds; i++) {
    const now = jitter ? Math.round((i * 1000 / hz + Math.sin(i * 1.7) * 0.12) * 10) / 10 : i * 1000 / hz;
    if (pacer.shouldRender(now)) renders.push(now);
  }
  return renders;
}

for (const hz of [60, 120, 144, 240]) {
  for (const choice of ['auto', '120', '60', '30']) {
    test(`${hz} Hz callbacks / ${choice}: ten-minute count and bounded phase, including timestamp jitter`, () => {
      for (const jitter of [false, true]) {
        const frames = schedule(hz, choice, 600, jitter);
        const rate = choice === 'auto' ? hz : Math.min(hz, Number(choice));
        assert.ok(Math.abs(frames.length - (rate * 600 + 1)) <= 1, `${frames.length} frames`);
        const interval = 1000 / rate;
        for (let i = 0; i < frames.length; i++) {
          assert.ok(Math.abs(frames[i] - i * interval) < 1000 / hz + 0.6, `phase drift at frame ${i}`);
          if (i && choice !== 'auto') assert.ok(frames[i] - frames[i - 1] >= interval - 1000 / hz - 0.6);
        }
      }
    });
  }
}

test('60/120 FPS do not halve on fractional or slightly faster/quantized callbacks', () => {
  for (const choice of ['60', '120']) {
    for (const hz of [59.94, 60.02, 119.88, 120.02, 143.856, 239.76]) {
      const frames = schedule(hz, choice, 600, true);
      assert.ok(Math.abs(frames.length - Math.min(hz, Number(choice)) * 600) <= 2, `${hz}/${choice}: ${frames.length}`);
    }
  }
});

test('stalls discard render debt; reset, clock rewind and setting changes admit a fresh frame', () => {
  for (const choice of ['30', '60', '120']) {
    const pacer = createFramePacer(choice), interval = 1000 / Number(choice);
    assert.equal(pacer.shouldRender(0), true);
    assert.equal(pacer.shouldRender(1), false);
    assert.equal(pacer.shouldRender(5000), true);
    for (let i = 1; i < interval - 0.5; i++) assert.equal(pacer.shouldRender(5000 + i), false);
    assert.equal(pacer.shouldRender(5000 + interval), true);
    pacer.reset();
    assert.equal(pacer.shouldRender(5001 + interval), true);
    assert.equal(pacer.shouldRender(0), true);
    assert.equal(pacer.shouldRender(NaN), false);
    pacer.set('auto');
    assert.equal(pacer.shouldRender(1), true);
    pacer.set('30');
    assert.equal(pacer.shouldRender(2), true);
    assert.equal(pacer.shouldRender(18), false);
    pacer.set('60');
    assert.equal(pacer.shouldRender(19), true);
    assert.equal(pacer.shouldRender(19 + 1000 / 60), true);
    pacer.set('120');
    assert.equal(pacer.shouldRender(40), true);
    assert.equal(pacer.shouldRender(40 + 1000 / 240), false);
    assert.equal(pacer.shouldRender(40 + 1000 / 120), true);
  }
});

test('slow callbacks render once each without debt, then recover the selected cadence', () => {
  for (const choice of ['30', '60', '120']) {
    const pacer = createFramePacer(choice);
    for (let i = 0; i <= 100; i++) assert.equal(pacer.shouldRender(i * 70), true);
    let count = 0;
    for (let i = 1; i <= 144 * 10; i++) if (pacer.shouldRender(7000 + i * 1000 / 144)) count++;
    assert.ok(Math.abs(count - Number(choice) * 10) <= 1);
  }
});

test('preferences persist validated choices, avoid per-frame storage and tolerate unavailable storage', () => {
  const data = new Map(), writes = [];
  let reads = 0;
  const storage = { getItem(key) { reads++; return data.get(key); },
    setItem(key, value) { writes.push([key, value]); data.set(key, value); } };
  const preference = createFrameRatePreference(() => storage);
  assert.equal(preference.value, 'auto');
  for (const bad of ['240', '', null, 60, 120, '__proto__']) assert.equal(preference.set(bad), false);
  assert.equal(preference.set('30'), true);
  assert.equal(preference.set('30'), false);
  for (let i = 0; i < 1000; i++) assert.equal(preference.value, '30');
  assert.equal(reads, 1);
  assert.deepEqual(writes, [[FRAME_RATE_KEY, '30']]);
  assert.equal(createFrameRatePreference(() => storage).value, '30');
  assert.equal(preference.set('120'), true);
  assert.equal(createFrameRatePreference(() => storage).value, '120');
  preference.set('auto');
  assert.equal(createFrameRatePreference(() => storage).value, 'auto');
  data.set(FRAME_RATE_KEY, 'broken');
  assert.equal(createFrameRatePreference(() => storage).value, 'auto');
  const blocked = createFrameRatePreference(() => { throw Error('blocked'); });
  assert.equal(blocked.value, 'auto');
  assert.equal(blocked.set('60'), true);
  assert.equal(blocked.value, '60');
});

// Execute the production loop with counted collaborators. A correct pacer alone cannot prove that the
// application's dt/traffic/input updates are outside its render gate, tree presentation is inside it, or preserve GPU boot rejection.
const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
test('selector restores persistence, clears held input, resets pacing and preserves keyboard focus', () => {
  const handlers = {}, writes = [];
  let reset = 0, inputReset = 0, blur = 0;
  const select = { value: '', addEventListener: (key, fn) => { handlers[key] = fn; }, blur: () => { blur++; } };
  const preference = createFrameRatePreference(() => ({ getItem: () => '120', setItem: (...args) => writes.push(args) }));
  const wiring = main.slice(main.indexOf('  const frameRatePreference ='), main.indexOf('  const elMode ='));
  const pacer = new Function('createFrameRatePreference', 'createFramePacer', 'document', 'controllerManager', 'resetFramePacing',
    `${wiring}\nreturn framePacer;`)(() => preference, createFramePacer,
    { getElementById: (id) => { assert.equal(id, 'fps-limit'); return select; } },
    { resetInput: () => { inputReset++; } }, () => { reset++; });
  assert.equal(select.value, '120');
  handlers.focus();
  assert.equal(inputReset, 1);
  handlers.pointerdown();
  select.value = '60';
  handlers.change();
  assert.equal(blur, 1);
  assert.equal(reset, 1);
  assert.equal(pacer.shouldRender(0), true);
  assert.equal(pacer.shouldRender(1000 / 60), true);
  handlers.pointerdown();
  handlers.keydown();
  select.value = '30';
  handlers.change();
  assert.equal(blur, 1, 'keyboard selection keeps focus');
  assert.equal(reset, 2);
  assert.deepEqual(writes, [[FRAME_RATE_KEY, '60'], [FRAME_RATE_KEY, '30']]);
  assert.equal(pacer.shouldRender(20), true, 'switch resets the render deadline');
  assert.equal(pacer.shouldRender(20 + 1000 / 60), false);
});

const loop = main.slice(main.indexOf('  // 6. Animation Loop'), main.lastIndexOf('\n}'));
function loopFixture(choice, gpu = Promise.resolve()) {
  const noop = () => {}, calls = {}, events = {}, order = [];
  const record = (key) => (...args) => { (calls[key] ??= []).push(args); order.push(key); };
  const entity = { position: { x: 0, z: 0 }, speed: 0, controller: {}, tricks: { label: '' }, update: record('entity') };
  const camera = { position: { x: 0, y: 0, z: 0 }, aspect: 1 };
  // Keep currentPos deliberately distinct: trees must use the actual rendered camera, not its follow target.
  const currentPos = { x: -10000, y: -10000, z: -10000 };
  const treeViews = [], renderViews = [], cameraViews = [];
  let cameraSerial = 0, cinematic = null;
  let callback;
  const framePacer = createFramePacer(choice), elFps = {};
  const env = {
    performance: { now: () => 0 }, console: { log: noop },
    document: { hidden: false, addEventListener: (key, fn) => { events[key] = fn; }, body: { classList: { toggle: noop } } },
    window: { addEventListener: (key, fn) => { events[key] = fn; } },
    startup: { failed: false, complete: record('complete'), fail: record('fail') },
    renderer: { setAnimationLoop: (fn) => { callback = fn; }, backend: { device: { queue: { onSubmittedWorkDone: () => gpu } } } },
    framePacer, frameRateHealth, frameRatePreference: { value: choice },
    elFps, elSpeed: null, elSpeedKmh: null, elSpeedMeter: null,
    titleScreen: { isOpen: false, started: true, root: {}, show: record('title'), update: record('titleUpdate') },
    booking: { active: false, state: {}, update: record('booking') }, BOOKING_STAGE: {},
    bookingScreen: { update: noop, updateGamepad: record('bookingInput') },
    bookingScene: { view: null, update() { return this.view; } },
    gamepadControls: { update: record('input') },
    controllerManager: { update: record('rider'), getActiveEntity: () => entity, resetInput: record('resetInput') },
    nemesis: { update: record('pursuit'), director: { state: {} } }, nemesisHud: { update: noop },
    cameraSystem: {
      update(...args) {
        record('camera')(...args);
        cameraSerial++;
        Object.assign(camera.position, cinematic || { x: cameraSerial * 11, y: cameraSerial % 50, z: -cameraSerial * 7 });
        cameraViews.push({ ...camera.position });
      },
      setCinematic(view) { record('cinematic')(view); cinematic = view.position; },
      camera, currentPos, getActivePreset: () => ({ category: 'follow' })
    },
    streetDetails: { signalClock: { value: 0 }, update: record('streetLights'), treeField: {
      update(position) {
        record('trees')(position);
        assert.equal(position, camera.position, 'tree update receives actual view object');
        treeViews.push({ ...position }); // snapshot now; retained references would hide stale-camera regressions
      }
    } },
    trafficSystem: { update: record('traffic'), setPresentationClearance: noop },
    highwayTraffic: { update: record('highway') }, savePlayerState: noop,
    boroughs: {}, cityBlocks: { update: noop }, lightingSystem: { update: noop }, landmarks: { update: noop },
    mapSystem: { update: noop, isFullMapOpen: false }, audioSystem: { update: record('audio') },
    eucHud: { update: record('hud') }, touchControls: { setDown: noop }, promptDevice: 'keyboard',
    updateSceneCulling: record('culling'), scene: { traverse: noop }, renderPipeline: { render() {
      record('render')();
      renderViews.push({ ...camera.position });
      assert.deepEqual(treeViews.at(-1), camera.position, 'each submission uses trees selected for this final camera');
    } },
    markInit: noop, initTimings: [], loadingStatus: {}, loadingOverlay: null, setLoadingProgress: noop,
    renderLocation: noop, getLocationLabel: noop
  };
  const reset = new Function(...Object.keys(env), `${loop}\nreturn resetFramePacing;`)(...Object.values(env));
  return { step: (now) => callback(now), calls, events, order, treeViews, renderViews, cameraViews, reset, framePacer, elFps, env };
}

test('a cached pre-tricks rider still renders the first frame and completes startup', async () => {
  const f = loopFixture('auto');
  const rider = f.env.controllerManager.getActiveEntity();
  delete rider.tricks;
  f.step(0);
  await Promise.resolve();
  assert.equal(f.calls.complete.length, 1);
  assert.equal(f.calls.hud[0][3], '', 'missing optional feedback is empty');
  assert.equal(f.calls.render.length, 2, 'warm-up and first visible frame render');
  rider.tricks = { label: 'One-foot 180' };
  f.step(17);
  assert.equal(f.calls.hud.at(-1)[3], 'One-foot 180');
  delete rider.tricks;
  f.step(34);
  assert.equal(f.calls.hud.at(-1)[3], '', 'an absent channel also clears stale HUD text');
});

test('production loop throttles renders/culling/tree presentation, preserving gameplay callback dts and actual FPS', async () => {
  for (const hz of [60, 120, 144, 240]) {
    const fixtures = ['auto', '120', '60', '30'].map((choice) => loopFixture(choice));
    for (let i = 1; i <= hz * 3; i++) for (const f of fixtures) {
      f.step(i * 1000 / hz);
      if (Number.isFinite(Number(f.elFps.textContent))) {
        assert.equal(f.elFps.className, 'fps-ok', 'healthy capped rendering stays green across telemetry windows');
      }
    }
    const base = fixtures[0].calls;
    for (const [index, f] of fixtures.entries()) {
      for (const key of ['input', 'rider', 'pursuit', 'booking', 'camera', 'traffic', 'highway', 'audio', 'streetLights']) {
        assert.equal(f.calls[key].length, hz * 3, key);
        assert.deepEqual(f.calls[key].map((args) => args.slice(0, 2)), base[key].map((args) => args.slice(0, 2)), key);
      }
      const target = [hz, Math.min(hz, 120), 60, 30][index];
      assert.equal(f.calls.render.length, target * 3 + 1, 'one extra startup warm-up submission');
      assert.equal(f.calls.culling.length, target * 3 - 1);
      assert.equal(f.calls.trees.length, target * 3, 'one tree update per admitted frame, including boot');
      assert.deepEqual(f.treeViews, f.renderViews.slice(1), 'boot submissions share one tree update; every later view has its own');
      assert.ok(Math.abs(Number(f.elFps.textContent) - target) <= 3, 'telemetry counts renders, not callbacks');
      await Promise.resolve();
      assert.equal(f.calls.complete.length, 1);
    }
  }
});

test('tree admission follows the final title, riding, booking and map-return camera, never skipped callbacks', () => {
  const f = loopFixture('30');
  let admit = true;
  f.framePacer.shouldRender = () => admit;
  const step = (now, rendered, first = false) => {
    const trees = f.treeViews.length, submissions = f.renderViews.length;
    f.order.length = 0;
    f.step(now);
    assert.equal(f.treeViews.length, trees + Number(rendered));
    assert.equal(f.renderViews.length, submissions + (rendered ? first ? 2 : 1 : 0));
    if (rendered) {
      assert.deepEqual(f.treeViews.at(-1), f.cameraViews.at(-1));
      assert.notDeepEqual(f.treeViews.at(-1), f.env.cameraSystem.currentPos);
      assert.ok(f.order.indexOf('camera') < f.order.indexOf('trees'));
      assert.ok(f.order.indexOf('trees') < f.order.indexOf('render'));
      if (!first) assert.ok(f.order.indexOf('trees') < f.order.indexOf('culling'));
    } else {
      assert.ok(!f.order.includes('trees') && !f.order.includes('culling'));
      assert.ok(f.order.includes('camera') && f.order.includes('streetLights'), 'callback updates remain live');
    }
  };
  f.env.titleScreen.isOpen = true;
  step(1, true, true);
  assert.ok(f.order.indexOf('titleUpdate') < f.order.indexOf('camera'));
  admit = false;
  step(2, false);
  f.env.titleScreen.isOpen = false;
  admit = true;
  step(40, true); // riding after title
  f.env.booking.active = true;
  f.env.booking.state.phase = 'signing';
  const bookingPosition = { x: 73, y: 2.75, z: -812 };
  f.env.bookingScene.view = { position: bookingPosition };
  admit = false;
  step(41, false);
  admit = true;
  step(80, true);
  assert.deepEqual(f.treeViews.at(-1), bookingPosition);
  assert.ok(f.order.includes('bookingInput'));
  assert.ok(f.order.indexOf('cinematic') < f.order.indexOf('camera'), 'booking framing precedes final camera and tree selection');
  f.env.booking.active = false;
  f.env.bookingScene.view = null;
  f.env.cameraSystem.setCinematic({ position: null });
  f.env.mapSystem.isFullMapOpen = true;
  admit = false;
  step(81, false);
  f.env.mapSystem.isFullMapOpen = false;
  admit = true;
  step(120, true);
  assert.notDeepEqual(f.treeViews.at(-1), bookingPosition);
});

test('production lifecycle resets discard background dt and render deadline; settings reset leaves gameplay dt intact', () => {
  const f = loopFixture('30');
  let now = 10;
  f.step(now);
  for (const event of ['visibilitychange', 'blur', 'focus', 'pagehide', 'pageshow']) {
    f.events[event]();
    now += 10000;
    const before = f.calls.render.length;
    const beforeTrees = f.calls.trees.length;
    f.step(now);
    assert.equal(f.calls.render.length, before + 1, event);
    assert.equal(f.calls.trees.length, beforeTrees + 1, event);
    assert.equal(f.calls.rider.at(-1)[0], 0.001, 'resume uses minimum safe dt, not hidden time');
    f.step(now + 5);
    assert.equal(f.calls.render.length, before + 1, 'no catch-up render burst');
    assert.equal(f.calls.trees.length, beforeTrees + 1, 'no tree work on skipped resume callback');
    now += 5;
  }
  f.framePacer.set('60');
  f.reset();
  f.step(now + 10);
  assert.equal(f.calls.rider.at(-1)[0], 0.01, 'setting change does not lose simulation time');
});

test('first frame bypasses admission and retains GPU completion/rejection boot path', async () => {
  let resolve;
  const f = loopFixture('30', new Promise((done) => { resolve = done; }));
  f.framePacer.shouldRender = () => false;
  f.step(1);
  assert.equal(f.calls.render.length, 2);
  assert.equal(f.calls.trees.length, 1, 'forced boot updates trees once before both warm-up submissions');
  assert.deepEqual(f.treeViews[0], f.cameraViews[0]);
  assert.equal(f.calls.complete, undefined);
  f.step(2);
  assert.equal(f.calls.render.length, 2);
  assert.equal(f.calls.trees.length, 1, 'pending GPU completion does not bypass pacing again');
  resolve();
  await Promise.resolve();
  assert.equal(f.calls.complete.length, 1);
  assert.equal(f.calls.title.length, 1);
  const error = Error('GPU first-frame failure');
  const failed = loopFixture('30', Promise.reject(error));
  failed.step(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(failed.calls.fail, [[error]]);
  assert.equal(failed.calls.complete, undefined);
  assert.equal(failed.calls.title, undefined);
  assert.equal(failed.calls.trees.length, 1);
  failed.env.startup.failed = true;
  failed.step(1000);
  assert.equal(failed.calls.trees.length, 1, 'failed startup stops further tree presentation');
});
