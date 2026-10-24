// js/euc-dynamic.js — the EUC controller's view of New York's moving things (its EucDynamicWorld).
//
// The vendored controller (js/euc/simulation/EucController.js) asks a host-owned "dynamic world" about every candidate
// move before it commits it, including a zero move, so a car can run into a rider standing still. This adapter answers
// with the simple host pattern of EUC Thrills' dynamicPopulationContact tests (the `fence()` helper), generalised to
// oriented boxes:
//
//   resolveMotion   sweeps the rider's hull (an upright box, request.previous -> request.proposed, at the proposed
//                   heading) against nearby upright oriented boxes and returns the clear prefix of the move, the contact
//                   normal (from the obstacle toward the rider) and the closing speed along it, the obstacle's own
//                   velocity included. The controller crashes the rider ('obstacle') when that closing speed reaches
//                   EUC.obstacleCrashSpeed (3.5 m/s), and otherwise just blocks the move.
//   canPlace        refuses only an automatic crash recovery onto an occupied spot (the controller retries elsewhere);
//                   teleports and resets ('reset', 'construct') always go through.
//   ragObstacleBodies  the same nearby boxes, as the ragdoll's upright prisms, so a crashed rider lands against cars and
//                   people instead of through them.
//
// The world never moves anything: cars and pedestrians are the city's (js/traffic.js), the rider is the controller's.
// Bodies come from a host callback, bodiesNear(x, z, radius, out), which pushes records shaped like EUC Thrills'
// PopulationFootprint onto `out`:
//   { x, z, headingY, halfWidthMetres, halfLengthMetres, minY, maxY, velocityX, velocityZ }
// (heading 0 along +Z, positive toward +X; absolute heights; world m/s). Extra fields are ignored. The records may be
// reused by the host between queries. A body counts if its centre is within `radius` plus its own bounding radius.
//
// Allocation-light: it runs at 120 Hz, a few calls per step. No three.js: the headless tests import this file directly.

/** The rider and wheel as the city's traffic meets them, metres (js/traffic.js uses the same size). */
export const EUC_DYNAMIC_HULL = Object.freeze({ halfWidthMetres: 0.35, halfLengthMetres: 0.5, heightMetres: 1.9 });

const SKIN = 0.002; // m: a clipped move stops this short of the face it reached
const CREEP = 0.0005; // m per query: how far a rider already inside a body may move further into it (sliding out)
const PLACE_MARGIN = 0.15; // m of clearance a crash recovery wants around the rider's hull
const EMPTY = Object.freeze([]);

/**
 * @param {object} options
 * @param {(x: number, z: number, radius: number, out: object[]) => void} options.bodiesNear  pushes nearby bodies
 * @param {() => number} [options.version]  changes whenever the bodies move (e.g. once per traffic frame). With it, one
 *   query serves every step until the bodies move or the rider leaves the queried circle; without it, every call
 *   queries afresh.
 * @param {{halfWidthMetres: number, halfLengthMetres: number, heightMetres: number}} [options.hull]
 * @param {number} [options.queryRadius]  m around the rider to gather bodies for
 * @param {number} [options.requerySlack]  m the rider may move before a cached query is refreshed
 * @param {'human'|'cop'} [options.occupantKind]
 */
