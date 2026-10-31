// Bounded production bridge construction, real Three.js geometry and the native EUC controller. No world/GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import { GEO } from '../js/nyc-geodata.js';
import { WATER_RIDE, CENTRAL_PARK_TOP, CENTRAL_PARK_BOUNDS, streetZ } from '../js/city-config.js';
import { SURFACE_IDS } from '../js/euc/data/surfaces.js';
import { NycTerrainSampler } from '../js/euc-terrain.js';
import { EucController, createPose } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';

const source = readFileSync(new URL('../js/city-grid.js', import.meta.url), 'utf8');
function productionFunction(name, text = source) {
  const match = new RegExp(`^( *)function ${name}\\(`, 'm').exec(text);
  assert.ok(match, name);
  const end = text.indexOf(`\n${match[1]}}`, match.index);
  assert.ok(end > match.index, `${name} closing brace`);
  return text.slice(match.index, end + match[1].length + 2);
}
const start = source.indexOf('  // Stone arch bridges:');
const end = source.indexOf('  // The Mall / Literary Walk', start);
assert.ok(start > 0 && end > start);
const construct = new Function('THREE', 'GEO', 'WATER_RIDE', 'CENTRAL_PARK_TOP', `
  const group = new THREE.Group(), rideTops = [], rideSolids = [], waterTops = [], registrations = [];
  const cpWallMat = new THREE.MeshBasicMaterial(), marbleArchMat = new THREE.MeshBasicMaterial();
  const cpPathMat = new THREE.MeshBasicMaterial();
  const cpSite = name => GEO.centralPark.sites.find(s => s.name === name);
  ${['addStoneArchBridge', 'addRideTop', 'addRideSolid', 'addRideMesh'].map(n => productionFunction(n)).join('\n')}
  const registerMesh = addRideMesh, registerSolid = addRideSolid;
  let current;
  addRideMesh = (...args) => {
    current = { mesh: args[0], tops: [], bodies: [] };
    registrations.push(current);
    const from = rideTops.length;
    registerMesh(...args);
    current.tops.push(...rideTops.slice(from));
  };
  addRideSolid = (...args) => {
    const body = registerSolid(...args);
    current.bodies.push(body);
    return body;
  };
  ${source.slice(start, end)}
  // Only the two existing pond registrations, with the production water policy; no surrounding city construction.
  ${productionFunction('addRideWater')}
  for (const w of GEO.centralPark.water.filter(w => w.name === 'The Pond' || w.name === 'The Lake')) {
    const from = rideTops.length;
    addRideWater(Array.from({length: w.ring.length / 2}, (_, i) => ({ x: w.ring[i * 2], z: w.ring[i * 2 + 1] })), 1.24);
    waterTops.push(...rideTops.splice(from));
  }
  group.updateMatrixWorld(true);
  // A bounded patch of the real park's 0.85 + 0.34 m lawn top for independent dry-bank drawing rays.
  const ground = new THREE.Group();
  for (const [i, bridge] of group.children.entries()) {
    const geo = new THREE.PlaneGeometry((i ? 30 : 24) + 26, 14).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.position.set(bridge.position.x, CENTRAL_PARK_TOP, bridge.position.z);
    mesh.rotation.y = bridge.rotation.y;
    ground.add(mesh);
  }
  ground.updateMatrixWorld(true);
  return { group, ground, rideTops, rideSolids, waterTops, registrations, cpPathMat };
`);
const built = construct(THREE, GEO, WATER_RIDE, CENTRAL_PARK_TOP);
const sampler = new NycTerrainSampler({ tops: built.rideTops, boxes: built.rideSolids });
const wet = new NycTerrainSampler({ tops: [...built.waterTops, ...built.rideTops], boxes: built.rideSolids });
const bridges = built.group.children.map((group, i) => ({ group, span: i ? 30 : 24, width: i ? 4.8 : 5.2,
  name: i ? 'Bow Bridge' : 'Gapstow Bridge', end: (i ? 30 : 24) * .49 + 1.3 + 8.75,
  registrations: built.registrations.filter(r => r.mesh.parent === group) }));
