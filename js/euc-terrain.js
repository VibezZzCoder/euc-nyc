// js/euc-terrain.js — the EUC controller's view of New York (its TerrainSampler).
//
// The renderer answers no gameplay question: this adapter derives every answer from the same data the city is built
// from, so what the wheel rides is what is drawn.
//
//   ground      city-config.js — roadway at 0, curb islands (blockAt) at ISLAND_BOUNDS.sidewalkHeight, Central Park
//               inside its real wall at CENTRAL_PARK_TOP with a ramp at each gate (CENTRAL_PARK_GATES), Bryant Park's
//               lawn and its terrace (ramps up from 6th Ave) at their drawn tops. Then the raised tops city-grid.js
//               registers where it draws them (plazas, park walks and lawn beds, Central Park's sidewalk, its ponds):
//               the highest one under a point wins. A pond is a wall only along its shore (WATER_RIDE.band); inside,
//               the ground is its floor under the surface, so a thrown rider lands in the water.
//               Pier decks / gangways carry `shore: true`, opening their own footprint through the shore boundary.
//               They include below-zero floating decks and Little Island's facets. Suspended decks also carry
//               `layered`: only surfaces within reach of the query's reference height can supply support.
//               Heights step exactly at a curb, which is what the EUC controller reads as a kerb
//               (TERRAIN.curbThreshold).
//   solids      the city's building colliders (AABB or OBB, from y 0 to maxY), the street furniture's drawn solids
//               (posts, stacks, subway stairs, carts, hydrants, mailboxes, tree trunks) and city-grid.js's solids
//               (park fences, Central Park's gate piers and monuments), as upright yawed boxes in an EUC
//               PlanTerrainSampler, which supplies the swept obstacle casts, wall normals and ragdoll records.
//   the shore   the wheel rides what is drawn out to the waterfront's edge (city-config.js, the numbers city-grid.js
//               draws it from): the island's ground and the seawall coping, up to the esplanade railing along both
//               rivers (ESPLANADE_RAIL) and round the Battery (BATTERY_RAIL), or the quay's edge where no railing
//               stands. Production uses actual gapped river railing bodies (`shoreRails`); a SHORE_BAND protects the drop
//               at an unrailed quay, and the Battery / north cut retain their protective bands. Past
//               it, the river floored just under its surface, so a thrown rider lands in the water, not on air. At the
//               north end the wall stands at the police barricades along the cut (NORTH_BARRIER); past them is
//               Upper Manhattan's ground, off limits (getting up there goes back to the last safe spot).
//
// No three.js: the headless tests import this file directly.
import { PlanTerrainSampler } from './euc/simulation/planSampler.js';
import { WHEEL, TERRAIN } from './euc/data/tuning.js';
import { findRecoveryTarget } from './euc-recovery.js';
import {
  blockAt, getIslandBoundsAtZ, ISLAND_BOUNDS, CENTRAL_PARK_TOP, CENTRAL_PARK_GATE_SIZE, inCentralPark, centralParkGateAt, pointInPoly, WATER_RIDE,
  MANHATTAN_COASTLINE, SEAWALL_POLYGON, ESPLANADE_RAIL, BATTERY_RAIL, NORTH_BARRIER
} from './city-config.js';

const SHORE_WALL = 3.0; // m: well above any step the wheel can climb or hop
const SHORE_BAND = 1.0; // m: how deep the shore wall is (a thrown rider can fly over it)
const RAIL_CLEAR = 0.5; // m: the wall's face stands this far inside a railing, so the wheel (and the rider leaning over it) stops short of it
const SHORE_ROW = 0.5; // m of z between the rows of the shore index
const TOP_CELL = 16; // m: keep the many short waterfront strips / ground facets local to a query
const SOLID_CELL = 8; // m: keep the native sampler's target resolution across the whole city, including its trees
const SUPPORT_REACH = 0.6; // m: query-layer selection / penetration allowance, NOT the controller's step-up tuning

