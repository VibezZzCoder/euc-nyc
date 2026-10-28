import test from 'node:test';
import assert from 'node:assert/strict';
import curves from './car-profile-fixture.cjs';
import { Euler, Matrix4, Vector3 } from '../vendor/three/build/three.core.js';
import { EucController } from '../js/euc/simulation/EucController.js';
import { NycTerrainSampler } from '../js/euc-terrain.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { createEucDynamicWorld } from '../js/euc-dynamic.js';

for (const kind of ['sedan', 'taxi', 'suv', 'pickup', 'minivan', 'van']) {
  test(`${kind} crash profile is cached, bounded and sampled from its drawn curves`, () => {
    const spec = curves.BODY_SPECS[kind], layout = curves.carLayout(spec);
    const profile = curves.carCrashProfile(spec);
    assert.equal(curves.carCrashProfile(spec), profile);
    assert.ok(profile.length <= 32, `${profile.length} compact prisms`);
    for (const part of profile) {
      assert.ok(part.maxY > part.minY);
      assert.ok(part.z - part.halfLengthMetres >= spec.zRear - 0.0001);
      assert.ok(part.z + part.halfLengthMetres <= spec.zFront + 0.0001);
      const body = layout.body(part.z);
      if (part.minY === 0) {
        assert.equal(part.maxY, spec.bedCover && part.z < spec.cabin.deck ? Math.max(body.yT, body.yE + 0.046) : body.yT);
        assert.equal(part.halfWidthMetres, body.W);
      } else {
        assert.equal(part.maxY, Math.max(body.yT, spec.cargo ? curves.cargoProfile(spec)(part.z).top : layout.cabinTop(layout.cabin(part.z), 0)));
      }
    }
    const nose = profile.find(p => p.z > spec.zFront - 0.4);
    assert.ok(nose.maxY < Math.max(...spec.cabin.roofY.map(p => p[1])) - 0.5, 'hood is not a roof-height wall');
  });
}

test('van cargo roof and covered pickup bed are solid beyond their short cabs', () => {
  const van = curves.carCrashProfile(curves.BODY_SPECS.van);
  for (const z of [-2.9, -2, -1, 0]) {
    const top = Math.max(...van.filter(p => Math.abs(p.z - z) <= p.halfLengthMetres).map(p => p.maxY));
    assert.ok(top > 2.5 && top < 2.7, `solid high cargo at ${z}: ${top}`);
  }
  const pickup = curves.carCrashProfile(curves.BODY_SPECS.pickup);
  const bedTop = Math.max(...pickup.filter(p => Math.abs(p.z + 2) <= p.halfLengthMetres).map(p => p.maxY));
  assert.ok(bedTop > 1.3 && bedTop < 1.4, 'covered bed is solid but not cabin-height');
});

for (const kind of ['sedan', 'suv', 'pickup', 'minivan', 'van']) {
  test(`${kind} full recovery hull contains all fitted crash parts and blocks placement above the hood`, () => {
    const spec = curves.BODY_SPECS[kind], size = curves.carDimensions(spec);
    const b = { kind: 'vehicle', x: 0, z: 0, headingY: 0, minY: 0, maxY: size.height,
      halfWidthMetres: size.halfWidth, halfLengthMetres: size.halfLength, crashProfile: curves.carCrashProfile(spec) };
    for (const p of b.crashProfile) {
      assert.ok(p.halfWidthMetres <= b.halfWidthMetres + 1e-5);
      assert.ok(Math.abs(p.z) + p.halfLengthMetres <= b.halfLengthMetres + 2e-5);
      assert.ok(p.maxY <= b.maxY + 0.001);
    }
    const world = createEucDynamicWorld({ bodiesNear: (x,z,r,out) => out.push(b) });
    const rider = { x: 0, z: spec.zFront - 0.5, headingY: 0, minY: 1.1, maxY: 3,
      halfWidthMetres: .35, halfLengthMetres: .5 };
    assert.equal(world.canPlace({ reason: 'recover', body: rider }), false);
  });
}