const probe = () => ({ normal: {}, base: { normal: {} } });
const at = (bridge, x, z = 0, y = 0) => new THREE.Vector3(x, y, z).applyMatrix4(bridge.group.matrixWorld);
const local = (bridge, p) => bridge.group.worldToLocal(new THREE.Vector3(p.x, p.y, p.z));
const sample = (p, y = Infinity, s = sampler) => s.sampleGround(p.x, p.z, probe(), y);
const down = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 30);
function drawn(bridge, p, ground = false) {
  down.ray.origin.set(p.x, 20, p.z);
  return down.intersectObjects(ground ? [bridge.group, built.ground] : [bridge.group], true)[0];
}
const heading = (bridge, x, z) => {
  const direction = new THREE.Vector3(x, 0, z).transformDirection(bridge.group.matrixWorld);
  return Math.atan2(direction.x, direction.z);
};

test('both bridges retain the exact stone arches, parapets, abutments, transforms, materials and shadow flags', t => {
  assert.equal(bridges.length, 2);
  const hash = createHash('sha256');
  for (const bridge of bridges) {
    assert.equal(bridge.group.children.length, 32, '29 original stone pieces plus one joined walk and two approaches');
    assert.equal(bridge.registrations.length, 32, 'all drawn pieces register before batching');
    const stone = bridge.group.children.filter(m => m.geometry.type === 'BoxGeometry');
    assert.equal(stone.length, 29);
    assert.ok(bridge.group.children.filter(m => m.material === built.cpPathMat).every(m => m.geometry.type !== 'BoxGeometry'),
      'replace the nine disconnected deck boxes; do not leave them under an overlaid slab');
    for (const mesh of stone) {
      hash.update(JSON.stringify([Array.from(mesh.matrixWorld.elements), mesh.castShadow, mesh.receiveShadow,
        bridge.name]));
      for (const name of ['position', 'normal', 'uv']) hash.update(Buffer.from(mesh.geometry.attributes[name].array.buffer));
      hash.update(Buffer.from(mesh.geometry.index.array.buffer));
    }
  }
  t.diagnostic(`unchanged stone geometry fingerprint: ${hash.copy().digest('hex')}`);
  // Independently captured from the accepted HEAD, excluding only the superseded narrow deck boxes.
  assert.equal(hash.digest('hex'), '27ad3fe9c570f578ee52fd248f4d40b7d38ec45bd0d684a76c1f38f847e89952');
  assert.ok(built.rideTops.every(t => t.layered && !t.shore), 'inland suspended support, no shore openings');
  assert.ok([...built.rideTops, ...built.rideSolids].every(t => t.surface === 'brick' && SURFACE_IDS.includes(t.surface)),
    'every bridge surface uses a native riding id, rather than the appearance-only stone id');
});

test('transformed deck, spandrel, parapet and abutment facets agree with independent drawing rays and normals', t => {
  let comparisons = 0, slopes = 0;
  for (const bridge of bridges) {
    for (let x = -bridge.end + .037; x < bridge.end; x += .173) {
      for (let z = -bridge.width / 2 - .43; z < bridge.width / 2 + .5; z += .217) {
        const p = at(bridge, x, z), hit = drawn(bridge, p);
        if (!hit) continue;
        const s = sample(p), normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        assert.ok(Math.abs(s.height - hit.point.y) < 1e-6, `${bridge.name} ${x},${z}: support ${s.height}, drawing ${hit.point.y}`);
        assert.ok(new THREE.Vector3(s.normal.x, s.normal.y, s.normal.z).distanceTo(normal) < 1e-6);
        assert.ok(new THREE.Vector3(s.base.normal.x, s.base.normal.y, s.base.normal.z).distanceTo(normal) < 1e-6);
        assert.ok(Math.abs(s.base.height - hit.point.y) < 1e-6, 'ragdoll terrain uses the same facet');
        assert.equal(s.surface, 'brick');
        comparisons++;
        if (normal.y < .999) slopes++;
      }
    }
  }
  assert.ok(comparisons > 10000 && slopes > 6000);
  t.diagnostic(`${comparisons} independent support/height/normal comparisons; ${slopes} sloping samples`);
});

