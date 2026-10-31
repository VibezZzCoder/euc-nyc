import test from 'node:test';
import assert from 'node:assert/strict';
import { RiderPreparation } from '../js/rider-preparation.js';
import { readFileSync } from 'node:fs';
import { loadModule } from './helpers/module.cjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function harness(overrides = {}) {
  const log = [], resources = new Set();
  let active = 'original', peak = 0, releases = 0;
  const coordinator = new RiderPreparation({
    async prepare(id) { log.push(`prepare:${id}`); return id; },
    construct(id) {
      log.push(`construct:${id}`);
      const resource = { id, disposed: false, dispose() {
        assert.equal(this.disposed, false, 'dispose exactly once');
        this.disposed = true; resources.delete(resource); log.push(`dispose:${id}`);
      } };
      resources.add(resource); peak = Math.max(peak, resources.size);
      return resource;
    },
    install(id, resource) { active = id; resources.delete(resource); log.push(`commit:${id}`); },
    release() { releases++; },
    async yieldStage() { log.push('yield'); },
    ...overrides,
  });
  return { coordinator, log, resources, get active() { return active; }, get peak() { return peak; },
    get releases() { return releases; } };
}

test('prepare/compile retain active identity; commit is explicit, synchronous and single-use', async () => {
  const h = harness(), compiling = deferred(), entered = deferred();
  const pending = h.coordinator.prepareRider('new', { compile(resource) {
    assert.equal(resource.id, 'new'); entered.resolve(); return compiling.promise;
  } });
  await entered.promise;
  assert.equal(h.active, 'original'); assert.equal(h.resources.size, 1);
  compiling.resolve();
  const ticket = await pending;
  assert.equal(h.active, 'original'); assert.equal(ticket.valid, true);
  for (const value of Object.values(ticket.timings)) assert.ok(Number.isFinite(value) && value >= 0);
  assert.equal(ticket.commit(), true); assert.equal(h.active, 'new');
  assert.equal(ticket.commit(), false); assert.equal(ticket.valid, false);
  ticket.dispose(); assert.equal(h.log.includes('dispose:new'), false, 'ownership transferred to active');
  assert.equal(h.peak, 1); assert.ok(h.releases >= 1);
});

test('supersession waits for outstanding compile, aborts its signal and bounds candidates to one', async () => {
  const h = harness(), compiling = deferred(), entered = deferred();
  let signal;
  const first = h.coordinator.prepareRider('one', { compile(_resource, context) {
    signal = context.signal; entered.resolve(); return compiling.promise;
  } });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await entered.promise;
  const second = h.coordinator.prepareRider('two', { compile() {} });
  const superseded = assert.rejects(second, { name: 'AbortError' });
  const third = h.coordinator.prepareRider('three', { compile() {} });
  assert.equal(signal.aborted, true);
  assert.equal(h.resources.size, 1);
  assert.equal(h.log.includes('dispose:one'), false, 'GPU still holds the first resource');
  assert.equal(h.log.includes('construct:three'), false);
  compiling.resolve();
  await Promise.all([rejected, superseded]);
  const ticket = await third;
  assert.ok(h.log.indexOf('dispose:one') < h.log.indexOf('construct:three'));
  assert.equal(h.log.includes('construct:two'), false);
  assert.equal(h.peak, 1); assert.equal(h.active, 'original');
  ticket.dispose(); assert.equal(ticket.commit(), false); assert.equal(h.resources.size, 0);
});

test('external cancellation during import does not construct; late import drains before a new prepare', async () => {
  const loading = deferred(), entered = deferred(), abort = new AbortController();
  let appearanceSignal;
  const h = harness({ async prepare(id, { signal }) {
    if (id === 'slow') { appearanceSignal = signal; entered.resolve(); await loading.promise; }
    return id;
  } });
  const first = h.coordinator.prepareRider('slow', { signal: abort.signal, compile() {} });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await entered.promise;
  assert.ok(appearanceSignal instanceof AbortSignal, 'appearance/worker preparation receives the transaction signal');
  assert.equal(appearanceSignal.aborted, false);
  abort.abort();
  assert.equal(appearanceSignal.aborted, true, 'external cancellation is forwarded through the transaction signal');
  const next = h.coordinator.prepareRider('next', { compile() {} });
  assert.equal(h.resources.size, 0);
  loading.resolve(); await rejected;
  const ticket = await next;
  assert.equal(h.log.includes('construct:slow'), false); ticket.dispose();
});

test('ready ticket abort, cancellation and supersession release resources and forbid stale commits', async () => {
  const h = harness(), abort = new AbortController();
  const a = await h.coordinator.prepareRider('a', { signal: abort.signal, compile() {} });
  abort.abort(); assert.equal(a.valid, false); assert.equal(a.commit(), false); assert.equal(h.resources.size, 0);
  const b = await h.coordinator.prepareRider('b', { compile() {} });
  const c = await h.coordinator.prepareRider('c', { compile() {} });
  assert.equal(b.commit(), false); assert.equal(h.peak, 1);
  await h.coordinator.cancel(); assert.equal(c.commit(), false); assert.equal(h.resources.size, 0);
  const d = await h.coordinator.prepareRider('d', { compile() {} });
  assert.equal(d.commit(), true, 'temporary cancellation does not permanently close the entity');
});

