import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import { createFramePacer } from '../js/frame-rate.js';
import { loadModule } from './helpers/module.cjs';

// Selective source: mrdoob/slop-newyork@9cabaebb2f982d7cc822369448b0389a03ffb977 (MIT, © 2026 Mr.doob).
// Compare against the accepted fork, including its fictional liveries and centred-wheel correction.
const BASELINE = '853384852baa64f1e1ae1ccc3a2c5cd418e1f02a';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const source = read('js/actor-models.js'), traffic = read('js/traffic.js');
const baselineFile = path => process.env.OCT29_CAR_BASELINE
  ? readFileSync(`${process.env.OCT29_CAR_BASELINE}/${path}`, 'utf8')
  : execFileSync('git', ['show', `${BASELINE}:${path}`], {
    cwd: fileURLToPath(root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
  });
let oldSource, oldTraffic;
try { oldSource = baselineFile('js/actor-models.js'); oldTraffic = baselineFile('js/traffic.js'); } catch { /* curated export */ }
const baselineOptions = { skip: !oldSource && 'accepted source unavailable; set OCT29_CAR_BASELINE to a baseline checkout' };
const between = (src, start, end) => {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `source boundaries: ${start} … ${end}`);
  return src.slice(a, b);
};
const functionSource = (src, name) => {
  const match = src.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, 'm'));
  assert.ok(match, name);
  return match[0];
};
const utils = loadModule(read('vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), { imports: { three: THREE } });
let canvases = 0;
const document = { createElement() {
  canvases++;
  return { getContext: () => ({ fillRect() {}, fillText() {} }) };
} };
function load(code, tsl = TSL) {
  return loadModule(code, { imports: {
    'three/webgpu': THREE, 'three/tsl': tsl,
    'three/addons/utils/BufferGeometryUtils.js': utils,
    './tsl-materials.js': { cityUniforms: { uInteriorGlow: tsl.uniform(0.48) } }
  }, globals: { document } });
}
const cars = load(source), oldCars = oldSource && load(oldSource);
const kinds = Object.keys(cars.BODY_SPECS);

// Numeric execution of production TSL. Fixed per-axis footprints and texture samples isolate material arithmetic;
// real Three builders below separately check the node API, attributes, derivative placement and shader generation.
// Colour conversion uses the pinned THREE.Color, so this compares linear working-space values, not raw sRGB bytes.
const env = { attrs: {}, footprint: [0.002, 0.004, 0.008], textureSamples: 0 };
const arr = v => v instanceof N ? v.eval() : Array.isArray(v) ? v : [v];
const binary = (a, b, fn) => {
  const aa = arr(a), bb = arr(b);
  return Array.from({ length: Math.max(aa.length, bb.length) }, (_, i) => fn(aa[i % aa.length], bb[i % bb.length]));
};
class N {
  constructor(value, footprint = null) { this.fn = typeof value === 'function' ? value : () => value; this.footprint = footprint; }
  eval() { return this.fn(); }
  add(b) { return new N(() => binary(this, b, (a, b) => a + b)); }
  sub(b) { return new N(() => binary(this, b, (a, b) => a - b)); }
  mul(b) { return new N(() => binary(this, b, (a, b) => a * b)); }
  div(b) { return new N(() => binary(this, b, (a, b) => a / b)); }
  negate() { return this.mul(-1); }
  greaterThan(b) { return new N(() => binary(this, b, (a, b) => +(a > b))); }
  lessThan(b) { return new N(() => binary(this, b, (a, b) => +(a < b))); }
  and(b) { return new N(() => binary(this, b, (a, b) => +(a && b))); }
  setInterpolation() { return this; }
  toVar() {
    let slot;
    const node = new N(() => slot ?? this.eval());
    node.assign = value => { slot = arr(value).slice(); };
    return node;
  }
}
for (const [name, indexes] of Object.entries({ x: [0], y: [1], z: [2], w: [3], r: [0], g: [1], b: [2], rgb: [0, 1, 2] })) {
  Object.defineProperty(N.prototype, name, { get() {
    return new N(() => indexes.map(i => this.eval()[i]), this.footprint && (() => indexes.map(i => this.footprint()[i])));
  } });
}
const wrap = v => v instanceof N ? v : new N(arr(v));
const unary = fn => a => new N(() => arr(a).map(fn));
const vector = n => (...args) => new N(() => {
  const a = args.flatMap(arr);
  return a.length === 1 ? Array(n).fill(a[0]) : a.slice(0, n);
});
const numeric = {
  Fn: fn => () => new N(() => arr(fn())),
  If(cond, body) {
    let matched = arr(cond)[0] > 0;
    if (matched) body();
    const chain = {
      ElseIf(c, b) { if (!matched && arr(c)[0] > 0) { matched = true; b(); } return chain; },
      Else(b) { if (!matched) { matched = true; b(); } return chain; }
    };
    return chain;
  },
  float: wrap, vec2: vector(2), vec3: vector(3), vec4: vector(4),
  color: hex => wrap(new THREE.Color(hex).toArray()),
  attribute: name => new N(() => { assert.ok(env.attrs[name], `missing ${name}`); return env.attrs[name]; },
    name === 'position' ? () => env.footprint : null),
  varying: wrap, vertexStage: wrap, sin: unary(Math.sin), cos: unary(Math.cos),
  atan: (y, x) => new N(() => binary(y, x, Math.atan2)),
  pow: (a, b) => new N(() => binary(a, b, Math.pow)),
  dot: (a, b) => new N(() => [binary(a, b, (x, y) => x * y).reduce((x, y) => x + y, 0)]),
  abs: unary(Math.abs), fract: unary(x => x - Math.floor(x)), floor: unary(Math.floor),
  min: (a, b) => new N(() => binary(a, b, Math.min)), max: (a, b) => new N(() => binary(a, b, Math.max)),
  clamp: (v, lo, hi) => new N(() => binary(binary(v, lo, Math.max), hi, Math.min)),
  mix: (a, b, t) => new N(() => binary(binary(a, wrap(1).sub(t), (x, y) => x * y), binary(b, t, (x, y) => x * y), (x, y) => x + y)),
  step: (edge, x) => new N(() => binary(edge, x, (a, b) => +(b >= a))),
  smoothstep: (e0, e1, x) => new N(() => {
    const a = arr(e0), b = arr(e1), v = arr(x);
    return Array.from({ length: Math.max(a.length, b.length, v.length) }, (_, i) => {
      const t = Math.max(0, Math.min(1, (v[i % v.length] - a[i % a.length]) / (b[i % b.length] - a[i % a.length])));
      return t * t * (3 - 2 * t);
    });
  }),
  length: v => new N(() => [Math.hypot(...arr(v))]),
  fwidth: v => new N(() => { assert.ok(v.footprint, 'footprint is defined for this source coordinate'); return v.footprint(); }),
  normalView: wrap([0, 0, 1]), positionViewDirection: wrap([0, 0, 1]),
  uniform: v => wrap(v.isVector4 ? v.toArray() : v),
  texture: () => new N(() => { env.textureSamples++; return [0.9, 0.7, 0.1, 1]; }),
  time: wrap(0), instanceIndex: wrap(0)
};
const numericCars = load(source, numeric), numericOld = oldSource && load(oldSource, numeric);
const shade = mat => ['colorNode', 'roughnessNode', 'metalnessNode'].flatMap(key => mat[key].eval());
const close = (a, b, label) => {
  assert.equal(a.length, b.length, label);
  a.forEach((v, i) => assert.ok(Number.isFinite(v) && Math.abs(v - b[i]) < 1e-10, `${label} [${i}]: ${v} vs ${b[i]}`));
};
function attrs(spec, style, part, r, angle, axle = 0, side = 1) {
  const y = r * spec.wheelRadius * Math.sin(angle), z = r * spec.wheelRadius * Math.cos(angle);
  return { position: [side * spec.wheelX, axle ? spec.wheelRadius + y : y, axle ? axle * (spec.wheelZ + z) : z],
    normal: [side, 0, 0], partId: [part], wheelStyle: [style], paintColor: [0.7, 0.4, 0.2], carState: [0, 0, 0, style] };
}
const { ALLOY, TYRE, TRIM } = cars.CAR_PARTS;
const samples = [[ALLOY, 0, 0], [ALLOY, 0.06, 0.7], [ALLOY, 0.12, 1.3], [ALLOY, 0.3, 0],
  [ALLOY, 0.44, 0.45], [ALLOY, 0.54, 2.2], [ALLOY, 0.64, 0.4],
  [TYRE, 0.71, 0.6], [TYRE, 0.8, 1.3], [TYRE, 0.94, 2.3], [TYRE, 1, 0], [TRIM, 0.3, 0.4]];
const styles = [0, 1, 2, 3].map(wheel => cars.carStyleCode({ wheel }));
styles.push(cars.carStyleCode({ trim: 2 }), cars.carStyleCode({ livery: 1 }),
  cars.carStyleCode({ livery: 1, trim: 2, wheel: 3 }), cars.carStyleCode({ livery: 2, metallic: 1, trim: 1, wheel: 2 }));

test('wheel material is cached, opaque and lit, with baseline depth/roughness/metalness/environment contracts', () => {
  const before = canvases;
  const a = cars.createCarWheelMaterial({ instanced: true });
  assert.equal(a, cars.createCarWheelMaterial({ instanced: true }));
  assert.notEqual(a, cars.createCarWheelMaterial());
  assert.equal(cars.createCarWheelMaterial(), cars.createCarWheelMaterial({ style: 0 }));
  assert.notEqual(cars.createCarWheelMaterial(), cars.createCarWheelMaterial({ style: 1 }));
  assert.notEqual(a, cars.createCarWheelMaterial({ instanced: true, wheelRadius: 0.4 }));
  assert.equal(canvases, before, 'creating wheels never allocates the plate atlas');
  const body = cars.createLoftedCarMaterial(cars.BODY_SPECS.sedan);
  for (const key of ['transparent', 'opacity', 'depthWrite', 'depthTest', 'side', 'blending', 'alphaTest',
    'alphaToCoverage', 'toneMapped', 'fog', 'lights', 'envMapIntensity', 'isMeshStandardNodeMaterial']) {
    assert.equal(a[key], body[key], key);
  }
  assert.equal(a.transparent, false);
  assert.equal(a.lights, true);
  assert.equal(a.envMapIntensity, 1.35);
  assert.equal(a.emissiveNode, null);
  assert.equal(a.opacityNode, null);
  env.attrs = attrs(cars.BODY_SPECS.sedan, 0, ALLOY, 0.44, 0.45);
  env.textureSamples = 0;
  shade(numericCars.createCarWheelMaterial({ instanced: true }));
  assert.equal(env.textureSamples, 0);
});

for (const kind of kinds) {
  test(`${kind}: near wheels retain accepted centred/axle shading, all styles and physical surface channels`, baselineOptions, () => {
    const spec = cars.BODY_SPECS[kind];
    const wheel = numericCars.createCarWheelMaterial({ instanced: true, wheelRadius: spec.wheelRadius });
    const before = numericOld.createLoftedCarMaterial(numericOld.BODY_SPECS[kind]);
    const after = numericCars.createLoftedCarMaterial(numericCars.BODY_SPECS[kind]);
    for (const footprint of [[0.001, 0.002, 0.007], [0.01, 0.025, 0.003], [0.05, 0.06, 0.08]]) {
      env.footprint = footprint;
      for (const style of styles) for (const [part, r, angle] of samples) {
        env.attrs = attrs(spec, style, part, r, angle);
        const near = shade(wheel);
        close(near, shade(before), `${kind} centred ${style}/${part}/${r}`);
        close(shade(after), shade(before), `${kind} retained centred body shader`);
        for (const axle of [-1, 1]) {
          env.attrs = attrs(spec, style, part, r, angle, axle, axle);
          close(shade(after), shade(before), `${kind} axle ${axle}, ${style}/${part}/${r}`);
          close(near, shade(after), `${kind} near/axle ${axle}, ${style}/${part}/${r}`);
        }
      }
    }
    // A real far proxy uses TYRE on its entire wheel disc; keep the procedural alloy mask and edge transition.
    for (const style of styles) for (const r of [0.05, 0.3, 0.59, 0.6, 0.61, 0.8, 1]) {
      env.attrs = attrs(spec, style, TYRE, r, 0.7, 1);
      close(shade(after), shade(before), `${kind} proxy-disc ${style}/${r}`);
    }
  });
}

test('all packed style codes decode identically for fixed and instanced wheels; blackouts and patrol steel remain distinct', () => {
  const wheel = numericCars.createCarWheelMaterial({ instanced: true }), spec = cars.BODY_SPECS.sedan;
  env.footprint = [0.002, 0.004, 0.003];
  for (let style = 0; style < 256; style++) {
    const fixed = numericCars.createCarWheelMaterial({ style });
    for (const [part, r, angle] of samples.slice(0, 7)) {
      env.attrs = attrs(spec, style, part, r, angle);
      close(shade(wheel), shade(fixed), `packed style ${style}`);
    }
  }
  const sample = (style, r = 0.64, angle = 0) => {
    env.attrs = attrs(spec, style, ALLOY, r, angle);
    return shade(wheel);
  };
  const silver = sample(0), blackout = sample(cars.carStyleCode({ trim: 2 }));
  const police = sample(cars.carStyleCode({ livery: 1, trim: 2, wheel: 3 }));
  assert.ok(silver[0] > blackout[0] && blackout[0] > police[0]);
  close(silver.slice(3), [0.22, 0.84], 'alloy PBR');
  close(police.slice(3), [0.52, 0.22], 'patrol steel PBR');
  const patterns = [0, 1, 2].map(wheel => [0, 0.2, 0.4, 0.6].map(angle => sample(cars.carStyleCode({ wheel }), 0.43, angle)[0]).join(','));
  assert.equal(new Set(patterns).size, 3, 'not just recoloured identical spoke patterns');
});

test('all six full/proxy/centred geometries, crash profiles, liveries and wheel motion retain baseline', baselineOptions, () => {
  const plain = value => JSON.parse(JSON.stringify(value, (key, v) => key.startsWith('_') ? undefined : v));
  const bytes = a => a && Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const compareGeometry = (a, b) => {
    assert.deepEqual(Object.keys(a.attributes), Object.keys(b.attributes));
    for (const name of Object.keys(a.attributes)) {
      assert.equal(a.attributes[name].itemSize, b.attributes[name].itemSize);
      assert.deepEqual(bytes(a.attributes[name].array), bytes(b.attributes[name].array), name);
    }
    assert.deepEqual(bytes(a.index?.array), bytes(b.index?.array));
    assert.deepEqual(plain(a.groups), plain(b.groups));
    a.computeBoundingBox(); b.computeBoundingBox();
    assert.deepEqual(a.boundingBox, b.boundingBox);
    a.dispose(); b.dispose();
  };
  for (const kind of kinds) {
    const a = cars.BODY_SPECS[kind], b = oldCars.BODY_SPECS[kind];
    assert.deepEqual(plain(a), plain(b));
    assert.deepEqual(plain(cars.carDimensions(a)), plain(oldCars.carDimensions(b)));
    assert.deepEqual(plain(cars.carCrashProfile(a)), plain(oldCars.carCrashProfile(b)));
    for (const wheels of [true, false]) compareGeometry(cars.buildCarGeometry(a, wheels), oldCars.buildCarGeometry(b, wheels));
    compareGeometry(cars.buildCarProxyGeometry(a), oldCars.buildCarProxyGeometry(b));
    for (const side of [-1, 1]) compareGeometry(cars.buildSteerableWheelGeo(a, side), oldCars.buildSteerableWheelGeo(b, side));
  }
  // Full fictional body/livery graph outside the extracted wheel branches remains byte-identical.
  const bodyPrefix = s => between(s, 'function createLoftedCarMaterial(', '    }).ElseIf(isAlloyFace.greaterThan(0.5)')
    .replace('  const fadeMed = (w) => smoothstep(0.042, 0.012, w);\n', '');
  assert.equal(bodyPrefix(source), bodyPrefix(oldSource));
  const bodyTail = s => between(s, '    }).ElseIf(isMirror.greaterThan(0.5)', '// 4. LOFTED MTA BUS');
  assert.equal(bodyTail(source), bodyTail(oldSource));
  assert.equal(functionSource(traffic, 'placeWheels'), functionSource(oldTraffic, 'placeWheels'));
  assert.equal(between(traffic, '    const rotY = c.yaw', '    if (c.z < OFF_STAGE_Z)'),
    between(oldTraffic, '    const rotY = c.yaw', '    if (c.z < OFF_STAGE_Z)'));
  assert.equal(between(traffic, 'const CAR_DRIVER', '// Retire distant actors'), between(oldTraffic, 'const CAR_DRIVER', '// Retire distant actors'));
  assert.equal(between(traffic, '  const cars = [];', '  // Per body type:'), between(oldTraffic, '  const cars = [];', '  // Per body type:'));
});

function trafficHarness() {
  const makeMesh = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(48), 3));
    g.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(64), 4));
    return new THREE.InstancedMesh(g, new THREE.MeshStandardNodeMaterial(), 16);
  };
  const bodies = Object.fromEntries(kinds.map(k => [k, { near: makeMesh(), far: makeMesh(), shadow: [2, 4, 0] }]));
  const bodyMeshes = Object.values(bodies).flatMap(b => [b.near, b.far]);
  const context = {
    THREE, ...cars, NUM_CARS: 200, bodies, bodyMeshes, dummy: new THREE.Object3D(), zero: new THREE.Matrix4().makeScale(0, 0, 0),
    policeBars: { sedan: makeMesh(), suv: makeMesh() }, carShadowInst: makeMesh(),
    dirtyPaint: new Set(), dirtyState: new Set(), policeDrawn: { sedan: 0, suv: 0 },
    hasView: false, visible: () => true, OFF_STAGE_Z: -5000, CAR_PROXY_DISTANCE: 90,
    focusX: 0, focusZ: 0, camX: 0, camY: 10, camZ: 0, camFwdX: 0, camFwdZ: 1,
    MAX_LIGHT_DIST_SQ: 0, clock: 0, litVehicles: [], litVehicleCount: 0, visibleCars: 0, visibleBuses: 0, wheelCars: 0,
    dirtyWheelStyles: false, hideEmpty: true
  };
  vm.createContext(context);
  // Execute the actual setup, renderer, reset and upload code; no GPU, city construction, AI or private test hooks.
  vm.runInContext(between(traffic, '  const carWheelLeftGeo', '  const cars = [];') +
    between(traffic, '  const carWheelLeftInst', '  // 3D Collision Spark') +
    ['flagRange', 'placeWheels', 'renderCar'].map(name => functionSource(traffic, name)).join('\n'), context);
  const reset = between(traffic, '    for (const m of bodyMeshes) m.count = 0;', '    for (let i = 0; i < vehicles.length; i++)');
  const bodySync = between(traffic, '    for (const m of bodyMeshes) {', '    const syncInst = (inst, n) => {');
  const sync = between(traffic, '    const syncInst = (inst, n) => {', "    for (const kind of ['sedan', 'suv']) syncInst");
  const state = vm.runInContext('({ carWheelStyles, carWheelLeftInst, carWheelRightInst })', context);
  return { ...state, context, frame(vehicles) {
    vm.runInContext(reset, context);
    for (const c of vehicles) context.renderCar(c);
    vm.runInContext(bodySync, context);
    vm.runInContext(`{ ${sync} }`, context);
  } };
}
const vehicle = (bodyType, style, x = 10, isNYPD = false) => ({ bodyType, style, isNYPD, x, z: 10, prevX: x, prevZ: 10,
  yaw: 0.2, yawOffset: 0.05, pitch: 0, roll: 0.1, wheelSpin: 0.7, steer: 0.15, paint: [1, 1, 1],
  blink: 0, blinkPhase: 0, acc: 0, speed: 5 });

