const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/nemesis.js'), 'utf8');
const localImport = (path) => import(pathToFileURL(join(__dirname, '..', path)).href);

async function harness({ withCamera = false, withSerial = true } = {}) {
  const [THREE, tsl, brain, chase, swing, { PADDLE }] = await Promise.all([
    localImport('vendor/three/build/three.webgpu.js'), localImport('vendor/three/build/three.tsl.js'),
    localImport('js/nemesis-brain.js'), localImport('js/nemesis-chase.js'), localImport('js/nemesis-swing.js'),
    localImport('js/euc/data/tuning.js'),
  ]);
  let player = { position: new THREE.Vector3(), heading: 0, speed: 0,
    controller: { state: 'riding', crashed: false, ...(withSerial ? { placementSerial: 1 } : {}) } };
  let knocks = 0, acceptsKnock = true, blocked = false;
  player.controller.hardKnock = () => { knocks++; return acceptsKnock; };
  const sweeps = [], swoops = [];
  const nodes = Array.from({ length: 7 }, (_, i) => ({ x: 0, z: (i - 3) * 60 }));
  const network = { nodes, edges: nodes.slice(1).map((node, i) => ({ from: nodes[i], to: node })) };
  const sampler = {
    sampleGround(_x, _z, out, y = 0) { out.height = y; return out; },
    raycast: () => blocked ? .5 : null,
    isOffLimits: () => false,
  };
  const camera = withCamera ? new THREE.PerspectiveCamera(56, 16 / 9, .35, 1000) : undefined;
  // This fixture fixes the drawn paddle face at (0, .35, 0). Real Three matrices and the production relative-motion
  // sweep run unchanged; articulated visuals/material merging are outside this lifecycle/placement test.
  const createRidingRig = () => {
    const group = new THREE.Group(), wheel = new THREE.Group(), body = new THREE.Group(), tyre = new THREE.Object3D();
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshStandardMaterial());
    paddle.name = 'rider-paddle-mesh';
    paddle.position.set(0, .35, -PADDLE.reach * .62);
    group.add(wheel, paddle);
    wheel.add(body, tyre);
    return { group, euc: { group: wheel, body, tyre }, setTrickPose() {}, applySwing() {}, apply() {}, applyStatus() {} };
  };
  const { createNemesis } = loadModule(source, {
    imports: {
      'three/webgpu': THREE, 'three/tsl': tsl,
      'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries: (parts) => parts[0] },
      './euc/simulation/EucController.js': { createPose: () => ({}) },
      './euc/data/tuning.js': { PADDLE }, './euc/render/ridingRig.js': { createRidingRig },
      './euc/render/riderLook.js': { riderLook: () => ({}) }, './euc/render/machineLook.js': { machineLook: () => ({}) },
      './tsl-materials.js': { cityUniforms: { uInteriorGlow: { value: 1 } } },
      './vehicle-lights.js': { headlightBeamScale: () => 1 }, './nemesis-brain.js': brain, './nemesis-chase.js': chase,
      './nemesis-swing.js': { ...swing, sweptHit(...args) { sweeps.push(args); return swing.sweptHit(...args); } },
    },
    filename: 'js/nemesis.js',
  });
  const n = createNemesis({ scene: new THREE.Scene(), sampler, network, getPlayer: () => player, camera });
  const swoop = n.brain.swoop;
  n.brain.swoop = (dt, target, options) => { swoops.push({ target: { ...target }, options }); return swoop(dt, target, options); };
  // Retire the material warm-up, then establish a real seeded, acquired pursuit with a valid drawn-face history.
  n.update(0, false); n.update(0, false);
  n.director.state.phase = 'chasing';
  n.director.state.acquired = true;
  assert.equal(n.spawn(), true);
  n.brain.place(2, .1, 0, 0);
  n.swing.cancel(20);
  n.update(.01, true);
  return {
    n, THREE, camera, sweeps, swoops, rules: chase.CHASE_RULES,
    get player() { return player; }, set player(value) { player = value; },
    get knocks() { return knocks; }, set acceptsKnock(value) { acceptsKnock = value; },
    set blocked(value) { blocked = value; },
  };
}