test('upright bodies stay inside their actual pitched piece, are body-only, and keep each abutment one compact box', t => {
  for (const bridge of bridges) {
    const count = bridge.registrations.reduce((n, r) => n + r.bodies.length, 0);
    t.diagnostic(`${bridge.name}: ${count} compact native bodies, ${bridge.registrations.reduce((n, r) => n + r.tops.length, 0)} facets`);
    assert.ok(count > 38 && count < 500);
    for (const { mesh, bodies } of bridge.registrations) {
      if (mesh.geometry.type !== 'BoxGeometry') {
        for (const b of bodies) {
          assert.equal(b.support, false);
          assert.equal(b.layered, true);
          assert.equal(b.occludes, true);
          const transform = new THREE.Matrix4().makeRotationY(b.rotationY).setPosition(b.centre.x, b.centre.y, b.centre.z);
          // Just inside shared faces: the actual bodies retain the city's one-micrometre ray-seam overlap.
          for (const x of [-.9999, .9999]) for (const z of [-.9999, .9999]) {
            const p = new THREE.Vector3(x * b.halfExtents.x, 0, z * b.halfExtents.z).applyMatrix4(transform);
            down.ray.origin.set(p.x, 20, p.z);
            const hit = down.intersectObject(mesh)[0];
            assert.ok(hit, 'a path body must stay within its drawn tapered footprint');
            assert.ok(b.centre.y + b.halfExtents.y <= hit.point.y + 2e-6, 'no invisible raised path body');
            assert.ok(b.centre.y - b.halfExtents.y >= hit.point.y - .220002, 'no body below the actual 22 cm slab');
          }
        }
        continue;
      }
      const { width, height, depth } = mesh.geometry.parameters;
      assert.ok(bodies.length, 'every drawn volume has a native body');
      if (height === 1.35) assert.equal(bodies.length, 1);
      const inverse = mesh.matrixWorld.clone().invert();
      const localBodies = bodies.map(b => ({ ...b, local: local(bridge, b.centre) }));
      for (const b of bodies) {
        assert.equal(b.support, false, 'slice ceilings must never supply a flat support lid');
        assert.equal(b.layered, true);
        assert.equal(b.occludes, true, 'actual stone volumes occlude camera rays');
        assert.equal(b.rotationY, bridge.group.rotation.y);
        assert.ok(b.halfExtents.x <= width / 2 + 2e-6);
        const transform = new THREE.Matrix4().makeRotationY(b.rotationY).setPosition(b.centre.x, b.centre.y, b.centre.z);
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
          const p = new THREE.Vector3(x * b.halfExtents.x, y * b.halfExtents.y, z * b.halfExtents.z).applyMatrix4(transform).applyMatrix4(inverse);
          assert.ok(Math.abs(p.x) <= width / 2 + 3e-6 && Math.abs(p.y) <= height / 2 + 3e-6 && Math.abs(p.z) <= depth / 2 + 3e-6,
            `${bridge.name}: a body corner escapes its drawn box: ${p.toArray()}`);
        }
      }
      // Check the approximation in the other direction too: inscribed boxes must not omit large portions of stone.
      for (const face of [-1, 1]) for (let k = 0; k <= 32; k++) for (const edge of ['x', 'y']) {
        const x = edge === 'x' ? face * width / 2 : (k / 32 - .5) * width;
        const y = edge === 'y' ? face * height / 2 : (k / 32 - .5) * height;
        const p = local(bridge, new THREE.Vector3(x, y, 0).applyMatrix4(mesh.matrixWorld));
        const distance = Math.min(...localBodies.map(b => Math.hypot(
          Math.max(0, Math.abs(p.x - b.local.x) - b.halfExtents.x),
          Math.max(0, Math.abs(p.y - b.local.y) - b.halfExtents.y))));
        assert.ok(distance <= .06001, `${bridge.name}: missing body strip ${distance} m`);
      }
    }
  }
});

test('native finite-width sweeps catch compact parapet end slices that a point ray clears', () => {
  for (const bridge of bridges) {
    const b = bridge.registrations.filter(r => r.mesh.geometry.parameters?.height === .78)
      .flatMap(r => r.bodies).find(b => b.halfExtents.x < .19);
    assert.ok(b, 'a real parapet end supplies a compact native sweep candidate');
    const isolated = new NycTerrainSampler({ boxes: [b] });
    const matrix = new THREE.Matrix4().makeRotationY(b.rotationY).setPosition(b.centre.x, b.centre.y, b.centre.z);
    const p = new THREE.Vector3(b.halfExtents.x + .1, 0, -1).applyMatrix4(matrix);
    const dir = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
    assert.equal(isolated.raycastObstacle(p, dir, 2), null);
    assert.ok(isolated.raycastObstacle(p, dir, 2, .2) !== null);
  }
});

