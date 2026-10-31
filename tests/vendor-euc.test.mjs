// Generated-content pruning contracts. No browser, GPU, or execution of the upstream game/tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as tuning from '../js/euc/data/tuning.js';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const manifest = JSON.parse(read('js/euc/MANIFEST.json'));
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const tool = read('tools/vendor-euc.mjs');
// Exercise the actual pure generator seam without running its CLI or requiring upstream tooling dependencies.
const seamStart = tool.indexOf('function replaceOnce(');
const seamEnd = tool.indexOf('\nconst OVERRIDES =', seamStart);
assert.ok(seamStart >= 0 && seamEnd > seamStart);
const prune = new Function('crypto', `${tool.slice(seamStart, seamEnd)}\nreturn pruneLiveTuningMetadata;`)(crypto);

// Before-prune generated tuning at fork d3e36d8 / upstream 5f45fff; excludes only LIVE_TUNABLES.
// Record all retained exports, including currently unused constants: this is not a new tuning allowlist.
const retainedExports = `AUDIO BARKS BIRDS BLOCKOUT_COLOURS CAMERA CHALLENGE CHASE CONTACT DIAGNOSTICS
DISTRICT_EXTERIOR DRUNK ENVIRONMENT_AMBIENCE ENVIRONMENT_BATCHING ENVIRONMENT_VEGETATION EUC FX
GROUND_BOUNDARY GROUND_CERTIFICATE GROUND_PAVING GROUP_SPAWN HAZARD INPUT INSPECTION_CAMERA KNOCKABOUT
LAUNCH_PAD LAUNCH_PAD_LOOK LIGHTING LOADING ONE_FOOT PADDLE PHYSICS POPULATION POPULATION_AMBIENCE
POPULATION_AUTHORING POPULATION_CONTACT POPULATION_OCCUPANT POPULATION_REACTION POTHOLE PROTECTED_ACTIVITY
PUDDLE RACE RAGDOLL_BOOT_GROUND_BOX RAGDOLL_HAND_GROUND_BOX RAGDOLL_PARTICLE_RADII RAGDOLL_TRUNK_WEIGHTS
RENDER RIDER RIDER_BLOCKOUT RIDER_CONTACT RIDER_CONTACT_OVERHANG_METRES RIDER_OCCUPANCY SHARED_GROUND
SIMULATION TARGET TERRAIN TRACK_DAY TRICKS TRICK_RUN TUNING ULTRA VEGETATION_COUCH_DETAIL
VEGETATION_TIER_DETAIL WHEEL WILDLIFE`.split(/\s+/);

// Include property order/descriptors, frozen/sealed/extensible state and shared references, not only JSON values.
function tuningContract(exports) {
  const seen = new Map();
  const visit = value => {
    if (value === null || typeof value !== 'object') {
      return [typeof value, typeof value === 'number' && Object.is(value, -0) ? '-0' : String(value)];
    }
    if (seen.has(value)) return ['ref', seen.get(value)];
    const id = seen.size;
    seen.set(value, id);
    return [id, Array.isArray(value) ? 'array' : 'object', Object.isFrozen(value),
      Object.isSealed(value), Object.isExtensible(value), Reflect.ownKeys(value).map(key => {
        const d = Object.getOwnPropertyDescriptor(value, key);
        assert.ok('value' in d, `unexpected accessor: ${String(key)}`);
        return [key, d.enumerable, d.configurable, d.writable, visit(d.value)];
      })];
  };
  return Object.keys(exports).sort().map(key => [key, visit(exports[key])]);
}

