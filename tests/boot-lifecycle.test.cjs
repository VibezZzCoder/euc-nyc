const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/boot.js'), 'utf8');
const importExpression = "import('./main.js')";
assert.equal(source.split(importExpression).length, 2, 'adapt only the game import, once');
// Execute the whole classic bootstrap, with only its module transport substituted. This keeps
// the tests portable on Node without experimental VM modules and never imports the city/GPU.
const executable = source.replace(importExpression, "loadMain('./main.js')");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, event = {}) {
    for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
  }
  count(type) { return this.listeners.get(type)?.size || 0; }
}

function element() {
  const node = new Events();
  const classes = new Set();
  const attributes = new Map();
  Object.assign(node, {
    hidden: false,
    textContent: '',
    classes,
    attributes,
    focusCalls: [],
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value)
    },
    setAttribute: (name, value) => attributes.set(name, value),
    focus: (options) => node.focusCalls.push(options)
  });
  Object.defineProperty(node, 'innerHTML', {
    set() { assert.fail('failure UI must use text, never HTML'); }
  });
  return node;
}

function fixture() {
  const elements = Object.fromEntries([
    'loading-overlay', 'loading-status', 'startup-error', 'startup-retry',
    'startup-help', 'startup-detail'
  ].map((id) => [id, element()]));
  elements['startup-error'].hidden = true;
  elements['loading-status'].textContent = 'Loading city code and data...';
  const window = new Events();
  const imported = deferred();
  const errors = [];
  const imports = [];
  const f = {
    window, elements, imported, errors, imports, reloads: 0, initCalls: 0,
    async load(initApp = () => {}) {
      imported.resolve({ initApp(startup) {
        f.initCalls++;
        f.startup = startup;
        return initApp(startup);
      } });
      await flush();
    }
  };
  window.location = { reload: () => f.reloads++ };
  vm.runInNewContext(executable, {
    document: { getElementById: (id) => elements[id] },
    window,
    console: { error: (...args) => errors.push(args) },
    loadMain: (specifier) => { imports.push(specifier); return imported.promise; }
  }, { filename: 'js/boot.js', timeout: 1000 });
  return f;
}

function assertRetired(f) {
  assert.equal(f.window.count('error'), 0);
  assert.equal(f.window.count('unhandledrejection'), 0);
}

function assertFailure(f, detail, label = 'The city could not start') {
  const e = f.elements;
  assert.equal(e['loading-overlay'].classes.has('hidden'), false);
  assert.equal(e['loading-overlay'].classes.has('has-error'), true);
  assert.equal(e['loading-overlay'].attributes.get('role'), 'alert');
  assert.equal(e['loading-status'].textContent, label);
  assert.equal(e['startup-error'].hidden, false);
  assert.equal(e['startup-detail'].textContent, detail);
  assert.ok(e['startup-help'].textContent.length > 0);
  assert.equal(e['startup-retry'].focusCalls.length, 1);
  assert.equal(e['startup-retry'].focusCalls[0].preventScroll, true);
  assertRetired(f);
}

test('bootstrap imports the canonical entry, registers early listeners and keeps Retry usable', async () => {
  const f = fixture();
  assert.deepEqual(f.imports, ['./main.js']);
  assert.equal(f.window.count('error'), 1);
  assert.equal(f.window.count('unhandledrejection'), 1);
  assert.equal(f.elements['startup-error'].hidden, true);
  f.elements['startup-retry'].dispatch('click');
  assert.equal(f.reloads, 1);
  await f.load();
  assert.equal(f.initCalls, 1);
  assert.equal(f.startup.failed, false);
  assert.equal(f.errors.length, 0);
});

test('a rejected import retains the loader with text-only details and focused Retry', async () => {
  const f = fixture();
  const detail = '<img src=x onerror="alert(1)"> & missing module';
  const error = new Error(detail);
  f.imported.reject(error);
  await flush();
  assertFailure(f, detail);
  assert.equal(f.errors[0][0], '[startup:download]');
  assert.equal(f.errors[0][1], error);
  assert.equal(f.initCalls, 0);
  f.elements['startup-retry'].dispatch('click');
  assert.equal(f.reloads, 1);
});

