// Execute the production gate construction and registration with real Three.js geometry (no browser/GPU).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import * as config from '../js/city-config.js';
import { GEO } from '../js/nyc-geodata.js';
import { subtractConvex } from '../js/ride-geometry.js';
import { NycTerrainSampler } from '../js/euc-terrain.js';
import { EucController } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';

const source = readFileSync(new URL('../js/city-grid.js', import.meta.url), 'utf8');
function productionFunction(name, text = source) {
  const match = new RegExp(`^( *)function ${name}\\(`, 'm').exec(text);
  assert.ok(match, name);
  const end = text.indexOf(`\n${match[1]}}`, match.index);
  assert.ok(end > match.index, `${name} closing brace`);
  return text.slice(match.index, end + match[1].length + 2);
}
const functions = ['createWorldXZShape', 'createExtrudedPolygonMesh', 'offsetPolygonInward', 'rectPolygon',
  'clipPolygonHalfPlane', 'clipPolygonToConvex', 'createFlatPolygonMesh',
  'polygonCentroidArea', 'notchCentralParkWall', 'cutCentralParkSidewalk', 'createCentralParkGateGeometry',
  'setPavingStyle', 'addRideTop', 'addRideSolid', 'addRideMesh', 'addBox'].map(name => productionFunction(name)).join('\n');
const start = source.indexOf('  const cpBlock = CENTRAL_PARK_SIDEWALK;');
const end = source.indexOf('  // Sunlit open meadows', start);
assert.ok(start > 0 && end > start);
const instancesStart = source.indexOf('  const rectSlabs =');
const instancesEnd = source.indexOf('  // 6. Times Square', instancesStart);
const cutsStart = source.indexOf('  const zeroSlab =');
const cutsEnd = source.indexOf('  mergeInto(curbGeos', cutsStart);
assert.ok(instancesStart > 0 && instancesEnd > instancesStart && cutsEnd > cutsStart);
const hedgesStart = source.indexOf('    if (b.median && Math.min');
const hedgesEnd = source.indexOf('\n  }\n  const mergeInto', hedgesStart);
assert.ok(hedgesStart > 0 && hedgesEnd > hedgesStart);
const drivesStart = source.indexOf('  const cpDrives = []');
const drivesEnd = source.indexOf('  // Stone arch bridges', drivesStart);
assert.ok(drivesStart > 0 && drivesEnd > drivesStart);
const lawnsStart = source.indexOf('  const cpLawnPolys = CPG.lawns');
const lawnsEnd = source.indexOf('  // Water:', lawnsStart);
const construct = new Function('THREE', 'config', 'subtractConvex', 'GEO', `
  const { BLOCKS, CENTRAL_PARK_SIDEWALK, CENTRAL_PARK_OUTLINE, CENTRAL_PARK_TOP, CENTRAL_PARK_GATE_SIZE, CENTRAL_PARK_GATES, CENTRAL_PARK_ENTRANCES, centralParkGateAt, inCentralPark } = config;
  const group = new THREE.Group(), rideTops = [], rideSolids = [], footprints = [];
  const curbMat = new THREE.MeshBasicMaterial(), sidewalkMat = new THREE.MeshBasicMaterial();
  const cpLawnMat = new THREE.MeshBasicMaterial(), cpWallMat = new THREE.MeshBasicMaterial();
  const medianHedgeMat = new THREE.MeshBasicMaterial();
  const pavingMat = new THREE.MeshBasicMaterial();
  const cpDriveMat = new THREE.MeshBasicMaterial(), CPG = GEO.centralPark;
  const cpMeadowMat = new THREE.MeshBasicMaterial();
  const flatPts = flat => Array.from({length: flat.length / 2}, (_, i) => ({x: flat[i * 2], z: flat[i * 2 + 1]}));
  const createParkWallMaterial = () => cpWallMat;
  const addFootprint = (...args) => footprints.push(args);
  ${source.slice(source.indexOf('const centralParkEntranceCuts ='), source.indexOf('function cutCentralParkSidewalk('))}
  ${functions}
  // Include real surrounding street slabs too: Farmers' Gate meets ordinary narrow island 359.
  // No waterfront cuts reach these sites; retain their identity operation in this bounded construction harness.
  const nearby = BLOCKS.filter(b => !(b.park > 0.6 && !b.median) && CENTRAL_PARK_ENTRANCES.some(g =>
    b.maxX > g.x - 70 && b.minX < g.x + 70 && b.maxZ > g.z - 70 && b.minZ < g.z + 70));
  const blockSidewalks = nearby.filter(b => b.rect).map(b => ({ cx: (b.minX + b.maxX) / 2,
    cz: (b.minZ + b.maxZ) / 2, w: b.maxX - b.minX, d: b.maxZ - b.minZ, block: b }));
  const irregularSidewalks = nearby.filter(b => !b.rect);
  const unitBox = new THREE.BoxGeometry(1, 1, 1), dummy = new THREE.Object3D();
  const SW_TOP = .22, curbGeos = [], slabGeos = [], hedgeGeos = [], localRoadCuts = [];
  const clearWaterfrontRoad = poly => [poly];
  ${source.slice(instancesStart, instancesEnd)}
  ${source.slice(cutsStart, cutsEnd)}
  for (const b of nearby) { ${source.slice(hedgesStart, hedgesEnd)} }
  for (const geo of curbGeos) group.add(new THREE.Mesh(geo, curbMat));
  for (const geo of slabGeos) group.add(new THREE.Mesh(geo, sidewalkMat));
  for (const geo of hedgeGeos) group.add(new THREE.Mesh(geo, medianHedgeMat));
  ${source.slice(start, end)}
  ${source.slice(lawnsStart, lawnsEnd)}
  ${source.slice(drivesStart, drivesEnd)}
  group.updateMatrixWorld(true);
  return { group, rideTops, rideSolids, footprints, pavingMat, cpDriveMat };
`);
const built = construct(THREE, config, subtractConvex, GEO);
const sampler = new NycTerrainSampler({ tops: built.rideTops, boxes: built.rideSolids });
const { CENTRAL_PARK_ENTRANCES: gates, CENTRAL_PARK_GATE_SIZE: size, CENTRAL_PARK_TOP: floor } = config;
const at = (g, d, u = 0) => ({ x: g.x + g.nx * d + g.tx * u, z: g.z + g.nz * d + g.tz * u });
const sample = p => sampler.sampleGround(p.x, p.z, { normal: {}, base: { normal: {} } });
const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 5);
function drawn(p) {
  ray.ray.origin.set(p.x, 3, p.z);
  return ray.intersectObject(built.group, true)[0];
}

