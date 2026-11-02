import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlayerState } from '../js/player-state.js';
import { menuOwner } from '../js/game-menu.js';

const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
function evaluate(code, env) {
  return new Function(...Object.keys(env), code)(...Object.values(env));
}

test('production map boundary gates all riding sources, clears camera capture and respects title/booking/failure', () => {
  const calls = [], record = name => (...args) => calls.push([name, ...args]);
  let options;
  const env = {
    controllerManager: { setInputEnabled: record('gate'), resetInput: record('reset') },
    cameraSystem: { _clearPointers: record('camera') }, trafficSystem: {}, cityBlocks: { allBlocks: [] },
    touchControls: { setEnabled: record('touch'), available: false }, gamepadControls: { setEnabled: record('pad'), reset() {} },
    titleScreen: { started: true, root: {} }, booking: { active: false }, startup: { failed: false }, promptDevice: 'keyboard',
    document: { hidden: false, getElementById: () => ({}) }, resetFramePacing() {}, teleportTo() {},
    menuOwner, gameMenu: { isOpen: false }, audioSystem: { setPaused: record('audio') },
    NYCMapSystem: class { constructor(value) { options = value; } }
  };
  const start = main.indexOf('  const mapSystem = new NYCMapSystem(');
  const end = main.indexOf('  teleportButtons.forEach', start);
  const lifecycle = main.slice(main.indexOf('  function owner()'), main.indexOf('  // Compile only the candidate'));
  const control = evaluate(`let stopped = false, pageAway = false, lifecycleReady = false, dirtyView = true, lastOwner = null;
    ${main.slice(start, end)}\n${lifecycle}\nreturn mapSystem;`, env);
  control.cancelGestures = () => {};
  control.isFullMapOpen = true;
  options.onToggle(true);
  assert.deepEqual(calls, [['gate', false], ['reset'], ['touch', false], ['pad', false], ['camera'], ['audio', true]]);
  calls.length = 0;
  control.isFullMapOpen = false;
  options.onToggle(false);
  assert.deepEqual(calls[0], ['gate', true]);
  for (const block of ['title', 'booking', 'menu', 'hidden', 'failure']) {
    env.titleScreen.started = block !== 'title';
    env.booking.active = block === 'booking';
    env.startup.failed = block === 'failure';
    env.gameMenu.isOpen = block === 'menu';
    env.document.hidden = block === 'hidden';
    calls.length = 0;
    options.onToggle(false);
    assert.deepEqual(calls[0], ['gate', false], block);
  }
});

test('pause shortcuts preserve map Escape/popover dismissal and let P transfer map ownership to the menu', () => {
  let listener, current = 'riding', popover = false;
  const calls = [];
  const start = main.indexOf('  // Capture only pause shortcuts.');
  const end = main.indexOf('  const suspendPage =', start);
  evaluate(main.slice(start, end), {
    window: { addEventListener: (_type, callback) => { listener = callback; } }, owner: () => current,
    gameMenu: { isOpen: false, openPause: () => calls.push('menu') },
    mapSystem: { toggleFullMap: value => { calls.push(['map', value]); current = 'riding'; } },
    isTypingInField: event => event.typing, supportsPopover: true, popovers: [{ matches: () => popover }]
  });
  const press = (code, options = {}) => {
    const event = { code, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}, ...options };
    listener(event); return event;
  };
  current = 'map'; assert.equal(press('Escape').defaultPrevented, undefined); assert.deepEqual(calls, []);
  press('KeyP'); assert.deepEqual(calls, [['map', false], 'menu']); calls.length = 0;
  current = 'booking'; press('KeyP'); assert.deepEqual(calls, []);
  current = 'riding'; popover = true; press('Escape'); assert.deepEqual(calls, []);
  popover = false; press('KeyP', { repeat: true }); press('KeyP', { typing: true }); assert.deepEqual(calls, []);
  press('Escape'); assert.deepEqual(calls, ['menu']);
});

test('a deliberate canvas press reclaims riding focus before orbit default prevention; overlays keep ownership', () => {
  const listeners = new Map(), calls = [];
  let current = 'riding';
  const start = main.indexOf("  for (const type of ['pointerdown', 'wheel']) renderer.domElement.addEventListener");
  const end = main.indexOf('  stopRuntime =', start);
  evaluate(main.slice(start, end), {
    renderer: { domElement: { addEventListener(type, callback, options) {
      assert.equal(options.capture, true); listeners.set(type, callback);
    } } }, owner: () => current, container: { focus: options => calls.push(['focus', options]) }
  });
  const event = () => ({ preventDefault() { calls.push('prevent'); }, stopImmediatePropagation() { calls.push('stop'); } });
  listeners.get('pointerdown')(event());
  assert.deepEqual(calls, [['focus', { preventScroll: true }]]);
  calls.length = 0;
  listeners.get('wheel')(event()); assert.deepEqual(calls, [], 'scrolling does not steal keyboard focus');
  for (const overlay of ['menu', 'booking', 'map', 'title', 'hidden', 'graphics']) {
    current = overlay; calls.length = 0; listeners.get('pointerdown')(event());
    assert.deepEqual(calls, ['prevent', 'stop'], overlay);
  }
});

