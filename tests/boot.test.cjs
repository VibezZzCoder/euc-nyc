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
  // 32 city modules (29 upstream + pedestrian-routes.js, fire-escapes.js (upstream 8c17250) + solid-rects.js), the 21 fork modules
  // (EUC terrain, recovery, rider, tricks, dynamic world, audio, HUD; the title screen; the chasing cop, his brain, chase rules, paddle swing and audio;
  // the north end's barricades; construction-time ride geometry helpers; view preferences/frame pacing; the civic jail; booking lifecycle/scene; Jefferson skatepark) and every module tools/vendor-euc.mjs copied into
  // js/euc/ (listed in its MANIFEST.json)
  const vendored = Object.keys(JSON.parse(readFileSync(join(__dirname, '../js/euc/MANIFEST.json'), 'utf8')).files);
  assert.equal(links.length, 32 + 21 + vendored.length);
  for (const file of vendored) assert.ok(links.includes(`./js/euc/${file}`), `vendored module preloaded: ${file}`);
  assert.equal(new Set(links).size, links.length, 'each module is preloaded once');
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], './js/boot.js');
  assert.ok(links.includes('./js/main.js'), 'the dynamic game entry is still preloaded');
  assert.equal([...html.matchAll(/<script\b/g)].length, 2, 'only the import map and independent boot script are needed');
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

test('the title screen is in the page from the start, hidden, with a Ride button and a button per playable rider', () => {
  const overlay = html.match(/<section id="title-overlay"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(overlay, 'title overlay present');
  assert.match(overlay[0], /<section id="title-overlay"[^>]*\bhidden\b/, 'hidden until the city is ready');
  assert.match(overlay[1], /id="title-ride"/);
  const riders = [...overlay[1].matchAll(/data-title-rider="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(riders, ['cool-rider', 'trollina']);
  assert.match(overlay[1], /OpenStreetMap contributors/, 'map credit on the title too');
});

test('the corner link points to this game\'s own repo; EUC Thrills keeps its credit links', () => {
  const link = html.match(/<a class="repo-link" href="([^"]+)"/);
  assert.ok(link, 'the corner repo link exists');
  assert.equal(link[1], 'https://github.com/VibezZzCoder/euc-nyc');
  assert.match(html, /href="https:\/\/github\.com\/VibezZzCoder\/EUC-thrills"[^>]*><i>EUC Thrills<\/i><\/a> by VibezZzCoder/, 'map credits link EUC Thrills');
  assert.match(html, /class="title-credits">Riding and riders from <em>EUC Thrills<\/em> by VibezZzCoder/);
});