test('W65-north outer landing has drawn lawn at the four actual-world regression samples', () => {
  const g = gates.find(g => Math.hypot(g.x + 845.0880219402635, g.z + 1926.3009633453325) < .001);
  assert.ok(g);
  const u = -g.width / 2 + .75;
  // The old browser probe selected meshes inside a fixed +/-3 m box but cast these rays at u=-6.207 m.
  // The lawn fragment is outside that candidate box, while a city-wide batched wall remains in it.
  const narrow = new THREE.Box3(), full = new THREE.Box3();
  for (const d of [-g.approach - 1.75, size.length + 9]) for (const y of [-1, 3.5]) {
    for (const u of [-3, 3]) { const p = at(g, d, u); narrow.expandByPoint(new THREE.Vector3(p.x, y, p.z)); }
    for (const u of [-g.width / 2, g.width / 2]) { const p = at(g, d, u); full.expandByPoint(new THREE.Vector3(p.x, y, p.z)); }
  }
  for (const d of [12.67, 13, 14, 14.62]) {
    const p = at(g, d, u), hit = drawn(p), ground = sample(p);
    assert.ok(hit, `d=${d}: missing drawn floor`);
    assert.ok(Math.abs(hit.point.y - 1.19) < 1e-5, `d=${d}: expected lawn, drew ${hit.point.y}`);
    assert.ok(Math.abs(hit.point.y - ground.height) < 1e-5, `d=${d}: drawing/support mismatch`);
    const bounds = new THREE.Box3().setFromObject(hit.object);
    assert.equal(bounds.intersectsBox(narrow), false, `d=${d}: reproduce the probe's omitted lawn candidate`);
    assert.equal(bounds.intersectsBox(full), true, `d=${d}: actual full-width corridor includes the lawn`);
  }
});

