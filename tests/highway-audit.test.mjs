import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import { loadModule } from './helpers/module.cjs';
import profiles from './car-profile-fixture.cjs';

const source = readFileSync(new URL('../js/traffic.js', import.meta.url), 'utf8');
const geometry = () => new THREE.BufferGeometry();
// Run the complete production highway simulation and upload path. Only mesh factories are inert: no renderer/GPU.
const { createHighwayTraffic } = loadModule(source, { imports: {
  'three/webgpu': THREE,
  './road-network.js': {}, './pedestrian-routes.js': {}, './city-config.js': {}, './pedestrians.js': {},
  './tsl-materials.js': { cityUniforms: { uInteriorGlow: { value: 0.48 } }, createCarFlareMaterial: () => new THREE.MeshBasicMaterial() },
  './vehicle-lights.js': { createVehicleHeadlight: () => new THREE.SpotLight(), headlightBeamScale: () => 0 },
  './actor-models.js': { ...profiles, buildCarGeometry: geometry, buildCarProxyGeometry: geometry,
    createLoftedCarMaterial: () => new THREE.MeshBasicMaterial(), carStyleCode: () => 0 }
}, globals: { window: { innerHeight: 800 } } });

function harness(lod = 0) {
  const lane = { pts: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 3000)], speed: 16 };
  const traffic = createHighwayTraffic(new THREE.Scene(), [lane]);
  const cars = traffic.cars.filter(c => c.kind === 'sedan').slice(0, 2);
  assert.equal(cars.length, 2);
  lane.cars.splice(0, lane.cars.length, ...cars);
  traffic.cars.splice(0, traffic.cars.length, ...cars);
  cars.forEach((c, i) => Object.assign(c, { u: 1000 + i * 30, v: 0, col: [0, 0, 0], style: 0 }));
  const camera = new THREE.PerspectiveCamera();
  camera.position.set([0, 250, 600][lod], 5, 1000);
  camera.lookAt(0, 0, 1000);
  const mesh = traffic.group.children[Object.keys(profiles.BODY_SPECS).indexOf('sedan') * 3 + lod];
  return { traffic, lane, cars, mesh, camera, step: entity => traffic.update(1e-6, camera, entity) };
}

for (const lod of [0, 1, 2]) {
  test(`highway LOD ${lod}: simulated GPU retains dirty paint/state tails across skipped renders and hidden meshes`, () => {
    const h = harness(lod), [a, b] = h.cars;
    const attrs = ['paintColor', 'carState'].map(name => h.mesh.geometry.attributes[name]);
    const gpu = attrs.map(attr => new Float32Array(attr.array));
    const versions = attrs.map(attr => attr.version);
    const consume = () => attrs.forEach((attr, i) => {
      if (!h.mesh.visible || attr.version === versions[i]) return;
      const ranges = attr.updateRanges.length ? attr.updateRanges : [{ start: 0, count: attr.array.length }];
      for (const { start, count } of ranges) gpu[i].set(attr.array.subarray(start, start + count), start);
      versions[i] = attr.version;
      attr.clearUpdateRanges();
    });
    h.step(); consume(); h.step(); h.step(); // finish production warm-up
    assert.equal(h.mesh.count, 2);
    for (let run = 0; run < 2; run++) {
      Object.assign(a, { u: 1000, col: [0.25, 0.5, 0.75], style: 64 + run, v: 0 });
      Object.assign(b, { u: 1030, col: [0.75, 0.25, 0.5], style: 128 + run, v: 30 });
      h.step(); // skip render after both slots change
      Object.assign(a, { col: [0.5, 0.75, 0.25], style: 192 + run });
      b.u = 2900;
      h.step(); // shrink to the first slot and dirty that prefix again
      assert.equal(h.mesh.count, 1);
      const pending = attrs.map(attr => attr.updateRanges.map(r => ({ ...r })));
      a.u = 2800; h.step(); consume();
      assert.equal(h.mesh.visible, false);
      attrs.forEach(attr => assert.equal(attr.updateRanges.length, 1, 'hidden meshes retain the union'));
      a.u = 1000; h.step(); consume();
      const after = attrs.map(attr => attr.version);
      b.u = 1030; h.step(); consume();
      assert.equal(h.mesh.count, 2);
      assert.deepEqual(attrs.map(attr => attr.version), after, 'returning CPU tail already matches; no repair upload');
      attrs.forEach((attr, i) => assert.deepEqual([...gpu[i].slice(0, 2 * attr.itemSize)], [...attr.array.slice(0, 2 * attr.itemSize)]));
      attrs.forEach((attr, i) => assert.deepEqual(pending[i], [{ start: 0, count: 2 * attr.itemSize }]));
      assert.equal(gpu[1][4], 1, 'tail brake light reaches the simulated GPU');
      assert.equal(gpu[1][7], b.style);
    }
    a.col = [1, 0, 0]; a.style = 8; b.u = 2900; h.step();
    attrs.forEach(attr => assert.deepEqual(attr.updateRanges, [{ start: 0, count: attr.itemSize }], 'later small updates stay small'));
  });
}

