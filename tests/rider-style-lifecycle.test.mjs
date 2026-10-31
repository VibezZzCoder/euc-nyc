// Exercise the actual native entity, generated appearances and pinned Three geometry, without a browser/GPU.
// Only city uniforms and light placement are replaced: these tests assert physics/lifecycle, not rendering quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const root = new URL('../', import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three' || specifier === 'three/webgpu') {
      return { url: new URL('vendor/three/build/three.core.js', root).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === new URL('js/tsl-materials.js', root).href) {
      return { format: 'module', source: 'export const cityUniforms = { uInteriorGlow: { value: 0 } };', shortCircuit: true };
    }
    if (url === new URL('js/vehicle-lights.js', root).href) {
      return { format: 'module', source: `import { Object3D } from 'three';
        export const EUC_HEADLIGHT = {};
        export const headlightBeamScale = () => 0;
        export const placeEucHeadlight = () => {};
        export const createEucHeadlight = () => Object.assign(new Object3D(), { target: new Object3D() });`, shortCircuit: true };
    }
    return next(url, context);
  },
});

const THREE = await import('../vendor/three/build/three.core.js');
const { createEucEntity, prepareEucRider, RIDERS, PLAYABLE_RIDERS, isPlayableRider, NYC_TUNING } = await import('../js/euc-rider.js');
const { EucController, createPose } = await import('../js/euc/simulation/EucController.js');
const { NEUTRAL_ACTIONS } = await import('../js/euc/input/actions.js');
const { CHARACTERS, rideStyleFor } = await import('../js/euc/data/riders.js');
const { machineForCharacter } = await import('../js/euc/data/machines.js');
const { DRUNK_STYLE, SOBER_STYLE } = await import('../js/euc/data/rideStyles.js');
const { EUC } = await import('../js/euc/data/tuning.js');
const { appearanceResourceStats } = await import('../js/euc/render/appearanceLoader.js');
const DT = 1 / 120;
const flat = { sampleGround(_x, _z, out) {
  Object.assign(out, { height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false }); return out;
}, raycast() { return null; } };
async function entity(id = 'cool-rider') {
  const appearance = await prepareEucRider(id), scene = new THREE.Scene();
  return { e: createEucEntity(scene, flat, { x: 0, z: 0, rider: id, appearance }), scene };
}
const noGPU = () => {};
function motion(e) {
  const pose = createPose(); e.controller.writePose(pose);
  return Object.fromEntries(['x', 'y', 'z', 'headingY', 'speed', 'wheelSpin', 'airborne', 'crashBlend',
    'recoverBlend', 'ragdoll', 'ragdollPositions', 'ragdollPrevious'].filter(k => k in pose).map(k => [k, structuredClone(pose[k])]));
}

test('compatibility metadata is generated-source-backed, ordered and excludes cop from playable choices', () => {
  assert.deepEqual(PLAYABLE_RIDERS, CHARACTERS.map(c => c.id));
  assert.equal(PLAYABLE_RIDERS.length, 11); assert.equal(isPlayableRider('cop'), false);
  for (const row of CHARACTERS) {
    assert.equal(RIDERS[row.id].name, row.name); assert.equal(RIDERS[row.id].swatch, row.swatch);
    assert.equal(RIDERS[row.id].machine, machineForCharacter(row.id));
    assert.equal(isPlayableRider(row.id), true); assert.ok(Object.isFrozen(RIDERS[row.id]));
  }
  assert.deepEqual(NYC_TUNING, {}, 'stock physical tuning remains untouched');
});

test('startup requires explicit preparation, rejects invalid/cancelled IDs, measures construction and releases pixels', async () => {
  assert.throws(() => createEucEntity(new THREE.Scene(), flat, { x: 0, z: 0 }), /not prepared/);
  for (const id of ['cop', '__proto__', 'unknown', '../rider']) await assert.rejects(prepareEucRider(id), /Unknown playable rider/);
  await assert.rejects(prepareEucRider('cool-rider', { signal: AbortSignal.abort() }), { name: 'AbortError' });
  const { e, scene } = await entity();
  assert.equal(e.riderId, 'cool-rider'); assert.equal(e.controller.rideStyle, SOBER_STYLE);
  assert.equal(e.mesh.parent, scene); assert.ok(e.constructionMs > 0);
  assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
  await e.dispose(); assert.equal(scene.children.length, 0);
});

