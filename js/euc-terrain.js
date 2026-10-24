// js/euc-terrain.js — the EUC controller's view of New York (its TerrainSampler).
//
// The renderer answers no gameplay question: this adapter derives every answer from the same data the city is built
// from, so what the wheel rides is what is drawn.
//
//   ground      city-config.js — roadway at 0, curb islands (blockAt) at ISLAND_BOUNDS.sidewalkHeight, Central Park
//               inside its real wall at CENTRAL_PARK_TOP with a ramp at each gate (CENTRAL_PARK_GATES), Bryant Park's
//               lawn at its top. Then the raised tops city-grid.js registers where it draws them (plazas, park walks
//               and lawn beds, Central Park's sidewalk, its ponds as walls): the highest one under a point wins.
//               Heights step exactly at a curb, which is what the EUC controller reads as a kerb
//               (TERRAIN.curbThreshold).
//   solids      the city's building colliders (AABB or OBB, from y 0 to maxY), the street furniture footprints
//               (lamp and signal posts, steam stacks, subway stairs) and city-grid.js's solids (park fences, Central
//               Park's gate piers and monuments), as upright yawed boxes in an EUC
//               PlanTerrainSampler, which supplies the swept obstacle casts, wall normals and ragdoll records.
//   the shore   beyond the bulkhead (less a margin, as controllers.js does) the ground is a wall too high to climb.
//
// No three.js: the headless tests import this file directly.
import { PlanTerrainSampler } from './euc/simulation/planSampler.js';
import {
  blockAt, getIslandBoundsAtZ, ISLAND_BOUNDS, CENTRAL_PARK_TOP, inCentralPark, centralParkGateAt, pointInPoly
} from './city-config.js';

const SHORE_MARGIN = 8.0; // controllers.js keeps every ground mode this far inside the bulkhead
const SHORE_WALL = 3.0; // m: well above any step the wheel can climb or hop
const STREET_FURNITURE_HEIGHT = 2.5; // m: footprints carry no height; posts and stacks read as solid to here
const TOP_CELL = 64; // m: grid cell of the raised-tops index

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
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number,top:number}} [options.lawn] Bryant Park's raised lawn
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

  /** The city's own ground at (x, z): height and surface, before solids. */
  cityGround(x, z, out) {
    const shore = getIslandBoundsAtZ(z);
    if (x < shore.westX + SHORE_MARGIN || x > shore.eastX - SHORE_MARGIN
      || z < ISLAND_BOUNDS.minZ + 30 || z > ISLAND_BOUNDS.maxZ) {
      out.height = SHORE_WALL;
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
    }
    return out;
  }

  sampleGround(x, z, out) {
    this.boxes.sampleGround(x, z, out);
    const city = this.cityGround(x, z, this._city ??= { height: 0, surface: 'pavement' });
    // A solid whose top is higher wins (buildings, posts); otherwise the city's ground.
    if (city.height >= out.height) {
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
