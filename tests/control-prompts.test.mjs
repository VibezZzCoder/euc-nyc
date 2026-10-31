import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

test('production device prompts match actual rider, menu, camera and controller-map bindings', () => {
  const caps = [['M', 'Start'], ['C', 'LB / RB'], ['P', 'View'], ['V', 'Y'], ['Esc', 'B / Start']]
    .map(([keyboard, gamepad]) => ({ dataset: { keyboard, gamepad } }));
  const nodes = new Map(), devices = [], hint = { replaceChildren(...children) { this.children = children; } };
  const document = { body: { dataset: {} }, querySelectorAll: () => caps,
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); },
    createElement() { return { dataset: {}, children: [], appendChild(child) { this.children.push(child); } }; } };
  const map = { isFullMapOpen: false, setInputDevice: device => devices.push(device) };
  const constants = source.slice(source.indexOf('  const controlHints ='), source.indexOf("  window.addEventListener('keydown', (e) => { if (!isTypingInField(e)) setPromptDevice"));
  const render = source.slice(source.indexOf('  function renderControlHints()'), source.indexOf('  // The taxi-yellow pill'));
  const change = new Function('document', 'mapSystem', 'touchControls', 'elControlsHint',
    `${constants}\n${render}\nrenderControlHints();return setPromptDevice;`)(document, map, { available: true }, hint);
  assert.ok(caps.every(cap => cap.hidden), 'touch hides keyboard caps');
  change('gamepad');
  assert.equal(document.body.dataset.input, 'gamepad'); assert.equal(devices.at(-1), 'gamepad');
  assert.deepEqual(caps.map(cap => cap.textContent), ['Start', 'LB / RB', 'View', 'Y', 'B / Start']);
  assert.ok(caps.every(cap => !cap.hidden && cap.dataset.pad === cap.textContent));
  assert.match(nodes.get('cam-next').title, /\[Y\]/);
  assert.doesNotMatch(nodes.get('cam-prev').title, /Shift|V|\[Y\]/, 'no invented reverse-cycle pad binding');
  assert.match(nodes.get('close-fullmap-btn').title, /B \/ Start/);
  assert.match(nodes.get('map-zoom-in').title, /RT/); assert.match(nodes.get('map-zoom-out').title, /LT/);
  assert.match(nodes.get('map-center-player').title, /X/); assert.match(nodes.get('map-view-all').title, /Y/);
  assert.ok(hint.children.some(item => item.children.some(child => child.textContent === 'Start')), 'riding guide includes map binding');
  change('keyboard');
  assert.deepEqual(caps.map(cap => cap.textContent), ['M', 'C', 'P', 'V', 'Esc']);
  assert.ok(caps.every(cap => !cap.hidden && !Object.hasOwn(cap.dataset, 'pad')));
  change('touch'); assert.ok(caps.every(cap => cap.hidden));
});
