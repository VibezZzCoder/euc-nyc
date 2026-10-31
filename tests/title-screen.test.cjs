const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { loadModule } = require('./helpers/module.cjs');

// Execute the title and optional real input manager without constructing the city or renderer.
// Events model capture/bubble cancellation; native browser click synthesis itself is not simulated.
function harness({ coarse = false, reducedMotion = false, manager = false } = {}) {
  function events(target = {}) {
    const listeners = new Map();
    target.addEventListener = (type, fn, options) => {
      const capture = options === true || !!options?.capture;
      listeners.set(type, [...listeners.get(type) || [], { fn, capture }]);
    };
    target.fire = (type, options = {}) => {
      const event = { type, repeat: false, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.stopped = true; }, ...options };
      const handlers = listeners.get(type) || [];
      for (const { fn } of [...handlers.filter((h) => h.capture), ...handlers.filter((h) => !h.capture)]) {
        fn(event); if (event.stopped) break;
      }
      return event;
    };
    return target;
  }
  const window = events(), document = events({ hidden: false, focused: true, hasFocus() { return this.focused; } });
  function node(dataset = {}) {
    const attributes = new Map(), classes = new Set();
    return events({ dataset, hidden: true,
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name), toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
      setAttribute: (name, value) => attributes.set(name, value), getAttribute: (name) => attributes.get(name),
      focus() { document.activeElement = this; },
      blur() { if (document.activeElement === this) document.activeElement = null; }
    });
  }
  document.body = node();
  const ride = node(), riderButtons = [node({ titleRider: 'cool-rider' }), node({ titleRider: 'trollina' })];
  const root = node();
  root.querySelector = () => ride;
  root.querySelectorAll = () => riderButtons;
  root.contains = (el) => el === root || el === ride || riderButtons.includes(el);
  let pads = [], rejectPads = false, starts = 0, rider = 'cool-rider';
  const picks = [], timers = [], frames = [];
  const globals = { window, document, navigator: { getGamepads() {
    if (rejectPads) throw new Error('Permissions Policy');
    return pads;
  } }, matchMedia: (query) => ({ matches: query.includes('reduced-motion') ? reducedMotion : coarse }),
  requestAnimationFrame: (fn) => frames.push(fn), setTimeout: (fn, delay) => timers.push({ fn, delay }) };
  let controller;
  if (manager) {
    const { ThirdPersonControllerManager } = loadModule(readFileSync(require.resolve('../js/controllers.js'), 'utf8'), {
      globals, imports: { './city-config.js': { streetZ: () => 0, isTypingInField: () => false },
        './landmarks.js': {}, './euc-terrain.js': {}, './euc-rider.js': {} }
    });
    controller = Object.create(ThirdPersonControllerManager.prototype);
    controller.keys = { up: false };
    controller.inputEnabled = false;
    controller.bindKeyboard();
  }
  const { TitleScreen } = loadModule(readFileSync(require.resolve('../js/title-screen.js'), 'utf8'), { globals });
  const screen = new TitleScreen({ root, riders: riderButtons.map((btn) => btn.dataset.titleRider),
    getRider: () => rider, onRider(id) { rider = id; picks.push(id); screen.setRider(id); },
    onStart() { starts++; controller?.setInputEnabled(true); } });
  screen.show();
  return { screen, root, ride, riderButtons, window, document, picks, timers, frames, controller,
    get starts() { return starts; },
    pads(value) { pads = value; }, rejectPads(value) { rejectPads = value; },
    key(code, type = 'keydown', options = {}) { return window.fire(type, { code, target: document.activeElement, ...options }); },
    tick() { screen.update(); } };
}

function pad(index = 0, id = 'title QA', mapping = 'standard') {
  return { connected: true, mapping, index, id,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}

function button(pad, index, down, value = Number(down)) {
  pad.buttons[index] = { pressed: down, value };
}

test('Enter, NumpadEnter and Space select a focused rider instead of starting, without native duplicate activation', () => {
  for (const code of ['Enter', 'NumpadEnter', 'Space']) {
    const h = harness();
    h.riderButtons[1].focus();
    const event = h.key(code);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
    assert.deepEqual(h.picks, ['trollina']);
    assert.equal(h.riderButtons[1].getAttribute('aria-pressed'), 'true');
    h.key(code, 'keydown', { repeat: true }); h.key(code, 'keyup');
    assert.deepEqual(h.picks, ['trollina']);
    assert.equal(h.starts, 0);
    h.ride.focus(); h.key(code);
    assert.equal(h.starts, 1);
  }
});

test('title key capture blocks riding until Ride and the manager rejects held Space repeats afterwards', () => {
  const h = harness({ manager: true });
  h.key('KeyW');
  assert.equal(h.controller.keys.forward, undefined);
  h.key('Space');
  assert.equal(h.starts, 1);
  for (let i = 0; i < 3; i++) h.key('Space', 'keydown', { repeat: true });
  assert.equal(h.controller.keys.up, false, 'starting hold cannot hop');
  h.key('Space', 'keyup');
  h.key('Space');
  assert.equal(h.controller.keys.up, true, 'a fresh riding press works');
  assert.equal(h.starts, 1);
});

test('Tab and Enter on title links retain native navigation without leaking to riding', () => {
  const h = harness();
  assert.equal(h.key('Tab').defaultPrevented, false);
  for (const code of ['Enter', 'NumpadEnter']) {
    const event = h.key(code, 'keydown', { target: { closest: () => ({ href: 'https://example.com/' }) } });
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.stopped, true);
  }
  assert.equal(h.starts, 0);
});

