// Real generated modules and pinned Three core, isolated Node loader hooks; no browser/GPU/test hooks in game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const manifest = JSON.parse(read('js/euc/MANIFEST.json'));
const loaded = new Set();
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') return { url: new URL('vendor/three/build/three.core.js', root).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) { loaded.add(url); return next(url, context); },
});

const { prepareAppearance, releaseAppearanceCaches, appearanceResourceStats } = await import('../js/euc/render/appearanceLoader.js');
const { createRidingRig } = await import('../js/euc/render/ridingRig.js');
const { createPlaceholderRider } = await import('../js/euc/render/rider.js');
const { riderLook, COP_LOOK } = await import('../js/euc/render/riderLook.js');
const { machineLook } = await import('../js/euc/render/machineLook.js');
const { createBlockoutEUC } = await import('../js/euc/render/euc.js');
const { CHARACTERS, CHARACTER_IDS, rideStyleFor } = await import('../js/euc/data/riders.js');
const { machineForCharacter } = await import('../js/euc/data/machines.js');
const { SOBER_STYLE, DRUNK_STYLE } = await import('../js/euc/data/rideStyles.js');
const { createPose } = await import('../js/euc/simulation/EucController.js');

const hash = data => createHash('sha256').update(data).digest('hex');
function riderSignature(rider) {
  const result = [];
  const group = rider.group ?? rider.root;
  group.updateMatrixWorld(true);
  group.traverse(node => {
    if (!node.isMesh) return;
    const g = node.geometry;
    const materials = (Array.isArray(node.material) ? node.material : [node.material]).map(m => ({
      colour: m.color?.getHex(), roughness: m.roughness, metalness: m.metalness,
      emissive: m.emissive?.getHex(), emissiveIntensity: m.emissiveIntensity, opacity: m.opacity,
      map: m.map && { width: m.map.image.width, height: m.map.image.height, pixels: hash(m.map.image.data) },
    }));
    result.push({ name: node.name, matrix: node.matrixWorld.elements, cast: node.castShadow, materials,
      index: g.index && hash(new Uint8Array(g.index.array.buffer)),
      attributes: Object.fromEntries(Object.entries(g.attributes).map(([key, a]) => [key, hash(new Uint8Array(a.array.buffer))])) });
  });
  return result;
}

test('actual initial imports defer every player look/atlas/logo, including the default; cop remains constructible', () => {
  for (const file of manifest.deferred) assert.ok(!loaded.has(new URL(`js/euc/${file}`, root).href), file);
  assert.throws(() => riderLook('cool-rider'), /not prepared/);
  assert.equal(riderLook('cop'), COP_LOOK);
  const cop = createRidingRig(COP_LOOK);
  try { cop.apply(createPose()); assert.ok(cop.group.children.length); } finally { cop.dispose(); }
  assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
});

test('reviewed eleven IDs, machine and style mappings are complete; fixed import selection rejects hostile IDs', async () => {
  assert.deepEqual(CHARACTER_IDS, manifest.roster.map(r => r.id));
  assert.equal(CHARACTERS.length, 11);
  assert.ok(!CHARACTER_IDS.includes('cop'));
  for (const row of manifest.roster) {
    assert.equal(machineForCharacter(row.id), row.machine);
    assert.equal(rideStyleFor(row.id), row.id === 'drunkard' ? DRUNK_STYLE : SOBER_STYLE);
  }
  assert.equal(rideStyleFor('cop'), SOBER_STYLE);
  for (const id of ['cop', '__proto__', 'constructor', '../private', '', null]) {
    await assert.rejects(prepareAppearance(id), /Unknown playable appearance/);
  }
});

