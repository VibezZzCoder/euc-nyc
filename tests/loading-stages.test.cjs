const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const source = readFileSync(join(__dirname, '../js/main.js'), 'utf8');
const helper = source.match(/  async function showLoadingStage\(message\) \{[\s\S]*?\n  \}/)[0];

function fixture(hidden = false) {
  const startup = { failed: false };
  const status = { textContent: 'Loading city code and data...' };
  const classes = new Set();
  const timers = new Map();
  let id = 0, frame;
  const stage = new Function('startup', 'document', 'loadingStatus', 'loadingTrack',
    'requestAnimationFrame', 'setTimeout', 'clearTimeout', helper + '\nreturn showLoadingStage;')(
    startup, { hidden }, status, { classList: { add: (value) => classes.add(value) } },
    (callback) => { frame = callback; },
    (callback, delay) => { timers.set(++id, { callback, delay }); return id; },
    (key) => timers.delete(key));
  return { startup, status, classes, timers, stage, paint: () => frame(),
    runTimer(delay) {
      const [key, timer] = [...timers].find(([, timer]) => timer.delay === delay);
      timers.delete(key);
      timer.callback();
    } };
}

test('loading stages paint before work and use no fixed wait when a frame arrives', async () => {
  const f = fixture();
  let resumed = false;
  const pending = f.stage('Building streets...').then(() => { resumed = true; });
  assert.equal(f.status.textContent, 'Building streets...');
  assert.ok(f.classes.has('is-indeterminate'));
  await Promise.resolve();
  assert.equal(resumed, false);
  f.paint();
  assert.deepEqual([...f.timers.values()].map((t) => t.delay), [0]);
  f.runTimer(0);
  await pending;
  assert.equal(resumed, true);
});

test('a hidden tab can load without waiting for an animation frame', async () => {
  const f = fixture(true);
  await f.stage('Preparing rider, wheel and controls...');
  assert.equal(f.timers.size, 0);
  assert.equal(f.status.textContent, 'Preparing rider, wheel and controls...');
});

test('a suppressed frame cannot leave startup waiting indefinitely', async () => {
  const f = fixture();
  const pending = f.stage('Building landmarks...');
  f.runTimer(100);
  await pending;
});

test('a failure during a paint yield retains its explanation and aborts later stages', async () => {
  const f = fixture();
  const pending = f.stage('Initializing graphics...');
  f.startup.failed = true;
  f.status.textContent = 'Graphics could not start';
  f.runTimer(100);
  await assert.rejects(pending, /earlier failure/);
  await assert.rejects(f.stage('Building streets...'), /earlier failure/);
  assert.equal(f.status.textContent, 'Graphics could not start');
  assert.equal(f.timers.size, 0);
});
