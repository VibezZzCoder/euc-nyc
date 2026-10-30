const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const vm = require('node:vm');
const { loadModule } = require('./helpers/module.cjs');

// Selective source: mrdoob/slop-newyork@1fe128d71b395f110520855de7e883b86ab3290a (MIT).
// Run the actual old implementation, not a duplicate of the new maths:
// EUC_PEDESTRIAN_BASELINE=1 ../.tools/node/bin/node --test tests/oct29-pedestrians.test.cjs
// Default/export runs use contracts captured from that old source; no private Git history required.
const BASELINE = '853384852baa64f1e1ae1ccc3a2c5cd418e1f02a';
const root = join(__dirname, '..');
const source = readFileSync(join(root, 'js/pedestrians.js'), 'utf8');
const baseline = process.env.EUC_PEDESTRIAN_BASELINE === '1' ? execFileSync('git', ['show', `${BASELINE}:js/pedestrians.js`], {
  cwd: root, encoding: 'utf8', timeout: 5000
}) : null;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const bytes = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const STRIDE = 31, FLOATS = STRIDE * 4;
const CONTRACTS = {
  geometry: '095c451448084f1e6a31b704e8f8867486716c019cf0100faec56a826e2ca21c',
  material: '106c2e2215c9ce30d0d15d31594ec1e6fa38fd22d90eaa8222db897d97179947',
  gait: 'b18cb66c69dc941b8e6899f088040b37b0a6999cb454cc17be70b6f3352dc03d'
};

// Numeric TSL interpreter, adapted from the approved upstream test's idea. Real vendored Three handles all
// geometry, normals, quaternions and IK. Shader arithmetic rounds to Float32 at node boundaries; this is a
// formula/interpolation test, not GPU compilation or proof of driver sin()/FMA/pixel parity.
function numericTSL() {
  const f = Math.fround;
  const state = { attrs: {}, instance: 0, stage: 'fragment', snapshots: new Map(), fragmentSin: 0, branches: 0, vertexReads: 0 };
  const arr = (v) => v instanceof N ? v.eval() : Array.isArray(v) ? v.map(f) : [f(v)];
  const binary = (a, b, op) => new N(() => {
    const x = arr(a), y = arr(b);
    return Array.from({ length: Math.max(x.length, y.length) }, (_, i) => op(x[i % x.length], y[i % y.length]));
  });
  class N {
    constructor(value) { this.value = typeof value === 'function' ? value : () => value; }
    eval() { return this.value().map(f); }
    get x() { return new N(() => [this.eval()[0]]); }
    get y() { return new N(() => [this.eval()[1]]); }
    get z() { return new N(() => [this.eval()[2]]); }
    get w() { return new N(() => [this.eval()[3]]); }
    get xyz() { return new N(() => this.eval().slice(0, 3)); }
    add(b) { return binary(this, b, (a, b) => a + b); }
    sub(b) { return binary(this, b, (a, b) => a - b); }
    mul(b) { return binary(this, b, (a, b) => a * b); }
    lessThan(b) { return binary(this, b, (a, b) => +(a < b)); }
    greaterThan(b) { return binary(this, b, (a, b) => +(a > b)); }
    toVar() {
      let slot = this.eval();
      const variable = new N(() => slot);
      variable.assign = (rhs) => { slot = arr(rhs); };
      return variable;
    }
    assign(rhs) { this.assigned = arr(rhs); }
    setInterpolation(mode) { this.interpolation = mode; return this; }
  }
  const vertex = (fn) => {
    const previous = state.stage;
    state.stage = 'vertex';
    try { return fn(); } finally { state.stage = previous; }
  };
  const varying = (node) => {
    const out = new N(() => {
      if (!state.snapshots.has(out)) state.snapshots.set(out, vertex(() => arr(node)));
      return state.snapshots.get(out);
    });
    return out;
  };
  const vector = (size) => (...args) => new N(() => {
    const v = args.flatMap(arr);
    return v.length === 1 ? Array(size).fill(v[0]) : v.slice(0, size);
  });
  const unary = (fn) => (a) => new N(() => arr(a).map(fn));
  const tsl = {
    Fn: (body) => () => new N(() => arr(body())),
    If: (condition, body) => {
      state.branches++;
      let matched = arr(condition)[0] !== 0;
      if (matched) body();
      return { ElseIf(condition, body) {
        if (!matched && arr(condition)[0] !== 0) { matched = true; body(); }
        return this;
      } };
    },
    float: (a) => a instanceof N ? a : new N([f(a)]),
    int: unary(Math.trunc), vec2: vector(2), vec3: vector(3), vec4: vector(4),
    color: (hex) => new N([16, 8, 0].map((shift) => {
      const v = ((hex >> shift) & 255) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    })),
    attribute: (name) => new N(() => state.attrs[name]),
    instanceIndex: new N(() => [state.instance]),
    attributeArray: (count) => {
      const value = { array: new Float32Array(count * 4), uploads: 0, ranges: [],
        clearUpdateRanges() { this.ranges = []; },
        addUpdateRange(start, count) { this.ranges.push({ start, count }); },
        set needsUpdate(v) { if (v) this.uploads++; }
      };
      return { value, isPBO: false, access: 'readWrite',
        setPBO(enabled) { this.isPBO = enabled; return this; },
        toReadOnly() { this.access = 'readOnly'; return this; }, element(index) {
        return new N(() => Array.from(value.array.slice(arr(index)[0] * 4, arr(index)[0] * 4 + 4)));
      } };
    },
    normalLocal: new N([0, 0, 1]), varying,
    // Real vertexStage is an unnamed varying. Keep it in the same interpolation model as named varyings.
    vertexStage: (node) => varying(new N(() => { state.vertexReads++; return arr(node); })),
    cross: (a, b) => new N(() => {
      const u = arr(a), v = arr(b);
      return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    }),
    normalize: (a) => new N(() => { const v = arr(a), l = Math.hypot(...v) || 1; return v.map(x => x / l); }),
    sin: (a) => new N(() => {
      if (state.stage === 'fragment') state.fragmentSin++;
      return arr(a).map(Math.sin);
    }),
    abs: unary(Math.abs), fract: unary(x => x - Math.floor(x)), max: (a, b) => binary(a, b, Math.max),
    clamp: (a, lo, hi) => binary(binary(a, lo, Math.max), hi, Math.min),
    step: (edge, value) => binary(edge, value, (e, v) => +(v >= e)),
    mix: (a, b, t) => new N(() => {
      const x = arr(a), y = arr(b), k = arr(t);
      return Array.from({ length: Math.max(x.length, y.length, k.length) }, (_, i) =>
        f(x[i % x.length] * f(1 - k[i % k.length])) + f(y[i % y.length] * k[i % k.length]));
    }),
    smoothstep: (a, b, x) => new N(() => {
      const lo = arr(a), hi = arr(b), v = arr(x);
      return v.map((x, i) => {
        const t = Math.max(0, Math.min(1, f(f(x - lo[i % lo.length]) / f(hi[i % hi.length] - lo[i % lo.length]))));
        return f(t * t) * f(3 - f(2 * t));
      });
    })
  };
  return { tsl, state };
}