test('the four screenshot sites are covered by actual source intersections, including the absent-from-drives W106 paths', () => {
  for (const [x, z, expected] of [[-845.06, -3145.19, '79th Street Transverse'],
    [-845.09, -1848.17, '65th Street Transverse'], [-845.09, -1926.33, '65th Street Transverse'],
    [-14.71, -2986.51, '79th Street Transverse'], [-845.01, -5185.36, 'CENTRAL PARK ENTRANCE W 106 ST'],
    [-845.01, -5168.47, 'CENTRAL PARK GREAT HL']]) {
    const crossing = config.CENTRAL_PARK_CROSSINGS.find(c => c.name === expected && Math.hypot(c.x - x, c.z - z) < .02);
    assert.ok(crossing, `source crossing ${expected} ${x},${z}`);
    const opening = config.centralParkGateAt(x, z, .02, true);
    assert.ok(opening, `shared physical opening at ${expected}`);
    assert.ok(opening.gate.sources.includes(crossing));
    assert.ok(crossing.pathWidth >= 4 && crossing.pathWidth <= 13, 'actual road width / 4 m unsurveyed pedestrian path');
  }
  assert.ok(config.CENTRAL_PARK_CROSSINGS.every(c => gates.some(g => g.sources.includes(c))), 'every raw crossing feeds an opening');
});

test('raised drive ribbon triangles stay inside the park instead of projecting onto streets', () => {
  const ring = config.CENTRAL_PARK_OUTLINE;
  for (const mesh of built.group.children.filter(m => m.material === built.cpDriveMat)) {
    const pos = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < (index ? index.count : pos.count); i += 3) {
      const p = new THREE.Vector3();
      for (let k = 0; k < 3; k++) p.add(new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld));
      p.multiplyScalar(1 / 3);
      if (config.inCentralPark(p.x, p.z)) continue;
      const distance = Math.min(...ring.map((a, j) => {
        const b = ring[(j + 1) % ring.length], dx = b.x - a.x, dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
      }));
      assert.ok(distance < .001, `raised road triangle outside park: ${p.x}, ${p.z} (${distance} m)`);
    }
  }
});

test('all derived and named entrances have exact approach vertices, upward facets and a joined 1.19 m landing', () => {
  assert.equal(config.CENTRAL_PARK_GATES.length, 13);
  assert.equal(config.CENTRAL_PARK_CROSSINGS.length, 45);
  assert.equal(gates.length, 35);
  assert.equal(floor, 1.19);
  assert.equal(built.rideSolids.length, 26, 'only the retained gate posts are native boxes');
  const ramps = built.group.children.filter(m => m.material === built.pavingMat);
  assert.equal(ramps.length, gates.length);
  for (const [i, mesh] of ramps.entries()) {
    const g = gates[i], pos = mesh.geometry.attributes.position;
    assert.ok(mesh.geometry.attributes.uv, 'batch/material-compatible paving UVs');
    let frontTop = -Infinity, innerTop = -Infinity;
    for (let j = 0; j < pos.count; j++) {
      if (Math.abs(pos.getZ(j)) < 1e-6) frontTop = Math.max(frontTop, pos.getY(j));
      if (Math.abs(pos.getZ(j) - size.length - size.landing) < 1e-6) innerTop = Math.max(innerTop, pos.getY(j));
    }
    assert.ok(Math.abs(frontTop - g.base) < 1e-7, `${g.name}: no pitched-box lip`);
    assert.ok(Math.abs(innerTop - 1.19) < 1e-7, `${g.name}: landing matches lawn`);
    for (const d of [3, 9, 12.2]) {
      const p = at(g, d, 1.2), contact = drawn(p), s = sample(p);
      assert.ok(contact, `${g.name}: drawn contact`);
      const normal = contact.face.normal.clone().transformDirection(contact.object.matrixWorld);
      assert.ok(normal.y > .99);
      assert.ok(Math.abs(s.normal.x - normal.x) < 1e-6 && Math.abs(s.normal.z - normal.z) < 1e-6,
        `${g.name}: exact slope normal at ${d}`);
      assert.ok(Math.abs(s.base.normal.x - normal.x) < 1e-6 && Math.abs(s.base.normal.z - normal.z) < 1e-6,
        `${g.name}: ragdoll slope normal at ${d}`);
    }
  }
});

