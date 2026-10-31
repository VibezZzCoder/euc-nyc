const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { buildingRecords, pier15DeckRecords } = require('./helpers/placement-records.cjs');

const source = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');
let NycTerrainSampler, boxesFromCityColliders, THREE, config, GEO, mergeSolidParts;
test.before(async () => {
  ({ NycTerrainSampler, boxesFromCityColliders } = await import('../js/euc-terrain.js'));
  [THREE, config, { GEO }, { mergeSolidParts }] = await Promise.all([
    import('../vendor/three/build/three.core.js'), import('../js/city-config.js'),
    import('../js/nyc-geodata.js'), import('../js/solid-rects.js')
  ]);
});

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function keyboardHarness(nyc = {}) {
  const window = eventTarget();
  const document = { ...eventTarget(), hidden: false };
  const config = {
    streetZ: () => 0,
    isTypingInField: (event) => ['INPUT', 'SELECT'].includes(event.target?.tagName),
    ...nyc
  };
  const { ThirdPersonControllerManager } = loadModule(source, {
    globals: { window, document },
    imports: {
      'three/webgpu': {},
      './city-config.js': config,
      './landmarks.js': {},
      './euc-terrain.js': { NycTerrainSampler: class {}, boxesFromCityColliders: () => [] },
      './euc-rider.js': {}
    }
  });
  // Exercise the production event handlers without constructing the scene's 3D models.
  const controller = Object.create(ThirdPersonControllerManager.prototype);
  controller.keys = Object.fromEntries(['forward', 'backward', 'left', 'right', 'up', 'boost', 'reset'].map((action) => [action, false]));
  controller.bindKeyboard();
  return {
    controller,
    window,
    document,
    key(type, code, tagName = 'BODY', options = {}) {
      window.dispatch(type, { code, target: { tagName }, ...options });
    }
  };
}

test('the EUC sampler consumes drawn ride solids / tops directly, independently of traffic footprints', () => {
  const building = { centre: { x: 0, y: 10, z: 0 }, halfExtents: { x: 4, y: 10, z: 4 }, rotationY: 0 };
  const furniture = { centre: { x: 10, y: 0.84, z: 5 }, halfExtents: { x: 0.325, y: 0.625, z: 0.325 }, rotationY: 0, occludes: false };
  const tops = Object.freeze([{ top: 0.315, surface: 'dirt' }]);
  const solids = Object.freeze([furniture]);
  const { ThirdPersonControllerManager } = loadModule(source, {
    globals: { window: eventTarget(), document: eventTarget() },
    imports: {
      './city-config.js': { streetZ: () => 0 },
      './landmarks.js': {},
      './euc-terrain.js': {
        NycTerrainSampler: class { constructor(options) { this.options = options; } },
        boxesFromCityColliders: () => [building]
      },
      './euc-rider.js': { createEucEntity: () => ({}) }
    }
  });
  const manager = new ThirdPersonControllerManager({}, [], {
    ride: { solids, tops },
    streetFootprints: [{ minX: 8, maxX: 12, minZ: 3, maxZ: 7 }] // a legacy option must not add a generic-height box
  });
  assert.deepEqual(Array.from(manager.eucSampler.options.boxes), [building, furniture]);
  assert.equal(manager.eucSampler.options.tops, tops);
  assert.equal(solids.length, 1, 'merging building boxes does not mutate the ride layer');
});

