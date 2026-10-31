const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { loadModule } = require('./helpers/module.cjs');

function harness() {
  const pad = { connected: true, mapping: 'standard', index: 0, id: 'QA', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const keys = {}, look = [], actions = [];
  const controller = { clearGamepadInput() { for (const k of Object.keys(keys)) keys[k] = 0; },
    setGamepadInput(k, v) { keys[k] = v; } };
  function events(target = {}) {
    const listeners = new Map();
    target.addEventListener = (type, fn) => listeners.set(type, [...listeners.get(type) || [], fn]);
    target.fire = (type) => { for (const fn of listeners.get(type) || []) fn(); };
    return target;
  }
  const window = events(), document = events({ hidden: false, focused: true, activeElement: null,
    hasFocus() { return this.focused; } });
  let pads = [pad];
  const source = readFileSync(require.resolve('../js/gamepad-controls.js'), 'utf8');
  const { GamepadControls } = loadModule(source, {
    globals: { window, document, navigator: { getGamepads: () => pads } },
    imports: { './city-config.js': { isTypingInField: ({ target }) => ['INPUT', 'SELECT'].includes(target?.tagName) } }
  });
  const input = new GamepadControls(controller, { resetOrbit() { actions.push('recenter'); },
    applyGamepadInput(...args) { look.push(args); } }, {
    onToggleMap() { actions.push('map'); }, onCloseMap() { actions.push('close'); },
    onCycleCamera() { actions.push('camera'); }, onCycleRider() { actions.push('rider'); }
  });
  input.update(1 / 60); // discover a neutral pad
  return { pad, keys, look, actions, input, controller, window, document,
    pads(value) { pads = value; }, tick: () => input.update(1 / 60) };
}

test('a partly held analog trigger cannot accelerate across a modal/reset until released', () => {
  const h = harness();
  h.pad.buttons[7] = { pressed: false, value: 0.35 };
  h.tick();
  assert.equal(h.keys.forward, 0.35);
  h.input.setEnabled(false); h.input.setEnabled(true);
  h.tick();
  assert.equal(h.keys.forward, 0, 'button press threshold must not bypass analog suppression');
  h.pad.buttons[7].value = 0; h.tick();
  h.pad.buttons[7].value = 0.35; h.tick();
  assert.equal(h.keys.forward, 0.35, 'a fresh squeeze rides');
});

test('held movement/look sticks need neutral after reset; fresh input works normally', () => {
  const h = harness();
  h.pad.axes = [0, -0.7, 0.6, 0]; h.tick();
  assert.ok(h.keys.forward > 0);
  h.input.reset(); h.tick();
  assert.equal(h.keys.forward, 0);
  assert.equal(h.look.at(-1)[0], 0);
  h.pad.axes = [0, 0, 0, 0]; h.tick();
  h.pad.axes = [0, -0.7, 0.6, 0]; h.tick();
  assert.ok(h.keys.forward > 0);
  assert.ok(h.look.at(-1)[0] > 0);
});

const gates = {
  input: (h, on) => { h.document.activeElement = on ? { tagName: 'INPUT' } : null; },
  select: (h, on) => { h.document.activeElement = on ? { tagName: 'SELECT' } : null; },
  textarea: (h, on) => { h.document.activeElement = on ? { tagName: 'TEXTAREA' } : null; },
  editable: (h, on) => { h.document.activeElement = on ? { isContentEditable: true } : null; },
  blur: (h, on) => { h.document.focused = !on; h.window.fire(on ? 'blur' : 'focus'); },
  unfocused: (h, on) => { h.document.focused = !on; }, // hasFocus guards even if a blur event was missed
  hidden: (h, on) => { h.document.hidden = on; h.document.fire('visibilitychange'); },
  'hidden without event': (h, on) => { h.document.hidden = on; },
  disabled: (h, on) => { h.input.setEnabled(!on); },
  'manager gate': (h, on) => { h.controller.inputEnabled = !on; }
};

for (const [name, gate] of Object.entries(gates)) {
  test(`${name}: sticks and partial triggers moved while blocked require independent neutral before riding/look`, () => {
    const h = harness();
    gate(h, true);
    h.tick(); // neutral when focus/modal was first entered
    h.pad.axes = [0.7, -0.6, 0.6, -0.5];
    h.pad.buttons[6].value = 0.25;
    h.pad.buttons[7].value = 0.35; // neither trigger crosses the pressed-button threshold
    h.pad.buttons[0] = { pressed: true, value: 1 };
    h.tick();
    assert.equal(Object.values(h.keys).some(Boolean), false);
    assert.equal(h.look.length, 1, 'no look callback while blocked');
    assert.deepEqual(h.actions, []);
    gate(h, false);
    for (let i = 0; i < 2; i++) {
      h.tick();
      assert.equal(Object.values(h.keys).some(Boolean), false, 'holds cannot leak across the gate');
      assert.deepEqual(h.look.at(-1), [0, 0, 0, 1 / 60]);
    }
    // Only the left stick has returned to neutral. Other channels must remain suppressed.
    h.pad.axes[0] = h.pad.axes[1] = 0; h.tick();
    h.pad.axes[0] = 0.7; h.tick();
    assert.ok(h.keys.right > 0, 'fresh left-stick movement works');
    assert.equal(h.keys.forward, 0);
    assert.equal(h.keys.backward, 0);
    assert.equal(h.look.at(-1)[0], 0, 'right stick still needs its own neutral');
    h.pad.axes = [0, 0, 0, 0];
    h.pad.buttons[6].value = h.pad.buttons[7].value = 0;
    h.pad.buttons[0] = { pressed: false, value: 0 };
    h.tick();
    h.pad.axes = [0, 0, 0.6, -0.5];
    h.pad.buttons[7].value = 0.35; h.tick();
    assert.equal(h.keys.forward, 0.35);
    assert.ok(h.look.at(-1)[0] > 0);
    assert.ok(h.look.at(-1)[1] < 0);
    h.pad.buttons[7].value = 0;
    h.pad.buttons[6].value = 0.25; h.tick();
    assert.equal(h.keys.backward, 0.25);
    h.pad.buttons[0] = { pressed: true, value: 1 }; h.tick();
    assert.equal(h.keys.up, 1, 'fresh digital input works too');
  });
}

test('neutral observed during typing arms channels, but moving again before leaving typing suppresses them again', () => {
  const h = harness();
  gates.input(h, true);
  h.pad.axes[1] = -0.8; h.pad.buttons[7].value = 0.35; h.tick();
  h.pad.axes[1] = 0; h.pad.buttons[7].value = 0; h.tick();
  h.pad.axes[1] = -0.8; h.pad.buttons[7].value = 0.35; h.tick();
  gates.input(h, false); h.tick();
  assert.equal(h.keys.forward, 0);
  gates.input(h, true);
  h.pad.axes[1] = 0; h.pad.buttons[7].value = 0; h.tick();
  gates.input(h, false); h.tick();
  h.pad.buttons[7].value = 0.35; h.tick();
  assert.equal(h.keys.forward, 0.35, 'neutral while blocked is enough when it stays neutral until release');
});

test('map controls retain fresh Start/B edges while riding is disabled', () => {
  const h = harness();
  h.input.setEnabled(false);
  h.pad.buttons[9] = { pressed: true, value: 1 }; h.tick(); h.tick();
  assert.deepEqual(h.actions, ['map']);
  h.pad.buttons[1] = { pressed: true, value: 1 }; h.tick(); h.tick();
  assert.deepEqual(h.actions, ['map', 'close']);
  assert.equal(Object.values(h.keys).some(Boolean), false);
});
