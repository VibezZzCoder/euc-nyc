// Focused dual-source controller closure. Real fixed-step physics; no browser, GPU or production test hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { EucController, createPose, eucStepPrimitiveFieldsOf } from '../js/euc/simulation/EucController.js';
import { EUC_STEP_PRIMITIVE_FIELDS, copyEucStepPrimitives } from '../js/euc/simulation/eucStepPrimitives.js';
import { PlanTerrainSampler } from '../js/euc/simulation/planSampler.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { SKATE_TRANSITION } from '../js/euc/data/tuning.js';
import { RD_PELVIS } from '../js/euc/simulation/ragdoll.js';

const DT = 1 / 120;
const actions = overrides => ({ ...NEUTRAL_ACTIONS, ...overrides });
const spawn = (x = 0, z = 15, y = 0, headingY = 0) => ({ position: { x, y, z }, headingY });
const fields = ['wallTurnSeconds', 'wallTurnDirection', 'wallTurns', 'comeBackTurn', 'comeBackDirection',
  'comeBackFlight', 'comeBackClimb', 'comeBackUpX', 'comeBackUpZ', 'comeBackAirs', 'kickRise', 'kickRun', 'kickOnTop', 'flaggedSlopeRun'];

// A small circular quarter with the same steep-to-level lip semantics, not Foundry's whole level/field/render graph.
function wall({ flags = true, floor = 0 } = {}) {
  const spacing = 0.125, columns = 81, rows = 241, end = 2 * Math.sin(70 * Math.PI / 180);
  const height = u => u <= 0 ? 0 : 2 - Math.sqrt(4 - Math.min(u, end) ** 2);
  const heights = Array.from({ length: rows }, (_, row) => Array(columns).fill(floor + height(row * spacing - 20))).flat();
  const plan = { id: 'nyc-transition-probe', spawn: spawn(0, 15, floor), surround: { height: floor, surface: 'pavement' },
    heightfield: { originX: -5, originZ: 0, spacing, columns, rows, heights,
      surfaces: Array((columns - 1) * (rows - 1)).fill('pavement') }, segments: [], checkpoints: [] };
  const native = new PlanTerrainSampler(plan), queries = [];
  const sampler = { queries, sampleGround(x, z, out, y) {
    assert.ok(Number.isFinite(y), 'every ground query, including expression-form look-ahead, has a finite referenceY');
    return native.sampleGround(x, z, out);
  }, raycast: (...a) => native.raycast(...a), raycastObstacle: (...a) => native.raycastObstacle(...a) };
  if (flags !== 'absent') sampler.transitionAt = (x, z, y) => {
    assert.ok(Number.isFinite(y), 'every feature query has referenceY'); queries.push([x, z, y]);
    return flags && Math.abs(x) < 4 && z >= 20 && z < 20 + end && y >= floor - .01 && y < floor + 3;
  };
  return sampler;
}
const rider = (sampler, speed = 9, pose = spawn()) => {
  const c = new EucController(sampler, { spawn: pose, tuning: { cutoutEnabled: 0, crashRecoverAutoSeconds: 10 } });
  assert.ok(c.reset(pose, speed)); return c;
};
function facts(c) {
  const pose = createPose(); c.writePose(pose);
  return { snapshot: c.snapshot(), pose, edges: [c.tookOff, c.hopped, c.touchedDown, c.flightIndex, c.spinCompleted] };
}

