const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function harness() {
  const pad = { connected: true, mapping: 'standard', index: 0, id: 'QA', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const keys = {}, look = [];
  const controller = { clearGamepadInput() { for (const k of Object.keys(keys)) keys[k] = 0; },
    setGamepadInput(k, v) { keys[k] = v; } };
  const context = vm.createContext({ window: { addEventListener() {} },
    document: { hidden: false, hasFocus: () => true, activeElement: null, addEventListener() {} },
    navigator: { getGamepads: () => [pad] } });
  const source = readFileSync(require.resolve('../js/gamepad-controls.js'), 'utf8')
    .replace(/import \{ isTypingInField \} from '[^']+';/, 'const isTypingInField = () => false;')
    .replace('export { GamepadControls };', 'globalThis.GamepadControls = GamepadControls;');
  vm.runInContext(source, context);
  const input = new context.GamepadControls(controller, { resetOrbit() {}, applyGamepadInput(...args) { look.push(args); } });
  input.update(1 / 60); // discover a neutral pad
  return { pad, keys, look, input, tick: () => input.update(1 / 60) };
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
