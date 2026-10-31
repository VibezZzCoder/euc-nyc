// Officer Dorkins' pursuit (js/nemesis-brain.js): the road graph, A*, the line he flies, where he appears, and flight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPursuitGraph, findPath, pathLine, pickSpawnPoint, createFlightBrain, createPursuitMemory, HOVER } from '../js/nemesis-brain.js';

// A 3 x 3 grid, 100 m apart (north = -z). Every road one-way (he flies them either way); the middle street is missing
// between x=100 and x=200.
function grid() {
  const nodes = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) nodes.push({ x: i * 100, z: j * 100 });
  const at = (i, j) => nodes[j * 3 + i];
  const edges = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) edges.push({ from: at(i, j), to: at(i, j + 1) });
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 2; i++) if (!(j === 1 && i === 1)) edges.push({ from: at(i, j), to: at(i + 1, j) });
  }
  return { nodes, edges };
}

const still = (x, z, y = 0) => ({ x, y, z, vx: 0, vz: 0 });
function fly(brain, target, seconds, dt = 1 / 60) {
  for (let i = 0; i < seconds / dt; i++) brain.update(dt, target);
  return brain.state;
}

test('the graph links every road both ways; nearest finds the closest node', () => {
  const g = buildPursuitGraph(grid());
  assert.equal(g.count, 9);
  assert.ok(g.adj[1].some((l) => l.to === 0), 'against a one-way road too: he flies');
  assert.ok(!g.adj[4].some((l) => l.to === 5), 'a missing block is not a road');
  assert.equal(g.nearest(190, 110), 5);
  assert.equal(g.nearest(5000, 5000, 100), -1, 'nothing near');
});

test('A* finds the shortest way round, or none', () => {
  const g = buildPursuitGraph(grid());
  assert.equal(findPath(g, 3, 5).length, 5, 'round the missing block: 4 links');
  assert.deepEqual(findPath(g, 2, 0), [2, 1, 0]);
  assert.deepEqual(findPath(g, 4, 4), [4]);
  assert.deepEqual(findPath(buildPursuitGraph({ nodes: [{ x: 0, z: 0 }, { x: 50, z: 0 }], edges: [] }), 0, 1), []);
});

test('the line he flies follows the middle of the roads, skips a node behind him, and ends at the player', () => {
  const g = buildPursuitGraph(grid());
  const line = pathLine(g, [0, 1, 2, 5], 30, 0, 200, 40);
  assert.deepEqual(line, [30, 0, 100, 0, 200, 0, 200, 40]);
});

test('he appears out of the player\'s view, behind them, best with an open flight to them', () => {
  const g = buildPursuitGraph(grid());
  const player = { x: 100, z: 100, heading: 0 }; // facing south (+z)
  const spot = pickSpawnPoint(g, player, { minDistance: 90, maxDistance: 150 });
  assert.ok(spot.z < 100 - 50, 'behind: north of a rider facing south');
  const unseen = pickSpawnPoint(g, player, { minDistance: 90, maxDistance: 150, visible: (x, z) => z < 50 });
  assert.ok(unseen.z >= 50, 'never where the player would see him, even behind them');
  const open = pickSpawnPoint(g, player, { minDistance: 90, maxDistance: 150, open: (x) => x === 200 });
  assert.equal(open.x, 200, 'an open flight to the player beats a better "behind"');
  // between the nodes too: nodes here are 100 m apart, none within 40..60 m of the player, the roads are
  const mid = pickSpawnPoint(g, player, { minDistance: 40, maxDistance: 60 });
  assert.ok(mid && Math.abs(Math.hypot(mid.x - 100, mid.z - 100) - 50) <= 10, 'a point along a road');
  assert.equal(pickSpawnPoint(g, player, { minDistance: 500, maxDistance: 600 }), null);
});

test('in clear view he flies straight at the player, never past cruise, and settles low behind them', () => {
  const brain = createFlightBrain(buildPursuitGraph(grid()));
  brain.place(0, 7, 0, 0);
  brain.update(1 / 60, still(0, 40));
  assert.equal(brain.state.mode, 'direct');
  let top = 0;
  for (let i = 0; i < 60 * 15; i++) top = Math.max(top, brain.update(1 / 60, still(0, 40)).speed);
  const f = brain.state;
  assert.ok(top <= HOVER.cruiseSpeed + 1e-6);
  assert.ok(Math.abs(Math.hypot(f.x, f.z - 40) - HOVER.followDistance) < 0.5, `settles ${HOVER.followDistance} m off`);
  assert.ok(Math.abs(f.y - HOVER.lowAltitude) < 0.2, 'drops low');
  assert.ok(f.speed < 0.3);
  assert.ok(Math.abs(f.heading) < 0.1, 'faces the player (south)');
});

