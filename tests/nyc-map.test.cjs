const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/nyc-map.js'), 'utf8');

for (const [width, height, dpr] of [[500, 300, 1], [320, 180, 1.5], [1920, 1080, 2]]) {
  test(`map clicks match rendered world positions at ${width}x${height}, DPR ${dpr}`, () => {
    const window = { innerWidth: width, innerHeight: height, devicePixelRatio: dpr };
    const { NYCMapSystem } = loadModule(source, {
      globals: { window, performance: { now: () => 0 } },
      imports: { './nyc-geodata.js': { GEO: {} }, './city-config.js': { ROADS: [] } }
    });
    const map = Object.create(NYCMapSystem.prototype);
    // Capture the production render viewport; drawing primitives are irrelevant to coordinate conversion.
    const context = new Proxy({}, { get: () => () => {} });
    let view;
    Object.assign(map, {
      fullCanvas: { clientWidth: width, clientHeight: height },
      fullCtx: context,
      fullStatic: { getContext: () => context },
      isFullMapOpen: true,
      viewCenterX: 200,
      viewCenterZ: -300,
      viewZoom: 0.5,
      controllerManager: { getActiveEntity: () => ({ position: { x: 200, z: -300 }, heading: 0 }) },
      renderFullMapStatic: (_context, viewport) => { view = viewport; }
    });
    map.resizeFullCanvas();
    map.renderFullMap();

    for (const point of [{ x: 200, z: -300 }, { x: 325, z: -375 }]) {
      // Convert the renderer's centred coordinates through the canvas backing store to CSS pixels.
      const screenX = (view.toX(point.x) + view.w / 2) * view.dpr * width / map.fullCanvas.width;
      const screenY = (view.toY(point.z) + view.h / 2) * view.dpr * height / map.fullCanvas.height;
      const clicked = map.screenToWorld(screenX, screenY, width, height);
      // The pixel budget can yield a fractional DPR; integer backing sizes may round by less than one pixel.
      const tolerance = 1 / (view.s * view.dpr);
      assert.ok(Math.abs(clicked.x - point.x) < tolerance, `clicked x ${clicked.x} should match drawn x ${point.x}`);
      assert.ok(Math.abs(clicked.z - point.z) < tolerance, `clicked z ${clicked.z} should match drawn z ${point.z}`);
    }
  });
}

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

function classList() {
  const names = new Set();
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name),
    contains: (name) => names.has(name),
    toggle(name, enabled) { if (enabled) names.add(name); else names.delete(name); }
  };
}