for (const [name, initApp] of [
  ['throws', () => { throw new Error('initializer failed'); }],
  ['rejects', async () => { throw new Error('initializer failed'); }]
]) {
  test(`bootstrap catches an initializer that ${name}`, async () => {
    const f = fixture();
    await f.load(initApp);
    assertFailure(f, 'initializer failed');
    assert.equal(f.startup.failed, true);
    assert.equal(f.startup.complete(), false);
  });
}

test('a missing initializer also uses the independent failure UI', async () => {
  const f = fixture();
  f.imported.resolve({});
  await flush();
  assert.match(f.elements['startup-detail'].textContent, /initApp/);
  assertFailure(f, f.elements['startup-detail'].textContent);
});

test('failure while renderer init is pending immediately runs its later legacy cleanup', async () => {
  const f = fixture();
  const rendererReady = deferred();
  let stopped = 0, laterStages = 0;
  await f.load(async (startup) => {
    startup.phase('graphics');
    await rendererReady.promise;
    startup.onFailure(() => { stopped++; });
    assert.equal(stopped, 1, 'late registration stops synchronously');
    if (startup.failed) return;
    laterStages++;
  });
  f.window.dispatch('error', { error: new Error('graphics failed during init') });
  assert.equal(stopped, 0);
  assertFailure(f, 'graphics failed during init', 'Graphics could not start');
  rendererReady.resolve();
  await flush();
  assert.equal(stopped, 1);
  assert.equal(laterStages, 0);
  assert.equal(f.startup.complete(), false);
  assertFailure(f, 'graphics failed during init', 'Graphics could not start');
});

test('onStop accumulates cleanups while onFailure retains its single replacement slot', async () => {
  const f = fixture();
  await f.load();
  const calls = [];
  f.startup.onFailure(() => calls.push('replaced'));
  f.startup.onStop(() => calls.push('first'));
  f.startup.onFailure(() => calls.push('legacy'));
  f.startup.onStop(() => calls.push('second'));
  assert.equal(f.startup.fail(new Error('stop now')), true);
  assert.deepEqual(calls, ['legacy', 'first', 'second']);
  assert.equal(f.startup.fail(new Error('secondary error')), false);
  assert.equal(f.startup.complete(), false);
  f.window.dispatch('unhandledrejection', { reason: new Error('secondary rejection') });
  assert.deepEqual(calls, ['legacy', 'first', 'second']);
  assertFailure(f, 'stop now');
  assert.equal(f.errors.length, 1);
});

test('every cleanup registered after failure runs immediately and only once', async () => {
  const f = fixture();
  await f.load();
  assert.equal(f.startup.fail('original failure'), true);
  const calls = [];
  f.startup.onStop(() => calls.push('late additive one'));
  f.startup.onStop(() => calls.push('late additive two'));
  f.startup.onFailure(() => calls.push('late legacy one'));
  f.startup.onFailure(() => calls.push('late legacy two'));
  assert.deepEqual(calls, [
    'late additive one', 'late additive two', 'late legacy one', 'late legacy two'
  ]);
  assert.equal(f.startup.fail('ignored'), false);
  await flush();
  assert.equal(calls.length, 4);
  assertFailure(f, 'original failure');
});

test('throwing and rejecting cleanups cannot skip other cleanups or obscure the primary failure', async () => {
  const f = fixture();
  await f.load();
  const syncError = new Error('stop threw');
  const asyncError = new Error('stop rejected');
  let stopped = 0;
  f.startup.onFailure(() => { throw syncError; });
  f.startup.onStop(() => Promise.reject(asyncError));
  f.startup.onStop(() => { stopped++; });
  assert.equal(f.startup.fail(new Error('primary failure')), true);
  assert.equal(stopped, 1);
  assertFailure(f, 'primary failure');
  await flush();
  assert.ok(f.errors.some((args) => args[1] === syncError));
  assert.ok(f.errors.some((args) => args[1] === asyncError));
  // The immediate path has the same exception isolation, including rejected promises.
  assert.doesNotThrow(() => f.startup.onStop(() => { throw syncError; }));
  f.startup.onFailure(() => Promise.reject(asyncError));
  await flush();
  assertFailure(f, 'primary failure');
});