test('fitted profiles are crash-body-only, retain full wheel/airborne/recovery hull and follow vehicle pose', () => {
  const body = { kind: 'vehicle', x: 2, z: 3, headingY: Math.PI / 2, minY: 6, maxY: 7.5,
    halfWidthMetres: 0.86, halfLengthMetres: 2.18, velocityX: 8, velocityZ: 0,
    crashProfile: curves.carCrashProfile(curves.BODY_SPECS.sedan) };
  const world = createEucDynamicWorld({ bodiesNear: (x, z, r, out) => out.push(body) });
  world.didPlace({ body });
  const hulls = world.ragObstacleBodies();
  const parts = world.crashObstacleBodies(body);
  assert.equal(hulls.length, 1);
  assert.equal(hulls[0], body);
  assert.equal(parts.length, body.crashProfile.length);
  const local = body.crashProfile[0], first = parts[0];
  assert.equal(first.x, body.x + local.z);
  assert.equal(first.z, body.z);
  assert.equal(first.maxY, body.minY + local.maxY);
  assert.equal(first.velocityX, 8);
  body.x += 5;
  assert.equal(world.crashObstacleBodies(body)[0], first, 'reuse parts when a car moves');
  assert.equal(first.x, body.x + local.z);
  const rider = { ...world.hull, x: body.x, z: body.z, headingY: 0, minY: 6, maxY: 7.9, velocityX: 0, velocityZ: 0 };
  assert.equal(world.canPlace({ reason: 'recover', body: rider }), false);
  assert.deepEqual(world.ragObstacleBodies(), [body]);
});

test('sloped-road pitch and street body roll bound the same YXZ-transformed slices as the renderer', () => {
  for (const pitch of [-0.22, 0, 0.22]) for (const roll of [-0.15, 0.15]) {
    const b = { kind: 'vehicle', x: 5, z: 10, headingY: 0.7, minY: 6, maxY: 7.5,
      halfWidthMetres: .86, halfLengthMetres: 2.18, crashPitch: pitch, crashRoll: roll,
      crashProfile: curves.carCrashProfile(curves.BODY_SPECS.sedan) };
    const world = createEucDynamicWorld({ bodiesNear: (x,z,r,out) => out.push(b) });
    world.didPlace({body:b});
    const parts = world.crashObstacleBodies(b);
    const matrix = new Matrix4().makeRotationFromEuler(new Euler(pitch, b.headingY, roll, 'YXZ'));
    matrix.setPosition(b.x,b.minY,b.z);
    b.crashProfile.forEach((local,i)=>{
      const part=parts[i], c=Math.cos(b.headingY), s=Math.sin(b.headingY);
      for(const x of [-local.halfWidthMetres,local.halfWidthMetres])
        for(const y of [local.minY,local.maxY])
          for(const z of [local.z-local.halfLengthMetres,local.z+local.halfLengthMetres]) {
            const p=new Vector3(x,y,z).applyMatrix4(matrix), dx=p.x-part.x,dz=p.z-part.z;
            assert.ok(Math.abs(c*dx-s*dz)<=part.halfWidthMetres+1e-9);
            assert.ok(Math.abs(s*dx+c*dz)<=part.halfLengthMetres+1e-9);
            assert.ok(p.y>=part.minY-1e-9&&p.y<=part.maxY+1e-9);
          }
    });
  }
});