let THREE, mergeGeometries, current, old;
function load(source, { math = Math, numeric = numericTSL() } = {}) {
  const module = loadModule(source, { filename: 'pedestrians.js', globals: { Math: math }, imports: {
    'three/webgpu': { ...THREE, MeshStandardNodeMaterial: class { constructor(options) { Object.assign(this, options); } } },
    'three/tsl': numeric.tsl, 'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries }
  } });
  return { ...module, ...numeric };
}
test.before(async () => {
  THREE = await import(pathToFileURL(join(root, 'vendor/three/build/three.core.js')));
  ({ mergeGeometries } = loadModule(readFileSync(join(root, 'vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), 'utf8'), {
    imports: { three: THREE }
  }));
  current = load(source);
  old = baseline && load(baseline);
});

function frozen(t, key, actual, reference) {
  if (reference !== undefined) assert.equal(actual, reference, `${key}: actual baseline execution`);
  t.diagnostic(`${key} baseline contract: ${reference ?? actual}`);
  assert.equal(actual, CONTRACTS[key], `${key}: frozen ${BASELINE}`);
}

test('both LOD geometries, morphs, indices, normals, bounds and per-triangle part identities are retained', (t) => {
  const shape = [];
  for (const detail of [1, 0]) {
    const geo = current.buildPersonGeometry(detail);
    assert.equal(current.buildPersonGeometry(detail), geo, 'geometry cache remains shared');
    const before = old?.buildPersonGeometry(detail);
    const parts = new Set();
    for (let i = 0; i < geo.index.count; i += 3) {
      const ids = [0, 1, 2].map(k => geo.attributes.skin.getW(geo.index.getX(i + k)));
      assert.equal(ids[0], ids[1]); assert.equal(ids[1], ids[2]);
      parts.add(ids[0]);
    }
    assert.deepEqual([...parts].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
    if (before) {
      for (const key of Object.keys(geo.attributes)) assert.deepEqual(bytes(geo.attributes[key].array), bytes(before.attributes[key].array), `LOD ${detail} ${key}`);
      assert.deepEqual(bytes(geo.index.array), bytes(before.index.array));
      assert.deepEqual(geo.boundingSphere, before.boundingSphere);
    }
    shape.push({ detail, index: geo.index.count, attributes: Object.fromEntries(Object.entries(geo.attributes).map(([k, v]) => [k, [v.count, v.itemSize]])) });
  }
  // Source contract avoids engine-sensitive near-zero trig hashes; actual byte parity is checked above.
  const geometrySource = (s) => s.slice(s.indexOf('const BONE ='), s.indexOf('// 3. TSL MATERIAL:'));
  frozen(t, 'geometry', digest(JSON.stringify(shape) + geometrySource(source)), old ? digest(JSON.stringify(shape) + geometrySource(baseline)) : undefined);
});

function crowdFrame(crowd, people = []) { crowd.begin(); for (const [rig, d] of people) crowd.add(rig, d); crowd.end(); }
test('empty crowds warm up both shadow pipelines, stop all draws/uploads, and revive without stale poses', () => {
  for (const castShadow of [true, false]) for (const textureFallback of [false, true]) {
    const crowd = new current.PersonCrowd(2, { castShadow });
    const rig = new current.PersonRig({ seed: 0.7 });
    rig.reset(12, -8, 0.4, () => 0.22);
    assert.equal(crowd.farDistance, 34);
    for (const l of crowd.lods) {
      assert.equal(l.pose.isPBO, true);
      assert.equal(l.pose.access, 'readOnly');
      assert.equal(l.pose.value.pbo, undefined, 'setPBO itself must not allocate a texture');
      if (textureFallback) l.pose.value.pbo = {
        image: { data: l.pose.value.array }, uploads: 0,
        set needsUpdate(v) { if (v) this.uploads++; }
      };
      assert.equal(l.mesh.count, 1); assert.equal(l.mesh.visible, true);
      assert.equal(l.mesh.castShadow, castShadow); assert.equal(l.mesh.receiveShadow, true);
      assert.equal(l.mesh.frustumCulled, false); assert.equal(l.mesh.matrixAutoUpdate, true);
    }
    crowdFrame(crowd, [[rig, 0], [rig, 40]]);
    for (const l of crowd.lods) {
      assert.equal(l.pose.value.uploads, 1);
      if (textureFallback) assert.equal(l.pose.value.pbo.uploads, 1, 'nonempty pose dirties backing texture');
    }
    crowdFrame(crowd); // populated -> empty during warm-up must zero the old actor, not draw a ghost
    for (const l of crowd.lods) {
      assert.equal(l.mesh.count, 1); assert.equal(l.mesh.visible, true);
      assert.ok(l.pose.value.array.slice(0, FLOATS).every(v => v === 0));
      assert.deepEqual(l.pose.value.ranges, [{ start: 0, count: FLOATS }]);
      assert.equal(l.pose.value.uploads, 2);
      if (textureFallback) {
        assert.equal(l.pose.value.pbo.uploads, 2, 'warm-up zero-fill dirties backing texture too');
        assert.equal(l.pose.value.pbo.image.data, l.pose.value.array);
      }
    }
    const uploads = crowd.lods.map(l => l.pose.value.uploads);
    for (let i = 0; i < 8; i++) crowdFrame(crowd);
    crowd.lods.forEach((l, i) => {
      assert.equal(l.mesh.count, 0); assert.equal(l.mesh.visible, false);
      assert.equal(l.pose.value.uploads, uploads[i]);
      if (textureFallback) assert.equal(l.pose.value.pbo.uploads, uploads[i], 'empty LOD never dirties its texture');
    });
    rig.reset(41, 22, -1.4, () => 0);
    crowdFrame(crowd, [[rig, 34], [rig, 34], [rig, 34], [rig, 34 + 1e-9]]);
    assert.deepEqual(Array.from(crowd.meshes, m => m.count), [2, 1], 'exact LOD boundary and capacity');
    for (const l of crowd.lods) {
      assert.equal(l.mesh.visible, true); assert.equal(l.mesh.castShadow, castShadow);
      assert.deepEqual(Array.from(l.pose.value.array.slice(0, FLOATS)), Array.from(rig.pose));
      assert.deepEqual(l.pose.value.ranges, [{ start: 0, count: l.count * FLOATS }]);
      assert.equal(l.pose.value.uploads, 3);
      if (textureFallback) assert.equal(l.pose.value.pbo.uploads, 3, 'revival must upload the new pose');
    }
    const nearOnly = new current.PersonCrowd(1, { farDistance: Infinity, castShadow });
    assert.equal(nearOnly.lods.length, 2, 'retain the public meshes/LODs contract even for Infinity');
    for (let i = 0; i < 3; i++) crowdFrame(nearOnly, [[rig, 1000000]]);
    assert.equal(nearOnly.meshes[0].visible, true);
    assert.equal(nearOnly.meshes[1].visible, false);
  }
});

function attributes(geo, vertex) {
  return Object.fromEntries(Object.entries(geo.attributes).map(([key, a]) => [key, Array.from(a.array.slice(vertex * a.itemSize, (vertex + 1) * a.itemSize))]));
}
function interpolate(values, weights) {
  return values[0].map((_, i) => Math.fround(values.reduce((sum, v, k) => sum + weights[k] * v[i], 0)));
}
function surface(module, mat, attrs, snapshots = new Map()) {
  Object.assign(module.state, { attrs, snapshots, stage: 'fragment', fragmentSin: 0, branches: 0, vertexReads: 0 });
  const result = [...mat.colorNode.eval(), ...mat.roughnessNode.eval()];
  assert.ok(result.every(Number.isFinite), 'finite material surface');
  return result;
}
function rasterSurface(module, mat, vertices, weights) {
  const maps = vertices.map(attrs => {
    surface(module, mat, attrs);
    return module.state.snapshots;
  });
  const attrs = Object.fromEntries(Object.keys(vertices[0]).map(key => [key, interpolate(vertices.map(v => v[key]), weights)]));
  const samples = new Map();
  for (const [node, value] of maps[0]) samples.set(node, node.interpolation === 'flat' ? value : interpolate(maps.map(m => m.get(node)), weights));
  return surface(module, mat, attrs, samples);
}
const closeSurface = (a, b, context) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= 2e-6, `${context} channel ${i}: ${v} vs ${b[i]}`));