test('reentrant failure is ignored and cleanup registered during stopping is not lost', async () => {
  const f = fixture();
  await f.load();
  const calls = [];
  f.startup.onStop(() => {
    calls.push('outer');
    assert.equal(f.startup.failed, true);
    assert.equal(f.startup.fail('recursive failure'), false);
    assert.equal(f.startup.complete(), false);
    f.startup.onStop(() => calls.push('inner additive'));
    f.startup.onFailure(() => calls.push('inner legacy'));
  });
  f.startup.onStop(() => calls.push('remaining'));
  assert.equal(f.startup.fail('first failure'), true);
  assert.deepEqual(calls, ['outer', 'inner additive', 'inner legacy', 'remaining']);
  assertFailure(f, 'first failure');
});

test('global failure before an import resolves does not run the initializer afterward', async () => {
  const f = fixture();
  f.window.dispatch('error', { message: 'early module failure' });
  await f.load();
  assert.equal(f.initCalls, 0);
  assertFailure(f, 'early module failure');
});

test('unhandled rejection uses the same first-failure path while startup is active', async () => {
  const f = fixture();
  await f.load();
  let stopped = 0;
  f.startup.onStop(() => { stopped++; });
  f.window.dispatch('unhandledrejection', { reason: '<script>unsafe()</script>' });
  assert.equal(stopped, 1);
  assertFailure(f, '<script>unsafe()</script>');
});

test('success retires global listeners without stopping and ignores a later initializer rejection', async () => {
  const f = fixture();
  const initialized = deferred();
  const staleError = [...f.window.listeners.get('error')][0];
  const staleRejection = [...f.window.listeners.get('unhandledrejection')][0];
  await f.load(() => initialized.promise);
  let stopped = 0;
  f.startup.onFailure(() => { stopped++; });
  f.startup.onStop(() => { stopped++; });
  assert.equal(f.startup.complete(), true);
  assert.equal(f.startup.complete(), true, 'completion remains idempotent');
  assertRetired(f);
  f.window.dispatch('error', { error: new Error('unrelated runtime error') });
  f.window.dispatch('unhandledrejection', { reason: 'unrelated runtime rejection' });
  staleError({ message: 'already-dispatched error' });
  staleRejection({ reason: 'already-dispatched rejection' });
  initialized.reject(new Error('initializer rejected after completion'));
  await flush();
  assert.equal(f.startup.failed, false);
  assert.equal(stopped, 0);
  assert.equal(f.errors.length, 0);
  assert.equal(f.elements['startup-error'].hidden, true);
  assert.equal(f.elements['startup-retry'].focusCalls.length, 0);
});

test('explicit fail after complete shows a retryable graphics failure and drains retained cleanups', async () => {
  const f = fixture();
  await f.load();
  const calls = [];
  f.startup.onFailure(() => calls.push('legacy'));
  f.startup.onStop(() => calls.push('before complete'));
  assert.equal(f.startup.complete(), true);
  f.elements['loading-overlay'].classList.add('hidden'); // Main owns the success transition.
  f.startup.onStop(() => calls.push('after complete'));
  assert.deepEqual(calls, [], 'completion does not stop the live app');
  f.startup.phase('graphics');
  assert.equal(f.startup.fail(new Error('device lost')), true);
  assert.equal(f.startup.failed, true);
  assert.deepEqual(calls, ['legacy', 'before complete', 'after complete']);
  assertFailure(f, 'device lost', 'The graphics session stopped');
  assert.match(f.elements['startup-help'].textContent, /Retry/);
  assert.equal(f.errors[0][0], '[startup:graphics]');
  assert.equal(f.startup.fail(new Error('another device notification')), false);
  assert.equal(f.startup.complete(), false);
  f.startup.onStop(() => calls.push('after runtime failure'));
  assert.equal(calls.at(-1), 'after runtime failure');
  f.elements['startup-retry'].dispatch('click');
  assert.equal(f.reloads, 1);
  assertFailure(f, 'device lost', 'The graphics session stopped');
});

test('unprintable error details fall back to text without preventing Retry', async () => {
  const f = fixture();
  await f.load();
  const error = { get message() { throw new Error('message getter failed'); } };
  assert.equal(f.startup.fail(error), true);
  assertFailure(f, 'Unknown startup error');
});