test('parapet side rays hit their drawn faces, with native sweeps, camera occlusion and ragdoll body collection', () => {
  for (const bridge of bridges) for (const { mesh } of bridge.registrations.filter(r => r.mesh.geometry.parameters?.height === .78)) {
    const side = Math.sign(mesh.position.z), origin = at(bridge, mesh.position.x, mesh.position.z - side, mesh.position.y);
    const direction = new THREE.Vector3(0, 0, side).transformDirection(bridge.group.matrixWorld);
    const expected = 1 - mesh.geometry.parameters.depth / 2;
    const limb = { minX: origin.x - 2, maxX: origin.x + 2, minY: origin.y - 1, maxY: origin.y + 1,
      minZ: origin.z - 2, maxZ: origin.z + 2, count: 0, capacity: built.rideSolids.length, recordOffset: 0,
      records: new Float64Array(built.rideSolids.length * 9) };
    assert.ok(Math.abs(sampler.raycastObstacle(origin, direction, 2, 0, undefined, undefined, undefined, limb) - expected) < 1e-6);
    assert.equal(limb.fulfilled, true);
    assert.ok(limb.count > 0 && !limb.overflow, 'native ragdoll path receives the actual compact bodies');
    assert.ok(Math.abs(sampler.raycast(origin, direction, 2) - expected) < 1e-6);
    assert.ok(Math.abs(sampler.raycastObstacle(origin, direction, 2, .2) - expected) < 1e-6,
      'native lateral sweep does not inflate a wall along the ray direction');
  }
});

test('the arch opening and off-footprint corners stay open; suspended decks never lift the lower park layer', () => {
  for (const bridge of bridges) {
    const p = at(bridge, 0), lower = sample(p, 1.19), upper = sample(p);
    assert.equal(lower.height, 1.19);
    assert.ok(upper.height > 4);
    assert.equal(sampler.topAt(p.x, p.z, false, 1.19), null);
    assert.equal(sampler.raycastObstacle(at(bridge, 0, -bridge.width, .5),
      new THREE.Vector3(0, 0, 1).transformDirection(bridge.group.matrixWorld), bridge.width * 2), null);
    const corners = [at(bridge, bridge.span * .49 + 1.5, bridge.width / 2 + .7), at(bridge, 0, bridge.width / 2 + .7)];
    for (const corner of corners) {
      assert.equal(drawn(bridge, corner), undefined);
      assert.equal(sample(corner).height, 1.19, 'no enclosing bridge rectangle or huge invisible approach');
    }
  }
});

test('a bridge over its actual pond is dry only on its supported layer', () => {
  assert.equal(built.waterTops.length, 2, 'the source ponds must be present');
  for (const bridge of bridges) {
    const p = at(bridge, 0), upper = sample(p);
    assert.equal(wet.isWater(p.x, p.z, 1.19), true, `${bridge.name}: lower pond remains water`);
    assert.equal(wet.isWater(p.x, p.z, upper.height), false, `${bridge.name}: supported deck remains dry`);
    assert.ok(Math.abs(sample(p, upper.height, wet).height - upper.height) < 1e-6);
  }
});

test('stock controllers ride from dry park, across the whole bridge and out to dry park in both directions and three lanes', t => {
  for (const bridge of bridges) for (const direction of [-1, 1]) for (const lane of [-.9, 0, .9]) {
    const end = bridge.end + 1.5, p = at(bridge, -direction * end, lane);
    const rider = new EucController(wet, { spawn: { position: { ...p, y: CENTRAL_PARK_TOP }, headingY: heading(bridge, direction, 0) } });
    let x = -direction * end, highest = CENTRAL_PARK_TOP;
    for (let step = 0; step < 3600 && direction * x < end; step++) {
      rider.step(1 / 120, { ...NEUTRAL_ACTIONS, throttle: .65 });
      const state = rider.snapshot();
      x = local(bridge, state.position).x;
      highest = Math.max(highest, state.position.y);
      assert.equal(rider.crashed, false, `${bridge.name} direction ${direction} lane ${lane} at ${x}`);
      assert.equal(wet.isWater(state.position.x, state.position.z, state.position.y), false, 'the complete supported route stays dry');
      const ground = sample(state.position, state.position.y, wet).height;
      assert.ok(state.position.y >= ground - .001 && state.position.y - ground < (state.grounded ? .06 : .3),
        `${bridge.name} ${direction} x=${x}: rider ${state.position.y}, ground ${ground}, grounded=${state.grounded}`);
    }
    assert.ok(direction * x >= end, `${bridge.name} direction ${direction} lane ${lane}: stopped at ${x}`);
    assert.ok(highest > 4.1, 'the rider crossed the crown rather than staying on the lower park/pond floor');
    assert.ok(Math.abs(rider.snapshot().position.y - CENTRAL_PARK_TOP) < .06, 'the rider actually left the far ramp');
    t.diagnostic(`${bridge.name}: complete direction ${direction}, lane ${lane}, crown ${highest.toFixed(3)} m`);
  }
});

