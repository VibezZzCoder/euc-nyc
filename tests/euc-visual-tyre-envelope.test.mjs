// Selected production tyre triangles versus an actual 18 cm step, not a nominal tyre circle or screenshot tolerance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from '../vendor/three/build/three.core.js';
import { createPose } from '../js/euc/simulation/EucController.js';
import { createRidingRig } from '../js/euc/render/ridingRig.js';
import { prepareAppearance, releaseAppearanceCaches, appearanceResourceStats } from '../js/euc/render/appearanceLoader.js';
import { CHARACTER_IDS } from '../js/euc/data/riders.js';
import { NEAR_SOLID, WHEEL } from '../js/euc/data/tuning.js';
import { measureNearSolids, createNearSolids, tyreStepLift } from '../js/euc/app/nearSolids.js';

const NATIVE_RADIUS = WHEEL.tyreDiameter / 2;
const step = { sampleGround(_x, z, out, referenceY) {
  assert.ok(Number.isFinite(referenceY));
  Object.assign(out, { height: z >= 0 ? .18 : 0, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false });
  return out;
}, raycast() { return null; } };
const flat = { ...step, sampleGround(_x, _z, out, referenceY) {
  Object.assign(out, { height: referenceY, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false }); return out;
} };

// Clip every actual posed tyre triangle against the upper tread (z >= 0), including edge intersections. Y is
// linear over each clipped polygon, so its vertices give exact maximum penetration of that triangle into the tread.
function treadDepth(rig) {
  const mesh = rig.euc.tyre;
  mesh.updateWorldMatrix(true, false);
  const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index;
  let deepest = -Infinity, intersections = 0;
  for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
    const triangle = [0, 1, 2].map(k => new THREE.Vector3()
      .fromBufferAttribute(positions, indices ? indices.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld));
    for (let j = 0; j < 3; j++) {
      const p = triangle[j], q = triangle[(j + 1) % 3];
      if (p.z >= 0) { deepest = Math.max(deepest, .18 - p.y); intersections++; }
      if ((p.z < 0) !== (q.z < 0)) {
        const y = p.y + (q.y - p.y) * p.z / (p.z - q.z);
        deepest = Math.max(deepest, .18 - y); intersections++;
      }
    }
  }
  return { deepest, intersections };
}

test('default helper retains the complete pre-envelope native-radius output fingerprint', () => {
  const p = createPose(), answers = [];
  for (const headingY of [0, .7, Math.PI]) for (const restFactor of [0, .25, 1]) {
    for (const z of [-.26, -.24, -.19, -.12, -.08, -.03, -.001, .01, .3]) {
      Object.assign(p, { z, y: z >= 0 ? .18 : 0, headingY, restFactor });
      const out = measureNearSolids(step, p, createNearSolids());
      answers.push([out.lift, out.along, ...out.faces, ...out.normals]);
    }
  }
  const hash = createHash('sha256').update(JSON.stringify(answers)).digest('hex');
  assert.equal(hash, '90253cacd1119f69ca2b3dc6db8edcf06ad26baf9df5cecdaa7ea2a75bf6a5b8');
});

