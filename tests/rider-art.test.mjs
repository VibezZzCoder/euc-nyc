// EUC Thrills 1.6.1 rider art by VibezZzCoder (MIT). Check the generated geometry and its loading boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Raycaster, Vector3, Color, Mesh } from '../vendor/three/build/three.core.js';
import { redRiderCamera } from '../js/euc/render/redRiderKit.js';
import { COP_LOOK } from '../js/euc/render/riderLook.js';
import { createPlaceholderRider } from '../js/euc/render/rider.js';

test('each playable kit belongs only to its selected look; Dorkins is available at boot', () => {
  const manifest = JSON.parse(readFileSync(new URL('../js/euc/MANIFEST.json', import.meta.url)));
  for (const [id, names] of Object.entries({ 'red-rider': ['redRiderKit'], trollina: ['trollinaSculpt'],
    'flo-with-zo': ['floRaceJacket', 'floWithZoHelmet'], adonisb2: ['adonisb2Kit'] })) {
    for (const name of names) {
      const file = `render/${name}.js`;
      assert.ok(!manifest.eager.includes(file));
      assert.deepEqual(Object.keys(manifest.appearances).filter(key => manifest.appearances[key].includes(file)), [id]);
    }
  }
  assert.ok(manifest.eager.includes('render/dorkinsHead.js'));
});

test('Red Rider wears his camera on his own left; the lens sits behind the rim', () => {
  const geometry = redRiderCamera();
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.min.x > .01 && geometry.boundingBox.max.x < .08);
  const mesh = new Mesh(geometry);
  const depth = x => new Raycaster(new Vector3(x, .297, 1), new Vector3(0, 0, -1)).intersectObject(mesh)[0].point.z;
  assert.ok(depth(.0592) > depth(.048) + .003);
  geometry.dispose(); mesh.material.dispose();
});

test('the glasses arms reach and hook behind both of Dorkins’s ears', () => {
  const rider = createPlaceholderRider(COP_LOOK);
  const built = rider.root.getObjectByName('rider-cop-face');
  const face = new Mesh(built.geometry, built.material);
  const tint = new Color(0x4c4034).r / new Color(COP_LOOK.materials.limbs.colour).r;
  const colours = face.geometry.getAttribute('color');
  for (const side of [-1, 1]) for (const [z,y] of [[.100,.204],[.030,.203],[-.012,.189]]) {
    const ray = new Raycaster(new Vector3(side * .2, y, z), new Vector3(-side, 0, 0), 0, .122);
    assert.ok(ray.intersectObject(face).some(hit => Math.abs(colours.getX(hit.face.a) - tint) < 1e-6));
  }
  rider.dispose();
});

test('the mounted hem swings away from either crouched bank and returns beneath the belt', async () => {
  const { prepareAppearance } = await import('../js/euc/render/appearanceLoader.js');
  const { createRidingRig } = await import('../js/euc/render/ridingRig.js');
  const { createPose } = await import('../js/euc/simulation/EucController.js');
  const { look, machine } = await prepareAppearance('trollina');
  const rig = createRidingRig(look, machine);
  try {
    const skirt = rig.rider.pelvis.children.find(part => part.isMesh && part.castShadow);
    const vertices = skirt.geometry.getAttribute('position');
    const lamps = ['euc-status-light', 'euc-taillight'].map(name => rig.group.getObjectByName(name));
    for (const roll of [-.62, .62, 0]) {
      const pose = Object.assign(createPose(), { rollAngle: roll, riderRoll: roll * .88, crouch: roll ? 1 : 0 });
      rig.apply(pose);
      rig.group.updateMatrixWorld(true);
      const points = Array.from({length: look.density.torso}, (_, i) => skirt.localToWorld(new Vector3().fromBufferAttribute(vertices, i)));
      const centre = points.reduce((v,p) => v.add(p), new Vector3()).divideScalar(points.length);
      const belt = skirt.localToWorld(new Vector3(0, look.hemDrapeGravity.anchorY, 0));
      assert.ok(roll ? -Math.sign(roll) * (centre.x - belt.x) > .012 : Math.abs(centre.x - belt.x) < .009);
      for (const [i, from] of points.entries()) {
        const edge = points[(i + 1) % points.length].clone().sub(from);
        const length = edge.length();
        const ray = new Raycaster(from, edge.normalize(), 0, length);
        assert.equal(ray.intersectObjects(lamps, false).length, 0, 'hem edge intersects a rear lamp');
      }
    }
  } finally { rig.dispose(); }
});