// Model an already-created GPU buffer: Three uploads only queued ranges when the attribute version changes,
// then clears those ranges. Simulation callbacks and hidden meshes alone must not consume the pending data.
function wheelGpu(h) {
  const attr = h.carWheelStyles, array = new Float32Array(attr.array), uploads = [];
  let version = attr.version;
  return { array, uploads, consume() {
    if (!h.carWheelLeftInst.visible || version === attr.version) return;
    const ranges = attr.updateRanges.length ? attr.updateRanges : [{ start: 0, count: attr.array.length }];
    uploads.push(ranges.map(({ start, count }) => ({ start, count })));
    for (const { start, count } of ranges) array.set(attr.array.subarray(start, start + count), start);
    version = attr.version;
    attr.clearUpdateRanges();
  } };
}

test('traffic packs all kinds and both patrol bodies; shared style buffer uploads only changed active slots', () => {
  const h = trafficHarness(), a = h.carWheelStyles, gpu = wheelGpu(h);
  assert.equal(a, h.carWheelLeftInst.geometry.attributes.wheelStyle);
  assert.equal(a, h.carWheelRightInst.geometry.attributes.wheelStyle);
  assert.equal(h.carWheelRightInst.material, h.carWheelLeftInst.material);
  assert.equal(h.carWheelRightInst.userData.sharesPipelineWith, h.carWheelLeftInst);
  const fleet = kinds.map((k, i) => vehicle(k, cars.carStyleCode({ wheel: i % 4, trim: i % 3, livery: k === 'taxi' ? 2 : 0 })));
  fleet.push(...['sedan', 'suv'].map(k => vehicle(k, cars.carStyleCode({ livery: 1, trim: 2, wheel: 3 }), 20, true)));
  const check = cars => assert.deepEqual([...a.array.slice(0, cars.length * 2)], cars.flatMap(c => [c.style, c.style]));
  const version = a.version;
  h.frame(fleet); check(fleet);
  assert.equal(a.version, version + 1, 'one upload shared by both sides');
  assert.deepEqual(a.updateRanges, [{ start: 0, count: fleet.length * 2 }]);
  assert.equal(h.carWheelLeftInst.count, 16);
  assert.equal(h.carWheelRightInst.count, 16);
  gpu.consume();
  h.frame(fleet); check(fleet);
  assert.equal(a.version, version + 1, 'same slots/styles upload no style data');
  const repacked = fleet.toReversed();
  h.frame(repacked); check(repacked);
  assert.equal(a.version, version + 2, 'culling/reordering changes slot identity');
  gpu.consume();
  const far = vehicle('van', 255, 100);
  h.frame([far, repacked[0]]); check([repacked[0]]);
  assert.equal(h.carWheelLeftInst.count, 2);
  assert.equal(a.version, version + 2, 'far car never occupies separate wheel slots');
  assert.equal(h.context.bodies.van.far.geometry.attributes.carState.array[3], far.style);
  repacked[0].style = 0;
  h.frame([repacked[0]]);
  assert.equal(a.version, version + 3);
  assert.deepEqual(a.updateRanges, [{ start: 0, count: 2 }], 'upload is the active prefix, not full capacity');
  h.frame([]);
  assert.equal(a.version, version + 3);
  assert.equal(h.carWheelLeftInst.count, 0);
  assert.equal(h.carWheelRightInst.visible, false);
  h.context.hideEmpty = false;
  h.frame([]);
  assert.equal(a.version, version + 3, 'warm-up does not invent style uploads');
  assert.equal(h.carWheelLeftInst.count, 1);
  assert.equal(h.carWheelLeftInst.visible, true);
  assert.deepEqual([...h.carWheelLeftInst.instanceMatrix.array.slice(0, 16)], h.context.zero.elements);
});

