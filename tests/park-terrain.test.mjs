// Bounded production park construction with real Three CPU geometry; no browser, renderer, GPU or whole city.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.core.js';
import * as config from '../js/city-config.js';
import { subtractConvex, convexHullXZ, prismSlices, railBodies } from '../js/ride-geometry.js';
import { JEFFERSON_SKATEPARK, buildJeffersonSkatepark } from '../js/jefferson-skatepark.js';
import { NycTerrainSampler } from '../js/euc-terrain.js';

const source = readFileSync(new URL('../js/city-grid.js', import.meta.url), 'utf8');
function productionFunction(name, text) {
  const match = new RegExp(`^( *)function ${name}\\(`, 'm').exec(text);
  assert.ok(match, name);
  const end = text.indexOf(`\n${match[1]}}`, match.index);
  assert.ok(end > match.index, `${name} closing brace`);
  return text.slice(match.index, end + match[1].length + 2);
}
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `${start} construction slice`);
  return text.slice(a, b);
}

// Exported only for headless accepted-source fingerprint comparison, not a production test hook.
export function buildPark(kind = 'jefferson', text = source, buildJefferson = buildJeffersonSkatepark) {
  const construct = new Function('THREE', 'config', 'subtractConvex', 'convexHullXZ', 'prismSlices', 'railBodies',
    'JEFFERSON_SKATEPARK', 'buildJeffersonSkatepark', 'kind', `
    const { WATER_RIDE, BLOCKS, WATERFRONT_PIERS, ESPLANADE_RAIL, getIslandBoundsAtZ, streetZ } = config;
    const group = new THREE.Group(), rideTops = [], rideSolids = [];
    const M = Object.fromEntries(['ground', 'bldg', 'paint', 'sign'].map(k => [k, new THREE.MeshBasicMaterial()]));
    const { ground: GR, bldg: BL, paint: PA } = M;
    const DY = .12, Y_AXIS = new THREE.Vector3(0, 1, 0), trees = [];
    let seed = 1234567;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let venue = null, pier62RoadCuts = [];
    const area = poly => Math.abs(poly.reduce((sum, a, i) => {
      const b = poly[(i + 1) % poly.length]; return sum + a.x * b.z - a.z * b.x;
    }, 0)) / 2;
    ${['createWorldXZShape', 'createExtrudedPolygonMesh', 'createPierBoxBatcher', 'sampleWaterfrontShore', 'addRideTop', 'addRideSolid', 'addRideMesh']
      .map(name => productionFunction(name, text)).join('\n')}
    const B = createPierBoxBatcher();
    ${between(text, '  const frame = (', '  // Hudson piers run straight')}
    ${between(text, '  const netWall = (', '  // Hudson River Park lawn piers')}
    ${between(text, '  const skateProfile = (', '  // The original landward riding line')}
    if (kind === 'jefferson') {
      buildJeffersonSkatepark(frame(JEFFERSON_SKATEPARK.x, JEFFERSON_SKATEPARK.z, 0, false, [], false), M, skateProfile, netWall);
    } else if (kind === 'pier62') {
      // The real road reservation: execute its producer with the original block-sidewalk navigation covers.
      const roadSidewalks = [], irregularSidewalks = [], blockSidewalks = [], addFootprint = () => {};
      ${between(text, '  for (const b of BLOCKS) {', '    // Planted malls down the middle')} }
      ${between(text, 'const PIER62_ROAD =', '\n\n')}
      ${between(text, '  const westRows =', '  const pier57Rows =')}
      ${between(text, '  const pier62Rows =', '  // The nearby street-network avenue')
        .replace('const pier62RoadCuts = [];', 'pier62RoadCuts = [];')}
      ${between(text, '  const pierFrame =', '  // Steel pipe railing')}
      ${between(text, '  const railing =', '  const kinds = {};')}
      const kinds = {}, ships = {};
      ${between(text, '  // The original landward riding line', '  // Pier 25 (Tribeca)')}
      const p = WATERFRONT_PIERS.find(p => p.skateSection);
      venue = pierFrame(p);
      kinds.park(venue, p);
    } else throw new Error('unknown park');
    B.build(group, new Set([BL, PA]));
    group.updateMatrixWorld(true);
    return { group, rideTops, rideSolids, trees, venue, pier62RoadCuts };
  `);
  return construct(THREE, config, subtractConvex, convexHullXZ, prismSlices, railBodies, JEFFERSON_SKATEPARK, buildJefferson, kind);
}

