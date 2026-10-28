const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

// Small DOM/pad fixture: exercise the real modal and riding input classes without loading the city/GPU.
// Native browser Tab order, Enter/Space synthesis and touch clicks still need bounded browser verification.
function harness() {
  function events(target = {}) {
    const listeners = new Map();
    target.addEventListener = (type, fn) => listeners.set(type, [...listeners.get(type) || [], fn]);
    target.fire = (type, e = {}) => {
      Object.assign(e, { type, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.stopped = true; } });
      for (const fn of listeners.get(type) || []) { fn(e); if (e.stopped) break; }
      return e;
    };
    return target;
  }
  const document = events({ hidden: false, focused: true, hasFocus() { return this.focused; },
    body: { classList: { add() {}, remove() {} } } });
  function node() {
    return events({ disabled: false, dataset: {}, textContent: '', children: [],
      focus() { document.activeElement = this; },
      click() { if (!this.disabled) this.fire('click'); },
      append(child) { this.children.push(child); } });
  }
  const selectors = ['#booking-heading', '.booking-heading', '#booking-skip', '#booking-release', '.booking-pad-hint',
    '#booking-note', '.booking-subtitle', '#booking-line', '#booking-reply', '#booking-stamp', '#booking-rider', '#booking-number'];
  const nodes = Object.fromEntries(selectors.map((s) => [s, node()]));
  const outside = node();
  outside.focus();
  const root = events({ dataset: {}, open: false, querySelector: (s) => nodes[s], prepend() {},
    showModal() { this.open = true; nodes['#booking-skip'].focus(); },
    close() { this.open = false; outside.focus(); } });
  const window = events();
  const pad = { connected: true, mapping: 'standard', index: 0, id: 'booking QA', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  let pads = [pad], attempts = 0, safe = true;
  const context = vm.createContext({ window, document, navigator: { getGamepads: () => pads } });
  const bookingSource = readFileSync(require.resolve('../js/booking.js'), 'utf8').replace(/export /g, '');
  vm.runInContext(`${bookingSource}\nglobalThis.BookingScreen = BookingScreen;`, context);
  const gamepadSource = readFileSync(require.resolve('../js/gamepad-controls.js'), 'utf8')
    .replace(/import \{ isTypingInField \} from '[^']+';/, 'const isTypingInField = () => false;')
    .replace('export { GamepadControls };', 'globalThis.GamepadControls = GamepadControls;');
  vm.runInContext(gamepadSource, context);
  const keys = {}, looks = [], actions = [];
  const riding = new context.GamepadControls({
    clearGamepadInput() { for (const key of Object.keys(keys)) keys[key] = 0; },
    setGamepadInput(key, value) { keys[key] = value; },
  }, { resetOrbit() {}, applyGamepadInput(...args) { looks.push(args); } }, {
    onToggleMap() { actions.push('map'); }, onCycleCamera() { actions.push('camera'); },
    onCycleRider() { actions.push('rider'); },
  });
  const state = { phase: 'idle', age: 0, number: 1, rider: 'Cool Rider' };
  const screen = new context.BookingScreen({ root, onRelease() {
    attempts++;
    if (!safe) return false;
    state.phase = 'idle';
    riding.setEnabled(true); // main.js resets riding inputs before closing the modal
    screen.update(state);
    return true;
  } });
  const tick = () => screen.phase === 'idle' ? riding.update(1 / 60) : screen.updateGamepad();
  tick();
  return { screen, root, document, window, pad, keys, looks, actions, nodes, tick,
    get attempts() { return attempts; },
    set safe(value) { safe = value; },
    pads(value) { pads = value; },
    button(index, pressed, value = Number(pressed)) { pad.buttons[index] = { pressed, value }; },
    phase(phase) {
      if (screen.phase === 'idle' && phase !== 'idle') riding.setEnabled(false);
      state.phase = phase;
      screen.update(state);
    },
    key(code, type = 'keydown', repeat = false) { return window.fire(type, { code, repeat }); },
  };
}

test('capture focuses a non-action; riding keys, Enter, Space and Escape cannot skip', () => {
  const h = harness();
  h.phase('captured');
  assert.equal(h.document.activeElement, h.nodes['#booking-heading']);
  assert.equal(h.nodes['#booking-heading'].tabIndex, -1);
  assert.equal(h.root.open, true);
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyR', 'KeyN', 'Enter', 'NumpadEnter', 'Space', 'Escape']) {
    for (const type of ['keydown', 'keyup']) {
      const e = h.key(code, type);
      assert.equal(e.defaultPrevented, true, `${code} ${type}`);
      assert.equal(e.stopped, true, 'riding listeners must not receive modal keys');
    }
  }
  assert.equal(h.root.fire('cancel').defaultPrevented, true);
  assert.equal(h.attempts, 0);
  assert.equal(h.root.open, true);
});