test('highway contact reports the pre-stop relative speed once per contact and preserves impact memory', () => {
  const h = harness(), c = h.cars[0];
  h.cars.splice(1); h.lane.cars.splice(1);
  c.v = 8;
  h.step();
  const entity = Object.freeze({ type: 'euc', position: Object.freeze({ x: 0, y: 0, z: c.u + c.len / 2 + 0.5 }),
    heading: 0, speed: 2 });
  const reports = [];
  h.traffic.setCollisionListener(event => reports.push({ ...event }));
  h.step(entity);
  assert.equal(reports.length, 1);
  const hit = reports[0];
  assert.equal(hit.a, entity); assert.equal(hit.b, c); assert.equal(hit.kind, 'vehicle');
  assert.ok(Math.abs(hit.speed - 6) < 0.001, 'closing speed is sampled before the traffic hold zeros it');
  assert.deepEqual([hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz], [0, 0.58, entity.position.z, 0, 0, 1]);
  assert.equal(c.v, 0);
  assert.ok(c.hitTimer > 0 && c.hitV > 7.9);
  const bodies = [];
  h.traffic.dynamicBodiesNear(0, c.z, 4, bodies);
  assert.equal(bodies[0].velocityZ, c.hitV);
  for (let i = 0; i < 4; i++) h.step(entity);
  assert.equal(reports.length, 1, 'holding/rubbing does not retrigger');
  h.step(null); c.v = 9; h.step(entity);
  assert.equal(reports.length, 2, 'a separate subsequent contact can sound');
  h.step(null); c.v = 1; h.step(entity);
  assert.equal(reports.length, 2, 'a rider moving away faster is not an impact');
  h.step(null); c.v = 8; h.step({ ...entity, speed: -3 });
  assert.equal(reports.length, 3);
  assert.equal(reports[2].speed, 11, 'backward rider velocity is not clamped to the following-model speed');
  h.step(null); c.v = 8;
  h.step({ ...entity, speed: 12, position: { x: 0, y: 0, z: c.u - c.len / 2 + 0.1 } });
  assert.equal(reports.length, 4);
  assert.equal(reports[3].speed, 4, 'a faster rider contacting the rear has positive closing speed');
  assert.equal(reports[3].nz, -1, 'normal points from the car toward the rider');
  h.step(null); c.v = 8; h.traffic.setCollisionListener(null); h.step(entity);
  assert.equal(reports.length, 4, 'listener removal works');
});

test('adding a highway audio listener does not alter vehicle trajectories, lane data or population', () => {
  const a = harness(), b = harness();
  b.traffic.setCollisionListener(() => {});
  for (let frame = 0; frame < 120; frame++) {
    const entity = frame > 20 && frame < 80 ? { type: 'euc', position: { x: 0, y: 0, z: 1003 }, speed: 0, heading: 0 } : null;
    a.step(entity); b.step(entity);
    assert.deepEqual(a.cars.map(c => [c.u, c.v, c.acc, c.hitTimer, c.hitV, c.touching]),
      b.cars.map(c => [c.u, c.v, c.acc, c.hitTimer, c.hitV, c.touching]));
  }
  assert.deepEqual(a.lane.pts, b.lane.pts);
  assert.deepEqual(a.lane.playerBoxes, b.lane.playerBoxes);
  assert.deepEqual(a.lane.box, b.lane.box);
  assert.equal(a.cars.length, b.cars.length);
});