for (const gate of ['blur', 'hidden', 'unfocused']) {
  for (const control of [0, 9, 4, 5, 14, 15]) {
    test(`${gate}: title pad ${control} cannot act in the background or carry a held press back`, () => {
      const h = harness(), p = pad();
      h.pads([p]); h.tick();
      if (gate === 'hidden') { h.document.hidden = true; h.document.fire('visibilitychange'); }
      else { h.document.focused = false; if (gate === 'blur') h.window.fire('blur'); }
      button(p, control, true); h.tick();
      assert.equal(h.starts, 0);
      assert.deepEqual(h.picks, []);
      if (gate === 'hidden') { h.document.hidden = false; h.document.fire('visibilitychange'); }
      else { h.document.focused = true; if (gate === 'blur') h.window.fire('focus'); }
      h.tick(); h.tick();
      assert.equal(h.starts, 0);
      assert.deepEqual(h.picks, []);
      button(p, control, false); h.tick();
      button(p, control, true); h.tick(); h.tick();
      if (control === 0 || control === 9) assert.equal(h.starts, 1);
      else assert.deepEqual(h.picks, ['trollina']);
    });
  }
}

test('focus/visibility boundaries synchronize held pads even if no polling happened while inactive', () => {
  for (const gate of ['blur', 'hidden']) {
    const h = harness(), p = pad();
    h.pads([p]); h.tick();
    if (gate === 'blur') h.window.fire('blur');
    else { h.document.hidden = true; h.document.fire('visibilitychange'); }
    button(p, 0, true); // no title.update() in the background
    if (gate === 'blur') h.window.fire('focus');
    else { h.document.hidden = false; h.document.fire('visibilitychange'); }
    h.tick();
    assert.equal(h.starts, 0);
    button(p, 0, false); h.tick(); button(p, 0, true); h.tick();
    assert.equal(h.starts, 1);
  }
});

test('title ignores nonstandard/disconnected pads and tolerates a missing or rejected API', () => {
  const h = harness(), unsupported = pad(0, 'unsupported', ''), disconnected = pad(1);
  disconnected.connected = false;
  h.pads([unsupported, null, disconnected]); h.tick();
  button(unsupported, 0, true); button(disconnected, 9, true); h.tick();
  assert.equal(h.starts, 0);
  assert.deepEqual(h.picks, []);
  h.pads(undefined); assert.doesNotThrow(() => h.tick());
  h.rejectPads(true); assert.doesNotThrow(() => h.tick());
  h.rejectPads(false);
  const standard = pad(2); h.pads([unsupported, standard]); h.tick();
  button(standard, 0, false, 0.75); h.tick();
  assert.equal(h.starts, 1, 'standard analog-valued buttons use the riding threshold');
});

test('replacing a pad in the same slot or moving its index synchronizes holds instead of inventing an edge', () => {
  for (const replacement of [pad(0, 'replacement'), pad(1)]) {
    const h = harness(), first = pad();
    h.pads([first]); h.tick();
    button(replacement, 0, true);
    h.pads([replacement]); h.tick();
    assert.equal(h.starts, 0);
    button(replacement, 0, false); h.tick(); button(replacement, 0, true); h.tick();
    assert.equal(h.starts, 1);
  }
});

test('pad ownership survives API reordering; disconnect and mapping changes discard stale edge history', () => {
  const h = harness(), first = pad(), other = pad(1, 'other');
  h.pads([first, other]); h.tick();
  button(other, 0, true); h.pads([other, first]); h.tick();
  assert.equal(h.starts, 0, 'the existing pad keeps ownership');
  h.pads([]); h.tick();
  h.pads([other]); h.tick();
  assert.equal(h.starts, 0, 'a newly discovered held pad is not a fresh press');
  other.mapping = ''; h.tick();
  other.mapping = 'standard'; h.tick();
  assert.equal(h.starts, 0);
  button(other, 0, false); h.tick(); button(other, 0, true); h.tick();
  assert.equal(h.starts, 1);
});

test('reduced motion hides the overlay immediately; ordinary motion retains the existing fade', () => {
  for (const reducedMotion of [true, false]) {
    const h = harness({ reducedMotion });
    h.frames.shift()();
    assert.equal(h.root.classList.contains('is-shown'), true);
    h.ride.fire('click');
    assert.equal(h.starts, 1);
    assert.equal(h.screen.isOpen, false);
    assert.equal(h.root.classList.contains('is-shown'), false);
    assert.equal(h.root.hidden, reducedMotion);
    assert.equal(h.timers.length, reducedMotion ? 0 : 1);
    if (!reducedMotion) { assert.equal(h.timers[0].delay, 500); h.timers[0].fn(); }
    assert.equal(h.root.hidden, true);
    h.ride.fire('click'); h.riderButtons[1].fire('click');
    assert.equal(h.starts, 1);
    assert.deepEqual(h.picks, [], 'retired title controls cannot change the rider');
  }
});

test('starting before the show animation frame cannot re-show a retired overlay', () => {
  const h = harness({ reducedMotion: true });
  h.screen.start(); h.frames.shift()();
  assert.equal(h.root.hidden, true);
  assert.equal(h.root.classList.contains('is-shown'), false);
  assert.equal(h.document.activeElement, null);
});