test('all eleven selected tyre envelopes clear the real step at multiple spins; native-radius lug/rim controls fail', async t => {
  const controls = new Map(), report = [];
  for (const id of CHARACTER_IDS) {
    const appearance = await prepareAppearance(id, { prepaint: false });
    const rig = createRidingRig(appearance.look, appearance.machine), pose = createPose();
    try {
      releaseAppearanceCaches();
      const attribute = rig.euc.tyre.geometry.getAttribute('position');
      const before = new Uint8Array(attribute.array.buffer).slice();
      let measured = NATIVE_RADIUS;
      for (let i = 0; i < attribute.count; i++) measured = Math.max(measured, Math.hypot(attribute.getX(i), attribute.getZ(i)));
      assert.equal(rig.visualTyreRadius, measured, `${id}: selected local XZ geometry, including merged rim/lugs`);
      assert.equal(rig.euc.tyre.position.y, NATIVE_RADIUS, 'the physical axle datum is unchanged');
      let worstOld = -Infinity, worstFixed = -Infinity;
      for (const wheelSpin of [0, .17, .73, Math.PI / 2, Math.PI, 5.1]) {
        for (const headingY of [0, Math.PI]) for (const z of [-.24, -.19, -.12, -.08, -.03, -.001]) {
          Object.assign(pose, { y: 0, z, headingY, wheelSpin, restFactor: 0 });
          const physicalPose = structuredClone(pose);
          const old = measureNearSolids(step, pose, createNearSolids());
          rig.setNearSolids(old.lift, old.faces, old.along, 0, old.normals); rig.apply(pose);
          worstOld = Math.max(worstOld, treadDepth(rig).deepest);
          const fixed = measureNearSolids(step, pose, createNearSolids(), rig.visualTyreRadius);
          rig.setNearSolids(fixed.lift, fixed.faces, fixed.along, 0, fixed.normals); rig.apply(pose);
          const contact = treadDepth(rig);
          assert.ok(contact.intersections > 0);
          worstFixed = Math.max(worstFixed, contact.deepest);
          assert.ok(contact.deepest < .001, `${id}: spin ${wheelSpin}, heading ${headingY}, z ${z}: ${contact.deepest} m in tread`);
          assert.deepEqual(pose, physicalPose);
          if (id === 'cool-rider') assert.deepEqual(fixed, old, 'native-looking Cool Rider keeps bit-identical helper answers');
        }
      }
      assert.deepEqual(new Uint8Array(attribute.array.buffer), before, 'envelope measurement/posing never edits tyre geometry');
      assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
      controls.set(id, worstOld); report.push(`${id}: radius ${measured}, old depth ${worstOld}, fixed depth ${worstFixed}`);
      // The measured envelope changes only step-edge presentation, never flat-ground stance or flight/crash poses.
      Object.assign(pose, { y: 0, z: -.08, headingY: 0, restFactor: 1 });
      const rest = measureNearSolids(step, pose, createNearSolids(), rig.visualTyreRadius);
      assert.ok(rest.lift <= NEAR_SOLID.restLiftMax + 1e-9); assert.ok(rest.along < 0);
      rig.setNearSolids(rest.lift, rest.faces, rest.along, 0, rest.normals); rig.apply(pose);
      assert.ok(treadDepth(rig).deepest < .001, `${id}: stopped wheel also clears the nose`);
      assert.equal(measureNearSolids(flat, pose, createNearSolids(), rig.visualTyreRadius).lift, 0, 'no blanket flat-floor lift');
      for (const key of ['airHeight', 'crashBlend', 'ragdollBlend']) {
        pose[key] = .5;
        const excluded = measureNearSolids(step, pose, createNearSolids(), rig.visualTyreRadius);
        assert.equal(excluded.lift, 0); assert.equal(excluded.along, 0); assert.ok(excluded.faces.every(v => v === Infinity));
        pose[key] = 0;
      }
    } finally { rig.dispose(); releaseAppearanceCaches(); }
  }
  assert.ok(controls.get('maribel-vargas') > .004, 'Maribel native-radius control reproduces the real lug defect');
  assert.ok(controls.get('adonisb2') > .002, 'Adonisb2 native-radius control reproduces the real rim defect');
  t.diagnostic(report.join('\n'));
});

test('selected tyre geometry is scanned once at construction; getter and submitted-view helper do no geometry work', async () => {
  const appearance = await prepareAppearance('maribel-vargas', { prepaint: false });
  const rig = createRidingRig(appearance.look, appearance.machine);
  try {
    releaseAppearanceCaches();
    const measured = rig.visualTyreRadius, positions = rig.euc.tyre.geometry.getAttribute('position');
    const getX = positions.getX, getZ = positions.getZ;
    positions.getX = positions.getZ = () => { throw new Error('per-frame tyre geometry read'); };
    try {
      for (let frame = 0; frame < 10; frame++) {
        const pose = createPose(); pose.z = -.08; pose.wheelSpin = frame * .3;
        assert.equal(rig.visualTyreRadius, measured);
        const near = measureNearSolids(step, pose, createNearSolids(), rig.visualTyreRadius);
        rig.setNearSolids(near.lift, near.faces, near.along, 1 / 60, near.normals); rig.apply(pose);
      }
    } finally { positions.getX = getX; positions.getZ = getZ; }
  } finally { rig.dispose(); releaseAppearanceCaches(); }
});

test('invalid optional visual radii fail closed before terrain work and clear a retained near-solid answer', () => {
  const never = { sampleGround() { throw new Error('invalid radius queried terrain'); } };
  const p = createPose(); p.z = -.08;
  for (const invalid of [NaN, Infinity, -Infinity, 0, -.1, NATIVE_RADIUS - .001, null, '.26', 1]) {
    const near = measureNearSolids(step, p, createNearSolids());
    assert.ok(near.lift > 0);
    assert.throws(() => measureNearSolids(never, p, near, invalid), RangeError);
    assert.equal(near.lift, 0); assert.ok(near.faces.every(v => v === Infinity));
    assert.throws(() => tyreStepLift(never, 0, 0, -.08, 0, 1, invalid), RangeError);
  }
});
