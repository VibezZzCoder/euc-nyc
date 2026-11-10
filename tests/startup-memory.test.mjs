// NYC adaptation of SF aa44c1c shadow/default contracts; no browser/device claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import * as THREE from '../vendor/three/build/three.webgpu.js';
import * as TSL from '../vendor/three/build/three.tsl.js';
import { initialRenderPreferences, createRenderResolutionPreference } from '../js/render-resolution.js';
import { createGraphicsQualityPreference } from '../js/graphics-quality.js';

test('phone initial settings, independent saved overrides and blocked storage', () => {
  const phone = { navigator: { userAgent: 'iPhone', maxTouchPoints: 5 } };
  assert.deepEqual(initialRenderPreferences(phone), { quality: 'medium', resolution: '75' });
  assert.deepEqual(initialRenderPreferences({ navigator: { userAgent: 'desktop' }, screen: { width: 320, height: 568 } }),
    { quality: 'high', resolution: '100' });
  assert.equal(initialRenderPreferences({ navigator: { userAgentData: { mobile: true } } }).quality, 'medium');
  assert.equal(initialRenderPreferences({ navigator: { maxTouchPoints: 1 }, screen: { width: 390, height: 844 },
    matchMedia: () => ({ matches: true }) }).quality, 'medium');
  const unavailable = () => { throw Error('storage blocked'); };
  assert.equal(createRenderResolutionPreference(unavailable, '75').scale, .75);
  assert.equal(createGraphicsQualityPreference(unavailable, 'medium').value, 'medium');
  const storage = new Map([['euc-newyork-graphics-quality', 'high'], ['euc-newyork-render-resolution', '50']]);
  const get = () => ({ getItem: key => storage.get(key), setItem: (k, v) => storage.set(k, v) });
  assert.equal(createGraphicsQualityPreference(get, 'medium').value, 'high');
  const res = createRenderResolutionPreference(get, '75');
  assert.equal(res.scale, .5); res.set('100'); assert.equal(res.scale, 1);
  assert.equal(createGraphicsQualityPreference(get, 'medium').value, 'high');
});

const original = readFileSync(new URL('../vendor/three/examples/jsm/lights/SunShadowNode.js', import.meta.url), 'utf8');
const fix = readFileSync(new URL('../js/sun-shadow-retention.js', import.meta.url), 'utf8');
const cascade = original.slice(original.indexOf('\t_setupCascades( builder, filterFn ) {'), original.indexOf('\t/**\n\t * Sets up the atlas render target'));
const allocator = original.slice(original.indexOf('\tsetupRenderTarget( shadow, builder ) {'), original.indexOf('\t/**\n\t * Builds the per-fragment cascade blending.'));
test('pinned sun allocator and cascade graph: only uniform closure ownership moves', () => {
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(cascade), '58ced08a526c6b6dae8015226dc97b2b9d29a3e654217a9c54508154142574fe');
  assert.equal(hash(allocator), 'f769e43b19205f9c4f01ebdc5bcc451f146740002e0156f5ad368e7135e39c81');
  const tokens = s => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
  const copy = tokens(fix.slice(fix.indexOf('proto._setupCascades = function (builder, filterFn) {'), fix.indexOf('  return true;\n}')));
  const inline = tokens(`const shadowMatrix = uniform('mat4').setGroup(renderGroup).onRenderUpdate(() => shadow.getMatrix(i));
    const cascade = uniform('vec4').setGroup(renderGroup).onRenderUpdate(() => shadow._cascadeData[i]);`);
  assert.equal(copy.replace(/^proto\._setupCascades=function/, '_setupCascades')
    .replace(tokens('const { shadowMatrix, cascade } = cascadeUniforms(shadow, i);'), inline).replace(/;$/, ''), tokens(cascade));
  assert.doesNotMatch(fix.slice(fix.indexOf('function cascadeUniforms'), fix.indexOf('export function')), /builder/);
});

for (const [backend, format] of [[{ isWebGPUBackend: true }, 'r8unorm'], [{ isWebGLBackend: true }, 'R8']]) {
  test(`${format}: native atlas ownership, resize and logical output preserved`, () => {
    class SunShadowNode {}
    SunShadowNode.prototype.setupRenderTarget = vm.runInNewContext(`({${allocator}}).setupRenderTarget`, { ...THREE });
    const install = vm.runInNewContext(`(()=>{${fix.replace(/^import .*;$/gm, '').replace('export function', 'function')}
      return installSunShadowRetentionFix;})()`, { ...TSL, SunShadowNode });
    assert.equal(install(), true); assert.equal(install(), false);
    const shadow = { mapSize: new THREE.Vector2(2048, 2048), mapType: THREE.UnsignedByteType,
      getFrameExtents: () => new THREE.Vector2(2, 1) };
    const builder = { renderer: { backend, reversedDepthBuffer: true }, createRenderTarget: (w, h) => new THREE.RenderTarget(w, h) };
    const { shadowMap, depthTexture } = new SunShadowNode().setupRenderTarget(shadow, builder);
    assert.equal(shadowMap.texture.internalFormat, format); assert.equal(shadowMap.texture.format, THREE.RGBAFormat);
    assert.equal(shadowMap.depthTexture, depthTexture); assert.equal(depthTexture.compareFunction, THREE.GreaterEqualCompare);
    let disposals = 0; shadowMap.addEventListener('dispose', () => disposals++);
    shadowMap.setSize(2048, 1024); assert.equal(disposals, 1); assert.equal(shadowMap.texture.internalFormat, format);
    shadowMap.dispose(); assert.equal(disposals, 2);
  });
}

test('map rotation shrinks before growth, keeping intermediate area within old/new bounds', () => {
  const source = readFileSync(new URL('../js/nyc-map.js', import.meta.url), 'utf8');
  const resize = new Function(source.match(/function resizeMapBitmap\([^]*?\n\}/)[0] + '; return resizeMapBitmap;')();
  for (const [w, h, nw, nh] of [[780,1688,1688,780], [1688,780,780,1688], [1688,780,1,1]]) {
    let width = w, height = h, peak = w * h;
    const c = { get width() { return width; }, set width(v) { width = v; peak = Math.max(peak, width * height); },
      get height() { return height; }, set height(v) { height = v; peak = Math.max(peak, width * height); } };
    resize(c, nw, nh); assert.equal(width, nw); assert.equal(height, nh); assert.ok(peak <= Math.max(w*h,nw*nh));
  }
});
