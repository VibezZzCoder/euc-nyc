const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./module.cjs');
const read = file => readFileSync(join(__dirname, '../../js', file), 'utf8');

// Same CPU/GPU boundary as upstream-cleanups.test.cjs: actual block layouts, rendered facade records and capped
// rider colliders, with only material factories stubbed. No geometry/rendering/browser setup.
function buildingRecords({ THREE, config, GEO, mergeSolidParts }, ids) {
  const source = read('buildings.js'), boundary = source.indexOf('  // C. STATIC ISLAND-WIDE');
  assert.ok(boundary > 0);
  const { buildCityBlocks } = loadModule(source.slice(0, boundary) + `
    return { buckets, colliders, allBlocks };
  }
export { buildCityBlocks };`, { imports: {
    'three/webgpu': THREE, 'three/addons/utils/BufferGeometryUtils.js': {}, './fire-escapes.js': {}, 'three/tsl': {},
    './city-config.js': { ...config, BLOCKS: ids.map(id => config.BLOCKS[id]) }, './solid-rects.js': { mergeSolidParts },
    './tsl-materials.js': { createPreWarBuildingMaterial: opts => opts, createCurtainWallMaterial: opts => opts,
      WALL_KINDS: { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 } },
    './nyc-geodata.js': { GEO },
    './city-grid.js': { fdrViaduct: null, pavedPlazaRects: [], parkTreeSites: [], sidewalkBlocks: [] }
  } });
  return buildCityBlocks(new THREE.Scene());
}

// Execute the production frame + Pier 15's initial lower/upper deck registrations. This fixture intentionally stops
// before ramp/rail/pavilion construction: it verifies surface provenance/layer selection, not full-venue clearance.
function pier15DeckRecords(config) {
  const source = read('city-grid.js');
  const frameStart = source.indexOf('  const frame =', source.indexOf('function buildWaterfrontPiers'));
  const frameEnd = source.indexOf('  // Steel pipe railing', frameStart);
  const deckStart = source.indexOf('  const deck =', frameEnd);
  const deckEnd = source.indexOf('    F.box(', deckStart);
  const pierStart = source.indexOf('    const { L, hw } = F;', source.indexOf('  kinds.pier15 ='));
  const pierEnd = source.indexOf('    // A straight concrete access ramp', pierStart);
  const deckHeight = source.match(/const DY = ([\d.]+); \/\/ deck top/);
  assert.ok(frameStart > 0 && frameEnd > frameStart && deckEnd > deckStart && pierEnd > pierStart && deckHeight);
  const tops = [], boxes = [];
  const addRideTop = (poly, top, surface) => {
    const t = { poly, top, surface, minX: Math.min(...poly.map(p => p.x)), maxX: Math.max(...poly.map(p => p.x)),
      minZ: Math.min(...poly.map(p => p.z)), maxZ: Math.max(...poly.map(p => p.z)) };
    tops.push(t); return t;
  };
  const addRideSolid = (x, z, w, d, y0, y1, rotationY) => {
    const b = { centre: { x, y: (y0 + y1) / 2, z }, halfExtents: { x: w / 2, y: (y1 - y0) / 2, z: d / 2 },
      rotationY, surface: 'pavement', layered: true };
    boxes.push(b); return b;
  };
  const build = new Function('getIslandBoundsAtZ', 'addRideTop', 'addRideSolid', 'site', `
    const DY = ${Number(deckHeight[1])}, GR = {}, BL = {}, PA = {}, B = { box() {} };
    ${source.slice(frameStart, frameEnd)}
    ${source.slice(deckStart, deckEnd)} };
    const F = pierFrame(site);
    ${source.slice(pierStart, pierEnd)}
    return { x: F.wx(40, 0), z: F.wz(40, 0), lower: DY, upper: UY };
  `);
  return { tops, boxes, ...build(config.getIslandBoundsAtZ, addRideTop, addRideSolid,
    config.WATERFRONT_PIERS.find(p => p.kind === 'pier15')) };
}

module.exports = { buildingRecords, pier15DeckRecords };
