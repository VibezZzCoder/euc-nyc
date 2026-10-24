import * as THREE from 'three/webgpu';

// A restrained pair of low beams. Intensity is calibrated for inverse-square decay (the previous lights used 1.22).
// Keep these ordinary, unshadowed spots so they stay in the clustered lighting path.
const HEADLIGHTS = {
  color: 0xfff8ec,
  intensity: 700,
  busIntensity: 900,
  distance: 36,
  angle: 0.14,
  penumbra: 0.85,
  decay: 2,
  pitch: 0.145,
  toeOut: 0.005,
  noseOffset: 0.08
};

// When front lights are on, from the city's interior glow: off at Midday (0.24) and Golden Hour (0.48), fading in
// for Blue Hour (1.25) and Night (1.55). Every vehicle, the player's wheel included, follows this one curve.
function headlightBeamScale(glow) {
  return Math.max(0, Math.min(1.28, (glow - 0.60) * 1.45));
}

// The electric unicycle's headlamp: one lamp about half a metre up, a wide flood fanning out a few metres ahead (the
// chase camera sees the road straight ahead through the rider, so a narrow car-style beam would be hidden). The cone's
// full-strength core stays below the lamp's horizon; its soft fringe reaches a little above, as a real wheel's does.
// Softer falloff than the cars' (decay 1.3) so the pool carries past the rider instead of burning out at the tyre.
// Same unshadowed clustered spot as the cars: one more light in the pool.
const EUC_HEADLIGHT = {
  color: 0xfff4e2,
  intensity: 150,
  distance: 22,
  angle: 0.5,
  penumbra: 0.7,
  decay: 1.3,
  pitch: 0.27,
  noseOffset: 0.02,
  lensNight: 2.4 // lens emissive multiplier at full night, so it reads as lit (and blooms) facing the camera
};

function createEucHeadlight() {
  const c = EUC_HEADLIGHT;
  return new THREE.SpotLight(c.color, 0, c.distance, c.angle, c.penumbra, c.decay);
}

/** Place the lamp at `lamp` (the lens's front centre, in the wheel body's frame, +Z forward) through `matrix`. */
function placeEucHeadlight(spot, lamp, matrix) {
  const z = lamp.z + EUC_HEADLIGHT.noseOffset;
  const aim = 10;
  spot.position.set(lamp.x, lamp.y, z);
  spot.target.position.set(lamp.x, lamp.y - aim * Math.tan(EUC_HEADLIGHT.pitch), z + aim);
  if (matrix) {
    spot.position.applyMatrix4(matrix);
    spot.target.position.applyMatrix4(matrix);
  }
}

function createVehicleHeadlight() {
  return new THREE.SpotLight(HEADLIGHTS.color, 0, HEADLIGHTS.distance, HEADLIGHTS.angle, HEADLIGHTS.penumbra, HEADLIGHTS.decay);
}

function placeVehicleHeadlight(spot, spec, side, matrix = null) {
  const x = side * spec.headlight[0];
  const y = spec.headlight[1];
  const z = spec.zFront + HEADLIGHTS.noseOffset;
  const aim = 10;
  spot.position.set(x, y, z);
  // The upper cone edge stays just below the vehicle's horizon. A soft circular cone approximates a low beam;
  // it is not a projector cutoff. Aim relative to the chassis so bumps, banking and highway slopes carry the beam.
  spot.target.position.set(x + side * aim * HEADLIGHTS.toeOut, y - aim * Math.tan(HEADLIGHTS.pitch), z + aim);
  if (matrix) {
    spot.position.applyMatrix4(matrix);
    spot.target.position.applyMatrix4(matrix);
  }
}

export {
  HEADLIGHTS, EUC_HEADLIGHT, headlightBeamScale,
  createVehicleHeadlight, placeVehicleHeadlight, createEucHeadlight, placeEucHeadlight
};