function mapHarness(landmarks = [], roads = []) {
  const window = {
    ...eventTarget(), innerWidth: 200, innerHeight: 200,
    getComputedStyle: (element) => ({ visibility: element.visibility || 'visible' })
  };
  const elements = {};
  const document = {
    ...eventTarget(), hidden: false,
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => [],
    createElement(tagName) {
      const element = {
        ...eventTarget(), tagName: tagName.toUpperCase(), children: [], style: {}, classList: classList(),
        inert: false, hidden: false, isConnected: true, textContent: '',
        tabIndex: ['button', 'input', 'a'].includes(tagName) ? 0 : -1,
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        replaceChildren(...children) {
          for (const child of this.children) { child.parentElement = null; child.isConnected = false; }
          this.children = [];
          for (const child of children) this.appendChild(child);
        },
        contains(child) { return this === child || this.children.some((node) => node.contains(child)); },
        closest(selector) {
          assert.equal(selector, '[inert]');
          return this.inert ? this : this.parentElement?.closest(selector) || null;
        },
        getClientRects() {
          for (let node = this; node; node = node.parentElement) if (node.hidden || node.classList.contains('hidden')) return [];
          return [{}];
        },
        querySelectorAll(selector) {
          const all = this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)]);
          return all.filter((child) => selector.split(', ').some((tag) => tag.split('[')[0] === child.tagName.toLowerCase()));
        },
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
        focus() { document.activeElement = this; document.dispatch('focusin', { target: this }); }
      };
      return element;
    }
  };
  document.body = document.createElement('body');
  const add = (id, tagName, parent = document.body) => {
    const element = elements[id] = document.createElement(tagName);
    parent.appendChild(element);
    return element;
  };
  add('canvas-container', 'main');
  const hud = add('hud', 'div');
  const opener = add('btn-open-map', 'button', hud);
  const mini = add('minimap-card', 'button', hud);
  add('btn-toggle-hud', 'button', hud);
  const alreadyInert = add('already-inert', 'div');
  alreadyInert.inert = true;
  const modal = add('fullmap-modal', 'section');
  modal.inert = true;
  const wrapper = add('fullmap-canvas-wrap', 'div', modal);
  const canvas = add('fullmap-canvas', 'canvas', wrapper);
  Object.assign(canvas, {
    clientWidth: 200, clientHeight: 200, getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 200 })
  });
  const searchInput = add('fullmap-search', 'input', modal);
  const searchStatus = add('fullmap-search-status', 'p', modal);
  const searchResults = add('fullmap-search-results', 'div', modal);
  searchResults.hidden = true;
  add('fullmap-search-summary', 'p', searchResults);
  const searchList = add('fullmap-search-list', 'ul', searchResults);
  const close = add('close-fullmap-btn', 'button', modal);
  const controls = add('map-controls', 'div', modal);
  const zoomIn = add('map-zoom-in', 'button', controls), zoomOut = add('map-zoom-out', 'button', controls);
  add('map-center-player', 'button', controls);
  add('map-view-all', 'button', controls);
  const hoverInfo = add('fullmap-hover-info', 'span', modal);
  const actionStatus = add('fullmap-action-status', 'span', modal);
  const lastLink = add('map-credit-link', 'a', modal);
  document.activeElement = opener;
  const captured = new Set();
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => {
    captured.delete(id);
    canvas.dispatch('lostpointercapture', { pointerId: id });
  };
  const config = {
    ROADS: roads, BLOCKS: [], NYC_LANDMARKS: landmarks,
    ISLAND_BOUNDS: { minX: -10000, maxX: 10000, minZ: -10000, maxZ: 10000 },
    getIslandBoundsAtZ: () => ({ westX: -10000, eastX: 10000 }),
    getLocationLabel: (x, z) => `${x}, ${z}`,
    isTypingInField: (event) => event.target?.tagName === 'INPUT'
  };
  const { NYCMapSystem } = loadModule(source, {
    globals: { window, document, Path2D: class { moveTo() {} lineTo() {} } },
    imports: { './nyc-geodata.js': { GEO: { frame: {} } }, './city-config.js': config }
  });
  const teleports = [], teleportArgs = [], toggles = [];
  const map = new NYCMapSystem({
    controllerManager: { getActiveEntity: () => ({ position: { x: 1000, z: 2000 } }) },
    onTeleport: (...args) => { teleports.push(args.slice(0, 2)); teleportArgs.push(args); },
    onToggle: (open) => toggles.push(open)
  });
  // Exercise the real viewport/input state without drawing the map's geographic layers.
  map.renderFullMap = () => {};
  map.viewZoom = 1;
  map.toggleFullMap(true);
  return {
    map, canvas, controls, wrapper, window, document, captured, teleports, teleportArgs, toggles, zoomIn, zoomOut,
    modal, opener, mini, hud, alreadyInert, searchInput, searchStatus, searchResults, searchList, close, lastLink,
    actionStatus, hoverInfo, elements,
    pointer(target, type, id, x = 110, y = 120, pointerType = 'touch', button = 0) {
      const event = { pointerId: id, clientX: x, clientY: y, pointerType, button, preventDefault() {} };
      // The window's touch-lifecycle listeners run in capture, before the canvas's handlers.
      window.dispatch(type, event);
      (captured.has(id) ? canvas : target).dispatch(type, event);
    }
  };
}

test('a second finger on the canvas or controls cancels the entire gesture until every finger lifts', () => {
  const h = mapHarness();
  assert.equal(h.canvas.style.touchAction, 'none');
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.controls, 'pointerdown', 2);
  h.pointer(h.canvas, 'pointerdown', 3);
  h.pointer(h.controls, 'pointermove', 2, 190);
  h.pointer(h.canvas, 'pointermove', 3, 190);
  h.pointer(h.controls, 'pointerup', 2);
  h.pointer(h.canvas, 'pointercancel', 3);
  assert.equal(h.map.viewCenterX, 1000);
  assert.equal(h.map.isPanning, false);
  assert.equal(h.captured.size, 0);
  assert.equal(h.teleports.length, 0);

  h.pointer(h.controls, 'pointermove', 1, 130);
  assert.equal(h.map.viewCenterX, 1000);
  h.pointer(h.controls, 'pointerup', 1, 130);
  assert.equal(h.map.isPanning, false);
  assert.equal(h.wrapper.classList.contains('is-panning'), false);
  assert.equal(h.teleports.length, 0);
  h.pointer(h.canvas, 'pointerdown', 4);
  h.pointer(h.canvas, 'pointerup', 4);
  assert.equal(h.teleports.length, 1, 'a fresh single-finger tap works after all fingers lift');
});