// The native plan caps its grid at 256 cells per side: Manhattan makes those cells ~53 m wide, much too coarse for
// its many small trunks and posts. Rebuild only the index at the native 8 m target; keep every prepared collider,
// collider index, sweep / inside-exit / ragdoll query and the vendored implementation unchanged. ~4 MB of grid starts
// buys small local queries instead of scanning a block's worth of furniture on every simulation step.
function indexCitySolids(s) {
  if (s.gridCell <= SOLID_CELL) return;
  const spanX = s.gridColumns * s.gridCell, spanZ = s.gridRows * s.gridCell;
  s.gridCell = SOLID_CELL;
  s.gridColumns = Math.max(1, Math.ceil(spanX / SOLID_CELL));
  s.gridRows = Math.max(1, Math.ceil(spanZ / SOLID_CELL));
  const cells = s.gridColumns * s.gridRows;
  const counts = new Int32Array(cells);
  for (const box of s.colliders) s.eachCell(box, (cell) => counts[cell]++);
  s.gridStarts = new Int32Array(cells + 1);
  for (let cell = 0; cell < cells; cell++) s.gridStarts[cell + 1] = s.gridStarts[cell] + counts[cell];
  s.gridItems = new Int32Array(s.gridStarts[cells]);
  counts.set(s.gridStarts.subarray(0, cells));
  for (let i = 0; i < s.colliders.length; i++) s.eachCell(s.colliders[i], (cell) => { s.gridItems[counts[cell]++] = i; });
}

// Most tops are flat. A mesh facet carries its actual plane, y = y0 + dx*(x-x0) + dz*(z-z0), in world metres.
function topHeight(t, x, z) {
  const p = t.plane;
  return p ? p.y + p.dx * (x - p.x) + p.dz * (z - p.z) : t.top;
}

function waterInterior(t, x, z) {
  const band = t.water.band ?? WATER_RIDE.band;
  return band === 0 || edgeDistance2(t.poly, x, z, band * band) >= band * band;
}

/** Squared distance from (x, z) to the nearest edge of a closed polygon, stopping early once under `stop2`. */
function edgeDistance2(poly, x, z, stop2) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ex = b.x - a.x, ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2)) : 0;
    const dx = a.x + ex * t - x, dz = a.z + ez * t - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best && (best = d2) < stop2) return best;
  }
  return best;
}

// ---- The shore (see the header): which side of the waterfront's drawn edge a point is on --------------------------
// Polygon edges are indexed every SHORE_ROW m of z; exact intersections use the query's actual z. A single row of
// sampled crossings still supplies the width of the north cut. Coves are never replaced with outermost west/east x.
const SHORE_GROUND = 0;
const SHORE_WALLED = 1;
const SHORE_WATER = 2;
const SHORE_BEYOND = 3; // past the north barricades: Upper Manhattan's ground

function crossingRows(poly, z0, n) {
  const count = new Int32Array(n + 1);
  const each = (fn) => {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      if (a.z === b.z) continue;
      const lo = Math.min(a.z, b.z), hi = Math.max(a.z, b.z);
      for (let k = Math.max(0, Math.ceil((lo - z0) / SHORE_ROW)); k < n; k++) {
        const z = z0 + k * SHORE_ROW + 1e-3;
        if (z >= hi) break;
        if (z >= lo) fn(k, a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
      }
    }
  };
  each((k) => count[k + 1]++);
  for (let k = 0; k < n; k++) count[k + 1] += count[k];
  const xs = new Float32Array(count[n]);
  const fill = count.slice(0, n);
  each((k, x) => { xs[fill[k]++] = x; });
  for (let k = 0; k < n; k++) xs.subarray(count[k], count[k + 1]).sort();
  return { start: count, xs };
}

// Exact edge equations indexed by half-metre row. Unlike sampled x crossings, these also cover vertices / steep
// cove edges between rows, without walking the entire coastline for each waterfront simulation query.
function edgeRows(poly, z0, n) {
  const edges = [], rows = Array.from({ length: n }, () => []);
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    if (a.z === b.z) continue;
    const lo = Math.min(a.z, b.z), hi = Math.max(a.z, b.z), index = edges.length;
    edges.push({ x: a.x, z: a.z, slope: (b.x - a.x) / (b.z - a.z), lo, hi });
    for (let k = Math.max(0, Math.floor((lo - z0) / SHORE_ROW)), end = Math.min(n - 1, Math.floor((hi - z0) / SHORE_ROW)); k <= end; k++) rows[k].push(index);
  }
  return { edges, rows, z0 };
}

