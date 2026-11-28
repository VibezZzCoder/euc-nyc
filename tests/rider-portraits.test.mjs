// The riders' chooser portraits: generated element data (js/euc/ui/riderPortraits.js), the three supplied marks, its
// place outside the start-up graph, and the page helper (js/rider-portraits.js) against a stand-in document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PORTRAITS, MARKS, MARK_IMAGES, PORTRAIT_VIEWBOX } from '../js/euc/ui/riderPortraits.js';
import { PLAYABLE_RIDERS } from '../js/euc-roster.js';
import { createRiderPortraits, base64Bytes } from '../js/rider-portraits.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(read('js/euc/MANIFEST.json'));
const TAGS = new Set(['path', 'g', 'rect', 'circle', 'ellipse', 'mark']);
const ATTRIBUTES = new Set(['d', 'fill', 'opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'x', 'y', 'width', 'height',
  'rx', 'ry', 'cx', 'cy', 'r']);
const walk = (rows, visit) => { for (const row of rows) { visit(row); if (row[2]) walk(row[2], visit); } };
// Elements of each original drawing, its root svg included (src/ui/menus.ts at the pinned base commit).
const ELEMENTS = { 'cool-rider': 7, trollina: 18, 'red-rider': 10, adonisb2: 11, 'maribel-vargas': 15, 'wheel-in-motion': 16,
  drunkard: 21, 'flo-with-zo': 10, 'seal-on-a-wheel': 15, wyldist: 17, gnarwheel: 17 };

test('eleven playable riders, each the original drawing element for element, in a 96-unit view; no officer', () => {
  assert.deepEqual(Object.keys(PORTRAITS), [...PLAYABLE_RIDERS]);
  assert.equal(PORTRAIT_VIEWBOX, '0 0 96 96');
  for (const id of PLAYABLE_RIDERS) {
    let count = 1;
    walk(PORTRAITS[id], ([tag, attributes, children]) => {
      count++;
      assert.ok(TAGS.has(tag), `${id}: ${tag}`);
      for (const [name, value] of Object.entries(attributes)) {
        assert.ok(ATTRIBUTES.has(name), `${id}: ${name}`);
        if (typeof value === 'string') assert.doesNotMatch(value, /[:()<>]|url|style/i, `${id}: ${name}`);
      }
      if (children) assert.equal(tag, 'g');
    });
    assert.equal(count, ELEMENTS[id], id);
  }
  assert.ok(!('cop' in PORTRAITS));
});