test('stock controller cannot ride through either actual parapet on the crown or either sloping flank', () => {
  for (const bridge of bridges) for (const side of [-1, 1]) for (const x of [-bridge.span * .3, 0, bridge.span * .3]) {
    const p = at(bridge, x), rider = new EucController(wet, { spawn: {
      position: { ...p, y: sample(p).height }, headingY: heading(bridge, 0, side)
    } });
    let z = 0;
    for (let step = 0; step < 600 && !rider.crashed; step++) {
      rider.step(1 / 120, { ...NEUTRAL_ACTIONS, throttle: .5 });
      z = local(bridge, rider.snapshot().position).z;
      assert.ok(side * z < bridge.width / 2 - .39, `${bridge.name}: wheel passed through parapet`);
    }
    assert.ok(side * z > 1, 'the rider actually approached the railing');
  }
});

test('the narrow walking surface, both ramp joins and both lawn exits are continuous in drawing and native support', t => {
  let comparisons = 0;
  for (const bridge of bridges) {
    for (const lane of [-1.15, 0, 1.15]) {
      let previous;
      for (let x = -bridge.end - 1; x <= bridge.end + 1; x += .025) {
        const p = at(bridge, x, lane), hit = drawn(bridge, p, true), s = sample(p, Infinity, wet);
        assert.ok(hit, 'the entire approach/bridge/exit has actual drawn ground');
        assert.ok(Math.abs(s.height - hit.point.y) < 1e-6, `${bridge.name} x=${x}: drawn ${hit.point.y}, support ${s.height}`);
        if (previous !== undefined) assert.ok(Math.abs(hit.point.y - previous) <= .00801, 'no remaining step, overlaid stone lip or unsupported gap');
        previous = hit.point.y;
        assert.equal(wet.isWater(p.x, p.z, s.height), false);
        comparisons++;
      }
    }
  }
  t.diagnostic(`${comparisons} independent 2.5 cm continuity/drawing/native-support samples across complete approaches and exits`);
});

test('path geometry keeps a narrow 22 cm-deep deck and tapered 8 m approaches, with the original crown and exposed stone cheeks', () => {
  for (const bridge of bridges) {
    const walk = bridge.group.children.find(m => m.name === 'StoneBridgeWalk');
    const paths = bridge.group.children.filter(m => m.name === 'StoneBridgeApproach');
    assert.ok(walk);
    assert.equal(paths.length, 2);
    for (const mesh of [walk, ...paths]) {
      const bounds = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
      assert.ok(Math.abs(bounds.max.z - (bridge.width - .7) / 2) < 1e-6, 'do not blanket the stone cheeks or parapets');
      assert.ok(Math.abs(bounds.min.z + (bridge.width - .7) / 2) < 1e-6);
      assert.ok(mesh.geometry.attributes.uv && mesh.geometry.attributes.normal, 'retain batching/material-compatible geometry');
      const pos = mesh.geometry.attributes.position, normal = mesh.geometry.attributes.normal;
      for (let i = 0; i < pos.count; i += 3) {
        if (normal.getY(i) <= 0) continue;
        assert.ok(Math.abs(normal.getX(i) / normal.getY(i)) <= .32001, 'bounded uphill grade, including seams');
        assert.ok(Math.abs(normal.getZ(i)) < 1e-6, 'no unintended cross-slope from tapered ramp triangulation');
      }
      if (mesh !== walk) assert.ok(Math.abs(bounds.max.x - bounds.min.x - 8.75) < 1e-5);
    }
    const top = drawn(bridge, at(bridge, 0));
    assert.ok(Math.abs(top.point.y - (bridge.span === 24 ? 4.36 : 4.21)) < 1e-6, 'preserve the original crown height');
    for (const side of [-1, 1]) {
      const toe = at(bridge, side * (bridge.end - .3));
      assert.ok(Math.abs(drawn(bridge, toe).point.y - CENTRAL_PARK_TOP) < 1e-6, 'flat toe meets the real park lawn');
      assert.equal(wet.isWater(toe.x, toe.z, CENTRAL_PARK_TOP), false, 'both ramp toes reach actual dry banks');
      assert.equal(sample(at(bridge, side * (bridge.end + .3)), CENTRAL_PARK_TOP, wet).height, CENTRAL_PARK_TOP,
        'the route continues beyond the authored geometry on dry park ground');
    }
  }
});

