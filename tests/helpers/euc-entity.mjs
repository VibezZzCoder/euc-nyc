import { readFileSync } from 'node:fs';
import * as THREE from '../../vendor/three/build/three.core.js';
import { EucController, createPose, copyPose, lerpPose } from '../../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../../js/euc/input/actions.js';
import { SIMULATION, INPUT } from '../../js/euc/data/tuning.js';
import { RiderTricks } from '../../js/euc-tricks.js';
import { findPlacementTarget, placementDepartureClear } from '../../js/euc-recovery.js';

export const flat = { sampleGround(_x, _z, out) {
  Object.assign(out, { height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false }); return out;
}, raycast() { return null; } };

// Run production entity bodies with native physics/pose/tricks. Only drawing and lighting are stubbed: no GPU/browser.
const source = readFileSync(new URL('../../js/euc-rider.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\n/gm, '').replace(/^export /gm, '');
const deps = { THREE, EucController, createPose, copyPose, lerpPose, NEUTRAL_ACTIONS, SIMULATION, INPUT, RiderTricks,
  findPlacementTarget, placementDepartureClear,
  createRidingRig: () => ({ group: new THREE.Group(), apply(p) { this.drawn = { crouch: p.crouch, tuck: p.tuck }; },
    setTrickPose(foot) { this.foot = foot; }, applySwing() {}, applyStatus() {}, dispose() {} }),
  riderLook: x => x, machineLook: x => x, cityUniforms: { uInteriorGlow: { value: 0 } },
  createEucHeadlight: () => Object.assign(new THREE.Object3D(), { target: new THREE.Object3D() }),
  headlightBeamScale: () => 0, EUC_HEADLIGHT: {}, placeEucHeadlight() {} };
const create = new Function(...Object.keys(deps), `${source}; return createEucEntity;`)(...Object.values(deps));

export function createTestEntity(sampler = flat, options = {}) {
  return create(new THREE.Scene(), sampler, { x: 0, z: 0, ...options });
}
