const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  applyMatrix4({ elements: e }) {
    const { x, y, z } = this;
    return this.set(e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14]);
  }
}
class SpotLight {
  constructor(color, intensity, distance, angle, penumbra, decay) {
    Object.assign(this, { color, intensity, distance, angle, penumbra, decay });
    this.position = new Vector3();
    this.target = { position: new Vector3() };
    this.map = null;
    this.colorNode = null;
    this.castShadow = false;
  }
}
const {
  HEADLIGHTS, EUC_HEADLIGHT, headlightBeamScale, createVehicleHeadlight, placeVehicleHeadlight, createEucHeadlight, placeEucHeadlight
} = loadModule(
  readFileSync(join(__dirname, '../js/vehicle-lights.js'), 'utf8'),
  { imports: { 'three/webgpu': { SpotLight } } }
);
const specs = {
  sedan: { headlight: [0.56, 0.705], zFront: 2.25 },
  suv: { headlight: [0.6, 0.9], zFront: 2.3 },
  bus: { headlight: [0.79, 0.8], zFront: 5.78 }
};
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} should equal ${b}`);

test('the shared profile creates ordinary unshadowed spots with no cookie or custom light node', () => {
  const spot = createVehicleHeadlight();
  assert.equal(spot.intensity, 0, 'pool lights remain off until assigned');
  for (const key of ['color', 'distance', 'angle', 'penumbra', 'decay']) assert.equal(spot[key], HEADLIGHTS[key]);
  assert.equal(spot.decay, 2);
  assert.ok(spot.penumbra >= 0 && spot.penumbra <= 1);
  placeVehicleHeadlight(spot, specs.sedan, 1);
  assert.equal(spot.map, null);
  assert.equal(spot.colorNode, null);
  assert.equal(spot.castShadow, false);
});

for (const [name, spec] of Object.entries(specs)) {
  test(`${name} beams originate at the modeled lamps and stay below the chassis horizon`, () => {
    for (const side of [-1, 1]) {
      const spot = createVehicleHeadlight();
      placeVehicleHeadlight(spot, spec, side);
      close(spot.position.x, side * spec.headlight[0]);
      close(spot.position.y, spec.headlight[1]);
      close(spot.position.z, spec.zFront + HEADLIGHTS.noseOffset);
      const dx = spot.target.position.x - spot.position.x;
      const dy = spot.target.position.y - spot.position.y;
      const dz = spot.target.position.z - spot.position.z;
      assert.ok(dz > 0 && dx * side > 0, 'the beam points forward with a slight outward angle');
      close(dx / dz, side * HEADLIGHTS.toeOut);
      close(-dy / dz, Math.tan(HEADLIGHTS.pitch));
      const downwardAngle = Math.atan2(-dy, Math.hypot(dx, dz));
      assert.ok(downwardAngle > spot.angle, 'the entire cone stays below the local horizon, including toe-out');
    }
  });
}

test('lamp and target follow both yaw and slope at elevated road height', () => {
  // A road climbing at 10%, facing +X: yaw = pi/2, pitch = -atan(.1), translated onto the viaduct.
  const pitch = -Math.atan(0.1), s = Math.sin(pitch), c = Math.cos(pitch);
  const matrix = { elements: [0, 0, -1, 0, s, c, 0, 0, c, -s, 0, 0, 30, 7.6, -10, 1] };
  const local = createVehicleHeadlight(), world = createVehicleHeadlight();
  placeVehicleHeadlight(local, specs.suv, -1);
  placeVehicleHeadlight(world, specs.suv, -1, matrix);
  for (const [a, b] of [[local.position, world.position], [local.target.position, world.target.position]]) {
    close(b.x, 30 + s * a.y + c * a.z);
    close(b.y, 7.6 + c * a.y - s * a.z);
    close(b.z, -10 - a.x);
  }
  const dx = world.target.position.x - world.position.x;
  const dy = world.target.position.y - world.position.y;
  const dz = world.target.position.z - world.position.z;
  const vertical = dx * s + dy * c; // dot with the elevated road's up vector
  const horizontal = Math.sqrt(dx * dx + dy * dy + dz * dz - vertical * vertical);
  assert.ok(Math.atan2(-vertical, horizontal) > world.angle, 'the transformed cone stays below the road-relative horizon');
  // Reusing a pooled light must reset local coordinates instead of accumulating the prior matrix transform.
  placeVehicleHeadlight(world, specs.suv, -1);
  assert.deepEqual(world.position, local.position);
  assert.deepEqual(world.target.position, local.target.position);
});

test('front lights are off at Midday and Golden Hour and on at Blue Hour and Night, for cars and the wheel alike', () => {
  assert.equal(headlightBeamScale(0.24), 0);
  assert.equal(headlightBeamScale(0.48), 0);
  assert.ok(headlightBeamScale(1.25) > 0.9);
  assert.equal(headlightBeamScale(1.55), 1.28);
  const traffic = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
  assert.equal((traffic.match(/headlightBeamScale\(glow\)/g) || []).length, 2, 'street and highway traffic share the curve');
  const rider = readFileSync(join(__dirname, '../js/euc-rider.js'), 'utf8');
  assert.match(rider, /headlightBeamScale\(glow\)/, 'the wheel uses the same curve');
});

test('the wheel lamp is one unshadowed spot from the lens, aimed ahead and down along the wheel', () => {
  const spot = createEucHeadlight();
  assert.equal(spot.intensity, 0, 'off until night');
  for (const key of ['color', 'distance', 'angle', 'penumbra', 'decay']) assert.equal(spot[key], EUC_HEADLIGHT[key]);
  assert.equal(spot.castShadow, false);
  assert.equal(spot.map, null);
  const lamp = { x: 0, y: 0.515, z: 0.252 };
  placeEucHeadlight(spot, lamp);
  close(spot.position.y, lamp.y);
  close(spot.position.z, lamp.z + EUC_HEADLIGHT.noseOffset);
  const dy = spot.target.position.y - spot.position.y;
  const dz = spot.target.position.z - spot.position.z;
  assert.ok(dz > 0 && dy < 0, 'forward (+Z in the body frame) and down');
  close(-dy / dz, Math.tan(EUC_HEADLIGHT.pitch));
  const coreTop = EUC_HEADLIGHT.pitch - EUC_HEADLIGHT.angle * (1 - EUC_HEADLIGHT.penumbra);
  assert.ok(coreTop > 0, 'the full-strength core stays below the lamp horizon');
  // Heading pi (riding north, -Z) carries the beam with the wheel
  const m = { elements: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 5, 0, -20, 1] };
  placeEucHeadlight(spot, lamp, m);
  assert.ok(spot.target.position.z < spot.position.z && spot.position.z < -20);
  const rider = readFileSync(join(__dirname, '../js/euc-rider.js'), 'utf8');
  assert.equal((rider.match(/createEucHeadlight\(\)/g) || []).length, 1, 'one lamp, made once (a rider swap keeps it)');
});
