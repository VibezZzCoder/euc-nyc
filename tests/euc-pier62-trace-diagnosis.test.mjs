// Diagnostic replay of the real bounded Pier 62 producer. CPU only; no renderer/browser/test hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildPark, physicalFingerprint } from './park-terrain.test.mjs';
import { NycTerrainSampler } from '../js/euc-terrain.js';
import { EucController, createPose } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { SKATE_TRANSITION } from '../js/euc/data/tuning.js';

const DT = 1 / 120, theta = -2.7703, ox = -1810.1186904414033, oz = 1612.3259178482895;
const built = buildPark('pier62');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const local = (x, z) => ({ u: (x - ox) * Math.cos(theta) - (z - oz) * Math.sin(theta),
  s: (x - ox) * Math.sin(theta) + (z - oz) * Math.cos(theta) });
const position = (u, s) => ({ x: ox + u * Math.cos(theta) + s * Math.sin(theta),
  z: oz - u * Math.sin(theta) + s * Math.cos(theta), y: .48 });
const sites = [{ id: 'pier62', u: 41.3, s: .3 }, { id: 'pier62-far', u: 100.8, s: 6.6 }];
// The first site's full-throttle return leaves Pier 62. Include its two actual adjacent piers and the existing
// inlet-road support, using source producers, to distinguish a local controller fault from subsequent city contact.
const citySource = readFileSync(new URL('../js/city-grid.js', import.meta.url), 'utf8');
const chelseaStart = citySource.indexOf('  kinds.chelsea =');
const chelseaEnd = citySource.indexOf('\n\n  // Pier 57:', chelseaStart);
assert.ok(chelseaStart > 0 && chelseaEnd > chelseaStart);
const roadRegistration = citySource.match(/    const top = addRideTop\(c\.poly, 0, 'pavement'\); top\.shore = true; top\.replacesBlock = true;/)?.[0];
assert.ok(roadRegistration, 'actual inlet-spanning road support registration');
const neighborhoodSource = citySource.replace('  // The nearby street-network avenue',
  `  for (const c of pier62RoadCuts) {\n${roadRegistration}\n  }\n  // The nearby street-network avenue`);
const neighborhood = buildPark('pier62', neighborhoodSource.replace('  // Pier 25 (Tribeca)',
  `${citySource.slice(chelseaStart, chelseaEnd)}
  for (const number of [64, 61]) {
    const p = WATERFRONT_PIERS.find(p => p.name.startsWith('Pier ' + number + ' '));
    if (!p) throw Error('missing neighboring pier ' + number);
    kinds[p.kind](pierFrame(p), p);
  }
  // Pier 25 (Tribeca)`));
const output = { method: '720 native 1/120 s steps; bounded production buildPark(pier62); stock tuning; no dynamic world',
  node: process.version, tickConvention: 'zero-based tick; elapsed seconds = (tick + 1) / 120',
  sourceSHA256: Object.fromEntries(['js/city-grid.js', 'js/euc-terrain.js', 'js/euc/simulation/EucController.js',
    'js/euc/data/tuning.js', 'tests/park-terrain.test.mjs', 'tests/euc-pier62-trace-diagnosis.test.mjs'].map(file => [file,
    createHash('sha256').update(readFileSync(new URL('../' + file, import.meta.url))).digest('hex')])),
  physicalFingerprint: physicalFingerprint(built), neighborhoodFingerprint: physicalFingerprint(neighborhood), runs: [] };