test('near AND far triangle interiors preserve baseline colours, roughness and every procedural feature', (t) => {
  // The second instance must dress from its own seed, not the zero-filled first slot.
  const storage = current.tsl.attributeArray(2 * STRIDE), material = current.createPersonMaterial(storage);
  const oldStorage = old?.tsl.attributeArray(2 * STRIDE), oldMaterial = old && old.createPersonMaterial(oldStorage);
  const samples = [], references = [];
  let interiors = 0;
  for (const detail of [1, 0]) {
    const geo = current.buildPersonGeometry(detail);
    for (const [seed, female] of [[0.13, 0], [1.1, 1], [4.2, 0], [9.7, 1]]) {
      const info = [seed, female, 1.08, 0.85];
      for (const pose of [storage, oldStorage].filter(Boolean)) pose.value.array.set(info, FLOATS + (STRIDE - 1) * 4);
      current.state.instance = 1;
      if (old) old.state.instance = 1;
      for (let i = 0; i < geo.index.count; i += 69) {
        const vertices = [0, 1, 2].map(k => attributes(geo, geo.index.getX(i + k)));
        for (const weights of [[0.23, 0.41, 0.36], [0.001, 0.498, 0.501]]) {
          const actual = rasterSurface(current, material, vertices, weights);
          const part = vertices[0].skin[3];
          assert.equal(current.state.fragmentSin, part >= 6 ? 1 : 0, 'no fragment palette hashes; retain hair strands');
          assert.equal(current.state.branches, 1, 'one part-selecting branch chain for both LODs');
          if (old) closeSurface(actual, rasterSurface(old, oldMaterial, vertices, weights), `LOD ${detail} tri ${i / 3} seed ${seed}`);
          interiors++;
        }
      }
      // Direct detail probes exercise masks that coarse triangle sampling can miss, including both sides of hems,
      // necklines, lips, eye/brow boundaries, zip/lapel, soles and laces, plus cuff coordinates independent of q.x.
      for (const [part, x, y, z, along] of [
        [0, 0, 0.88, 0.08, 0], [0, 0, 0.955, 0.08, 0], [0, 0, 1, 0.08, 0],
        [0, 0, 1.2, 0.08, 0], [0, 0.02, 1.4, 0.09, 0], [0, 0.03, 1.4, 0.09, 0],
        [0, 0, 1.48, 0.09, 0], [0, 0, 1.49, 0.09, 0], [0, 0, 1.5, 0.09, 0], [0, 0, 1.6, 0.04, 0],
        [1, 0.09, 0.6, 0.04, 0], [1, 0.095, 0.6, -0.04, 0],
        [2, 0.09, 0.016, 0.03, 0], [2, 0.09, 0.024, 0.03, 0], [2, 0.09, 0.08, 0.0335, 0],
        [3, 0.21, 0.98, 0.02, 0.93], [3, 0.21, 0.98, 0.02, 0.945], [3, 0.21, 0.98, 0.02, 0.96],
        [4, 0.24, 0.8, 0.01, 0.4], [5, 0.031, 1.627, 0.09, 0], [5, 0.031, 1.646, 0.09, 0],
        [5, 0, 1.549, 0.09, 0], [5, 0.02, 1.675, 0.09, 0], [5, 0.02, 1.72, -0.08, 0],
        [6, 0.03, 1.75, 0.02, 0], [6, 0.03, 1.76, 0.02, 0], [7, 0.07, 1.4, -0.06, 0]
      ]) {
        const attrs = { position: [x, y, z], skin: [0, 0, 0, part], extra: [0, 0, along] };
        const actual = surface(current, material, attrs);
        samples.push(actual);
        if (old) {
          const reference = surface(old, oldMaterial, attrs);
          closeSurface(actual, reference, `detail probe ${part}/${seed}`);
          references.push(reference);
        }
      }
    }
  }
  // Direct probes are Float32-identical; triangle interpolation is independently bounded above.
  frozen(t, 'material', digest(JSON.stringify(samples)), old ? digest(JSON.stringify(references)) : undefined);
  t.diagnostic(`${interiors} triangle-interior comparisons; ${samples.length} detail probes`);
  assert.ok(material.positionNode && material.roughnessNode);
});

