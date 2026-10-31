const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadModule } = require('./helpers/module.cjs');

// Optional same-engine differential checks use the actual accepted source, not a reimplementation.
// EUC_OCT29_COMPARE_BASELINE=1 ../.tools/node/bin/node --test tests/oct29-road-paint.test.cjs
const BASELINE = '853384852baa64f1e1ae1ccc3a2c5cd418e1f02a';
const root = join(__dirname, '..');
const source = file => readFileSync(join(root, file), 'utf8');
const baseline = file => execFileSync('git', ['show', `${BASELINE}:${file}`], {
  cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 5000
});
const compare = process.env.EUC_OCT29_COMPARE_BASELINE === '1';
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const current = Object.fromEntries(['road-paint', 'city-grid', 'scene-culling'].map(n => [n, source(`js/${n}.js`)]));
let THREE, TSL, config, GEO, ride, jefferson, merge, paint, culling;
const material = () => new THREE.MeshStandardNodeMaterial();
function paintModule(text) {
  return loadModule(text, { imports: { 'three/webgpu': THREE, './road-network.js': { CROSSWALK: 3 },
    './tsl-materials.js': { createRoadPaintMaterial: material } } });
}
test.before(async () => {
  const local = file => import(pathToFileURL(join(root, file)).href);
  [THREE, TSL, config, { GEO }, ride, jefferson] = await Promise.all([
    local('vendor/three/build/three.webgpu.js'), local('vendor/three/build/three.tsl.js'),
    local('js/city-config.js'), local('js/nyc-geodata.js'), local('js/ride-geometry.js'), local('js/jefferson-skatepark.js')
  ]);
  merge = loadModule(source('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), { imports: { three: THREE } });
  paint = paintModule(current['road-paint']);
  culling = loadModule(current['scene-culling'], { imports: { 'three/webgpu': THREE } });
});

// Sort complete original quads, not vertices independently: winding, connectivity, colours, sides and dash phase matter.
function paintSnapshot(group) {
  const quads = [];
  group.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry.attributes.paint) return;
    const g = mesh.geometry;
    for (let start = 0; start < g.index.count; start += 6) {
      const h = createHash('sha256');
      for (const name of ['position', 'normal', 'color', 'side', 'paint']) {
        const a = g.attributes[name];
        for (let i = 0; i < 6; i++) {
          const offset = g.index.getX(start + i) * a.itemSize;
          h.update(bytes(a.array.subarray(offset, offset + a.itemSize)));
        }
      }
      quads.push(h.digest('hex'));
    }
  });
  return { count: quads.length, hash: hash(quads.sort()) };
}
function edge(from, to, lanes = [-5.4, -1.8, 1.8, 5.4], axis = 'ave') {
  const span = Math.hypot(to.x - from.x, to.z - from.z), dx = (to.x - from.x) / span, dz = (to.z - from.z) / span;
  return { from, to, span, dx, dz, rx: -dz, rz: dx, x0: from.x, z0: from.z,
    sx: from.x + dx * 5, sz: from.z + dz * 5, len: span - 10, half: 14, lanes, axis };
}
function network() {
  const a = { id: 0, x: -2400, z: -1200 }, b = { id: 1, x: -2250, z: -1200, shape: true },
    c = { id: 2, x: -2100, z: -1150 }, d = { id: 3, x: 200, z: 500 }, e = { id: 4, x: 300, z: 800 };
  // Reversed flow at the joined shape node, plus a two-way road and a line extending across several chunks.
  return { edges: [edge(a, b), edge(c, b), edge(d, e, [1.8, 5.4]), edge(e, d, [1.8, 5.4]),
    edge({ id: 5, x: 3000, z: -6000 }, { id: 6, x: 3000, z: -100 })], isRoadClear: () => true };
}

test('street chunking preserves complete baseline quads, reversed bend phases and network data', t => {
  const n = network(), before = JSON.stringify(n), scene = new THREE.Scene();
  const group = paint.buildRoadPaint(scene, n);
  assert.equal(JSON.stringify(n), before);
  assert.ok(group.children.length >= 3);
  const actual = paintSnapshot(group);
  t.diagnostic(`street paint ${JSON.stringify(actual)}`);
  if (compare) assert.deepEqual(actual, paintSnapshot(paintModule(baseline('js/road-paint.js')).buildRoadPaint(new THREE.Scene(), network())));
  // Frozen accepted-baseline fixture; portable Float32 payload, independent of Git history in public exports.
  assert.deepEqual(actual, { count: 40, hash: '573d56124f99a8e387404e917b65298f25239bd05943c3b395f96a7f0193985f' });
});