test('every actual roster entity matches stock fixed-step physics with only its native ride style installed', async t => {
  for (const id of PLAYABLE_RIDERS) {
    const { e } = await entity(id);
    try {
      const native = new EucController(flat); native.setRideStyle(rideStyleFor(id));
      assert.equal(e.controller.rideStyle, id === 'drunkard' ? DRUNK_STYLE : SOBER_STYLE);
      for (let step = 0; step < 720; step++) {
        const keys = { forward: 0.3, right: step > 500 ? 0.1 : 0, up: step >= 200 && step < 260, boost: step < 200 };
        const hop = step === 200;
        native.step(DT, { ...NEUTRAL_ACTIONS, throttle: keys.forward, steer: keys.right,
          crouch: keys.boost, hop, hopHeld: keys.up });
        e.update(DT, keys);
      }
      assert.deepEqual(e.controller.snapshot(), native.snapshot(), id);
      assert.equal(appearanceResourceStats().cachedPixelBytes, 0, id);
      t.diagnostic(`${id}: synchronous entity construction ${e.constructionMs.toFixed(1)} ms (Node, no GPU)`);
    } finally { await e.dispose(); }
  }
  const cop = createEucEntity(new THREE.Scene(), flat, { x: 0, z: 0, rider: 'cop' });
  assert.equal(cop.controller.rideStyle, SOBER_STYLE);
  await assert.rejects(cop.prepareRider('cop', { compile: noGPU }), /Unknown playable rider/);
  await cop.dispose();
});

test('real offscene candidate retains active until commit; style, headlight, pose/events/tricks change together', async () => {
  const { e, scene } = await entity('drunkard');
  try {
    for (let i = 0; i < 700; i++) e.update(DT, { forward: 0.3 });
    assert.notEqual(e.controller.styleSway, 0);
    e.update(DT / 2, { forward: 0.3 });
    e.events.push({ type: 'stumble', rider: 'drunkard' }); e.tricks.announce('Old trick');
    const oldRig = e.rig, lamp = e.headlight, before = motion(e);
    let compiled;
    const ticket = await e.prepareRider('trollina', { async compile(candidate, { id, signal }) {
      compiled = candidate;
      assert.equal(candidate.group.parent, null, 'not added to live scene');
      assert.equal(candidate.group.visible, true, 'available for compile in the renderer owner’s staging scene');
      assert.equal(id, 'trollina'); assert.equal(signal.aborted, false);
      assert.equal(e.rig, oldRig); assert.equal(e.riderId, 'drunkard');
      assert.equal(e.controller.rideStyle, DRUNK_STYLE); assert.deepEqual(motion(e), before);
    } });
    assert.equal(e.mesh, oldRig.group); assert.equal(e.tricks.label, 'Old trick');
    assert.equal(ticket.commit(), true);
    assert.equal(e.rig, compiled.rig); assert.equal(e.mesh.parent, scene); assert.equal(oldRig.group.parent, null);
    assert.equal(e.riderId, 'trollina'); assert.equal(e.label, RIDERS.trollina.name); assert.equal(e.headlight, lamp);
    assert.equal(e.controller.rideStyle, SOBER_STYLE); assert.deepEqual(motion(e), before);
    for (const field of ['styleSway', 'styleYaw', 'styleRoll', 'styleStumble']) assert.equal(e.pose[field], 0, field);
    assert.equal(e.tricks.label, ''); assert.deepEqual(e.drainEvents(), []);
    e.update(0, {});
    for (const field of ['styleSway', 'styleYaw', 'styleRoll', 'styleStumble']) assert.equal(e.pose[field], 0, `old interpolation: ${field}`);
    assert.equal(e.pose.x, e.controller.x); assert.equal(e.pose.speed, e.controller.speed);
    assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
  } finally { await e.dispose(); }
});