export function createEucDynamicWorld({
  bodiesNear,
  version = null,
  hull = EUC_DYNAMIC_HULL,
  queryRadius = 6,
  requerySlack = 2.5,
  occupantKind = 'human',
} = {}) {
  if (typeof bodiesNear !== 'function') throw new TypeError('createEucDynamicWorld needs bodiesNear(x, z, radius, out)');
  if (version !== null && typeof version !== 'function') throw new TypeError('createEucDynamicWorld: version must be a function');
  const cache = [];
  const ragList = [];
  let cacheX = NaN;
  let cacheZ = NaN;
  let cacheVersion = NaN;
  let haveCentre = false;
  let lastX = 0;
  let lastZ = 0;
  const stats = { queries: 0, resolves: 0, contacts: 0 };

  function bodiesAround(x, z) {
    lastX = x;
    lastZ = z;
    haveCentre = true;
    if (version) {
      const v = version();
      const dx = x - cacheX, dz = z - cacheZ;
      if (v === cacheVersion && dx * dx + dz * dz <= requerySlack * requerySlack) return cache;
      cacheVersion = v;
    }
    cache.length = 0;
    bodiesNear(x, z, queryRadius, cache);
    cacheX = x;
    cacheZ = z;
    stats.queries++;
    return cache;
  }

  const result = { allowedMoveFraction: 1, normalX: 0, normalZ: 0, closingSpeedMetresPerSecond: 0 };
  const contact = { fraction: 1, nx: 0, nz: 0, closing: 0 };

  function resolveMotion(request) {
    stats.resolves++;
    const a = request.previous;
    const b = request.proposed;
    const bodies = bodiesAround(b.x, b.z);
    if (bodies.length === 0) return null;
    const found = sweepBodies(a, b, bodies, contact);
    if (!found) return null;
    stats.contacts++;
    result.allowedMoveFraction = contact.fraction;
    result.normalX = contact.nx;
    result.normalZ = contact.nz;
    result.closingSpeedMetresPerSecond = contact.closing;
    return result;
  }

  function canPlace(request) {
    if (request.reason !== 'recover') return true;
    const body = request.body;
    const bodies = bodiesAround(body.x, body.z);
    for (let i = 0; i < bodies.length; i++) if (overlaps(body, bodies[i], PLACE_MARGIN)) return false;
    return true;
  }

  function didPlace(request) {
    lastX = request.body.x;
    lastZ = request.body.z;
    haveCentre = true;
  }

  function ragObstacleBodies() {
    if (!haveCentre) return EMPTY;
    const bodies = bodiesAround(lastX, lastZ);
    ragList.length = 0;
    for (let i = 0; i < bodies.length; i++) ragList.push(bodies[i]);
    return ragList;
  }

  return {
    hull: { halfWidthMetres: hull.halfWidthMetres, halfLengthMetres: hull.halfLengthMetres, heightMetres: hull.heightMetres },
    occupantKind,
    resolveMotion,
    canPlace,
    didPlace,
    ragObstacleBodies,
    /** Diagnostics: bodies queries made, resolveMotion calls, contacts reported. */
    stats,
  };
}

/**
 * Join several body sources into createEucDynamicWorld options. A source is an object with
 * dynamicBodiesNear(x, z, radius, out) and, optionally, bodyVersion() (js/traffic.js's street traffic and highway
 * traffic both are), or a getter returning one, for sources created later. Missing sources are skipped. The version
 * changes whenever any source's does; without a bodyVersion on every source there is none (query every call).
 */
export function combineBodySources(...sources) {
  const resolve = (s) => (typeof s === 'function' ? s() : s);
  let versioned = true;
  for (const s of sources) {
    const source = resolve(s);
    if (source && typeof source.bodyVersion !== 'function') versioned = false;
  }
  return {
    bodiesNear(x, z, radius, out) {
      for (const s of sources) resolve(s)?.dynamicBodiesNear?.(x, z, radius, out);
    },
    // the sources' versions only ever count up, so their sum changes whenever any of them does
    version: versioned ? () => {
      let v = 0;
      for (const s of sources) v += resolve(s)?.bodyVersion?.() ?? 0;
      return v;
    } : null,
  };
}

/**
 * Sweep a rider hull from `a` to `b` (EucDynamicBody records; the proposed heading is used throughout) against
 * upright oriented boxes. Writes the earliest contact into `out` ({ fraction, nx, nz, closing }) and returns true, or
 * returns false when the move is clear and nothing is closing on the rider.
 */
export function sweepBodies(a, b, bodies, out) {
  let found = false;
  out.fraction = 1;
  out.nx = 0;
  out.nz = 0;
  out.closing = 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const cosA = Math.cos(b.headingY);
  const sinA = Math.sin(b.headingY);
  const hwA = b.halfWidthMetres;
  const hlA = b.halfLengthMetres;
  const minY = Math.min(a.minY, b.minY);
  const maxY = Math.max(a.maxY, b.maxY);
  const reachA = Math.hypot(hwA, hlA) + Math.hypot(dx, dz);
  for (let i = 0; i < bodies.length; i++) {
    const o = bodies[i];
    if (o.maxY <= minY || o.minY >= maxY) continue;
    const ox = a.x - o.x, oz = a.z - o.z;
    const reach = reachA + Math.hypot(o.halfWidthMetres, o.halfLengthMetres);
    if (ox * ox + oz * oz > reach * reach) continue;
    if (!sweepBox(a.x, a.z, dx, dz, cosA, sinA, hwA, hlA, o, hit)) continue;
    // closing speed: how fast the body and the rider approach along the normal (body toward rider)
    const closing = Math.max(0, ((o.velocityX || 0) - b.velocityX) * hit.nx + ((o.velocityZ || 0) - b.velocityZ) * hit.nz);
    if (hit.fraction >= 1 && closing <= 0) continue;
    if (!found || hit.fraction < out.fraction || (hit.fraction === out.fraction && closing > out.closing)) {
      out.fraction = hit.fraction;
      out.nx = hit.nx;
      out.nz = hit.nz;
      out.closing = closing;
      found = true;
    }
  }
  return found;
}

