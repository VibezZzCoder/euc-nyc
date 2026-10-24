// EUC Thrills-style touch controls (js/touch-controls.js): floating stick, HOP / CHARGE, GET UP while down.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/touch-controls.js'), 'utf8');
const INPUT = { touchStickTravelPx: 84, touchStickDeadZonePx: 5, touchStickCurve: 1.35 };

function element(dataset = {}) {
  const listeners = new Map();
  const classes = new Set();
  const captures = new Set();
  const styles = new Map();
  const el = {
    hidden: false,
    dataset: { ...dataset },
    children: [],
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }
    },
    style: { setProperty: (name, value) => styles.set(name, value), getPropertyValue: (name) => styles.get(name) },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, options = {}) {
      const event = { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 600, target: el,
        preventDefault() {}, stopPropagation() {}, ...options };
      for (const listener of listeners.get(type) || []) listener(event);
    },
    closest(selector) { return selector === '[data-touch]' && this.dataset.touch ? this : null; },
    contains(other) { return other === el || el.children.includes(other); },
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id)
  };
  return el;
}

function harness({ coarse = true, width = 400 } = {}) {
  const window = { ...element(), innerWidth: width };
  const document = { ...element(), body: element(), hidden: false };
  const media = { ...element(), matches: coarse };
  window.matchMedia = () => media;
  const root = element();
  const stick = element({ active: 'false' });
  const zone = element({ touch: 'stick' });
  const buttons = Object.fromEntries(['up', 'boost', 'reset'].map((action) => [action, element({ touch: action })]));
  root.children.push(zone, ...Object.values(buttons));
  document.getElementById = (id) => ({ 'touch-controls': root, 'touch-stick': stick })[id];
  const input = Object.fromEntries(['forward', 'backward', 'left', 'right', 'up', 'boost', 'reset'].map((a) => [a, 0]));
  const controller = {
    setTouchInput(action, value) { input[action] = value; },
    clearTouchInput() { for (const action of Object.keys(input)) input[action] = 0; }
  };
  const mod = loadModule(source, { imports: { './euc/data/tuning.js': { INPUT } }, globals: { window, document, Element: Object } });
  const controls = new mod.TouchControls(controller);
  // pointerdown is delegated on the root; the event target is the control touched
  const down = (target, options = {}) => root.dispatch('pointerdown', { target, ...options });
  const move = (options = {}) => window.dispatch('pointermove', options);
  const up = (options = {}) => window.dispatch('pointerup', options);
  return { mod, controls, window, document, media, root, stick, zone, buttons, input, down, move, up };
}

function near(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `${actual} should be close to ${expected}`);
}

test('axis maths matches EUC Thrills: 5 px dead zone, 1.35 curve, full at 84 px, sign kept', () => {
  const { mod } = harness();
  const { axisFromDisplacement } = mod;
  assert.equal(axisFromDisplacement(5), 0);
  assert.equal(axisFromDisplacement(-4), 0);
  assert.equal(axisFromDisplacement(84), 1);
  assert.equal(axisFromDisplacement(200), 1);
  near(axisFromDisplacement(44.5), Math.pow(0.5, 1.35));
  near(axisFromDisplacement(-44.5), -Math.pow(0.5, 1.35));
  assert.equal(axisFromDisplacement(NaN), 0);
});

test('the stick floats: it starts where the finger lands, up leans forward, down brakes, sideways carves', () => {
  const { zone, stick, root, input, down, move, up } = harness();
  down(zone, { clientX: 120, clientY: 600 });
  assert.equal(stick.dataset.active, 'true');
  assert.equal(root.style.getPropertyValue('--touch-x'), '120');
  assert.equal(input.forward, 0, 'touching down alone does nothing');
  move({ clientX: 120, clientY: 600 - 84 });
  assert.equal(input.forward, 1);
  assert.equal(input.backward, 0);
  move({ clientX: 120 + 84, clientY: 600 + 84 });
  assert.equal(input.backward, 1);
  assert.equal(input.forward, 0);
  assert.equal(input.right, 1);
  move({ clientX: 120 - 44.5, clientY: 600 });
  near(input.left, Math.pow(0.5, 1.35));
  assert.equal(input.right, 0);
  up({ pointerId: 1 });
  assert.equal(stick.dataset.active, 'false');
  for (const a of ['forward', 'backward', 'left', 'right']) assert.equal(input[a], 0, a);
});

test('near the screen edge full steering stays reachable', () => {
  const { zone, input, down, move } = harness({ width: 400 });
  down(zone, { clientX: 30, clientY: 600 });
  move({ clientX: 0, clientY: 600 });
  assert.equal(input.left, 1, 'only 30 px of room to the left: 30 px is full lock');
});