test('the module is recorded with its origins, deferred, outside the eager closure and never preloaded', () => {
  const entry = manifest.files['ui/riderPortraits.js'];
  assert.equal(entry.outputSha256, sha(readFileSync(new URL('../js/euc/ui/riderPortraits.js', import.meta.url))));
  assert.equal(entry.source, null, 'generated boundary');
  assert.deepEqual(entry.derivedFrom.map(origin => origin.source),
    ['src/ui/menus.ts', 'src/data/mvLogoAsset.ts', 'src/data/wimLogoAsset.ts', 'src/data/gnarwheelLogoAsset.ts']);
  assert.equal(entry.derivedFrom[0].sourceSha256, 'a5adad37dafbf8fc3b807e4778b6546b00e22e79b47ed3f0c3b1a34b963e0d8f');
  assert.match(read('js/euc/ui/riderPortraits.js'), /^\/\/ Vendored by tools\/vendor-euc\.mjs from VibezZzCoder\/EUC-thrills@5f45fff generated boundary/);
  assert.ok(manifest.deferred.includes('ui/riderPortraits.js'));
  assert.ok(!manifest.eager.includes('ui/riderPortraits.js'));
  for (const logo of ['data/mvLogoAsset.js', 'data/wimLogoAsset.js', 'data/gnarwheelLogoAsset.js']) assert.ok(!manifest.eager.includes(logo), logo);
  assert.doesNotMatch(read('index.html'), /riderPortraits|rider-portraits\.js|LogoAsset/, 'no preload');
  // Only the picker reaches it, by a dynamic import of the page helper; no static import anywhere in the host.
  const main = read('js/main.js'), menu = read('js/game-menu.js');
  assert.match(main, /portraits: \(\) => import\('\.\/rider-portraits\.js'\)/);
  for (const source of [main, menu]) assert.doesNotMatch(source, /^\s*import\b[^(]*['"][^'"]*(?:rider-portraits|riderPortraits)/m);
  // The eager generated modules never import it, statically or lazily.
  for (const file of manifest.eager) assert.doesNotMatch(read(`js/euc/${file}`), /riderPortraits/, file);
});

test('three marks at the original rectangles, each the reviewed PNG with its own pixel size', async () => {
  assert.deepEqual(Object.keys(MARKS), ['maribel-vargas', 'wheel-in-motion', 'gnarwheel']);
  assert.deepEqual(MARKS['maribel-vargas'], { x: 39.5, y: 75, width: 17, height: 14.2 });
  assert.deepEqual(MARKS['wheel-in-motion'], { x: 35, y: 79, width: 26, height: 11.46 });
  assert.deepEqual(MARKS.gnarwheel, { x: 33, y: 67, width: 30, height: 30 / (1499 / 375) });
  for (const [id, rect] of Object.entries(MARKS)) {
    let rows = 0;
    walk(PORTRAITS[id], ([tag, attributes]) => { if (tag === 'mark') { rows++; assert.deepEqual(attributes, rect); } });
    assert.equal(rows, 1, id);
    const image = await MARK_IMAGES[id]();
    const bytes = base64Bytes(image.base64);
    assert.equal(sha(bytes), image.sha256, id);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    assert.deepEqual([view.getUint32(16), view.getUint32(20)], [image.width, image.height], id);
  }
  for (const id of PLAYABLE_RIDERS) if (!MARKS[id]) walk(PORTRAITS[id], ([tag]) => assert.notEqual(tag, 'mark', id));
});

function standInDocument() {
  const made = [];
  const element = (ns, tag) => {
    const node = { ns, tag, attributes: {}, children: [], dataset: {}, style: {}, className: '', isConnected: true, width: 300, height: 150,
      setAttribute(name, value) { this.attributes[name] = String(value); }, append(...c) { this.children.push(...c); },
      querySelectorAll(selector) { return selector === 'canvas' ? this.children.filter(c => c.tag === 'canvas') : []; },
      getBoundingClientRect: () => ({ width: 20, height: 10 }),
      getContext() { return { drawImage: (...args) => { node.drawn = args; } }; } };
    made.push(node);
    return node;
  };
  return { made, createElement: tag => element('html', tag), createElementNS: (ns, tag) => element(ns, tag) };
}

test('the helper builds SVG from the data: no markup, no style attribute, no URL; marks decoded once and placed', async t => {
  const doc = standInDocument();
  globalThis.document = doc;
  t.after(() => { delete globalThis.document; });
  let decodes = 0;
  const art = createRiderPortraits({ pixelRatio: () => 2, decode: async () => { decodes++; return { source: { pixels: true }, width: 100, height: 50 }; } });
  assert.equal(art.build('gnarwheel'), null, 'nothing before the data');
  assert.equal(await art.ready(), true);
  const boxes = PLAYABLE_RIDERS.map(id => [id, art.build(id)]);
  for (const [id, box] of boxes) {
    assert.equal(box.attributes['aria-hidden'], 'true');
    const svg = box.children[0];
    assert.equal(svg.ns, 'http://www.w3.org/2000/svg');
    assert.equal(svg.attributes.viewBox, '0 0 96 96');
    assert.equal(box.children.length, MARKS[id] ? 2 : 1, id);
  }
  await new Promise(resolve => setImmediate(resolve));
  const gnarwheel = Object.fromEntries(boxes).gnarwheel.children[1];
  assert.equal(gnarwheel.tag, 'canvas');
  assert.equal(gnarwheel.style.left, `${33 / 96 * 100}%`);
  assert.equal(gnarwheel.style.height, `${MARKS.gnarwheel.height / 96 * 100}%`);
  assert.deepEqual([gnarwheel.width, gnarwheel.height], [40, 20], 'device-pixel size of its rectangle');
  assert.deepEqual(gnarwheel.drawn.slice(1), [0, 0, 40, 20], 'whole mark, centred at its own aspect');
  for (const node of doc.made) for (const [name, value] of Object.entries(node.attributes)) {
    assert.ok(!['style', 'id', 'href', 'class'].includes(name), name);
    assert.doesNotMatch(value, /data:|blob:|javascript:/);
  }
  assert.equal(art.stats.builds, 11);
  assert.equal(decodes, 3, 'each mark decoded once');
  art.build('gnarwheel'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(decodes, 3, 'a second build reuses the decoded mark');
  const before = art.stats.canvases;
  art.release(Object.fromEntries(boxes)['maribel-vargas']);
  assert.equal(art.stats.canvases, before - 1, 'a released portrait no longer holds a canvas');
});

test('a failed import leaves the helper empty and quiet: no throw, the picker keeps its swatches', async t => {
  const warn = console.warn; console.warn = () => {};
  t.after(() => { console.warn = warn; });
  const art = createRiderPortraits({ load: () => Promise.reject(new Error('offline')) });
  assert.equal(await art.ready(), false);
  assert.equal(art.loaded, false);
  assert.equal(art.build('cool-rider'), null);
});
