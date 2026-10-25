import test from 'node:test';
import assert from 'node:assert/strict';
import { subtractConvex, prismSlices, railBodies } from '../js/ride-geometry.js';

const area = poly => Math.abs(poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + a.x * b.z - a.z * b.x; }, 0)) / 2;
const rect = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

test('a diagonal approach cuts the planting without losing the rest of the park', () => {
  const park = rect(-10, 10, -10, 10), cut = [{ x: -12, z: -10 }, { x: -10, z: -12 }, { x: 12, z: 10 }, { x: 10, z: 12 }];
  for (const ring of [cut, cut.slice().reverse()]) {
    const pieces = subtractConvex(park, ring);
    assert.ok(Math.abs(pieces.reduce((s, p) => s + area(p), 0) - 324) < 1e-8);
    for (const piece of pieces) for (const p of piece) assert.ok(Math.abs(p.z - p.x) >= 2 - 1e-8);
  }
  assert.equal(subtractConvex(park, rect(-20, 20, -20, 20)).length, 0);
  assert.equal(subtractConvex(park, rect(30, 40, 30, 40)).reduce((s, p) => s + area(p), 0), 400);
});

test('tapered hull bodies stay inside the hull with a bounded missing edge strip', () => {
  const hull = [{ x: -10, z: -3 }, { x: 5, z: -3 }, { x: 10, z: 0 }, { x: 5, z: 3 }, { x: -10, z: 3 }];
  const slices = prismSlices(hull);
  assert.ok(slices.length <= 36, 'straight hull is one box, only the bow is subdivided');
  for (const r of slices) {
    for (const x of [r.x0, r.x1]) for (const z of [r.z0, r.z1]) assert.ok(Math.abs(z) <= Math.min(3, (10 - x) * .6) + 2e-6);
    const mid = (r.x0 + r.x1) / 2, half = Math.min(3, (10 - mid) * .6);
    assert.ok(half - r.z1 <= .1 + 1e-8);
  }
  assert.ok(slices.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0) > area(hull) * .99);
});

test('round polygon slices never produce the old square-corner invisible walls', () => {
  const radius = 3.4, poly = Array.from({ length: 12 }, (_, i) => ({ x: radius * Math.sin(i * Math.PI / 6), z: radius * Math.cos(i * Math.PI / 6) }));
  for (const r of prismSlices(poly)) for (const x of [r.x0, r.x1]) for (const z of [r.z0, r.z1]) assert.ok(Math.hypot(x, z) <= radius + 2e-6);
});

test('rails follow elevation without enclosing the space below, and vertical masts use one body', () => {
  const boxes = [], add = (...args) => { const b = { args }; boxes.push(b); return b; };
  railBodies({ x: 0, y: 1, z: 0 }, { x: 0, y: 6, z: 20 }, .07, .07, add);
  assert.ok(boxes.length < 65);
  for (const b of boxes) {
    assert.equal(b.support, false);
    const [, z, , , bottom, top] = b.args, y = 1 + z / 4;
    assert.ok(bottom >= y - .08 && top <= y + .08);
  }
  boxes.length = 0;
  railBodies({ x: 3, y: 0, z: 5 }, { x: 3, y: 30, z: 5 }, .3, .3, add);
  assert.equal(boxes.length, 1);
});
