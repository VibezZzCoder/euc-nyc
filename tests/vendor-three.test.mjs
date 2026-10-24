// Headless: three.js and the fonts are served from this repo (tools/vendor-three.mjs), unchanged since they were fetched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('vendor/ matches its manifest and holds every three.js module the game imports', () => {
  const out = execFileSync(process.execPath, ['tools/vendor-three.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /vendor\/ is current/);
});

test('the fonts come from fonts/, with their licences', () => {
  const css = readFileSync(new URL('../css/fonts.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /https?:\/\//);
  for (const family of ['Inter', 'Overpass']) {
    assert.match(css, new RegExp(`font-family: '${family}'`));
    assert.match(readFileSync(new URL(`../fonts/OFL-${family}.txt`, import.meta.url), 'utf8'), /SIL OPEN FONT LICENSE/i);
  }
  assert.match(readFileSync(new URL('../vendor/three/LICENSE', import.meta.url), 'utf8'), /MIT License/);
});