test('palette/style varyings stay flat; positions stay smooth; skinning/shadow path does not evaluate clothes', () => {
  const pose = current.tsl.attributeArray(STRIDE);
  const rig = new current.PersonRig({ seed: 3.1, female: true });
  rig.reset(0, 0, 0, () => 0.22);
  pose.value.array.set(rig.pose);
  const material = current.createPersonMaterial(pose);
  current.state.instance = 0;
  const geo = current.buildPersonGeometry(1);
  const attrs = attributes(geo, 0);
  surface(current, material, attrs);
  // The four outer constant varyings must be explicitly flat (not merely equal at today's three vertices).
  assert.equal([...current.state.snapshots.keys()].filter(n => n.interpolation === 'flat').length, 4);
  assert.ok([...current.state.snapshots.keys()].some(n => n.interpolation !== 'flat'));
  Object.assign(current.state, { snapshots: new Map(), vertexReads: 0, fragmentSin: 0 });
  const position = material.positionNode.eval();
  assert.ok(position.every(Number.isFinite));
  assert.equal(current.state.vertexReads, 0, 'position-only/shadow evaluation does not reach any palette varying');
  assert.equal(current.state.fragmentSin, 0);
  if (old) {
    const beforePose = old.tsl.attributeArray(STRIDE); beforePose.value.array.set(rig.pose);
    old.state.attrs = attrs; old.state.instance = 0;
    current.state.instance = 0;
    assert.deepEqual(position, old.createPersonMaterial(beforePose).positionNode.eval());
  }
});