test('switching during airborne/crashed states preserves native motion and resets old trick/recovery edges', async () => {
  for (const phase of ['airborne', 'crashed']) {
    const { e } = await entity('cool-rider');
    try {
      if (phase === 'airborne') {
        for (let i = 0; i < 90; i++) e.update(DT, { boost: true });
        e.update(DT, { up: true });
        for (let i = 0; i < 80 && e.controller.groundClearance <= 0; i++) e.update(DT, { up: true });
        assert.ok(e.controller.groundClearance > 0);
      } else {
        e.controller.hardKnock(1, 0); e.update(DT, {}); assert.equal(e.controller.crashed, true);
      }
      const before = motion(e), controller = e.controller, serial = controller.placementSerial;
      e.tricks.announce('Old trick');
      const ticket = await e.prepareRider('drunkard', { compile: noGPU });
      assert.equal(ticket.commit(), true);
      assert.equal(e.controller, controller); assert.equal(controller.placementSerial, serial);
      assert.deepEqual(motion(e), before); assert.equal(controller.rideStyle, DRUNK_STYLE);
      assert.equal(e.tricks.label, ''); assert.deepEqual(e.drainEvents(), []);
      e.update(0, {}); assert.deepEqual(e.drainEvents(), [], 'no finalized step means no events');
      if (phase === 'airborne') {
        for (let i = 0; i < 250; i++) e.update(DT, {});
        assert.equal(e.tricks.label, '', 'the previous rider’s flight is not re-awarded');
      } else {
        e.update(DT, {}); assert.ok(!e.drainEvents().some(event => event.type === 'crash'), 'existing crash is not replayed');
      }
    } finally { await e.dispose(); }
  }
});

test('native stumble edges emit exactly once per finalized step, reset cleanly on placement/recovery/swap', async () => {
  const { e } = await entity('drunkard');
  try {
    let emitted = 0, sawStumble = false;
    for (let i = 0; i < 5000 && emitted < 2; i++) {
      const before = e.controller.stumbleCount;
      e.update(DT, { forward: 0.3 });
      const events = e.drainEvents().filter(event => event.type === 'stumble');
      assert.equal(events.length, e.controller.stumbleCount > before ? 1 : 0);
      emitted += events.length;
      sawStumble ||= e.pose.styleStumble > 0;
      e.update(0, {}); assert.deepEqual(e.drainEvents(), [], 'render-only update cannot replay an edge');
    }
    assert.equal(emitted, 2); assert.ok(sawStumble);
    assert.equal(e.placeAt(0, 0), true);
    e.update(DT, {}); assert.ok(!e.drainEvents().some(event => event.type === 'stumble'));
    for (const field of ['styleSway', 'styleYaw', 'styleRoll', 'styleStumble']) assert.equal(e.pose[field], 0);
    e.controller.hardKnock(1, 0); e.update(DT, {}); e.drainEvents();
    e.controller.crashTime = EUC.crashRecoverEarliestSeconds;
    e.update(DT, { resetPressed: true });
    assert.equal(e.controller.crashed, false);
    assert.deepEqual(e.drainEvents().map(event => event.type), ['recover']);
    const ticket = await e.prepareRider('cool-rider', { compile: noGPU }); ticket.commit();
    for (let i = 0; i < 1000; i++) e.update(DT, { forward: 0.3 });
    assert.ok(!e.drainEvents().some(event => event.type === 'stumble'));
  } finally { await e.dispose(); }
});

test('real compile failure and graphics stop retain active and drain candidate before disposing active', async () => {
  const { e, scene } = await entity();
  const oldRig = e.rig;
  await assert.rejects(e.prepareRider('trollina', { compile() { throw new Error('compile failed'); } }), /compile failed/);
  assert.equal(e.rig, oldRig); assert.equal(e.mesh.parent, scene); assert.equal(e.controller.rideStyle, SOBER_STYLE);
  let complete, entered;
  const start = new Promise(resolve => { entered = resolve; });
  const waiting = e.prepareRider('drunkard', { compile() { entered(); return new Promise(resolve => { complete = resolve; }); } });
  const rejected = assert.rejects(waiting, { name: 'AbortError' });
  await start;
  const disposal = e.dispose(); assert.equal(e.dispose(), disposal);
  assert.equal(oldRig.group.parent, scene, 'active resources retained until compile settles');
  const before = e.controller.snapshot(); e.update(1, { forward: true }); assert.deepEqual(e.controller.snapshot(), before);
  complete(); await rejected; await disposal;
  assert.equal(scene.children.length, 0); assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
});

test('same special-rider rebuild clears style history without resetting speed, placement or camera contract', async () => {
  const { e } = await entity('drunkard');
  try {
    for (let i = 0; i < 800; i++) e.update(DT, { forward: 0.3 });
    assert.notEqual(e.controller.styleSway, 0);
    const before = motion(e), serial = e.controller.placementSerial;
    const camera = { distance: e.chaseDistance, height: e.chaseHeight, offset: e.cameraTargetOffset.toArray() };
    const ticket = await e.prepareRider('drunkard', { compile: noGPU });
    assert.equal(ticket.commit(), true);
    assert.deepEqual(motion(e), before); assert.equal(e.controller.placementSerial, serial);
    assert.equal(e.controller.stylePhaseA, 0); assert.equal(e.controller.styleMetres, 0);
    for (const key of ['styleSway', 'styleYaw', 'styleRoll', 'styleStumble']) assert.equal(e.pose[key], 0);
    assert.deepEqual({ distance: e.chaseDistance, height: e.chaseHeight, offset: e.cameraTargetOffset.toArray() }, camera);
  } finally { await e.dispose(); }
});