test('the reprofiled walking strip never rises above the parapets at the native wheel probe height', () => {
  for (const bridge of bridges) for (let x = -bridge.span * .38; x <= bridge.span * .38; x += .137) {
    const floor = drawn(bridge, at(bridge, x)).point.y;
    for (const side of [-1, 1]) {
      const p = at(bridge, x, 0);
      p.y = floor + .216001;
      const direction = new THREE.Vector3(0, 0, side).transformDirection(bridge.group.matrixWorld);
      const ray = new THREE.Raycaster(p, direction, 0, bridge.width);
      const contact = ray.intersectObject(bridge.group, true)[0];
      assert.equal(contact?.object.geometry.parameters?.height, .78, `${bridge.name} x=${x}: drawn parapet must still guard the path`);
      const hit = wet.raycastObstacle(p, direction, bridge.width);
      assert.ok(hit !== null && hit <= contact.distance + .061, `${bridge.name} x=${x}: native parapet remains reachable above the deck`);
    }
  }
});

test('existing woodland planting leaves the new dry approach corridors clear', t => {
  const details = readFileSync(new URL('../js/street-details.js', import.meta.url), 'utf8');
  const start = details.indexOf('  if (cpClear) {', details.indexOf('// B4. Woodlands:'));
  const end = details.indexOf('  // The Central Park trees keep', start);
  assert.ok(start > 0 && end > start);
  const flatPts = ring => Array.from({ length: ring.length / 2 }, (_, i) => ({ x: ring[i * 2], z: ring[i * 2 + 1] }));
  // Omitting the additional monument/rock clearings is conservative: this is a superset of retained woodland trees.
  const cpClear = { polygons: [...GEO.centralPark.lawns, ...GEO.centralPark.water].map(p => flatPts(p.ring)),
    drives: GEO.centralPark.drives.map(d => flatPts(d.pts).map(p => [p.x, p.z])), rects: [], circles: [] };
  const generate = new Function('cp', 'cpClear', 'streetZ', `
    const treePositions = [], CP_LAWN_Y = 1.19;
    const mixSpecies = (r, a, b) => r < a ? 0 : r < a + b ? 1 : 2;
    ${productionFunction('hashPos', details)}
    ${details.slice(start, end)}
    return treePositions;
  `);
  const trees = generate(CENTRAL_PARK_BOUNDS, cpClear, streetZ);
  for (const bridge of bridges) {
    const near = trees.map(tree => ({ tree, p: local(bridge, tree) })).filter(({ p }) =>
      Math.abs(p.x) >= bridge.span * .49 && Math.abs(p.x) <= bridge.end + 1.5 && Math.abs(p.z) <= 3.25);
    assert.deepEqual(near, [], `${bridge.name}: a generated trunk obstructs the approach; clear planting through shared construction data`);
  }
  t.diagnostic(`checked ${trees.length} conservative production woodland candidates; no approach planting removal needed`);
});

test('native crash bodies and automatic recovery stay on the drawn dry deck above the pond', () => {
  for (const bridge of bridges) {
    const p = at(bridge, 0), floor = sample(p).height;
    const rider = new EucController(wet, { spawn: { position: { ...p, y: floor }, headingY: heading(bridge, 1, 0) } });
    rider.hardKnock(0, 1);
    assert.equal(rider.crashed, true);
    const pose = createPose();
    let sawRagdoll = false;
    for (let i = 0; i < 1080; i++) {
      rider.step(1 / 120, NEUTRAL_ACTIONS);
      rider.writePose(pose);
      assert.ok(pose.y > floor - .1, 'the wheel cannot drop through the thin reprofiled deck into the lower pond');
      if (pose.ragdollBlend > 0) {
        sawRagdoll = true;
        for (let j = 0; j < pose.ragdoll.length; j++) assert.ok(Number.isFinite(pose.ragdoll[j]), 'finite native ragdoll contacts');
        assert.ok(pose.ragdoll[1] > floor - .2, 'pelvis remains above the actual walking face');
      }
    }
    assert.ok(sawRagdoll);
    assert.equal(rider.crashed, false, 'automatic recovery can find clear supported deck, not only a dry bank');
    const state = rider.snapshot();
    assert.ok(Math.abs(state.position.y - sample(state.position, state.position.y, wet).height) < .06);
    assert.equal(wet.isWater(state.position.x, state.position.z, state.position.y), false);
  }
});
