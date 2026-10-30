const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadModule } = require('./helpers/module.cjs');

const BASELINE = '853384852baa64f1e1ae1ccc3a2c5cd418e1f02a';
const root = join(__dirname, '..');
const source = file => readFileSync(join(root, file), 'utf8');
const compare = process.env.EUC_OCT29_COMPARE_BASELINE === '1';
const baseline = file => execFileSync('git', ['show', `${BASELINE}:${file}`], {
  cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 5000
});
const current = source('js/fire-escapes.js');
const original = compare ? baseline('js/fire-escapes.js') : null;
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
let THREE, TSL;
test.before(async () => {
  [THREE, TSL] = await Promise.all(['three.webgpu', 'three.tsl'].map(n => import(pathToFileURL(join(root, `vendor/three/build/${n}.js`)).href)));
});
function system(text = current) {
  const group = new THREE.Group();
  const api = loadModule(text, { imports: { 'three/webgpu': THREE, 'three/tsl': TSL } }).createFireEscapes(group);
  return { group, api };
}
function signature(mesh, active = false) {
  const h = createHash('sha256'), g = mesh.geometry;
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.attributes[name];
    const array = a.isInstancedBufferAttribute ? a.array.subarray(0, (active ? mesh.count : 0) * a.itemSize) : a.array;
    h.update(name).update(bytes(array));
  }
  h.update(bytes(g.index.array));
  if (active) h.update(bytes(mesh.instanceMatrix.array.subarray(0, mesh.count * 16)));
  h.update(JSON.stringify([mesh.name, mesh.count, mesh.instanceMatrix.count, mesh.castShadow, mesh.receiveShadow,
    mesh.material.side, mesh.material.color.toArray(), mesh.material.roughness, mesh.material.metalness]));
  return h.digest('hex');
}
const escape = (x, z, landings = 5, storey = 3.5, facing = 0, y = storey) => ({
  x, z, y, landings, storey, facing, ry: .31, h: (landings - 1) * storey + 1
});
function stream(s, entries, focusX = 0, focusZ = 0) {
  s.api.begin(); for (const fe of entries) s.api.add(fe, focusX, focusZ); s.api.end();
}
function assertBounds(group) {
  const p = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const mesh of group.children) {
    assert.equal(mesh.frustumCulled, true); assert.equal(mesh.visible, true);
    assert.equal(mesh.castShadow, true); assert.equal(mesh.receiveShadow, true);
    if (!mesh.count) { assert.ok(mesh.boundingSphere.isEmpty()); continue; }
    const a = mesh.geometry.attributes.position;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      for (let v = 0; v < a.count; v++) {
        p.fromBufferAttribute(a, v).applyMatrix4(m);
        assert.ok(mesh.boundingSphere.distanceToPoint(p) <= 1e-9, `${mesh.name} instance ${i}, vertex ${v}`);
      }
    }
  }
}

test('geometry keeps every tread, mirror winding, raised ladder, far proxy and original pool capacities', t => {
  const s = system(), meshes = s.group.children;
  assert.deepEqual(meshes.map(m => m.instanceMatrix.count), [256, 256, 2400]);
  assert.deepEqual(meshes.map(m => m.count), [0, 0, 0]);
  const digests = meshes.map(m => signature(m)); t.diagnostic(`geometry contracts ${JSON.stringify(digests)}`);
  if (compare) assert.deepEqual(digests, system(original).group.children.map(m => signature(m)));
  assert.deepEqual(digests, [
    '722bde9666ffdaff602001daaa46ccebd0f43007d96792eafe487869fbdf3824',
    'aafa249fd0a36b8f564ba995a9f8f730663dbc6a2e5f3277e9048fa424c4f298',
    'aff032f43454ed628ccf32ac60a5330a05b34fadaabc1666cb81ca07642a4aa8'
  ]);
  for (const mesh of meshes.slice(0, 2)) {
    const g = mesh.geometry, p = g.attributes.position, part = g.attributes.escapePart;
    let treads = 0, lowest = Infinity;
    for (let i = 0; i < p.count; i += 4) {
      if (part.getX(i) === 2 && [1, 2, 3].every(j => p.getY(i + j) === p.getY(i))) treads++;
      if (part.getX(i) === 4) lowest = Math.min(lowest, p.getY(i), p.getY(i + 1), p.getY(i + 2), p.getY(i + 3));
    }
    assert.equal(treads, 16); assert.equal(lowest, Math.fround(-1.1));
    assert.equal(g.index.count / 3, 54);
  }
});