test('one finalization shares a pipeline, preserves 3D phase length, and cannot be rebatched', () => {
  const builder = paint.createRoadPaintChunkBuilder('RoadMarkings', { cellSize: 100 });
  const col = new THREE.Color(0xe6e2d6), a = new THREE.Vector3(-1000.4, 12, -900), b = new THREE.Vector3(-1000, 15, -898);
  const length = a.distanceTo(b), phase = 1000.1;
  builder.strip3D(a.x, a.y, a.z, b.x, b.y, b.z, .13, col, 12, .25, phase, -1, length);
  builder.strip3D(100, 0, 100, 110, 0, 110, 3, col);
  const group = builder.build();
  assert.equal(builder.build(), group);
  assert.throws(() => builder.strip3D(0, 0, 0, 1, 0, 0, .1, col), /finalized/);
  assert.equal(group.children.length, 2);
  const [first, second] = group.children;
  assert.equal(second.userData.sharesPipelineWith, first);
  assert.equal(first.material, second.material);
  assert.equal(first.geometry.attributes.paint.getX(2), Math.fround(phase - length));
  assert.equal(first.geometry.attributes.position.getY(0), 12);
  assert.equal(first.geometry.attributes.position.getY(2), 15);
  for (const mesh of group.children) {
    assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, true); assert.equal(mesh.renderOrder, -1);
    // Batcher must respect explicit opt-out, even if a future shader adds UVs.
    mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(8), 2));
  }
  const batchText = current['city-grid'].match(/^function batchStaticGroupMeshes\([^]*?^\}/m)[0];
  loadModule(`${batchText}\nexport { batchStaticGroupMeshes };`, { globals: { THREE, ...merge } }).batchStaticGroupMeshes(group);
  assert.deepEqual(group.children, [first, second]);
});

test('bounds cover every shader-widened corner; frustum culling adds no distance cutoff', () => {
  const builder = paint.createRoadPaintChunkBuilder();
  const col = new THREE.Color(0xffffff);
  for (const [x, z] of [[-1200, -2400], [0, 0], [12000, 4000]]) {
    builder.strip3D(x, 0, z, x + 20, 4, z + 20, 3, col);
    builder.strip3D(x, 0, z, x + 3000, 0, z, .13, col, 12, .25);
  }
  const group = builder.build(), scene = new THREE.Scene(); scene.add(group);
  for (const mesh of group.children) {
    const g = mesh.geometry, p = g.attributes.position, s = g.attributes.side;
    for (let i = 0; i < p.count; i++) for (const widen of [1, 2, 8, 16]) {
      const point = new THREE.Vector3(p.getX(i) + s.getX(i) * (widen - 1), p.getY(i), p.getZ(i) + s.getY(i) * (widen - 1));
      assert.ok(g.boundingBox.containsPoint(point)); assert.ok(g.boundingSphere.containsPoint(point));
    }
    assert.equal(mesh.userData.cullDistance, undefined);
  }
  culling.setupSceneCulling(scene, [group]);
  culling.updateSceneCulling(new THREE.Vector3(100000, 100000, 100000));
  assert.ok(group.children.every(m => m.visible));
  const camera = new THREE.PerspectiveCamera(50, 1, .1, 30000);
  camera.position.set(0, 30, 5000); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  assert.ok(group.children.some(m => frustum.intersectsObject(m)), 'markings remain visible at >1.65 km');
  assert.ok(group.children.some(m => !frustum.intersectsObject(m)), 'off-screen chunks can be rejected');
});

