// NYC Spin-off: EUC Thrills — © 2026 VibezZzCoder — MIT.
// Adapted from EUC SF aa44c1c js/sun-shadow-retention.js (same author/licence).
// Pinned three e27dfa95ae7f453b5d7a9a36ffdb563f7c9b529b, SunShadowNode (MIT, three.js authors).
// Move persistent uniform callbacks outside the builder's lexical scope. Keep the exact node graph.
import { If, float, mix, normalWorld, positionView, reference, renderGroup, shadowPositionWorld, smoothstep, uniform, vec4 } from 'three/tsl';
import { SunShadowNode } from 'three/addons/lights/SunShadowNode.js';

function cascadeUniforms(shadow, i) {
  const shadowMatrix = uniform('mat4').setGroup(renderGroup).onRenderUpdate(() => shadow.getMatrix(i));
  const cascade = uniform('vec4').setGroup(renderGroup).onRenderUpdate(() => shadow._cascadeData[i]);
  return { shadowMatrix, cascade };
}

export function installSunShadowRetentionFix() {
  const proto = SunShadowNode.prototype;
  if (proto._nycBuilderRetentionFix) return false;
  proto._nycBuilderRetentionFix = true;
  // Cascades sample depth only. Retain logical RGBA/vec4 output, native depth/resize/disposal ownership,
  // but allocate the unused colour attachment in core-renderable R8 on each supported backend.
  const setupRenderTarget = proto.setupRenderTarget;
  proto.setupRenderTarget = function (shadow, builder) {
    const result = setupRenderTarget.call(this, shadow, builder);
    const backend = builder.renderer.backend;
    if (backend.isWebGLBackend) result.shadowMap.texture.internalFormat = 'R8';
    else if (backend.isWebGPUBackend) result.shadowMap.texture.internalFormat = 'r8unorm';
    return result;
  };
  proto._setupCascades = function (builder, filterFn) {
    builder.observer.hasNode = true;
    const { shadow, shadowMap } = this;
    const depthTexture = shadowMap.depthTexture;
    const shadowIntensity = reference('intensity', 'float', shadow).setGroup(renderGroup);
    const normalBias = reference('normalBias', 'float', shadow).setGroup(renderGroup);
    const shadowPosition = vec4(shadowPositionWorld.add(normalWorld.mul(normalBias)), 1).toVar();
    const viewDepth = positionView.z.negate().toVar();
    const shadowValue = float(1).toVar('shadowValue');
    for (let i = shadow.getViewportCount() - 1; i >= 0; i--) {
      const { shadowMatrix, cascade } = cascadeUniforms(shadow, i);
      If(viewDepth.greaterThanEqual(cascade.x).and(viewDepth.lessThan(cascade.y)), () => {
        const shadowCoord = this.setupShadowCoord(builder, shadowMatrix.mul(shadowPosition));
        const cascadeShadow = this.setupShadowFilter(builder, {
          filterFn,
          shadowTexture: shadowMap.texture,
          depthTexture,
          shadowCoord,
          shadow: this._filterShadow,
          depthLayer: this.depthLayer
        });
        shadowValue.assign(mix(cascadeShadow, shadowValue, smoothstep(cascade.z, cascade.y, viewDepth)));
      });
    }
    return mix(1, shadowValue, shadowIntensity);
  };
  return true;
}