function insideEdges(index, x, z) {
  const row = index.rows[Math.floor((z - index.z0) / SHORE_ROW)];
  if (!row) return false;
  let inside = false;
  for (const i of row) {
    const e = index.edges[i];
    if (z >= e.lo && z < e.hi && x < e.x + (z - e.z) * e.slope) inside = !inside;
  }
  return inside;
}

/** The coastline with the Battery's stretch pulled in behind its railing (plus RAIL_CLEAR). */
function batteryLimitPolygon() {
  const C = MANHATTAN_COASTLINE;
  let area = 0;
  for (let i = 0, j = C.length - 1; i < C.length; j = i++) area += C[j].x * C[i].z - C[i].x * C[j].z;
  const s0 = area > 0 ? 1 : -1; // city-grid.js: outward = right of travel for a CCW ring
  const inward = (a, b) => {
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (-s0 * (b.z - a.z)) / l, z: (s0 * (b.x - a.x)) / l };
  };
  const tip = new Set(BATTERY_RAIL.tip);
  const d = BATTERY_RAIL.inset + RAIL_CLEAR;
  return C.map((p, i) => {
    if (!tip.has(p)) return p;
    const n1 = inward(C[(i - 1 + C.length) % C.length], p);
    const n2 = inward(p, C[(i + 1) % C.length]);
    let mx = n1.x + n2.x, mz = n1.z + n2.z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const k = d / Math.max(0.5, mx * n1.x + mz * n1.z); // mitred, so both edges move in by d
    return { x: p.x + mx * k, z: p.z + mz * k };
  });
}

let shoreIndex = null;
function buildShoreIndex() {
  const z0 = NORTH_BARRIER.band[0] - 2;
  const n = Math.ceil((ISLAND_BOUNDS.maxZ + 12 - z0) / SHORE_ROW) + 1;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of BATTERY_RAIL.tip) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const m = 10; // past the coping (6 m) beyond the railing
  return {
    z0, n,
    cut: crossingRows(MANHATTAN_COASTLINE, NORTH_BARRIER.band[1] + 0.5, 1),
    islandEdges: edgeRows(MANHATTAN_COASTLINE, z0, n),
    seawallEdges: edgeRows(SEAWALL_POLYGON, z0, n),
    batteryPoly: batteryLimitPolygon(),
    tipBox: { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m },
  };
}

/** True where the wheel may ride: on the drawn island or its coping, inside the railings. */
function shoreAllows(x, z, drawnRails = false) {
  const S = shoreIndex;
  const k = Math.round((z - S.z0) / SHORE_ROW);
  if (k < 0 || k >= S.n || z < NORTH_BARRIER.band[1]) return false;
  const onIsland = insideEdges(S.islandEdges, x, z);
  const t = S.tipBox;
  if (x > t.minX && x < t.maxX && z > t.minZ && z < t.maxZ
    && Math.hypot(x - BATTERY_RAIL.terminal.x, z - BATTERY_RAIL.terminal.z) >= BATTERY_RAIL.terminalR) {
    return pointInPoly(S.batteryPoly, x, z); // exact at the edge, including nearly horizontal cove segments
  }
  if (!onIsland && !insideEdges(S.seawallEdges, x, z)) return false;
  if (drawnRails) return true; // production builder supplies actual gapped railing bodies
  // Along the rivers: inside the esplanade railing (drawn at ESPLANADE_RAIL.d off the shore x at z)
  if (z < ESPLANADE_RAIL.z0) return true;
  const shore = getIslandBoundsAtZ(z);
  const west = x - shore.westX < shore.eastX - x;
  if (z > (west ? ESPLANADE_RAIL.westZ1 : ESPLANADE_RAIL.eastZ1)) return true;
  return (west ? x - shore.westX : shore.eastX - x) >= ESPLANADE_RAIL.d + RAIL_CLEAR;
}

