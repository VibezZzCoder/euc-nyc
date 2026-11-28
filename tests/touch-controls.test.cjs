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
  const attributes = new Map();
  const el = {
    hidden: false,
    dataset: { ...dataset },
    tagName: dataset.touch && dataset.touch !== 'stick' ? 'BUTTON' : 'DIV',
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
      const event = { type, pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 600, target: el,
        defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...options };
      for (const listener of listeners.get(type) || []) listener(event);
      return event;
    },
    querySelectorAll(selector) { return selector === '[data-touch]' ? this.children.filter((el) => el.dataset.touch) : []; },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
    closest(selector) { return selector === '[data-touch]' && this.dataset.touch ? this : null; },
    contains(other) { return other === el || el.children.includes(other); },
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id)
  };
  return el;
}

function harness({ coarse = true, width = 400, manager = false } = {}) {
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
  const writes = [];
  let controller = {
    setTouchInput(action, value) { input[action] = value; writes.push([action, value]); },
    clearTouchInput() { for (const action of Object.keys(input)) input[action] = 0; }
  };
  const frames = [], cancellations = [];
  if (manager) {
    const { ThirdPersonControllerManager } = loadModule(readFileSync(join(__dirname, '../js/controllers.js'), 'utf8'), {
      globals: { window, document }, imports: {
        './city-config.js': { streetZ: () => 0, isTypingInField: () => false }, './landmarks.js': {},
        './euc-terrain.js': {}, './euc-rider.js': {}
      }
    });
    controller = Object.create(ThirdPersonControllerManager.prototype);
    controller.inputEnabled = true;
    controller.keys = Object.fromEntries(Object.keys(input).map((action) => [action, false]));
    controller.entities = { euc: { clearInput(held) { cancellations.push({ ...held }); },
      update(_dt, held) { frames.push({ ...held }); } } };
    controller.bindKeyboard();
  }
  const mod = loadModule(source, { imports: { './euc/data/tuning.js': { INPUT } }, globals: { window, document, Element: Object } });
  const controls = new mod.TouchControls(controller);
  // pointerdown is delegated on the root; the event target is the control touched
  const down = (target, options = {}) => root.dispatch('pointerdown', { target, ...options });
  const move = (options = {}) => window.dispatch('pointermove', options);
  const up = (options = {}) => window.dispatch('pointerup', options);
  const key = (target, code, type = 'keydown', options = {}) => {
    document.activeElement = target;
    const event = root.dispatch(type, { target, code, ...options });
    if (!event.stopped) window.dispatch(type, event);
    return event;
  };
  const click = (target, options = {}) => root.dispatch('click', { target, detail: 0, pointerType: '', ...options });
  return { mod, controls, controller, window, document, media, root, stick, zone, buttons, input,
    writes, frames, cancellations, down, move, up, key, click };
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

test('resize cancels pending touch presses and trick intent, retaining keyboard/gamepad levels and presses', () => {
  const h = harness({ manager: true });
  h.window.dispatch('keydown', { code: 'KeyW' });
  h.window.dispatch('keydown', { code: 'Space' });
  h.controller.setGamepadInput('right', 0.7);
  h.controller.setGamepadInput('boost', 1);
  h.controls.setDown(true);
  h.click(h.buttons.reset); // queued touch-only get-up
  h.down(h.buttons.up);
  h.window.dispatch('resize');
  assert.equal(h.controller.keys.forward, true);
  assert.equal(h.controller.keys.up, true);
  assert.equal(h.controller.keys.right, 0.7);
  assert.equal(h.controller.keys.boost, 1);
  assert.equal(h.controller.keys.hopPressed, true, 'the keyboard press is retained');
  assert.equal(h.controller.keys.resetPressed, false, 'the queued touch-only pulse is cancelled');
  assert.equal(h.cancellations.at(-1).up, true, 'trick cancellation receives the surviving held sources');
  assert.equal(h.cancellations.at(-1).boost, 1);
  h.controller.update(1 / 60);
  assert.equal(h.frames.at(-1).reset, false);
  h.up();
  assert.equal(h.controller.keys.up, true, 'the old finger cannot release the held Space key');
});

test('a subframe touch hop cannot survive a viewport reset', () => {
  const h = harness({ manager: true });
  h.click(h.buttons.up);
  assert.equal(h.controller.keys.hopPressed, true);
  h.controls.reset(); // also the host-size resize path
  h.controller.update(1 / 60);
  assert.equal(h.controller.keys.hopPressed, false);
  assert.equal(h.frames.at(-1).up, false);
  assert.ok(h.cancellations.length > 0, 'the rider trick cancellation path ran');
});

test('Enter, NumpadEnter and Space hold each native action without native clicks, repeats or global hop', () => {
  for (const code of ['Enter', 'NumpadEnter', 'Space']) {
    for (const action of ['up', 'boost', 'reset']) {
      const h = harness({ manager: true });
      h.controls.setDown(true);
      const target = h.buttons[action];
      const event = h.key(target, code);
      assert.equal(event.defaultPrevented, true, 'no browser Enter/Space click');
      assert.equal(event.stopped, true, 'no bubbling global binding');
      assert.equal(h.controller.keys[action], 1);
      if (action !== 'up') assert.equal(h.controller.keys.up, false, `${action} must not global-hop`);
      h.controller.update(1 / 60);
      h.key(target, code, 'keydown', { repeat: true });
      h.key(target, code); // even an incorrectly unflagged duplicate is not a fresh edge
      assert.equal(h.controller.keys.hopPressed, false);
      assert.equal(h.controller.keys.resetPressed, false);
      assert.equal(h.key(target, code, 'keyup').defaultPrevented, true);
      assert.equal(h.controller.keys[action], false);
      assert.equal(target.dataset.pressed, 'false');
    }
  }
});

test('assistive HOP/GET UP clicks are buffered pulses and physical clicks never add a second press', () => {
  for (const action of ['up', 'reset']) {
    const h = harness({ manager: true });
    h.controls.setDown(true);
    h.click(h.buttons[action]);
    h.controller.update(1 / 60);
    assert.equal(h.frames.at(-1)[action], true, 'subframe assistive pulse reaches one frame');
    h.controller.update(1 / 60);
    assert.equal(h.frames.at(-1)[action], false);
    for (const pointerType of ['touch', 'pen', 'mouse']) {
      h.down(h.buttons[action], { pointerType });
      h.up();
      h.controller.update(1 / 60);
      assert.equal(h.frames.at(-1)[action], true);
      h.click(h.buttons[action], { detail: 1, pointerType });
      h.click(h.buttons[action], { detail: 1 }); // legacy compatibility MouseEvent
      h.click(h.buttons[action], { detail: 0, pointerType });
      h.controller.update(1 / 60);
      assert.equal(h.frames.at(-1)[action], false, `${pointerType} tap must produce exactly one pulse`);
    }
  }
});

test('assistive CHARGE toggles accessibly, survives Tab, and releases with HOP without releasing other holds', () => {
  const h = harness();
  assert.equal(h.buttons.boost.getAttribute('aria-pressed'), 'false');
  h.click(h.buttons.boost);
  assert.equal(h.input.boost, 1);
  assert.equal(h.buttons.boost.getAttribute('aria-pressed'), 'true');
  h.root.dispatch('focusout', { target: h.buttons.boost, relatedTarget: h.buttons.up });
  h.key(h.buttons.up, 'Space');
  assert.equal(h.input.boost, 1, 'charge is retained through the hop hold');
  h.key(h.buttons.up, 'Space', 'keyup');
  assert.equal(h.input.boost, 0);
  assert.equal(h.buttons.boost.getAttribute('aria-pressed'), 'false');
  h.click(h.buttons.boost); h.click(h.buttons.boost);
  assert.equal(h.input.boost, 0, 'a second assistive activation toggles off');
  h.click(h.buttons.boost); h.click(h.buttons.up);
  assert.equal(h.input.boost, 0, 'a pulse hop also releases latched charge');
  h.down(h.buttons.boost, { pointerId: 2 });
  h.click(h.buttons.up);
  assert.equal(h.input.boost, 1, 'a physical charge hold survives a separate hop');
  h.up({ pointerId: 2 });
  assert.equal(h.input.boost, 0);
});

test('physical CHARGE takes over a toggle and its compatibility click cannot latch it again', () => {
  const h = harness();
  h.click(h.buttons.boost);
  h.down(h.buttons.boost);
  h.up();
  h.click(h.buttons.boost, { detail: 1, pointerType: 'touch' });
  assert.equal(h.input.boost, 0);
  assert.equal(h.buttons.boost.getAttribute('aria-pressed'), 'false');
  h.click(h.buttons.boost);
  h.key(h.buttons.boost, 'Enter');
  h.key(h.buttons.boost, 'Enter', 'keyup');
  assert.equal(h.input.boost, 0, 'a keyboard hold also takes over and releases the toggle');
});

test('multiple held sources on one button release independently, and focus loss clears only the keyboard owner', () => {
  const h = harness();
  h.down(h.buttons.boost);
  h.key(h.buttons.boost, 'Enter');
  h.key(h.buttons.boost, 'Space');
  h.up();
  assert.equal(h.input.boost, 1);
  h.key(h.buttons.boost, 'Space', 'keyup');
  assert.equal(h.input.boost, 1);
  h.root.dispatch('focusout', { target: h.buttons.boost });
  assert.equal(h.input.boost, 0);
  h.key(h.buttons.boost, 'Enter', 'keydown', { repeat: true });
  h.key(h.buttons.boost, 'Enter', 'keyup');
  assert.equal(h.input.boost, 0, 'orphan repeats and releases do not reactivate');
});

test('all input gates block keyboard/assistive buttons; GET UP cannot activate while not down', () => {
  for (const gate of ['manager', 'disabled', 'hidden', 'unavailable']) {
    const h = harness({ coarse: gate !== 'unavailable' });
    if (gate === 'manager') h.controller.inputEnabled = false;
    if (gate === 'disabled') h.controls.setEnabled(false);
    if (gate === 'hidden') h.document.hidden = true;
    h.key(h.buttons.up, 'Space');
    h.click(h.buttons.up); h.click(h.buttons.boost);
    assert.equal(Object.values(h.input).some(Boolean), false, gate);
    assert.equal(h.buttons.boost.getAttribute('aria-pressed'), 'false');
  }
  const h = harness();
  h.click(h.buttons.reset);
  h.key(h.buttons.reset, 'Space');
  assert.equal(h.input.reset, 0);
  h.controls.setDown(true);
  h.key(h.buttons.reset, 'Space');
  assert.equal(h.input.reset, 1);
  h.controls.setDown(false);
  assert.equal(h.input.reset, 0, 'getting up releases the keyboard owner too');
});

test('interruptions clear assistive toggles and held keyboard buttons without reactivation from stale releases', () => {
  for (const interruption of ['blur', 'resize', 'hidden', 'disable']) {
    const h = harness();
    h.click(h.buttons.boost);
    h.key(h.buttons.up, 'Enter');
    if (interruption === 'hidden') { h.document.hidden = true; h.document.dispatch('visibilitychange'); }
    else if (interruption === 'disable') h.controls.setEnabled(false);
    else h.window.dispatch(interruption);
    assert.equal(h.input.up, 0);
    assert.equal(h.input.boost, 0);
    assert.equal(h.buttons.boost.getAttribute('aria-pressed'), 'false');
    h.document.hidden = false; h.controls.setEnabled(true);
    h.key(h.buttons.up, 'Enter', 'keydown', { repeat: true });
    h.key(h.buttons.up, 'Enter', 'keyup');
    assert.equal(h.input.up, 0);
    h.key(h.buttons.up, 'Enter');
    assert.equal(h.input.up, 1, 'a genuinely fresh press works immediately');
  }
});

// Second-thumb taps on HUD buttons (bindHeldFingerTaps): phone browsers send no click for them.
function heldTapHarness() {
  const { mod } = harness();
  const on = {};
  let clock = 0;
  const doc = { activeElement: null, under: null, addEventListener: (type, listener) => { on[type] = listener; },
    elementFromPoint() { return this.under; } };
  // where: 'hud' (riding HUD), 'popover' (Teleport / camera lists), 'menu' (the game menu <dialog>), 'map' (the full
  // map section), 'booking' (the booking <dialog>), 'touch' (touch controls), 'none' (anywhere else)
  const inside = { hud: ['.hud'], popover: ['.popover'], menu: ['#game-menu', 'dialog'], map: ['#fullmap-modal'],
    booking: ['#booking-overlay', 'dialog'], touch: ['#touch-controls'], none: [] };
  const matches = (where, selector) => selector.split(',').some((part) => inside[where].includes(part.trim()));
  const button = (where = 'hud', name = 'button') => {
    const b = { nodeType: 1, name, disabled: false, clicks: 0, popoverOpen: false, target: null, focusedAtClick: null,
      click() { this.clicks++; this.focusedAtClick = doc.activeElement === this; if (this.target) this.popoverOpen = !this.popoverOpen; },
      isConnected: true, getClientRects: () => [{}], contains: (node) => node === b,
      focus() { doc.activeElement = this; on.focusin?.({ target: this }); },
      blur() { if (doc.activeElement === this) doc.activeElement = null; },
      closest(selector) { return selector === 'button' ? b : matches(where, selector) ? {} : null; } };
    return b;
  };
  const surface = (where) => ({ nodeType: 1, closest: (selector) => (selector === 'button' ? null : matches(where, selector) ? {} : null) });
  const ev = (pointerId, target, clientX, clientY, pointerType = 'touch') => ({ pointerId, target, clientX, clientY, pointerType });
  const canvas = { nodeType: 1, closest: () => null };
  const taps = mod.bindHeldFingerTaps(doc, { now: () => clock });
  let stopped = 0;
  const click = (clientX, clientY, isTrusted = true) => ({ isTrusted, clientX, clientY,
    preventDefault() { stopped++; }, stopImmediatePropagation() {} });
  return { on, doc, button, surface, ev, canvas, taps, click, stops: () => stopped, at: (t) => { clock = t; }, time: () => clock };
}

test('a second finger\'s tap on a HUD button acts on release, once; an only finger is left to the browser', () => {
  const { on, doc, button, ev, canvas, taps, click, stops, at } = heldTapHarness();
  const menu = button('hud', 'menu');
  doc.under = menu;
  // an only finger: nothing synthesized (the browser's own click acts)
  on.pointerdown(ev(1, menu, 350, 30)); on.pointerup(ev(1, menu, 351, 31));
  assert.equal(menu.clicks, 0);
  // a thumb on the stick, then the other thumb taps Menu
  on.pointerdown(ev(2, canvas, 100, 600)); on.pointerdown(ev(3, menu, 350, 30)); on.pointerup(ev(3, menu, 352, 31));
  assert.equal(menu.clicks, 1);
  assert.equal(doc.activeElement, null, 'the tapped button does not keep the focus (Space hops)');
  // the browser's own click for that release, if it comes, is dropped once; a later click is not
  at(30); on.click(click(352, 31)); assert.equal(stops(), 1);
  on.click(click(352, 31)); assert.equal(stops(), 1);
  // the stick thumb lifts first, then the button finger: still a held-finger tap
  on.pointerdown(ev(4, menu, 350, 30)); on.pointerup(ev(2, canvas, 100, 600)); on.pointerup(ev(4, menu, 350, 30));
  assert.equal(menu.clicks, 2);
  // the button finger went down first and the stick thumb joined during the press
  on.pointerdown(ev(5, menu, 350, 30)); on.pointerdown(ev(6, canvas, 90, 610)); on.pointerup(ev(5, menu, 350, 30));
  assert.equal(menu.clicks, 3);
  at(900); on.click(click(350, 30)); assert.equal(stops(), 1, 'a click long after is a new, intended one');
  on.pointerup(ev(6, canvas, 90, 610));
  // a mouse or a pen with a finger down: left to the browser
  on.pointerdown(ev(7, canvas, 100, 600));
  on.pointerdown(ev(8, menu, 350, 30, 'mouse')); on.pointerup(ev(8, menu, 350, 30, 'mouse'));
  on.pointerdown(ev(9, menu, 350, 30, 'pen')); on.pointerup(ev(9, menu, 350, 30, 'pen'));
  assert.equal(menu.clicks, 3);
  // cancelled, dragged off its button, released over another place: nothing
  on.pointerdown(ev(10, menu, 350, 30)); on.pointercancel(ev(10, menu, 350, 30));
  on.pointerdown(ev(11, menu, 350, 30)); on.pointerup(ev(11, menu, 390, 30));
  on.pointerdown(ev(12, menu, 350, 30)); doc.under = canvas; on.pointerup(ev(12, menu, 351, 30)); doc.under = menu;
  assert.equal(menu.clicks, 3);
  on.pointerup(ev(7, canvas, 100, 600));
  // after a reset (blur, rotation, page hide) a lone tap is single again
  on.pointerdown(ev(13, canvas, 100, 600)); taps.reset();
  on.pointerdown(ev(14, menu, 350, 30)); on.pointerup(ev(14, menu, 350, 30));
  assert.equal(menu.clicks, 3);
});

test('held-finger taps: a quick new tap acts, a resting finger, a long press and a drag away and back do not', () => {
  const { on, doc, button, ev, canvas, taps, click, stops, at, time } = heldTapHarness();
  const map = button('hud', 'map'), sound = button('hud', 'sound');
  at(1000); doc.under = map;
  on.pointerdown(ev(20, canvas, 100, 600)); on.pointerdown(ev(21, map, 350, 30)); on.pointerup(ev(21, map, 350, 30));
  assert.equal(map.clicks, 1);
  // two quick taps on one button while steering act twice
  at(1150); on.pointerdown(ev(22, map, 351, 31)); on.pointerup(ev(22, map, 351, 31));
  assert.equal(map.clicks, 2, 'a second held tap straight after is its own tap');
  // a new lone contact straight after an activated tap keeps its own browser click
  on.pointerup(ev(20, canvas, 100, 600)); at(1246);
  on.pointerdown(ev(23, map, 352, 31)); on.pointerup(ev(23, map, 352, 31)); on.click(click(352, 31));
  assert.equal(stops(), 0, 'not an echo: a new finger went down');
  // a finger resting on Sound while Map is tapped does not press Sound when it lifts
  taps.reset(); at(3000);
  on.pointerdown(ev(30, sound, 200, 100)); on.pointerdown(ev(31, map, 350, 30)); doc.under = map; on.pointerup(ev(31, map, 350, 30));
  doc.under = sound; on.pointerup(ev(30, sound, 200, 100));
  assert.equal(map.clicks, 3); assert.equal(sound.clicks, 0, 'the resting finger presses nothing');
  // a long-press menu, a long hold
  taps.reset(); on.pointerdown(ev(32, canvas, 100, 600));
  on.pointerdown(ev(33, sound, 200, 100)); on.contextmenu({ pointerId: 33, target: sound }); on.pointerup(ev(33, sound, 200, 100));
  // the stick finger's own context menu (raised when it lifts mid-tap) does not disarm the button press
  on.pointerdown(ev(38, sound, 200, 100)); on.contextmenu({ pointerId: 32, target: canvas }); on.pointerup(ev(32, canvas, 100, 600));
  on.pointerup(ev(38, sound, 200, 100));
  assert.equal(sound.clicks, 1, 'the stick lifting first still lets the tap act');
  on.pointerdown(ev(39, canvas, 100, 600));
  on.pointerdown(ev(34, sound, 200, 100)); at(time() + 1500); on.pointerup(ev(34, sound, 200, 100));
  assert.equal(sound.clicks, 1, 'a long press is not a tap');
  // a press dragged away and back (coalesced points included) is not a tap; a small wobble is
  on.pointerdown(ev(35, sound, 200, 100)); on.pointermove(ev(35, sound, 100, 134)); on.pointermove(ev(35, sound, 200, 100));
  on.pointerup(ev(35, sound, 200, 100));
  on.pointerdown(ev(36, sound, 200, 100));
  on.pointermove({ ...ev(36, sound, 201, 100), getCoalescedEvents: () => [ev(36, sound, 240, 100), ev(36, sound, 201, 100)] });
  on.pointerup(ev(36, sound, 201, 100));
  assert.equal(sound.clicks, 1, 'merged moves still show the finger left');
  on.pointerdown(ev(37, sound, 200, 100)); on.pointermove(ev(37, sound, 203, 102)); on.pointerup(ev(37, sound, 203, 102));
  assert.equal(sound.clicks, 2, 'a small wobble still is a tap');
});

test('held-finger taps: popovers, the game menu and the map act; booking, touch controls and the rest do not', () => {
  const { on, doc, button, ev, canvas } = heldTapHarness();
  const teleport = button('hud', 'teleport'); teleport.target = 'teleport-popover';
  on.pointerdown(ev(1, canvas, 100, 600));
  doc.under = teleport; on.pointerdown(ev(2, teleport, 300, 40)); on.pointerup(ev(2, teleport, 300, 40));
  assert.equal(teleport.clicks, 1); assert.equal(teleport.popoverOpen, true, 'click() runs the popover activation');
  assert.equal(doc.activeElement, null, 'a HUD button ends unfocused, as after a native tap (main blurs it)');
  let id = 3;
  for (const where of ['popover', 'menu', 'map']) {
    const b = button(where, where); doc.under = b; on.pointerdown(ev(id, b, 200, 200)); on.pointerup(ev(id++, b, 200, 200));
    assert.equal(b.clicks, 1, `${where} button acts`);
    assert.equal(b.focusedAtClick, true, `${where} button is focused before its click, as a native tap does`);
    assert.equal(doc.activeElement === b, where === 'menu', `${where}: focus afterwards matches a native tap`);
  }
  for (const where of ['booking', 'touch', 'none']) {
    const b = button(where, where); doc.under = b; on.pointerdown(ev(id, b, 200, 200)); on.pointerup(ev(id++, b, 200, 200));
    assert.equal(b.clicks, 0, `${where} keeps its own handling`);
  }
  const off = button('menu', 'off'); off.disabled = true; doc.under = off;
  on.pointerdown(ev(id, off, 10, 10)); on.pointerup(ev(id++, off, 10, 10));
  assert.equal(off.clicks, 0, 'a disabled button (a preparing picker) is not pressed');
});

test('held-finger taps: a menu opened under a held finger, Resume, and the next tap on the HUD', () => {
  const { on, doc, button, surface, ev, canvas, click, stops, at } = heldTapHarness();
  const menu = button('hud', 'menu'), resume = button('menu', 'resume'), entry = button('menu', 'rider entry');
  const sound = button('hud', 'sound'), close = button('map', 'close');
  // stick held, second thumb taps Menu, then Resume with the stick still down
  on.pointerdown(ev(1, canvas, 100, 600));
  doc.under = menu; on.pointerdown(ev(2, menu, 244, 765)); on.pointerup(ev(2, menu, 244, 765));
  at(150); doc.under = resume; on.pointerdown(ev(3, resume, 195, 540)); on.pointerup(ev(3, resume, 195, 540));
  assert.equal(menu.clicks, 1); assert.equal(resume.clicks, 1, 'Resume acts while the stick thumb stays down');
  // the stick thumb lifts over whatever is there now: it landed on the canvas, so it presses nothing
  doc.under = sound; on.pointerup(ev(1, canvas, 100, 600)); assert.equal(sound.clicks, 0);
  // the next genuine lone tap on the HUD keeps its own click (not swallowed as an echo)
  at(260); on.pointerdown(ev(4, sound, 300, 40)); on.pointerup(ev(4, sound, 300, 40)); on.click(click(300, 40));
  assert.equal(stops(), 0); assert.equal(sound.clicks, 0, 'a lone tap is the browser\'s own click');
  // a finger already on a HUD button when the menu opened over it presses no menu button when it lifts
  on.pointerdown(ev(5, canvas, 100, 600)); doc.under = sound; on.pointerdown(ev(6, sound, 195, 540));
  doc.under = resume; on.pointerup(ev(6, sound, 195, 540));
  assert.equal(resume.clicks, 1); assert.equal(sound.clicks, 0);
  // picker entry and the map Close with the stick down
  doc.under = entry; on.pointerdown(ev(7, entry, 100, 300)); on.pointerup(ev(7, entry, 100, 300));
  doc.under = close; on.pointerdown(ev(8, close, 360, 30)); on.pointerup(ev(8, close, 360, 30));
  assert.equal(entry.clicks, 1); assert.equal(close.clicks, 1);
  // a drag on the map's own surface (pan, pinch) disarms a finger resting on a map button
  const zoom = button('map', 'zoom'), chart = surface('map');
  on.pointerdown(ev(9, zoom, 360, 400)); on.pointerdown(ev(10, chart, 200, 400)); on.pointermove(ev(10, chart, 240, 420));
  doc.under = zoom; on.pointerup(ev(9, zoom, 360, 400)); assert.equal(zoom.clicks, 0, 'a map gesture cancels the tap');
  // while the stick thumb (outside the map) wiggles, a map button still acts
  on.pointerup(ev(10, chart, 240, 420)); on.pointermove(ev(5, canvas, 130, 640));
  on.pointerdown(ev(11, zoom, 360, 400)); on.pointerup(ev(11, zoom, 360, 400)); assert.equal(zoom.clicks, 1);
});

test('held-finger taps: a pan or pinch on the map owns the gesture until it lifts; a resting or stick finger does not', () => {
  const { on, doc, button, surface, ev, canvas } = heldTapHarness();
  const result = button('map', 'result'), zoom = button('map', 'zoom'), chart = surface('map');
  // the critic's sequence: the pan starts, a finger lands on the result, the pan goes on, the result finger lifts first
  on.pointerdown(ev(1, chart, 200, 400)); on.pointermove(ev(1, chart, 225, 400));
  doc.under = result; on.pointerdown(ev(2, result, 200, 100)); on.pointermove(ev(1, chart, 250, 400));
  on.pointerup(ev(2, result, 200, 100)); on.pointerup(ev(1, chart, 250, 400));
  assert.equal(result.clicks, 0, 'a press landing during a pan never acts');
  // the same with Zoom in
  on.pointerdown(ev(3, chart, 200, 400)); on.pointermove(ev(3, chart, 225, 400));
  doc.under = zoom; on.pointerdown(ev(4, zoom, 360, 400)); on.pointerup(ev(4, zoom, 360, 400)); on.pointerup(ev(3, chart, 225, 400));
  assert.equal(zoom.clicks, 0);
  // result first, then the pan starts; and the pan lifting first, then the result finger
  on.pointerdown(ev(5, result, 200, 100)); on.pointerdown(ev(6, chart, 200, 400)); on.pointermove(ev(6, chart, 240, 400));
  on.pointerup(ev(6, chart, 240, 400)); doc.under = result; on.pointerup(ev(5, result, 200, 100));
  assert.equal(result.clicks, 0, 'a press that overlapped a moving surface finger is void');
  // a voided surface finger (another tap taken first) that pans afterwards still owns the gesture
  on.pointerdown(ev(7, chart, 200, 400)); on.pointerdown(ev(8, zoom, 360, 400)); doc.under = zoom; on.pointerup(ev(8, zoom, 360, 400));
  assert.equal(zoom.clicks, 1); on.pointermove(ev(7, chart, 240, 400));
  doc.under = result; on.pointerdown(ev(9, result, 200, 100)); on.pointerup(ev(9, result, 200, 100)); on.pointerup(ev(7, chart, 240, 400));
  assert.equal(result.clicks, 0);
  // a finger resting on the chart (not moved) is just another finger: the result acts
  on.pointerdown(ev(10, chart, 200, 400)); doc.under = result; on.pointerdown(ev(11, result, 200, 100)); on.pointerup(ev(11, result, 200, 100));
  on.pointerup(ev(10, chart, 200, 400)); assert.equal(result.clicks, 1);
  // the stick thumb (touch controls, outside the surface) moves by design: HUD and menu taps still act
  const menu = button('hud', 'menu'), resume = button('menu', 'resume');
  on.pointerdown(ev(12, canvas, 100, 600)); on.pointermove(ev(12, canvas, 100, 560));
  doc.under = menu; on.pointerdown(ev(13, menu, 244, 765)); on.pointermove(ev(12, canvas, 130, 540)); on.pointerup(ev(13, menu, 244, 765));
  doc.under = resume; on.pointerdown(ev(14, resume, 195, 540)); on.pointerup(ev(14, resume, 195, 540));
  assert.equal(menu.clicks, 1); assert.equal(resume.clicks, 1);
});

test('held-finger taps: a resting finger cannot take the focus (the picker highlight) back from the tapped button', () => {
  const { on, doc, button, ev } = heldTapHarness();
  const cool = button('menu', 'cool-rider'), red = button('menu', 'red-rider');
  // Chromium, when the tapping finger lifts, focuses the resting finger's element and raises its long-press menu
  const chromiumLongPress = (b, id) => { b.focus(); on.contextmenu({ pointerId: id, target: b }); };
  on.pointerdown(ev(1, cool, 100, 300)); doc.under = red; on.pointerdown(ev(2, red, 100, 400)); on.pointerup(ev(2, red, 100, 400));
  assert.equal(red.clicks, 1); assert.equal(doc.activeElement, red);
  chromiumLongPress(cool, 1); assert.equal(doc.activeElement, red, 'focus goes back to the tapped entry');
  doc.under = cool; on.pointerup(ev(1, cool, 100, 300)); assert.equal(cool.clicks, 0); assert.equal(doc.activeElement, red);
  // a lone long press keeps today's behaviour: the pressed entry takes focus (and the highlight)
  on.pointerdown(ev(3, cool, 100, 300)); chromiumLongPress(cool, 3); on.pointerup(ev(3, cool, 100, 300));
  assert.equal(doc.activeElement, cool);
  // a HUD tap ends unfocused; a resting finger's long-press focus on another HUD button is dropped too
  const sound = button('hud', 'sound'), cam = button('hud', 'cam');
  on.pointerdown(ev(4, sound, 200, 100)); doc.under = cam; on.pointerdown(ev(5, cam, 300, 40)); on.pointerup(ev(5, cam, 300, 40));
  assert.equal(doc.activeElement, null); chromiumLongPress(sound, 4); assert.equal(doc.activeElement, null);
  on.pointerup(ev(4, sound, 200, 100)); assert.equal(sound.clicks, 0);
});

test('main binds the held-finger taps once and resets them on blur, resize and page hide', () => {
  const main = readFileSync(join(__dirname, '../js/main.js'), 'utf8');
  assert.equal(main.split('bindHeldFingerTaps(document)').length, 2);
  assert.match(main, /for \(const type of \['blur', 'resize', 'pagehide'\]\) window\.addEventListener\(type, \(\) => heldTaps\.reset\(\)\);/);
});
