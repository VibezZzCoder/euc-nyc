// Headless: js/solid-rects.js, the rider's colliders for a block's buildings (buildings.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSolidParts } from '../js/solid-rects.js';

const R = (x0, x1, z0, z1, y1 = 10) => ({ x0, x1, z0, z1, y1 });
const inAny = (rects, x, z) => rects.filter((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
const area = (rects) => rects.reduce((a, r) => a + (r.x1 - r.x0) * (r.z1 - r.z0), 0);

// Every point of a fine lattice: solid exactly where expected, never covered twice
function assertCover(rects, solidAt, [x0, x1, z0, z1]) {
  for (let x = x0 + 0.05; x < x1; x += 0.25) {
    for (let z = z0 + 0.05; z < z1; z += 0.25) {
      const n = inAny(rects, x, z).length;
      assert.ok(n <= 1, `(${x}, ${z}) covered ${n} times`);
      assert.equal(n === 1, solidAt(x, z), `(${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
}

test('a row of touching buildings of one depth is one box', () => {
  const parts = [R(0, 6, 0, 18, 12), R(6, 12.5, 0, 18, 15), R(12.5, 20, 0, 18, 9)];
  const rects = mergeSolidParts(parts);
  assert.equal(rects.length, 1);
  assert.deepEqual(rects[0], { x0: 0, x1: 20, z0: 0, z1: 18, y1: 15 });
});

test('open ground between buildings stays open (towers on a lawn, a plaza, a gap)', () => {
  const parts = [R(10, 30, 10, 30), R(50, 70, 12, 28), R(80, 81, 0, 40)];
  const rects = mergeSolidParts(parts);
  assertCover(rects, (x, z) => (x > 10 && x < 30 && z > 10 && z < 30) || (x > 50 && x < 70 && z > 12 && z < 28) || (x > 80 && x < 81),
    [0, 90, 0, 40]);
});

test('an L-shaped building and stepped rear walls are covered exactly, without overlaps', () => {
  const parts = [R(0, 10, 0, 30), R(10, 40, 0, 10), R(40, 46, 0, 14), R(46, 52, 0, 9)];
  const rects = mergeSolidParts(parts);
  assert.ok(Math.abs(area(rects) - (300 + 300 + 84 + 54)) < 1e-6);
  assertCover(rects, (x, z) => (x < 10 && z < 30) || (x >= 10 && x < 40 && z < 10) || (x >= 40 && x < 46 && z < 14) || (x >= 46 && x < 52 && z < 9),
    [0, 55, 0, 32]);
});

test('a sealed light court is filled, a court open to the street is not', () => {
  // Ring: 30 x 30 with a 10 x 10 court in the middle
  const ring = [R(0, 30, 0, 10), R(0, 30, 20, 30), R(0, 10, 10, 20), R(20, 30, 10, 20)];
  const sealed = mergeSolidParts(ring);
  assert.ok(Math.abs(area(sealed) - 900) < 1e-6);
  assert.equal(inAny(sealed, 15, 15).length, 1);
  // U: the same with the north wing gone
  const u = mergeSolidParts(ring.slice(0, 1).concat(ring.slice(2)));
  assert.equal(inAny(u, 15, 15).length, 0);
  assert.equal(inAny(u, 15, 25).length, 0);
});

test('heights: the tallest part over a box, capped; stacked tiers add no boxes', () => {
  const tower = [R(0, 40, 0, 30, 20), R(5, 35, 5, 25, 60), R(10, 30, 10, 20, 120)];
  const rects = mergeSolidParts(tower, 26);
  assert.equal(rects.length, 1);
  assert.equal(rects[0].y1, 26);
  const low = mergeSolidParts([R(0, 10, 0, 10, 4)], 26);
  assert.equal(low[0].y1, 4);
});

test('edges a hair apart (float noise between lots) merge; degenerate parts are ignored', () => {
  const parts = [R(0, 6.000000001, 0, 18), R(5.999999999, 12, 0, 18), R(3, 3, 0, 5), R(0, 1, 2, 2)];
  const rects = mergeSolidParts(parts);
  assert.equal(rects.length, 1);
  assert.equal(mergeSolidParts([]).length, 0);
});

test('many brownstones on both side streets stay a handful of boxes', () => {
  // 20 lots per side, random depths, as buildings.js lays out a residential block
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const parts = [];
  for (let i = 0; i < 20; i++) {
    const d = 12 + Math.floor(rnd() * 3) * 2;
    parts.push(R(i * 6, i * 6 + 6, 0, d, 12 + rnd() * 6), R(i * 6, i * 6 + 6, 60 - d, 60, 12 + rnd() * 6));
  }
  const rects = mergeSolidParts(parts, 26);
  assert.ok(rects.length < parts.length, `${rects.length} boxes for ${parts.length} parts`);
  assertCover(rects, (x, z) => parts.some((p) => x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1), [0, 120, 0, 60]);
});