test('Tab stays native; only fresh Enter/Space on an explicitly focused action allow native activation', () => {
  for (const code of ['Enter', 'NumpadEnter', 'Space']) {
    const h = harness();
    h.phase('captured');
    const tab = h.key('Tab');
    assert.equal(tab.defaultPrevented, false);
    assert.equal(tab.stopped, false);
    h.nodes['#booking-skip'].focus(); // native Tab traversal is browser QA
    assert.equal(h.key(code).defaultPrevented, false, `${code} down permits the native button action`);
    assert.equal(h.key(code, 'keydown', true).defaultPrevented, true, 'no repeat activation');
    assert.equal(h.key(code, 'keyup').defaultPrevented, false);
    assert.equal(h.attempts, 0, 'key handler must not synthesize a second release beside the native click');
    h.nodes['#booking-skip'].click(); // the permitted native button click
    assert.equal(h.attempts, 1);
    assert.equal(h.root.open, false);
  }
});

test('keys held at capture or before button focus need release and a fresh press', () => {
  for (const code of ['Space', 'Enter', 'NumpadEnter']) {
    const h = harness();
    h.key(code); // riding/title input already down before capture
    h.phase('captured');
    h.nodes['#booking-skip'].focus();
    assert.equal(h.key(code, 'keydown', true).defaultPrevented, true);
    assert.equal(h.key(code, 'keydown').defaultPrevented, true, 'duplicate non-repeat is not an edge');
    assert.equal(h.key(code, 'keyup').defaultPrevented, true, 'leftover Space up must not click Skip');
    assert.equal(h.key(code).defaultPrevented, false);
  }
  const h = harness();
  h.phase('captured');
  h.key('Space'); // started on the heading, not on Skip
  h.nodes['#booking-skip'].focus();
  assert.equal(h.key('Space', 'keyup').defaultPrevented, true);
  assert.equal(h.key('Escape').defaultPrevented, true, 'even a focused Skip has no Escape shortcut');
  assert.equal(h.attempts, 0);
});

test('click/assistive activation uses the button; refused placement retains UI and allows explicit retry', () => {
  const h = harness();
  h.phase('intake');
  h.nodes['#booking-release'].click();
  assert.equal(h.attempts, 0, 'disabled release cannot dispatch early');
  h.safe = false;
  h.nodes['#booking-skip'].focus();
  h.nodes['#booking-skip'].click();
  assert.equal(h.attempts, 1);
  assert.equal(h.root.open, true);
  assert.equal(h.screen.phase, 'intake');
  assert.match(h.nodes['#booking-note'].textContent, /clearing the exit/i);
  assert.equal(h.document.activeElement, h.nodes['#booking-skip']);
  h.safe = true;
  h.nodes['#booking-skip'].click();
  assert.equal(h.attempts, 2);
  assert.equal(h.root.open, false);
});

test('timed release focuses its native action without inheriting a held key or global confirmation', () => {
  const h = harness();
  h.phase('signature');
  h.nodes['#booking-skip'].focus();
  h.key('Space');
  h.phase('released');
  assert.equal(h.document.activeElement, h.nodes['#booking-release']);
  assert.equal(h.nodes['#booking-release'].disabled, false);
  assert.equal(h.key('Space', 'keyup').defaultPrevented, true, 'no key-up from the previous phase');
  assert.equal(h.key('Enter').defaultPrevented, false);
  h.key('Enter', 'keyup');
  h.nodes['#booking-heading'].focus();
  assert.equal(h.key('Enter').defaultPrevented, true, 'released is not a global Enter shortcut');
  h.nodes['#booking-release'].click();
  assert.equal(h.attempts, 1);
});

test('held keyboard input stays blocked on exit until key-up, then riding receives fresh input', () => {
  const h = harness();
  h.key('KeyW');
  h.phase('captured');
  h.key('Space');
  h.nodes['#booking-skip'].click();
  for (const code of ['KeyW', 'Space']) {
    assert.equal(h.key(code, 'keydown', true).defaultPrevented, true);
    assert.equal(h.key(code, 'keyup').stopped, true);
    assert.equal(h.key(code).stopped, false);
  }
});

function loseFocus(h, kind) {
  if (kind === 'blur') { h.document.focused = false; h.window.fire('blur'); }
  else { h.document.hidden = true; h.document.fire('visibilitychange'); }
}

function regainFocus(h, kind) {
  if (kind === 'blur') { h.document.focused = true; h.window.fire('focus'); }
  else { h.document.hidden = false; h.document.fire('visibilitychange'); }
}

