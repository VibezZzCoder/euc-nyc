// Real production geometry/materials, with the browser's 'three' import supplied explicitly for Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import * as tuning from '../js/euc/data/tuning.js';
import * as maths from '../js/euc/shared/maths.js';
import { EucController, createPose } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';

function productionModule(file, dependencies) {
  const source = readFileSync(new URL(`../js/euc/render/${file}.js`, import.meta.url), 'utf8');
  const names = [...source.matchAll(/^export (?:function|const) (\w+)/gm)].map(m => m[1]);
  const body = source.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '');
  return new Function(...Object.keys(dependencies), `${body}\nreturn {${names.join(',')}};`)(...Object.values(dependencies));
}
const kit = productionModule('blockoutKit', { THREE });
const looks = productionModule('machineLook', { ...kit, ...tuning });
const { createBlockoutEUC } = productionModule('euc', { THREE, ...kit, ...tuning, ...maths, ...looks });
const triangles = geometry => (geometry.index?.count ?? geometry.attributes.position.count) / 3;

for (const look of [looks.STANDARD_MACHINE_LOOK, looks.TROLLINA_MACHINE_LOOK]) {
  test(`${look.machine}: rotating assembly stays within the original wheel envelope; fixed parts stay fixed`, () => {
    const euc = createBlockoutEUC(look);
    try {
      const tyre = euc.tyre, hub = tyre.getObjectByName('euc-motor-cover');
      assert.equal(hub.parent, tyre);
      assert.equal(tyre.parent, euc.group);
      assert.equal(euc.body.parent, euc.group);
      assert.equal(hub.material, euc.group.getObjectByName('euc-pedal-left').material);
      assert.equal(tyre.material.metalness, 0);
      assert.equal(hub.material.metalness, 0.75);
      const stationary = ['euc-shell', 'euc-headlight', 'euc-pedal-left', 'euc-pedal-right', 'euc-suspension'];
      euc.group.updateMatrixWorld(true);
      const matrices = stationary.map(name => euc.group.getObjectByName(name).matrixWorld.clone());
      // Identity rig: +X spin takes the top of the wheel toward +Z. Reverse exactly retraces the same surface.
      const marker = new THREE.Vector3(tuning.WHEEL.tyreDiameter / 2, 0, 0);
      const worldAt = angle => { tyre.rotation.x = angle; euc.group.updateMatrixWorld(true); return marker.clone().applyMatrix4(tyre.matrixWorld); };
      const start = worldAt(0), forward = worldAt(0.73), reverse = worldAt(-0.73);
      assert.ok(forward.z > start.z && reverse.z < start.z);
      assert.ok(worldAt(0).distanceTo(start) < 1e-12);
      assert.ok(worldAt(0.73).distanceTo(forward) < 1e-12, 'held spin is stable');
      stationary.forEach((name, i) => assert.deepEqual(euc.group.getObjectByName(name).matrixWorld, matrices[i]));
      for (const mesh of [tyre, hub]) {
        const p = mesh.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          assert.ok(Math.hypot(p.getX(i), p.getZ(i)) <= tuning.WHEEL.tyreDiameter / 2 + 1e-7);
          assert.ok(Math.abs(p.getY(i)) <= tuning.WHEEL.tyreWidth / 2 + 0.008 + 1e-7);
        }
      }
      assert.equal(triangles(tyre.geometry) + triangles(hub.geometry), 864);
      assert.ok(tyre.castShadow && hub.castShadow);
    } finally { euc.dispose(); }
  });
}

test('physical forward/reverse travel remains the sole spin input, including stopped stability', () => {
  const sampler = { sampleGround(x, z, out) {
    Object.assign(out, { height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false }); return out;
  }, raycast() { return null; } };
  const c = new EucController(sampler), p = createPose();
  for (const direction of [1, -1, 0]) {
    c.reset({ position: { x: 0, y: 0, z: 0 }, headingY: 0 });
    // Native reset clamps negative initial speed; engage reverse through its actual input path.
    for (let i = 0; i < 240; i++) c.step(1 / 120, { ...NEUTRAL_ACTIONS, throttle: direction * 0.5 });
    c.writePose(p);
    assert.ok(Math.abs(p.wheelSpin - p.z / c.tuning.wheelRadius) < 1e-9);
    assert.equal(Math.sign(p.wheelSpin), direction);
  }
});

test('rubber maps are deterministic, correctly tagged, filtered and disposed with the machine', () => {
  const a = createBlockoutEUC(), b = createBlockoutEUC();
  const { map, bumpMap } = a.tyre.material;
  assert.equal(map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(bumpMap.colorSpace, THREE.NoColorSpace);
  for (const texture of [map, bumpMap]) {
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(texture.generateMipmaps, true);
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
  }
  assert.deepEqual(map.image.data, b.tyre.material.map.image.data);
  assert.deepEqual(bumpMap.image.data, b.tyre.material.bumpMap.image.data);
  assert.ok(new Set(map.image.data).size > 20, 'actual surface detail, not a flat texture');
  const owned = new Set([map, bumpMap]);
  a.group.traverse(o => { if (o.isMesh) { owned.add(o.geometry); owned.add(o.material); } });
  const disposed = new Map();
  owned.forEach(resource => resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) ?? 0) + 1)));
  a.dispose(); a.dispose(); b.dispose();
  for (const resource of owned) assert.equal(disposed.get(resource), 1, `${resource.type} disposed exactly once`);
});
