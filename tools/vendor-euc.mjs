#!/usr/bin/env node
// tools/vendor-euc.mjs — copy the EUC riding systems out of a local EUC Thrills clone into js/euc/ as plain ES modules.
//
// usage: node tools/vendor-euc.mjs [--src ../EUC-thrills] [--check]
//        node tools/vendor-euc.mjs [--src ../EUC-thrills] --audit <dir>    (scan a whole tree, e.g. a release)
//
// The fork has no build step, so the TypeScript is converted once, here, and the JavaScript is committed. Each
// module keeps its upstream path (src/simulation/X.ts -> js/euc/simulation/X.js) and its upstream licence banner.
//
// Content scope: only original fictional characters. The scope is an allowlist (KEEP_* below): everything else in
// EUC Thrills' roster is excluded, including any rider added upstream later. This file names no excluded rider; the
// names to cut and to audit for are read from the roster itself (src/data/riders.ts, src/data/machines.ts) at run
// time. Hiding a character is not enough, so:
//   1. riderLook.ts and machineLook.ts are sliced: only the kept sections stay, and every import not on the keep list
//      is removed (OVERRIDES below).
//   2. tuning.ts loses the excluded riders' colour entries (keys named after an excluded roster id).
//   3. Comments are not carried (removeComments; /*! licence banners stay). Upstream prose names excluded riders.
//   4. The runtime import closure of the output is walked and every file and its text is audited against the
//      excluded ids and names. Any hit fails the run, and nothing is written.
//
// Needs TypeScript, resolved from the EUC Thrills clone's node_modules (npm ci there first). Node >= 18.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const SRC_ROOT = path.resolve(ROOT, argValue('--src', '../EUC-thrills'));
const CHECK_ONLY = args.includes('--check');
const AUDIT_DIR = argValue('--audit', null);
const OUT = path.join(ROOT, 'js', 'euc');
const EXPECTED_COMMIT = '5f45fff19b258e140833841ba2473069af751a12';

// The runtime entry points the fork imports. Everything else comes in through their imports.
const ENTRIES = [
  'simulation/EucController.ts',
  'simulation/planSampler.ts',
  'simulation/world.ts',
  'input/actions.ts',
  'render/chaseCamera.ts',
  'render/ridingRig.ts',
  'render/riderLook.ts',
  'render/machineLook.ts',
];

// The allowlist. Officer Dorkins is the roster's 'cop'; the standard wheel is the machine 'standard'.
const KEEP_IDS = new Set(['cool-rider', 'trollina', 'cop', 'standard']);
// Out of scope but fictional: may be named (tuning.ts's debug-panel labels for his ride style do), never shipped as
// a character. Every other excluded id is a real person and may never appear at all.
const FICTIONAL_EXCLUDED = new Set(['drunkard']);
// Ordinary words that open some excluded ids: never used alone as a rider-name prefix
const COMMON_WORDS = new Set(['wheel', 'red']);
// Kept sections of the sliced modules: up to and including these "// -- <title> ---" headers
const RIDER_LOOK_KEEP_THROUGH = "The cop's paintwork";
const MACHINE_LOOK_KEEP_THROUGH = "Trollina's standard-wheel livery";
const KEEP_IMPORTS = {
  'render/riderLook.ts': ['three', './coolRiderLook.ts', '../data/tuning.ts', './blockoutKit.ts'],
  'render/machineLook.ts': ['three', '../data/tuning.ts', './blockoutKit.ts'],
};
// Module names that are never a character but mark the excluded content (embedded logos and their decoder)
const GENERIC_DENY = /pngDecode|LogoAsset/;

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const camel = (id) => id.split('-').map((w, i) => (i ? cap(w) : w)).join('');
const wordsOf = (t) => t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean);