test('stream admission, exact active matrices/flags and shadows match baseline across limits and teleports', t => {
  const s = system(), b = compare ? system(original) : null, digests = [];
  const fixtures = [
    { entries: [] },
    { entries: [escape(0, 0, 7, 2.6), escape(89.9999, 0), escape(90, 0), escape(-90.0001, 0), escape(-30, 55, 3, 4.2, 1.9, -2)] },
    { entries: Array.from({ length: 150 }, (_, i) => escape(i % 30, i % 60, 7, 2.8 + (i % 4) * .4, i * .3)) },
    { entries: Array.from({ length: 2500 }, (_, i) => escape(200 + i % 60, -550 + i % 37, 1 + i % 7, 3.5, i * .07)) },
    { x: 10000, z: -6000, entries: [escape(10000, -6000, 4, 3.8, 2.8, 100), escape(10500, -5500, 7, 4, 1.2, 200)] },
    { entries: [] },
    { entries: [escape(1, 2, 1)] }
  ];
  for (const f of fixtures) {
    stream(s, f.entries, f.x, f.z);
    const state = s.group.children.map(m => signature(m, true)); digests.push(state);
    if (b) { stream(b, f.entries, f.x, f.z); assert.deepEqual(state, b.group.children.map(m => signature(m, true))); }
    assertBounds(s.group);
    const count = s.group.children.reduce((n, m) => n + m.count, 0);
    if (f.entries.length === 2500) assert.equal(count, 2400);
    if (f.entries.length === 150) {
      assert.equal(s.group.children[0].count + s.group.children[1].count, 252);
      assert.equal(s.group.children[2].count, 114, 'near capacity overflow uses far representation, without dropping escapes');
    }
  }
  t.diagnostic(`stream contract ${hash(JSON.stringify(digests))}`);
  assert.equal(hash(JSON.stringify(digests)), '9fb81fe567fe2e656cb51aa8fdc4e6c85a459849825a9ee619fd114a1593cdb4');
});

test('pool bounds permit independent view/shadow frusta and remain dynamic through scene setup', () => {
  const s = system();
  stream(s, [escape(0, 0), escape(300, 0)]);
  const scene = new THREE.Scene(); scene.add(s.group); scene.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 1000);
  camera.position.set(0, 10, 30); camera.lookAt(0, 10, 0); camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  assert.ok(frustum.intersectsObject(s.group.children[0]));
  assert.equal(frustum.intersectsObject(s.group.children[2]), false);
  const shadowCamera = new THREE.OrthographicCamera(-400, 400, 400, -400, .1, 1000);
  shadowCamera.position.set(0, 300, 50); shadowCamera.lookAt(0, 0, 0); shadowCamera.updateMatrixWorld();
  const shadowFrustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse));
  assert.ok(shadowFrustum.intersectsObject(s.group.children[2]), 'off-camera far escape still casts into the shadow camera');
  const originals = s.group.children.slice();
  const culling = loadModule(source('js/scene-culling.js'), { imports: { 'three/webgpu': THREE } });
  culling.setupSceneCulling(scene, [s.group], { getCamera: () => shadowCamera, getViewportCount: () => 1 });
  culling.updateSceneCulling(new THREE.Vector3(100000, 0, 0));
  assert.deepEqual(s.group.children, originals);
  assert.ok(s.group.children.every(m => m.visible && m.castShadow && m.userData.dynamicInstances));
  stream(s, [escape(-5000, 5000)], -5000, 5000);
  assertBounds(s.group);
  assert.ok(s.group.children[0].boundingSphere.center.x < -4900, 'bounds follow teleports rather than stale source matrices');
});