test('a mouse in the stick zone does nothing; a second finger cannot steal the stick', () => {
  const { zone, input, down, move } = harness();
  down(zone, { pointerType: 'mouse', clientY: 600 });
  move({ clientY: 500 });
  assert.equal(input.forward, 0);
  down(zone, { pointerId: 1, clientY: 600 });
  down(zone, { pointerId: 2, clientY: 300 });
  move({ pointerId: 2, clientY: 100 });
  assert.equal(input.forward, 0, 'the second finger is ignored');
  move({ pointerId: 1, clientY: 500 });
  assert.equal(input.forward, 1);
});

test('HOP and CHARGE are held per finger and release by pointer id, wherever the finger ends up', () => {
  const { zone, buttons, input, down, move, up, window } = harness();
  down(zone, { pointerId: 1, clientY: 600 });
  move({ pointerId: 1, clientY: 500 });
  down(buttons.boost, { pointerId: 2 });
  down(buttons.up, { pointerId: 3 });
  assert.equal(input.boost, 1);
  assert.equal(input.up, 1);
  assert.equal(buttons.boost.dataset.pressed, 'true');
  down(buttons.boost, { pointerId: 4 });
  up({ pointerId: 4 });
  assert.equal(input.boost, 1, 'a second finger on a held button neither takes nor releases it');
  up({ pointerId: 2 });
  assert.equal(input.boost, 0);
  assert.equal(buttons.boost.dataset.pressed, 'false');
  assert.equal(input.up, 1);
  assert.equal(input.forward, 1, 'the stick is untouched');
  window.dispatch('pointercancel', { pointerId: 3 });
  assert.equal(input.up, 0);
});

test('GET UP shows only while down, and getting up releases a finger still on it', () => {
  const { controls, root, buttons, input, down } = harness();
  assert.equal(root.dataset.down, undefined);
  controls.setDown(true);
  assert.equal(root.dataset.down, 'true');
  down(buttons.reset, { pointerId: 5 });
  assert.equal(input.reset, 1);
  controls.setDown(false);
  assert.equal(root.dataset.down, 'false');
  assert.equal(input.reset, 0);
});

test('disabling clears held input and blocks new input until enabled', () => {
  const { controls, root, zone, buttons, input, down, move } = harness();
  down(zone, { clientY: 600 });
  move({ clientY: 500 });
  down(buttons.boost, { pointerId: 2 });
  controls.setEnabled(false);
  assert.equal(root.hidden, true);
  assert.equal(Object.values(input).some(Boolean), false);
  down(buttons.boost, { pointerId: 3 });
  assert.equal(input.boost, 0);
  controls.setEnabled(true);
  assert.equal(root.hidden, false);
  down(buttons.boost, { pointerId: 3 });
  assert.equal(input.boost, 1);
});

for (const interruption of ['blur', 'hidden', 'resize']) {
  test(`${interruption} resets every held control`, () => {
    const { window, document, zone, buttons, input, down, move } = harness();
    down(zone, { clientY: 600 });
    move({ clientY: 500 });
    down(buttons.up, { pointerId: 2 });
    if (interruption === 'hidden') {
      document.hidden = true;
      document.dispatch('visibilitychange');
    } else {
      window.dispatch(interruption);
    }
    assert.equal(Object.values(input).some(Boolean), false);
  });
}

test('desktop controls stay hidden until a coarse pointer or a first touch', () => {
  const { document, media, root, zone, input, down, move } = harness({ coarse: false });
  assert.equal(root.hidden, true);
  assert.equal(document.body.classList.contains('touch-enabled'), false);
  media.matches = true;
  media.dispatch('change');
  assert.equal(root.hidden, false);
  down(zone, { clientY: 600 });
  move({ clientY: 500 });
  media.matches = false;
  media.dispatch('change');
  assert.equal(root.hidden, true);
  assert.equal(input.forward, 0, 'losing availability clears active controls');
  document.dispatch('pointerdown', { pointerType: 'mouse' });
  assert.equal(root.hidden, true);
  document.dispatch('pointerdown', { pointerType: 'touch' });
  assert.equal(root.hidden, false);
  assert.equal(document.body.classList.contains('touch-enabled'), true);
});

test('availability callback runs after visibility updates and only on an actual change', () => {
  const { controls, document, media, root } = harness({ coarse: false });
  const changes = [];
  controls.onAvailabilityChange = (available) => {
    changes.push(available);
    assert.equal(document.body.classList.contains('touch-enabled'), available);
    assert.equal(root.hidden, !available);
  };
  media.dispatch('change');
  assert.deepEqual(changes, []);
  media.matches = true;
  media.dispatch('change');
  media.dispatch('change');
  assert.deepEqual(changes, [true]);
  media.matches = false;
  media.dispatch('change');
  document.dispatch('pointerdown', { pointerType: 'touch' });
  document.dispatch('pointerdown', { pointerType: 'touch' });
  assert.deepEqual(changes, [true, false, true]);
});