test('a normal map tap teleports once and releases capture', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(h.teleports, [[1000, 2000]]);
  assert.equal(h.map.waypoint.name, '1000, 2000');
  assert.equal(h.captured.size, 0);
  assert.equal(h.map.isPanning, false);
});

test('a registered waterfront deck reaches the placement owner without being clamped back onto the mainland', () => {
  const h = mapHarness();
  h.map.viewCenterX = -10050;
  h.map.controllerManager.eucSampler = {
    topAt: (x, z, shore, referenceY) => x === -10050 && z === 2000 && shore && referenceY === Infinity,
    isOffLimits: () => false
  };
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(h.teleports, [[-10050, 2000]]);
});

test('water and off-limits registered surfaces retain the mainland map clamp', () => {
  const h = mapHarness();
  const point = { x: -10050, z: 2000 };
  h.map.controllerManager.eucSampler = { topAt: () => null, isOffLimits: () => false };
  assert.equal(h.map.clampToManhattan(point).x, -9988, 'unregistered river point');
  h.map.controllerManager.eucSampler = { topAt: () => ({}), isOffLimits: () => true };
  assert.equal(h.map.clampToManhattan(point).x, -9988, 'north boundary / unsafe support');
});

test('an authored pin arrival forwards its heading and floor while nearby ground clicks stay exact', () => {
  const arrival = { x: 1008, z: 1995, heading: 0.4, y: 0.48 };
  const h = mapHarness([{ id: 'skate', name: 'Skate spot', short: 'Skate', x: 1000, z: 2000, arrival }]);
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(h.teleportArgs[0], [1008, 1995, 0.4, 0.48]);
  h.pointer(h.canvas, 'pointerdown', 2, 130, 120);
  h.pointer(h.canvas, 'pointerup', 2, 130, 120);
  assert.deepEqual(h.teleportArgs[1], [1020, 2000], 'outside the 8 px pin hit area');
});

test('the skateboard marker owns its wider visible hit area without claiming ordinary nearby ground', () => {
  const arrival = { x: 1008, z: 1995, heading: 0.4, y: 0.48 };
  const h = mapHarness([{ id: 'park', icon: 'skateboard', x: 1000, z: 2000, arrival }]);
  h.pointer(h.canvas, 'pointerdown', 1, 120, 120);
  h.pointer(h.canvas, 'pointerup', 1, 120, 120);
  assert.deepEqual(h.teleportArgs[0], [1008, 1995, 0.4, 0.48], '10 px: on the board silhouette');
  h.pointer(h.canvas, 'pointerdown', 2, 126, 120);
  h.pointer(h.canvas, 'pointerup', 2, 126, 120);
  assert.deepEqual(h.teleportArgs[1], [1016, 2000], '16 px: ordinary map ground');
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur', 'hidden', 'close', 'resize']) {
  test(`${interruption} cancels a map tap without teleporting or leaving a drag active`, () => {
    const h = mapHarness();
    h.pointer(h.canvas, 'pointerdown', 1);
    if (interruption === 'blur' || interruption === 'resize') h.window.dispatch(interruption);
    else if (interruption === 'hidden') {
      h.document.hidden = true;
      h.document.dispatch('visibilitychange');
    } else if (interruption === 'close') h.map.toggleFullMap(false);
    else if (interruption === 'lostpointercapture') h.canvas.releasePointerCapture(1);
    else h.pointer(h.canvas, interruption, 1);
    h.pointer(h.canvas, 'pointerup', 1);
    assert.equal(h.teleports.length, 0);
    assert.equal(h.map.isPanning, false);
    assert.equal(h.captured.size, 0);
    assert.equal(h.wrapper.classList.contains('is-panning'), false);
    if (interruption === 'close') {
      assert.deepEqual(h.toggles, [true, false]);
      h.map.toggleFullMap(true);
    }
    h.pointer(h.canvas, 'pointerdown', 2);
    h.pointer(h.canvas, 'pointerup', 2);
    assert.equal(h.teleports.length, 1);
  });
}

test('a pointer released outside the map or far from its start does not teleport', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointerdown', 1, 205);
  h.pointer(h.controls, 'pointerup', 1, 215);
  h.pointer(h.canvas, 'pointerdown', 2, 110);
  h.pointer(h.canvas, 'pointerup', 2, 130);
  assert.equal(h.teleports.length, 0);
});