for (const kind of ['small placement', 'large placement', 'entity replacement', 'controller replacement', 'legacy large jump']) {
  test(`${kind} invalidates cached sight before new coordinates can enter pursuit memory`, async () => {
    const h = await harness({ withSerial: kind !== 'legacy large jump' }), { n } = h;
    const remembered = { ...n.memory.state.lastKnown };
    assert.equal(n.director.state.sees, true, 'prime the cached positive LOS');
    h.blocked = true;
    if (kind === 'entity replacement') h.player = { ...h.player, position: h.player.position.clone() };
    if (kind === 'controller replacement') h.player.controller = { ...h.player.controller };
    h.player.position.set(kind === 'large placement' || kind === 'legacy large jump' ? 50 : 2, 1, 1);
    h.player.heading = 1.5;
    if (kind === 'small placement' || kind === 'large placement') h.player.controller.placementSerial++;
    n.update(.01, true); // well inside the 100 ms sight cache: only invalidation makes this ray run now
    assert.deepEqual(n.memory.state.lastKnown, remembered);
    assert.equal(n.memory.state.searching, true);
    assert.equal(n.director.state.sees, false);
    assert.equal(n.searchlight.target.position.x, remembered.x);
    assert.equal(n.searchlight.target.position.y, remembered.y);
    assert.equal(n.searchlight.target.position.z, remembered.z);
    h.blocked = false;
    n.update(.11, true);
    assert.equal(n.memory.state.lastKnown.x, h.player.position.x, 'genuine new sight can reacquire the placed rider');
    assert.equal(n.memory.state.lastKnown.y, h.player.position.y);
    assert.equal(n.memory.state.lastKnown.heading, h.player.heading);
  });
}

test('a sub-5 m placement clears drawn sweep history, independently of recovery protection', async () => {
  const h = await harness(), { n } = h;
  h.player.position.z = -.8;
  n.update(.01, true); // a harmless idle frame records the previous rider endpoint
  n.swing.state.phase = 'active'; n.swing.state.elapsed = 0;
  h.player.position.z = .8;
  h.player.controller.placementSerial++;
  n.observePlayer(); // same clock-free API available to placement/lifecycle callers
  n.director.state.recovery = 0; // isolate history invalidation from the separate grace-period contact gate
  n.update(.05, true);
  assert.equal(h.sweeps.length, 0, 'there is no swept path across even a small teleport');
  assert.equal(h.knocks, 0);
  h.player.position.z = -.8; // continuous travel on the following frame is a real paddle crossing
  n.update(.05, true);
  assert.equal(h.sweeps.length, 1);
  assert.equal(h.knocks, 1);
  assert.equal(n.director.state.knockdowns, 1);
});

test('rejected controller contact still allows a later valid contact in the same strike', async () => {
  const h = await harness(), { n } = h;
  h.player.position.z = -.8;
  n.update(.01, true);
  n.swing.state.phase = 'active'; n.swing.state.elapsed = 0;
  h.acceptsKnock = false;
  h.player.position.z = .8;
  n.update(.05, true);
  assert.equal(h.knocks, 1);
  assert.equal(n.director.state.knockdowns, 0);
  h.acceptsKnock = true;
  h.player.position.z = -.8;
  n.update(.05, true);
  assert.equal(h.knocks, 2);
  assert.equal(n.director.state.knockdowns, 1);
  h.player.position.z = .8;
  n.update(.05, true);
  assert.equal(h.knocks, 2, 'one successful knockdown per strike');
});

test('frozen crash/get-up observation protects recovery and cancels wind-up without advancing pursuit time', async () => {
  const h = await harness(), { n, rules } = h;
  Object.assign(n.director.state, { knockdowns: 2, unseen: 5, far: 4 });
  n.swing.start();
  const clocks = { ...n.director.state };
  const flight = { ...n.brain.state }, memory = JSON.stringify(n.memory.state);
  h.player.controller.crashed = true;
  h.player.controller.state = 'crashed';
  n.update(90, false);
  assert.equal(n.swing.phase, 'idle', 'do not resume a pre-crash wind-up after a frozen recovery');
  assert.equal(n.swing.state.cooldown, 1, 'cancellation does not spend cooldown while frozen');
  h.player.controller.crashed = false;
  h.player.controller.state = 'recovering';
  h.player.controller.placementSerial++;
  h.player.position.z = 1;
  n.update(90, false);
  assert.deepEqual(n.brain.state, flight);
  assert.equal(JSON.stringify(n.memory.state), memory);
  assert.deepEqual(n.director.state, { ...clocks, recovery: rules.recoverySeconds, unseen: 0, far: 0, sees: false });
  h.blocked = true;
  n.update(.05, true);
  assert.ok(n.director.state.recovery > rules.recoverySeconds - .1);
  assert.equal(n.director.state.unseen, 0);
  assert.equal(n.director.state.far, 0);
  assert.equal(n.director.state.knockdowns, 2);
});