test('the chaser closes an 80 m gap on a rider cruising at 72 km/h', () => {
  const brain = createFlightBrain(buildPursuitGraph(grid()));
  brain.place(0, 7, 0, 0);
  const target = { ...still(0, 80), vz: 20 };
  for (let i = 0; i < 60 * 30; i++) {
    target.z += target.vz / 60;
    brain.update(1 / 60, target);
  }
  const gap = Math.hypot(target.x - brain.state.x, target.z - brain.state.z);
  assert.ok(gap < 10, `ordinary cruising no longer pulls away (${gap.toFixed(1)} m gap)`);
});

test('a clean near-top-speed straight still opens a gap on the faster cop', () => {
  const brain = createFlightBrain(buildPursuitGraph(grid()));
  brain.place(0, 7, 0, 0);
  const target = { ...still(0, 80), vz: 28 };
  for (let i = 0; i < 60 * 30; i++) {
    target.z += target.vz / 60;
    brain.update(1 / 60, target);
  }
  assert.ok(target.z - brain.state.z > 150, 'skilled sustained speed can still create escape distance');
  assert.ok(brain.state.speed <= HOVER.cruiseSpeed + 1e-6, 'no unbounded catch-up boost');
});

for (const dt of [1 / 60, 1 / 20]) test(`out of sight he follows street corridors at ${1 / dt} Hz`, () => {
  const g = buildPursuitGraph(grid());
  // A building fills the missing block's corner: sight is blocked, so he takes the streets from (100, 100) to (200, 100)
  const brain = createFlightBrain(g, { clearLine: () => false });
  brain.place(100, 7, 100, 0);
  let maxOff = 0;
  for (let time = 0; time < 40; time += dt) {
    const f = brain.update(dt, still(200, 100));
    // off the road corridors (x or z near a multiple of 100) means through a block
    const off = Math.min(Math.abs(f.x - Math.round(f.x / 100) * 100), Math.abs(f.z - Math.round(f.z / 100) * 100));
    maxOff = Math.max(maxOff, off);
  }
  assert.equal(brain.state.mode, 'path');
  assert.ok(Math.hypot(brain.state.x - 200, brain.state.z - 100) < HOVER.followDistance + 1, 'got there');
  assert.ok(maxOff < 8, `kept to the streets (max ${maxOff.toFixed(1)} m off)`);
});

test('he climbs over what is low enough and never flies into anything', () => {
  // A 10 m block from z=20 to z=30 between him and the player
  const groundAt = (x, z) => (z > 20 && z < 30 ? 10 : 0);
  const brain = createFlightBrain(buildPursuitGraph(grid()), { groundAt });
  brain.place(0, 1, 0, 0);
  let lowest = Infinity;
  for (let i = 0; i < 60 * 10; i++) {
    const f = brain.update(1 / 60, still(0, 60));
    if (f.z > 20 && f.z < 30) lowest = Math.min(lowest, f.y);
  }
  assert.ok(lowest >= 10, 'over it, not through it');
  assert.ok(brain.state.z > 50, 'and on to the player');
});

test('he banks into turns and leans into speed', () => {
  const brain = createFlightBrain(buildPursuitGraph(grid()));
  brain.place(0, 7, 0, 0);
  fly(brain, still(0, 400), 3);
  assert.ok(brain.state.pitch > 0.05, 'leans forward at speed');
  let bank = 0;
  for (let i = 0; i < 30; i++) bank = brain.update(1 / 60, still(30, brain.state.z + 20)).bank; // target off to +x
  assert.ok(bank > 0.05, 'turning toward +heading (+x), he banks that way (+)');
});

test('with a clear line to above the player (a park, low roofs) he flies straight over, not round by the streets', () => {
  const g = buildPursuitGraph(grid());
  // the player 100 m off in the middle of a block (no road near); only a line to above their head is clear
  const target = still(150, 150);
  const brain = createFlightBrain(g, { clearLine: (x0, y0, z0, x1, y1) => y1 >= HOVER.highAltitude - 0.01 });
  brain.place(80, 7, 80, 0);
  brain.update(1 / 60, target);
  assert.equal(brain.state.mode, 'over');
  const f = fly(brain, target, 10);
  assert.ok(Math.hypot(f.x - 150, f.z - 150) < HOVER.followDistance + 1, 'arrives');
  const far = createFlightBrain(g, { clearLine: (x0, y0, z0, x1, y1) => y1 >= HOVER.highAltitude - 0.01 });
  far.place(0, 7, 0, 0);
  far.update(1 / 60, still(200, 200));
  assert.equal(far.state.mode, 'path', 'beyond overRange: the streets');
});