export function physicalFingerprint(built) {
  const hash = createHash('sha256');
  built.group.traverse(mesh => {
    if (!mesh.isMesh) return;
    hash.update(JSON.stringify([mesh.matrixWorld.elements, mesh.castShadow, mesh.receiveShadow]));
    for (const name of ['position', 'normal', 'uv']) {
      const attribute = mesh.geometry.attributes[name];
      if (attribute) hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    }
    if (mesh.geometry.index) hash.update(Buffer.from(mesh.geometry.index.array.buffer));
  });
  hash.update(JSON.stringify(built.rideTops.map(({ capabilities, ...top }) => top)));
  hash.update(JSON.stringify(built.rideSolids));
  hash.update(JSON.stringify(built.trees));
  return hash.digest('hex');
}

const built = buildPark();
const sampler = new NycTerrainSampler({ tops: built.rideTops, boxes: built.rideSolids });
const probe = () => ({ normal: {}, base: { normal: {} } });
const at = (u, s, y = JEFFERSON_SKATEPARK.top) => ({ x: JEFFERSON_SKATEPARK.x + u, z: JEFFERSON_SKATEPARK.z + s, y });
const centre = t => ({ x: t.poly.reduce((s, p) => s + p.x, 0) / t.poly.length,
  z: t.poly.reduce((s, p) => s + p.z, 0) / t.poly.length });
const height = (t, p) => t.plane ? t.plane.y + t.plane.dx * (p.x - t.plane.x) + t.plane.dz * (p.z - t.plane.z) : t.top;

test('Jefferson metadata leaves every drawn vertex/normal/UV/transform, support facet and body unchanged', t => {
  t.diagnostic(`accepted-source physical fingerprint: ${physicalFingerprint(built)}`);
  // Independently constructed with accepted HEAD ca9a67d's city-grid.js and Jefferson builder, before metadata.
  assert.equal(physicalFingerprint(built), 'c46eeb7a834707f6a2e77591001dd5da15f6a6d090e335a052689f69baca75cb');
  assert.equal(built.trees.length, 0, 'the park never removes or relocates existing city trees');
  assert.ok(built.rideTops.every(t => !t.shore));
  assert.equal(sampler.plan.recovery, undefined, 'no imported world-wide rest policy');
  assert.equal(sampler.plan.heightfield.transition, undefined, 'no Foundry field');
});