test('constructor input is enabled by default and can be disabled before any event or analog poll', () => {
  const window = eventTarget(), document = eventTarget();
  const { ThirdPersonControllerManager } = loadModule(source, {
    globals: { window, document }, imports: {
      './city-config.js': { streetZ: () => 0, isTypingInField: () => false }, './landmarks.js': {},
      './euc-terrain.js': { NycTerrainSampler: class {}, boxesFromCityColliders: () => [] },
      './euc-rider.js': { createEucEntity: () => ({ clearInput() {} }) }
    }
  });
  const enabled = new ThirdPersonControllerManager({});
  const disabled = new ThirdPersonControllerManager({}, [], { inputEnabled: false });
  window.dispatch('keydown', { code: 'KeyW' });
  assert.equal(enabled.keys.forward, true);
  for (const setter of ['setTouchInput', 'setGamepadInput']) disabled[setter]('forward', 0.8);
  assert.equal(disabled.keys.forward, false);
  disabled.setInputEnabled(true);
  assert.equal(disabled.keys.forward, false, 'disabled input was discarded, not saved for later');
  disabled.setTouchInput('forward', 0.4);
  assert.equal(disabled.keys.forward, 0.4);
  disabled.setInputEnabled(false);
  assert.equal(Object.values(disabled.keys).some(Boolean), false);
  disabled.setInputEnabled(true);
  window.dispatch('keydown', { code: 'KeyW', repeat: true });
  assert.equal(disabled.keys.forward, false, 'held key cannot leak across the gate');
  window.dispatch('keydown', { code: 'KeyW', repeat: false });
  assert.equal(disabled.keys.forward, true, 'first fresh press is accepted immediately');
});

test('releasing a movement key after focusing search stops movement', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'KeyW');
  assert.equal(controller.keys.forward, true);
  key('keyup', 'KeyW', 'INPUT');
  assert.equal(controller.keys.forward, false);

  key('keydown', 'KeyW', 'INPUT');
  assert.equal(controller.keys.forward, false, 'typing in search does not move the player');
});

test('releasing one movement binding preserves another held binding', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'KeyW');
  key('keydown', 'ArrowUp');
  key('keyup', 'ArrowUp');
  assert.equal(controller.keys.forward, true);
  key('keyup', 'KeyW');
  assert.equal(controller.keys.forward, false);
});

test('either Shift key keeps boost active until both are released', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'ShiftLeft');
  key('keydown', 'ShiftRight');
  key('keyup', 'ShiftLeft');
  assert.equal(controller.keys.boost, true);
  key('keyup', 'ShiftRight');
  assert.equal(controller.keys.boost, false);
});

test('keyboard and touch input remain active independently', () => {
  const { controller, key } = keyboardHarness();
  controller.setTouchInput('forward', 0.35);
  assert.equal(controller.keys.forward, 0.35);
  key('keydown', 'KeyW');
  assert.equal(controller.keys.forward, true);
  controller.setTouchInput('forward', 0.6);
  assert.equal(controller.keys.forward, true);
  key('keyup', 'KeyW');
  assert.equal(controller.keys.forward, 0.6);
  controller.setTouchInput('forward', 0);
  assert.equal(controller.keys.forward, false);
});

test('clearing touch input preserves held keyboard controls', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'KeyW');
  controller.setTouchInput('forward', 0.4);
  controller.setTouchInput('left', 0.7);
  controller.setTouchInput('boost', true);
  controller.clearTouchInput();
  assert.equal(controller.keys.forward, true);
  assert.equal(controller.keys.left, false);
  assert.equal(controller.keys.boost, false);
  key('keyup', 'KeyW');
  assert.equal(controller.keys.forward, false);
});

test('touch strengths are clamped and unknown actions are ignored', () => {
  const { controller } = keyboardHarness();
  controller.setTouchInput('forward', 2);
  controller.setTouchInput('left', -0.5);
  controller.setTouchInput('up', true);
  controller.setTouchInput('unknown', 1);
  assert.equal(controller.keys.forward, 1);
  assert.equal(controller.keys.left, false);
  assert.equal(controller.keys.up, true);
  assert.equal(Object.hasOwn(controller.keys, 'unknown'), false);
});

for (const interruption of ['blur', 'hidden', 'reset']) {
  test(`${interruption} clears held controls and their physical key state`, () => {
    const { controller, window, document, key } = keyboardHarness();
    key('keydown', 'KeyW');
    key('keydown', 'KeyA');
    key('keydown', 'Space');
    key('keydown', 'ShiftLeft');
    controller.setTouchInput('forward', 0.4);
    controller.setTouchInput('backward', 0.8);
    controller.setTouchInput('reset', true);
    if (interruption === 'blur') {
      window.dispatch('blur');
    } else if (interruption === 'hidden') {
      document.hidden = true;
      document.dispatch('visibilitychange');
    } else {
      controller.resetInput();
    }
    assert.equal(Object.values(controller.keys).some(Boolean), false);
    for (const code of ['KeyW', 'KeyA', 'Space', 'ShiftLeft', 'KeyR']) key('keydown', code, 'BODY', { repeat: true });
    assert.equal(Object.values(controller.keys).some(Boolean), false, 'orphan repeats cannot recreate lost holds or presses');
    key('keyup', 'Space');
    assert.equal(controller.keys.hopPressed, false, 'an orphan release is not a press');
    key('keydown', 'Space', 'BODY', { repeat: false });
    assert.equal(controller.keys.hopPressed, true, 'a genuinely fresh press is never swallowed');
    key('keyup', 'Space');
    controller.resetInput();

    // A fresh use of the alias must not revive the old key whose keyup was lost.
    key('keydown', 'ArrowUp');
    key('keyup', 'ArrowUp');
    assert.equal(controller.keys.forward, false);
  });
}