const maskBody = text => text.match(/nearMaterial\.maskNode = Fn\(\(\) => \{([^]*?)\n  \}\)\(\);/)[1];
test('precompile and derivative contracts stay compatible; distant proxy shader remains exact', () => {
  const body = maskBody(current), branch = body.indexOf('If(');
  assert.ok(branch > 0);
  assert.doesNotMatch(body.slice(branch), /fwidth\(|\.dFd[xy]\(/, 'no derivatives inside non-uniform branches');
  assert.equal((body.slice(0, branch).match(/fwidth\([^)]*\)\.toVar\(\)/g) || []).length, 5);
  assert.match(body, /setInterpolation\('flat'\)/);
  const s = system(); stream(s, []);
  // Main's precompile traversal and first-frame warmup must see all original material/attribute combinations.
  assert.ok(s.group.children.every(m => m.visible && !m.userData.sharesPipelineWith && m.frustumCulled));
  const far = text => text.slice(text.indexOf('  const farGeometry'), text.indexOf("  far.name = 'FireEscapesFar';"));
  if (compare) assert.equal(far(current), far(original));
  assert.equal(hash(far(current)), '475163253077de3f992d198ecff6fc5a02c5ac200e94d5bffea870f01a990748');
});

// Evaluate the production TSL mask bodies over synthetic fragments. This checks branch equivalence, not GPU pixels.
// Widths track the linear coordinates used by fwidth; all later nonlinear nodes only contribute their values.
function evaluator(sample) {
  const node = v => v instanceof N ? v : new N(Array.isArray(v) ? v : [v]);
  class N {
    constructor(v, d = v.map(() => 0)) { this.v = v; this.d = d; }
    op(b, fn, deriv = () => 0) {
      b = node(b); const n = Math.max(this.v.length, b.v.length);
      return new N(Array.from({ length: n }, (_, i) => fn(this.v[i % this.v.length], b.v[i % b.v.length])),
        Array.from({ length: n }, (_, i) => deriv(this.d[i % this.d.length], b.d[i % b.d.length], this.v[i % this.v.length], b.v[i % b.v.length])));
    }
    add(b) { return this.op(b, (a, b) => a + b, (a, b) => a + b); }
    sub(b) { return this.op(b, (a, b) => a - b, (a, b) => a + b); }
    mul(b) { return this.op(b, (a, b) => a * b, (da, db, a, b) => da * Math.abs(b) + db * Math.abs(a)); }
    greaterThan(b) { return this.op(b, (a, b) => a > b); }
    lessThan(b) { return this.op(b, (a, b) => a < b); }
    toVar() { return new N(this.v.slice(), this.d.slice()); }
    assign(b) { b = node(b); this.v = b.v; this.d = b.d; return this; }
    setInterpolation() { return this; }
    get x() { return new N([this.v[0]], [this.d[0]]); }
    get y() { return new N([this.v[1]], [this.d[1]]); }
    get xz() { return new N([this.v[0], this.v[2]], [this.d[0], this.d[2]]); }
  }
  let depth = 0;
  const unary = fn => a => new N(node(a).v.map(fn));
  const run = fn => { depth++; try { fn(); } finally { depth--; } };
  return { float: node, attribute: name => node(name === 'escapePart' ? sample.part : sample.flags),
    varying: a => a, positionGeometry: new N(sample.p, sample.pw), uv: () => new N(sample.uv, sample.uw),
    abs: unary(Math.abs), fract: unary(a => a - Math.floor(a)),
    mod: (a, b) => node(a).op(b, (a, b) => a % b),
    step: (a, b) => node(a).op(b, (a, b) => b < a ? 0 : 1),
    max: (...args) => args.map(node).reduce((a, b) => a.op(b, Math.max)),
    min: (...args) => args.map(node).reduce((a, b) => a.op(b, Math.min)),
    mix: (a, b, t) => node(a).mul(node(1).sub(t)).add(node(b).mul(t)),
    fwidth: a => { assert.equal(depth, 0, 'derivative must execute uniformly'); return node(node(a).d); },
    If: (condition, fn) => {
      let matched = !!node(condition).v[0]; if (matched) run(fn);
      const chain = { ElseIf(c, f) { if (!matched && node(c).v[0]) { matched = true; run(f); } return chain; },
        Else(f) { if (!matched) run(f); return chain; } };
      return chain;
    }
  };
}
test('per-part branching exactly matches baseline masks over resolved and unresolved fragments', { skip: !compare }, () => {
  // Evaluate via lexical parameters to retain production arithmetic and execute only the selected branch.
  const sample0 = { part: 0, flags: [1, 1], p: [0, 0, 0], pw: [0, 0, 0], uv: [0, 0], uw: [0, 0] };
  const names = Object.keys(evaluator(sample0));
  const before = new Function(...names, maskBody(original)), after = new Function(...names, maskBody(current));
  let seed = 42; const rnd = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  for (let i = 0; i < 10000; i++) {
    const s = { part: i % 5, flags: [i % 2, (i >> 1) % 2], p: [rnd() * 3.4 - 1.7, rnd() * 5, rnd() * 1.1 - .55],
      pw: [10 ** (rnd() * 4 - 4), .1, 10 ** (rnd() * 4 - 4)], uv: [rnd() * 20, rnd()],
      uw: [10 ** (rnd() * 4 - 4), 10 ** (rnd() * 4 - 4)] };
    assert.equal(after(...Object.values(evaluator(s))).v[0], before(...Object.values(evaluator(s))).v[0], `fragment ${i}, part ${s.part}`);
  }
});