function cityModule(text, paintAPI) {
  const factories = Object.fromEntries([...text.matchAll(/\b(create\w+Material)\b/g)].map(m => [m[1], material]));
  factories.cityUniforms = { uInteriorGlow: TSL.float(1) };
  const ctx = { measureText: t => ({ width: t.length * 50 }), strokeText() {}, fillText() {} };
  // The VM helper snapshots exported bindings; read construction's live arrays explicitly afterwards.
  text += '\nexport function snapshotSites() { return { centralParkClearings, parkTreeSites, parkLampSites, pavedPlazaRects, sidewalkBlocks }; }';
  return loadModule(text, { imports: { 'three/webgpu': THREE, 'three/tsl': TSL,
    'three/addons/utils/BufferGeometryUtils.js': merge, './city-config.js': config, './nyc-geodata.js': { GEO },
    './ride-geometry.js': ride, './jefferson-skatepark.js': jefferson, './road-paint.js': paintAPI,
    './tsl-materials.js': factories }, globals: { document: { createElement: () => ({ getContext: () => ctx }) } } });
}
function withCurrentStoneBridges(text) {
  // The independently raycast/controller-tested exception lives in stone-arch-bridges.test.mjs.
  // Apply that exact production function to BOTH road-paint versions; never omit ride/geometry from the comparison.
  const declaration = /^function addStoneArchBridge\([^]*?^\}/gm;
  const oldFunctions = text.match(declaration) || [], newFunctions = current['city-grid'].match(declaration) || [];
  assert.equal(oldFunctions.length, 1, 'one baseline stone-bridge function');
  assert.equal(newFunctions.length, 1, 'one current stone-bridge function');
  assert.equal(oldFunctions[0].split('\n')[0],
    'function addStoneArchBridge(parent, cx, cz, rotY, span, width, archRise, wallMat, deckMat) {');
  assert.equal(newFunctions[0].split('\n')[0], oldFunctions[0].split('\n')[0].replace('deckMat)', 'deckMat, rideBuilder)'));

  const invocation = /^  if \((gapstow|bow)\) addStoneArchBridge\([^\n]+\);$/gm;
  const oldCalls = [...text.matchAll(invocation)], newCalls = [...current['city-grid'].matchAll(invocation)];
  assert.deepEqual(oldCalls.map(m => m[1]), ['gapstow', 'bow'], 'exactly the two accepted baseline call sites');
  assert.deepEqual(newCalls.map(m => m[1]), ['gapstow', 'bow'], 'exactly the two accepted current call sites');
  for (let i = 0; i < oldCalls.length; i++) {
    assert.equal(newCalls[i][0], oldCalls[i][0].replace(/\);$/, ', { addRideMesh, addRideSolid });'),
      `${oldCalls[i][1]}: preserve every existing location, heading, dimension and material argument`);
  }
  const calls = new Map(newCalls.map(m => [m[1], m[0]]));
  // Replace only the one function and the two checked calls, leaving all old road-paint/world code intact.
  return text.replace(declaration, () => newFunctions[0]).replace(invocation, (_line, name) => calls.get(name));
}
function worldSnapshot(text, paintAPI) {
  const module = cityModule(text, paintAPI), scene = new THREE.Scene(), city = module.buildCityGrid(scene);
  const result = {};
  for (const key of ['sidewalks', 'footprints', 'highwayLanes', 'colliders', 'trafficColliders', 'ride']) result[key] = hash(city[key]);
  for (const [key, value] of Object.entries(module.snapshotSites())) result[key] = hash(value);
  const geometry = [];
  city.group.traverse(mesh => {
    if (!mesh.isMesh || mesh.geometry.attributes.paint) return;
    const h = createHash('sha256'), g = mesh.geometry;
    for (const name of Object.keys(g.attributes).sort()) h.update(name).update(bytes(g.attributes[name].array));
    if (g.index) h.update(bytes(g.index.array));
    if (mesh.isInstancedMesh) h.update(bytes(mesh.instanceMatrix.array));
    if (mesh.instanceColor) h.update(bytes(mesh.instanceColor.array));
    mesh.updateMatrix(); h.update(JSON.stringify([mesh.matrix.elements, mesh.count, mesh.castShadow, mesh.receiveShadow, mesh.renderOrder]));
    geometry.push(h.digest('hex'));
  });
  result.nonPaintGeometry = hash(geometry);
  result.meshCount = geometry.length;
  if (city.roadPaint) scene.add(city.roadPaint.build());
  result.paint = paintSnapshot(scene);
  const geometries = new Set(), materials = new Set();
  scene.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
  for (const g of geometries) g.dispose(); for (const m of materials) m.dispose();
  return result;
}
// Preserve the original Node 24 fixture: the bridge exception must not refresh unrelated contracts.
const BASELINE_CITY = {
  sidewalks: '9e65a9ffc5863c539e4217daac53538d9a107fef36bbf1189909709d40fbeea2',
  footprints: '26706a5688600dceb8336adf2e4c3e8f171e427190d4b10e5d490018a904464e',
  highwayLanes: '1d640f3a8135e11d7f09aead9d37982e091a6a86d0a4045794c1ee8cdce587bb',
  colliders: '16a8fe6b82d3a6c5a6dc72aaf4721775ef87309d58d59894b382be937dbae4d4',
  trafficColliders: '1721e79c44846c6b466e6ef8257a1e3b6f6968e9b574a68a89c15cfb60cef960',
  ride: '5e280ddc2c371880da1a77f538d30bfd66625c14ba2c6e3a5f283d29f265c965',
  centralParkClearings: '2303346782bac2f134ddb484b8907529d1fcb7e43692c4754cd0e8bbc4037e84',
  parkTreeSites: '64f8b93981e7ea1a69963c513f4a1899884f222e635851f05b90f14166dac261',
  parkLampSites: '6bf6f202baa15c383239f6cd667f74469a8f27e4da87f2ecdc4079a8f0489ed7',
  pavedPlazaRects: 'e59d1bfde1832e9f30472b68be8a2c7d742ff5c0448e037895fb3cd752dd39ed',
  sidewalkBlocks: 'c6f2003ffd7cabf9559a1720dffb2f55a2e8379b1d7b0277f03d52564906572e',
  nonPaintGeometry: '36635d8c241b8393539e3b9816720fd67a39b99003a6133eda265bb79f79832b',
  meshCount: 149,
  paint: { count: 81158, hash: '8b41f8ab1abf16381b8abe5b8da4b4f43865e040dc9fc56bd85c4a9eda404278' }
};
test('actual city: road paint preserves all world contracts with the same accepted stone bridges', { timeout: 120000 }, t => {
  // Execute real city construction with real Three geometry; only canvas lettering and shared material factories are stubbed.
  const node24 = Number(process.versions.node.split('.')[0]) === 24;
  const after = worldSnapshot(current['city-grid'], paint);
  t.diagnostic(`city contracts ${JSON.stringify(after)}`);
  if (compare) {
    const oldCity = baseline('js/city-grid.js'), oldPaint = paintModule(baseline('js/road-paint.js'));
    const original = worldSnapshot(oldCity, oldPaint);
    t.diagnostic(`original baseline city contracts ${JSON.stringify(original)}`);
    if (node24) assert.deepEqual(original, BASELINE_CITY, 'the original accepted fixture remains authoritative');
    const before = worldSnapshot(withCurrentStoneBridges(oldCity), oldPaint);
    t.diagnostic(`baseline with current stone bridges ${JSON.stringify(before)}`);
    assert.deepEqual(Object.keys(original).filter(key => hash(original[key]) !== hash(before[key])).sort(),
      ['nonPaintGeometry', 'ride'], 'the bridge transplant changes only drawing/support/body geometry; mesh count, navigation, sites and paint stay exact');
    assert.deepEqual(after, before,
      'identical bridges on both sides: preserve all ride data and non-paint geometry, including Pier 62, Jefferson, gates, viaduct, waterfront and navigation reservations');
  }
  // Node 24 evidence: only the approved joined bridge walks, approaches and native registrations change these two hashes.
  // All other frozen fields (including the 149 batched meshes and every complete paint quad) retain BASELINE_CITY exactly.
  if (node24) assert.deepEqual(after, {
    ...BASELINE_CITY,
    ride: '35468fe1b1bb00a9d9fe4616b7ca633dade7e4c8a2c377c9d45d7d1ccdcc886d',
    nonPaintGeometry: 'be86e461edd96d205c7b36ab7aad7356dc05fd4c8b6d6eb438cd7339603b5972'
  });
  assert.equal(after.paint.count, 81158);
});
