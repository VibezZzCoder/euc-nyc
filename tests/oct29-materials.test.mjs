import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import * as config from '../js/city-config.js';

const source = readFileSync(new URL('../js/tsl-materials.js', import.meta.url), 'utf8');
const between = (src, start, end) => {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `source region: ${start} … ${end}`);
  return src.slice(a, b);
};
const canvasCalls = [];
const document = { createElement(tag) {
  assert.equal(tag, 'canvas');
  const canvas = { width: 0, height: 0, getContext(kind) {
    assert.equal(kind, '2d');
    return { fillText: (...args) => canvasCalls.push(args) };
  } };
  return canvas;
} };
// Execute the complete production module with the actual pinned Three/TSL implementation. Only its browser import
// map and the canvas text rasterizer are substituted; node graphs, material factories and texture objects are real.
const materialCode = source.replace(/^import[\s\S]*?from '[^']+';\n/gm, '').replace(/export \{[\s\S]*?\};\s*$/, '');
const materials = vm.runInNewContext(`${materialCode}\n({ createCurtainWallMaterial, createPreWarBuildingMaterial,
  createRoadPaintMaterial, createWaterMaterial, createFacadeBoxes, facadeCell, createStorefront,
  createBuildingEntrance, getStorefrontSignTexture, cityUniforms, WALL_KINDS });`, { THREE, ...TSL, ...config, document });

function build(material, backend) {
  const geometry = new THREE.BoxGeometry();
  for (const [name, n] of [['box', 4], ['faces', 4], ['paint', 3], ['side', 2], ['color', 3]]) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * n).fill(1), n));
  }
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
  const mesh = new THREE.Mesh(geometry, material);
  const builder = new (backend === 'wgsl' ? THREE.WGSLNodeBuilder : THREE.GLSLNodeBuilder)(mesh, renderer);
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.PerspectiveCamera();
  builder.build();
  geometry.dispose();
  return builder;
}

test('road paint is one cached material with the existing transparency/MRT contract', () => {
  const a = materials.createRoadPaintMaterial(), b = materials.createRoadPaintMaterial();
  assert.equal(a, b);
  assert.equal(a.transparent, true);
  assert.equal(a.depthWrite, false);
  assert.equal(a.vertexColors, true);
  assert.equal(a.metalness, 0);
  assert.ok(a.mrtNode?.isNode, 'SSR still sees the asphalt below the markings');
});

for (const backend of ['wgsl', 'glsl']) {
  test(`pinned Three builds all facade channels and road paint (${backend})`, () => {
    for (const factory of [materials.createPreWarBuildingMaterial, materials.createCurtainWallMaterial]) {
      for (const boxLocal of [false, true]) {
        const result = build(factory({ boxLocal }), backend);
        assert.ok(result.fragmentShader.length > 1000);
        assert.doesNotMatch(result.fragmentShader, /NaN|undefined/);
        if (boxLocal) for (const name of ['vFacadeBox', 'vFacadeFaces']) {
          assert.equal(result.varyings.find(v => v.name === name)?.interpolationType, 'flat', `${name} must stay bit-exact`);
        }
        assert.match(result.fragmentShader, backend === 'wgsl' ? /textureSampleLevel/ : /textureLod/,
          'secondary shop signs explicitly select mip level inside their spatial gate');
      }
    }
    const paint = build(materials.createRoadPaintMaterial(), backend);
    assert.ok(paint.vertexShader.length > 1000);
    assert.doesNotMatch(paint.vertexShader + paint.fragmentShader, /NaN|undefined/);
  });
}

test('secondary sign atlas is shared, alpha-only, generic and bounded', () => {
  const texture = materials.getStorefrontSignTexture();
  assert.equal(materials.getStorefrontSignTexture(), texture);
  assert.equal(texture.isCanvasTexture, true);
  assert.equal(texture.image.width, 512);
  assert.equal(texture.image.height, 512);
  assert.equal(texture.colorSpace, THREE.NoColorSpace);
  assert.equal(canvasCalls.length, 8, 'one shared atlas, not one texture per facade style');
  assert.deepEqual(canvasCalls.map(c => c[0]), ['WELCOME', 'OPEN DAILY', 'COME ON IN', 'LOCALLY OWNED',
    'SERVING NEW YORK', 'THANK YOU', 'NEIGHBORHOOD SHOP', 'SEE YOU AGAIN']);
});