// Optional same-engine bit-for-bit accepted NYC control. Portable exports still run every fixture below.
let Legacy;
let legacySources;
try {
  const revision = '5493af02062b947d1f0d502f8b4f3e9406b73b43';
  const old = file => execFileSync('git', ['show', `${revision}:${file}`], { cwd: new URL('../', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  legacySources = [old('js/euc/simulation/eucStepPrimitives.js'), old('js/euc/simulation/EucController.js')];
} catch { /* The accepted private implementation commit is absent in a curated, standalone export. */ }
if (legacySources) {
  const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
  const primitives = url(legacySources[0]);
  const source = legacySources[1].replace(/from '([^']+)'/g, (_all, spec) =>
    `from '${spec === './eucStepPrimitives.js' ? primitives : new URL(`../js/euc/simulation/${spec}`, import.meta.url).href}'`);
  Legacy = (await import(url(source))).EucController;
}

test('unflagged/absent capabilities remain bit-identical through climb, stall, hop, spin, crash and recovery', () => {
  for (const speed of [4, 9, 12]) {
    const a = rider(wall({ flags: 'absent' }), speed), b = rider(wall({ flags: false }), speed);
    for (let tick = 0; tick < 720; tick++) {
      const input = actions({ throttle: tick < 50 ? .3 : 0, hop: tick === 35 || tick === 45, steer: tick > 100 && tick < 160 ? .2 : 0 });
      if (tick === 300) { a.hardKnock(0, 1); b.hardKnock(0, 1); }
      if (tick === 600) { a.recover(); b.recover(); }
      a.step(DT, input); b.step(DT, input);
      assert.deepEqual(facts(a), facts(b), `speed ${speed}, tick ${tick}`);
    }
    assert.equal(a.wallTurnCount, 0); assert.equal(b.comeBackAirCount, 0);
  }
});

test('accepted old NYC controller is the exact unflagged control, and fails the flagged improvement', { skip: !Legacy && 'accepted implementation history unavailable' }, () => {
  let changed = 0;
  for (const speed of [4, 9, 12]) {
    const sampler = wall({ flags: false }), a = rider(sampler, speed);
    const old = new Legacy(sampler, { tuning: { cutoutEnabled: 0, crashRecoverAutoSeconds: 10 }, spawn: spawn() });
    old.reset(spawn(), speed);
    const improved = rider(wall(), speed);
    for (let tick = 0; tick < 720; tick++) {
      const input = actions({ hop: speed === 12 && (tick === 50 || tick === 65), throttle: tick < 10 ? .15 : 0 });
      if (tick === 350) { a.hardKnock(0, 1); old.hardKnock(0, 1); }
      if (tick === 600) { a.recover(); old.recover(); }
      a.step(DT, input); old.step(DT, input); improved.step(DT, input);
      assert.deepEqual(facts(a), facts(old), `accepted control speed ${speed}, tick ${tick}`);
      if (JSON.stringify(facts(old)) !== JSON.stringify(facts(improved))) changed++;
    }
  }
  assert.ok(changed > 100, 'flagged rules must improve a control that the old controller fails');
});

test('flagged slow/partial-throttle stalls turn down; the unflagged control stays stuck', () => {
  for (const throttle of [0, .3, .5]) {
    const yes = rider(wall(), 0, spawn(0, 21.6)), no = rider(wall({ flags: false }), 0, spawn(0, 21.6));
    for (let tick = 0; tick < 600; tick++) { yes.step(DT, actions({ throttle })); no.step(DT, actions({ throttle })); }
    assert.ok(yes.wallTurnCount > 0, `throttle ${throttle} rescued the stall`);
    assert.equal(no.wallTurnCount, 0);
    assert.ok(yes.snapshot().position.z < no.snapshot().position.z - 1, 'the rule actually rolls back out');
  }
});

test('a come-back flight carries its automatic turn outside feature bounds without fake player spin credit', () => {
  for (const playerSpin of [false, true]) {
    const sampler = wall({ floor: 10 }), c = rider(sampler, 9, spawn(0, 15, 10));
    let began = -1, landed = false, yaw = 0, last = 0;
    for (let tick = 0; tick < 600; tick++) {
      c.step(DT, actions({ hop: playerSpin && began >= 0 && tick === began + 3 }));
      if (began < 0 && c.inComeBackAir) {
        began = tick; last = c.headingY;
        // Crossing a feature boundary must not cancel already-authorized in-flight motion.
        sampler.transitionAt = (_x, _z, y) => { assert.ok(y >= 10); return false; };
      } else if (began >= 0) {
        yaw += Math.abs(c.headingY - last); last = c.headingY;
        if (c.touchedDown) { landed = true; break; }
      }
    }
    assert.ok(began >= 0 && landed, 'flight launches and lands across the feature boundary');
    assert.ok(yaw > (playerSpin ? 5 : 2.8), `actual heading sweep ${yaw}`);
    assert.equal(c.snapshot().spins, playerSpin ? 1 : 0);
    assert.equal(c.spinCompleted, playerSpin, 'automatic half turn never claims a player 180');
    assert.equal(c.inComeBackAir, false);
  }
});

test('all 11 feature sites and 23 ground sites forward referenceY, including fallen support and look-ahead expressions', () => {
  const source = readFileSync(new URL('../js/euc/simulation/EucController.js', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/this\.sampler\.transitionAt(?:\?\.)?\(([^)]*)\)/g)];
  assert.equal(calls.length, 11);
  for (const call of calls) assert.match(call[1], /, this\.y$/);
  const ground = [...source.matchAll(/this\.sampler\.sampleGround\(([^)]*)\)/g)];
  assert.equal(ground.length, 23);
  for (const call of ground) assert.equal(call[1].split(',').length, 4, call[0]);
  const s = wall({ floor: 10 }), c = rider(s, 4, spawn(0, 15, 10));
  for (let tick = 0; tick < 500; tick++) c.step(DT, actions());
  assert.ok(s.queries.length > 0 && s.queries.every(q => q[2] >= 10));
});