function gaitTrace(module) {
  const raw = createHash('sha256'), portable = createHash('sha256'), groundHash = createHash('sha256');
  let frames = 0, swings = 0, plants = 0, queries = 0;
  const rigs = [];
  for (const female of [false, true]) for (const scale of [0.75, 1, 1.2]) for (const hidden of [false, true]) {
    rigs.push({ rig: new module.PersonRig({ female, scale, seed: 0.13, stride: 1.1, girth: 1.08, armSwing: 0.85 }), hidden, owner: { n: rigs.length } });
  }
  const ground = (owner, x, z) => {
    groundHash.update(JSON.stringify([owner.n, x, z])); queries++;
    return x % 12 < 6 ? 0.22 : 0;
  };
  for (let frame = 0; frame < 420; frame++) {
    const dt = [1 / 60, 1 / 60, 1 / 120, 0, 1e-8, -0.1, 0.2, 1 / 30, 1 / 144][frame % 9];
    const time = frame / 60;
    const travel = frame < 150 ? time : frame < 210 ? 2.5 : (time - 1) * 2;
    for (const { rig, hidden, owner } of rigs) {
      const x = Math.sin(travel * 0.25) * 14 + (frame >= 300 ? 40 : 0);
      const z = Math.cos(travel * 0.25) * 14;
      const air = frame >= 250 && frame < 280 ? Math.sin((frame - 250) / 30 * Math.PI) : 0;
      if (frame === 350) rig.placed = false; // same public reset contract used by pedestrian recycling
      rig.update(dt, x, z, Math.PI / 2 - time * 0.25, ground, owner, air, !hidden || frame % 90 >= 75);
      assert.ok(rig.pose.every(Number.isFinite));
      raw.update(Buffer.from(rig.pose.buffer, rig.pose.byteOffset, rig.pose.byteLength));
      raw.update(JSON.stringify(rig, (key, value) => key === 'pose' ? undefined : value));
      // Existing measured cross-engine tolerance from LESSONS_LEARNED; raw same-engine check remains exact.
      portable.update(JSON.stringify(rig, (key, value) => typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 1e10) / 1e10 : value));
      for (const foot of rig.feet) { swings += foot.swing; plants += foot.contact > 0.97; }
      frames++;
    }
  }
  return { raw: raw.digest('hex'), portable: portable.digest('hex'), ground: groundHash.digest('hex'), frames, swings, plants, queries };
}
test('mixed/clamped dt, deferred solves, turn/stop/run/air/recycle preserve every baseline gait state and pose byte', (t) => {
  const actual = gaitTrace(current), reference = old && gaitTrace(old);
  if (old) assert.deepEqual(actual, reference, 'full raw state, pose bytes and ordered ground callbacks');
  assert.equal(actual.frames, 5040);
  assert.ok(actual.swings > 0 && actual.plants > 0 && actual.queries > 5040);
  frozen(t, 'gait', actual.portable, old ? reference.portable : undefined);
  t.diagnostic(`${actual.frames} frames; ${actual.queries} ground queries; raw ${actual.raw}`);
  assert.deepEqual(Object.getOwnPropertyNames(current.PersonRig.prototype), [
    'constructor', 'legLength', 'reset', 'restPoint', 'footAnkle', 'update', 'setPelvisRotation', 'hipOffset',
    'writeBone', 'basis', 'solveLeg', 'solve'
  ], 'no newer upstream gait or person/cyclist controls');
});