test('modified/browser shortcut keydowns are ignored; their releases still clear riding holds', () => {
  const { controller, key } = keyboardHarness();
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'isComposing', 'defaultPrevented']) {
    for (const code of ['KeyW', 'Space', 'KeyR']) key('keydown', code, 'BODY', { [modifier]: true });
    assert.equal(Object.values(controller.keys).some(Boolean), false, modifier);
    key('keydown', 'KeyW');
    key('keyup', 'KeyW', 'BODY', { [modifier]: true });
    assert.equal(controller.keys.forward, false);
  }
  key('keydown', 'ShiftLeft'); key('keydown', 'KeyW', 'BODY', { shiftKey: true });
  assert.equal(controller.keys.forward, true, 'Shift + riding remains available for crouch');
  assert.equal(controller.keys.boost, true);
});

test('focused interactive controls own keydowns without swallowing riding releases', () => {
  const { controller, key, document } = keyboardHarness();
  const targets = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'A', 'SUMMARY'].map(tagName => ({ tagName }));
  targets.push({ tagName: 'SPAN', closest: () => ({ tagName: 'BUTTON' }) }, { tagName: 'DIV', isContentEditable: true });
  for (const target of targets) {
    for (const code of ['KeyW', 'Space', 'KeyR', 'ShiftLeft']) key('keydown', code, 'BODY', { target });
    assert.equal(Object.values(controller.keys).some(Boolean), false, target.tagName);
    key('keydown', 'KeyW'); key('keyup', 'KeyW', 'BODY', { target });
    assert.equal(controller.keys.forward, false);
  }
  document.activeElement = { tagName: 'BUTTON' };
  key('keydown', 'Space');
  assert.equal(controller.keys.up, false, 'focus is respected even when event target is retargeted');
});

test('R and the gamepad/touch reset action share one "get up" input', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'KeyR');
  assert.equal(controller.keys.reset, true);
  key('keyup', 'KeyR');
  assert.equal(controller.keys.reset, false);
  controller.setGamepadInput('reset', 1);
  assert.equal(controller.keys.reset, 1);
  controller.clearGamepadInput();
  assert.equal(controller.keys.reset, false);
});

test('a hop or get-up tap shorter than a frame still reaches the rider for one frame', () => {
  const { controller, key } = keyboardHarness();
  const seen = [];
  controller.entities = { euc: { update: (_dt, keys) => seen.push({ up: keys.up, reset: keys.reset, forward: keys.forward,
    hopPressed: keys.hopPressed, resetPressed: keys.resetPressed }) } };
  controller.setTouchInput('reset', 1);
  controller.setTouchInput('reset', 0); // tapped and lifted between two frames
  key('keydown', 'Space');
  key('keyup', 'Space');
  key('keydown', 'KeyW');
  key('keyup', 'KeyW'); // levels are not latched: a lost W tap stays lost
  controller.update(1 / 60);
  controller.update(1 / 60);
  assert.deepEqual(seen[0], { up: true, reset: true, forward: false, hopPressed: true, resetPressed: true });
  assert.deepEqual(seen[1], { up: false, reset: false, forward: false, hopPressed: false, resetPressed: false }, 'only for that one frame');
  assert.equal(controller.keys.up, false, 'the live key state is untouched');
});

