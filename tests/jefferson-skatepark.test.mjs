import test from 'node:test';
import assert from 'node:assert/strict';
import { JEFFERSON_SKATEPARK as site, buildJeffersonSkatepark } from '../js/jefferson-skatepark.js';
import { NYC_LANDMARKS } from '../js/city-config.js';

function footprint() {
  const shapes = [], profiles = [];
  const add = (kind, u0, u1, y0, y1, s0, s1) => shapes.push({ kind, u0, u1, y0, y1, s0, s1 });
  const frame = Object.fromEntries(['box', 'solid', 'top'].map(kind => [kind, (_mat, ...p) => add(kind, ...p)]));
  frame.body = (...p) => add('body', ...p);
  frame.strut = (_mat, a, b, t, _v, width) => add('strut', Math.min(a[0], b[0]) - width / 2,
    Math.max(a[0], b[0]) + width / 2, Math.min(a[1], b[1]) - t / 2, Math.max(a[1], b[1]) + t / 2,
    Math.min(a[2], b[2]) - width / 2, Math.max(a[2], b[2]) + width / 2);
  buildJeffersonSkatepark(frame, {}, (_f, u0, u1, points, base) => {
    profiles.push({ u0, u1, points, base });
    add('profile', u0, u1, base, Math.max(...points.map(p => p[1])), points[0][0], points.at(-1)[0]);
  }, () => {});
  return { shapes, profiles };
}

test('the authored park keeps its researched map location and a separate clear arrival', () => {
  const pin = NYC_LANDMARKS.find(p => p.id === 'thomas-jefferson');
  assert.equal(pin.x, 1344.9); assert.equal(pin.z, -5800.6);
  assert.equal(pin.icon, 'skateboard'); assert.deepEqual(pin.arrival, site.arrival);
  const u = pin.arrival.x - site.x, s = pin.arrival.z - site.z;
  assert.ok(Math.abs(u) < site.halfWidth - 2 && s > site.north + 2 && s < site.south - 2);
  for (const b of footprint().shapes.filter(b => b.y1 > site.top + 0.03)) {
    assert.ok(u < b.u0 - 1 || u > b.u1 + 1 || s < b.s0 - 1 || s > b.s1 + 1, 'arrival footprint clear of '+b.kind);
  }
});

test('all skate solids and profiles stay within the surveyed footprint and preserve the central bypass', () => {
  for (const b of footprint().shapes) {
    assert.ok([b.u0,b.u1,b.y0,b.y1,b.s0,b.s1].every(Number.isFinite));
    assert.ok(b.u0 < b.u1 && b.s0 < b.s1 && b.y0 < b.y1);
    assert.ok(b.u0 >= -site.halfWidth && b.u1 <= site.halfWidth && b.s0 >= site.north && b.s1 <= site.south);
    if (b.y1 > site.top + 0.03) assert.ok(b.u1 <= -3 || b.u0 >= 3, 'six-metre central spine stays clear');
  }
});

test('ramps have ordered finite support profiles and every profile connects to the court floor', () => {
  const { profiles } = footprint();
  assert.ok(profiles.length >= 4);
  for (const p of profiles) {
    assert.equal(p.base, site.top);
    assert.ok(p.points.every(point => point[1] >= site.top));
    if (p.points.some(point => point[1] !== p.points[0][1])) assert.ok(p.points.some(point => Math.abs(point[1]-site.top)<1e-9));
    for (let i = 1; i < p.points.length; i++) {
      assert.ok(p.points[i][0] > p.points[i-1][0]);
      const slope = Math.abs((p.points[i][1] - p.points[i-1][1]) / (p.points[i][0] - p.points[i-1][0]));
      assert.ok(Number.isFinite(slope) && slope < 1.75);
    }
  }
});

test('concrete platform tops do not coincide with the painted box tops beneath them', () => {
  const { shapes } = footprint();
  for (const a of shapes.filter(s => s.kind === 'solid')) for (const b of shapes.filter(s => s.kind === 'top')) {
    const overlap = Math.min(a.u1,b.u1)-Math.max(a.u0,b.u0)>1e-6 && Math.min(a.s1,b.s1)-Math.max(a.s0,b.s0)>1e-6;
    assert.ok(!overlap || Math.abs(a.y1-b.y1)>1e-6, 'one visible owner per horizontal surface');
  }
});
