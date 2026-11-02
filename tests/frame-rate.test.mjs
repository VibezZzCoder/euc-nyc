import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createFramePacer, createFrameRatePreference, frameRateHealth, FRAME_RATE_KEY } from '../js/frame-rate.js';
import { menuOwner } from '../js/game-menu.js';

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
  const wiring = main.slice(main.indexOf('  const frameRatePreference ='), main.indexOf('  const resolutionLimit ='));
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
const lifecycle = main.slice(main.indexOf('  function owner()'), main.indexOf('  // Compile only the candidate'));
function loopFixture(choice, gpu = Promise.resolve()) {
  const noop = () => {}, calls = {}, events = {}, order = [];
  const record = (key) => (...args) => { (calls[key] ??= []).push(args); order.push(key); };
  const entity = { position: { x: 0, z: 0 }, speed: 0, controller: {}, tricks: { label: '' }, update: record('entity'), prepareView: record('riderView') };
  const camera = { position: { x: 0, y: 0, z: 0 }, aspect: 1 };
  // Keep currentPos deliberately distinct: trees must use the actual rendered camera, not its follow target.
  const currentPos = { x: -10000, y: -10000, z: -10000 };
  const treeViews = [], renderViews = [], cameraViews = [];
  let cameraSerial = 0, cinematic = null;
  let callback;
  const framePacer = createFramePacer(choice), elFps = {};
  const env = {
    performance: { now: () => 0 }, console: { log: noop },
    document: { hidden: false, getElementById: () => ({}), addEventListener: (key, fn) => { events[key] = fn; }, body: { classList: { toggle: noop } } },
    window: { addEventListener: (key, fn) => { events[key] = fn; } },
    startup: { failed: false, complete: record('complete'), fail: record('fail') },
    renderer: { setAnimationLoop: (fn) => { callback = fn; }, backend: { device: { queue: { onSubmittedWorkDone: () => gpu } } } },
    framePacer, frameRateHealth, frameRatePreference: { value: choice },
    graphicsPreference: { value: 'high' }, graphicsLimit: null, graphicsFailed: record('graphicsFailed'),
    graphics: { value: 'high', apply(value) { this.value = value; record('graphicsApply')(value); } },
    elFps, elSpeed: null, elSpeedKmh: null, elSpeedMeter: null,
    titleScreen: { isOpen: false, started: true, root: {}, show: record('title'), update: record('titleUpdate') },
    booking: { active: false, state: {}, update: record('booking') }, BOOKING_STAGE: {},
    bookingScreen: { update: noop, updateGamepad: record('bookingInput') },
    bookingScene: { view: null, update() { return this.view; } },
    gamepadControls: { update: record('input'), setEnabled: record('padEnabled'), reset: noop },
    gameMenu: { isOpen: false, updateGamepad: record('menuInput') },
    controllerManager: { update: record('rider'), getActiveEntity: () => entity, resetInput: record('resetInput'), setInputEnabled: record('inputEnabled') },
    nemesis: { update: record('pursuit'), director: { state: {} } }, nemesisHud: { update: noop },
    cameraSystem: {
      update(...args) {
        record('camera')(...args);
        cameraSerial++;
        Object.assign(camera.position, cinematic || { x: cameraSerial * 11, y: cameraSerial % 50, z: -cameraSerial * 7 });
        cameraViews.push({ ...camera.position });
      },
      setCinematic(view) { record('cinematic')(view); cinematic = view.position; },
      _clearPointers: noop,
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
    mapSystem: { update: noop, cancelGestures: noop, isFullMapOpen: false }, audioSystem: { update: record('audio'), setPaused: record('audioPaused') },
    eucHud: { update: record('hud') }, touchControls: { setDown: noop, setEnabled: noop }, promptDevice: 'keyboard',
    updateSceneCulling: record('culling'), scene: { traverse: noop }, renderPipeline: { render() {
      record('render')();
      renderViews.push({ ...camera.position });
      assert.deepEqual(treeViews.at(-1), camera.position, 'each submission uses trees selected for this final camera');
    } },
    markInit: noop, initTimings: [], loadingStatus: {}, loadingOverlay: null, setLoadingProgress: noop,
    renderLocation: noop, getLocationLabel: noop
  };
  const controls = new Function(...Object.keys(env), 'menuOwner', `let lastOwner = null, dirtyView = false,
    lifecycleReady = false, rendererBusy = false, stopped = false, pageAway = false;
    ${lifecycle}\n${loop}\nreturn { reset: resetFramePacing, invalidate: () => { dirtyView = true; },
      setBusy: value => { rendererBusy = value; } };`)(...Object.values(env), menuOwner);
  return { step: (now) => callback(now), calls, events, order, treeViews, renderViews, cameraViews,
    ...controls, framePacer, elFps, env };
}

test('quality changes coalesce behind compilation and hidden gates; failures enter graphics recovery', () => {
  const f = loopFixture('30');
  f.step(0);
  const applied = f.calls.graphicsApply.length;
  f.setBusy(true);
  f.env.graphicsPreference.value = 'low'; f.invalidate(); f.step(10);
  f.env.graphicsPreference.value = 'medium'; f.invalidate(); f.step(20);
  assert.equal(f.calls.graphicsApply.length, applied, 'never mutate renderer-owned effects during compile');
  f.setBusy(false); f.step(30);
  assert.deepEqual(f.calls.graphicsApply.at(-1), ['medium'], 'only the latest choice is applied');
  f.env.document.hidden = true;
  f.env.graphicsPreference.value = 'high'; f.invalidate(); f.step(40);
  assert.equal(f.env.graphics.value, 'medium');
  f.env.document.hidden = false; f.step(50);
  assert.equal(f.env.graphics.value, 'high');
  f.env.graphics.apply = () => { throw new Error('quality failure'); };
  const renders = f.calls.render.length;
  f.invalidate(); f.step(60);
  assert.equal(f.calls.render.length, renders, 'failed application cannot submit a partial frame');
  assert.equal(f.calls.graphicsFailed.length, 1);
});

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
      assert.equal(f.calls.riderView.length, target * 3, 'rider clearance/posing follows view admission, not simulation callbacks');
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
  const step = (now, rendered, first = false, frozen = false) => {
    const trees = f.treeViews.length, submissions = f.renderViews.length;
    f.order.length = 0;
    f.step(now);
    assert.equal(f.treeViews.length, trees + Number(rendered));
    assert.equal(f.renderViews.length, submissions + (rendered ? first ? 2 : 1 : 0));
    if (rendered) {
      assert.deepEqual(f.treeViews.at(-1), f.cameraViews.at(-1));
      assert.notDeepEqual(f.treeViews.at(-1), f.env.cameraSystem.currentPos);
      if (!frozen) assert.ok(f.order.indexOf('camera') < f.order.indexOf('trees'));
      else assert.ok(!f.order.includes('camera'), 'paused view retains the final camera');
      assert.ok(f.order.indexOf('trees') < f.order.indexOf('render'));
      assert.ok(f.order.indexOf('riderView') < f.order.indexOf('render'), 'final rig/headlight precede submission');
      if (!first) assert.ok(f.order.indexOf('trees') < f.order.indexOf('culling'));
    } else {
      assert.ok(!f.order.includes('trees') && !f.order.includes('culling') && !f.order.includes('riderView'));
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
  step(41, true); // lifecycle transition invalidates one view even between capped deadlines
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
  step(81, true, false, true); // map opening takes one static scene frame
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

test('production loop keeps player simulation frozen during loading/title and hidden tabs, with final-view pursuit', () => {
  const f = loopFixture('auto');
  f.env.titleScreen.started = false;
  for (const now of [10, 30, 50]) f.step(now);
  assert.equal(f.calls.rider, undefined, 'no simulation advances before Ride');
  assert.deepEqual(f.calls.entity.map(args => args[0]), [0, 0, 0]);
  assert.equal(f.calls.input, undefined, 'no riding gamepad polling before Ride');
  f.env.titleScreen.started = true;
  f.order.length = 0;
  f.step(70);
  assert.equal(f.calls.rider.length, 1);
  assert.ok(f.order.indexOf('camera') < f.order.indexOf('pursuit'), 'ambush visibility uses the final view');
  f.env.document.hidden = true;
  f.step(90);
  assert.equal(f.calls.rider.length, 1, 'hidden updates cannot move the rider');
  assert.equal(f.calls.entity.at(-1)[0], 0);
  assert.equal(f.calls.pursuit.at(-1)[1], false, 'chase clocks remain frozen');
});

test('menu/map/hidden pause freezes simulation and elapsed clocks, polls modal input, renders statically, resumes without debt', () => {
  for (const pause of ['menu', 'map', 'hidden']) {
    const f = loopFixture('auto'); f.step(10); f.step(30);
    const trafficCount = f.calls.traffic.length, riderCount = f.calls.rider.length;
    const elapsed = f.calls.traffic.at(-1)[1];
    if (pause === 'menu') f.env.gameMenu.isOpen = true;
    if (pause === 'map') f.env.mapSystem.isFullMapOpen = true;
    if (pause === 'hidden') f.env.document.hidden = true;
    const renderCount = f.calls.render.length;
    f.step(10000); f.step(20000); f.step(30000);
    assert.equal(f.calls.traffic.length, trafficCount, 'traffic and pedestrians freeze');
    assert.equal(f.calls.highway.length, trafficCount, 'highway freezes');
    assert.equal(f.calls.rider.length, riderCount, 'player cannot drift');
    assert.deepEqual(f.calls.pursuit.at(-1), [0, false], 'pursuit freezes');
    assert.equal(f.calls.booking.at(-1)[1], false, 'booking elapsed is suspended');
    assert.equal(f.calls.audioPaused.at(-1)[0], true);
    assert.equal(f.calls.render.length, renderCount + Number(pause !== 'hidden'), 'one static frame, none while hidden');
    if (pause === 'menu') assert.equal(f.calls.menuInput.length, 3, 'modal pad still polls');
    f.env.gameMenu.isOpen = false; f.env.mapSystem.isFullMapOpen = false; f.env.document.hidden = false;
    f.step(40000);
    assert.equal(f.calls.rider.at(-1)[0], 0.001, 'no pause debt on resume');
    assert.equal(f.calls.traffic.at(-1)[1], elapsed + 0.001);
    assert.equal(f.calls.audioPaused.at(-1)[0], false);
  }
});

test('an invalidated frozen map needs one scene submission, then stays static without advancing world clocks', () => {
  const f = loopFixture('auto'); f.step(10);
  f.env.mapSystem.isFullMapOpen = true; f.step(20);
  const rendered = f.calls.render.length, traffic = f.calls.traffic.length, rider = f.calls.rider.length;
  f.step(30); assert.equal(f.calls.render.length, rendered);
  f.invalidate(); // applyViewportSize owns this exact dirtyView assignment, covered in viewport.test.cjs
  f.step(40); assert.equal(f.calls.render.length, rendered + 1);
  f.step(50); f.step(60);
  assert.equal(f.calls.render.length, rendered + 1, 'no second frame is necessary for a static resized view');
  assert.equal(f.calls.traffic.length, traffic); assert.equal(f.calls.rider.length, rider);
  assert.deepEqual(f.calls.pursuit.at(-1), [0, false]);
});