test('actual authored slope facets opt in; flat platforms, stairs, benches, spine and run-ups do not', () => {
  const features = new Set();
  let sloped = 0, flat = 0, steep = 0;
  for (const t of built.rideTops) {
    if (!t.capabilities) continue;
    const p = centre(t), y = height(t, p);
    if (sampler.topAt(p.x, p.z, false, y) !== t) continue; // covered floor, coping, rail, or a shared seam
    const g = sampler.sampleGround(p.x, p.z, probe(), y);
    if (Math.abs(g.height - y) > 1e-5) continue;
    assert.equal(sampler.restartsAtRest(p.x, p.z, y), true);
    assert.equal(sampler.transitionAt(p.x, p.z, y), t.capabilities.transition === true, t.capabilities.feature);
    if (t.capabilities.transition) {
      sloped++; features.add(t.capabilities.feature);
      assert.ok(Math.hypot(t.plane.dx, t.plane.dz) > 1e-6);
      if (Math.acos(g.normal.y) > 42 * Math.PI / 180) { steep++; assert.equal(t.capabilities.feature, 'jefferson-quarter'); }
    } else flat++;
  }
  assert.deepEqual([...features].sort(), ['jefferson-double-bank', 'jefferson-east-bank', 'jefferson-north-bank',
    'jefferson-quarter', 'jefferson-roller-north', 'jefferson-roller-south', 'jefferson-step-bypass'].sort());
  assert.ok(sloped > 100 && flat > 10 && steep > 4);
  for (const [u, s] of [[0, -25], [0, 0], [0, 12], [-8, -.5], [-8, -24], [6.5, -4], [7, -1.6], [-9, 8.5], [11, 6]]) {
    const p = at(u, s), y = sampler.sampleGround(p.x, p.z, probe(), 2).height;
    assert.equal(sampler.transitionAt(p.x, p.z, y), false, `flat ${u},${s}`);
    assert.equal(sampler.restartsAtRest(p.x, p.z, y), true);
  }
});

test('capability metadata preserves independent drawn/support facet height and normal agreement', t => {
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const untagged = new NycTerrainSampler({ tops: built.rideTops.map(({ capabilities, ...top }) => top), boxes: built.rideSolids });
  let checks = 0, maxHeightError = 0, maxNormalError = 0;
  for (const top of built.rideTops) {
    const p = centre(top), y = height(top, p);
    ray.ray.origin.set(p.x, 5, p.z);
    const hit = ray.intersectObject(built.group, true)[0];
    if (!hit || Math.abs(hit.point.y - y) > .001) continue;
    const g = sampler.sampleGround(p.x, p.z, probe(), y);
    const heightError = Math.abs(g.height - hit.point.y);
    const normalError = new THREE.Vector3(g.normal.x, g.normal.y, g.normal.z).distanceTo(hit.face.normal);
    maxHeightError = Math.max(maxHeightError, heightError); maxNormalError = Math.max(maxNormalError, normalError);
    assert.ok(heightError < .001);
    // The unchanged batcher rounds world Z ~-5850 to Float32, while support transforms the local Float32 facets
    // in doubles. Allow <0.003 unit-normal error (~0.17 degrees) on short steep chords from that quantization;
    // the accepted physical fingerprint and metadata-stripped samples are bit-exact, including every facet plane.
    assert.ok(normalError < .003,
      `${top.capabilities?.feature} at ${JSON.stringify(p)}: support ${JSON.stringify(g.normal)}, drawn ${JSON.stringify(hit.face.normal)}`);
    assert.deepEqual(g.base.normal, g.normal);
    assert.deepEqual(g, untagged.sampleGround(p.x, p.z, probe(), y));
    checks++;
  }
  assert.ok(checks > 120);
  t.diagnostic(`${checks} independent drawn/support checks; maximum height error ${maxHeightError} m, normal error ${maxNormalError}`);
});

test('open north/south court boundaries and the six-metre central bypass do not become transitions', () => {
  for (const u of [-2.9, 0, 2.9]) {
    for (const s of [-30.9, -20, 0, 14.9]) {
      const p = at(u, s);
      assert.equal(sampler.transitionAt(p.x, p.z, p.y), false);
      assert.equal(sampler.restartsAtRest(p.x, p.z, p.y), true);
    }
    for (const s of [-31.01, 15.01]) {
      const p = at(u, s);
      assert.equal(sampler.transitionAt(p.x, p.z, p.y), false);
      assert.equal(sampler.restartsAtRest(p.x, p.z, p.y), false);
    }
  }
});

