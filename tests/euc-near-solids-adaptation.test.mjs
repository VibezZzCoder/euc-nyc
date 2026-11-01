// Production helper + real selected rigs/Three CPU geometry. No browser, renderer or GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import { createPose } from '../js/euc/simulation/EucController.js';
import { createNearSolids, measureNearSolids, tyreStepLift, clearNearSolids } from '../js/euc/app/nearSolids.js';
import { createRidingRig } from '../js/euc/render/ridingRig.js';
import { prepareAppearance, releaseAppearanceCaches, appearanceResourceStats } from '../js/euc/render/appearanceLoader.js';
import { CHARACTER_IDS } from '../js/euc/data/riders.js';
import { NEAR_SOLID, WHEEL } from '../js/euc/data/tuning.js';

const radius = WHEEL.tyreDiameter / 2;
function stepSampler() {
  const references = [];
  return { references, sampleGround(_x, z, out, y) {
    references.push(y);
    // A bridge at the same XZ deliberately wins a query with no reference; lower stairs must not see it.
    Object.assign(out, { height: y === undefined || y > 50 ? 100 : 10 + (z >= 0 ? .18 : 0),
      normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false }); return out;
  }, raycast() { return null; } };
}
function tyreDepth(z, y) {
  let deepest = -Infinity;
  for (let index = -250; index <= 250; index++) {
    const along = index / 1000;
    const ground = 10 + (z + along >= 0 ? .18 : 0);
    deepest = Math.max(deepest, ground - (y + radius - Math.sqrt(Math.max(0, radius ** 2 - along ** 2))));
  }
  return deepest;
}

test('lower-floor stair noses: old unlifted circle clips; bidirectional lifted circle clears by <2 mm', () => {
  const sampler = stepSampler();
  let before = 0, after = -Infinity;
  for (const direction of [-1, 1]) for (let mm = -250; mm <= 250; mm++) {
    const z = mm / 1000, y = 10 + (z >= 0 ? .18 : 0);
    const lift = tyreStepLift(sampler, 0, y, z, 0, direction);
    before = Math.max(before, tyreDepth(z, y)); after = Math.max(after, tyreDepth(z, y + lift));
  }
  assert.ok(before > .17, `unfixed control depth ${before}`);
  assert.ok(after < .002, `fixed depth ${after}`);
  assert.ok(sampler.references.every(y => y >= 10 && y < 11), 'every sample/bisection selects the actual lower floor');
});

test('resting roll preserves the selected floor; absent reference is a deliberately failing overhead-deck control', () => {
  const sampler = stepSampler(), pose = createPose(), out = createNearSolids();
  Object.assign(pose, { y: 10, z: -.08, restFactor: 1 });
  measureNearSolids(sampler, pose, out);
  assert.ok(out.along < 0 && out.along > -radius);
  assert.ok(out.lift <= NEAR_SOLID.restLiftMax + 1e-9);
  assert.ok(tyreDepth(pose.z + out.along, pose.y + out.lift) < .002);
  assert.ok(sampler.references.every(y => y === 10));
  const old = { ...sampler, sampleGround(x, z, sample) { return sampler.sampleGround(x, z, sample); } };
  measureNearSolids(old, pose, out);
  assert.equal(out.lift, 0, 'old helper saw the overhead slab, missing the lower stair nose');
});

function wallSampler(distance = .26, normalX = 0, normalZ = 1, top = Infinity) {
  let casts = 0, wheelCasts = 0;
  return { get casts() { return casts; }, get wheelCasts() { return wheelCasts; },
    sampleGround(_x, _z, out, y) {
      assert.ok(Number.isFinite(y)); Object.assign(out, { height: y, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false }); return out;
    }, raycast() { return null; }, raycastWheelObstacle() { wheelCasts++; throw new Error('presentation must not probe the shell-only rail envelope'); },
    raycastObstacle(origin, direction, max, width, _axis, hit) {
      casts++; assert.equal(width, 0);
      const along = direction.x * normalX + direction.z * normalZ;
      const d = along > 1e-6 && origin.y < top ? (distance - origin.x * normalX - origin.z * normalZ) / along : Infinity;
      if (d > max) return null;
      Object.assign(hit.normal, { x: -normalX, y: 0, z: -normalZ }); return d;
    } };
}

test('body probes use actual thin bodies, exactly 48 casts, and exclude air/crash/ragdoll without mutating the pose', () => {
  const s = wallSampler(), p = createPose(), out = createNearSolids(), before = structuredClone(p);
  measureNearSolids(s, p, out);
  assert.equal(s.casts, 48); assert.equal(s.wheelCasts, 0);
  assert.equal(out.faces[0], .26); assert.equal(out.normals[1], -1);
  assert.deepEqual(p, before);
  for (const [key, value] of [['airHeight', .2], ['crashBlend', .5], ['ragdollBlend', .5]]) {
    p[key] = value; measureNearSolids(s, p, out); p[key] = 0;
    assert.equal(out.lift, 0); assert.ok(out.faces.every(v => v === Infinity)); assert.equal(s.casts, 48);
  }
});

// Independent full-vertex measurement, not the rig's sparse hull/constraint implementation.
function deepestBody(rig, distance, normalX = 0, normalZ = 1, top = Infinity) {
  rig.group.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  let deepest = -Infinity;
  rig.rider.root.traverse(mesh => {
    if (!mesh.isMesh || mesh.name === 'rider-paddle-mesh') return;
    for (let node = mesh; node && node !== rig.rider.root; node = node.parent) if (!node.visible) return;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (point.y >= top) continue;
      deepest = Math.max(deepest, point.x * normalX + point.z * normalZ - distance);
    }
  });
  return deepest;
}