test('all eleven real rigs construct/apply/dispose; cache release is pixel-exact and repeated cycles plateau', async t => {
  for (let cycle = 0; cycle < 2; cycle++) for (const row of manifest.roster) {
    releaseAppearanceCaches();
    const start = performance.now();
    const appearance = await prepareAppearance(row.id);
    const importMs = performance.now() - start;
    assert.equal(appearance.look.id, row.id);
    assert.equal(appearance.machine.machine, row.machine);
    assert.equal(riderLook(row.id), appearance.look);
    assert.deepEqual(machineLook(row.machine), appearance.machine);
    assert.equal(appearanceResourceStats().cachedPixelBytes, 0, 'module import performs no atlas painting');
    const buildStart = performance.now();
    const rig = createRidingRig(appearance.look, appearance.machine);
    const buildMs = performance.now() - buildStart;
    try {
      const pose = createPose();
      for (const overrides of [{}, { speed: 10, steer: 0.7, crouch: 1 }, { airborne: true, styleSway: 0.5 }]) {
        Object.assign(pose, overrides); rig.apply(pose); rig.group.updateMatrixWorld(true);
        rig.group.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite), `${row.id}: finite transforms`));
      }
      const before = riderSignature(rig);
      const bytes = appearanceResourceStats().cachedPixelBytes;
      assert.ok(bytes <= 16 * 1024 * 1024, `${row.id}: bounded selected caches (${bytes})`);
      releaseAppearanceCaches();
      assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
      assert.deepEqual(riderSignature(rig), before, 'releasing module ownership cannot mutate active textures');
      if (!cycle) t.diagnostic(`${row.id}: import ${importMs.toFixed(1)} ms; synchronous construction ${buildMs.toFixed(1)} ms; CPU cache ${bytes} bytes`);
    } finally { rig.dispose(); releaseAppearanceCaches(); }
    assert.equal(appearanceResourceStats().cachedPixelBuffers, 0);
    assert.ok(appearanceResourceStats().preparedIds.length <= 2);
  }
});

const originalRoot = new URL('../EUC-thrills/src/', root);
test('each generated rider matches actual original geometry, materials and logo/atlas pixels byte-for-byte',
  { skip: !existsSync(originalRoot) && 'optional read-only pinned source fixture absent' }, async () => {
    const upstreamLooks = await import(new URL('render/riderLook.ts', originalRoot));
    const upstreamRider = await import(new URL('render/rider.ts', originalRoot));
    const upstreamMachines = await import(new URL('render/machineLook.ts', originalRoot));
    for (const row of manifest.roster) {
      releaseAppearanceCaches();
      const { look } = await prepareAppearance(row.id);
      const actual = createPlaceholderRider(look), expected = upstreamRider.createPlaceholderRider(upstreamLooks.riderLook(row.id));
      try { assert.deepEqual(riderSignature(actual), riderSignature(expected), row.id); }
      finally { actual.dispose(); expected.dispose(); releaseAppearanceCaches(); }
      const { machine } = await prepareAppearance(row.id);
      const actualMachine = createBlockoutEUC(machine), expectedMachine = createBlockoutEUC(upstreamMachines.machineLook(row.machine));
      try { assert.deepEqual(riderSignature(actualMachine), riderSignature(expectedMachine), `${row.id}: original machine art through adapted wheel builder`); }
      finally { actualMachine.dispose(); expectedMachine.dispose(); releaseAppearanceCaches(); }
    }
  });

test('manifest pins every generated byte and records exact module/audio provenance', () => {
  assert.equal(manifest.commit, '5f45fff19b258e140833841ba2473069af751a12');
  assert.equal(manifest.audio.length, 18);
  for (const [file, record] of Object.entries(manifest.files)) {
    assert.equal(hash(read(`js/euc/${file}`)), record.outputSha256, file);
    if (record.source) assert.match(record.sourceSha256, /^[a-f0-9]{64}$/);
    else assert.ok(Array.isArray(record.derivedFrom), `${file}: synthetic source chain`);
  }
  for (const item of manifest.audio) assert.match(item.sourceSha256, /^[a-f0-9]{64}$/);
  const block = read('index.html').match(/<!-- euc:preload:start \(tools\/vendor-euc\.mjs\) -->([^]*?)<!-- euc:preload:end -->/)[1];
  assert.doesNotMatch(block, /Atlas|LogoAsset|riderAppearance|machineAppearance|coolRiderLook|inkKit|pngDecode/);
});