/** The excluded roster, read from upstream: ids, display names, and the audit and colour-key patterns. */
function readScope(srcRoot) {
  const riders = fs.readFileSync(path.join(srcRoot, 'src', 'data', 'riders.ts'), 'utf8');
  const machines = fs.readFileSync(path.join(srcRoot, 'src', 'data', 'machines.ts'), 'utf8');
  const union = (text, type) => {
    const m = new RegExp(`export type ${type} =([^;]*);`).exec(text);
    if (!m) throw new Error(`scope: type ${type} not found upstream; the roster format changed`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };
  const ids = new Set([...union(riders, 'PlayableCharacterId'), ...union(riders, 'CrashVoiceId'), ...union(machines, 'MachineId')]);
  for (const keep of ['cool-rider', 'trollina', 'standard']) if (!ids.has(keep)) throw new Error(`scope: kept id ${keep} missing upstream`);
  const excluded = [...ids].filter((id) => !KEEP_IDS.has(id));
  if (!excluded.length) throw new Error('scope: no excluded ids found upstream; refusing to trust the roster parse');
  const names = [...riders.matchAll(/id: '([^']+)'[^]*?name: '([^']+)'/g)]
    .filter(([, id]) => excluded.includes(id)).map(([, id, name]) => ({ id, name: name.replace(/^The /, '') }));

  // Colour keys: tuning.ts names an excluded rider's albedos after its id: for an id 'jane-doe', janeDoe*, jane*,
  // machineJaneDoe* and machineJane*
  const riderPrefixes = new Set();
  const machinePrefixes = new Set();
  for (const id of excluded) {
    const w = id.split('-');
    riderPrefixes.add(camel(id));
    machinePrefixes.add(`machine${cap(camel(id))}`);
    if (w.length > 1) {
      machinePrefixes.add(`machine${cap(w[0])}`);
      if (!COMMON_WORDS.has(w[0])) riderPrefixes.add(w[0]);
    }
  }
  const colourKey = new RegExp(`^\\s*(${[...machinePrefixes, ...riderPrefixes].map(escapeRe).join('|')})(?=[A-Z0-9]|\\s*:)\\w*\\s*:`);

  // Audit patterns, each tagged with the id it stands for. For an id 'jane-doe': the name as words or an identifier
  // on its own ("Jane Doe", jane-doe, JANE_DOE, janeDoe), as the tail of a camel-case identifier (createJaneDoe), and
  // the first name or the initials opening an identifier (janeAtlas, JANE_, jdLogo, JD_). Ordinary words inside
  // prose ("rendered rider", a helmet's seal) do not count.
  const patterns = [];
  const phrase = (text) => {
    const words = wordsOf(text);
    patterns.push({ id: phrase.id, re: new RegExp(`(?<![A-Za-z])${words.map(escapeRe).join('[ _-]?')}(?![a-z])`, 'i') });
    patterns.push({ id: phrase.id, re: new RegExp(`${words.map((w) => escapeRe(cap(w))).join('[ _-]?')}(?![a-z])`) });
  };
  for (const id of excluded) {
    phrase.id = id;
    phrase(id);
    const w = id.split('-');
    if (w.length > 1) {
      if (!COMMON_WORDS.has(w[0]) && w[0].length >= 4) {
        patterns.push({ id, re: new RegExp(`(?<![A-Za-z])(?:${escapeRe(w[0])}|${escapeRe(cap(w[0]))})(?=[A-Z_])|(?<![A-Za-z])${escapeRe(w[0].toUpperCase())}_`) });
      }
      const ini = w.map((x) => x[0]).join('');
      patterns.push({ id, re: new RegExp(`(?<![A-Za-z])(?:${ini}|${ini.toUpperCase()})(?=[A-Z_])`) });
    }
  }
  for (const { id, name } of names) {
    phrase.id = id;
    phrase(name);
  }
  return { excluded, colourKey, patterns };
}

/** Every excluded name in `line`: [{ id, text }]. */
function hitsIn(line, scope, { includeFictional = true, generic = true } = {}) {
  const hits = [];
  for (const { id, re } of scope.patterns) {
    if (!includeFictional && FICTIONAL_EXCLUDED.has(id)) continue;
    const m = re.exec(line);
    if (m) hits.push({ id, text: m[0] });
  }
  const g = generic && GENERIC_DENY.exec(line);
  if (g) hits.push({ id: '', text: g[0] });
  return hits;
}
// tuning.ts's debug-panel labels that name the fictional out-of-scope rider (numbers, not a character asset)
const ALLOW = [/^\s*group: 'Ride — the Drunkard',$/, /^\s*\+ "Drunkard's can through his thigh\./];

function keepImports(source, keep) {
  // Remove every whole `import ... from 'x';` / `export ... from 'x';` statement (single or multi-line) whose module is
  // not on the keep list.
  let removed = 0;
  const out = source.replace(/^(?:import|export)\b[^;]*?from\s+['"]([^'"]+)['"];\s*\n/gms, (all, spec) => {
    if (keep.includes(spec)) return all;
    removed++;
    return '';
  });
  if (!removed) throw new Error('override: expected imports to remove; the upstream file changed');
  return out;
}

// Keep the module up to the section after the "// -- <title> ---" header (that is, through the titled section)
function keepThrough(source, title) {
  const header = source.indexOf(`\n// -- ${title} `);
  if (header < 0) throw new Error(`override: section not found: ${title}`);
  const next = source.indexOf('\n// -- ', header + 1);
  if (next < 0) throw new Error(`override: no section after ${title}`);
  return source.slice(0, next);
}

const OVERRIDES = {
  // The city has stacked roads. Forward query height without changing the controller's tuning / contact maths.
  // Exact counts deliberately fail when the upstream query sites change.
  'simulation/EucController.ts': (src) => {
    let count = 0;
    let s = src.replace(/this\.sampler\.sampleGround\(([^;\n]+)\);/g, (all, args) => {
      count++;
      const y = args.startsWith('spawn.position') ? 'spawn.position.y'
        : args.startsWith('pelvis[') ? 'pelvis[RD_PELVIS * 3 + 1]'
        : args.startsWith('this.safeX') ? 'this.safeY' : 'this.y';
      return `this.sampler.sampleGround(${args}, ${y});`;
    });
    if (count !== 20) throw new Error(`controller height query sites changed: ${count}`);
    s = s.replace('private safeX = 0;', 'private safeX = 0;\n  private safeY = 0;');
    s = s.replace('this.x = this.spawn.position.x;', 'this.y = this.spawn.position.y;\n    this.x = this.spawn.position.x;');
    s = s.replace('destination.headingY, initialSpeed, placementReason)', 'destination.headingY, initialSpeed, placementReason, destination.position.y)');
    s = s.replace("reason: EucPlacementRequest['reason']): boolean", "reason: EucPlacementRequest['reason'], referenceY = reason === 'recover' ? this.safeY : this.y): boolean");
    s = s.replace('this.sampler.sampleGround(x, z, this.probe, this.y);', 'this.sampler.sampleGround(x, z, this.probe, referenceY);');
    s = s.replaceAll('this.safeX = this.x;', 'this.safeX = this.x; this.safeY = this.y;');
    s = s.replace('this.x = target.x;', 'this.y = target.y;\n    this.x = target.x;');
    s = s.replace('new Float64Array(3 * POPULATION_CONTACT.recoveryRingPoints)', 'new Float64Array(4 * POPULATION_CONTACT.recoveryRingPoints)');
    s = s.replaceAll('% size) * 3;', '% size) * 4;').replace('this.safeRingNext * 3;', 'this.safeRingNext * 4;');
    s = s.replace('ring[slot + 2] = this.safeHeading;', 'ring[slot + 2] = this.safeHeading; ring[slot + 3] = this.safeY;');
    s = s.replace('private recoveryTarget(restored: number): { x: number; z: number; headingY: number }',
      'private recoveryTarget(restored: number): { x: number; y: number; z: number; headingY: number }');
    s = s.replace('return { x: this.safeX, z: this.safeZ, headingY: this.safeHeading };',
      'return { x: this.safeX, y: this.safeY, z: this.safeZ, headingY: this.safeHeading };');
    s = s.replace("this.dynamicPlacementClear(x, z, headingY, restored, 'recover')) return { x, z, headingY };",
      "this.dynamicPlacementClear(x, z, headingY, restored, 'recover', ring[slot + 3])) return { x, y: ring[slot + 3], z, headingY };");
    s = s.replace('return { x, z, headingY: this.safeHeading };', 'return { x, y: this.safeY, z, headingY: this.safeHeading };');
    s = s.replace('this.sampler.sampleGround(x, z, ground, this.y);', 'this.sampler.sampleGround(x, z, ground, this.safeY);');
    s = s.replace('safePosition: { x: this.safeX, y: 0, z: this.safeZ }', 'safePosition: { x: this.safeX, y: this.safeY, z: this.safeZ }');
    return s;
  },
  'simulation/ragdoll.ts': (src) => {
    const ys = ['py', 'py', 'pos[RD_PELVIS * 3 + 1]', 'pos[base + 1]',
      'this.positions[RD_PELVIS * 3 + 1]', 'o[1]', 'p[b + 1]'];
    let count = 0;
    const s = src.replace(/sampler\.sampleGround\(([^;\n]+)\);/g, (all, args) =>
      `sampler.sampleGround(${args}, ${ys[count++]});`);
    if (count !== ys.length) throw new Error(`ragdoll height query sites changed: ${count}`);
    return s;
  },
  'simulation/world.ts': (src) => src.replace('sampleGround(x: number, z: number, out: GroundSample): GroundSample;',
    'sampleGround(x: number, z: number, out: GroundSample, referenceY?: number): GroundSample;'),
  'simulation/eucStepPrimitives.ts': (src) => src.replace("'safeX', 'safeZ'", "'safeX', 'safeY', 'safeZ'")
    .replace('to.safeX = from.safeX;', 'to.safeX = from.safeX;\n  to.safeY = from.safeY;'),
  'render/riderLook.ts': (src) => {
    let s = keepImports(src, KEEP_IMPORTS['render/riderLook.ts']);
    s = s.replace("import { COOL_RIDER_LOOK } from './coolRiderLook.ts';",
      "import { COOL_RIDER_LOOK } from './coolRiderLook.ts';\n/** euc-newyork: the roster ids are plain strings here (data/riders.ts is not vendored). */\nexport type CharacterId = string;");
    s = keepThrough(s, RIDER_LOOK_KEEP_THROUGH);
    return `${s}
// -- euc-newyork roster ------------------------------------------------------
// Upstream continues with riders outside this fork's scope. They are cut (see tools/vendor-euc.mjs).
export const RIDER_LOOKS: readonly RiderLook[] = Object.freeze([COOL_RIDER_LOOK, TROLLINA_LOOK, COP_LOOK]);
export const PLAYABLE_RIDER_LOOKS: readonly RiderLook[] = Object.freeze([COOL_RIDER_LOOK, TROLLINA_LOOK]);
export function riderLook(id: CharacterId): RiderLook {
  return RIDER_LOOKS.find((look) => look.id === id) ?? COOL_RIDER_LOOK;
}
`;
  },
  'render/machineLook.ts': (src) => {
    let s = keepImports(src, KEEP_IMPORTS['render/machineLook.ts']);
    s = s.replace("import { loftProfile,",
      "/** euc-newyork: machine ids are plain strings here (data/machines.ts is not vendored). */\nexport type MachineId = string;\nconst DEFAULT_MACHINE: MachineId = 'standard';\nimport { loftProfile,");
    s = keepThrough(s, MACHINE_LOOK_KEEP_THROUGH);
    return `${s}
// -- euc-newyork machines ----------------------------------------------------
// Upstream continues with machines outside this fork's scope. They are cut (see tools/vendor-euc.mjs).
export const MACHINE_LOOKS: readonly MachineLook[] = Object.freeze([STANDARD_MACHINE_LOOK, TROLLINA_MACHINE_LOOK]);
export function machineLook(id: MachineId): MachineLook {
  return MACHINE_LOOKS.find((look) => look.machine === id)
    ?? MACHINE_LOOKS.find((look) => look.machine === DEFAULT_MACHINE)
    ?? MACHINE_LOOKS[0];
}
`;
  },
  'data/tuning.ts': (src, removed) => src.split('\n').filter((line) => {
    const m = SCOPE.colourKey.exec(line);
    if (!m) return true;
    removed.push(line.trim().split(':')[0]);
    return false;
  }).join('\n'),
};

const require = createRequire(path.join(SRC_ROOT, 'package.json'));
let ts;
try {
  ts = require('typescript');
} catch {
  console.error(`typescript not found under ${SRC_ROOT}/node_modules — run \`npm ci\` in the EUC Thrills clone first.`);
  process.exit(1);
}

const SCOPE = readScope(SRC_ROOT);

// --audit <dir>: scan every text file of a tree (a release) for an excluded real person. The fictional out-of-scope
// rider may be named in a tree's notices and tools, and this tool's own generic module markers are not names, so
// neither is looked for here.
if (AUDIT_DIR) {
  const root = path.resolve(AUDIT_DIR);
  const found = [];
  let files = 0;
  // Third-party files kept byte for byte (vendor/MANIFEST.json, tools/vendor-three.mjs: three.js, the fonts) are
  // skipped while their hash matches: three.js's own variable names (mv, MV, RR...) are not names of people. A changed
  // copy is scanned like any other file.
  const pristine = new Set();
  const manifestPath = path.join(root, 'vendor', 'MANIFEST.json');
  if (fs.existsSync(manifestPath)) {
    for (const [file, hash] of Object.entries(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files ?? {})) {
      const full = path.join(root, file);
      if (fs.existsSync(full) && crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') === hash) {
        pristine.add(path.normalize(file));
      }
    }
  }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      for (const h of hitsIn(rel, SCOPE, { includeFictional: false, generic: false })) found.push(`path ${rel}: "${h.text}"`);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(wav|png|jpe?g|gif|webp|ico|woff2?|ttf|bin)$/i.test(entry.name)) continue;
      if (pristine.has(path.normalize(rel))) continue;
      files++;
      fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        for (const h of hitsIn(line, SCOPE, { includeFictional: false, generic: false })) found.push(`${rel}:${i + 1}: "${h.text}"`);
      });
    }
  };
  walk(root);
  if (found.length) {
    console.error(`Tree audit FAILED (${found.length}) in ${root}:`);
    for (const f of found.slice(0, 60)) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`tree audit clean: ${files} text files, ${SCOPE.excluded.length} excluded roster ids checked`
    + (pristine.size ? ` (${pristine.size} unchanged third-party files in vendor/MANIFEST.json skipped)` : ''));
  process.exit(0);
}

