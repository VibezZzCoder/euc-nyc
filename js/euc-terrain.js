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
//               Heights step exactly at a curb, which is what the EUC controller reads as a kerb
//               (TERRAIN.curbThreshold).
//   solids      the city's building colliders (AABB or OBB, from y 0 to maxY), the street furniture footprints
//               (lamp and signal posts, steam stacks, subway stairs) and city-grid.js's solids (park fences, Central
//               Park's gate piers and monuments), as upright yawed boxes in an EUC
//               PlanTerrainSampler, which supplies the swept obstacle casts, wall normals and ragdoll records.
//   the shore   the wheel rides what is drawn out to the waterfront's edge (city-config.js, the numbers city-grid.js
//               draws it from): the island's ground and the seawall coping, up to the esplanade railing along both
//               rivers (ESPLANADE_RAIL) and round the Battery (BATTERY_RAIL), or the quay's edge where no railing
//               stands. There a band SHORE_BAND deep is a wall too high to climb or hop (a railing, or the drop); past
//               it, the river floored just under its surface, so a thrown rider lands in the water, not on air. At the
//               north end the wall stands at the police barricades along the cut (NORTH_BARRIER); past them is
//               Upper Manhattan's ground, off limits (getting up there goes back to the last safe spot).
//
// No three.js: the headless tests import this file directly.
import { PlanTerrainSampler } from './euc/simulation/planSampler.js';
import {
  blockAt, getIslandBoundsAtZ, ISLAND_BOUNDS, CENTRAL_PARK_TOP, inCentralPark, centralParkGateAt, pointInPoly, WATER_RIDE,
  MANHATTAN_COASTLINE, SEAWALL_POLYGON, ESPLANADE_RAIL, BATTERY_RAIL, NORTH_BARRIER
} from './city-config.js';

const SHORE_WALL = 3.0; // m: well above any step the wheel can climb or hop
const SHORE_BAND = 1.0; // m: how deep the shore wall is (a thrown rider can fly over it)
const RAIL_CLEAR = 0.5; // m: the wall's face stands this far inside a railing, so the wheel (and the rider leaning over it) stops short of it
const SHORE_ROW = 0.5; // m of z between the rows of the shore index
const STREET_FURNITURE_HEIGHT = 2.5; // m: footprints carry no height; posts and stacks read as solid to here
const TOP_CELL = 64; // m: grid cell of the raised-tops index

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
// Each polygon becomes rows of sorted x crossings every SHORE_ROW m of z, so "inside" is a count of the crossings left
// of x in one short row: exact for the island's coves and inlets, which a per-z west / east shore x cannot describe.
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
    island: crossingRows(MANHATTAN_COASTLINE, z0, n),
    seawall: crossingRows(SEAWALL_POLYGON, z0, n),
    battery: crossingRows(batteryLimitPolygon(), z0, n),
    tipBox: { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m },
  };
}

function insideRows(rows, k, x) {
  let c = 0;
  for (let i = rows.start[k], e = rows.start[k + 1]; i < e && rows.xs[i] < x; i++) c++;
  return (c & 1) === 1;
}

/** True where the wheel may ride: on the drawn island or its coping, inside the railings. */
function shoreAllows(x, z) {
  const S = shoreIndex;
  const k = Math.round((z - S.z0) / SHORE_ROW);
  if (k < 0 || k >= S.n || z < NORTH_BARRIER.band[1]) return false;
  // Most of the island: one stretch of land across this row, x well inside it (past any railing or inset)
  const I = S.island;
  const i0 = I.start[k];
  if (I.start[k + 1] - i0 === 2 && x > I.xs[i0] + 12 && x < I.xs[i0 + 1] - 12) return true;
  const t = S.tipBox;
  if (x > t.minX && x < t.maxX && z > t.minZ && z < t.maxZ
    && Math.hypot(x - BATTERY_RAIL.terminal.x, z - BATTERY_RAIL.terminal.z) >= BATTERY_RAIL.terminalR) {
    return insideRows(S.battery, k, x); // round the Battery: inside its railing
  }
  if (!insideRows(S.island, k, x) && !insideRows(S.seawall, k, x)) return false;
  // Along the rivers: inside the esplanade railing (drawn at ESPLANADE_RAIL.d off the shore x at z)
  if (z < ESPLANADE_RAIL.z0) return true;
  const shore = getIslandBoundsAtZ(z);
  const west = x - shore.westX < shore.eastX - x;
  if (z > (west ? ESPLANADE_RAIL.westZ1 : ESPLANADE_RAIL.eastZ1)) return true;
  return (west ? x - shore.westX : shore.eastX - x) >= ESPLANADE_RAIL.d + RAIL_CLEAR;
}