test('mouse hover and zoom buttons remain available without a pan', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointermove', 1, 120, 130, 'mouse');
  assert.equal(h.map.hoverWorld.x, 1010);
  assert.equal(h.map.hoverWorld.z, 2010);
  h.pointer(h.canvas, 'pointermove', 2, 180, 130);
  assert.equal(h.map.hoverWorld.x, 1010, 'untracked touch does not update hover');
  h.zoomIn.dispatch('click');
  assert.equal(h.map.viewZoom, 1.45);
  h.zoomOut.dispatch('click');
  assert.equal(h.map.viewZoom, 1);
});

test('map resizing preserves its view, skips unchanged backing stores and ignores hidden dimensions', () => {
  const h = mapHarness();
  let writes = 0;
  for (const field of ['width', 'height']) {
    let value = h.canvas[field];
    Object.defineProperty(h.canvas, field, { get: () => value, set: (v) => { value = v; writes++; } });
  }
  const center = [h.map.viewCenterX, h.map.viewCenterZ, h.map.viewZoom];
  h.map.resizeFullCanvas();
  assert.equal(writes, 0);
  h.canvas.clientWidth = 669;
  h.canvas.clientHeight = 867;
  h.map.resizeFullCanvas();
  assert.equal(writes, 2);
  assert.deepEqual([h.map.viewCenterX, h.map.viewCenterZ, h.map.viewZoom], center);
  h.canvas.clientHeight = 0;
  h.map.resizeFullCanvas();
  assert.equal(writes, 2);
  assert.equal(h.canvas.height, 867);
});

function key(code, fields = {}) {
  return { code, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields };
}

test('the full map contains focus, makes the background inert and restores its exact prior state', () => {
  const h = mapHarness();
  assert.equal(h.document.activeElement, h.modal, 'opening focuses the dialog without opening a software keyboard');
  assert.equal(h.hud.inert, true);
  assert.equal(h.alreadyInert.inert, true);
  assert.equal(h.modal.inert, false);

  h.opener.focus();
  assert.equal(h.document.activeElement, h.modal, 'an outside focus attempt is contained');
  const forward = key('Tab');
  h.modal.dispatch('keydown', forward);
  assert.equal(forward.defaultPrevented, true);
  assert.equal(h.document.activeElement, h.searchInput);
  h.searchInput.focus();
  h.modal.dispatch('keydown', key('Tab', { shiftKey: true }));
  assert.equal(h.document.activeElement, h.lastLink, 'reverse Tab wraps to the final credit link');
  h.modal.dispatch('keydown', key('Tab'));
  assert.equal(h.document.activeElement, h.searchInput, 'forward Tab wraps from the final credit link');

  h.close.dispatch('click');
  assert.equal(h.modal.inert, true, 'closed map is immediately inert during its CSS fade');
  assert.equal(h.hud.inert, false);
  assert.equal(h.alreadyInert.inert, true, 'previously inert content stays inert');
  assert.equal(h.document.activeElement, h.opener);
  h.map.toggleFullMap(false);
  assert.deepEqual(h.toggles, [true, false], 'unchanged open/close requests do not retrigger integration callbacks');
});

test('focus wrapping skips hidden or disabled controls and falls back to the dialog if none remain', () => {
  const h = mapHarness();
  h.searchInput.hidden = true;
  h.close.disabled = true;
  h.modal.dispatch('keydown', key('Tab'));
  assert.equal(h.document.activeElement, h.zoomIn);
  for (const element of h.modal.querySelectorAll('button, input, a')) element.hidden = true;
  h.modal.focus();
  const event = key('Tab');
  h.modal.dispatch('keydown', event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.document.activeElement, h.modal);
});

