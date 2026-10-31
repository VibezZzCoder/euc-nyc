import { readFileSync } from 'node:fs';
import * as THREE from '../../vendor/three/build/three.core.js';
import { EucController, createPose, copyPose, lerpPose } from '../../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../../js/euc/input/actions.js';
import { SIMULATION, INPUT } from '../../js/euc/data/tuning.js';
import { RiderTricks } from '../../js/euc-tricks.js';
import { findPlacementTarget, placementDepartureClear } from '../../js/euc-recovery.js';
import { RIDERS, PLAYABLE_RIDERS, isPlayableRider, rideStyleFor } from '../../js/euc-roster.js';
import { RiderPreparation, yieldRiderStage } from '../../js/rider-preparation.js';

export const flat = { sampleGround(_x, _z, out) {
  Object.assign(out, { height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false }); return out;
}, raycast() { return null; } };

// Run production entity bodies with native physics/pose/tricks/metadata and the real async transaction coordinator.
// Only drawing, appearance payloads and lighting are stubbed: these physics tests need no atlas painting or GPU.
// The real generated-appearance startup boundary is covered by rider-style-lifecycle.test.mjs.
const source = readFileSync(new URL('../../js/euc-rider.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\n/gm, '').replace(/^export \{[^}]*\};?\n/gm, '').replace(/^export /gm, '');
const appearanceFor = id => ({ look: { id }, machine: { machine: RIDERS[id].machine } });
const deps = { THREE, EucController, createPose, copyPose, lerpPose, NEUTRAL_ACTIONS, SIMULATION, INPUT, RiderTricks,
  findPlacementTarget, placementDepartureClear, RIDERS, PLAYABLE_RIDERS, isPlayableRider, rideStyleFor,
  RiderPreparation, yieldRiderStage,
  prepareAppearance: async (id, { signal } = {}) => {
    if (signal?.aborted) throw new DOMException('Cancelled fixture appearance', 'AbortError');
    if (!isPlayableRider(id)) throw new Error('Unknown playable appearance: ' + id);
    return appearanceFor(id);
  },
  releaseAppearanceCaches() {},
  createRidingRig: (look, machine) => ({ look, machine, group: new THREE.Group(), disposed: false,
    apply(p) { this.drawn = { crouch: p.crouch, tuck: p.tuck }; },
    setTrickPose(foot) { this.foot = foot; }, applySwing() {}, applyStatus() {}, dispose() { this.disposed = true; } }),
  riderLook: id => ({ id }), machineLook: machine => ({ machine }), cityUniforms: { uInteriorGlow: { value: 0 } },
  createEucHeadlight: () => Object.assign(new THREE.Object3D(), { target: new THREE.Object3D() }),
  headlightBeamScale: () => 0, EUC_HEADLIGHT: {}, placeEucHeadlight() {} };
const create = new Function(...Object.keys(deps), `${source}; return createEucEntity;`)(...Object.values(deps));

export function createTestEntity(sampler = flat, options = {}) {
  // Supply a prepared drawing stub synchronously; gameplay tests do not exercise module/worker loading.
  const id = Object.hasOwn(RIDERS, options.rider) ? options.rider : 'cool-rider';
  return create(new THREE.Scene(), sampler, { x: 0, z: 0, appearance: appearanceFor(id), ...options });
}