test('same-dt crowd updates reuse six exponentials, clamp before caching, and recompute when dt changes', () => {
  let calls = 0;
  const math = Object.create(Math);
  math.exp = (v) => { calls++; return Math.exp(v); };
  const module = load(source, { math });
  const rigs = Array.from({ length: 30 }, () => new module.PersonRig());
  const ground = () => 0.22;
  for (const rig of rigs) rig.reset(0, 0, 0, ground);
  for (const [dt, extra] of [[1 / 60, 6], [1 / 60, 0], [1 / 30, 6], [0, 6], [-1, 0], [0.1, 6], [1, 0]]) {
    const before = calls;
    for (const rig of rigs) rig.update(dt, rig.x, rig.z, 0, ground, null, 0, false);
    assert.equal(calls - before, extra, `dt ${dt}`);
  }
});

test('actual stumble and booking draw-clearance callers retain gait, ground-owner and reappearance contracts', () => {
  const traffic = readFileSync(join(root, 'js/traffic.js'), 'utf8');
  const stumbleSource = traffic.match(/  function stumble\(p, dt\) \{[^]*?\n  \}/)[0];
  const renderSource = traffic.match(/  function renderPed\(p, dt\) \{[^]*?\n  \}/)[0];
  function run(module) {
    const rig = new module.PersonRig({ seed: 0.13, female: true, scale: 0.95 });
    const p = { x: 0, z: 0, ux: 0, uz: 1, dir: 1, rig, pause: 0.5, bumpVX: 4, bumpVZ: 1, bumpCooldown: 3 };
    const draws = [], trace = [], poseHashes = [];
    const context = { Math, BUMP_FRICTION: 7, BUMP_RETURN: 0.5, presentationClearance: null,
      hasView: true, visible: () => true, focusX: 0, focusZ: 0,
      pedGround: (owner) => { assert.equal(owner, p); return 0.22; },
      pedCrowd: { add: (rig, d) => draws.push([rig.x, rig.z, d]) }
    };
    vm.createContext(context);
    const step = vm.runInContext(`${stumbleSource}\n${renderSource}\n(p, dt) => { stumble(p, dt); renderPed(p, dt); }`, context);
    for (let frame = 0; frame < 180; frame++) {
      context.presentationClearance = frame >= 20 && frame < 100 ? { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } : null;
      const count = draws.length;
      p.x = 0; p.z = frame / 60;
      step(p, 1 / 60);
      assert.equal(draws.length - count, frame >= 20 && frame < 100 ? 0 : 1);
      poseHashes.push(digest(Buffer.from(rig.pose.buffer)));
      trace.push(JSON.stringify(rig));
    }
    assert.equal(poseHashes[20], poseHashes[99], 'booking presentation hides solves/uploads only');
    assert.notEqual(poseHashes[99], poseHashes[100], 'pose catches up immediately on release');
    assert.notEqual(trace[20], trace[99], 'gait advances throughout booking');
    assert.equal(p.bumpVX, 0); assert.equal(p.bumpVZ, 0);
    return { draws, trace };
  }
  const actual = run(current);
  if (old) assert.deepEqual(actual, run(old));
});