test('all 64 retained tuning exports match before-prune values, object identities and frozen states', () => {
  assert.deepEqual(Object.keys(tuning).sort(), retainedExports);
  assert.equal(sha256(JSON.stringify(tuningContract(tuning))),
    'a2a4686b6622f00dc4630bed5a5dca3d43c81daa8438901d7585dff7bf5a20df');
  for (const [key, value] of Object.entries(tuning.TUNING)) {
    if (key in tuning) assert.equal(value, tuning[key], `TUNING aliases the named export ${key}`);
    if (value !== null && typeof value === 'object') assert.ok(Object.isFrozen(value), `${key} stays frozen`);
  }
  assert.ok(Object.isFrozen(tuning.TUNING));
  assert.ok(tuning.RIDER_OCCUPANCY.wheelBody && Object.isFrozen(tuning.RIDER_OCCUPANCY.wheelBody));
  assert.ok(Object.isFrozen(tuning.RAGDOLL_PARTICLE_RADII));
  assert.throws(() => { tuning.EUC.maxLeanPitch = 99; }, TypeError);
});

test('generated tuning preserves the freeze call and complete before/after source outside metadata', () => {
  const generated = read('js/euc/data/tuning.js');
  assert.doesNotMatch(generated, /\bLIVE_TUNABLES\b/);
  assert.match(generated, /export const TUNING = deepFreeze\(\{/);
  // SHA of the pre-prune generated file with exactly the LIVE_TUNABLES declaration removed. Covers constants
  // both before and after it, the root call and source ordering, independently of the runtime-value contract.
  assert.equal(sha256(generated), 'ad7af1318a0e6a38b64b5a37723719c63ab3762790c8745a54651a31a377e6d8');
});

test('chase camera is absent from the generator entries, output, manifest and generated preloads', () => {
  const entries = tool.match(/const ENTRIES = \[([^]*?)\];/)?.[1];
  assert.ok(entries);
  assert.doesNotMatch(entries, /chaseCamera/);
  assert.ok(!manifest.entries.includes('render/chaseCamera.ts'));
  assert.ok(!('render/chaseCamera.js' in manifest.files));
  assert.ok(!existsSync(new URL('js/euc/render/chaseCamera.js', root)));
  const block = read('index.html').match(/<!-- euc:preload:start \(tools\/vendor-euc\.mjs\) -->([^]*?)<!-- euc:preload:end -->/)?.[1];
  assert.ok(block);
  const preloads = [...block.matchAll(/href="\.\/js\/euc\/([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(preloads, Object.keys(manifest.files).sort());
  const files = dir => readdirSync(new URL(`js/euc/${dir}`, root), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]);
  assert.deepEqual(files('').sort(), [...Object.keys(manifest.files), 'LICENSE', 'MANIFEST.json'].sort());
  for (const file of Object.keys(manifest.files)) {
    assert.doesNotMatch(read(`js/euc/${file}`), /\b(?:chaseCamera|LIVE_TUNABLES)\b/, `${file} has no removed-content references`);
  }
});

test('metadata pruning fails closed for missing or unknown declarations', () => {
  for (const fixture of ['', 'export const LIVE_TUNABLES = [];',
    'export const LIVE_TUNABLES: readonly TunableSpec[] = deepFreeze([\n  sideEffect(),\n]);']) {
    assert.throws(() => prune(fixture), /metadata changed/);
  }
});

const upstream = new URL('../EUC-thrills/src/data/tuning.ts', root);
test('pinned read-only upstream source fixture loses only the metadata declaration',
  { skip: !existsSync(upstream) && 'optional upstream source fixture not present' }, () => {
    // Static text fixture only: never import or execute the original source.
    const before = readFileSync(upstream, 'utf8');
    assert.equal(sha256(before), manifest.files['data/tuning.js'].sourceSha256);
    const declaration = before.match(/^export const LIVE_TUNABLES: readonly TunableSpec\[\] = deepFreeze\(\[\n[^]*?^\]\);/m)?.[0];
    assert.ok(declaration);
    const after = prune(before);
    assert.equal(after, before.replace(declaration, ''));
    assert.match(after, /export const TUNING = deepFreeze\(\{/);
    assert.match(after, /export const POPULATION_CONTACT = Object.freeze\(\{/);
    assert.throws(() => prune(before.replace("path: 'EUC.maxLeanPitch'", "path: sideEffect()")), /metadata changed/);
    assert.throws(() => prune(`${before}\n${declaration}`), /metadata changed/);
  });