test('production save wiring preserves original bytes through init, title rider selection, hidden/pagehide until Ride', () => {
  let bytes = '{"version":99,"rider":"trollina"}';
  const original = bytes;
  const state = createPlayerState({ isPlayableRider: id => id === 'cool-rider', getStorage: () => ({
    getItem: () => bytes, setItem: (_key, value) => { bytes = value; }
  }) });
  const entity = { riderId: 'cool-rider', position: { x: 1, y: 0, z: 2 }, heading: .5 };
  const env = { playerState: state, controllerManager: { getActiveEntity: () => entity }, booking: { active: false },
    CIVIC_JAIL: { release: { x: 8, y: .22, z: 9, heading: 1 } } };
  const start = main.indexOf('  function savePlayerState()');
  const end = main.indexOf('\n  const cameraSystem', start);
  const save = evaluate(main.slice(start, end) + '\nreturn savePlayerState;', env);
  for (let i = 0; i < 3; i++) save();
  assert.equal(bytes, original);
  state.authorize(); save();
  assert.equal(JSON.parse(bytes).version, 2);
  env.booking.active = true; save();
  assert.deepEqual(JSON.parse(bytes).euc, env.CIVIC_JAIL.release, 'booking persists the outside checkpoint');
});

test('production booking placement requests checked occupancy before advancing, including sidewalk alternatives', () => {
  const calls = [], env = {
    BOOKING_SITE: { x: 12, y: .22 },
    controllerManager: {
      getActiveEntity: () => ({ placeAt(...args) { calls.push(args); return calls.length === 2; } }),
      findTeleportPosition: (x, z, heading, y) => ({ x, z, y, headingY: heading })
    }
  };
  const start = main.indexOf('  function placeAtJail('), end = main.indexOf('  function finishBooking()', start);
  const place = evaluate(main.slice(start, end) + '\nreturn placeAtJail;', env);
  assert.equal(place(20, 1), true);
  assert.equal(calls.length, 2, 'a refused occupied destination tries a nearby sidewalk alternative');
  for (const call of calls) {
    assert.equal(call[3], .22);
    assert.deepEqual(call[4], { requireClear: true, departure: 1.2 });
  }
});

test('restored time applies without writing preferences; an explicit same-value time choice is remembered', () => {
  const writes = [], applied = [];
  const env = { lightingSystem: { activePresetId: 'golden', applyPreset: id => applied.push(id) },
    graphics: { applyTime() {} }, timeButtons: [], viewPreferences: { setTime: id => writes.push(id) } };
  const start = main.indexOf('  function selectTime('), end = main.indexOf('  // Popovers', start);
  const select = evaluate(main.slice(start, end) + '\nreturn selectTime;', env);
  select('golden', false);
  assert.deepEqual(applied, ['golden']); assert.deepEqual(writes, []);
  select('golden');
  assert.deepEqual(writes, ['golden']);
});

test('unavailable sound uses the audio owner’s reason beside the disabled control and cannot overwrite preparation/error status', () => {
  const ids = ['sound-unavailable', 'title-audio-status', 'menu-audio-status', 'title-status'];
  const nodes = Object.fromEntries(ids.map(id => [id, { hidden: false, textContent: '', getBoundingClientRect: () => ({ height: 42 }) }]));
  const styles = new Map();
  nodes['title-status'].textContent = 'Could not prepare selected sounds. Retry or cancel.';
  const attributes = new Map(), icon = { setAttribute() {} };
  const soundButton = { setAttribute: (name, value) => attributes.set(name, value), querySelector: () => icon };
  const audioSystem = { enabled: true, supported: false,
    unavailableReason: 'Web Audio is unavailable; riding continues silently.' };
  const start = main.indexOf('  function updateSoundButton()');
  const end = main.indexOf("  soundButton?.addEventListener('click'", start);
  const update = evaluate(main.slice(start, end) + '\nreturn updateSoundButton;', {
    audioSystem, soundButton, document: { getElementById: id => nodes[id], body: { style: { setProperty: (key, value) => styles.set(key, value) } } }
  });
  update();
  assert.equal(soundButton.disabled, true);
  assert.equal(styles.get('--sound-notice-space'), '50px', 'touch gauge clears the measured notice rather than overlapping it');
  assert.equal(soundButton.title, audioSystem.unavailableReason);
  for (const id of ids.slice(0, 3)) {
    assert.equal(nodes[id].textContent, audioSystem.unavailableReason); assert.equal(nodes[id].hidden, false);
  }
  assert.match(nodes['title-status'].textContent, /Could not prepare/, 'audio state notifications never replace the retry explanation');
  nodes['title-status'].textContent = 'Preparation cancelled. Ride when ready.';
  update(); assert.equal(nodes['title-audio-status'].textContent, audioSystem.unavailableReason);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-sound"[^>]*aria-describedby="sound-unavailable"/);
  assert.match(html, /<span id="sound-unavailable"[^>]*role="status"/);
  audioSystem.supported = true; audioSystem.unavailableReason = null; update();
  assert.equal(soundButton.disabled, false); assert.equal(attributes.get('aria-label'), 'Mute sound');
  assert.equal(styles.get('--sound-notice-space'), '0px', 'supported sound retains the original HUD positions');
  assert.ok(ids.slice(0, 3).every(id => nodes[id].hidden && nodes[id].textContent === ''));
});