async function realPedestrians() {
  const [webgpu, tsl] = await Promise.all(['three.webgpu.js', 'three.tsl.js'].map(file => import(pathToFileURL(join(root, 'vendor/three/build', file)))));
  const module = loadModule(source, { imports: {
    'three/webgpu': webgpu, 'three/tsl': tsl, 'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries }
  } });
  return { module, tsl };
}

test('pinned real TSL and MeshStandardNodeMaterial accept both LOD material graphs without API changes', async () => {
  const { module } = await realPedestrians();
  const crowd = new module.PersonCrowd(2);
  assert.equal(crowd.meshes.length, 2);
  for (const { mesh, pose } of crowd.lods) {
    assert.equal(mesh.material.isMeshStandardNodeMaterial, true);
    assert.equal(mesh.material.metalness, 0);
    assert.ok(mesh.material.colorNode.isNode && mesh.material.positionNode.isNode && mesh.material.roughnessNode.isNode);
    assert.equal(mesh.castShadow, true);
    assert.equal(pose.getPBO(), true, 'production must enable the real indexed WebGL2 texture path');
    assert.equal(pose.access, 'readOnly');
    assert.equal(pose.value.pbo, undefined, 'the node flag allocates no texture on the native storage path');
  }
});

function pinnedPBOSetup(tsl) {
  // Execute the pinned GLSL builder's actual lazy allocator without a renderer/GL context. Real DataTexture and
  // TextureNode instances keep version/source-version semantics; only uniform registration needs a test double.
  const vendor = readFileSync(join(root, 'vendor/three/build/three.webgpu.js'), 'utf8');
  const method = vendor.match(/\tsetupPBO\( storageBufferNode \) \{[^]*?\n\t\}/);
  assert.ok(method, 'review this compatibility test if the vendor changes its PBO setup');
  return vm.runInNewContext(`({${method[0]}}).setupPBO`, {
    ...THREE,
    // The public factory constructs the vendor's real TextureNode without relying on an internal class export.
    TextureNode: function (...args) { return tsl.texture(...args); }
  });
}

