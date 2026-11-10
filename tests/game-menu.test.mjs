import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameMenu, RiderSelection, menuOwner, MAIN_MENU_URL } from '../js/game-menu.js';
import { createPlayerState } from '../js/player-state.js';
import { CityAudioSystem } from '../js/audio-system.js';
import { RiderAudioBanks } from '../js/euc-audio.js';
import { RIDERS, PLAYABLE_RIDERS } from '../js/euc-roster.js';
import { machineSpec, machineForCharacter } from '../js/euc/data/machines.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function selectionFixture({ silent = false } = {}) {
  const calls = [], rigs = [], banks = [], states = [];
  const entity = { riderId: 'cool-rider', rig: {} };
  const manager = {
    getActiveEntity: () => entity,
    cancelRiderPreparation() { calls.push('cancel-rig'); },
    prepareRider(id, { signal }) {
      const work = deferred();
      const ticket = { id, valid: true, commit() {
        assert.ok(!signal.aborted); calls.push(`rig:${id}`); entity.riderId = id; entity.rig = {}; return true;
      }, dispose() { calls.push(`dispose-rig:${id}`); } };
      rigs.push({ id, signal, work, ticket });
      return work.promise.then(() => ticket);
    }
  };
  const audio = {
    supported: !silent, active: { id: 'cool-rider' }, unlock() { calls.push('unlock'); },
    cancelRiderPreparation() { calls.push('cancel-audio'); },
    prepareRider(id, { signal }) {
      const work = deferred();
      let valid = true, committed = false;
      const ticket = { id, silent, get valid() { return valid && !signal.aborted; },
        invalidate() { valid = false; },
        commit() {
          if (!ticket.valid) throw new DOMException('Audio preparation cancelled', 'AbortError');
          calls.push(`audio:${id}`); audio.active = ticket; committed = true; valid = false; return true;
        }, dispose() { if (!committed && valid) { valid = false; calls.push(`dispose-audio:${id}`); } } };
      banks.push({ id, signal, work, ticket }); return work.promise.then(() => ticket);
    }
  };
  const selection = new RiderSelection({ manager, audio, compile() {},
    onState: (...args) => states.push(args), onCommit: id => calls.push(`ui-save:${id}`) });
  return { selection, entity, manager, audio, calls, rigs, banks, states };
}

test('confirmation unlocks immediately, retains active rider until BOTH stages, then commits in one turn', async () => {
  const f = selectionFixture();
  const result = f.selection.prepare('drunkard');
  assert.equal(f.calls.at(-1), 'unlock', 'unlock is in the gesture before queued preparation');
  await tick();
  f.rigs[0].work.resolve(); await tick();
  assert.equal(f.entity.riderId, 'cool-rider');
  assert.ok(!f.calls.some(call => call.startsWith('ui-save:')));
  f.banks[0].work.resolve(); await result;
  assert.deepEqual(f.calls.filter(call => /^(rig:|audio:|ui-save:)/.test(call)),
    ['rig:drunkard', 'audio:drunkard', 'ui-save:drunkard']);
  assert.equal(f.entity.riderId, 'drunkard');
});

test('audio failure cancels and drains native compilation, disposes both candidates, never changes identity/save', async () => {
  const f = selectionFixture();
  const result = f.selection.prepare('maribel-vargas');
  const rejected = assert.rejects(result, /decode failed/);
  await tick(); f.banks[0].work.reject(new Error('decode failed')); await tick();
  assert.equal(f.rigs[0].signal.aborted, true);
  assert.equal(f.calls.includes('dispose-rig:maribel-vargas'), false, 'compile still owns its rig');
  f.rigs[0].work.resolve(); await rejected;
  assert.equal(f.entity.riderId, 'cool-rider');
  assert.ok(f.calls.includes('dispose-rig:maribel-vargas'));
  assert.ok(!f.calls.some(call => call.startsWith('ui-save:')));
});

test('supersession and navigation cancellation serialize candidates and prevent stale commits', async () => {
  const f = selectionFixture();
  const first = f.selection.prepare('wyldist'); const firstError = assert.rejects(first, { name: 'AbortError' });
  await tick();
  const second = f.selection.prepare('gnarwheel'); const secondError = assert.rejects(second, { name: 'AbortError' });
  assert.equal(f.rigs[0].signal.aborted, true);
  await tick(); assert.equal(f.rigs.length, 1, 'replacement waits for native work to drain');
  f.rigs[0].work.resolve(); f.banks[0].work.resolve(); await firstError; await tick();
  assert.equal(f.rigs.length, 2);
  const drain = f.selection.dispose();
  f.rigs[1].work.resolve(); f.banks[1].work.resolve(); await secondError; await drain;
  assert.equal(f.entity.riderId, 'cool-rider');
  assert.ok(!f.calls.some(call => call.startsWith('ui-save:')));
});