test('20/24/30/60/120 Hz callbacks preserve six-step catch-up and finalized native styled physics', async () => {
  const native = new EucController(flat); native.setRideStyle(DRUNK_STYLE);
  const entities = [];
  try {
    for (const hz of [20, 24, 30, 60, 120]) entities.push({ hz, ...(await entity('drunkard')) });
    for (let second = 0; second < 5; second++) {
      const keys = { forward: 0.3, right: second > 3 ? 0.1 : 0, boost: second === 0, up: second === 1 };
      for (let i = 0; i < 120; i++) native.step(DT, { ...NEUTRAL_ACTIONS, throttle: keys.forward, steer: keys.right,
        crouch: keys.boost, hop: second === 1 && i === 0, hopHeld: keys.up });
      for (const { e, hz } of entities) {
        for (let i = 0; i < hz; i++) e.update(1 / hz, keys);
        assert.deepEqual(e.controller.snapshot(), native.snapshot(), `${hz} Hz after ${second + 1} seconds`);
      }
    }
  } finally { await Promise.all(entities.map(({ e }) => e.dispose())); }
});

test('actual candidate geometry/material/texture ownership is bounded and disposed after compile failures/cancellation', async () => {
  const { e, scene } = await entity();
  const staging = new THREE.Scene();
  const watch = group => {
    const resources = new Set(), disposed = new Set();
    group.traverse(node => {
      if (node.geometry) resources.add(node.geometry);
      for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
    });
    for (const resource of resources) resource.addEventListener('dispose', () => disposed.add(resource));
    return { resources, disposed };
  };
  const active = watch(e.mesh);
  try {
    for (let round = 0; round < 3; round++) {
      const abort = new AbortController();
      let candidate, tracked, endCompile, entered;
      const compiling = new Promise(resolve => { entered = resolve; });
      const pending = e.prepareRider('drunkard', { signal: abort.signal, compile(resource) {
        candidate = resource; tracked = watch(candidate.group);
        staging.add(candidate.group); entered();
        return new Promise(resolve => { endCompile = resolve; });
      } });
      const rejected = assert.rejects(pending, { name: 'AbortError' });
      await compiling;
      assert.ok(tracked.resources.size > 20); assert.equal(scene.children.filter(o => o.name === 'riding-rig').length, 1);
      assert.equal(staging.children.length, 1); assert.equal(active.disposed.size, 0);
      abort.abort(); assert.equal(tracked.disposed.size, 0, 'compile still owns the candidate');
      endCompile(); await rejected;
      assert.equal(staging.children.length, 0, 'cancelled candidate detaches even if compile owner left it attached');
      assert.equal(tracked.disposed.size, tracked.resources.size, 'all visible candidate resources disposed');
      assert.equal(active.disposed.size, 0, 'active geometry/materials/textures remain live');
      assert.equal(appearanceResourceStats().cachedPixelBytes, 0);
    }
  } finally { await e.dispose(); }
  assert.equal(active.disposed.size, active.resources.size);
});

test('candidate presentation failure at commit preserves active identity/style/pose and can be disposed', async () => {
  const { e } = await entity('drunkard');
  try {
    for (let i = 0; i < 700; i++) e.update(DT, { forward: 0.3 });
    const before = motion(e), oldRig = e.rig;
    e.tricks.announce('Retained');
    const ticket = await e.prepareRider('trollina', { compile(candidate) {
      candidate.rig.apply = () => { throw new Error('presentation failed'); };
    } });
    assert.throws(() => ticket.commit(), /presentation failed/);
    assert.equal(e.rig, oldRig); assert.equal(e.riderId, 'drunkard');
    assert.equal(e.controller.rideStyle, DRUNK_STYLE); assert.deepEqual(motion(e), before);
    assert.equal(e.tricks.label, 'Retained');
    ticket.dispose(); assert.equal(ticket.valid, false);
  } finally { await e.dispose(); }
});