test('kicker/crest rules require a real latch, preserve native unflagged launch and cap flagged launches', () => {
  const c = rider(wall({ flags: false }));
  assert.equal(c.transitionLaunch(20, 9), 9);
  assert.equal(c.transitionHop(3, 20, 9), 12);
  c.kickRise = .5; c.kickRun = .2; c.kickOnTop = true;
  assert.equal(c.transitionLaunch(20, 0), SKATE_TRANSITION.kickMaxVerticalSpeed);
  assert.equal(c.transitionHop(3, 20, 0), SKATE_TRANSITION.hopMaxVerticalSpeed);
  c.kickRise = 0; c.flaggedSlopeRun = 0;
  assert.equal(c.transitionLaunch(20, 9), SKATE_TRANSITION.crestMaxVerticalSpeed);
  c.reset();
  assert.equal(c.transitionLaunch(20, 9), 9);
  assert.equal(c.flaggedSlopeRun, Infinity);
});

test('a real ramp-to-flat kicker carries its launch slope; the unflagged control flies off flat', () => {
  const make = flagged => {
    const columns = 17, rows = 97, spacing = .125;
    const height = z => z < 2 || z >= 4.375 ? 0 : Math.min(1, (z - 2) * .5);
    const native = new PlanTerrainSampler({ id: 'kicker-probe', spawn: spawn(0, .5), surround: { height: 0, surface: 'pavement' },
      heightfield: { originX: -1, originZ: 0, columns, rows, spacing,
        heights: Array.from({ length: rows }, (_, r) => Array(columns).fill(height(r * spacing))).flat(),
        surfaces: Array((columns - 1) * (rows - 1)).fill('pavement') }, segments: [], checkpoints: [] });
    return { sampleGround: (...a) => native.sampleGround(...a), raycast: (...a) => native.raycast(...a),
      transitionAt(_x, z, y) { assert.ok(Number.isFinite(y)); return flagged && z >= 2 && z < 4.375; } };
  };
  const launches = [];
  for (const flagged of [false, true]) {
    const c = rider(make(flagged), 8, spawn(0, .5));
    for (let tick = 0; tick < 200; tick++) {
      c.step(DT, actions());
      if (c.tookOff) { launches.push(c.verticalVelocity); break; }
    }
  }
  assert.equal(launches.length, 2);
  assert.equal(launches[0], 0, 'the flat-lip control demonstrates the missed kicker launch');
  assert.ok(launches[1] > 2 && launches[1] <= SKATE_TRANSITION.kickMaxVerticalSpeed);
});

test('down-face braking rolls out only on flagged ground; it cannot hold the steep face indefinitely', () => {
  const positions = [];
  for (const flagged of [false, true]) {
    const c = rider(wall({ flags: flagged }), 0, spawn(0, 21.6, 0, Math.PI));
    let still = 0, longest = 0;
    for (let tick = 0; tick < 600; tick++) {
      c.step(DT, actions({ throttle: -1 }));
      const s = c.snapshot();
      still = s.position.z > 21.4 && Math.abs(s.speed) < .005 ? still + 1 : 0;
      longest = Math.max(longest, still);
    }
    if (flagged) assert.ok(longest < 30, `flagged face held for ${longest} ticks`);
    else assert.ok(longest > 100, 'old unflagged brake control holds the face');
    positions.push(c.snapshot().position.z);
  }
  assert.ok(positions[1] < positions[0] - .5, 'flagged brake physically rolls down the face');
});

test('contact separation cannot push a grounded latched climber over a coping', () => {
  const c = rider(wall(), 0, spawn(0, 21.87));
  c.comeBackClimb = .9;
  const before = c.snapshot().position;
  c.separate(0, .1);
  assert.deepEqual(c.snapshot().position, before);
  const old = rider(wall({ flags: false }), 0, spawn(0, 21.87));
  old.separate(0, .1);
  assert.ok(old.snapshot().position.z > before.z + .09, 'unflagged control exposes the coping push');
});

