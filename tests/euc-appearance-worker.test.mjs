// Exact generated Worker entry executed on real Node threads, without a browser, DOM, GPU or module-loader hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as ThreadWorker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepareAppearance, releaseAppearanceCaches, appearanceResourceStats } from '../js/euc/render/appearanceLoader.js';
import { appearanceCacheSnapshot, appearanceCacheTransferBuffers, installAppearanceCachePixels,
  preparedRiderLook, preparedMachineLook } from '../js/euc/render/appearanceRegistry.js';
import { createRidingRig } from '../js/euc/render/ridingRig.js';
import { Vector3 } from '../vendor/three/build/three.core.js';
import { PaintVector3 } from '../js/euc/render/pixels/paintVector.js';
import * as surface from '../js/euc/render/pixels/paintSurface.js';
import * as originalSurface from '../js/euc/render/blockoutKit.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('js/euc/MANIFEST.json', root), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  const deadline = performance.now() + 5000;
  while (!predicate()) { assert.ok(performance.now() < deadline, 'preparation made progress'); await tick(); }
}
function canonical(value) {
  if (ArrayBuffer.isView(value)) return { type: value.constructor.name, bytes: value.byteLength, hash: hash(value) };
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function textureSignature(rig) {
  const textures = new Set();
  rig.group.traverse(node => {
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  return [...textures].map(texture => ({ name: texture.name, width: texture.image.width, height: texture.image.height,
    colourSpace: texture.colorSpace, pixels: hash(texture.image.data) })).sort((a, b) => a.name.localeCompare(b.name));
}

function threadedWorkers(t) {
  const prior = globalThis.Worker, instances = [], live = new Set();
  let peak = 0;
  class BrowserWorker {
    constructor(entry, options) {
      assert.equal(options.type, 'module');
      assert.equal(entry.href, new URL('js/euc/render/appearanceWorker.js', root).href);
      this.thread = new ThreadWorker(new URL('./euc-appearance-worker.fixture.mjs', import.meta.url), { workerData: { entry: entry.href } });
      instances.push(this); live.add(this); peak = Math.max(peak, live.size);
      this.thread.on('message', data => {
        // Keep only scalar diagnostics; retaining transferred banks here would invalidate memory checks.
        this.paintMs = data.paintMs; this.pixelBytes = data.pixelBytes;
        this.onmessage?.({ data });
      });
      this.thread.on('error', error => this.onerror?.({ message: error.message, preventDefault() {} }));
    }
    postMessage(message) { this.thread.postMessage(message); }
    terminate() { this.terminated = true; live.delete(this); this.exited = this.thread.terminate(); }
  }
  globalThis.Worker = BrowserWorker;
  t.after(async () => {
    for (const instance of instances) if (!instance.terminated) instance.terminate();
    await Promise.all(instances.map(instance => instance.exited));
    if (prior === undefined) delete globalThis.Worker; else globalThis.Worker = prior;
    releaseAppearanceCaches();
  });
  return { instances, get peak() { return peak; }, get live() { return live.size; } };
}

test('real worker prepaints all selected atlas/logo banks exactly; construction consumes transferred arrays without repainting',
  { timeout: 45000 }, async t => {
    const workers = threadedWorkers(t);
    for (const row of manifest.roster) {
      const original = await prepareAppearance(row.id, { prepaint: false });
      const before = performance.now();
      const ordinaryRig = createRidingRig(original.look, original.machine);
      const ordinaryMs = performance.now() - before;
      const expected = canonical(appearanceCacheSnapshot());
      const expectedTextures = textureSignature(ordinaryRig);
      ordinaryRig.dispose(); releaseAppearanceCaches();

      let heartbeats = 0;
      const pulse = setInterval(() => heartbeats++, 10);
      const start = performance.now();
      let prepared;
      try { prepared = await prepareAppearance(row.id); } finally { clearInterval(pulse); }
      const elapsed = performance.now() - start;
      const bank = appearanceCacheSnapshot();
      assert.deepEqual(canonical(bank), expected, `${row.id}: exact original CPU atlas pixels and decoded logo rasters`);
      assert.deepEqual(Object.keys(bank).sort(), [...manifest.workers.pixelCaches[row.id]].sort());
      const buffers = appearanceCacheTransferBuffers(bank);
      assert.equal(new Set(buffers).size, buffers.length, 'transfer list is unique even for shared atlas/logo arrays');
      assert.ok(appearanceResourceStats().cachedPixelBytes <= 16 * 1024 * 1024);
      const buildStart = performance.now();
      const rig = createRidingRig(prepared.look, prepared.machine);
      const prepaintedMs = performance.now() - buildStart;
      try {
        assert.deepEqual(textureSignature(rig), expectedTextures, `${row.id}: actual rendered texture inputs unchanged`);
        const after = appearanceCacheSnapshot();
        assert.deepEqual(Object.keys(after).sort(), Object.keys(bank).sort());
        for (const id of Object.keys(bank)) assert.equal(after[id].pixels, bank[id].pixels, `${id}: no main-thread repaint/allocation`);
        releaseAppearanceCaches();
        assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
        assert.deepEqual(textureSignature(rig), expectedTextures, 'cache release leaves live rig textures intact');
      } finally { rig.dispose(); releaseAppearanceCaches(); }
      assert.equal(workers.live, 0);
      assert.equal(appearanceResourceStats().workerActive, false);
      assert.ok(appearanceResourceStats().preparedIds.length <= 2);
      if (row.id === 'wyldist') {
        assert.ok(heartbeats > 0, 'main event loop continues while the actual Wyldist pixels are painted on another thread');
        t.diagnostic(`Wyldist: ordinary construction ${ordinaryMs.toFixed(1)} ms; prepainted construction ${prepaintedMs.toFixed(1)} ms; await ${elapsed.toFixed(1)} ms; main-thread heartbeats ${heartbeats}`);
      }
    }
    assert.equal(workers.peak, 1);
    assert.equal(workers.instances.length, Object.values(manifest.workers.pixelCaches).filter(ids => ids.length).length);
  });

test('AbortSignal terminates an actual in-flight worker; supersession starts no parallel pixel job', { timeout: 10000 }, async t => {
  const workers = threadedWorkers(t);
  const abort = new AbortController();
  const pending = prepareAppearance('wyldist', { signal: abort.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await until(() => appearanceResourceStats().workerActive);
  await new Promise(resolve => setTimeout(resolve, 40));
  abort.abort(); await rejected;
  assert.ok(workers.instances[0].terminated);
  assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
  const old = prepareAppearance('wyldist');
  const superseded = assert.rejects(old, { name: 'AbortError' });
  await until(() => appearanceResourceStats().workerActive);
  const latest = await prepareAppearance('red-rider');
  await superseded;
  assert.equal(latest.look.id, 'red-rider');
  assert.equal(workers.peak, 1);
  assert.equal(workers.live, 0);
  assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
});

test('late worker results cannot install pixels or change the selected identity after cancellation', async t => {
  const prior = globalThis.Worker, instances = [];
  globalThis.Worker = class {
    constructor() { instances.push(this); }
    postMessage() { this.lateMessage = this.onmessage; }
    terminate() { this.terminated = true; }
  };
  t.after(() => { if (prior === undefined) delete globalThis.Worker; else globalThis.Worker = prior; releaseAppearanceCaches(); });
  const abort = new AbortController();
  const request = prepareAppearance('wyldist', { signal: abort.signal });
  const rejected = assert.rejects(request, { name: 'AbortError' });
  await until(() => instances[0]?.lateMessage);
  abort.abort(); await rejected;
  await prepareAppearance('trollina');
  const selected = appearanceResourceStats().preparedIds;
  instances[0].lateMessage({ data: { id: 'wyldist', caches: { 'wyldistAtlas.ts': { pixels: new Uint8Array(1024 * 1024 * 4) } } } });
  assert.ok(instances[0].terminated);
  assert.deepEqual(appearanceResourceStats().preparedIds, selected);
  assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
});

test('worker launch/load/transfer/wrong-ID/incomplete-bank failures reject cleanly and permit a fresh retry', async t => {
  const prior = globalThis.Worker;
  t.after(() => { if (prior === undefined) delete globalThis.Worker; else globalThis.Worker = prior; releaseAppearanceCaches(); });
  for (const failure of ['launch', 'load', 'transfer', 'wrong-id', 'incomplete', 'worker-error']) {
    let terminated = false;
    globalThis.Worker = class {
      constructor() { if (failure === 'launch') throw new Error('Worker launch refused'); }
      postMessage() {
        queueMicrotask(() => {
          if (failure === 'load') this.onerror({ message: 'Worker file unavailable', preventDefault() {} });
          else if (failure === 'transfer') this.onmessageerror();
          else this.onmessage({ data: { id: failure === 'wrong-id' ? 'other' : 'wyldist', caches: {},
            ...(failure === 'worker-error' ? { error: 'Painting failed' } : {}) } });
        });
      }
      terminate() { terminated = true; }
    };
    await assert.rejects(prepareAppearance('wyldist'), error => {
      assert.match(error.message, /Worker|worker|Painting/);
      assert.equal(error.reloadRequired, undefined, 'worker failures remain same-dialog retryable');
      return true;
    });
    assert.equal(terminated, failure !== 'launch');
    assert.equal(appearanceResourceStats().workerActive, false);
    assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
  }
  const recovered = await prepareAppearance('wyldist', { prepaint: false });
  assert.equal(recovered.look.id, 'wyldist');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareAppearance('wyldist', { signal: controller.signal }), { name: 'AbortError' });
});

test('pixel-bank validation is atomic; transfer buffers are deduplicated and really detach', async () => {
  const appearance = await prepareAppearance('cool-rider', { prepaint: false });
  const rig = createRidingRig(appearance.look, appearance.machine);
  try {
    const before = appearanceResourceStats().cachedPixelBytes;
    assert.throws(() => installAppearanceCachePixels({ unknown: { pixels: new Uint8Array(4) } }), /Invalid appearance pixel cache/);
    assert.equal(appearanceResourceStats().cachedPixelBytes, before);
    const clone = structuredClone(appearanceCacheSnapshot());
    clone.shared = clone['coolRiderAtlas.ts'];
    const buffers = appearanceCacheTransferBuffers(clone);
    assert.equal(buffers.length, 1);
    const transferred = structuredClone(clone, { transfer: buffers });
    assert.ok(buffers.every(buffer => buffer.byteLength === 0));
    assert.equal(transferred.shared.pixels, transferred['coolRiderAtlas.ts'].pixels);
  } finally { rig.dispose(); releaseAppearanceCaches(); }
});

test('worker graph is explicit, deferred, CPU-only and has no Three/renderer/look imports', t => {
  const preloads = readFileSync(new URL('index.html', root), 'utf8');
  for (const entry of manifest.workers.entries) {
    assert.ok(manifest.deferred.includes(entry));
    assert.ok(!manifest.eager.includes(entry));
    assert.ok(!preloads.includes(`href="./js/euc/${entry}"`));
  }
  for (const file of manifest.workers.modules) {
    const code = readFileSync(new URL(`js/euc/${file}`, root), 'utf8');
    for (const match of code.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('.'), `${file}: no bare worker imports`);
      const target = new URL(match[1], new URL(`js/euc/${file}`, root));
      assert.ok(target.href.startsWith(new URL('js/euc/', root).href), `${file}: no vendor or external-host import`);
    }
    assert.doesNotMatch(code, /\bTHREE\b|\bDataTexture\b|three\.(?:core|webgpu|tsl)\.js|fetch\(/);
    assert.doesNotMatch(file, /(?:Look|Appearance-|ridingRig|euc\.js|appearanceImports|data\/tuning)/);
  }
  assert.equal(manifest.workers.sharedThree, null);
  assert.equal(hash(readFileSync(new URL(manifest.workers.vectorSource.source, root))), manifest.workers.vectorSource.sourceSha256);
  assert.deepEqual(manifest.files['render/pixels/paintVector.js'].derivedFrom[0].methods, manifest.workers.vectorSource.methods);
  const workerGraphBytes = id => manifest.workers.appearances[id].reduce((n, file) => n + readFileSync(new URL(`js/euc/${file}`, root)).byteLength, 0);
  for (const row of manifest.roster) {
    for (const file of manifest.workers.appearances[row.id]) assert.ok(manifest.workers.modules.includes(file));
    assert.ok(workerGraphBytes(row.id) < 512 * 1024, `${row.id}: bounded CPU-only graph without full renderer source`);
  }
  t.diagnostic(`Worker graph source bytes (not browser transfer): Cool Rider ${workerGraphBytes('cool-rider')}; Wyldist ${workerGraphBytes('wyldist')}; removed Three core ${readFileSync(new URL('vendor/three/build/three.core.js', root)).byteLength}`);
  assert.equal(manifest.audio.length, 18, 'reviewed source provenance remains complete');
  assert.equal(manifest.shippedAudio.length, 17, 'unused offroad loop is not a shipped asset');
  assert.ok(!manifest.shippedAudio.some(file => file.endsWith('tyre_offroad_loop.wav')));
});

test('extracted CPU vector/surface helpers preserve the pinned original arithmetic, including normals and poles', () => {
  const coordinates = vector => [vector.x, vector.y, vector.z];
  for (let i = 0; i < 200; i++) {
    const values = i === 0 ? [0, 0, 0] : [Math.sin(i) * 100, Math.cos(i * .3) * .001, i / 17 - 4];
    const original = new Vector3(...values), cpu = new PaintVector3(...values);
    const other = new Vector3(i / 13, -i, .25), point = new PaintVector3(other.x, other.y, other.z);
    assert.equal(cpu.length(), original.length());
    assert.equal(cpu.distanceTo(point), original.distanceTo(other));
    assert.equal(cpu.distanceToSquared(point), original.distanceToSquared(other));
    for (const [method, args, cpuArgs] of [
      ['set', [7, -2], [7, -2]], ['copy', [other], [point]], ['multiplyScalar', [-.317], [-.317]],
      ['addScaledVector', [other, .003], [point, .003]], ['subVectors', [original, other], [cpu, point]],
      ['crossVectors', [original, other], [cpu, point]],
    ]) {
      original[method](...args); cpu[method](...cpuArgs);
      assert.deepEqual(coordinates(cpu), coordinates(original), method);
    }
  }
  const profile = originalSurface.loftProfile([
    { y: -.1, halfWidth: 0, halfDepth: 0 },
    { y: 0, halfWidth: .2, halfDepth: .1, square: 2.7, x: .01 },
    { y: .24, halfWidth: .17, halfDepth: .14, square: 3.8, z: -.03 },
    { y: .4, halfWidth: 0, halfDepth: 0 },
  ]);
  for (let u = -4; u <= 4; u += .137) for (let v = -.2; v <= 3.2; v += .211) {
    for (const name of ['loftPoint', 'loftNormal']) {
      assert.deepEqual(coordinates(surface[name](profile, u, v, new PaintVector3())),
        coordinates(originalSurface[name](profile, u, v, new Vector3())), name);
    }
    assert.equal(surface.vAtHeight(profile, v / 10), originalSurface.vAtHeight(profile, v / 10));
  }
});

test('real deferred machine/rider references evict to the last two preparations and retain no CPU pixel banks', async () => {
  const recent = new Map(appearanceResourceStats().preparedIds.map(id => [id, manifest.roster.find(row => row.id === id)]));
  for (let cycle = 0; cycle < 2; cycle++) for (const row of manifest.roster) {
    const appearance = await prepareAppearance(row.id, { prepaint: false });
    recent.delete(row.id); recent.set(row.id, row);
    const evicted = recent.size > 2 ? recent.values().next().value : null;
    if (evicted) recent.delete(evicted.id);
    assert.equal(preparedRiderLook(row.id), appearance.look);
    assert.equal(preparedMachineLook(row.machine), appearance.machine);
    assert.deepEqual(appearanceResourceStats().preparedIds, [...recent.keys()]);
    if (evicted) {
      assert.throws(() => preparedRiderLook(evicted.id), /not prepared/);
      assert.throws(() => preparedMachineLook(evicted.machine), /not prepared/);
    }
    releaseAppearanceCaches();
    assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
    assert.equal(appearanceResourceStats().cachedPixelBuffers, 0);
  }
  for (const row of manifest.roster) {
    const file = `js/euc/render/machineAppearance-${row.id}.js`;
    assert.ok(manifest.deferred.includes(file.slice('js/euc/'.length)));
    assert.doesNotMatch(readFileSync(new URL(file, root), 'utf8'), /\bMACHINE_LOOKS\b/,
      `${row.id}: no wholesale real-machine array imported by the selected entry`);
  }
});