test('explicit finite support elevation is mandatory; remote, above, and below the feature are inert', () => {
  const top = built.rideTops.find(t => t.capabilities?.transition), p = centre(top), y = height(top, p);
  assert.equal(sampler.transitionAt(p.x, p.z, y), true);
  for (const ref of [undefined, NaN, Infinity, -Infinity, y + .601, y - .601, y + 10, y - 10]) {
    assert.equal(sampler.transitionAt(p.x, p.z, ref), false);
    assert.equal(sampler.restartsAtRest(p.x, p.z, ref), false);
  }
  assert.equal(sampler.restartsAtRest(), false, 'the donor no-argument call cannot enable city-wide rest recovery');
  assert.equal(sampler.transitionAt(NaN, p.z, y), false);
});

const rectangle = (x, z, h, extra = {}) => ({ poly: [{ x, z }, { x: x + 4, z }, { x: x + 4, z: z + 4 }, { x, z: z + 4 }],
  minX: x, maxX: x + 4, minZ: z, maxZ: z + 4, top: h, surface: 'pavement', ...extra });
const tagged = { feature: 'layer-test', transition: true, restartsAtRest: true };

test('same-XZ unrelated lower/upper floors and native solid tops never borrow a feature capability', () => {
  const { x, z } = at(0, 0), feature = rectangle(x, z, 4, { layered: true, capabilities: tagged });
  const lower = rectangle(x, z, .24), upper = rectangle(x, z, 8, { layered: true });
  const s = new NycTerrainSampler({ tops: [lower, feature, upper] });
  for (const ref of [.24, 8, .24, 4, 8, 4]) {
    assert.equal(s.sampleGround(x + 1, z + 1, probe(), ref).height, ref);
    assert.equal(s.transitionAt(x + 1, z + 1, ref), ref === 4);
    assert.equal(s.restartsAtRest(x + 1, z + 1, ref), ref === 4);
  }
  const body = { centre: { x: x + 2, y: 2.2, z: z + 2 }, halfExtents: { x: 1, y: 2.2, z: 1 }, surface: 'pavement', rotationY: 0 };
  const masked = new NycTerrainSampler({ tops: [feature], boxes: [body] });
  assert.equal(masked.transitionAt(x + 2, z + 2, 4.4), false, 'a higher solid wins actual support');
  body.support = false;
  assert.equal(new NycTerrainSampler({ tops: [feature], boxes: [body] }).transitionAt(x + 2, z + 2, 4), true,
    'body-only geometry does not replace the support facet');
});

test('triangle bounds are only a broad phase; base ground and water cannot acquire a covered facet flag', () => {
  const { x, z } = at(0, 0);
  const triangle = rectangle(x, z, .3, { capabilities: tagged });
  triangle.poly = triangle.poly.slice(0, 3);
  const s = new NycTerrainSampler({ tops: [triangle] });
  assert.equal(s.transitionAt(x + 3, z + 1, .3), true);
  assert.equal(s.transitionAt(x + 1, z + 3, .3), false, 'inside bounds, outside triangle');
  const buried = new NycTerrainSampler({ tops: [{ ...triangle, top: -.1 }] });
  assert.equal(buried.transitionAt(x + 3, z + 1, -.1), false, 'city base above the feature');
  const wet = new NycTerrainSampler({ tops: [{ ...triangle, water: { level: .3, floor: .1, band: 0 } }] });
  assert.equal(wet.restartsAtRest(x + 3, z + 1, .3), false);
});

test('culling has no authority over capability/support queries or independent floor references', () => {
  built.group.visible = false;
  for (const mesh of built.group.children) mesh.visible = false;
  const top = built.rideTops.find(t => t.capabilities?.transition), p = centre(top), y = height(top, p);
  for (let i = 0; i < 20; i++) {
    assert.equal(sampler.transitionAt(p.x, p.z, y), true);
    assert.equal(sampler.transitionAt(p.x, p.z, y + 5), false);
    assert.equal(sampler.restartsAtRest(p.x, p.z, y), true);
  }
  built.group.visible = true;
  for (const mesh of built.group.children) mesh.visible = true;
});