test('pending wheel styles survive shrink/reappear at 60→30 FPS, including two consecutive delayed-upload runs', () => {
  const h = trafficHarness(), gpu = wheelGpu(h), pacer = createFramePacer('60');
  const first = vehicle('sedan', 0), second = vehicle('suv', 0);
  let callback = 0;
  const tick = vehicles => {
    h.frame(vehicles); // Traffic runs on every 60 Hz callback, even when rendering is capped at 30.
    const render = pacer.shouldRender(callback++ * 1000 / 60);
    if (render) {
      gpu.consume();
      assert.deepEqual([...gpu.array.slice(0, vehicles.length * 2)], vehicles.flatMap(c => [c.style, c.style]),
        'GPU styles must match every visible front/rear wheel, including a returning unchanged CPU slot');
    }
    return render;
  };
  for (const cap of ['60', '30', '30']) {
    pacer.set(cap);
    first.style = second.style = 0;
    assert.equal(tick([first, second]), true, 'reset establishes GPU [0, 0] for both cars');
    const uploadsBefore = gpu.uploads.length;
    first.style = 64; second.style = 128;
    assert.equal(tick([first, second]), cap === '60'); // GPU may still have [0, 0].
    first.style = 192;
    assert.equal(tick([first]), true); // Shorter active prefix must not discard pending second-car style 128.
    const shrinkUpload = gpu.uploads.at(-1);
    const afterShrink = h.carWheelStyles.version;
    assert.equal(tick([first]), cap === '60');
    assert.equal(tick([first, second]), true); // CPU slot 1 is already 128, so this does not mark it dirty again.
    assert.equal(h.carWheelStyles.version, afterShrink, 'reappearance does not repair missing GPU data with a new write');
    assert.equal(gpu.uploads.length - uploadsBefore, cap === '60' ? 2 : 1);
    assert.deepEqual(shrinkUpload, [{ start: 0, count: cap === '60' ? 2 : 4 }]);
    assert.equal(h.carWheelStyles.updateRanges.length, 0, 'renderer consumed the pending union');
  }
  first.style = 0;
  assert.equal(tick([first]), false);
  assert.equal(tick([first]), true);
  assert.deepEqual(gpu.uploads.at(-1), [{ start: 0, count: 2 }], 'after consumption, a later small update stays small');
});

