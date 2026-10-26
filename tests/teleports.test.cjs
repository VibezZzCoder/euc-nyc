const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
let TELEPORT_LOCATIONS, LANDMARK_SITES, EAST_RIVER_BRIDGES, CIVIC_JAIL, blockAt, nearestRoads, getIslandBoundsAtZ;
test.before(async () => {
  ({ TELEPORT_LOCATIONS, LANDMARK_SITES, EAST_RIVER_BRIDGES, CIVIC_JAIL, blockAt, nearestRoads, getIslandBoundsAtZ } = await import('../js/city-config.js'));
});

test('every teleport button has a finite arrival; landmark stops remain on real Manhattan roadways', () => {
  const buttons = [...read('index.html').matchAll(/data-teleport="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(Object.keys(TELEPORT_LOCATIONS).sort(), buttons.sort());
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z), `${name} has coordinates`);
    assert.ok(Number.isFinite(point.heading), `${name} has a heading`);
    assert.ok(point.y === undefined || Number.isFinite(point.y), `${name} has a valid optional floor`);
  }
  // New pier/bridge stops deliberately use registered riding surfaces outside the old street-only arrival model.
  for (const name of ['empire', 'timessq', 'chrysler', 'grandcentral', 'bryant', 'flatiron', 'centralpark', 'owtc']) {
    const point = TELEPORT_LOCATIONS[name];
    assert.equal(blockAt(point.x, point.z), null, `${name} lands outside building blocks`);
    const shore = getIslandBoundsAtZ(point.z);
    assert.ok(point.x > shore.westX + 8 && point.x < shore.eastX - 8, `${name} stays on the island`);
    const nearby = nearestRoads(point.x, point.z, 20);
    assert.ok(nearby.some(({ road, dist }) => dist < road.w / 2), `${name} lands within a street's width`);
  }
});

test('bridge arrivals are at the Manhattan approach, facing along their own crossing', () => {
  for (const bridge of EAST_RIVER_BRIDGES) {
    const point = TELEPORT_LOCATIONS[bridge.id];
    const dx = bridge.b.x - bridge.a.x, dz = bridge.b.z - bridge.a.z, length = Math.hypot(dx, dz);
    assert.ok(Math.hypot(point.x - bridge.a.x, point.z - bridge.a.z) < 35);
    assert.ok((dx * Math.sin(point.heading) + dz * Math.cos(point.heading)) / length > 0.999);
  }
});

test('One World Trade Center arrives on Vesey Street facing the tower', () => {
  const point = TELEPORT_LOCATIONS.owtc;
  const tower = LANDMARK_SITES['One World Trade Center'];
  assert.ok(nearestRoads(point.x, point.z, 20).some(({ road, dist }) => road.name === 'Vesey St' && dist < 1));
  const distance = Math.hypot(tower.x - point.x, tower.z - point.z);
  assert.ok(distance > 100 && distance < 220, 'leave space for the tower view');
  const alignment = ((tower.x - point.x) * Math.sin(point.heading) + (tower.z - point.z) * Math.cos(point.heading)) / distance;
  assert.ok(alignment > 0.999, 'face the tower rather than the neighboring buildings');
});

test('booking exit is on the jail side facing along White Street, distinct from the sightseeing stop', () => {
  const exit = CIVIC_JAIL.release;
  const white = nearestRoads(exit.x, exit.z, 20).find(({ road }) => road.name === 'White St');
  assert.ok(white?.horizontal, 'release follows the nearby east/west street');
  assert.ok(Math.sin(exit.heading) > 0.999 && Math.abs(Math.cos(exit.heading)) < 0.001, 'ride toward Centre Street, not across to a wall');
  assert.ok(exit.z > CIVIC_JAIL.z + 33 && exit.z < TELEPORT_LOCATIONS.jail.z, 'outside the jail, on its side of the street');
  const main = read('js/main.js');
  assert.match(main, /booking\.active \? CIVIC_JAIL\.release/, 'interrupted-booking checkpoint shares the corrected exit');
  assert.match(main, /placeAtJail\(CIVIC_JAIL\.release\.z, CIVIC_JAIL\.release\.heading\)/);
});

test('preset and map teleports share arrival resets and mark the resolved landing point', () => {
  const main = read('js/main.js');
  const start = main.indexOf('  function teleportTo(');
  const end = main.indexOf('  const openMapBtn', start);
  const handlers = new Map();
  const calls = [];
  const landed = { x: -305.7, z: 5210 };
  let map;
  const environment = {
    TELEPORT_LOCATIONS,
    controllerManager: {
      teleportActiveTo: (...args) => { calls.push(['teleport', ...args]); return landed; }
    },
    touchControls: { reset: () => calls.push(['touch']) },
    gamepadControls: { reset: () => calls.push(['gamepad']) },
    cameraSystem: { resetForTeleport: () => calls.push(['camera']) },
    selectCamera: (...args) => calls.push(['selectCamera', ...args]),
    getLocationLabel: (x, z) => `${x}, ${z}`,
    cityBlocks: { allBlocks: [] },
    trafficSystem: {},
    NYCMapSystem: class {
      constructor(options) { this.onTeleport = options.onTeleport; map = this; }
    },
    teleportButtons: Object.keys(TELEPORT_LOCATIONS).map((key) => ({
      getAttribute: () => key,
      addEventListener: (_event, handler) => handlers.set(key, handler)
    })),
    closePopovers: () => {}
  };
  vm.runInNewContext(main.slice(start, end), environment);
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    calls.length = 0;
    handlers.get(name)();
    assert.deepEqual(calls, [
      ['teleport', point.x, point.z, point.heading, point.y ?? Infinity], ['touch'], ['gamepad'], ['camera'], ['selectCamera', 'chase', true, false]
    ]);
    assert.equal(map.waypoint.x, landed.x);
    assert.equal(map.waypoint.z, landed.z);
  }
  map.waypoint = { x: 100, z: 200, name: 'inside a building' };
  map.onTeleport(100, 200);
  assert.equal(map.waypoint.x, landed.x, 'map marker follows the safe position returned by the controller');
  assert.equal(map.waypoint.z, landed.z);
  assert.equal(map.waypoint.name, `${landed.x}, ${landed.z}`);
});