test('separate press flags preserve a release/repress while the last rendered level was already true', () => {
  const { controller, key } = keyboardHarness();
  const seen = [];
  controller.entities = { euc: { update: (_dt, keys) => seen.push({ ...keys }) } };
  key('keydown', 'Space'); key('keydown', 'KeyR'); controller.update(1 / 120);
  key('keyup', 'Space'); key('keydown', 'Space'); key('keyup', 'Space');
  key('keyup', 'KeyR'); key('keydown', 'KeyR'); key('keyup', 'KeyR');
  controller.update(1 / 120); controller.update(1 / 120);
  assert.equal(seen[0].hopPressed, true); assert.equal(seen[0].resetPressed, true);
  assert.equal(seen[1].up, true); assert.equal(seen[1].reset, true);
  assert.equal(seen[1].hopPressed, true); assert.equal(seen[1].resetPressed, true);
  assert.equal(seen[2].hopPressed, false); assert.equal(seen[2].resetPressed, false);
  controller.setTouchInput('up', true); controller.update(1 / 120);
  controller.setGamepadInput('up', true); controller.update(1 / 120);
  assert.equal(seen.at(-1).hopPressed, true, 'another source can press while touch remains held');
  controller.setTouchInput('hopPressed', true);
  assert.equal(controller.keys.hopPressed, false, 'only semantic held actions are writable by devices');
});

test('viewport touch cancellation clears touch presses/tricks but retains keyboard and pad input', () => {
  const { controller, key } = keyboardHarness();
  let cancelled;
  controller.entities = { euc: { clearInput: keys => { cancelled = { ...keys }; } } };
  key('keydown', 'KeyW'); key('keydown', 'KeyR');
  controller.setGamepadInput('left', 0.5);
  controller.setTouchInput('up', true); controller.setTouchInput('boost', true);
  controller.cancelTouchInput();
  assert.equal(controller.keys.up, false); assert.equal(controller.keys.boost, false);
  assert.equal(controller.keys.hopPressed, false);
  assert.equal(controller.keys.resetPressed, true, 'keyboard edge survives');
  assert.equal(controller.keys.forward, true); assert.equal(controller.keys.left, 0.5);
  assert.equal(cancelled.forward, true, 'entity cancels trick intent with retained held-level history');
});

test('the retired helicopter keys (Q, C, E) no longer drive anything', () => {
  const { controller, key } = keyboardHarness();
  for (const code of ['KeyQ', 'KeyC', 'KeyE']) key('keydown', code);
  assert.equal(Object.values(controller.keys).some(Boolean), false);
});

// The EUC entity is stubbed: its controller owns motion, so a teleport only has to find a clear spot and placeAt() it.
function teleportHarness(colliders = [], shore = () => ({ westX: -500, eastX: 500 }), options = {}) {
  const harness = keyboardHarness({
    ISLAND_BOUNDS: { minX: -500, maxX: 500, minZ: -500, maxZ: 500, sidewalkHeight: 0.22 },
    CENTRAL_PARK_BOUNDS: { minX: 1000, maxX: 1100, minZ: 1000, maxZ: 1100 },
    getIslandBoundsAtZ: shore,
    blockAt: () => null
  });
  const { controller } = harness;
  const ent = {
    type: 'euc', position: { x: 400, y: 0, z: 400 }, heading: 1, speed: 20, placed: null, cleared: 0,
    placeAt(x, z, h, y, placementOptions) {
      this.placed = [x, z, h, y, placementOptions.requireClear];
      this.position.x = x;
      this.position.y = y;
      this.position.z = z;
      this.heading = h;
      this.speed = 0;
      return true;
    },
    clearInput() { this.cleared++; }
  };
  controller.activeMode = 'euc';
  controller.entities = { euc: ent };
  controller.colliders = colliders;
  controller._colliderCells = null;
  controller.eucSampler = new NycTerrainSampler({ boxes: boxesFromCityColliders(colliders), ...options });
  return { ...harness, ent };
}

test('a teleport clears held input and places the rider through the entity (the controller stays the authority)', () => {
  const { controller, ent, key } = teleportHarness();
  key('keydown', 'KeyW');
  key('keydown', 'Space');
  controller.setTouchInput('left', 0.8);
  const result = controller.teleportActiveTo(30, 20, 0.7);
  assert.deepEqual({ ...result }, { x: 30, z: 20, succeeded: true }, 'an open destination is kept exactly');
  assert.deepEqual(ent.placed, [30, 20, 0.7, controller.findTeleportPosition(30, 20, 0.7).y, true]);
  assert.equal(Object.values(controller.keys).some(Boolean), false);
  assert.equal(controller._pressedCodes.size, 0);
  assert.ok(ent.cleared > 0, 'the entity drops its buffered hop');
});