for (const lod of ['near', 'far']) {
  test(`street ${lod} body paint/state pending tails survive shrink, hidden callbacks and unchanged reappearance`, () => {
    const h = trafficHarness(), mesh = h.context.bodies.sedan[lod];
    const first = vehicle('sedan', 0, lod === 'near' ? 10 : 110);
    const second = vehicle('sedan', 0, lod === 'near' ? 20 : 120);
    const attrs = ['paintColor', 'carState'].map(name => mesh.geometry.attributes[name]);
    const copies = attrs.map(a => new Float32Array(a.array));
    const versions = attrs.map(a => a.version);
    const consume = () => attrs.forEach((a, i) => {
      if (!mesh.visible || versions[i] === a.version) return;
      const ranges = a.updateRanges.length ? a.updateRanges : [{ start: 0, count: a.array.length }];
      for (const { start, count } of ranges) copies[i].set(a.array.subarray(start, start + count), start);
      versions[i] = a.version;
      a.clearUpdateRanges();
    });
    h.frame([first, second]); consume();
    for (let run = 0; run < 2; run++) {
      first.paint = [0.25, 0.5, 0.75]; second.paint = [0.75, 0.25, 0.5];
      first.style = 64 + run; second.style = 128 + run; second.acc = -2;
      h.frame([first, second]); // callback with no render
      first.paint = [0.5, 0.75, 0.25]; first.style = 192 + run;
      h.frame([first]);
      const pending = attrs.map(a => a.updateRanges.map(r => ({ ...r })));
      h.frame([]); consume(); // hidden meshes must not consume anything
      attrs.forEach(a => assert.equal(a.updateRanges.length, 1));
      h.frame([first]); consume(); // render only the smaller set, but upload its pending tail as well
      const after = attrs.map(a => a.version);
      h.frame([first, second]); consume();
      assert.deepEqual(attrs.map(a => a.version), after, 'the returning CPU slot causes no repair write');
      attrs.forEach((a, i) => assert.deepEqual([...copies[i].slice(0, 2 * a.itemSize)],
        [...a.array.slice(0, 2 * a.itemSize)], 'simulated GPU must match both visible cars'));
      attrs.forEach((a, i) => assert.deepEqual(pending[i], [{ start: 0, count: 2 * a.itemSize }]));
      assert.equal(copies[1][4], 1, 'tail brake light survives too');
      assert.equal(copies[1][7], second.style, 'tail livery/trim/wheel style survives');
    }
    first.paint = [1, 0, 0]; first.style = 8;
    h.frame([first]);
    attrs.forEach(a => assert.deepEqual(a.updateRanges, [{ start: 0, count: a.itemSize }], 'consumed unions retire'));
  });
}