test('closing uses a visible map opener when the original focus target is hidden or removed', () => {
  const h = mapHarness();
  h.map.toggleFullMap(false);
  h.mini.focus();
  h.map.toggleFullMap(true);
  h.mini.visibility = 'hidden';
  h.map.toggleFullMap(false);
  assert.equal(h.document.activeElement, h.opener);

  h.mini.visibility = 'visible';
  h.mini.focus();
  h.map.toggleFullMap(true);
  h.mini.isConnected = false;
  h.map.toggleFullMap(false);
  assert.equal(h.document.activeElement, h.opener);
});

test('map shortcuts ignore held repeats and modified/typing M while Escape still closes from search', () => {
  const h = mapHarness();
  for (const event of [key('KeyM', { repeat: true }), key('KeyM', { ctrlKey: true }), key('KeyM', { target: h.searchInput })]) {
    h.window.dispatch('keydown', event);
    assert.equal(h.map.isFullMapOpen, true);
    assert.equal(event.defaultPrevented, false);
  }
  const escape = key('Escape', { target: h.searchInput });
  h.window.dispatch('keydown', escape);
  assert.equal(h.map.isFullMapOpen, false);
  assert.equal(escape.defaultPrevented, true);
  h.mini.dispatch('click');
  assert.equal(h.map.isFullMapOpen, true, 'native minimap click activation opens the same modal');
  h.window.dispatch('keydown', key('KeyM'));
  assert.equal(h.map.isFullMapOpen, false);
});

test('search exposes every matching landmark as a native action, including authored heading and elevation', () => {
  const arrival = { x: 908, z: 1895, heading: 0.4, y: 0.48 };
  const h = mapHarness([
    { name: 'North Skatepark', short: 'North Skate', x: 900, z: 1900, arrival },
    { name: 'South Skatepark', short: 'South Skate', x: 1100, z: 2100 }
  ]);
  h.searchInput.value = 'skate';
  h.searchInput.dispatch('input');
  assert.equal(h.searchResults.hidden, false);
  assert.match(h.searchStatus.textContent, /2 landmark results/);
  const buttons = h.searchList.querySelectorAll('button');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].type, 'button');
  assert.equal(buttons[0].textContent, 'Teleport to North Skatepark');
  assert.equal(buttons[1].textContent, 'Teleport to South Skatepark');
  assert.equal(h.teleportArgs.length, 0, 'typing and framing do not teleport');
  h.searchInput.focus();
  const down = key('ArrowDown');
  h.searchInput.dispatch('keydown', down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(h.document.activeElement, buttons[0]);
  for (const code of ['Enter', 'Space']) {
    const event = key(code);
    h.modal.dispatch('keydown', event);
    assert.equal(event.defaultPrevented, false, 'native button activation is not intercepted');
  }
  // A DOM fixture does not synthesize native Enter/Space clicks; exercise the shared click action explicitly.
  buttons[0].dispatch('click');
  buttons[1].dispatch('click');
  assert.deepEqual(h.teleportArgs, [[908, 1895, 0.4, 0.48], [1100, 2100]]);
});

test('landmark and street search framing and zoom survive close/reopen', () => {
  for (const [landmarks, roads, query] of [
    [[{ name: 'Park', short: 'Park', x: 99, z: -300 }], [], 'park'],
    [[], [{ name: 'Broadway', w: 20, pts: [{ x: -100, z: -400 }, { x: 100, z: 600 }] }], 'broadway']
  ]) {
    const h = mapHarness(landmarks, roads);
    h.map.search(query);
    const framing = [h.map.viewCenterX, h.map.viewCenterZ, h.map.viewZoom];
    h.map.toggleFullMap(false);
    h.map.toggleFullMap(true);
    assert.deepEqual([h.map.viewCenterX, h.map.viewCenterZ, h.map.viewZoom], framing);
    if (roads.length) assert.match(h.searchStatus.textContent, /1 matching street highlighted/);
    h.map.search('');
    h.map.toggleFullMap(false);
    h.map.toggleFullMap(true);
    assert.equal(h.map.viewCenterX, 1000, 'clearing search restores ordinary open-at-player behavior');
    assert.equal(h.map.viewCenterZ, 2000);
  }
});