for (const [state, withSerial] of [['recovering', true], ['riding', true], ['recovering', false]]) {
  test(`a recovery missed between callbacks is caught by ${withSerial ? 'placementSerial' : 'controller state'} in ${state}`, async () => {
    const h = await harness({ withSerial }), { n, rules } = h;
    n.swing.cancel(0);
    n.director.state.knockdowns = 2;
    if (withSerial) h.player.controller.placementSerial++;
    h.player.controller.state = state;
    h.player.position.z += .1;
    n.update(.01, true);
    assert.equal(n.swing.phase, 'idle', 'observe the recovery before deciding to start another swing');
    assert.equal(n.director.state.knockdowns, 2);
    assert.ok(Math.abs(n.director.state.recovery - (rules.recoverySeconds - .01)) < 1e-10);
    assert.equal(h.knocks, 0);
  });
}

test('an already committed strike cannot hit during recovery grace after its face history becomes valid again', async () => {
  const h = await harness(), { n } = h;
  n.swing.state.phase = 'active'; n.swing.state.elapsed = 0;
  h.player.controller.placementSerial++;
  h.player.position.z = -.8;
  n.update(.01, false); // a recovery placement observed while frozen; the strike itself has not advanced
  n.update(.01, true); // establish fresh face history, still inside the same committed strike
  h.player.position.z = .8;
  n.update(.05, true);
  assert.equal(n.swing.phase, 'active');
  assert.ok(n.director.state.recovery > 0);
  assert.equal(h.sweeps.length, 0);
  assert.equal(h.knocks, 0);
});

test('an ordinary freeze changes no motion/clocks/memory and rechecks sight before resuming', async () => {
  const h = await harness(), { n } = h;
  const before = { ...n.director.state }, flight = { ...n.brain.state }, swing = { ...n.swing.state };
  const memory = JSON.stringify(n.memory.state);
  n.update(90, false);
  assert.deepEqual(n.director.state, before);
  assert.deepEqual(n.brain.state, flight);
  assert.deepEqual(n.swing.state, swing);
  assert.equal(JSON.stringify(n.memory.state), memory);
  const known = { ...n.memory.state.lastKnown };
  h.blocked = true;
  h.player.position.x += 1; // motion while the cop is frozen need not be a teleport
  n.update(.01, true);
  assert.deepEqual(n.memory.state.lastKnown, known);
  assert.equal(n.memory.state.lastKnown.x, 0, 'resume cannot reuse the pre-freeze positive sight cache');
});

test('the strike orchestration passes remembered intel to flight and searchlight, never a hidden live floor/heading', async () => {
  const h = await harness(), { n } = h;
  n.swing.start();
  n.update(.05, true);
  const known = { ...n.memory.state.lastKnown };
  h.blocked = true;
  h.player.position.set(1, 20, 1);
  h.player.heading = Math.PI;
  n.swing.state.phase = 'active'; n.swing.state.elapsed = 0;
  n.update(.05, true);
  const { target, options } = h.swoops.at(-1);
  assert.equal(options.commit, true);
  assert.equal(target.y, known.y);
  assert.equal(target.heading, known.heading);
  assert.equal(target.x, known.x);
  assert.deepEqual(n.memory.state.lastKnown, known);
  assert.equal(n.searchlight.target.position.y, known.y);
  assert.ok(n.brain.state.y < 1, 'the committed flyer does not climb to the hidden upper floor');
});

test('view checks refresh the supplied camera transform even when rendering has not updated its inverse', async () => {
  const h = await harness({ withCamera: true }), { n, camera, THREE } = h;
  for (const coordinateSystem of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]) {
    for (const reversed of [false, true]) {
      camera.coordinateSystem = coordinateSystem;
      camera._reversedDepth = reversed;
      camera.near = 5; camera.far = 100;
      camera.updateProjectionMatrix();
      n.brain.place(0, 0, 0, 0);
      camera.position.set(0, 1, 10);
      camera.lookAt(0, 1, 0);
      assert.equal(n.inView(), true, `${coordinateSystem}/${reversed}: in front`);
      camera.lookAt(0, 1, 20);
      assert.equal(n.inView(), false, `${coordinateSystem}/${reversed}: turned away without rendering`);
      camera.position.z = 2;
      camera.lookAt(0, 1, 0);
      assert.equal(n.inView(), false, `${coordinateSystem}/${reversed}: inside the near plane`);
    }
  }
});

test('spawn selection respects a newly turned supplied camera before any render submission', async () => {
  const h = await harness({ withCamera: true }), { n, camera } = h;
  n.hide();
  camera.position.set(0, 5, -10);
  camera.lookAt(0, 5, 100);
  camera.updateMatrixWorld();
  camera.lookAt(0, 5, -100); // pending transform: do not submit a render/update its inverse in the test
  assert.equal(n.spawn(), true);
  assert.ok(n.position.z > 0, 'all negative-Z drop sites are visible in the new camera, even though behind the rider');
});