/** SHORE_GROUND, SHORE_WALLED (the band at the edge), SHORE_WATER or SHORE_BEYOND at (x, z). */
function shoreAt(x, z, drawnRails = false) {
  shoreIndex ??= buildShoreIndex();
  const [b0, b1] = NORTH_BARRIER.band;
  if (z < b1) {
    if (z >= b0) return SHORE_WALLED;
    // past the barricades: Upper Manhattan, as wide as the island's cut
    const R = shoreIndex.cut;
    return R.xs.length && x > R.xs[0] && x < R.xs[R.xs.length - 1] ? SHORE_BEYOND : SHORE_WATER;
  }
  if (shoreAllows(x, z, drawnRails)) return SHORE_GROUND;
  const k = Math.round((z - shoreIndex.z0) / SHORE_ROW);
  const S = shoreIndex;
  const onLand = k >= 0 && k < S.n && (insideEdges(S.islandEdges, x, z) || insideEdges(S.seawallEdges, x, z));
  if (onLand) return SHORE_WALLED; // the coping past a railing
  const b = SHORE_BAND;
  return shoreAllows(x - b, z, drawnRails) || shoreAllows(x + b, z, drawnRails) || shoreAllows(x, z - b, drawnRails) || shoreAllows(x, z + b, drawnRails) ? SHORE_WALLED : SHORE_WATER;
}

/** Building colliders (controllers.js format) to EUC BoxColliders. */
export function boxesFromCityColliders(colliders) {
  const boxes = [];
  for (const c of colliders) {
    const top = Number.isFinite(c.maxY) ? c.maxY : 30;
    if (c.obb) {
      // controllers.js: local x = dx*cs - dz*sn, local z = dx*sn + dz*cs. EUC: local x = cos*dx - sin*dz, local z =
      // sin*dx + cos*dz with cos/sin of rotationY. So rotationY = atan2(sn, cs).
      const o = c.obb;
      boxes.push({
        centre: { x: o.cx, y: top / 2, z: o.cz },
        halfExtents: { x: o.hx, y: top / 2, z: o.hz },
        rotationY: Math.atan2(o.sn, o.cs),
        surface: 'pavement',
      });
    } else {
      boxes.push({
        centre: { x: (c.minX + c.maxX) / 2, y: top / 2, z: (c.minZ + c.maxZ) / 2 },
        halfExtents: { x: (c.maxX - c.minX) / 2, y: top / 2, z: (c.maxZ - c.minZ) / 2 },
        rotationY: 0,
        surface: 'pavement',
      });
    }
  }
  return boxes;
}