test('teleport checks real support and every overlapping static solid instead of a sequential push trap', () => {
  const colliders = [
    { minX: 0, maxX: 10, minZ: 0, maxZ: 10, maxY: 200 },
    { minX: 9, maxX: 20, minZ: 0, maxZ: 10, maxY: 201 }
  ];
  // Reverse order as well: a valid arrival must not rely on collider traversal order.
  for (const list of [colliders, colliders.slice().reverse()]) {
    const { controller } = teleportHarness(list.map((c) => ({ ...c })));
    const result = controller.teleportActiveTo(9.1, 5, 0);
    assert.equal(result.succeeded, true);
    assert.ok(result.x !== 9.1 || result.z !== 5, 'a click inside overlapping building bodies is refused');
    assert.ok(controller.eucSampler.findPlacementTarget({ x: result.x, z: result.z, headingY: 0, registeredSurfaceOnly: true }));
  }
});

test('teleports use oriented building footprints without rejecting clear corners of their bounds', () => {
  const cs = Math.SQRT1_2;
  const box = { minX: -8, maxX: 8, minZ: -8, maxZ: 8, maxY: 200, obb: { cx: 0, cz: 0, hx: 8, hz: 2, cs, sn: cs } };
  const { controller } = teleportHarness([{ ...box }]);
  assert.deepEqual({ ...controller.teleportActiveTo(7, 7, 0.6) }, { x: 7, z: 7, succeeded: true });
  const actual = controller.teleportActiveTo(0, 0, 0.6);
  assert.equal(actual.succeeded, true);
  assert.ok(actual.x !== 0 || actual.z !== 0, 'the unregistered building cap is not a map destination');
  assert.ok(controller.entities.euc.position.y < 1);
});

test('real Midtown building drawing exceeds its 26 m collider cap: manager refuses the cap and accepts an explicitly registered roof', (t) => {
  const records = buildingRecords({ THREE, config, GEO, mergeSolidParts }, [1242]);
  const { controller, ent } = teleportHarness(records.colliders);
  const facades = records.buckets.flat();
  const drawn = facades.find(p => p.y - p.h / 2 < 26 && p.y + p.h / 2 > 30 && p.w > 4 && p.d > 4
    && controller.eucSampler.findPlacementTarget({ x: p.x, z: p.z })?.y === 26);
  assert.ok(drawn, 'production block actually has a tall rendered part with a fully supported 26 m collision cap');
  const { x, z } = drawn;
  const roof = facades.filter(p => Math.abs(p.x - x) <= p.w / 2 - 1 && Math.abs(p.z - z) <= p.d / 2 - 1)
    .sort((a, b) => b.y + b.h / 2 - (a.y + a.h / 2))[0];
  const y = roof.y + roof.h / 2;
  assert.ok(y > 26);
  assert.equal(controller.eucSampler.findPlacementTarget({ x, z, registeredSurfaceOnly: true }), null);
  assert.equal(controller.teleportActiveTo(x, z).succeeded, true);
  assert.ok(ent.position.x !== x || ent.position.z !== z, 'manager finds an outside arrival instead of standing inside the drawing');
  assert.ok(ent.position.y < 1);
  const top = { minX: roof.x - roof.w / 2, maxX: roof.x + roof.w / 2, minZ: roof.z - roof.d / 2,
    maxZ: roof.z + roof.d / 2, top: y, surface: 'pavement', layered: true };
  top.poly = [{ x: top.minX, z: top.minZ }, { x: top.maxX, z: top.minZ },
    { x: top.maxX, z: top.maxZ }, { x: top.minX, z: top.maxZ }];
  const registered = teleportHarness(records.colliders, undefined, { boxes: boxesFromCityColliders(records.colliders), tops: [top] });
  assert.deepEqual({ ...registered.controller.teleportActiveTo(x, z) }, { x, z, succeeded: true });
  assert.equal(registered.ent.position.y, y, 'only explicit registration authorizes this drawn roof');
  t.diagnostic(`Real block 1242: drawn roof ${y} m, collider cap 26 m, click (${x}, ${z})`);
});