test('no-match search announces the query and removes stale actions without moving the current view', () => {
  const h = mapHarness([{ name: 'Park', short: 'Park', x: 99, z: -300 }]);
  h.map.search('park');
  const framing = [h.map.viewCenterX, h.map.viewCenterZ, h.map.viewZoom];
  h.map.search('<not a place>');
  assert.match(h.searchStatus.textContent, /No streets or landmarks match “<not a place>”/);
  assert.equal(h.searchList.children.length, 0);
  assert.equal(h.searchResults.hidden, false);
  assert.equal(h.searchStatus.parentElement, h.modal, 'the live region is outside the results pane that hides on clear');
  assert.deepEqual([h.map.viewCenterX, h.map.viewCenterZ, h.map.viewZoom], framing);
  h.map.search('  ');
  assert.equal(h.searchResults.hidden, true);
  assert.equal(h.searchStatus.textContent, '');
  assert.equal(h.map.searchPath, null);
});

test('overlapping authored pin hit areas prefer the nearest pin rather than source order', () => {
  const farther = { name: 'Farther', x: 1006, z: 2000, arrival: { x: 1200, z: 2000 } };
  const nearest = { name: 'Nearest', x: 1001, z: 2000, arrival: { x: 1300, z: 2000, heading: 1, y: 2 } };
  const h = mapHarness([farther, nearest]);
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(h.teleportArgs[0], [1300, 2000, 1, 2]);
  assert.equal(h.map.waypoint.name, 'Nearest');
});

test('an authored offshore pin is hit-tested before the ordinary ground clamp', () => {
  const h = mapHarness([{ name: 'Pier', x: -10050, z: 2000, arrival: { x: -10040, z: 2000, heading: 1, y: 0.5 } }]);
  h.map.viewCenterX = -10050;
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.deepEqual(h.teleportArgs[0], [-10040, 2000, 1, 0.5]);
});

test('a refused teleport retains the prior waypoint and map, with visible announced retry feedback', () => {
  const h = mapHarness();
  const previous = h.map.waypoint;
  h.map.onTeleport = () => {
    h.map.waypoint = { x: 999, z: 999, name: 'callback side effect' };
    return Object.defineProperty({ x: 1000, z: 2000 }, 'succeeded', { value: false });
  };
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.canvas, 'pointerup', 1);
  assert.equal(h.map.waypoint, previous);
  assert.equal(h.map.isFullMapOpen, true);
  assert.match(h.actionStatus.textContent, /Teleport unavailable.*no safe arrival.*try again/);
  assert.equal(h.hoverInfo.hidden, true, 'hover text cannot replace the refusal');

  h.map.onTeleport = () => Object.defineProperty({ x: 1002, z: 2003 }, 'succeeded', { value: true });
  h.pointer(h.canvas, 'pointerdown', 2);
  h.pointer(h.canvas, 'pointerup', 2);
  assert.equal(h.map.waypoint.x, 1002, 'the actual safe placement owns the waypoint');
  assert.equal(h.map.waypoint.z, 2003);
  assert.match(h.actionStatus.textContent, /Teleported to/);
});

test('a refused keyboard-accessible landmark action uses the same placement feedback', () => {
  const h = mapHarness([{ name: 'Park', short: 'Park', x: 99, z: -300, arrival: { x: 120, z: -310 } }]);
  h.map.search('park');
  h.map.onTeleport = () => ({ x: 1000, z: 2000, succeeded: false });
  const button = h.searchList.querySelector('button');
  button.focus();
  button.dispatch('click');
  assert.equal(h.document.activeElement, button, 'refusal keeps the chosen action available for retry');
  assert.match(h.actionStatus.textContent, /Teleport unavailable/);
});

test('a two-finger tap never teleports in either release order and a held remaining finger cannot restart it', () => {
  for (const order of [[1, 2], [2, 1]]) {
    const h = mapHarness();
    h.pointer(h.canvas, 'pointerdown', 1);
    h.pointer(h.canvas, 'pointerdown', 2);
    h.pointer(h.canvas, 'pointerup', order[0]);
    h.pointer(h.canvas, 'pointerdown', 3);
    h.pointer(h.canvas, 'pointerup', 3);
    h.pointer(h.canvas, 'pointerup', order[1]);
    assert.equal(h.teleports.length, 0);
    assert.equal(h.map.isPanning, false);
    h.pointer(h.canvas, 'pointerdown', 4);
    h.pointer(h.canvas, 'pointerup', 4);
    assert.equal(h.teleports.length, 1);
  }
});

