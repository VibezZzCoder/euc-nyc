const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');

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
    key(type, code, tagName = 'BODY') {
      window.dispatch(type, { code, target: { tagName } });
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

    // A fresh use of the alias must not revive the old key whose keyup was lost.
    key('keydown', 'ArrowUp');
    key('keyup', 'ArrowUp');
    assert.equal(controller.keys.forward, false);
  });
}

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
  controller.entities = { euc: { update: (_dt, keys) => seen.push({ up: keys.up, reset: keys.reset, forward: keys.forward }) } };
  controller.setTouchInput('reset', 1);
  controller.setTouchInput('reset', 0); // tapped and lifted between two frames
  key('keydown', 'Space');
  key('keyup', 'Space');
  key('keydown', 'KeyW');
  key('keyup', 'KeyW'); // levels are not latched: a lost W tap stays lost
  controller.update(1 / 60);
  controller.update(1 / 60);
  assert.deepEqual(seen[0], { up: true, reset: true, forward: false });
  assert.deepEqual(seen[1], { up: false, reset: false, forward: false }, 'only for that one frame');
  assert.equal(controller.keys.up, false, 'the live key state is untouched');
});

test('the retired helicopter keys (Q, C, E) no longer drive anything', () => {
  const { controller, key } = keyboardHarness();
  for (const code of ['KeyQ', 'KeyC', 'KeyE']) key('keydown', code);
  assert.equal(Object.values(controller.keys).some(Boolean), false);
});

// The EUC entity is stubbed: its controller owns motion, so a teleport only has to find a clear spot and placeAt() it.
function teleportHarness(colliders = [], shore = () => ({ westX: -500, eastX: 500 })) {
  const harness = keyboardHarness({
    ISLAND_BOUNDS: { minX: -500, maxX: 500, minZ: -500, maxZ: 500, sidewalkHeight: 0.22 },
    CENTRAL_PARK_BOUNDS: { minX: 1000, maxX: 1100, minZ: 1000, maxZ: 1100 },
    getIslandBoundsAtZ: shore,
    blockAt: () => null
  });
  const { controller } = harness;
  const ent = {
    type: 'euc', position: { x: 400, y: 0, z: 400 }, heading: 1, speed: 20, placed: null, cleared: 0,
    placeAt(x, z, h) {
      this.placed = [x, z, h];
      this.position.x = x;
      this.position.z = z;
      this.heading = h;
      this.speed = 0;
    },
    clearInput() { this.cleared++; }
  };
  controller.activeMode = 'euc';
  controller.entities = { euc: ent };
  controller.colliders = colliders;
  controller._colliderCells = null;
  // The ground comes from the EUC terrain sampler (euc-terrain.js, tested on its own): flat road here
  controller.eucSampler = { cityGround: (_x, _z, out) => { out.height = 0; return out; } };
  return { ...harness, ent };
}

// Is a rider footprint (0.48 m + 0.1 m margin) at (x, z) clear of every collider, oriented ones in their own frame?
function clearOf(colliders, x, z) {
  const ext = 0.58;
  return colliders.every((c) => {
    if (x + ext <= c.minX || x - ext >= c.maxX || z + ext <= c.minZ || z - ext >= c.maxZ) return true;
    if (!c.obb) return false;
    const o = c.obb, dx = x - o.cx, dz = z - o.cz;
    return Math.abs(dx * o.cs - dz * o.sn) >= o.hx + ext || Math.abs(dx * o.sn + dz * o.cs) >= o.hz + ext;
  });
}

test('a teleport clears held input and places the rider through the entity (the controller stays the authority)', () => {
  const { controller, ent, key } = teleportHarness();
  key('keydown', 'KeyW');
  key('keydown', 'Space');
  controller.setTouchInput('left', 0.8);
  const result = controller.teleportActiveTo(30, 20, 0.7);
  assert.deepEqual({ ...result }, { x: 30, z: 20 }, 'an open destination is kept exactly');
  assert.deepEqual(ent.placed, [30, 20, 0.7]);
  assert.equal(Object.values(controller.keys).some(Boolean), false);
  assert.equal(controller._pressedCodes.size, 0);
  assert.ok(ent.cleared > 0, 'the entity drops its buffered hop');
});

test('teleport checks all overlapping buildings instead of leaving a sequential push trap', () => {
  const colliders = [
    { minX: 0, maxX: 10, minZ: 0, maxZ: 10, maxY: 200 },
    { minX: 9, maxX: 20, minZ: 0, maxZ: 10, maxY: 200 }
  ];
  // Reverse order as well: a valid arrival must not rely on collider traversal order.
  for (const list of [colliders, colliders.slice().reverse()]) {
    const { controller } = teleportHarness(list.map((c) => ({ ...c })));
    const result = controller.teleportActiveTo(11, 5, 0);
    assert.notDeepEqual({ ...result }, { x: 11, z: 5 });
    assert.ok(clearOf(colliders, result.x, result.z), `arrival ${result.x}, ${result.z} must be clear`);
  }
});

test('teleports use oriented building footprints without rejecting clear corners of their bounds', () => {
  const cs = Math.SQRT1_2;
  const box = { minX: -8, maxX: 8, minZ: -8, maxZ: 8, maxY: 200, obb: { cx: 0, cz: 0, hx: 8, hz: 2, cs, sn: cs } };
  const { controller } = teleportHarness([{ ...box }]);
  assert.deepEqual({ ...controller.teleportActiveTo(7, 7, 0.6) }, { x: 7, z: 7 });
  const actual = controller.teleportActiveTo(0, 0, 0.6);
  assert.ok(clearOf([box], actual.x, actual.z));
});

test('arrivals respect the shoreline limits', () => {
  const shore = (z) => ({ westX: -40 + z * 0.05, eastX: 40 + z * 0.05 });
  const { controller } = teleportHarness([], shore);
  assert.deepEqual({ ...controller.teleportActiveTo(1000, -1000) }, { x: 8.5, z: -470 });
});

test('failed or invalid teleports keep the current position with a bounded search', () => {
  const { controller, ent } = teleportHarness([{ minX: -300, maxX: 300, minZ: -300, maxZ: 300, maxY: 500 }]);
  let checks = 0;
  const near = controller.nearColliders;
  controller.nearColliders = function (...args) { checks++; return near.apply(this, args); };
  assert.deepEqual({ ...controller.teleportActiveTo(0, 0) }, { x: 400, z: 400 });
  assert.ok(checks <= 2049, 'the search must be bounded even inside an enormous obstacle');
  assert.equal(ent.placed, null, 'nothing is placed when no arrival fits');
  assert.deepEqual({ ...controller.teleportActiveTo(NaN, Infinity) }, { x: 400, z: 400 });
});