function build(material, backend) {
  const geometry = cars.buildSteerableWheelGeo(cars.BODY_SPECS.sedan, 1);
  geometry.setAttribute('wheelStyle', new THREE.InstancedBufferAttribute(new Float32Array([0, 225]), 1));
  geometry.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(6).fill(0.7), 3));
  geometry.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(8), 4));
  const renderer = {
    contextNode: TSL.context({}), library: new THREE.StandardNodeLibrary(),
    coordinateSystem: backend === 'wgsl' ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem,
    backend: { isWebGPUBackend: backend === 'wgsl', isWebGLBackend: backend === 'glsl',
      capabilities: { getUniformBufferLimit: () => 65536 }, utils: { getTextureSampleData: () => ({ primarySamples: 1 }) } },
    debug: { diagnostics: {} }, lighting: { enabled: false }, shadowMap: { enabled: false },
    getRenderTarget: () => null, getMRT: () => null, getOutputRenderTarget: () => null,
    getColorBufferType: () => THREE.UnsignedByteType, hasFeature: () => false, hasCompatibility: () => false,
    outputColorSpace: THREE.LinearSRGBColorSpace, toneMapping: THREE.NoToneMapping,
    getDrawingBufferSize: v => v.set(1280, 720), getPixelRatio: () => 1,
    getCanvasTarget: () => ({ textures: [{ format: THREE.RGBAFormat, type: THREE.UnsignedByteType }] })
  };
  const mesh = new THREE.InstancedMesh(geometry, material, 2);
  const builder = new (backend === 'wgsl' ? THREE.WGSLNodeBuilder : THREE.GLSLNodeBuilder)(mesh, renderer);
  builder.scene = new THREE.Scene(); builder.camera = new THREE.PerspectiveCamera();
  builder.build();
  geometry.dispose(); mesh.dispose();
  return builder;
}