test('Farmers\' Gate road approach clears the original median hedge together with its sidewalk', () => {
  const g = gates.find(g => g.name === "Farmers' Gate");
  for (const d of [-6, -5, -4, -3, -2]) {
    const p = at(g, d, 2), hit = drawn(p);
    assert.ok(!hit || Math.abs(hit.point.y) < 1e-4, `d=${d}: approach still draws raised planting at ${hit?.point.y}`);
    assert.equal(sample(p).height, 0, `d=${d}: road support remains at grade`);
  }
});

test('Artisans\' Gate outer approach is not crossed by raised production drive ribbons', () => {
  const g = config.CENTRAL_PARK_GATES.find(g => g.name === "Artisans' Gate");
  for (const u of [-2, 0, 2]) for (const d of [-2.8, -3, -10, -g.approach - .75]) {
    const p = at(g, d, u), hit = drawn(p);
    assert.ok(!hit || Math.abs(hit.point.y) < 1e-4, `u=${u} d=${d}: raised drive at ${hit?.point.y}`);
    assert.equal(sample(p).height, 0, `u=${u} d=${d}: raised drive support`);
  }
});

test('the production park-tree filter clears the landing tree found by actual-world QA', () => {
  const details = readFileSync(new URL('../js/street-details.js', import.meta.url), 'utf8');
  const rowStart = details.indexOf('  for (let tx = cp.minX + 8;');
  const rowEnd = details.indexOf('  // B2.', rowStart);
  const filterStart = details.indexOf('  for (let i = treePositions.length - 1;', details.indexOf('// The Central Park trees keep'));
  const filterEnd = details.indexOf('  // B5.', filterStart);
  assert.ok(rowStart > 0 && rowEnd > rowStart && filterStart > 0 && filterEnd > filterStart);
  const generate = new Function('config', `
    const { CENTRAL_PARK_BOUNDS: cp, centralParkGateAt, inCentralPark } = config;
    const treePositions = [], CP_LAWN_Y = 1.19;
    const mixSpecies = (r, plane, locust) => r < plane ? 0 : r < plane + locust ? 1 : 2;
    ${productionFunction('hashPos', details)}
    ${details.slice(rowStart, rowEnd)}
    const candidates = treePositions.slice();
    ${details.slice(filterStart, filterEnd)}
    return { candidates, retained: treePositions };
  `);
  const trees = generate(config);
  const witness = t => Math.abs(t.x + 586.6) < 1e-6 && Math.abs(t.z + 1413.5) < 1e-6;
  assert.ok(trees.candidates.some(witness), 'the obstructing tree must still be generated by the actual perimeter row');
  assert.ok(!trees.retained.some(witness), 'clear the actual tree and its derived native bodies, not only sampler height');
  assert.ok(trees.retained.length > 100, 'retain the surrounding woodland border');
});