test('import, construction and compilation failures preserve active and do not poison retry', async () => {
  for (const stage of ['prepare', 'construct', 'compile']) {
    const h = harness(stage === 'compile' ? {} : { [stage]() { throw new Error(stage); } });
    await assert.rejects(h.coordinator.prepareRider('bad', { compile() { throw new Error('compile'); } }), new RegExp(stage));
    assert.equal(h.active, 'original'); assert.equal(h.resources.size, 0); assert.ok(h.releases > 0);
    if (stage === 'prepare') h.coordinator.prepare = async id => id;
    if (stage === 'construct') h.coordinator.construct = id => ({ id, dispose() {} });
    const retry = await h.coordinator.prepareRider('retry', { compile() {} });
    assert.equal(retry.commit(), true);
  }
});

test('graphics stop drains rejected compile before resource disposal and permanently prevents preparation', async () => {
  const h = harness(), compiling = deferred(), entered = deferred();
  const pending = h.coordinator.prepareRider('new', { compile() { entered.resolve(); return compiling.promise; } });
  const rejected = assert.rejects(pending, /graphics lost/);
  await entered.promise;
  const stopped = h.coordinator.dispose();
  assert.equal(h.resources.size, 1);
  await assert.rejects(h.coordinator.prepareRider('late', { compile() {} }), { name: 'AbortError' });
  compiling.reject(new Error('graphics lost')); await rejected; await stopped;
  assert.equal(h.resources.size, 0); assert.equal(h.active, 'original');
});

test('synchronous construction measurement excludes async stages; every safe stage yields', async () => {
  let clock = 0;
  const h = harness({ now: () => clock, async yieldStage() { clock += 100; },
    async prepare() { clock += 20; return {}; },
    construct() { clock += 7; return { dispose() {} }; } });
  const ticket = await h.coordinator.prepareRider('new', { compile() { clock += 30; } });
  assert.deepEqual(ticket.timings, { appearanceMs: 20, constructionMs: 7, compileMs: 30, totalMs: 357 });
  ticket.dispose();
});

test('repeated confirmed/cancelled roster cycles plateau, missing compile and pre-aborted requests do no work', async () => {
  const h = harness();
  await assert.rejects(h.coordinator.prepareRider('bad'), /compile callback/);
  await assert.rejects(h.coordinator.prepareRider('bad', { signal: AbortSignal.abort(), compile() {} }), { name: 'AbortError' });
  assert.deepEqual(h.log, []);
  for (let cycle = 0; cycle < 3; cycle++) for (let id = 0; id < 11; id++) {
    const ticket = await h.coordinator.prepareRider(String(id), { compile() {} });
    if (id % 2) ticket.commit(); else ticket.dispose();
    assert.equal(h.resources.size, 0);
  }
  assert.equal(h.peak, 1);
});

test('manager forwards lifecycle tickets/options and detaches every input listener before draining entity teardown', async () => {
  const listeners = new Set(), stopped = deferred(), calls = [];
  const target = { addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } };
  const entity = { clearInput() {}, prepareRider(...args) { calls.push(args); return 'ticket'; },
    cancelRiderPreparation() { return 'drained'; }, dispose() { calls.push('dispose'); return stopped.promise; } };
  const { ThirdPersonControllerManager } = loadModule(readFileSync(new URL('../js/controllers.js', import.meta.url), 'utf8'), {
    globals: { window: target, document: target }, imports: {
      './city-config.js': { streetZ: () => 0 }, './landmarks.js': {},
      './euc-terrain.js': { NycTerrainSampler: class {}, boxesFromCityColliders: () => [] },
      './euc-rider.js': { createEucEntity: () => entity },
    },
  });
  const manager = new ThirdPersonControllerManager({});
  assert.equal(listeners.size, 4);
  const options = { signal: new AbortController().signal, compile() {} };
  assert.equal(manager.prepareRider('drunkard', options), 'ticket');
  assert.equal(calls[0][0], 'drunkard'); assert.equal(calls[0][1], options);
  assert.equal(manager.cancelRiderPreparation(), 'drained');
  const disposal = manager.dispose(); assert.equal(disposal, stopped.promise);
  assert.equal(listeners.size, 0); assert.equal(manager.inputEnabled, false);
  stopped.resolve(); await disposal;
});

test('paint yield resumes after the animation frame task, with a bounded hidden-tab fallback', async () => {
  const timers = new Map(), frames = new Map();
  let serial = 0;
  const { yieldRiderStage } = loadModule(readFileSync(new URL('../js/rider-preparation.js', import.meta.url), 'utf8'), {
    globals: {
      setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
      requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; },
      cancelAnimationFrame(id) { frames.delete(id); },
    },
  });
  let resumed = false;
  const painted = yieldRiderStage().then(() => { resumed = true; });
  assert.equal(frames.size, 1); assert.equal(resumed, false);
  [...frames.values()][0]();
  const task = [...timers.values()].find(t => t.delay === 0);
  assert.ok(task); assert.equal(resumed, false);
  task.fn(); await painted;
  assert.equal(resumed, true); assert.equal(frames.size, 0);
  timers.clear();
  const hidden = yieldRiderStage();
  const fallback = [...timers.values()].find(t => t.delay === 80);
  assert.ok(fallback); fallback.fn(); await hidden;
  assert.equal(frames.size, 0, 'fallback cancels a suspended frame callback');
});

test('refused or throwing install does not transfer ownership and leaves the resource disposable', async () => {
  for (const throws of [false, true]) {
    const h = harness({ install() { if (throws) throw new Error('refused'); return false; } });
    const ticket = await h.coordinator.prepareRider('new', { compile() {} });
    if (throws) assert.throws(() => ticket.commit(), /refused/);
    else assert.equal(ticket.commit(), false);
    assert.equal(h.active, 'original'); assert.equal(h.resources.size, 1);
    ticket.dispose(); assert.equal(h.resources.size, 0); assert.equal(ticket.commit(), false);
  }
});