for (const backend of ['wgsl', 'glsl']) {
  test(`${backend}: pinned Three builds lightweight wheel shaders with flat styles and uniform-flow derivatives`, () => {
    for (const instanced of [true, false]) {
      const b = build(cars.createCarWheelMaterial({ instanced, style: 225 }), backend);
      const text = b.vertexShader + b.fragmentShader;
      assert.doesNotMatch(text, /NaN|undefined|carState|paintColor|textureSample\(|texture\(/);
      assert.ok(b.fragmentShader.length > 1000);
      if (instanced) {
        assert.match(b.vertexShader, /wheelStyle/);
        assert.ok(b.varyings.some(v => v.interpolationType === 'flat'));
      } else assert.doesNotMatch(text, /wheelStyle/);
      const scopes = [];
      for (const line of b.fragmentShader.split('\n')) {
        if (/fwidth\(/.test(line)) assert.ok(!scopes.some(Boolean), `derivative inside branch: ${line}`);
        for (const token of line.matchAll(/[{}]/g)) {
          if (token[0] === '{') scopes.push(/\bif\s*\(/.test(line)); else scopes.pop();
        }
      }
      const body = build(cars.createLoftedCarMaterial(cars.BODY_SPECS.sedan), backend);
      assert.ok(b.fragmentShader.length < body.fragmentShader.length / 2, 'wheel source excludes the large body graph (not a GPU timing claim)');
    }
  });
}
