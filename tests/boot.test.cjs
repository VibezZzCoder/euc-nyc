const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
const importMap = html.match(/<script type="importmap">([^]*?)<\/script>/);
const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"\s*\/>/g)];
const entries = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)];

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
  // 31 city modules (29 upstream + pedestrian-routes.js, which upstream missed, + solid-rects.js), the 5 EUC modules (terrain, rider,
  // dynamic world, audio, HUD) and every module
  // tools/vendor-euc.mjs copied into js/euc/ (listed in its MANIFEST.json)
  const vendored = Object.keys(JSON.parse(readFileSync(join(__dirname, '../js/euc/MANIFEST.json'), 'utf8')).files);
  assert.equal(links.length, 31 + 5 + vendored.length);
  for (const file of vendored) assert.ok(links.includes(`./js/euc/${file}`), `vendored module preloaded: ${file}`);
  assert.equal(new Set(links).size, links.length, 'each module is preloaded once');
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], './js/main.js');
  assert.ok(links.includes(entries[0][1]));
  assert.equal([...html.matchAll(/<script\b/g)].length, 2, 'only the import map and native entry are needed');
  const base = 'https://example.test/slop-newyork/';
  const urls = new Set(all.map((src) => new URL(src, base).href));
  const { imports } = JSON.parse(importMap[1]);
  const resolve = (specifier, from) => {
    if (specifier.startsWith('.')) return new URL(specifier, new URL(from, base)).href;
    if (imports[specifier]) return new URL(imports[specifier], base).href;
    const prefix = Object.keys(imports).find((k) => k.endsWith('/') && specifier.startsWith(k));
    return prefix ? new URL(imports[prefix] + specifier.slice(prefix.length), base).href : null;
  };
  for (const target of Object.values(imports)) {
    assert.match(target, /^\.\/vendor\/three\//, 'the import map points into vendor/three/');
    if (!target.endsWith('/')) assert.ok(urls.has(new URL(target, base).href), `import map target preloaded: ${target}`);
  }
  for (const src of all) {
    assert.match(src, /^\.\/(js\/(euc\/\w+\/)?[\w-]+|vendor\/three\/[\w/.-]+)\.js$/, 'preloads use the same unversioned paths as native imports');
    const source = readFileSync(join(__dirname, '..', src), 'utf8');
    // Statements that start a line (JSDoc examples in three.js don't)
    for (const [, specifier] of source.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) {
      if (!specifier) continue;
      const url = resolve(specifier, src);
      assert.ok(url && urls.has(url), `${src} imports an unpreloaded or mismatched URL: ${specifier}`);
    }
  }
});