for (const textureFallback of [false, true]) {
  test(`real ${textureFallback ? 'WebGL2 PBO' : 'native storage'} crowd retains backing resources and signals every CPU write`, async () => {
    const { module, tsl } = await realPedestrians();
    const crowd = new module.PersonCrowd(3);
    const rig = new module.PersonRig({ seed: 0.7, female: true });
    rig.reset(12, -8, 0.4, () => 0.22);
    const setupPBO = pinnedPBOSetup(tsl);
    let registrations = 0;
    const builder = { shaderStage: 'vertex', context: {}, getUniformFromNode(node, type) {
      assert.equal(node.isTextureNode, true); assert.equal(type, 'texture'); registrations++;
    } };

    // CPU poses can arrive before the first compile. The fallback must copy them into its one-time padded array.
    crowdFrame(crowd, [[rig, 0], [rig, 40]]);
    const resources = Array.from(crowd.lods, ({ pose }) => {
      assert.equal(pose.getPBO(), true);
      const attr = pose.value, original = attr.array;
      if (textureFallback) {
        setupPBO.call(builder, pose);
        assert.notEqual(attr.array, original, 'vendor allocates the padded array only at WebGL2 setup');
        assert.ok(attr.array.length > original.length, 'fixture exercises texture row padding');
        assert.deepEqual(bytes(attr.array.subarray(0, original.length)), bytes(original));
        assert.equal(attr.pbo.isPBOTexture, true);
        assert.equal(attr.pbo.image.data, attr.array, 'CPU writes target the exact backing texture array');
        assert.equal(attr.pbo.format, THREE.RGBAFormat); assert.equal(attr.pbo.type, THREE.FloatType);
        assert.equal(attr.pbo.version, 1, 'initial texture allocation schedules its first upload');
      } else assert.equal(attr.pbo, undefined);
      return { pose, attr, array: attr.array, texture: attr.pbo };
    });
    function frame(people, expectedWrites) {
      const before = resources.map(({ attr, texture }) => [attr.version, texture?.version, texture?.source.version]);
      crowdFrame(crowd, people);
      resources.forEach(({ pose, attr, array, texture }, i) => {
        if (textureFallback) setupPBO.call(builder, pose); // repeated shader setup must reuse the existing backing
        assert.equal(pose.value, attr); assert.equal(attr.array, array); assert.equal(attr.pbo, texture);
        assert.equal(attr.version, before[i][0] + expectedWrites[i], `LOD ${i} buffer dirty signal`);
        if (texture) {
          assert.equal(texture.image.data, array);
          assert.equal(texture.version, before[i][1] + expectedWrites[i], `LOD ${i} texture dirty signal`);
          assert.equal(texture.source.version, before[i][2] + expectedWrites[i], `LOD ${i} texture source dirty signal`);
        }
        if (expectedWrites[i]) assert.deepEqual(attr.updateRanges, [{ start: 0, count: Math.max(1, crowd.lods[i].count) * FLOATS }]);
      });
      assert.equal(registrations, textureFallback ? 2 : 0, 'one fallback texture setup per LOD, none for native storage');
    }

    frame([], [1, 1]); // populated -> zero during the second warm-up update
    for (const { array } of resources) assert.ok(array.subarray(0, FLOATS).every(v => v === 0));
    for (let i = 0; i < 4; i++) frame([], [0, 0]);
    for (const mesh of crowd.meshes) { assert.equal(mesh.count, 0); assert.equal(mesh.visible, false); }
    for (let i = 0; i < 24; i++) {
      const lod = i % 2;
      // Reset at a new standing position then draw near -> far -> near, checking current bytes, not just versions.
      rig.reset(41 + i, 22, -1.4, () => 0);
      assert.equal(rig.speed, 0); assert.equal(rig.gait, 0); assert.ok(rig.pose.every(Number.isFinite));
      frame([[rig, lod ? 40 : 0]], lod ? [0, 1] : [1, 0]);
      assert.deepEqual(bytes(resources[lod].array.subarray(0, FLOATS)), bytes(rig.pose));
      assert.equal(crowd.meshes[lod].visible, true);
      assert.equal(crowd.meshes[1 - lod].visible, false);
    }
    frame([[rig, 0], [rig, 0], [rig, 40]], [1, 1]);
    assert.deepEqual(bytes(resources[0].array.subarray(FLOATS, 2 * FLOATS)), bytes(rig.pose));

    // Already-zero warm-up must not dirty either backing representation unnecessarily.
    const empty = new module.PersonCrowd(1);
    for (const { pose } of empty.lods) if (textureFallback) setupPBO.call(builder, pose);
    for (let i = 0; i < 5; i++) {
      crowdFrame(empty);
      for (const { pose } of empty.lods) {
        assert.equal(pose.value.version, 0);
        if (textureFallback) {
          assert.equal(pose.value.pbo.version, 1);
          assert.equal(pose.value.pbo.source.version, 1);
        } else assert.equal(pose.value.pbo, undefined);
      }
    }
    for (const { texture } of resources) texture?.dispose();
    for (const { pose } of empty.lods) pose.value.pbo?.dispose();
  });
}