test('blur/visibility with key-up outside accepts the next genuine focused confirmation immediately', () => {
  for (const kind of ['blur', 'visibility']) {
    for (const code of ['Space', 'Enter', 'NumpadEnter']) {
      const h = harness();
      h.phase('intake'); h.nodes['#booking-skip'].focus();
      assert.equal(h.key(code).defaultPrevented, false);
      loseFocus(h, kind);
      // The physical key is released outside the page: no key-up is delivered here.
      regainFocus(h, kind);
      assert.equal(h.root.open, true);
      assert.equal(h.screen.phase, 'intake');
      assert.equal(h.attempts, 0, 'focus restoration is not a release action');
      assert.equal(h.key(code).defaultPrevented, false, `${kind}: fresh ${code} must work first time`);
      assert.equal(h.key(code, 'keyup').defaultPrevented, false);
      h.nodes['#booking-skip'].click();
      assert.equal(h.attempts, 1);
    }
  }
});

test('refocus discards activation tokens: repeated confirms and orphan key-ups cannot activate Skip', () => {
  for (const kind of ['blur', 'visibility']) {
    const h = harness();
    h.phase('signature'); h.nodes['#booking-skip'].focus();
    h.key('Space');
    loseFocus(h, kind); regainFocus(h, kind);
    for (let i = 0; i < 2; i++) assert.equal(h.key('Space', 'keydown', true).defaultPrevented, true);
    assert.equal(h.key('Space', 'keyup').defaultPrevented, true, 'old Space-down token was discarded');
    assert.equal(h.attempts, 0);
    assert.equal(h.root.open, true);
    assert.equal(h.key('Space').defaultPrevented, false);
    assert.equal(h.key('Space', 'keyup').defaultPrevented, false);
  }
});

test('missing outside key-up cannot leave a stale riding-key block across booking release', () => {
  for (const kind of ['blur', 'visibility']) {
    for (const timing of ['during-booking', 'after-release']) {
      const h = harness();
      h.key('KeyW'); h.phase('captured');
      if (timing === 'during-booking') { loseFocus(h, kind); regainFocus(h, kind); }
      h.nodes['#booking-skip'].click();
      if (timing === 'after-release') { loseFocus(h, kind); regainFocus(h, kind); }
      assert.equal(h.key('KeyW').stopped, false, `${kind}/${timing}: first fresh riding press must pass`);
      assert.equal(h.key('KeyW', 'keydown', true).stopped, false, 'repeats of a genuine new riding press pass');
      assert.equal(h.key('KeyW', 'keyup').stopped, false);
    }
  }
});

test('orphan riding repeats/key-ups after refocus stay blocked until a genuine fresh press', () => {
  for (const kind of ['blur', 'visibility']) {
    const h = harness();
    h.key('KeyW'); h.phase('captured');
    loseFocus(h, kind); regainFocus(h, kind);
    h.key('KeyW', 'keydown', true);
    h.nodes['#booking-skip'].click();
    for (let i = 0; i < 2; i++) assert.equal(h.key('KeyW', 'keydown', true).stopped, true);
    assert.equal(h.key('KeyW', 'keyup').stopped, true);
    assert.equal(h.key('KeyW').stopped, false);
  }
});

test('pad B/Start/A do not skip from capture; D-pad selects visible Skip, fresh A activates', () => {
  const h = harness();
  h.phase('captured'); h.tick();
  for (const index of [0, 1, 9, 2, 3, 4, 5]) {
    h.button(index, true); h.tick();
    h.button(index, false); h.tick();
  }
  assert.equal(h.attempts, 0);
  h.button(13, true); h.tick();
  assert.equal(h.document.activeElement, h.nodes['#booking-skip']);
  assert.equal(h.root.dataset.padFocus, 'true');
  assert.match(h.nodes['.booking-pad-hint'].textContent, /D-pad.*A:/);
  for (const index of [1, 9]) {
    h.button(index, true); h.tick(); h.button(index, false); h.tick();
  }
  assert.equal(h.attempts, 0, 'B/Start cannot activate even a selected Skip');
  h.button(0, true); h.tick();
  assert.equal(h.attempts, 1);
  assert.equal(h.root.open, false);
  h.tick();
  assert.equal(h.keys.up, 0, 'confirm A must not become a hop on exit');
  h.button(0, false); h.button(13, false); h.tick();
  h.button(0, true); h.tick();
  assert.equal(h.keys.up, 1, 'fresh riding A works');
});