test('same rider Ride still prepares selected audio without rebuilding; unsupported audio is explicitly silent', async () => {
  const f = selectionFixture();
  const originalRig = f.entity.rig;
  const ride = f.selection.prepare('cool-rider'); await tick();
  assert.equal(f.rigs.length, 0); assert.equal(f.banks.length, 1);
  assert.ok(!f.calls.includes('ui-save:cool-rider'), 'Ride cannot finish before the default bank is ready');
  f.banks[0].work.resolve(); await ride;
  assert.equal(f.entity.rig, originalRig);
  const silent = selectionFixture({ silent: true });
  const silentRide = silent.selection.prepare('cool-rider'); await tick();
  assert.equal(silent.banks.length, 1, 'unsupported platforms still use the audio owner’s selected-bank transaction');
  assert.equal(silent.rigs.length, 0);
  assert.ok(!silent.calls.includes('ui-save:cool-rider'));
  silent.banks[0].work.resolve(); await silentRide;
  assert.equal(silent.audio.active.silent, true);
  assert.ok(silent.calls.includes('ui-save:cool-rider'));
});

test('invalid native tickets cannot commit audio or a pending saved identity', async () => {
  const f = selectionFixture();
  const result = f.selection.prepare('trollina'); const failure = assert.rejects(result, { name: 'AbortError' });
  await tick(); f.rigs[0].ticket.valid = false; f.rigs[0].work.resolve(); f.banks[0].work.resolve(); await failure;
  assert.equal(f.entity.riderId, 'cool-rider');
  assert.ok(!f.calls.includes('audio:trollina'));
});

test('independent audio lifecycle invalidation is checked before either identity transfers without private serial fields', async () => {
  const f = selectionFixture();
  const result = f.selection.prepare('trollina'); const failure = assert.rejects(result, { name: 'AbortError' });
  await tick(); f.banks[0].ticket.invalidate();
  f.rigs[0].work.resolve(); f.banks[0].work.resolve(); await failure;
  assert.equal(f.entity.riderId, 'cool-rider');
  assert.ok(!f.calls.includes('rig:trollina'));
  assert.ok(!f.calls.includes('audio:trollina'));
});

test('a missing audio validity contract never transfers even a fully prepared rig', async () => {
  const f = selectionFixture();
  const result = f.selection.prepare('gnarwheel'); const failure = assert.rejects(result, { name: 'AbortError' });
  await tick(); delete f.banks[0].ticket.valid;
  f.rigs[0].work.resolve(); f.banks[0].work.resolve(); await failure;
  assert.equal(f.entity.riderId, 'cool-rider');
  assert.ok(!f.calls.includes('rig:gnarwheel'));
  assert.ok(!f.calls.includes('ui-save:gnarwheel'));
});

test('actual platform-unavailable CityAudioSystem commits its own valid silent bank through the coordinator', async t => {
  menuFixture(t); // isolated document/lifecycle environment, no AudioContext or browser
  const f = selectionFixture();
  const audio = Object.assign(Object.create(CityAudioSystem.prototype), { supported: false, audioUnavailable: true,
    disposed: false, pageHidden: false, riderPrepareSerial: 0, riderRequestController: null,
    riderBanks: new RiderAudioBanks() });
  f.selection.audio = audio;
  const originalRig = f.entity.rig;
  await f.selection.prepare('cool-rider');
  assert.equal(f.entity.rig, originalRig);
  assert.equal(audio.riderBanks.active.id, 'cool-rider');
  assert.equal(audio.riderBanks.active.silent, true);
  assert.ok(f.calls.includes('ui-save:cool-rider'));
  await f.selection.cancel();
  assert.equal(audio.riderBanks.active.id, 'cool-rider', 'cancellation retains the committed silent bank');
  audio.riderBanks.dispose();
});

test('owner precedence preserves booking and clean-root same-tab destination', () => {
  const state = { failed: true, hidden: true, pageAway: true, booking: true, menu: true, map: true, title: true };
  assert.equal(menuOwner(state), 'graphics'); state.failed = false;
  assert.equal(menuOwner(state), 'hidden'); state.hidden = state.pageAway = false;
  assert.equal(menuOwner(state), 'booking'); state.booking = false;
  assert.equal(menuOwner(state), 'menu'); state.menu = false;
  assert.equal(menuOwner(state), 'map'); state.map = false;
  assert.equal(menuOwner(state), 'title'); state.title = false;
  assert.equal(menuOwner(state), 'riding');
  assert.equal(MAIN_MENU_URL, 'https://vibezzzcoder.github.io/EUC-thrills/');
});

