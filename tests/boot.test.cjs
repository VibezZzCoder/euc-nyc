const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
const importMap = html.match(/<script type="importmap">([^]*?)<\/script>/);
const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"\s*\/>/g)];
const entries = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)];

test('city module preloads start after the import map and before stylesheets', () => {
  assert.ok(importMap);
  assert.ok(preloads.length > 0);
  const stylesheetIndex = html.indexOf('rel="stylesheet"');
  for (const preload of preloads) {
    assert.ok(importMap.index < preload.index);
    assert.ok(preload.index < stylesheetIndex);
  }
  assert.equal(entries.length, 1);
  assert.ok(importMap.index < entries[0].index);
  assert.ok(entries[0].index < stylesheetIndex, 'the module graph starts loading early too');
  assert.doesNotMatch(html, /<(?:link|script)\b[^>]*(?:src|href)="(?:https?:)?\/\//i, 'nothing loads from another host');
  assert.doesNotMatch(importMap[1], /https?:\/\//, 'three.js is served from this repo');
  const { imports } = JSON.parse(importMap[1]);
  assert.equal(imports.three, imports['three/webgpu'], 'Three.js aliases share one module instance');
});

test('native module entry and imports share canonical preloaded URLs on GitHub Pages', () => {
  // three.js's vendored modules (vendor/MANIFEST.json) are preloaded too, ahead of the city's
  const manifest = JSON.parse(readFileSync(join(__dirname, '../vendor/MANIFEST.json'), 'utf8'));
  const three = Object.keys(manifest.files).filter((f) => f.startsWith('vendor/three/') && f.endsWith('.js')).map((f) => `./${f}`);
  const all = preloads.map((match) => match[1]);
  assert.deepEqual(all.slice(0, three.length).sort(), [...three].sort(), 'every vendored three.js module is preloaded first');
  const links = all.slice(three.length);
  // Generated eager modules are boot dependencies; selected appearances/atlases/logos remain deferred.
  // Derive native coverage from the actual static graph rather than a brittle native-module count.
  const euc = JSON.parse(readFileSync(join(__dirname, '../js/euc/MANIFEST.json'), 'utf8'));
  const generated = Object.keys(euc.files).sort();
  assert.ok(Array.isArray(euc.eager) && Array.isArray(euc.deferred));
  assert.deepEqual([...euc.eager, ...euc.deferred].sort(), generated,
    'eager/deferred partition covers every generated file exactly once');
  const eager = euc.eager.map(file => `./js/euc/${file}`);
  const deferred = new Set(euc.deferred.map(file => `./js/euc/${file}`));
  assert.deepEqual(links.filter(src => src.startsWith('./js/euc/')).sort(), [...eager].sort(),
    'preload exactly the generated eager set, never all roster modules');
  for (const file of deferred) assert.ok(!all.includes(file), `selected appearance is not eagerly preloaded: ${file}`);
  assert.equal(new Set(links).size, links.length, 'each module is preloaded once');
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], './js/boot.js');
  assert.ok(links.includes('./js/main.js'), 'the dynamic game entry is still preloaded');
  assert.equal([...html.matchAll(/<script\b/g)].length, 3, 'early viewport correction, import map and independent boot script');
  assert.match(html, /<head>\s*<script>[\s\S]*?window\.scrollTo\(0, 0\);[\s\S]*?<\/script>/,
    'viewport correction runs before the import map and boot script');
  const base = 'https://example.test/slop-newyork/';
  const urls = new Set(all.map((src) => new URL(src, base).href));
  const { imports } = JSON.parse(importMap[1]);
  const resolve = (specifier, from) => {
    if (specifier.startsWith('.')) return new URL(specifier, new URL(from, base)).href;
    if (imports[specifier]) return new URL(imports[specifier], base).href;
    const prefix = Object.keys(imports).find((k) => k.endsWith('/') && specifier.startsWith(k));
    return prefix ? new URL(imports[prefix] + specifier.slice(prefix.length), base).href : null;
  };
  const staticImports = source => [...source.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)]
    .map(([, from, sideEffect]) => from || sideEffect);
  const canonical = url => {
    assert.ok(url && url.startsWith(base), `module stays local to the Pages subpath: ${url}`);
    return `./${url.slice(base.length)}`;
  };
  const expected = new Set([...three, ...eager, './js/main.js']);
  const queue = [...expected];
  for (let i = 0; i < queue.length; i++) {
    const src = queue[i];
    const source = readFileSync(join(__dirname, '..', src), 'utf8');
    for (const specifier of staticImports(source)) {
      const dependency = canonical(resolve(specifier, src));
      assert.ok(!deferred.has(dependency), `${src} statically imports deferred appearance code: ${specifier}`);
      if (!expected.has(dependency)) { expected.add(dependency); queue.push(dependency); }
    }
  }
  assert.deepEqual([...all].sort(), [...expected].sort(),
    'preload the static boot closure plus manifest eager dependencies, without stale native preloads');
  const lazyTargets = new Set();
  for (const src of eager) {
    const source = readFileSync(join(__dirname, '..', src), 'utf8');
    for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const dependency = canonical(resolve(specifier, src));
      assert.ok(deferred.has(dependency), `${src} lazy import is listed in manifest.deferred: ${specifier}`);
      assert.ok(!all.includes(dependency), `lazy appearance has no preload: ${dependency}`);
      lazyTargets.add(dependency);
    }
  }
  assert.ok(lazyTargets.size >= euc.roster.length, 'loader retains explicit lazy targets for the reviewed roster');
  for (const target of Object.values(imports)) {
    assert.match(target, /^\.\/vendor\/three\//, 'the import map points into vendor/three/');
    if (!target.endsWith('/')) assert.ok(urls.has(new URL(target, base).href), `import map target preloaded: ${target}`);
  }
  for (const src of all) {
    assert.match(src, /^\.\/(js\/(euc\/\w+\/)?[\w-]+|vendor\/three\/[\w/.-]+)\.js$/, 'preloads use the same unversioned paths as native imports');
    const source = readFileSync(join(__dirname, '..', src), 'utf8');
    // Statements that start a line (JSDoc examples in three.js don't)
    for (const [, from, sideEffect] of source.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) {
      const specifier = from || sideEffect;
      if (!specifier) continue;
      const url = resolve(specifier, src);
      assert.ok(url && urls.has(url), `${src} imports an unpreloaded or mismatched URL: ${specifier}`);
    }
  }
});