test('pad carryover, including partial triggers, requires neutral before navigation or confirmation', () => {
  for (const channel of ['A', 'B', 'Start', 'dpad', 'move', 'look', 'partial-trigger']) {
    const h = harness();
    if (channel === 'move') h.pad.axes[1] = -0.7;
    else if (channel === 'look') h.pad.axes[2] = 0.6;
    else h.button(({ A: 0, B: 1, Start: 9, dpad: 13, 'partial-trigger': 7 })[channel],
      channel !== 'partial-trigger', channel === 'partial-trigger' ? 0.35 : 1);
    h.phase('captured'); h.tick();
    h.button(13, true); h.button(0, true); h.tick(); h.tick();
    assert.equal(h.document.activeElement, h.nodes['#booking-heading'], channel);
    assert.equal(h.attempts, 0, channel);
    h.pad.axes.fill(0);
    for (let i = 0; i < 17; i++) h.button(i, false);
    h.tick();
    h.button(13, true); h.button(0, true); h.tick();
    assert.equal(h.document.activeElement, h.nodes['#booking-skip']);
    assert.equal(h.attempts, 0, 'same-sample navigation + A only selects');
    h.tick();
    assert.equal(h.attempts, 0, 'held A never confirms');
    h.button(0, false); h.tick(); h.button(0, true); h.tick();
    assert.equal(h.attempts, 1, channel);
  }
});

test('pad release/refused exit needs fresh A edges; analog and riding buttons require neutral on exit', () => {
  const h = harness();
  h.phase('signature'); h.tick();
  h.button(0, true); h.tick(); // no selected action
  h.phase('released'); h.tick();
  assert.equal(h.attempts, 0, 'held A across release does nothing');
  h.safe = false;
  h.button(0, false); h.tick(); h.button(0, true); h.tick(); h.tick();
  assert.equal(h.attempts, 1);
  assert.equal(h.root.open, true);
  h.safe = true; h.tick();
  assert.equal(h.attempts, 1, 'refused placement cannot auto-retry on held confirm');
  h.button(0, false); h.tick();
  h.pad.axes = [0.4, -0.4, 0.6, 0]; // riding input held below the UI navigation threshold
  h.button(7, false, 0.35); h.button(1, true); h.button(3, true); h.button(5, true); h.button(9, true);
  h.button(0, true); h.tick(); h.tick();
  assert.equal(h.attempts, 2);
  assert.equal(h.keys.forward, 0); assert.equal(h.keys.right, 0); assert.equal(h.keys.reset, 0);
  assert.equal(h.looks.at(-1)[0], 0);
  assert.deepEqual(h.actions, [], 'no held map/camera/rider edge on exit');
  h.pad.axes.fill(0);
  for (let i = 0; i < 17; i++) h.button(i, false);
  h.tick();
  h.button(7, false, 0.35); h.pad.axes[2] = 0.6; h.tick();
  assert.equal(h.keys.forward, 0.35);
  assert.ok(h.looks.at(-1)[0] > 0);
});

test('left-stick navigation needs neutral between selections, not jitter or held repeats', () => {
  const h = harness();
  h.phase('released'); h.tick();
  h.pad.axes[1] = -0.8; h.tick();
  assert.equal(h.document.activeElement, h.nodes['#booking-skip']);
  for (const value of [-0.8, -0.4, -0.8]) { h.pad.axes[1] = value; h.tick(); }
  assert.equal(h.document.activeElement, h.nodes['#booking-skip']);
  h.pad.axes[1] = 0; h.tick(); h.pad.axes[1] = -0.8; h.tick();
  assert.equal(h.document.activeElement, h.nodes['#booking-release']);
  assert.equal(h.attempts, 0);
});

test('another capture starts with safe focus and requires neutral even if the prior confirm is still held', () => {
  const h = harness();
  h.phase('captured'); h.tick(); h.button(13, true); h.tick();
  h.button(13, false); h.button(0, true); h.tick();
  assert.equal(h.attempts, 1);
  h.phase('captured'); h.tick(); h.tick();
  assert.equal(h.document.activeElement, h.nodes['#booking-heading']);
  assert.equal(h.root.open, true);
  assert.equal(h.attempts, 1);
  h.button(0, false); h.tick(); h.button(13, true); h.tick();
  h.button(13, false); h.button(0, true); h.tick();
  assert.equal(h.attempts, 2);
});

test('blur/hidden/disconnect/pad replacement rearm only after neutral; none synthesize a confirm', () => {
  for (const reset of ['blur', 'hidden', 'disconnect', 'replacement']) {
    const h = harness();
    h.phase('captured'); h.tick(); h.button(13, true); h.tick(); h.button(13, false); h.tick();
    if (reset === 'blur') { h.document.focused = false; h.window.fire('blur'); }
    if (reset === 'hidden') { h.document.hidden = true; h.document.fire('visibilitychange'); }
    if (reset === 'disconnect') h.pads([]);
    if (reset === 'replacement') h.pad.id = 'replacement';
    h.button(0, true); h.tick();
    h.document.focused = true; h.document.hidden = false; h.pads([h.pad]); h.tick(); h.tick();
    assert.equal(h.attempts, 0, reset);
    h.button(0, false); h.tick(); h.button(0, true); h.tick();
    assert.equal(h.attempts, 1, reset);
  }
});