/** SHORE_GROUND, SHORE_WALLED (the band at the edge), SHORE_WATER or SHORE_BEYOND at (x, z). */
function shoreAt(x, z) {
  shoreIndex ??= buildShoreIndex();
  const [b0, b1] = NORTH_BARRIER.band;
  if (z < b1) {
    if (z >= b0) return SHORE_WALLED;
    // past the barricades: Upper Manhattan, as wide as the island's cut
    const R = shoreIndex.island;
    const k = Math.round((b1 + 0.5 - shoreIndex.z0) / SHORE_ROW);
    return R.start[k + 1] > R.start[k] && x > R.xs[R.start[k]] && x < R.xs[R.start[k + 1] - 1] ? SHORE_BEYOND : SHORE_WATER;
  }
  if (shoreAllows(x, z)) return SHORE_GROUND;
  const k = Math.round((z - shoreIndex.z0) / SHORE_ROW);
  const S = shoreIndex;
  const onLand = k >= 0 && k < S.n && (insideRows(S.island, k, x) || insideRows(S.seawall, k, x));
  if (onLand) return SHORE_WALLED; // the coping past a railing
  const b = SHORE_BAND;
  return shoreAllows(x - b, z) || shoreAllows(x + b, z) || shoreAllows(x, z - b) || shoreAllows(x, z + b) ? SHORE_WALLED : SHORE_WATER;
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

/** Street furniture footprints (street-details.js format: x/z bounds only) to non-occluding EUC BoxColliders. */
export function boxesFromFootprints(footprints, height = STREET_FURNITURE_HEIGHT) {
  return footprints.map((f) => ({
    centre: { x: (f.minX + f.maxX) / 2, y: height / 2, z: (f.minZ + f.maxZ) / 2 },
    halfExtents: { x: (f.maxX - f.minX) / 2, y: height / 2, z: (f.maxZ - f.minZ) / 2 },
    rotationY: 0,
    surface: 'pavement',
    // Thin posts would make the chase camera pump in and out along every avenue (planSampler.ts explains).
    occludes: false,
  }));
}

export class NycTerrainSampler {
  /**
   * @param {object} options
   * @param {object[]} [options.boxes] EUC BoxColliders (see boxesFromCityColliders / boxesFromFootprints)
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number,top:number,terrace?:object}} [options.lawn] Bryant Park's
   *   raised lawn, and the terrace round it with its ramps: { minX, maxX, minZ, maxZ, top, ramps: [{ fromX, toX, minZ,
   *   maxZ }] }
   * @param {number} [options.sidewalkHeight] curb-island top, m (city-config.js ISLAND_BOUNDS.sidewalkHeight)
   * @param {object[]} [options.tops] raised tops from city-grid.js: { poly, top, surface, minX, maxX, minZ, maxZ }
   */
  constructor({ boxes = [], lawn = null, sidewalkHeight = ISLAND_BOUNDS.sidewalkHeight, tops = [] } = {}) {
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
  }

  get colliderCount() {
    return this.boxes.colliderCount;
  }

  /** The highest raised top (city-grid.js) under (x, z), or null. */
  topAt(x, z) {
    const list = this.topGrid.get(Math.floor(x / TOP_CELL) * 100000 + Math.floor(z / TOP_CELL));
    if (!list) return null;
    let best = null;
    for (const t of list) {
      if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue;
      if (best && t.top <= best.top) continue;
      if (pointInPoly(t.poly, x, z)) best = t;
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
  isWater(x, z) {
    return !!this.topAt(x, z)?.water;
  }

  /**
   * True where the rider may not be put back on the wheel: a pond, or past the shore wall (the strip beyond it, the
   * river) and the island's ends. Getting up there goes to the last safe spot instead.
   */
  isOffLimits(x, z) {
    if (shoreAt(x, z) !== SHORE_GROUND) return true;
    // not right at the edge either: a rider put back there would stand against the wall
    if (shoreAt(x - 1, z) !== SHORE_GROUND || shoreAt(x + 1, z) !== SHORE_GROUND) return true;
    if (shoreAt(x, z - 1) !== SHORE_GROUND || shoreAt(x, z + 1) !== SHORE_GROUND) return true;
    return this.isWater(x, z);
  }

  /** The city's own ground at (x, z): height and surface, before solids. */
  cityGround(x, z, out) {
    const edge = shoreAt(x, z);
    if (edge !== SHORE_GROUND) {
      out.height = edge === SHORE_WALLED ? SHORE_WALL : edge === SHORE_WATER ? ISLAND_BOUNDS.waterLevel - WATER_RIDE.floorDepth : 0;
      out.surface = 'pavement';
      return out;
    }
    const lawn = this.lawn;
    if (inCentralPark(x, z)) {
      // Inside the wall: the lawn, except in a gate's cut, where a ramp climbs from the sidewalk to the lawn
      const gate = centralParkGateAt(x, z);
      if (gate) {
        out.height = gate.gate.base + (CENTRAL_PARK_TOP - gate.gate.base) * gate.t;
        out.surface = 'brick';
      } else {
        out.height = CENTRAL_PARK_TOP;
        out.surface = 'grass';
      }
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
      } else if (b) {
        out.height = this.sidewalkHeight;
        out.surface = 'pavement';
      } else {
        out.height = 0;
        out.surface = 'pavement';
      }
    }
    const top = this.topAt(x, z);
    if (top && top.top > out.height) {
      out.height = top.top;
      out.surface = top.surface;
      // Past the shore band, a pond's floor (only a thrown rider or a teleport gets here)
      if (top.water && edgeDistance2(top.poly, x, z, WATER_RIDE.band * WATER_RIDE.band) >= WATER_RIDE.band * WATER_RIDE.band) {
        out.height = top.water.floor;
      }
    }
    return out;
  }

  sampleGround(x, z, out) {
    this.boxes.sampleGround(x, z, out);
    const city = this.cityGround(x, z, this._city ??= { height: 0, surface: 'pavement' });
    // A solid whose top is higher wins (buildings, posts); otherwise the city's ground. Every solid's top is above 0,
    // so 0 here is the plan's flat field with no solid over it, and the city's ground wins even where it is lower
    // (the river).
    if (city.height >= out.height || out.height <= 0) {
      out.height = city.height;
      out.surface = city.surface;
      out.traction = undefined;
      out.normal.x = 0;
      out.normal.y = 1;
      out.normal.z = 0;
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
}