// Separating-axis sweep of a translating box (centre px, pz moving by dx, dz; heading cos/sin; half extents hw, hl)
// against a static upright oriented box. Four candidate axes: each box's lateral and forward directions.
const hit = { fraction: 1, nx: 0, nz: 0 };
const axisX = new Float64Array(4);
const axisZ = new Float64Array(4);
function sweepBox(px, pz, dx, dz, cosA, sinA, hwA, hlA, o, out) {
  const cosB = Math.cos(o.headingY);
  const sinB = Math.sin(o.headingY);
  const hwB = o.halfWidthMetres;
  const hlB = o.halfLengthMetres;
  // lateral (cos, -sin) and forward (sin, cos) of each box
  axisX[0] = cosA; axisZ[0] = -sinA;
  axisX[1] = sinA; axisZ[1] = cosA;
  axisX[2] = cosB; axisZ[2] = -sinB;
  axisX[3] = sinB; axisZ[3] = cosB;
  let tEnter = -Infinity;
  let tExit = Infinity;
  let enterAxis = -1;
  let enterSign = 1;
  let enterMotion = 0;
  let minPen = Infinity;
  let penAxis = -1;
  let penSign = 1;
  for (let k = 0; k < 4; k++) {
    const nx = axisX[k], nz = axisZ[k];
    const rA = hwA * Math.abs(cosA * nx - sinA * nz) + hlA * Math.abs(sinA * nx + cosA * nz);
    const rB = hwB * Math.abs(cosB * nx - sinB * nz) + hlB * Math.abs(sinB * nx + cosB * nz);
    const r = rA + rB;
    const d0 = (px - o.x) * nx + (pz - o.z) * nz;
    const m = dx * nx + dz * nz;
    const sign = d0 > 0 ? 1 : d0 < 0 ? -1 : (m > 0 ? -1 : 1);
    const pen = r - Math.abs(d0);
    if (pen < minPen) {
      minPen = pen;
      penAxis = k;
      penSign = sign;
    }
    if (Math.abs(m) < 1e-12) {
      if (pen <= 0) return false; // separated on this axis for the whole move
      continue;
    }
    let t1 = (-r - d0) / m;
    let t2 = (r - d0) / m;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tEnter) {
      tEnter = t1;
      enterAxis = k;
      enterSign = sign;
      enterMotion = Math.abs(m);
    }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return false;
  }
  if (tExit <= 0 || tEnter >= 1) return false;
  if (minPen > 0 && tEnter < 0) {
    // already inside at the start of the move (the body moved into the rider): allow moving out, and only a creep in
    const nx = axisX[penAxis] * penSign, nz = axisZ[penAxis] * penSign;
    const inward = -(dx * nx + dz * nz);
    out.fraction = inward <= 0 ? 1 : Math.min(1, CREEP / inward);
    out.nx = nx;
    out.nz = nz;
    return true;
  }
  if (enterAxis < 0) return false;
  // reached during the move: stop SKIN short of the face
  out.fraction = Math.max(0, Math.min(1, tEnter - SKIN / enterMotion));
  out.nx = axisX[enterAxis] * enterSign;
  out.nz = axisZ[enterAxis] * enterSign;
  return true;
}

/** Do an EucDynamicBody and an upright box overlap (with `margin` added to the rider), heights included? */
export function overlaps(body, o, margin = 0) {
  if (o.maxY <= body.minY || o.minY >= body.maxY) return false;
  const cosA = Math.cos(body.headingY), sinA = Math.sin(body.headingY);
  const cosB = Math.cos(o.headingY), sinB = Math.sin(o.headingY);
  const hwA = body.halfWidthMetres + margin, hlA = body.halfLengthMetres + margin;
  axisX[0] = cosA; axisZ[0] = -sinA;
  axisX[1] = sinA; axisZ[1] = cosA;
  axisX[2] = cosB; axisZ[2] = -sinB;
  axisX[3] = sinB; axisZ[3] = cosB;
  for (let k = 0; k < 4; k++) {
    const nx = axisX[k], nz = axisZ[k];
    const r = hwA * Math.abs(cosA * nx - sinA * nz) + hlA * Math.abs(sinA * nx + cosA * nz)
      + o.halfWidthMetres * Math.abs(cosB * nx - sinB * nz) + o.halfLengthMetres * Math.abs(sinB * nx + cosB * nz);
    if (Math.abs((body.x - o.x) * nx + (body.z - o.z) * nz) >= r) return false;
  }
  return true;
}