test('prepared primitive copy includes every transition field plus safeY/vehicle/recovery additions', () => {
  const a = rider(wall()), b = rider(wall());
  assert.deepEqual([...eucStepPrimitiveFieldsOf(a)].sort(), [...EUC_STEP_PRIMITIVE_FIELDS].sort());
  for (const [i, field] of [...fields, 'safeY', 'vehicleImpact', 'crashVelocityX', 'crashVelocityZ', 'recoveryRetrySeconds'].entries()) {
    a[field] = typeof a[field] === 'boolean' ? true : i + .375;
  }
  copyEucStepPrimitives(b, a);
  for (const field of EUC_STEP_PRIMITIVE_FIELDS) assert.equal(b[field], a[field], field);
});

test('native prepare/commit carries transition state; refused token and teleport leave no stale flight latch', () => {
  const direct = rider(wall()), staged = rider(wall());
  for (let tick = 0; tick < 400; tick++) {
    direct.step(DT, actions());
    const before = facts(staged), token = staged.prepareStep(DT, actions());
    assert.deepEqual(facts(staged), before, 'prepare is observational');
    staged.resolvePreparedStep(token);
    staged.commitPreparedStep(token);
    assert.deepEqual(facts(staged), facts(direct));
    for (const field of fields) assert.equal(staged[field], direct[field], `tick ${tick}: ${field}`);
  }
  const token = staged.prepareStep(DT, actions());
  staged.reset(spawn(0, 2));
  assert.throws(() => staged.commitPreparedStep(token), /stale|active|invalid/i);
  assert.equal(staged.inComeBackAir, false); assert.equal(staged.wallTurnCount, 0);
  assert.equal(staged.kickRise, 0); assert.equal(staged.comeBackClimb, 0);
});

test('recovery speed is local to fallen/candidate floor and agrees with checked dynamic admission', () => {
  for (const [fallenPark, targetPark, floor] of [[false, false, 0], [true, false, 0], [false, true, 0], [false, false, 8]]) {
    const asks = [], groundAsks = [], admissions = [], target = { x: targetPark ? 2 : 20, y: floor, z: 2, headingY: 0 };
    const s = { sampleGround(x, z, out, y) {
      groundAsks.push([x, z, y]);
      assert.ok(Number.isFinite(y)); Object.assign(out, { height: floor, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false }); return out;
    }, raycast() { return null; }, restartsAtRest(x, z, y) {
      asks.push([x, z, y]); return x < 5 && y < 3;
    }, findRecoveryTarget(_request, canPlace) { return canPlace(target) ? target : null; } };
    const c = rider(s, 8, spawn(20, 2, floor));
    c.setDynamicWorld({ hull: { halfWidthMetres: .3, halfLengthMetres: .4, heightMetres: 1.8 },
      canPlace(request) { admissions.push(request); return true; } });
    c.hardKnock(0, 1); c.crashTime = c.tuning.crashRecoverEarliestSeconds;
    c.comeBackFlight = true; c.comeBackTurn = 1; c.comeBackClimb = .9; c.kickRise = .5; c.wallTurnSeconds = .2;
    // The fallen pelvis can cross into the park after the wheel stopped on a street. Use its actual Y, not wheel/safeY.
    c.ragdolling = true;
    c.ragdoll.positions.set([fallenPark ? 2 : 20, floor + .8, 2], RD_PELVIS * 3);
    assert.equal(c.recover(), true);
    // clearInstability retires crashSpeed after respawn; compare the admission and committed velocity instead.
    assert.equal(c.speed, admissions.at(-1).initialSpeedMetresPerSecond);
    if ((fallenPark || targetPark) && floor < 3) assert.equal(c.speed, 0);
    else assert.ok(c.speed > 1, 'street/deck restores speed, not global rest');
    assert.ok(asks.some(q => q[0] === target.x && q[2] === floor));
    assert.ok(groundAsks.some(q => q[0] === (fallenPark ? 2 : 20) && Math.abs(q[2] - floor - .8) < 1e-6),
      'pelvis elevation selects the fallen support layer');
    assert.ok(asks.some(q => q[0] === (fallenPark ? 2 : 20) && q[2] === floor),
      'local policy receives the selected support floor, not pelvis elevation');
    assert.equal(c.inComeBackAir, false);
    assert.equal(c.comeBackTurn, 0); assert.equal(c.kickRise, 0); assert.equal(c.wallTurnSeconds, 0); assert.equal(c.comeBackClimb, 0);
  }
});