function replay(site, { flags = true, speed = 4, throttle = 1, afterLanding = null, adjacentPiers = false } = {}) {
  const geometry = adjacentPiers ? neighborhood : built;
  const native = new NycTerrainSampler({ tops: geometry.rideTops, boxes: geometry.rideSolids, shoreRails: true });
  const sampler = flags ? native : new Proxy(native, { get(target, key) {
    if (key === 'transitionAt' || key === 'restartsAtRest') return () => false;
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const spawn = { position: position(site.u, site.s), headingY: theta };
  const c = new EucController(sampler, { spawn });
  assert.equal(c.reset(spawn, speed), true);
  const pose = createPose(), rows = [], events = [], trajectory = [];
  let tick = -1, advance = null, landedOnce = false, wasBlocked = false, insideAdvance = false;
  const state = () => ({ x: c.x, y: c.y, z: c.z, ...local(c.x, c.z), heading: c.headingY, speed: c.speed,
    vy: c.verticalVelocity, airborne: c.airborne, groundY: c.groundY, normal: { ...c.ground.normal },
    feature: native.topAt(c.x, c.z, false, c.y)?.capabilities?.feature ?? null,
    transition: sampler.transitionAt(c.x, c.z, c.y), comeBack: c.inComeBackAir,
    remainingAutomaticYaw: c.comeBackTurn, landings: c.landings, quality: c.landingQuality,
    impact: c.landingImpact, misalignment: c.landingMisalignment, score: c.landingScore,
    blocked: c.blocked, collisionImpact: c.collisionImpact, crashed: c.crashed,
    crashCause: c.crashCause, crashes: c.crashes, invulnerable: c.invulnerableTimer });
  const event = (type, details = {}) => events.push({ tick, step: tick + 1, seconds: (tick + 1) * DT, type, ...details });
  // Wrap native methods on this diagnostic instance only. Arguments, return values and state writes stay native.
  for (const method of ['leaveGround', 'startComeBack', 'land', 'comeBackTouchdown', 'beginCrash', 'respawn', 'clipDynamicHeading']) {
    const original = c[method];
    c[method] = function (...args) {
      const before = state(), result = original.apply(this, args), after = state();
      event(method, { args, before, after, result, ...(method === 'beginCrash' ? { advance } : {}) });
      return result;
    };
  }
  const nativeExcess = c.excessAt;
  c.excessAt = function (...args) {
    const value = nativeExcess.apply(this, args);
    if (insideAdvance) advance.excesses.push({ args, excess: value, probe: structuredClone(this.probe) });
    return value;
  };
  const nativeWheel = native.raycastWheelObstacle.bind(native);
  // Preserve the exact query, including its caller-owned output. A second observational query identifies the body.
  native.raycastWheelObstacle = (...args) => {
    const distance = nativeWheel(...args);
    if (insideAdvance && distance !== null) {
      const hit = { normal: {}, inside: false };
      nativeWheel(...args.slice(0, 5), hit);
      advance.hits.push({ origin: { ...args[0] }, direction: { ...args[1] }, maxDistance: args[2], distance,
        hit, body: structuredClone(native.plan.solids[hit.colliderIndex] ?? null) });
    }
    return distance;
  };
  const nativeAdvance = c.advance;
  c.advance = function (...args) {
    advance = { args, before: state(), excesses: [], hits: [] };
    insideAdvance = true;
    const result = nativeAdvance.apply(this, args);
    insideAdvance = false;
    advance.result = result; advance.after = state();
    if (c.blocked && !c.crashed && (!wasBlocked || result.impactSpeed >= c.tuning.obstacleCrashSpeed)) event('blockedAdvance', { advance });
    wasBlocked = c.blocked;
    return result;
  };
  for (tick = 0; tick < 720; tick++) {
    advance = null;
    const input = landedOnce && afterLanding !== null ? afterLanding : throttle;
    c.step(DT, { ...NEUTRAL_ACTIONS, throttle: input });
    c.writePose(pose);
    trajectory.push([pose.x, pose.y, pose.z, pose.headingY, pose.speed, pose.airHeight, c.crashed, c.isGrounded]);
    rows.push({ tick, seconds: (tick + 1) * DT, throttle: input, ...state() });
    if (c.touchedDown) { landedOnce = true; event('finalizedLanding', { state: state() }); }
  }
  const result = { site: site.id, flags, initialSpeed: speed, throttle, afterLanding, adjacentPiers, events, rows,
    dynamicWorld: c.dynamicWorld ?? null, clippedHeadingCalls: events.filter(e => e.type === 'clipDynamicHeading').length,
    spins: c.snapshot().spins,
    trajectorySHA256: hash(trajectory), end: c.snapshot(), tuning: {
      obstacleCrashSpeed: c.tuning.obstacleCrashSpeed, landingCrashScore: c.tuning.landingCrashScore,
      crashRecoverEarliestSeconds: c.tuning.crashRecoverEarliestSeconds, maxStepUp: c.tuning.maxStepUp } };
  output.runs.push(result);
  return result;
}

for (const site of sites) test(`${site.id}: native 720-step flags/suppressed, full/fast and matched-input diagnosis`, t => {
  for (const flags of [true, false]) for (const [speed, throttle] of [[4, 1], [9, 0], [4, 0], [9, 1]]) {
    const run = replay(site, { flags, speed, throttle });
    assert.equal(run.rows.length, 720);
    assert.ok(run.rows.every(r => [r.x, r.y, r.z, r.speed, r.vy].every(Number.isFinite)));
    if (flags && (speed === 9 || throttle === 1)) {
      const launch = run.events.find(e => e.type === 'startComeBack');
      const landing = run.events.find(e => e.type === 'finalizedLanding');
      assert.ok(launch && landing, 'the actual quarter must launch and return to its own face');
      assert.equal(landing.state.feature, site.id === 'pier62' ? 'pier62-quarter' : 'pier62-far-quarter');
      assert.equal(landing.state.quality, 'clean');
      assert.equal(landing.state.crashed, false);
      assert.equal(landing.state.collisionImpact, 0);
      assert.equal(landing.state.comeBack, false);
      assert.equal(landing.state.remainingAutomaticYaw, 0);
      assert.ok(Math.abs(Math.abs(landing.state.heading - theta) - Math.PI) < 1e-12);
      assert.ok(!run.events.some(e => e.type === 'beginCrash' && e.tick <= landing.tick));
      for (const contact of run.events.filter(e => e.type === 'blockedAdvance' && e.tick <= landing.tick)) {
        // On the last descending tick, the native air sweep may meet its landing support and clip XZ before land().
        // That is expected zero-impact support interception, not a body strike or dynamic-heading admission failure.
        assert.equal(contact.advance.args[4], true, 'support clipping belongs to the descending flight');
        assert.equal(contact.advance.result.impactSpeed, 0);
        assert.equal(contact.advance.hits.length, 0);
        assert.equal(contact.tick, landing.tick, 'contact is resolved into the accepted landing in this same step');
      }
      assert.equal(run.clippedHeadingCalls, 0, 'these native traces have no dynamic admission/world');
      assert.equal(run.spins, 0, 'automatic turn does not invent player-180 credit');
    }
    t.diagnostic(`${site.id} flags=${flags} speed=${speed} throttle=${throttle}: `
      + run.events.filter(e => ['startComeBack', 'finalizedLanding', 'beginCrash'].includes(e.type))
        .map(e => `${e.type}@${e.tick} ${(e.state ?? e.after).quality}/${(e.state ?? e.after).crashCause}`).join(', '));
  }
});

for (const site of sites) test(`${site.id}: later obstacle is separate from clean return; deliberate release/brake preserves a ride-out`, () => {
  for (const flags of [true, false]) for (const [speed, throttle] of [[4, 1], [9, 0]]) {
    const run = replay(site, { flags, speed, throttle, adjacentPiers: true });
    if (!flags || speed !== 4) continue;
    const landings = run.events.filter(e => e.type === 'finalizedLanding'), crash = run.events.find(e => e.type === 'beginCrash');
    assert.equal(landings.length, 2, 'return to face, followed much later by an ordinary drop');
    assert.equal(landings[0].state.quality, 'clean');
    assert.ok(crash.tick > landings[0].tick + 120, 'crash is not the come-back landing');
    assert.equal(crash.args[0], 'obstacle');
    assert.equal(crash.before.comeBack, false);
    assert.equal(crash.before.transition, false);
    assert.ok(crash.advance.result.impactSpeed >= run.tuning.obstacleCrashSpeed);
    assert.equal(crash.advance.hits.length, 0, 'support-height discontinuity, not a swept-body hit');
    const [full, axisX, axisZ] = crash.advance.excesses;
    assert.ok(full.excess > run.tuning.maxStepUp);
    if (site.id === 'pier62-far') {
      assert.equal(crash.tick, 506); assert.equal(landings[0].tick, 173); assert.equal(landings[1].tick, 505);
      assert.equal(crash.before.y, .12);
      assert.equal(full.excess, .36); assert.equal(axisX.excess, .36); assert.equal(axisZ.excess, .36);
      assert.equal(full.probe.surface, 'grass');
      assert.equal(crash.advance.result.distance, 0);
      assert.ok(Math.abs(crash.before.s + 21.3) < .001);
    } else {
      assert.equal(crash.tick, 715); assert.equal(landings[0].tick, 156); assert.equal(landings[1].tick, 561);
      assert.ok(Math.abs(crash.before.y + 2.32) < 1e-12);
      assert.ok(Math.abs(full.excess - 2.44) < 1e-12);
      assert.equal(axisX.excess, 0); assert.equal(axisZ.excess, full.excess);
      assert.equal(full.probe.height, .12);
      assert.equal(crash.advance.result.keptZ, 0, 'native axis clipping stops the deck-edge crossing');
      assert.ok(crash.advance.result.keptX > 0, 'native tangent slide remains available');
    }
  }
  for (const afterLanding of [0, -1]) {
    const run = replay(site, { afterLanding, adjacentPiers: true });
    const landing = run.events.find(e => e.type === 'finalizedLanding');
    assert.ok(landing && landing.state.quality === 'clean');
    assert.equal(run.end.crashes, 0, 'bounded six-second deliberate ride-out, not immunity under unlimited throttle');
    assert.ok(run.rows.some(r => r.tick > landing.tick && r.s < landing.state.s - 1), 'actually rides down the face');
  }
});

test('the same later contact crashes a freshly placed native rider with transition flags either enabled or suppressed', () => {
  for (const site of sites) {
    const run = output.runs.find(r => r.site === site.id && r.adjacentPiers && r.flags && r.initialSpeed === 4 && r.throttle === 1 && r.afterLanding === null)
      ?? replay(site, { adjacentPiers: true });
    const crash = run.events.find(e => e.type === 'beginCrash'), p = crash.advance.before, results = [];
    for (const flags of [true, false]) {
      const s = new NycTerrainSampler({ tops: neighborhood.rideTops, boxes: neighborhood.rideSolids, shoreRails: true });
      if (!flags) s.transitionAt = s.restartsAtRest = () => false;
      const spawn = { position: { x: p.x, y: p.y, z: p.z }, headingY: p.heading };
      const c = new EucController(s, { spawn }); c.reset(spawn, p.speed);
      c.step(DT, { ...NEUTRAL_ACTIONS, throttle: 1 });
      assert.equal(c.crashed, true); assert.equal(c.snapshot().crashCause, 'obstacle');
      results.push(c.snapshot());
    }
    assert.deepEqual(results[0], results[1], `${site.id}: an existing obstacle, not a transition-state-dependent failure`);
  }
});

test('open high-speed run-ups retain bounded come-back air without a global city speed limit', () => {
  for (const site of sites) {
    const run = replay(site, { speed: 23, throttle: 0, adjacentPiers: true });
    const launch = run.events.find(e => e.type === 'startComeBack');
    assert.ok(launch.before.speed > SKATE_TRANSITION.comeBackMaxVerticalSpeed * 2, 'real high-speed run-up');
    assert.equal(launch.after.vy, SKATE_TRANSITION.comeBackMaxVerticalSpeed);
    assert.equal(launch.after.speed, SKATE_TRANSITION.comeBackDriftSpeed);
    assert.equal(run.events.find(e => e.type === 'finalizedLanding').state.quality, 'clean');
    assert.ok(Math.abs(run.tuning.maxStepUp - .216) < 1e-12, 'stock step height, not an easier lawn/kerb climb');
  }
});

test('accepted pre-adaptation controller has the same suppressed native 720-step trajectories on the same geometry', async t => {
  const old = file => execFileSync('git', ['show', `ca9a67d3ad3767aee464bb6d2f7f4fb7a402be00:${file}`],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let sources;
  try { sources = [old('js/euc/simulation/eucStepPrimitives.js'), old('js/euc/simulation/EucController.js')]; }
  catch { t.skip('accepted implementation history unavailable in standalone export'); return; }
  const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const primitives = url(sources[0]);
  const source = sources[1].replace(/from '([^']+)'/g, (_all, spec) =>
    `from '${spec === './eucStepPrimitives.js' ? primitives : new URL('../js/euc/simulation/' + spec, import.meta.url).href}'`);
  const Legacy = (await import(url(source))).EucController;
  output.acceptedController = { revision: 'ca9a67d3ad3767aee464bb6d2f7f4fb7a402be00', comparisons: [] };
  for (const site of sites) for (const [speed, throttle] of [[4, 1], [9, 0]]) {
    const s = new NycTerrainSampler({ tops: neighborhood.rideTops, boxes: neighborhood.rideSolids, shoreRails: true });
    s.transitionAt = s.restartsAtRest = () => false;
    const spawn = { position: position(site.u, site.s), headingY: theta }, c = new Legacy(s, { spawn });
    c.reset(spawn, speed);
    const pose = createPose(), rows = [];
    for (let tick = 0; tick < 720; tick++) {
      c.step(DT, { ...NEUTRAL_ACTIONS, throttle }); c.writePose(pose);
      rows.push([pose.x, pose.y, pose.z, pose.headingY, pose.speed, pose.airHeight, c.crashed, c.isGrounded]);
    }
    const run = output.runs.find(r => r.site === site.id && r.adjacentPiers && !r.flags && r.initialSpeed === speed && r.throttle === throttle)
      ?? replay(site, { adjacentPiers: true, flags: false, speed, throttle });
    assert.equal(hash(rows), run.trajectorySHA256, 'same-engine bit-identical accepted-controller trajectory');
    assert.deepEqual(c.snapshot(), run.end);
    output.acceptedController.comparisons.push({ site: site.id, speed, throttle, trajectorySHA256: hash(rows), identical: true });
  }
});

test('saved real-city browser records distinguish crash history from six-second current state', t => {
  let candidate, baseline;
  try {
    candidate = JSON.parse(readFileSync(new URL('../../qa-artifacts/park-camera2-park-candidate-webgpu.json', import.meta.url)));
    baseline = JSON.parse(readFileSync(new URL('../../qa-artifacts/park-camera2-park-baseline-webgpu.json', import.meta.url)));
  } catch { t.skip('private saved browser evidence unavailable'); return; }
  output.browserComparison = [];
  for (const site of sites) for (const [mode, speed, throttle] of [['full', 4, 1], ['fast', 9, 0]]) for (const flags of [true, false]) {
    const before = baseline.records.find(r => r.site === site.id).cases.find(r => r.mode === mode);
    const captured = candidate.records.find(r => r.site === site.id).cases.find(r => r.mode === mode);
    const after = flags ? captured : captured.unflaggedControl;
    const run = output.runs.find(r => r.site === site.id && r.adjacentPiers && r.flags === flags && r.initialSpeed === speed && r.throttle === throttle && r.afterLanding === null)
      ?? replay(site, { adjacentPiers: true, flags, speed, throttle });
    const positionError = Math.hypot(...['x', 'y', 'z'].map(k => run.end.position[k] - after.end.position[k]));
    assert.ok(positionError < 1e-6, `${site.id}/${mode}: bounded native end agrees with saved full-city state`);
    assert.equal(run.end.crashes, after.end.crashes); assert.equal(run.end.crashed, after.end.crashed);
    assert.ok(Math.abs(run.end.speed - after.end.speed) < 1e-6);
    if (mode === 'fast') assert.equal(run.trajectorySHA256, after.trajectorySHA256, 'all 720 fast rows are browser-identical');
    else { assert.equal(before.end.crashes, 1); assert.equal(before.end.crashed, false); assert.equal(before.end.crashCause, 'obstacle'); }
    output.browserComparison.push({ site: site.id, mode, flags, baseline: {
      crashed: before.end.crashed, crashes: before.end.crashes, cause: before.end.crashCause, state: before.end.state },
      candidate: { crashed: after.end.crashed, crashes: after.end.crashes, cause: after.end.crashCause },
      nativePositionErrorMetres: positionError, nativeSpeedError: run.end.speed - after.end.speed,
      trajectoryHashMatches: run.trajectorySHA256 === after.trajectorySHA256 });
  }
});

test.after(() => {
  if (!process.env.PARK_DIAG_OUTPUT) return;
  writeFileSync(process.env.PARK_DIAG_OUTPUT, JSON.stringify(output, null, 2) + '\n');
  const concise = r => ({ tick: r.tick, s: r.s, u: r.u, y: r.y, speed: r.speed, vy: r.vy,
    feature: r.feature, comeBack: r.comeBack, quality: r.quality, impact: r.impact, score: r.score,
    misalignment: r.misalignment, collisionImpact: r.collisionImpact, crashed: r.crashed, crashes: r.crashes });
  writeFileSync(process.env.PARK_DIAG_OUTPUT.replace(/\.json$/, '.summary.json'), JSON.stringify(output.runs.map(r => ({
    site: r.site, flags: r.flags, speed: r.initialSpeed, throttle: r.throttle, afterLanding: r.afterLanding, adjacentPiers: r.adjacentPiers,
    trajectorySHA256: r.trajectorySHA256, crashed: r.end.crashed, crashes: r.end.crashes,
    events: r.events.filter(e => ['startComeBack', 'leaveGround', 'finalizedLanding', 'beginCrash', 'respawn'].includes(e.type))
      .map(e => ({ tick: e.tick, seconds: e.seconds, type: e.type, args: e.args,
        before: e.before && concise(e.before), after: concise(e.state ?? e.after),
        advance: e.type === 'beginCrash' ? e.advance : undefined })) })), null, 2) + '\n');
  writeFileSync(process.env.PARK_DIAG_OUTPUT.replace(/\.json$/, '.compact.txt'), output.runs.map(r =>
    `${r.site} flags=${r.flags} speed=${r.initialSpeed} throttle=${r.throttle} afterLanding=${r.afterLanding} adjacent=${r.adjacentPiers}`
    + ` end=${JSON.stringify(r.end.position)} crashes=${r.end.crashes} down=${r.end.crashed} clipped=${r.clippedHeadingCalls}\n`
    + r.events.filter(e => ['startComeBack', 'leaveGround', 'finalizedLanding', 'beginCrash'].includes(e.type) || (e.type === 'respawn' && e.result === true))
      .map(e => `  ${e.type} tick=${e.tick} time=${e.seconds} ${JSON.stringify(concise(e.state ?? e.after))}`).join('\n')).join('\n\n') + '\n');
  writeFileSync(process.env.PARK_DIAG_OUTPUT.replace(/\.json$/, '.comparison.json'), JSON.stringify({
    sources: output.sourceSHA256, acceptedController: output.acceptedController,
    browser: output.browserComparison,
    returnClipping: output.runs.filter(r => r.flags).map(r => ({ site: r.site, speed: r.initialSpeed, throttle: r.throttle,
      afterLanding: r.afterLanding, adjacentPiers: r.adjacentPiers, dynamicHeadingClips: r.clippedHeadingCalls,
      contacts: r.events.filter(e => e.type === 'blockedAdvance' && e.tick <= (r.events.find(e => e.type === 'finalizedLanding')?.tick ?? -1))
        .map(e => ({ tick: e.tick, seconds: e.seconds, airborne: e.advance.args[4],
          intended: e.advance.args.slice(0, 2), result: e.advance.result, hits: e.advance.hits,
          excesses: e.advance.excesses.map(p => ({ args: p.args, excess: p.excess })) })) })) }, null, 2) + '\n');
});