test('local rest is a speed policy, retaining checked recovery and dynamic placement refusal', () => {
  const flat = at(0, 0);
  assert.equal(sampler.restartsAtRest(flat.x, flat.z, flat.y), true);
  const request = { fallen: flat, safePoints: [], headingY: 0, maxStepUp: .216 };
  assert.ok(sampler.findRecoveryTarget(request, () => true));
  assert.equal(sampler.findRecoveryTarget(request, () => false), null);
  const face = built.rideTops.find(t => t.capabilities?.transition && Math.hypot(t.plane.dx, t.plane.dz) > 1);
  const p = centre(face), y = height(face, p);
  assert.equal(sampler.restartsAtRest(p.x, p.z, y), true);
  assert.equal(sampler.findPlacementTarget({ ...p, referenceY: y }), null, 'steep rest-tagged face is not safe standing support');
});

test('sparse local index rejects distant-city and empty-cell lookups before ground/shore/solid sampling', () => {
  const s = new NycTerrainSampler({ tops: built.rideTops, boxes: built.rideSolids });
  assert.ok(s.capabilityGrid.size <= 20);
  s.topAt = s.sampleGround = () => { throw new Error('distant lookup did terrain work'); };
  for (let i = 0; i < 10000; i++) {
    assert.equal(s.transitionAt(5, -1000 - i / 10, 0), false);
    assert.equal(s.restartsAtRest(5, -1000 - i / 10, 0), false);
  }
  const p = at(15.9, 15.1); // just past the court, inside its last index cell
  assert.equal(s.restartsAtRest(p.x, p.z, .24), false);
  const top = built.rideTops.find(t => t.capabilities?.transition), f = centre(top);
  assert.equal(s.transitionAt(f.x, f.z, 100), false, 'wrong elevations also reject before ordinary support queries');
});

const pier = buildPark('pier62');
const pierSampler = new NycTerrainSampler({ tops: pier.rideTops, boxes: pier.rideSolids, shoreRails: true });

test('Pier 62 reuses surface capabilities within the existing course, keeping its road cuts and layers', t => {
  t.diagnostic(`Pier 62 physical fingerprint: ${physicalFingerprint(pier)}`);
  // Independently constructed from accepted ca9a67d's unmodified park/frame/batching/road-reservation producers.
  assert.equal(physicalFingerprint(pier), '3c6b6e1e45202430812a8693547f8a4dbc02bfac9ec40c71d8210679c4c1bc0e');
  assert.ok(pier.pier62RoadCuts.length > 1);
  const features = new Set();
  let positive = 0;
  for (const top of pier.rideTops) {
    if (!top.capabilities) continue;
    assert.ok(top.shore, 'pier support keeps its existing shore ownership');
    for (const cut of pier.pier62RoadCuts) {
      const p = centre(top);
      assert.equal(config.pointInPoly(cut.poly, p.x, p.z), false, 'capability never fills the road reservation');
    }
    const p = centre(top), y = height(top, p);
    const g = pierSampler.sampleGround(p.x, p.z, probe(), y);
    if (pierSampler.topAt(p.x, p.z, false, y) !== top || Math.abs(g.height - y) > 1e-5) continue;
    assert.equal(pierSampler.transitionAt(p.x, p.z, y), top.capabilities.transition === true);
    assert.equal(pierSampler.restartsAtRest(p.x, p.z, y), true);
    if (top.capabilities.transition) { positive++; features.add(top.capabilities.feature); }
    assert.equal(pierSampler.transitionAt(p.x, p.z, y + 6), false, 'bridge/overhead reference');
  }
  assert.ok(positive > 100);
  assert.deepEqual([...features].sort(), ['pier62-tabletop', 'pier62-quarter', 'pier62-roller-0.45',
    'pier62-roller-0.65', 'pier62-far-bank', 'pier62-far-quarter'].sort());
  for (const cut of pier.pier62RoadCuts) {
    const p = centre(cut);
    assert.equal(pierSampler.transitionAt(p.x, p.z, 0), false);
    assert.equal(pierSampler.restartsAtRest(p.x, p.z, 0), false);
  }
  assert.ok(pierSampler.capabilityGrid.size <= 45, 'bounded local references, not a city/Foundry field');
});