test('all eleven selected looks: old lean clips, corrected real posed vertices clear; no pose mutation or retained pixel banks', async () => {
  for (const id of CHARACTER_IDS) {
    const appearance = await prepareAppearance(id, { prepaint: false });
    const rig = createRidingRig(appearance.look, appearance.machine), pose = createPose(), out = createNearSolids();
    try {
      releaseAppearanceCaches();
      pose.wheelPitch = .35;
      const before = structuredClone(pose);
      rig.apply(pose);
      assert.ok(deepestBody(rig, .26) > .2, `${id}: uncorrected control reproduces clipping`);
      measureNearSolids(wallSampler(), pose, out);
      rig.setNearSolids(out.lift, out.faces, out.along, 1 / 60, out.normals); rig.apply(pose);
      assert.ok(deepestBody(rig, .26) < .003, `${id}: actual corrected body depth ${deepestBody(rig, .26)}`);
      assert.ok(rig.nearPush[1] < -.2 && Math.abs(rig.nearPush[0]) < .01);
      assert.deepEqual(pose, before);
      assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
      // Face normals matter between probes and for low deck sides beside the parked boot.
      for (const [angle, top, rest] of [[.26, Infinity, 0], [-.7, Infinity, 0], [Math.PI / 2, .9, 1]]) {
        const nx = Math.sin(angle), nz = Math.cos(angle);
        pose.restFactor = rest;
        measureNearSolids(wallSampler(.26, nx, nz, top), pose, out);
        rig.setNearSolids(out.lift, out.faces, out.along, 1 / 60, out.normals); rig.apply(pose);
        assert.ok(deepestBody(rig, .26, nx, nz, top) < .003, `${id}: angle ${angle}, top ${top}`);
      }
      pose.restFactor = 0;
      measureNearSolids(wallSampler(), pose, out);
      rig.setNearSolids(out.lift, out.faces, out.along, 0, out.normals); rig.apply(pose);
      const held = Math.hypot(...rig.nearPush);
      clearNearSolids(out); rig.setNearSolids(0, out.faces, 0, 1 / 60, out.normals); rig.apply(pose);
      assert.ok(Math.hypot(...rig.nearPush) < held && Math.hypot(...rig.nearPush) > held * .6);
      rig.setNearSolids(0, []); rig.apply(pose);
      assert.deepEqual([...rig.nearPush], [0, 0], 'teleport/rider reset can snap stale push');
      // Retained channels are defensively inert when a frame enters flight/crash before the host clears them.
      for (const key of ['airHeight', 'crashBlend', 'ragdollBlend']) {
        rig.setNearSolids(.1, out.faces, .1); pose[key] = .2; rig.apply(pose);
        assert.deepEqual(rig.group.position.toArray(), [pose.x, pose.y, pose.z], `${id}: ${key}`); pose[key] = 0;
      }
    } finally { rig.dispose(); releaseAppearanceCaches(); }
  }
});

test('release easing must not sacrifice clearance when a smaller push is needed at a different wall', async t => {
  // Remove only the local easing-safety block in an isolated module to preserve the demonstrated failing control.
  // Dependencies, geometry, pose and actual submitted-view timing remain identical to production.
  const moduleURL = new URL('../js/euc/render/ridingRig.js', import.meta.url);
  const source = readFileSync(moduleURL, 'utf8');
  const start = source.search(/if \(solidAny\) \{\s+const easedX = push\[0\]/);
  assert.ok(start >= 0, 'local easing safety block is present');
  const open = source.indexOf('{', start);
  let depth = 1, end = open + 1;
  while (depth > 0 && end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0);
  const unfixedSource = (source.slice(0, start) + source.slice(end)).replace(/from '([^']+)'/g,
    (_all, spec) => `from '${new URL(spec, moduleURL).href}'`);
  const { createRidingRig: createUnfixedRig } = await import(`data:text/javascript;base64,${Buffer.from(unfixedSource).toString('base64')}`);
  const appearance = await prepareAppearance('cool-rider', { prepaint: false });
  const rig = createRidingRig(appearance.look, appearance.machine);
  const control = createUnfixedRig(appearance.look, appearance.machine), pose = createPose(), near = createNearSolids();
  try {
    releaseAppearanceCaches();
    pose.wheelPitch = .35;
    measureNearSolids(wallSampler(), pose, near);
    for (const r of [rig, control]) { r.setNearSolids(near.lift, near.faces, near.along, 1 / 60, near.normals); r.apply(pose); }
    assert.ok(Math.hypot(...rig.nearPush) > .2);
    // The rider parks beside the next low deck face while the old wall's larger push is still easing away.
    pose.restFactor = 1;
    measureNearSolids(wallSampler(.26, 1, 0, .9), pose, near);
    for (const r of [rig, control]) { r.setNearSolids(near.lift, near.faces, near.along, 1 / 60, near.normals); r.apply(pose); }
    const before = deepestBody(control, .26, 1, 0, .9), after = deepestBody(rig, .26, 1, 0, .9);
    assert.ok(before > .14, `prior magnitude-only release control reproduces ${before} m penetration`);
    assert.ok(after < .003, `new face penetrated by ${after} m during release easing`);
    t.diagnostic(`new-face body penetration: prior magnitude-only easing ${before} m; constraint-safe easing ${after} m`);
  } finally { rig.dispose(); control.dispose(); releaseAppearanceCaches(); }
});