export class NycTerrainSampler {
  /**
   * @param {object} options
   * @param {object[]} [options.boxes] EUC BoxColliders (buildings and the builders' ride.solids)
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number,top:number,terrace?:object}} [options.lawn] Bryant Park's
   *   raised lawn, and the terrace round it with its ramps: { minX, maxX, minZ, maxZ, top, ramps: [{ fromX, toX, minZ,
   *   maxZ }] }
   * @param {number} [options.sidewalkHeight] curb-island top, m (city-config.js ISLAND_BOUNDS.sidewalkHeight)
   * @param {object[]} [options.tops] raised tops from the builders: { poly, top, surface, minX, maxX, minZ, maxZ,
   *   plane?: { x, y, z, dx, dz }, shore?: boolean, layered?: boolean, replacesBlock?: boolean }.
   *   `replacesBlock` replaces synthetic block ground with a drawn cut; `shore` marks ground over the shoreline;
   *   `layered` makes support conditional on referenceY. Boxes may also be layered, or `support: false` (body rays only).
   * @param {boolean} [options.shoreRails] true when the builder supplied the actual gapped esplanade railing bodies
   */
  constructor({ boxes = [], lawn = null, sidewalkHeight = ISLAND_BOUNDS.sidewalkHeight, tops = [], shoreRails = false } = {}) {
    this.shoreRails = shoreRails;
    this.lawn = lawn;
    this.sidewalkHeight = sidewalkHeight;
    this.topGrid = new Map();
    for (const t of tops) {
      for (let ix = Math.floor(t.minX / TOP_CELL); ix <= Math.floor(t.maxX / TOP_CELL); ix++) {
        for (let iz = Math.floor(t.minZ / TOP_CELL); iz <= Math.floor(t.maxZ / TOP_CELL); iz++) {
          const key = ix * 100000 + iz;
          let list = this.topGrid.get(key);
          if (!list) this.topGrid.set(key, (list = []));
          list.push(t);
        }
      }
    }
    const pad = 7000;
    const minX = ISLAND_BOUNDS.minX - pad;
    const minZ = ISLAND_BOUNDS.minZ - pad;
    const span = Math.max(ISLAND_BOUNDS.maxX - ISLAND_BOUNDS.minX, ISLAND_BOUNDS.maxZ - ISLAND_BOUNDS.minZ) + 2 * pad;
    // A flat 2 x 2 field at road level: the curbs, parks and shore are added in sampleGround from city-config.js.
    this.plan = {
      id: 'nyc',
      spawn: { position: { x: 0, y: 0, z: 0 }, headingY: 0 },
      surround: { height: 0, surface: 'pavement' },
      heightfield: { originX: minX, originZ: minZ, spacing: span, columns: 2, rows: 2, heights: [0, 0, 0, 0], surfaces: ['pavement'] },
      segments: [],
      solids: boxes,
      hazards: [],
    };
    this.boxes = new PlanTerrainSampler(this.plan);
    indexCitySolids(this.boxes);
    // A thin elevated bar can sit above the stock pedal-height ray while intersecting the wheel's shell.
    // This separate configuration-space index extends only explicitly tagged bars down by the shell's reach
    // above that ray. Actual ground, camera, recovery and ragdoll geometry remains the original drawn boxes.
    const reach = WHEEL.shellHeight - WHEEL.pedalHeight * TERRAIN.stepUpPedalFactor;
    const wheelSolids = boxes.filter(b => b.wheelSweep).map(b => ({ ...b,
      centre: { ...b.centre, y: b.centre.y - reach / 2 },
      halfExtents: { ...b.halfExtents, y: b.halfExtents.y + reach / 2 }, support: false
    }));
    this.wheelBoxes = wheelSolids.length ? new PlanTerrainSampler({ ...this.plan, solids: wheelSolids }) : null;
    this.wheelBounds = this.wheelBoxes ? this.wheelBoxes.colliders.reduce((b, c) => ({
      minX: Math.min(b.minX, c.minX), maxX: Math.max(b.maxX, c.maxX),
      minZ: Math.min(b.minZ, c.minZ), maxZ: Math.max(b.maxZ, c.maxZ)
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }) : null;
  }

  get colliderCount() {
    return this.boxes.colliderCount;
  }

  findRecoveryTarget(request, canPlace) {
    return findRecoveryTarget(this, request, canPlace);
  }

  /** The highest top under (x, z), or null; shoreOnly restricts the search to pier ground surfaces. */
  topAt(x, z, shoreOnly = false, referenceY = 0) {
    const list = this.topGrid.get(Math.floor(x / TOP_CELL) * 100000 + Math.floor(z / TOP_CELL));
    if (!list) return null;
    let best = null, height = -Infinity;
    for (const t of list) {
      if (shoreOnly && !t.shore) continue;
      if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue;
      if (t.top <= height) continue;
      if (!pointInPoly(t.poly, x, z)) continue;
      if (t.layered && topHeight(t, x, z) > referenceY + SUPPORT_REACH) continue;
      // Water cuts the park's base down to its floor, but cannot hide a rock sticking out above its surface.
      // Rank interior water at its level (submerged support stays wet); only its shore band uses the tall wall.
      const h = t.water && waterInterior(t, x, z) ? t.water.level : topHeight(t, x, z);
      if (h > height || (h === height && t.water)) { best = t; height = h; }
    }
    return best;
  }

  /** Bryant Park's terrace (or one of its ramps) at (x, z): writes `out` and returns true, or false if off it. */
  onTerrace(t, x, z, out) {
    if (x <= t.minX || x >= t.maxX || z <= t.minZ || z >= t.maxZ) return false;
    for (const r of t.ramps ?? []) {
      if (z <= r.minZ || z >= r.maxZ || (x - r.fromX) * (x - r.toX) > 0) continue;
      // From road level at the foot to the terrace top at the head; the sidewalk slab covers the foot
      out.height = Math.max(this.sidewalkHeight, t.top * Math.min(1, Math.max(0, (x - r.fromX) / (r.toX - r.fromX))));
      out.surface = 'pavement';
      return true;
    }
    out.height = t.top;
    out.surface = 'pavement';
    return true;
  }

  /** True where (x, z) is on a pond or the Reservoir (shore band included): not a place to stand. */
  isWater(x, z, referenceY = 0) {
    return !!this.topAt(x, z, false, referenceY)?.water;
  }

  /**
   * True where the rider may not be put back on the wheel: a pond, or past the shore wall (the strip beyond it, the
   * river) and the island's ends. Pier ground surfaces count as land. Getting up elsewhere goes to the last safe spot.
   */
  isOffLimits(x, z, referenceY = 0) {
    const allowed = (px, pz) => pz >= NORTH_BARRIER.band[1] && (shoreAt(px, pz, this.shoreRails) === SHORE_GROUND || !!this.topAt(px, pz, true, referenceY));
    if (!allowed(x, z)) return true;
    // not right at the edge either: a rider put back there would stand against the wall
    if (!allowed(x - 1, z) || !allowed(x + 1, z)) return true;
    if (!allowed(x, z - 1) || !allowed(x, z + 1)) return true;
    return this.isWater(x, z, referenceY);
  }

  /** The city's own ground at (x, z): height and surface, before solids. */
  cityGround(x, z, out, referenceY = 0) {
    out.plane = null;
    const edge = shoreAt(x, z, this.shoreRails);
    if (edge !== SHORE_GROUND) {
      // A registered pier deck / gangway opens only its actual footprint through the shore wall. Its support can be
      // below sea-level zero; the river beside it stays water. Overhead decks require a matching reference height.
      const top = this.topAt(x, z, false, referenceY);
      const deck = top?.shore ? top : this.topAt(x, z, true, referenceY);
      if (deck && edge !== SHORE_BEYOND && z >= NORTH_BARRIER.band[1]) {
        const S = shoreIndex, k = Math.round((z - S.z0) / SHORE_ROW);
        const onIsland = k >= 0 && k < S.n && insideEdges(S.islandEdges, x, z);
        const onCoping = k >= 0 && k < S.n && insideEdges(S.seawallEdges, x, z);
        const base = onIsland ? 0 : onCoping ? -0.04 : ISLAND_BOUNDS.waterLevel - WATER_RIDE.floorDepth;
        out.height = Math.max(base, topHeight(top, x, z));
        out.surface = top.surface;
        out.plane = out.height > base ? top.plane ?? null : null;
        return out;
      }
      out.height = edge === SHORE_WALLED ? SHORE_WALL : edge === SHORE_WATER ? ISLAND_BOUNDS.waterLevel - WATER_RIDE.floorDepth : 0;
      out.surface = 'pavement';
      return out;
    }
    const lawn = this.lawn;
    let blockBase = false;
    const gate = centralParkGateAt(x, z, 0, true);
    if (gate) {
      // Fallback for construction-free samplers. The actual registered entrance facets win below,
      // including Float32 endpoint heights; never let the formula raise the wheel above the drawn slab.
      const rise = CENTRAL_PARK_TOP - gate.gate.base;
      out.height = gate.gate.base + rise * gate.t;
      out.surface = gate.d < 0 ? 'pavement' : 'brick';
      if (gate.t > 0 && gate.t < 1) out.plane = {
        x: gate.gate.x, y: gate.gate.base, z: gate.gate.z,
        dx: gate.gate.nx * rise / CENTRAL_PARK_GATE_SIZE.length,
        dz: gate.gate.nz * rise / CENTRAL_PARK_GATE_SIZE.length
      };
    } else if (inCentralPark(x, z)) {
      // The lawn remains raised behind the wall; its base matches the drawn 0.85 + 0.34 m slab.
      out.height = CENTRAL_PARK_TOP;
      out.surface = 'grass';
    } else if (lawn && x > lawn.minX && x < lawn.maxX && z > lawn.minZ && z < lawn.maxZ) {
      out.height = lawn.top;
      out.surface = 'grass';
    } else if (lawn?.terrace && this.onTerrace(lawn.terrace, x, z, out)) {
      // Bryant Park's raised terrace round the lawn, and the ramps up to it from 6th Ave (landmarks.js)
    } else {
      const b = blockAt(x, z);
      if (b && (b.parkName === 'Central Park' || b.parkName === 'Bryant Park')) {
        // Central Park's perimeter sidewalk outside its wall (city-grid.js section 7); Bryant Park's block has the
        // ordinary sidewalk slab under its terraces (city-grid.js section 5)
        out.height = this.sidewalkHeight;
        out.surface = 'pavement';
      } else if (b && b.park > 0.6 && !b.median) {
        // A park block: at road level unless city-grid.js drew a raised walk on it (most parks: see topAt)
        out.height = 0;
        out.surface = 'grass';
        blockBase = true;
      } else if (b) {
        out.height = this.sidewalkHeight;
        out.surface = 'pavement';
        blockBase = true;
      } else {
        out.height = 0;
        out.surface = 'pavement';
      }
    }
    const top = this.topAt(x, z, false, referenceY);
    // A drawn road cut can replace a block's synthetic kerb / grass base. Higher registered geometry and native
    // solid bodies still win normally; this is not an override of the shore, a terrace or Central Park's terrain.
    if (top && (gate || (top.replacesBlock && blockBase) || topHeight(top, x, z) > out.height)) {
      out.height = topHeight(top, x, z);
      out.surface = top.surface;
      out.plane = top.plane ?? null;
      // Past the shore band, a pond's floor (only a thrown rider or a teleport gets here)
      if (top.water && waterInterior(top, x, z)) out.height = top.water.floor;
    }
    return out;
  }

  sampleGround(x, z, out, referenceY = 0) {
    // Native ground-box test, with suspended bodies filtered by query elevation. Body casts still see every box.
    const P = this.boxes;
    out.height = 0; out.surface = 'pavement'; out.traction = undefined;
    out.normal.x = 0; out.normal.y = 1; out.normal.z = 0;
    const cell = P.cellAt(x, z);
    for (let slot = P.gridStarts[cell], end = P.gridStarts[cell + 1]; slot < end; slot++) {
      const { collider: b, cos, sin } = P.colliders[P.gridItems[slot]];
      if (b.support === false || (b.layered && b.centre.y - b.halfExtents.y > referenceY + SUPPORT_REACH)) continue;
      const dx = x - b.centre.x, dz = z - b.centre.z;
      if (Math.abs(cos * dx - sin * dz) > b.halfExtents.x || Math.abs(sin * dx + cos * dz) > b.halfExtents.z) continue;
      const top = b.centre.y + b.halfExtents.y;
      if (top > out.height) { out.height = top; out.surface = b.surface; }
    }
    const city = this.cityGround(x, z, this._city ??= { height: 0, surface: 'pavement' }, referenceY);
    const p = city.plane;
    const inv = p ? 1 / Math.hypot(p.dx, 1, p.dz) : 1;
    if (out.base) {
      // Ragdoll limbs use the underlying terrain plane, independently of any solid box that wins above it.
      out.base.height = city.height;
      out.base.normal.x = p ? -p.dx * inv : 0;
      out.base.normal.y = inv;
      out.base.normal.z = p ? -p.dz * inv : 0;
    }
    // A solid whose top is higher wins (buildings, posts); otherwise the city's ground. Every solid's top is above 0,
    // so 0 here is the plan's flat field with no solid over it, and the city's ground wins even where it is lower
    // (the river).
    if (city.height >= out.height || out.height <= 0) {
      out.height = city.height;
      out.surface = city.surface;
      out.traction = undefined;
      out.normal.x = p ? -p.dx * inv : 0;
      out.normal.y = inv;
      out.normal.z = p ? -p.dz * inv : 0;
    }
    out.offCourse = false;
    return out;
  }

  raycast(origin, direction, maxDistance) {
    return this.boxes.raycast(origin, direction, maxDistance);
  }

  raycastObstacle(origin, direction, maxDistance, sweepHalfWidth, sweepLateral, out, initialExit, limb) {
    return this.boxes.raycastObstacle(origin, direction, maxDistance, sweepHalfWidth, sweepLateral, out, initialExit, limb);
  }

  // Controller-only mounted/wheel clearance, including its lateral standoff. Do not use for camera or ragdolls.
  raycastWheelObstacle(origin, direction, maxDistance, sweepHalfWidth, sweepLateral, out) {
    const ordinary = this.raycastObstacle(origin, direction, maxDistance, sweepHalfWidth, sweepLateral, out);
    const b = this.wheelBounds, reach = maxDistance + Math.max(0, sweepHalfWidth ?? 0);
    if (!b || origin.x + reach < b.minX || origin.x - reach > b.maxX
      || origin.z + reach < b.minZ || origin.z - reach > b.maxZ) return ordinary;
    const rail = this.wheelBoxes?.raycastObstacle(origin, direction, maxDistance, sweepHalfWidth, sweepLateral) ?? null;
    if (rail === null || (ordinary !== null && ordinary <= rail)) return ordinary;
    if (out) this.wheelBoxes.raycastObstacle(origin, direction, maxDistance, sweepHalfWidth, sweepLateral, out);
    return rail;
  }
}