test('Pier 62 retains drawn/support normals, below/above-floor isolation and metadata-free support equivalence', t => {
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const untagged = new NycTerrainSampler({ tops: pier.rideTops.map(({ capabilities, ...top }) => top), boxes: pier.rideSolids, shoreRails: true });
  let comparisons = 0, maxHeightError = 0, maxNormalError = 0;
  for (const top of pier.rideTops.filter(t => t.capabilities)) {
    const p = centre(top), y = height(top, p);
    ray.ray.origin.set(p.x, 8, p.z);
    const hit = ray.intersectObject(pier.group, true)[0];
    if (!hit || Math.abs(hit.point.y - y) > .001) continue;
    const g = pierSampler.sampleGround(p.x, p.z, probe(), y);
    const heightError = Math.abs(g.height - hit.point.y);
    const normalError = new THREE.Vector3(g.normal.x, g.normal.y, g.normal.z).distanceTo(hit.face.normal);
    maxHeightError = Math.max(maxHeightError, heightError); maxNormalError = Math.max(maxNormalError, normalError);
    assert.ok(heightError < .001 && normalError < .003, 'unchanged world-Float32 batching precision');
    assert.deepEqual(g, untagged.sampleGround(p.x, p.z, probe(), y));
    assert.deepEqual(g.base.normal, g.normal);
    assert.equal(pierSampler.transitionAt(p.x, p.z, y - 3), false);
    assert.equal(pierSampler.restartsAtRest(p.x, p.z, y + 3), false);
    comparisons++;
  }
  assert.ok(comparisons > 140);
  t.diagnostic(`${comparisons} independent drawn/support checks; maximum height error ${maxHeightError} m, normal error ${maxNormalError}`);
});

test('Pier 62 entrances, flat spine, broad platforms and exits remain open and unflagged', () => {
  const F = pier.venue, seg = (F.L - 22) / Math.max(2, Math.round((F.L - 22) / 22));
  const start = 7 + 2 * seg - 1.2, end = 7 + 5 * seg - 1.2, a = 7 + seg + 1.2;
  for (const [u, s, rest] of [[a, 0, true], [start + 2, 0, true], [end - 2, 0, true], [end, 0, true],
    [end + 2, 0, false], [start + 2, -22, false], [end - 2, 14, false]]) {
    const x = F.wx(u, s), z = F.wz(u, s), y = pierSampler.sampleGround(x, z, probe(), 1).height;
    assert.equal(pierSampler.transitionAt(x, z, y), false, `${u},${s} flat/access`);
    assert.equal(pierSampler.restartsAtRest(x, z, y), rest, `${u},${s} local recovery`);
  }
});

test('both parks use sparse cells without allocating a rectangle across the intervening city', t => {
  const s = new NycTerrainSampler({ tops: [...built.rideTops, ...pier.rideTops], boxes: [...built.rideSolids, ...pier.rideSolids] });
  assert.equal(s.capabilityGrid.size, sampler.capabilityGrid.size + pierSampler.capabilityGrid.size);
  const references = [...s.capabilityGrid.values()].reduce((n, cell) => n + cell.length, 0);
  t.diagnostic(`capability cells: Jefferson ${sampler.capabilityGrid.size}, Pier 62 ${pierSampler.capabilityGrid.size}; ${references} total references`);
  s.topAt = s.sampleGround = () => { throw new Error('intervening city performed feature terrain work'); };
  for (const [x, z] of [[0, -2000], [0, 0], [-1000, -1000], [1330, -3000]]) {
    assert.equal(s.transitionAt(x, z, 0), false);
    assert.equal(s.restartsAtRest(x, z, 0), false);
  }
});