for (const speed of [6, 8, 12]) {
  test(`a ${speed} m/s frontal sedan hit stops the wheel while the rider travels forward onto the hood`, () => {
    const size = curves.carDimensions(curves.BODY_SPECS.sedan);
    const body = { kind: 'vehicle', x: 0, z: 4, headingY: Math.PI, minY: 0, maxY: size.height,
      halfWidthMetres: size.halfWidth, halfLengthMetres: size.halfLength, velocityX: 0, velocityZ: 0,
      crashProfile: curves.carCrashProfile(curves.BODY_SPECS.sedan) };
    const world = createEucDynamicWorld({ bodiesNear: (x, z, r, out) => out.push(body) });
    const c = new EucController(new NycTerrainSampler().boxes, { dynamicWorld: world,
      spawn: { position: { x: 0, y: 0, z: 0 }, headingY: 0 } });
    c.reset(undefined, speed);
    for (let i = 0; i < 240 && !c.crashed; i++) c.step(1 / 120, NEUTRAL_ACTIONS);
    assert.equal(c.crashed, true);
    const initial = c.ragdoll.positions[2];
    let farthest = initial;
    for (let i = 0; i < 120; i++) {
      c.step(1 / 120, NEUTRAL_ACTIONS);
      assert.ok(c.z <= body.z - body.halfLengthMetres - world.hull.halfLengthMetres + 1e-6);
      farthest = Math.max(farthest, c.ragdoll.positions[2]);
      for (let j = 0; j < 9; j += 3) for (const part of world.crashObstacleBodies(body)) {
        const p = c.ragdoll.positions;
        const dx = p[j] - part.x, dz = p[j + 2] - part.z;
        const x = Math.cos(part.headingY) * dx - Math.sin(part.headingY) * dz;
        const z = Math.sin(part.headingY) * dx + Math.cos(part.headingY) * dz;
        assert.ok(!(Math.abs(x) < part.halfWidthMetres - 0.02 && Math.abs(z) < part.halfLengthMetres - 0.02
          && p[j + 1] > part.minY + 0.02 && p[j + 1] < part.maxY - 0.02), 'core particle stays outside car solids');
      }
    }
    // The revised sedan's longer full hull stops the wheel earlier. Require actual hood entry and forward travel,
    // not a prescribed half-metre vault distance at every impact speed.
    assert.ok(farthest - initial > 0.5 && farthest > body.z - curves.BODY_SPECS.sedan.zFront + 0.15,
      `pelvis carries forward onto the hood: ${initial} → ${farthest}`);
  });
}

for (const kind of ['minivan', 'pickup', 'van']) for (const heading of [0, Math.PI, Math.PI / 2]) {
  test(`${kind} ${heading === 0 ? 'rear' : heading === Math.PI ? 'front' : 'side'} impact keeps core particles outside fitted body`, () => {
    const spec = curves.BODY_SPECS[kind], size = curves.carDimensions(spec);
    const b = { kind: 'vehicle', x: 0, z: 6, headingY: heading, minY: 0, maxY: size.height,
      halfWidthMetres: size.halfWidth, halfLengthMetres: size.halfLength,
      velocityX: 0, velocityZ: 0, crashProfile: curves.carCrashProfile(spec) };
    const world = createEucDynamicWorld({ bodiesNear: (x,z,r,out) => out.push(b) });
    const c = new EucController(new NycTerrainSampler().boxes, { dynamicWorld: world,
      spawn: { position: { x: 0, y: 0, z: 0 }, headingY: 0 } });
    c.reset(undefined, 10);
    for (let i = 0; i < 240 && !c.crashed; i++) c.step(1/120, NEUTRAL_ACTIONS);
    assert.equal(c.crashed, true);
    assert.equal(c.vehicleImpact, true);
    for (let i = 0; i < 180; i++) {
      c.step(1/120, NEUTRAL_ACTIONS);
      const p = c.ragdoll.positions;
      for (let j = 0; j < 9; j += 3) for (const part of world.crashObstacleBodies(b)) {
        const dx = p[j]-part.x, dz = p[j+2]-part.z, cs = Math.cos(heading), sn = Math.sin(heading);
        assert.ok(!(Math.abs(cs*dx-sn*dz) < part.halfWidthMetres-.02 && Math.abs(sn*dx+cs*dz) < part.halfLengthMetres-.02
          && p[j+1] > part.minY+.02 && p[j+1] < part.maxY-.02), `core inside ${kind} at step ${i}`);
      }
    }
  });
}
