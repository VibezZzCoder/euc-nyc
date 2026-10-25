const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/street-details.js'), 'utf8');
const production = (name) => {
  const code = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`))[0];
  return vm.runInNewContext(`(${code})`, { LIGHT_CELL: 128 });
};
const indexLights = production('indexLights'), nearbyLights = production('nearbyLights');
function brute(sites, camera, range) {
  const { x, y, z } = camera.position, m = camera.matrixWorld.elements;
  const active = [];
  for (const s of sites) {
    const dx = s.x - x, dz = s.z - z, d2 = dx * dx + dz * dz + y * y;
    if (d2 > range * range) continue;
    const d = Math.sqrt(d2), forwardDot = dx * -m[8] + dz * -m[10];
    const distance = d + Math.max(0, 6 - forwardDot) * 2.8;
    if (distance < range) active.push({ id: s.id, distance });
  }
  return active.sort((a, b) => a.distance - b.distance);
}
const camera = (x, y, z, yaw) => ({ position: { x, y, z }, matrixWorld: { elements: { 8: -Math.sin(yaw), 10: -Math.cos(yaw) } } });

test('nearby lookup matches the original scan exactly across negative cells, seams, headings and heights', () => {
  let seed = 123456;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const sites = Array.from({ length: 1500 }, (_, id) => ({ id, x: rnd() * 800 - 400, z: rnd() * 800 - 400 }));
  const cells = indexLights(sites), active = [];
  for (let i = 0; i < 500; i++) {
    const c = camera(i % 4 ? rnd() * 800 - 400 : -128, [0, -5, 3, 120][i % 4], rnd() * 800 - 400, rnd() * Math.PI * 2);
    for (const range of [110, 115]) {
      nearbyLights(cells, c, range, active);
      assert.deepEqual(Array.from(active, (s) => ({ id: s.id, distance: s._effDist })), brute(sites, c, range));
    }
  }
  nearbyLights(cells, camera(10000, 0, 10000, 0), 115, active);
  assert.equal(active.length, 0, 'reused output must not keep lights from the previous camera');
});

test('equidistant lights keep source order even when cells are visited in a different order', () => {
  const sites = [{ id: 'right-first', x: 1, z: 20 }, { id: 'left-second', x: -1, z: 20 }];
  const active = [];
  nearbyLights(indexLights(sites), camera(0, 0, 0, 0), 110, active);
  assert.deepEqual(Array.from(active, (s) => s.id), ['right-first', 'left-second']);
});