test('source inventory rejects a future roster ID, removed voice or machine without touching the reference clone', () => {
  const tool = read('tools/vendor-euc.mjs');
  const constants = tool.slice(tool.indexOf('const REVIEWED_ROSTER ='), tool.indexOf('// Reviewed logos are allowed.'));
  const scope = tool.slice(tool.indexOf('function readScope('), tool.indexOf('\nfunction hitsIn('));
  const ids = manifest.roster.map(row => row.id);
  const voices = ids.map(id => id === 'maribel-vargas' ? 'maribel' : id);
  const machineIds = manifest.roster.map(row => row.machine);
  const union = (name, values) => `export type ${name} = ${values.map(v => `'${v}'`).join(' | ')};`;
  const check = (players = ids, crash = voices, machines = machineIds) => {
    const fs = { readFileSync(file) {
      return file.endsWith('riders.ts') ? union('PlayableCharacterId', players) + union('CrashVoiceId', crash) : union('MachineId', machines);
    } };
    return new Function('fs', 'path', `${constants}\n${scope}\nreturn readScope('/fixture');`)(fs, path);
  };
  assert.deepEqual(check().reviewed, ids);
  assert.throws(() => check([...ids, 'future-rider']), /Unreviewed/);
  assert.throws(() => check([], voices), /kept id|roster/);
  assert.throws(() => check(ids, voices.slice(1)), /voices inventory/);
  assert.throws(() => check(ids, voices, machineIds.slice(0, -1)), /machines inventory/);
});

test('tree audit accepts reviewed roster/logo bytes and rejects private paths, changed payloads and future modules/audio',
  { skip: !existsSync(originalRoot) && 'optional upstream checkout required by generator CLI' }, () => {
    const temp = mkdtempSync(path.join(existsSync('/tmp/opencode') ? '/tmp/opencode' : tmpdir(), 'euc-roster-audit-'));
    const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('tools/vendor-euc.mjs', root)), '--audit', temp], { encoding: 'utf8' });
    try {
      mkdirSync(path.join(temp, 'js'));
      cpSync(fileURLToPath(new URL('js/euc', root)), path.join(temp, 'js/euc'), { recursive: true });
      writeFileSync(path.join(temp, 'NOTICE.md'), CHARACTERS.map(c => c.name).join('\n'));
      let result = run(); assert.equal(result.status, 0, result.stderr);
      writeFileSync(path.join(temp, 'NOTICE.md'), 'The original drawing is held privately under `references/` and is not redistributed.');
      result = run(); assert.equal(result.status, 0, 'a bare notice directory mention does not waive actual file/path checks: ' + result.stderr);
      const privateFixture = path.posix.join('references', 'private-photo.png');
      writeFileSync(path.join(temp, 'leak.js'), `export const reference = ${JSON.stringify(privateFixture)};`);
      result = run(); assert.notEqual(result.status, 0);
      assert.match(result.stderr, /leak\.js:1:/);
      assert.ok(result.stderr.includes(privateFixture.slice(0, privateFixture.indexOf('/') + 2)));
      rmSync(path.join(temp, 'leak.js'));
      mkdirSync(path.join(temp, 'references')); writeFileSync(path.join(temp, 'references', 'secret.bin'), 'fixture');
      result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /private path|path .*references/);
      rmSync(path.join(temp, 'references'), { recursive: true });
      const extra = path.join(temp, 'js/euc/render/futureRider.js'); writeFileSync(extra, 'export const future = true;');
      result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /unreviewed or changed generated module/);
      rmSync(extra);
      const payload = path.join(temp, 'js/euc/data/mvLogoAsset.js'); writeFileSync(payload, 'export const logo = "changed";');
      result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /unreviewed or changed generated module/);
      cpSync(fileURLToPath(new URL('js/euc/data/mvLogoAsset.js', root)), payload);
      mkdirSync(path.join(temp, 'audio/euc'), { recursive: true });
      writeFileSync(path.join(temp, 'audio/euc/future_crash.wav'), 'fixture');
      result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /unreviewed or changed EUC audio/);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