test('built sidewalks, drives and populated support agree along every derived entrance/landing lane', t => {
  let comparisons = 0;
  for (const g of gates) for (const u of [-2.3, 0, 2.3]) {
    for (let d = -Math.max(g.approach, 1.5) + .07; d < 15; d += .137) {
      const p = at(g, d, u), hit = drawn(p), s = sample(p);
      // Below a road-base approach the existing world asphalt is the zero floor, outside this section.
      const y = hit ? hit.point.y : 0;
      assert.ok(Math.abs(y - s.height) < 1e-4, `${g.name} u=${u} d=${d}: drawn ${y}, sampled ${s.height}`);
      comparisons++;
    }
  }
  assert.ok(comparisons > 4600);
  t.diagnostic(`${comparisons} independent rendered-height/support comparisons across ${gates.length * 3} approach/landing lanes`);
  const block = config.BLOCKS.filter(b => b.parkName === 'Central Park').sort((a, b) => b.area - a.area)[0];
  assert.deepEqual(built.footprints, [[(block.minX + block.maxX) / 2, (block.minZ + block.maxZ) / 2,
    block.maxX - block.minX, block.maxZ - block.minZ]], 'navigation reservation is unchanged');
  for (const g of config.CENTRAL_PARK_GATES) {
    const oldBase = config.blockAt(g.x - g.nx * 1.5, g.z - g.nz * 1.5) ? .22 : 0;
    assert.equal(g.postBase, oldBase, `${g.name}: architectural post elevation retained`);
    const opening = gates.find(e => e.sources.some(s => s.named && s.name === g.name));
    const p = at(opening, 6, opening.width / 2 + 2);
    assert.ok(sample(p).height >= 1.05, `${g.name}: adjacent wall remains raised`);
    const post = built.rideSolids[config.CENTRAL_PARK_GATES.indexOf(g) * 2];
    assert.equal(post.centre.y + post.halfExtents.y, oldBase + 1.65, `${g.name}: native post bounds retained`);
    const origin = { x: post.centre.x - g.nx * 2, y: .7, z: post.centre.z - g.nz * 2 };
    assert.ok(sampler.raycastObstacle(origin, { x: g.nx, y: 0, z: g.nz }, 4) !== null,
      `${g.name}: post remains collidable`);
  }
});

test('stock controller completes all derived entrance entry/exit traversals without a hop', () => {
  for (const g of gates) for (const u of [-2, 0, 2]) for (const direction of [1, -1]) {
    const start = -(g.approach > 0 ? g.approach + .75 : 1.5), end = size.length + size.landing + 2;
    const p = at(g, direction > 0 ? start : end, u);
    const euc = new EucController(sampler, { spawn: {
      position: { ...p, y: sample(p).height }, headingY: Math.atan2(g.nx * direction, g.nz * direction)
    } });
    let d;
    for (let step = 0; step < 1200; step++) {
      euc.step(1 / 120, { ...NEUTRAL_ACTIONS, throttle: .5 });
      const state = euc.snapshot();
      d = (state.position.x - g.x) * g.nx + (state.position.z - g.z) * g.nz;
      if (euc.crashed || (direction > 0 ? d >= end : d <= start)) break;
    }
    assert.equal(euc.crashed, false, `${g.name} lane ${u} direction ${direction}: crash at ${d}`);
    assert.ok(direction > 0 ? d >= end : d <= start, `${g.name} lane ${u} direction ${direction}: stopped at ${d}`);
  }
});

test('low throttle can remain stationary on clear grass without an obstruction; stock riding input departs', () => {
  const g = gates.find(g => g.name === "Artists' Gate"), p = at(g, size.length + size.landing + 2);
  const euc = new EucController(sampler, { spawn: {
    position: { ...p, y: sample(p).height }, headingY: Math.atan2(-g.nx, -g.nz)
  } });
  for (let i = 0; i < 600; i++) euc.step(1 / 120, { ...NEUTRAL_ACTIONS, throttle: .35 });
  const idle = euc.snapshot();
  assert.equal(idle.surface, 'grass');
  assert.equal(idle.speed, 0);
  assert.equal(idle.blocked, false);
  assert.equal(idle.curbAhead, 0);
  assert.equal(idle.rollingResistance, 2.8);
  assert.ok(Math.hypot(idle.position.x - p.x, idle.position.z - p.z) < 1e-8);
  for (let i = 0; i < 600; i++) euc.step(1 / 120, { ...NEUTRAL_ACTIONS, throttle: .5 });
  const departed = euc.snapshot();
  assert.equal(euc.crashed, false);
  assert.ok(Math.hypot(departed.position.x - p.x, departed.position.z - p.z) > 10);
});
