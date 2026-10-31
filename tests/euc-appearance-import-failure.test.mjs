// Real generated import graph failure in an isolated Node test process. No runtime hooks or source edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { prepareAppearance, appearanceResourceStats } from '../js/euc/render/appearanceLoader.js';

const target = new URL('../js/euc/render/riderAppearance-red-rider.js', import.meta.url).href;
let importFailure;
let failures = 0;
const hooks = registerHooks({
  load(url, context, next) {
    if (url === target) {
      failures++;
      // Node can retry a loader-hook throw, unlike browser failed-download module maps. A genuine module
      // evaluation rejection exercises native ESM failure caching here without pretending those are identical.
      return { format: 'module', source: "throw new TypeError('Fixture module graph failed');", shortCircuit: true };
    }
    return next(url, context);
  },
});
const actionableMessage = 'Rider appearance module could not load. Reload NYC to retry this download.';

test('actual appearance module rejection requires reload, preserves its cause and remains cached on same-ID retry', async () => {
  const check = error => {
    assert.equal(error.message, actionableMessage);
    assert.equal(error.reloadRequired, true);
    if (importFailure) assert.equal(error.cause, importFailure);
    else {
      importFailure = error.cause;
      assert.ok(importFailure instanceof TypeError);
      assert.equal(importFailure.message, 'Fixture module graph failed');
    }
    return true;
  };
  await assert.rejects(prepareAppearance('red-rider', { prepaint: false }), check);
  hooks.deregister();
  await assert.rejects(prepareAppearance('red-rider', { prepaint: false }), check);
  assert.equal(failures, 1, 'ESM retains this rejected module even after the fixture failure is removed');
  assert.equal(importFailure.reloadRequired, undefined, 'do not mutate the cached original error');
  assert.equal(appearanceResourceStats().activePreparation, null);
  assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
});

test('abort wins over a late cached import rejection without annotating stale errors or changing the latest rider', async () => {
  const controller = new AbortController();
  const pending = prepareAppearance('red-rider', { signal: controller.signal, prepaint: false });
  controller.abort();
  await assert.rejects(pending, error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.reloadRequired, undefined);
    return true;
  });
  const latest = await prepareAppearance('trollina', { prepaint: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(latest.look.id, 'trollina');
  assert.equal(importFailure.reloadRequired, undefined);
  assert.equal(appearanceResourceStats().preparedIds.at(-1), 'trollina');
  assert.equal(appearanceResourceStats().activePreparation, null);
});

test('invalid selections and pre-aborted requests do not request a reload', async () => {
  await assert.rejects(prepareAppearance('cop'), error => {
    assert.equal(error.reloadRequired, undefined);
    assert.match(error.message, /Unknown playable appearance/);
    return true;
  });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareAppearance('red-rider', { signal: controller.signal }), error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.reloadRequired, undefined);
    return true;
  });
});