test('the title has one shared picker entry, selected-audio readiness and a same-tab main-menu link', () => {
  const overlay = html.match(/<section id="title-overlay"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(overlay, 'title overlay present');
  assert.match(overlay[0], /<section id="title-overlay"[^>]*\bhidden\b/, 'hidden until the city is ready');
  assert.match(overlay[1], /id="title-ride"/);
  assert.match(overlay[1], /id="title-rider"/);
  assert.doesNotMatch(overlay[1], /data-title-rider=/, 'roster entries come from the shared metadata, not duplicate HTML');
  for (const id of ['title-status', 'title-retry', 'title-cancel']) assert.ok(overlay[1].includes(`id="${id}"`));
  const home = overlay[1].match(/<a\b[^>]*id="title-main-menu"[^>]*>/)?.[0];
  assert.ok(home, 'title return is an ordinary anchor');
  assert.match(home, /href="https:\/\/vibezzzcoder\.github\.io\/EUC-thrills\/"/);
  assert.doesNotMatch(home, /target=/, 'return stays in the same tab');
  assert.match(overlay[1], /OpenStreetMap contributors/, 'map credit on the title too');
});

test('the corner link points to this game\'s own repo; EUC Thrills keeps its credit links', () => {
  const link = html.match(/<a class="repo-link" href="([^"]+)"/);
  assert.ok(link, 'the corner repo link exists');
  assert.equal(link[1], 'https://github.com/VibezZzCoder/euc-nyc');
  assert.match(html, /href="https:\/\/github\.com\/VibezZzCoder\/EUC-thrills"[^>]*><i>EUC Thrills<\/i><\/a> by VibezZzCoder/, 'map credits link EUC Thrills');
  assert.match(html, /class="title-credits">Riding and riders from <em>EUC Thrills<\/em> by VibezZzCoder/);
});