function fragmentMaterial(node) {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.fragmentNode = TSL.vec4(node, 1);
  return mat;
}

// Inspect emitted code as well as the numeric branch tracker: calling .toVar() outside an Fn's active stack is not
// proof of hoisting. This catches a derivative/implicit sampler that the real TSL builder sinks into a spatial If.
function conditionalDerivativeLines(shader) {
  const scopes = [], violations = [];
  for (const line of shader.split('\n')) {
    if (/fwidth\(|dFdx\(|dFdy\(|dpdx\(|dpdy\(|textureSample\(/.test(line) && scopes.some(Boolean)) violations.push(line.trim());
    for (const token of line.matchAll(/[{}]/g)) {
      if (token[0] === '{') scopes.push(/\bif\s*\(/.test(line));
      else scopes.pop();
    }
  }
  return violations;
}

for (const backend of ['wgsl', 'glsl']) {
  test(`new storefront branches keep derivatives and implicit samplers outside spatial gates (${backend})`, () => {
    const facade = materials.facadeCell(TSL.uniform(2.7), TSL.uniform(3.8), true, 1.2);
    const shop = materials.createStorefront(facade, TSL.uniform(42), true);
    const entry = materials.createBuildingEntrance(facade, TSL.color(0x9e937f));
    // Exercise emission-first as well as colour-first: neither may rely on another output having hoisted its fwidth.
    for (const first of ['emissive', 'color']) {
      const output = shop[first].add(shop[first === 'color' ? 'emissive' : 'color'])
        .add(shop.roughness).add(shop.relief).mul(shop.mask)
        .add(entry.color.add(entry.emissive).add(entry.roughness).add(entry.relief).mul(entry.mask));
      const shader = build(fragmentMaterial(output), backend).fragmentShader;
      assert.deepEqual(conditionalDerivativeLines(shader), []);
    }
    const water = materials.createWaterMaterial();
    // Compile the real full water material, then its emission in isolation so the gate cannot depend on other outputs.
    assert.doesNotMatch(build(water, backend).fragmentShader, /NaN|undefined/);
    const shader = build(fragmentMaterial(water.emissiveNode), backend).fragmentShader;
    // WebGL's preamble has sampler helpers; inspect the actual fragment entry point.
    const body = backend === 'glsl' ? shader.slice(shader.indexOf('void main()')) : shader;
    const gates = body.split('\n').filter(line => /\bif\s*\(/.test(line));
    assert.ok(gates.length >= 1);
    const gate = gates[0].match(/\( (\w+) > 0\.0 \)/)?.[1];
    assert.ok(gate, gates[0]);
    const definition = body.split('\n').find(line => line.includes(`${gate} =`) || line.includes(`${gate}:`));
    assert.match(definition, /smoothstep\( 0\.55, 1\.35, (?:[\w]+\.)?nodeUniform\d+ \)/,
      'the branch depends on one uniform, not world position or a varying');
    // WebGL's texture UV flip uses additional uniform bool selects, emitted as branches by the pinned builder.
    for (const line of gates.slice(1)) {
      const name = line.match(/if \( (\w+) \)/)?.[1];
      assert.ok(name, `unexpected spatial gate: ${line}`);
      const assignment = body.split('\n').find(line => line.includes(`${name} =`));
      assert.match(assignment, new RegExp(`${name} = bool\\( (?:[\\w]+\\.)?nodeUniform\\d+ \\);`), 'only uniform texture flips are allowed');
    }
    assert.ok(conditionalDerivativeLines(shader).some(line => line.includes('fwidth')),
      'the exact night hit-coordinate derivatives remain inside the uniform daylight gate');
  });
}

// Numerical execution of the production TSL (not a reimplementation of the material formulas). Track whether any
// derivative is evaluated within a spatial branch. A fixed footprint/texture sample isolates the arithmetic from
// GPU driver sampling; the real builders above separately verify the pinned node API and shader construction.
const env = { world: [0, 1, 0], geometry: [0, 0, 0.5], normal: [0, 0, 1], camera: [0, 2, 8],
  box: [15, 19, 10, 29.5], faces: [0, 0, 0, 0], wetness: 0, glow: 0.48, footprint: 0.01,
  paint: [3, 6, 0.5], side: [0.05, 0], spatialRead: false, spatialDepth: 0, derivatives: 0, unsafe: 0, hashes: 0 };
const arr = v => v instanceof N ? v.eval() : Array.isArray(v) ? v : [v];
const binary = (a, b, fn) => {
  const aa = arr(a), bb = arr(b);
  return Array.from({ length: Math.max(aa.length, bb.length) }, (_, i) => fn(aa[i % aa.length], bb[i % bb.length]));
};
class N {
  constructor(value) { this.fn = typeof value === 'function' ? value : () => value; }
  eval() { return this.fn(); }
  add(b) { return new N(() => binary(this, b, (a, b) => a + b)); }
  sub(b) { return new N(() => binary(this, b, (a, b) => a - b)); }
  mul(b) { return new N(() => binary(this, b, (a, b) => a * b)); }
  div(b) { return new N(() => binary(this, b, (a, b) => a / b)); }
  negate() { return this.mul(-1); }
  max(b) { return new N(() => binary(this, b, Math.max)); }
  min(b) { return new N(() => binary(this, b, Math.min)); }
  clamp(a, b) { return this.max(a).min(b); }
  greaterThan(b) { return new N(() => binary(this, b, (a, b) => +(a > b))); }
  and(b) { return new N(() => binary(this, b, (a, b) => +(a > 0 && b > 0))); }
  setInterpolation() { return this; }
  normalize() { return this.div(new N(() => [Math.hypot(...this.eval()) || 1])); }
  level() { return this; }
  toVar() {
    const previous = env.spatialRead;
    env.spatialRead = false;
    let slot = this.eval().slice(), spatial = env.spatialRead;
    env.spatialRead ||= previous;
    const variable = new N(() => { env.spatialRead ||= spatial; return slot; });
    variable.assign = rhs => { slot = arr(rhs).slice(); spatial ||= env.spatialRead; };
    variable.addAssign = rhs => { slot = binary(slot, rhs, (a, b) => a + b); spatial ||= env.spatialRead; };
    return variable;
  }
}
for (const [name, indexes] of Object.entries({ x: [0], y: [1], z: [2], w: [3], a: [3],
  xy: [0, 1], xz: [0, 2], xyz: [0, 1, 2], rgb: [0, 1, 2] })) {
  Object.defineProperty(N.prototype, name, { get() { return new N(() => { const a = this.eval(); return indexes.map(i => a[i]); }); } });
}
const wrap = v => v instanceof N ? v : new N(arr(v));
const vector = n => (...values) => new N(() => {
  const flat = values.flatMap(arr);
  return flat.length === 1 ? Array(n).fill(flat[0]) : flat.slice(0, n);
});
const unary = fn => a => new N(() => arr(a).map(fn));
const spatial = name => new N(() => { env.spatialRead = true; return env[name]; });
const scalar = n => arr(n)[0];
const numerical = {
  ...config, THREE: { MeshStandardNodeMaterial: class { constructor(opts) { Object.assign(this, opts); } } },
  Fn: body => (...args) => new N(() => arr(body(args.map(wrap)))),
  If(condition, body) {
    const previous = env.spatialRead;
    env.spatialRead = false;
    const matched = scalar(condition) > 0, spatial = env.spatialRead;
    env.spatialRead ||= previous;
    if (matched) {
      if (spatial) env.spatialDepth++;
      try { body(); } finally { if (spatial) env.spatialDepth--; }
    }
  },
  float: wrap, vec2: vector(2), vec3: vector(3), vec4: vector(4), varying: wrap,
  attribute: name => spatial(name),
  positionWorld: spatial('world'), positionGeometry: spatial('geometry'), normalGeometry: spatial('normal'),
  normalWorldGeometry: spatial('normal'), facadeWorldNormal: spatial('normal'),
  facadeAlongZ: new N(() => [+(Math.abs(env.normal[0]) >= Math.abs(env.normal[2]))]),
  cameraPosition: new N(() => env.camera), screenSize: wrap([1280, 720]), time: wrap(1.5),
  cameraViewMatrix: { transformDirection: n => n },
  cityUniforms: { uInteriorGlow: new N(() => [env.glow]), uRoadWetness: new N(() => [env.wetness]),
    uSkyHorizonColor: wrap([0.6, 0.7, 0.8]) },
  color: hex => wrap(new THREE.Color(hex).toArray()),
  sin: unary(x => { env.hashes++; return Math.sin(x); }), cos: unary(Math.cos), abs: unary(Math.abs),
  floor: unary(Math.floor), fract: unary(x => x - Math.floor(x)), sign: unary(Math.sign),
  sqrt: unary(Math.sqrt), log2: unary(Math.log2),
  mod: (a, b) => new N(() => binary(a, b, (x, y) => x - y * Math.floor(x / y))),
  min: (a, b) => wrap(a).min(b), max: (a, b) => wrap(a).max(b), clamp: (a, b, c) => wrap(a).clamp(b, c),
  pow: (a, b) => new N(() => binary(a, b, Math.pow)),
  mix: (a, b, t) => wrap(a).mul(wrap(1).sub(t)).add(wrap(b).mul(t)),
  step: (edge, x) => new N(() => binary(edge, x, (e, x) => +(x >= e))),
  smoothstep: (a, b, x) => {
    const t = wrap(x).sub(a).div(wrap(b).sub(a)).clamp(0, 1);
    return t.mul(t).mul(wrap(3).sub(t.mul(2)));
  },
  length: a => new N(() => [Math.hypot(...arr(a))]), normalize: a => wrap(a).normalize(),
  dot: (a, b) => new N(() => [binary(a, b, (a, b) => a * b).reduce((a, b) => a + b, 0)]),
  reflect: (i, n) => wrap(i).sub(wrap(n).mul(new N(() => [2 * binary(i, n, (a, b) => a * b).reduce((a, b) => a + b, 0)]))),
  fwidth: a => new N(() => {
    env.derivatives++;
    if (env.spatialDepth) env.unsafe++;
    return arr(a).map(() => env.footprint);
  }),
  texture: () => wrap([0.04, -0.03, 0.015, 0.2]), getWaterWaveTexture: () => ({}),
  getStorefrontSignTexture: () => ({}), _transparentEffectMRT: {}, canyonSkyAONode: () => wrap(1)
};
const helperCode = between(source, 'const hash2D = Fn(', '/**') +
  between(source, 'const filteredPulse = Fn(', '/**') +
  between(source, 'const facadeBand = Fn(', '// Shops span') +
  between(source, 'const WALL_KINDS =', '/**') +
  between(source, 'function facadeCell(', 'let _storefrontSignTexture') +
  between(source, 'function createStorefront(', '/**\n * Curtain-Wall') +
  between(source, 'function roadPuddleField(', '/**\n * Unified Manhattan') +
  between(source, 'const waterBoxCover = Fn(', '/**');
const factories = vm.runInNewContext(`${helperCode}\nlet _roadPaintMaterial;
  ${between(source, 'function createRoadPaintMaterial()', '/**')}
  ${between(source, 'function createWaterMaterial()', '/**')}
  ({ facadeCell, createStorefront, createBuildingEntrance, createRoadPaintMaterial, createWaterMaterial });`, numerical);
const resetCounts = () => { env.hashes = env.derivatives = env.unsafe = env.spatialDepth = 0; env.spatialRead = false; };
const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test('production wall classification admits exactly one original residential bay and only shop floors', () => {
  const cell = () => factories.facadeCell(wrap(2.7), wrap(3.8), true, 1.2);
  env.box = [15, 19, 10, 29.5];
  for (const normal of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
    env.normal = normal;
    for (let kind = 0; kind <= 4; kind++) {
      env.faces = [kind, kind, kind, kind];
      let doors = 0;
      for (let bay = 0; bay < 5; bay++) {
        env.geometry = [-0.5 + (1.2 + (bay + 0.5) * 2.52) / 15, -0.5 + 1.5 / 19, 0.5];
        if (normal[0]) env.geometry = [normal[0] * 0.5, env.geometry[1], -0.5 + (1.2 + (bay + 0.5) * 2.5333333333) / 10];
        env.world = [0, 1.5, 0];
        const f = cell();
        const shop = factories.createStorefront(f, wrap(42), true);
        const entrance = factories.createBuildingEntrance(f, wrap([0.3, 0.3, 0.3]));
        if (scalar(f.door) > 0) doors++;
        if (kind !== 0 || normal[1]) assert.equal(scalar(shop.mask), 0);
        if (kind !== 1 || normal[1]) assert.equal(scalar(entrance.mask), 0);
      }
      assert.equal(doors, kind === 1 && !normal[1] ? 1 : 0);
    }
  }
  env.normal = [0, 0, 1];
  env.faces = [1, 1, 1, 1];
  env.geometry = [0, -0.5 + 0.5 / 19, 0.5];
  env.world = [0, 1.5, 0]; // bottom = 1 m, still intersects world floor zero
  assert.equal(scalar(cell().door), 0, 'raised tier cannot grow a street entrance');
  env.world = [0, 5.3, 0];
  assert.equal(scalar(cell().door), 0, 'upper floors never receive entrances');
});

test('shop classification has positive coverage; residential trim, metal and transom share coherent masks', () => {
  env.normal = [0, 0, 1]; env.box = [15, 19, 10, 29.5]; env.footprint = 0.001;
  const sample = (kind, u, v) => {
    env.faces = [kind, kind, kind, kind];
    // Tone 0.5 selects bay 2 of 5; its centre is the middle of this 15 m facade.
    env.world = [0, v * 3.8, 0];
    env.geometry = [(1.2 + (2 + u) * 2.52) / 15 - 0.5, -0.5 + env.world[1] / 19, 0.5];
    const f = factories.facadeCell(wrap(2.7), wrap(3.8), true, 1.2);
    return { shop: factories.createStorefront(f, wrap(42), true), entry: factories.createBuildingEntrance(f, wrap([0.3, 0.3, 0.3])) };
  };
  assert.equal(scalar(sample(0, 0.5, 0.5).shop.mask), 1, 'the new shader must actually reach existing shop floors');
  const panel = scalar(sample(1, 0.35, 0.25).entry.roughness);
  const glass = sample(1, 0.35, 0.72).entry;
  close(scalar(glass.mask), 1);
  assert.ok(scalar(glass.roughness) < panel, 'glazed transom has a distinct smooth response');
  assert.ok(arr(glass.emissive).some(v => v > 0));
  const handle = sample(1, 0.467, 0.34).entry;
  assert.ok(scalar(handle.roughness) < panel, 'handles are metal rather than painted panels');
  assert.ok(scalar(handle.relief) > scalar(sample(1, 0.35, 0.34).entry.relief));
  assert.equal(scalar(sample(1, 0.1, 0.4).entry.mask), 0, 'door surround cannot leak into adjacent wall');
  assert.equal(scalar(sample(1, 0.5, 0.95).entry.mask), 0, 'door surround stops below the next floor');
  for (const kind of [0, 2, 3, 4]) assert.equal(scalar(sample(kind, 0.5, 0.5).entry.mask), 0);
});

test('storefront and entrance channels stay finite and derivative-safe across close/grazing footprints', () => {
  env.normal = [0, 0, 1]; env.box = [15, 19, 10, 29.5];
  for (const kind of [0, 1, 2, 3, 4]) for (const footprint of [0.001, 0.03, 0.2, 1.2]) {
    env.faces = [kind, kind, kind, kind]; env.footprint = footprint;
    for (const y of [0.24, 1.4, 2.7, 3.2, 6.4]) {
      env.world = [0, y, 0]; env.geometry = [0, -0.5 + y / 19, 0.5];
      const facade = factories.facadeCell(wrap(2.7), wrap(3.8), true, 1.2);
      const shop = factories.createStorefront(facade, wrap(42), true);
      const entry = factories.createBuildingEntrance(facade, wrap([0.3, 0.3, 0.3]));
      resetCounts();
      for (const surface of [shop, entry]) for (const channel of ['color', 'emissive', 'roughness', 'relief', 'mask']) {
        assert.ok(arr(surface[channel]).every(Number.isFinite), `${kind}/${footprint}/${y}/${channel}`);
      }
      assert.equal(env.unsafe, 0, 'derivatives must be evaluated before any spatial If');
    }
  }
});

let baseline;
try {
  baseline = execFileSync('git', ['show', '853384852baa64f1e1ae1ccc3a2c5cd418e1f02a:js/tsl-materials.js'],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch { /* Curated exports need not contain the private baseline commit. */ }

test('water keeps the exact accepted night raycast and filter expressions', { skip: !baseline }, () => {
  const start = '    const P = positionWorld.xz;';
  const end = '    return city.mul(brightness).mul(treeline).mul(fresnel).mul(night).mul(region);';
  const oldWater = between(baseline, 'function createWaterMaterial()', '/**');
  const newWater = between(source, 'function createWaterMaterial()', '/**');
  assert.equal(between(newWater, start, end), between(oldWater, start, end));
});

test('water daylight gate skips all skyline work; night and region fades match the accepted graph', { skip: !baseline }, () => {
  const oldFactory = vm.runInNewContext(`${helperCode}\n${between(baseline, 'function createWaterMaterial()', '/**')}\ncreateWaterMaterial;`, { ...numerical });
  const before = oldFactory(), after = factories.createWaterMaterial();
  let positive = 0;
  env.normal = [0, 1, 0]; env.footprint = 0.02;
  for (const glow of [0.24, 0.48, 0.55, 0.550001, 0.78, 0.95, 1.38]) {
    env.glow = glow;
    const locations = [[-1200, -2.2, 500]];
    if (glow === 0.95 || glow === 1.38) locations.push([1500, -2.2, 2500], [220, 4, -2200],
      [-1200, -2.2, config.ISLAND_BOUNDS.minZ - 250], [-1200, -2.2, config.ISLAND_BOUNDS.maxZ + 350],
      [-1200, -2.2, -14000], [-1200, -2.2, 18000]);
    for (const [x, y, z] of locations) {
      env.world = [x, y, z]; env.camera = [x - 180, 15, z];
      const expected = arr(before.emissiveNode);
      resetCounts();
      const actual = arr(after.emissiveNode);
      actual.forEach((v, i) => close(v, expected[i]));
      assert.equal(env.unsafe, 0);
      if (glow <= 0.55) {
        assert.deepEqual(actual, [0, 0, 0]);
        assert.equal(env.hashes, 0, 'daylight skips waves/noise used by the emissive raycast');
        assert.equal(env.derivatives, 0);
      } else {
        assert.ok(env.derivatives > 0, 'night keeps exact fwidth of the hit coordinates');
        if (actual.some(v => v > 0)) positive++;
      }
    }
  }
  assert.ok(positive > 5, 'positive controls include actual night reflections, not only zero-output samples');
});

test('road wetness and wear preserve all output, including tiny nonzero transitions and far reach', { skip: !baseline }, () => {
  // Only clip-space projection is substituted in the numerical harness; its actual matrix math is tested below.
  const identityMatrix = { mul: n => n === identityMatrix ? identityMatrix : wrap(n) };
  numerical.cameraViewMatrix = numerical.cameraProjectionMatrix = identityMatrix;
  const oldFactory = vm.runInNewContext(`${helperCode}\n${between(baseline, 'function createRoadPaintMaterial()', '/**')}\ncreateRoadPaintMaterial;`, { ...numerical });
  const newFactory = vm.runInNewContext(`${helperCode}\nlet _roadPaintMaterial;
    ${between(source, 'function createRoadPaintMaterial()', '/**')}\ncreateRoadPaintMaterial;`, { ...numerical });
  const before = oldFactory(), after = newFactory();
  env.world = [23.4, 0.01, -317.2]; env.geometry = [2, 0, 3]; env.footprint = 0.02;
  for (const wetness of [0, 0.1, 0.100001, 0.18, 0.22, 0.38, 0.65, 1]) {
    env.wetness = wetness;
    for (const distance of [0, 15, 40, 69.999, 70, 140, 1400, 1800, 5000]) {
      env.camera = [env.world[0] + distance, env.world[1], env.world[2]];
      for (const name of ['colorNode', 'roughnessNode', 'opacityNode']) {
        const expected = arr(before[name]);
        resetCounts();
        const actual = arr(after[name]);
        actual.forEach((v, i) => close(v, expected[i]));
        assert.equal(env.unsafe, 0);
        if (name !== 'opacityNode' && wetness <= 0.1) assert.equal(env.hashes, 0, 'no dry puddle noise');
        if (name === 'opacityNode' && distance >= 70) assert.equal(env.hashes, 0, 'no already-invisible wear noise');
        if (name === 'opacityNode' && distance > 1300) assert.ok(actual[0] > 0.5, 'no new distance fade');
      }
    }
  }
});

test('road projection reassociation keeps strip width for realistic camera poses', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 20000);
  const p = camera.projectionMatrix;
  for (const yaw of [0, 0.3, 1.5, 3]) for (const distance of [1, 5, 100, 1500, 5000]) {
    camera.position.set(1100, 12, -5500);
    camera.lookAt(1100 + Math.sin(yaw) * 100, 0, -5500 - Math.cos(yaw) * 100);
    camera.updateMatrixWorld();
    const v = camera.matrixWorldInverse, pv = new THREE.Matrix4().multiplyMatrices(p, v);
    const point = new THREE.Vector4(1100 + Math.sin(yaw) * distance, 0, -5500 - Math.cos(yaw) * distance, 1);
    const oldClip = point.clone().applyMatrix4(pv), newClip = point.clone().applyMatrix4(v).applyMatrix4(p);
    oldClip.toArray().forEach((x, i) => close(x, newClip.toArray()[i], 4e-12));
  }
});

test('accepted apartments, masonry/weathering/AC detail, blank walls and architectural distances stay intact', { skip: !baseline }, () => {
  for (const [start, end] of [
    ['const evaluateApartmentInterior = Fn(', '/**\n * Treatment'],
    ['    // Anti-Aliased Running-Bond Brickwork', '    const withAC = mix(withGlass, acColor, inACBox);'],
    ['    // No glass in a storey the box cuts short', '    const withCap = mix(withBlank, mix(cFrame, color(0xc9ced3), 0.45), coping);'],
    ['    const detailFade = float(1.0).sub(smoothstep(18.0, 140.0', '    const mullionRelief ='],
    ['    const detailFade = float(1.0).sub(smoothstep(16.0, 150.0', '    const totalHeight ='],
    ['function createFacadeBoxes(', ' * Road markings built from the road network'],
    ['function createSidewalkMaterial(', '  const CPB = CENTRAL_PARK_BOUNDS;'],
    ['function createParkLawnMaterial(', 'export {']
  ]) assert.equal(between(source, start, end), between(baseline, start, end));
});