test('the swoop: he comes alongside, to the player\'s left, low, at their pace and facing their way; committed, he flies on', () => {
  const brain = createFlightBrain(buildPursuitGraph(grid()));
  brain.place(-2, 1.1, -4, 0);
  const target = { x: 0, y: 0, z: 0, vx: 0, vz: 5, heading: 0 };
  for (let i = 0; i < 90; i++) {
    target.z += target.vz / 60;
    brain.swoop(1 / 60, target, { lateral: 1.64, height: 0.25 });
  }
  const f = brain.state;
  assert.equal(f.mode, 'swoop');
  assert.ok(Math.abs(f.x - 1.64) < 0.25 && Math.abs(f.z - target.z) < 0.8, `alongside on the left: ${f.x.toFixed(2)}, ${(f.z - target.z).toFixed(2)}`);
  assert.ok(Math.abs(f.y - 0.25) < 0.15 && Math.abs(f.heading) < 0.1 && Math.abs(f.vz - 5) < 1, `${f.y} ${f.heading} ${f.vz}`);
  const vx = f.vx, vz = f.vz;
  target.vx = 6; // the player swerves; committed, he does not follow
  for (let i = 0; i < 10; i++) brain.swoop(1 / 60, target, { lateral: 1.64, height: 0.25, commit: true });
  assert.ok(Math.abs(f.vx - vx) < 1e-9 && Math.abs(f.vz - vz) < 1e-9);
});

test('a committed strike cannot read or steer to hidden heading/floor, including its last striking slice', () => {
  const g = buildPursuitGraph(grid());
  const a = createFlightBrain(g), b = createFlightBrain(g);
  const known = { x: 0, y: 12, z: 0, vx: 0, vz: 5, heading: .4 };
  const options = { lateral: 1.64, height: .1 };
  for (const brain of [a, b]) {
    brain.place(2, 12.1, -1, .4);
    for (let i = 0; i < 42; i++) brain.swoop(1 / 60, known, options);
  }
  const hidden = new Proxy({}, { get(_object, key) { throw new Error(`read hidden ${String(key)}`); } });
  for (let i = 0; i < 12; i++) {
    a.swoop(1 / 60, known, { ...options, commit: true });
    b.swoop(1 / 60, hidden, { ...options, commit: true });
    assert.deepEqual(b.state, a.state, 'all motion/pose channels remain committed, not just XZ velocity');
  }
  assert.ok(Math.abs(b.state.y - 12.1) < .01);
  assert.ok(Math.abs(b.state.heading - .4) < .01);

  // Placement clears the previous wind-up; committing without one must continue the new pose, not old intel.
  b.place(0, 3, 0, -1);
  b.swoop(1 / 60, hidden, { ...options, commit: true });
  assert.equal(b.state.heading, -1);
  assert.equal(b.state.y, 3);
});

test('search follows last-seen facts, not hidden live motion; sight reacquisition resumes pursuit', () => {
  const m = createPursuitMemory(buildPursuitGraph(grid()));
  const q = { ...still(100, 50, 12), heading: 0 };
  m.seed(q);
  m.update(0.1, q, true, still(100, 0));
  const remembered = { ...m.state.lastKnown };
  q.x = 900;
  q.z = 800;
  q.y = 0;
  const out = m.update(0.1, q, false, still(100, 0));
  assert.deepEqual(m.state.lastKnown, remembered);
  assert.equal(out.x, 100);
  assert.equal(out.z, 50);
  assert.equal(out.y, 12, 'remember the last-seen floor as well');
  assert.equal(m.state.searching, true);
  assert.equal(out.vx, 0);
  const next = m.update(0.1, q, true, still(100, 0));
  assert.equal(next, out, 'one reusable target');
  assert.equal(next.x, 900);
  assert.equal(m.state.searching, false);
});

test('at the last known spot he pauses, then checks nearby road segments even mid-block', () => {
  const a = { x: 0, z: 0 }, b = { x: 0, z: 300 };
  const m = createPursuitMemory(buildPursuitGraph({ nodes: [a, b], edges: [{ from: a, to: b }] }));
  const q = { ...still(0, 150), heading: 0 };
  m.seed(q);
  m.update(0.1, q, false, q);
  assert.equal(m.state.target.z, 150, 'look at the last known spot first');
  for (let i = 0; i < 16; i++) m.update(0.1, still(999, 999), false, q);
  assert.equal(m.state.target.x, 0);
  assert.equal(m.state.target.z, 186, 'check the road ahead of the remembered heading, not the live rider');
  const visited = new Set();
  for (let i = 0; i < 70; i++) {
    m.update(0.1, still(999, 999), false, m.state.target);
    visited.add(m.state.target.z);
  }
  assert.ok(visited.has(114), 'also checks the other direction');
});