test('a cancelled multi-touch gesture cannot synthesize a landmark teleport after its final pointerup', () => {
  const h = mapHarness([{ name: 'Park', short: 'Park', x: 99, z: -300 }]);
  h.map.search('park');
  const button = h.searchList.querySelector('button');
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(button, 'pointerdown', 2);
  h.pointer(h.canvas, 'pointerup', 1);
  h.pointer(button, 'pointerup', 2);
  button.dispatch('click', { pointerType: 'touch', detail: 1 });
  assert.equal(h.teleports.length, 0);
  button.dispatch('click', { detail: 0 });
  assert.equal(h.teleports.length, 1, 'keyboard/assistive activation remains available');
  h.pointer(button, 'pointerdown', 3);
  h.pointer(button, 'pointerup', 3);
  button.dispatch('click', { pointerType: 'touch', detail: 1 });
  assert.equal(h.teleports.length, 2, 'a fresh one-finger button tap works');
});

test('single-pointer drag and the existing zoom, center and fit controls retain their navigation behavior', () => {
  const h = mapHarness();
  h.pointer(h.canvas, 'pointerdown', 1);
  h.pointer(h.controls, 'pointermove', 1, 130, 150);
  assert.equal(h.map.viewCenterX, 980);
  assert.equal(h.map.viewCenterZ, 1970);
  h.pointer(h.controls, 'pointerup', 1, 130, 150);
  assert.equal(h.teleports.length, 0);
  const before = h.map.screenToWorld(150, 100, 200, 200);
  h.canvas.dispatch('wheel', { clientX: 160, clientY: 120, deltaY: -100, preventDefault() {} });
  const after = h.map.screenToWorld(150, 100, 200, 200);
  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.z - before.z) < 1e-9);
  h.elements['map-center-player'].dispatch('click');
  assert.deepEqual([h.map.viewCenterX, h.map.viewCenterZ, h.map.viewZoom], [1000, 2000, 0.9]);
  h.elements['map-view-all'].dispatch('click');
  assert.deepEqual([h.map.viewCenterX, h.map.viewCenterZ], [0, 0]);
  assert.equal(h.map.viewZoom, 0.015, 'fit respects the existing zoom floor');
});

test('the minimap and search use native semantics and the direction line does not promise routing', () => {
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const css = readFileSync(join(__dirname, '../css/style.css'), 'utf8');
  assert.match(html, /<button\b[^>]*id="minimap-card"[^>]*type="button"[^>]*aria-haspopup="dialog"[^>]*aria-controls="fullmap-modal"/);
  assert.match(html, /<section\b[^>]*id="fullmap-modal"[^>]*tabindex="-1"[^>]*inert/);
  assert.match(html, /id="fullmap-search-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="fullmap-action-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /Waypoint line shows direction, not a route/);
  assert.doesNotMatch(html, /GPS route/);
  assert.match(css, /body\.hud-minimized \.hud:not\(\.hud-top-right\)\s*\{[^}]*visibility:\s*hidden/);
  assert.match(css, /\.fullmap-search-results button\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /body\.touch-enabled \.fullmap-search\s*\{\s*font-size:\s*16px/);
  assert.match(css, /\.fullmap-search-results\s*\{\s*margin-top:\s*72px;[^}]*--safe-top[^}]*--safe-bottom/);
});

test('pointer dismissal returns focus to gameplay; native keyboard dismissal restores its invoker', () => {
  const h = mapHarness();
  h.close.dispatch('click', { detail: 1 });
  assert.equal(h.document.activeElement, h.elements['canvas-container']);
  h.opener.focus();
  h.map.toggleFullMap(true);
  h.close.dispatch('click', { detail: 0 });
  assert.equal(h.document.activeElement, h.opener);
});

test('map status layout uses measured credit and wrapped feedback heights rather than fixed phone offsets', () => {
  const h = mapHarness(), written = {};
  h.modal.style.setProperty = (key, value) => { written[key] = value; };
  h.elements['fullmap-credits'] = { getBoundingClientRect: () => ({ height: 69.4 }) };
  h.elements['fullmap-footer'] = { getBoundingClientRect: () => ({ height: 85.7 }) };
  h.map.layoutStatus();
  assert.deepEqual(written, { '--map-credits-height': '70px', '--map-status-height': '86px' });
});