function menuFixture(t) {
  const previous = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const events = target => {
    const listeners = new Map();
    target.addEventListener = (type, fn) => { listeners.set(type, [...listeners.get(type) ?? [], fn]); };
    target.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter(listener => listener !== fn));
    target.fire = type => { for (const fn of listeners.get(type) ?? []) fn(); };
    return target;
  };
  const doc = events({ hidden: false, focused: true, hasFocus() { return this.focused; } });
  const win = events({ getComputedStyle: node => ({ visibility: node.visibility ?? 'visible' }) });
  class Node {
    constructor(tagName = 'DIV', id = '') {
      this.tagName = tagName; this.id = id; this.dataset = {}; this.style = {}; this.children = [];
      this.events = {}; this.inert = false; this.hidden = false; this.isConnected = true;
      this.classList = { add() {}, remove() {} };
    }
    addEventListener(type, fn) { (this.events[type] ??= []).push(fn); }
    removeEventListener() {}
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    setAttribute(key, value) { (this.attributes ??= {})[key] = value; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector) {
      const matches = node => selector.startsWith('#') ? node.id === selector.slice(1)
        : selector === 'button' ? node.tagName === 'BUTTON'
          : selector.startsWith('.') ? node.className === selector.slice(1)
            : selector === '[data-menu-view]' ? !!node.dataset.menuView
              : selector.startsWith('[data-menu-view=') ? node.dataset.menuView === selector.split('"')[1] : false;
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector) {
      return selector.includes('[inert]') && this.inert || selector.includes('[hidden]') && this.hidden
        ? this : this.parentElement?.closest(selector) ?? null;
    }
    getClientRects() { return this.hidden || this.visibility === 'hidden' ? [] : [{}]; }
    focus() {
      // Reject explicit disabled/hidden/inert targets; this fixture does not emulate native Tab traversal.
      if (this.disabled || this.closest('[inert], [hidden]')) return;
      doc.activeElement = this; for (const fn of this.events.focus ?? []) fn();
    }
    click() { if (!this.disabled) for (const fn of this.events.click ?? []) fn(); }
    showModal() { this.open = true; this.modalOpens = (this.modalOpens ?? 0) + 1; }
    close() { this.open = false; this.modalCloses = (this.modalCloses ?? 0) + 1; }
  }
  const body = new Node(), root = new Node('DIALOG', 'game-menu'), hud = new Node(), caller = new Node('BUTTON'), untouched = new Node();
  const host = new Node('MAIN', 'canvas-container');
  untouched.inert = true; body.append(hud, untouched, root, host); hud.append(caller); caller.focus();
  for (const [view, ids] of Object.entries({ pause: ['menu-resume', 'menu-rider', 'menu-return', 'game-menu-heading'],
    picker: ['rider-heading', 'rider-options', 'rider-status', 'rider-current', 'rider-confirm', 'rider-retry', 'rider-cancel',
      'rider-count', 'rider-detail-name', 'rider-detail-state', 'rider-detail-blurb', 'rider-wheel-name', 'rider-wheel-blurb', 'rider-style-note'],
    return: ['return-heading', 'return-keep', 'return-confirm'] })) {
    const section = new Node(); section.dataset.menuView = view; root.append(section);
    for (const id of ids) section.append(new Node(/(heading|options|status|current|detail|wheel|style|count)/.test(id) ? 'DIV' : 'BUTTON', id));
    if (view === 'picker') { const detail = new Node(); detail.className = 'rider-detail'; detail.scrollTop = 0; section.append(detail); }
  }
  Object.assign(doc, { body, createElement: tag => new Node(tag.toUpperCase()), getElementById: id => body.querySelector(`#${id}`) });
  Object.defineProperties(globalThis, { window: { configurable: true, value: win },
    document: { configurable: true, value: doc }, navigator: { configurable: true, value: { getGamepads: () => pads } } });
  t.after(() => { for (const [key, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  const riders = ['cool-rider', 'trollina', 'gnarwheel'];
  let allowed = true, pads = [], active = 'cool-rider', leaves = 0;
  const preparations = [], work = deferred();
  const menu = new GameMenu({ root, riders, specs: Object.fromEntries(riders.map(id => [id, { ...RIDERS[id], name: id }])),
    getRider: () => active, canOpen: () => allowed, onChange() {}, onCancel() {}, onLeave() { leaves++; },
    onConfirm(id) { preparations.push(id); return work.promise.then(() => { active = id; }); } });
  const find = id => root.querySelector(`#${id}`);
  const key = (code, type = 'keydown', repeat = false) => {
    const event = { code, type, repeat, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    menu.key(event); return event;
  };
  return { menu, root, hud, untouched, caller, host, doc, window: win, find, key, preparations, work,
    allow(value) { allowed = value; }, pads(value) { pads = value; }, get active() { return active; }, get leaves() { return leaves; } };
}

test('browsing only highlights; confirmation is explicit; modal inert state and focus restore exactly', async t => {
  const f = menuFixture(t);
  f.menu.openPicker(); f.menu.browse(1);
  assert.deepEqual(f.preparations, []); assert.equal(f.active, 'cool-rider');
  assert.equal(f.menu.highlighted, 'trollina'); assert.equal(f.hud.inert, true); assert.equal(f.root.inert, false);
  f.find('rider-confirm').click();
  assert.deepEqual(f.preparations, ['trollina']); assert.equal(f.menu.state, 'preparing');
  f.menu.browse(1); assert.equal(f.menu.highlighted, 'trollina');
  f.work.resolve(); await tick();
  assert.equal(f.active, 'trollina'); assert.equal(f.menu.isOpen, false);
  assert.equal(f.hud.inert, false); assert.equal(f.untouched.inert, true); assert.equal(f.doc.activeElement, f.caller);
});

test('all eleven profiles reuse original rider and wheel descriptions without appearance imports', () => {
  assert.equal(PLAYABLE_RIDERS.length, 11);
  for (const id of PLAYABLE_RIDERS) {
    const rider = RIDERS[id], wheel = machineSpec(machineForCharacter(id));
    assert.ok(rider.blurb.length > 40, id);
    assert.equal(rider.wheelName, wheel.name, id);
    assert.equal(rider.wheelBlurb, wheel.blurb, id);
  }
  const source = readFileSync(new URL('../js/euc-roster.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /render\//, 'profile data never reaches a look, atlas, logo or rig');
});

test('browsing shows rider/wheel profiles and a named select action, while current identity stays explicit', t => {
  const f = menuFixture(t); f.menu.openPicker();
  assert.match(f.find('rider-current').textContent, /Currently riding: cool-rider/);
  assert.equal(f.find('rider-detail-state').textContent, 'Riding now');
  assert.equal(f.find('rider-confirm').textContent, 'Keep cool-rider');
  f.menu.browse(1);
  assert.equal(f.find('rider-detail-name').textContent, 'trollina');
  assert.equal(f.find('rider-detail-blurb').textContent, RIDERS.trollina.blurb);
  assert.equal(f.find('rider-wheel-name').textContent, RIDERS.trollina.wheelName);
  assert.equal(f.find('rider-wheel-blurb').textContent, RIDERS.trollina.wheelBlurb);
  assert.equal(f.find('rider-detail-state').textContent, 'Browsing');
  assert.equal(f.find('rider-confirm').textContent, 'Select trollina');
  assert.match(f.find('rider-current').textContent, /cool-rider/);
  assert.equal(f.find('rider-count').textContent, '3 riders');
  assert.deepEqual(f.preparations, []);
});

test('right stick scrolls the selected profile with bounded dt after neutral, without choosing another rider', t => {
  const f = menuFixture(t); f.menu.openPicker('trollina');
  const p = { connected: true, mapping: 'standard', index: 0, id: 'profile QA', axes: [0, 0, 0, .8],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  f.pads([p]); const detail = f.root.querySelector('.rider-detail');
  f.menu.updateGamepad(.05); assert.equal(detail.scrollTop, 0, 'held entry stick cannot scroll');
  p.axes[3] = 0; f.menu.updateGamepad(.05);
  p.axes[3] = 1; f.menu.updateGamepad(.05); assert.equal(detail.scrollTop, 18);
  f.menu.updateGamepad(100); assert.equal(detail.scrollTop, 36, 'bounded long-frame scroll');
  f.menu.updateGamepad(NaN); assert.equal(detail.scrollTop, 36);
  p.axes[3] = -1; f.menu.updateGamepad(.05); assert.equal(detail.scrollTop, 18);
  assert.equal(f.menu.highlighted, 'trollina'); assert.equal(f.active, 'cool-rider'); assert.deepEqual(f.preparations, []);
  f.menu.highlight('gnarwheel'); assert.equal(detail.scrollTop, 0, 'new profiles start at their heading');
});

test('booking gate rejects menus; child Escape restores pause; return starts on Keep riding and rejects carryover keys', t => {
  const f = menuFixture(t); f.allow(false); f.menu.openPause(); f.menu.openPicker();
  assert.equal(f.menu.isOpen, false); f.allow(true); f.menu.openPause();
  f.find('menu-rider').click(); f.key('Escape'); f.key('Escape', 'keyup');
  assert.equal(f.menu.view, 'pause'); assert.equal(f.doc.activeElement, f.find('menu-rider'));
  f.find('menu-return').focus();
  assert.equal(f.key('Enter').prevented, undefined, 'fresh native Enter remains native');
  f.find('menu-return').click(); // native Enter activation changes the child view
  assert.equal(f.doc.activeElement, f.find('return-keep'));
  f.find('return-confirm').focus();
  assert.equal(f.key('Enter', 'keydown', true).prevented, true);
  assert.equal(f.key('Enter', 'keyup').prevented, true);
  assert.equal(f.leaves, 0);
  assert.equal(f.key('Enter').prevented, undefined, 'a distinct fresh press may activate the return');
  f.find('return-confirm').click(); assert.equal(f.leaves, 1);
});

test('P resumes the pause view; C opens its picker; errors offer Retry/Cancel without stale reopening effects', async t => {
  const f = menuFixture(t);
  f.menu.openPause(); f.key('KeyP'); f.key('KeyP', 'keyup');
  assert.equal(f.menu.isOpen, false);
  f.menu.openPause(); f.key('KeyC'); f.key('KeyC', 'keyup');
  assert.equal(f.menu.view, 'picker');
  f.find('rider-confirm').click(); f.work.reject(new Error('recording unavailable')); await tick();
  assert.equal(f.menu.state, 'error'); assert.equal(f.find('rider-retry').hidden, false);
  assert.match(f.find('rider-status').textContent, /recording unavailable/);
  assert.equal(f.active, 'cool-rider');
  f.find('rider-retry').click(); f.find('rider-cancel').click();
  assert.equal(f.menu.view, 'pause');
  f.menu.openPicker('gnarwheel'); await tick();
  assert.equal(f.menu.state, 'idle', 'late failure from cancelled preparation cannot replace new browsing feedback');
  assert.equal(f.menu.highlighted, 'gnarwheel');
});

test('only explicitly classified import-graph errors offer Reload NYC; worker/audio errors retain Retry', async t => {
  const f = menuFixture(t);
  for (const classification of [true, false, undefined, 'true']) {
    const error = Object.assign(new Error('required resource unavailable'), { reloadRequired: classification });
    f.menu.onConfirm = () => Promise.reject(error);
    f.menu.openPicker('trollina'); f.find('rider-confirm').click(); await tick();
    assert.equal(f.menu.state, 'error'); assert.equal(f.find('rider-retry').hidden, false);
    assert.equal(f.find('rider-retry').textContent, classification === true ? 'Reload NYC' : 'Retry');
    assert.equal(f.doc.activeElement, f.find('rider-retry'));
    if (classification === true) {
      assert.match(f.find('rider-status').textContent, /Reload keeps your committed rider \(cool-rider\)/);
      assert.match(f.find('rider-status').textContent, /pending selection was not saved/);
    } else assert.match(f.find('rider-status').textContent, /required resource unavailable/);
    f.find('rider-cancel').click(); assert.equal(f.active, 'cool-rider');
  }
});

test('cached import failures reload only on fresh activation; repeated failure/cancel saves no pending ID and other riders still commit', async t => {
  const ui = menuFixture(t), f = selectionFixture(), actions = [];
  const importError = Object.assign(new Error('appearance import rejected'), { reloadRequired: true });
  ui.menu.onConfirm = id => f.selection.prepare(id);
  ui.menu.onCancel = () => { actions.push('cancel'); return f.selection.cancel(); };
  ui.menu.onReload = () => actions.push('reload'); // model a blocked reload: document and modal remain usable
  ui.menu.openPicker('trollina'); ui.find('rider-confirm').focus();
  assert.equal(ui.key('Enter').prevented, undefined); ui.find('rider-confirm').click(); await tick();
  f.rigs[0].work.reject(importError); f.banks[0].work.resolve(); await tick();
  assert.equal(ui.find('rider-retry').textContent, 'Reload NYC');
  assert.equal(ui.key('Enter', 'keydown', true).prevented, true);
  assert.equal(ui.key('Enter', 'keyup').prevented, true);
  assert.deepEqual(actions, []); assert.ok(!f.calls.some(call => call.startsWith('ui-save:')));
  assert.equal(ui.key('Enter').prevented, undefined); ui.find('rider-retry').click();
  assert.deepEqual(actions, ['cancel', 'reload'], 'cancel runs before the explicit reload callback');
  assert.equal(f.rigs.length, 1, 'Reload NYC never repeats the document-cached import');
  assert.equal(ui.key('Enter', 'keydown', true).prevented, true); ui.key('Enter', 'keyup');
  ui.menu.highlight('trollina'); ui.find('rider-confirm').click(); await tick();
  f.rigs[1].work.reject(importError); f.banks[1].work.resolve(); await tick();
  assert.equal(ui.find('rider-retry').textContent, 'Reload NYC');
  assert.equal(f.entity.riderId, 'cool-rider'); assert.ok(!f.calls.some(call => call.startsWith('ui-save:')));
  ui.find('rider-cancel').click(); assert.equal(f.entity.riderId, 'cool-rider');
  ui.menu.openPicker('gnarwheel');
  assert.equal(ui.menu.reloadRequired, false); assert.equal(ui.find('rider-retry').textContent, 'Retry');
  ui.find('rider-confirm').click(); await tick();
  f.rigs[2].work.resolve(); f.banks[2].work.resolve(); await tick();
  assert.equal(f.entity.riderId, 'gnarwheel');
  assert.deepEqual(f.calls.filter(call => call.startsWith('ui-save:')), ['ui-save:gnarwheel']);
  assert.equal(actions.filter(action => action === 'reload').length, 1, 'another valid choice requires no document reload');
});

test('Reload NYC keeps neutral-pad guards and remains cancellable if reload is blocked or throws', async t => {
  const f = menuFixture(t), actions = [];
  f.menu.onConfirm = () => Promise.reject(Object.assign(new Error('import graph failed'), { reloadRequired: true }));
  f.menu.onCancel = () => actions.push('cancel');
  f.menu.onReload = () => { actions.push('reload'); throw new Error('navigation blocked'); };
  f.menu.openPicker('trollina');
  const p = { connected: true, mapping: 'standard', index: 0, id: 'reload QA', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  f.pads([p]); f.menu.updateGamepad(); p.buttons[0].pressed = true; f.menu.updateGamepad(); await tick();
  f.menu.updateGamepad(); assert.deepEqual(actions, [], 'the preparation A hold cannot reload');
  p.buttons[0].pressed = false; p.buttons[7].value = .3; f.menu.updateGamepad();
  p.buttons[0].pressed = true; f.menu.updateGamepad(); assert.deepEqual(actions, [], 'partial trigger is not neutral');
  p.buttons[0].pressed = false; p.buttons[7].value = 0; f.menu.updateGamepad();
  p.buttons[0].pressed = true; f.menu.updateGamepad();
  assert.deepEqual(actions, ['cancel', 'reload']);
  assert.equal(f.menu.state, 'error'); assert.match(f.find('rider-status').textContent, /Reload could not start/);
  f.find('rider-cancel').click(); assert.equal(f.menu.isOpen, false); assert.equal(f.active, 'cool-rider');
});

test('production reload preserves the committed rider override and save authorization/checkpoint even if storage or history fails', () => {
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('    onReload: '), end = main.indexOf('    onLeave:', start);
  const source = main.slice(start, end).trim().replace(/^onReload: /, '').replace(/,$/, '');
  let bytes = JSON.stringify({ version: 2, rider: 'trollina', euc: { x: 4, y: 0, z: 5, heading: 1 } });
  const original = bytes, calls = [], urls = [];
  let storageBlocked = false, historyBlocked = false;
  const playerState = createPlayerState({ isPlayableRider: id => ['cool-rider', 'trollina', 'gnarwheel'].includes(id),
    getStorage: () => ({ getItem: () => bytes, setItem: (_key, value) => {
      if (storageBlocked) throw new Error('quota'); bytes = value;
    } }) });
  const entity = { riderId: 'gnarwheel', position: { x: 1, y: .22, z: 2 }, heading: .5 };
  const booking = { active: false }, CIVIC_JAIL = { release: { x: 8, y: .22, z: 9, heading: 1 } };
  const manager = { getActiveEntity: () => entity };
  const saveSource = main.slice(main.indexOf('  function savePlayerState()'), main.indexOf('\n  const cameraSystem'));
  const save = new Function('controllerManager', 'playerState', 'booking', 'CIVIC_JAIL', `${saveSource}; return savePlayerState;`)(
    manager, playerState, booking, CIVIC_JAIL);
  const reload = new Function('savePlayerState', 'riderSelection', 'controllerManager', 'location', 'history', `return (${source});`)(
    () => { calls.push('save'); save(); }, { cancel: () => calls.push('cancel') }, manager,
    { href: 'https://example.test/nyc/?rider=trollina&cop=0#view', reload: () => calls.push('reload') },
    { state: null, replaceState: (_state, _title, url) => {
      if (historyBlocked) throw new Error('history unavailable'); urls.push(url);
    } });
  reload();
  assert.equal(bytes, original, 'title preview/reload never authorizes a save');
  assert.equal(urls[0].searchParams.get('rider'), 'gnarwheel', 'reload keeps the committed preview instead of an older URL override');
  assert.equal(urls[0].searchParams.get('cop'), '0'); assert.equal(urls[0].hash, '#view');
  playerState.authorize(); booking.active = true; reload();
  assert.equal(JSON.parse(bytes).rider, 'gnarwheel'); assert.deepEqual(JSON.parse(bytes).euc, CIVIC_JAIL.release);
  storageBlocked = historyBlocked = true; assert.doesNotThrow(reload);
  assert.deepEqual(calls, Array(3).fill(['save', 'cancel', 'reload']).flat());
});

test('cancel/reopen enables the highlighted target BEFORE native focus and keeps one modal owner through child views', async t => {
  const f = menuFixture(t);
  f.menu.openPause(); f.menu.openPicker('trollina'); f.find('rider-confirm').click();
  assert.equal(f.find('rider-option-trollina').disabled, true);
  f.find('rider-cancel').click();
  assert.equal(f.menu.view, 'pause'); assert.equal(f.doc.activeElement, f.find('menu-rider'));
  assert.equal(f.root.dataset.state, 'idle');
  f.menu.openPicker('gnarwheel');
  assert.equal(f.find('rider-option-gnarwheel').disabled, false);
  assert.equal(f.doc.activeElement, f.find('rider-option-gnarwheel'), 'disabled targets cannot receive focus in this fixture');
  assert.equal(f.hud.inert, true); assert.equal(f.untouched.inert, true); assert.equal(f.root.inert, false);
  f.menu.cancel(); f.find('menu-return').click();
  assert.equal(f.doc.activeElement, f.find('return-keep'));
  f.key('Escape'); f.key('Escape', 'keyup');
  assert.equal(f.menu.view, 'pause'); assert.equal(f.doc.activeElement, f.find('menu-return'));
  assert.equal(f.root.modalOpens, 1, 'child views retain native modal containment rather than stacking dialogs');
  assert.equal(f.root.modalCloses, undefined);
  f.menu.close();
  assert.equal(f.root.modalCloses, 1); assert.equal(f.doc.activeElement, f.caller);
  assert.equal(f.hud.inert, false); assert.equal(f.untouched.inert, true);
  f.work.reject(new Error('late cancelled request')); await tick();
  assert.equal(f.menu.isOpen, false);
});

test('modal restoration falls back to gameplay when its caller is removed, hidden, disabled or inert', t => {
  const f = menuFixture(t);
  for (const condition of ['removed', 'hidden', 'disabled', 'inert', 'css-hidden']) {
    f.caller.isConnected = true; f.caller.hidden = f.caller.disabled = f.caller.inert = false; f.caller.visibility = 'visible';
    f.caller.focus(); f.menu.openPause();
    if (condition === 'removed') f.caller.isConnected = false;
    if (condition === 'hidden') f.caller.hidden = true;
    if (condition === 'disabled') f.caller.disabled = true;
    if (condition === 'inert') f.caller.inert = true;
    if (condition === 'css-hidden') f.caller.visibility = 'hidden';
    f.menu.close(); assert.equal(f.doc.activeElement, f.host, condition);
    assert.equal(f.hud.inert, false); assert.equal(f.untouched.inert, true);
  }
});

test('real blur/visibility reset listeners discard native activation tokens and error-state holds before retry', async t => {
  const f = menuFixture(t);
  f.menu.openPicker(); f.find('rider-confirm').click();
  f.work.reject(new Error('decode unavailable')); await tick();
  assert.equal(f.doc.activeElement, f.find('rider-retry'));
  assert.equal(f.key('Space').prevented, undefined); // begins a native Space activation on Retry
  assert.ok(f.menu.activation.has('Space'));
  f.window.fire('blur'); f.doc.fire('visibilitychange');
  assert.equal(f.menu.activation.size, 0); assert.equal(f.menu.keys.size, 0);
  assert.equal(f.key('Space', 'keydown', true).prevented, true);
  assert.equal(f.key('Space', 'keyup').prevented, true, 'orphan key-up cannot synthesize Retry');
  assert.equal(f.preparations.length, 1);
  assert.equal(f.key('Space').prevented, undefined, 'first truly fresh press is usable after reset');
  f.find('rider-retry').click();
  assert.equal(f.preparations.length, 2);
  f.find('rider-cancel').click(); await tick();
  assert.equal(f.menu.isOpen, false);
});

test('BFCache pagehide/confirmed departure cancels pending selection, saves only committed ID and retains active resources', async t => {
  const ui = menuFixture(t), f = selectionFixture(), writes = [], navigation = [], callbacks = new Map();
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const playerState = createPlayerState({ isPlayableRider: id => ['cool-rider', 'trollina'].includes(id), getStorage: () => ({
    getItem: () => null, setItem: (_key, value) => writes.push(JSON.parse(value))
  }) });
  Object.assign(f.entity, { position: { x: 1, y: .22, z: 2 }, heading: .5 });
  const saveSource = main.slice(main.indexOf('  function savePlayerState()'), main.indexOf('\n  const cameraSystem'));
  const save = new Function('controllerManager', 'playerState', 'booking', 'CIVIC_JAIL', `${saveSource}; return savePlayerState;`)(
    f.manager, playerState, { active: false }, {});
  playerState.authorize(); save(); f.selection.onCommit = save;
  const retainedRig = f.entity.rig, retainedBank = f.audio.active;
  Object.assign(f.manager, { setInputEnabled(value) { this.inputEnabled = value; }, resetInput() {} });
  f.audio.setPaused = value => { f.audio.paused = value; };
  const lifecycle = main.slice(main.indexOf('  function owner()'), main.indexOf('  // Compile only the candidate'));
  const listeners = main.slice(main.indexOf('  const suspendPage ='), main.indexOf("  for (const type of ['pointerdown', 'wheel'])"));
  const leaveStart = main.indexOf('    onLeave: () => {');
  const leave = main.slice(leaveStart, main.indexOf('\n  });', leaveStart)).trim().replace('onLeave: ', '');
  const titleScreen = { started: true, root: {}, cancelPreparation() {} };
  let clocks = 0, loops = 0, disposed = 0;
  const env = {
    startup: { failed: false }, document: ui.doc, gameMenu: ui.menu, titleScreen,
    controllerManager: f.manager, audioSystem: f.audio, riderSelection: f.selection, booking: { active: false }, menuOwner,
    touchControls: { setEnabled() {} }, gamepadControls: { setEnabled() {}, reset() {} },
    cameraSystem: { _clearPointers() {} }, mapSystem: { isFullMapOpen: false, cancelGestures() {} },
    window: { addEventListener(type, fn) { assert.equal(callbacks.has(type), false); callbacks.set(type, fn); } },
    renderer: { setAnimationLoop() { loops++; }, dispose() { disposed++; } },
    resetFrameClock: () => { clocks++; }, savePlayerState: save, MAIN_MENU_URL, location: { assign: url => navigation.push(url) }
  };
  const runtime = new Function(...Object.keys(env), `let pageAway = false, stopped = false, lifecycleReady = true,
    dirtyView = false, lastOwner = null; ${lifecycle}\n${listeners}
    return { leave: ${leave}, syncLifecycle, get pageAway() { return pageAway; } };`)(...Object.values(env));
  ui.menu.onChange = runtime.syncLifecycle; ui.menu.onCancel = () => f.selection.cancel();
  ui.menu.onConfirm = id => f.selection.prepare(id); ui.menu.onLeave = runtime.leave;
  ui.menu.openPause(); ui.menu.openPicker('trollina'); ui.find('rider-confirm').click(); await tick();
  callbacks.get('pagehide')({ persisted: true });
  assert.equal(runtime.pageAway, true); assert.equal(f.rigs[0].signal.aborted, true);
  f.rigs[0].work.resolve(); f.banks[0].work.resolve(); await tick();
  assert.equal(f.entity.rig, retainedRig); assert.equal(f.audio.active, retainedBank);
  assert.equal(ui.menu.state, 'error');
  assert.ok(writes.every(write => write.rider === 'cool-rider'), 'pending identity never reaches the authorized save');
  assert.equal(f.selection.closed, false); assert.equal(disposed, 0); assert.equal(loops, 0);
  const beforeRestore = clocks;
  callbacks.get('pageshow')({ persisted: true });
  assert.equal(runtime.pageAway, false); assert.equal(ui.menu.view, 'picker'); assert.equal(f.audio.paused, true);
  assert.ok(clocks > beforeRestore); assert.equal(f.manager.inputEnabled, false);
  ui.find('rider-cancel').click(); ui.find('menu-resume').click();
  assert.equal(f.manager.inputEnabled, true); assert.equal(f.audio.paused, false);
  ui.menu.openPause(); ui.find('menu-return').click(); ui.find('return-confirm').click();
  assert.deepEqual(navigation, [MAIN_MENU_URL]); assert.equal(runtime.pageAway, true);
  callbacks.get('pagehide')({ persisted: true }); callbacks.get('pageshow')({ persisted: true });
  assert.equal(ui.menu.leaving, false); assert.equal(ui.menu.view, 'return');
  assert.equal(f.entity.rig, retainedRig); assert.equal(f.audio.active, retainedBank);
  assert.equal(disposed, 0); assert.equal(loops, 0, 'history restores reset clocks, not animation-loop installation');
  ui.key('Escape'); ui.key('Escape', 'keyup'); ui.find('menu-resume').click();
  const resumed = f.selection.prepare('cool-rider'); await tick();
  f.banks.at(-1).work.resolve(); await resumed;
  assert.equal(f.entity.rig, retainedRig); assert.equal(f.rigs.length, 1, 'resumable owner can prepare again without rebuilding same-ID rig');
});

test('menu pad requires neutral sticks and partial triggers; A confirms a highlighted rider and B cancels children', async t => {
  const f = menuFixture(t); f.menu.openPicker();
  const pad = { connected: true, mapping: 'standard', index: 0, id: 'QA', axes: [0.7, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  f.pads([pad]); f.menu.updateGamepad();
  pad.axes[0] = 0; pad.buttons[7].value = 0.3; f.menu.updateGamepad();
  pad.buttons[0].pressed = true; f.menu.updateGamepad(); assert.deepEqual(f.preparations, []);
  pad.buttons[0].pressed = false; pad.buttons[7].value = 0; f.menu.updateGamepad();
  pad.buttons[5].pressed = true; f.menu.updateGamepad(); assert.equal(f.menu.highlighted, 'trollina');
  pad.buttons[5].pressed = false; f.menu.updateGamepad();
  pad.buttons[0].pressed = true; f.menu.updateGamepad(); assert.deepEqual(f.preparations, ['trollina']);
  f.work.resolve(); await tick();
  f.menu.openPause(); f.find('menu-return').click();
  f.menu.updateGamepad(); pad.buttons[0].pressed = false; f.menu.updateGamepad();
  pad.buttons[1].pressed = true; f.menu.updateGamepad(); assert.equal(f.menu.view, 'pause');
});

test('real renderer compilation retains MRT/attachments and blocks submissions until native cancellation drains', async () => {
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const source = main.slice(main.indexOf('  function compileRider('), main.indexOf('  const riderSelection ='));
  const native = deferred(), calls = [];
  const group = { traverse(fn) { fn(this.mesh); }, mesh: { frustumCulled: true }, removeFromParent() { calls.push('detach'); } };
  const renderer = { getRenderTarget: () => 'original-target', getMRT: () => 'original-mrt',
    setRenderTarget: target => calls.push(target), setMRT: mrt => calls.push(mrt),
    compileAsync(object, camera, scene) { calls.push([object, camera, scene]); return native.promise; } };
  const scene = { add(object) { assert.equal(object, group); calls.push('attach'); } }, cameraSystem = { camera: {} };
  const compile = new Function('renderer', 'scene', 'cameraSystem', 'scenePass', 'sceneMRT', 'scheduleViewportResize',
    `let runtimeCompile = null, rendererBusy = false, stopped = false, dirtyView = false; ${source}
    return { compileRider, get busy() { return rendererBusy; } };`)(renderer, scene, cameraSystem,
    { renderTarget: 'scene-target' }, 'scene-mrt', () => calls.push('resize'));
  const abort = new AbortController();
  const pending = compile.compileRider({ group }, { signal: abort.signal });
  assert.equal(compile.busy, true); abort.abort(); await tick();
  assert.ok(!calls.includes('detach')); assert.equal(group.mesh.frustumCulled, false);
  native.resolve(); await pending;
  assert.equal(compile.busy, false); assert.equal(group.mesh.frustumCulled, true);
  assert.deepEqual(calls.slice(-4), ['original-mrt', 'original-target', 'detach', 'resize']);
  assert.equal(calls.find(Array.isArray)[2], scene, 'full native scene supplies the actual light set');
});

test('first registered graphics cleanup releases modal ownership synchronously and drains every reader before renderer disposal', async () => {
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('  startup.onStop(async () => {');
  const end = main.indexOf('\n  });', start) + '\n  });'.length;
  const native = deferred(), boot = deferred(), calls = [];
  let cleanup;
  new Function('startup', 'renderer', 'stopRuntime', 'setGameUIEnabled', 'startupPreparation', 'compileWork', 'disposeEffects', 'geometryResidency',
    `let stopped = false, rendererInit = Promise.resolve(), runtimeCompile = null; ${main.slice(start, end)}`)(
    { onStop(fn) { cleanup = fn; } }, { setAnimationLoop: () => { calls.push('loop-off'); return Promise.resolve(); },
      dispose: () => calls.push('renderer-dispose') },
    () => { calls.push('modal-close'); return native.promise; }, () => calls.push('ui-disabled'),
    { abort: () => calls.push('startup-abort') }, boot.promise, () => calls.push('effects-dispose'),
    { dispose: () => calls.push('geometry-dispose') });
  const stopped = cleanup();
  assert.ok(calls.includes('modal-close'), 'Retry can receive focus before boot continues its failure handler');
  native.resolve(); await tick();
  assert.ok(!calls.includes('renderer-dispose'), 'startup shaders still reference renderer inputs');
  assert.ok(!calls.includes('effects-dispose'), 'effects remain owned while shader compilation reads their attachments');
  assert.ok(!calls.includes('geometry-dispose'), 'geometry ownership stays installed while shader readers drain');
  boot.resolve(); await stopped;
  assert.equal(calls.at(-3), 'effects-dispose');
  assert.equal(calls.at(-2), 'geometry-dispose');
  assert.equal(calls.at(-1), 'renderer-dispose');
});