const commit = execFileSync('git', ['-C', SRC_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', SRC_ROOT, 'status', '--porcelain', '--', 'src'], { encoding: 'utf8' }).trim();
if (commit !== EXPECTED_COMMIT) console.warn(`warning: EUC Thrills is at ${commit}, expected ${EXPECTED_COMMIT}. Review the diff before committing.`);
if (dirty) {
  console.error('EUC Thrills src/ has local changes; vendor only from a clean upstream checkout.');
  process.exit(1);
}

// Static import/export-from statements (esbuild prints them at the start of a line), bare imports and import().
const SPEC = /(?:^(?:import|export)\b[^;'"]*?\bfrom\s*|^import\s*|\bimport\s*\(\s*)(['"])([^'"\n]+)\1/gm;
const outputs = new Map(); // rel -> { js, sha }
const removedColourKeys = [];
const queue = [...ENTRIES];
while (queue.length) {
  const rel = queue.shift();
  if (outputs.has(rel)) continue;
  const file = path.join(SRC_ROOT, 'src', rel);
  const raw = fs.readFileSync(file, 'utf8');
  const source = OVERRIDES[rel] ? OVERRIDES[rel](raw, removedColourKeys) : raw;
  const { outputText: code, diagnostics } = ts.transpileModule(source, {
    fileName: `src/${rel}`,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
      removeComments: true,
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: false,
    },
  });
  if (diagnostics?.length) throw new Error(`${rel}: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ')}`);
  let js = code;
  for (const match of code.matchAll(SPEC)) {
    const spec = match[2];
    if (!spec.startsWith('.')) {
      if (spec !== 'three') throw new Error(`${rel}: unexpected external import ${spec}`);
      continue;
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    if (!target.endsWith('.ts')) throw new Error(`${rel}: import without .ts extension: ${spec}`);
    queue.push(target);
  }
  js = js.replace(SPEC, (all, q, spec) => (spec.startsWith('.') ? all.replace(spec, spec.replace(/\.ts$/, '.js')) : all));
  const header = `// Vendored by tools/vendor-euc.mjs from VibezZzCoder/EUC-thrills@${commit.slice(0, 7)} src/${rel}` +
    `${OVERRIDES[rel] ? ' (sliced for euc-newyork: see the tool)' : ''}.\n// MIT, (c) 2026 VibezZzCoder. See js/euc/LICENSE and NOTICE-EUC-THRILLS.md. Do not edit; re-run the tool.\n`;
  outputs.set(rel, { js: header + js, sha: crypto.createHash('sha256').update(raw).digest('hex') });
}

// -- Content audit ---------------------------------------------------------------------------------------------------
const problems = [];
for (const [rel, { js }] of outputs) {
  for (const h of hitsIn(rel, SCOPE)) problems.push(`excluded module in closure: ${rel} ("${h.text}")`);
  js.split('\n').forEach((line, i) => {
    const hits = hitsIn(line, SCOPE);
    if (!hits.length) return;
    const allowed = rel === 'data/tuning.ts' && hits.every((h) => FICTIONAL_EXCLUDED.has(h.id)) && ALLOW.some((a) => a.test(line));
    if (!allowed) problems.push(`${rel}:${i + 1}: "${hits[0].text}" in: ${line.trim().slice(0, 140)}`);
  });
  for (const key of removedColourKeys) {
    if (new RegExp(`\\b${key}\\b`).test(js)) problems.push(`${rel}: still references removed colour ${key}`);
  }
}
if (problems.length) {
  console.error(`Content audit FAILED (${problems.length}):`);
  for (const p of problems.slice(0, 60)) console.error(`  ${p}`);
  process.exit(1);
}

// -- Write -----------------------------------------------------------------------------------------------------------
const manifest = {
  upstream: 'https://github.com/VibezZzCoder/EUC-thrills',
  commit,
  generatedBy: 'tools/vendor-euc.mjs',
  entries: ENTRIES,
  // A count, not the names: the names are the excluded riders' (read from the upstream roster, see readScope)
  removedColourEntries: removedColourKeys.length,
  files: Object.fromEntries([...outputs].sort(([a], [b]) => a.localeCompare(b)).map(([rel, o]) => [rel.replace(/\.ts$/, '.js'), { source: `src/${rel}`, sourceSha256: o.sha, sliced: !!OVERRIDES[rel] }])),
};
if (CHECK_ONLY) {
  let stale = 0;
  for (const [rel, { js }] of outputs) {
    const target = path.join(OUT, rel.replace(/\.ts$/, '.js'));
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== js) { console.error(`stale: ${rel}`); stale++; }
  }
  console.log(stale ? `${stale} stale file(s)` : `js/euc is up to date (${outputs.size} files, audit clean)`);
  process.exit(stale ? 1 : 0);
}
fs.rmSync(OUT, { recursive: true, force: true });
for (const [rel, { js }] of outputs) {
  const target = path.join(OUT, rel.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, js);
}
fs.copyFileSync(path.join(SRC_ROOT, 'LICENSE'), path.join(OUT, 'LICENSE'));
// index.html preloads every vendored module (tests/boot.test.cjs: everything a preloaded module imports is preloaded)
const INDEX = path.join(ROOT, 'index.html');
const START = '<!-- euc:preload:start (tools/vendor-euc.mjs) -->', END = '<!-- euc:preload:end -->';
const html = fs.readFileSync(INDEX, 'utf8');
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < a) throw new Error('index.html: euc preload markers not found');
const lines = [...outputs.keys()].sort().map((rel) => `  <link rel="modulepreload" href="./js/euc/${rel.replace(/\.ts$/, '.js')}" />`);
fs.writeFileSync(INDEX, `${html.slice(0, a + START.length)}\n${lines.join('\n')}\n  ${html.slice(b)}`);
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const bytes = [...outputs.values()].reduce((n, o) => n + Buffer.byteLength(o.js), 0);
console.log(`wrote ${outputs.size} modules (${Math.round(bytes / 1024)} KiB) to js/euc from EUC-thrills@${commit.slice(0, 7)}; ` +
  `removed ${removedColourKeys.length} restricted colour entries; content audit clean`);