test('production Pier 15 registered deck path retains lower and upper map arrivals', () => {
  const pier = pier15DeckRecords(config);
  const { controller, ent } = teleportHarness([], config.getIslandBoundsAtZ, pier);
  for (const referenceY of [pier.lower, pier.upper, Infinity]) {
    assert.deepEqual({ ...controller.teleportActiveTo(pier.x, pier.z, 0, referenceY) }, { x: pier.x, z: pier.z, succeeded: true });
    assert.equal(ent.position.y, referenceY === pier.lower ? pier.lower : pier.upper);
  }
});

test('arrivals respect the shoreline limits', () => {
  const shore = (z) => ({ westX: -40 + z * 0.05, eastX: 40 + z * 0.05 });
  const { controller } = teleportHarness([], shore);
  assert.deepEqual({ ...controller.teleportActiveTo(1000, -1000) }, { x: 8.5, z: -470, succeeded: true });
});

test('failed or invalid teleports keep the current position with a bounded search', () => {
  const { controller, ent } = teleportHarness([], undefined, { boxes: [{ centre: { x: 0, y: 1, z: 0 },
    halfExtents: { x: 300, y: 1, z: 300 }, rotationY: 0, surface: 'pavement', support: false }] });
  let checks = 0;
  const find = controller.eucSampler.findPlacementTarget.bind(controller.eucSampler);
  controller.eucSampler.findPlacementTarget = (...args) => { checks++; return find(...args); };
  assert.deepEqual({ ...controller.teleportActiveTo(0, 0) }, { x: 400, z: 400, succeeded: false });
  assert.ok(checks <= 2049, 'the search must be bounded even inside an enormous obstacle');
  assert.equal(ent.placed, null, 'nothing is placed when no arrival fits');
  assert.deepEqual({ ...controller.teleportActiveTo(NaN, Infinity) }, { x: 400, z: 400, succeeded: false });
  assert.equal(ent.cleared, 0, 'failed search does not reset presentation/input');
});

test('a refused entity placement reports failure and leaves the existing pose and input alone', () => {
  const { controller, ent, key } = teleportHarness();
  ent.placeAt = () => false;
  key('keydown', 'KeyW');
  assert.deepEqual({ ...controller.teleportActiveTo(30, 20) }, { x: 400, z: 400, succeeded: false });
  assert.equal(controller.keys.forward, true);
  assert.equal(ent.cleared, 0);
});

test('manager keeps explicit lower/upper floors and passes the actual selected support height to placement', () => {
  const deck = { minX: -10, maxX: 10, minZ: -10, maxZ: 10,
    poly: [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }],
    top: 6, surface: 'wood', layered: true };
  const { controller, ent } = teleportHarness([], undefined, { tops: [deck] });
  for (const referenceY of [0, 6, Infinity]) {
    const expected = referenceY === 0 ? 0 : 6;
    assert.equal(controller.teleportActiveTo(2, 0, 0, referenceY).succeeded, true);
    assert.equal(ent.position.y, expected);
  }
});

test('manager searches out of a pond on the lower floor but preserves a dry bridge at map/upper elevation', () => {
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10,
    poly: [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }] };
  const pond = { ...bounds, top: 1, surface: 'stone', water: { level: 1, floor: 0.88, band: 0 } };
  const deck = { ...bounds, top: 6, surface: 'wood', layered: true };
  const { controller, ent } = teleportHarness([], undefined, { tops: [pond, deck] });
  assert.equal(controller.teleportActiveTo(2, 0, 0, 0.9).succeeded, true);
  assert.ok(ent.position.x !== 2 || ent.position.z !== 0);
  assert.equal(controller.eucSampler.isWater(ent.position.x, ent.position.z, ent.position.y), false);
  for (const y of [6, Infinity]) {
    assert.deepEqual({ ...controller.teleportActiveTo(2, 0, 0, y) }, { x: 2, z: 0, succeeded: true });
    assert.equal(ent.position.y, 6);
  }
});
