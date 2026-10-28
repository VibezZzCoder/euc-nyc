// NYC recovery policy — MIT, © 2026 VibezZzCoder.
// Called only when recovering. Queries the existing terrain/bodies; never moves the rider.
import { createGroundSample } from './euc/simulation/world.js';
import { EUC_DYNAMIC_HULL, overlaps } from './euc-dynamic.js';

const MARGIN = 0.15;
const DEPARTURE = 1.2;
const SAMPLE_STEP = 0.2;

/** Full standing volume against the city's indexed, as-drawn static boxes (including overhead solids). */
export function recoveryVolumeClear(sampler, body) {
  const index = sampler.boxes;
  const radius = Math.hypot(body.halfWidthMetres, body.halfLengthMetres);
  const first = index.cellAt(body.x - radius, body.z - radius);
  const last = index.cellAt(body.x + radius, body.z + radius);
  const columns = index.gridColumns;
  for (let row = Math.floor(first / columns); row <= Math.floor(last / columns); row++) {
    for (let col = first % columns; col <= last % columns; col++) {
      const cell = row * columns + col;
      for (let slot = index.gridStarts[cell]; slot < index.gridStarts[cell + 1]; slot++) {
        const b = index.colliders[index.gridItems[slot]].collider;
        if (overlaps(body, { x: b.centre.x, z: b.centre.z, headingY: b.rotationY,
          halfWidthMetres: b.halfExtents.x, halfLengthMetres: b.halfExtents.z,
          minY: b.centre.y - b.halfExtents.y, maxY: b.centre.y + b.halfExtents.y })) return false;
      }
    }
  }
  return true;
}

/** Prefer the fallen body's floor, then recorded safe floors. null means wait and retry, never force a placement. */
export function findRecoveryTarget(sampler, { fallen, safePoints, headingY, maxStepUp, hull = EUC_DYNAMIC_HULL }, canPlace) {
  const sample = createGroundSample();
  const ground = (x, z, y) => sampler.sampleGround(x, z, sample, y);
  const dry = (x, z, y) => !sampler.isOffLimits(x, z, y)
    && !sample.offCourse && sample.surface !== 'spill' && sample.traction !== 'spill';

  function supported(x, z, y, heading) {
    const g = ground(x, z, y);
    if (!Number.isFinite(g.height) || Math.abs(g.height - y) > maxStepUp || g.normal.y < 0.9 || !dry(x, z, y)) return null;
    const floor = g.height;
    const hw = hull.halfWidthMetres + MARGIN, hl = hull.halfLengthMetres + MARGIN;
    const c = Math.cos(heading), s = Math.sin(heading);
    // Footprint perimeter plus centre: refuse edges, submerged support and abrupt/unrideable steps.
    for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) {
      const px = x + u * hw * c + v * hl * s, pz = z - u * hw * s + v * hl * c;
      ground(px, pz, floor);
      if (Math.abs(sample.height - floor) > maxStepUp || sample.normal.y < 0.9 || !dry(px, pz, floor)) return null;
    }
    const body = { x, z, headingY: heading, halfWidthMetres: hw, halfLengthMetres: hl,
      minY: floor + 0.03, maxY: floor + hull.heightMetres, velocityX: 0, velocityZ: 0 };
    if (!recoveryVolumeClear(sampler, body)) return null;
    return { x, y: floor, z, headingY: heading };
  }

  function connected(a, b, heading, dynamic) {
    const length = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(length / SAMPLE_STEP));
    let y = a.y;
    // Include the origin: a blocked landing must not hop across a wall to a nearby candidate.
    for (let i = 0; i <= n; i++) {
      const p = supported(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n, y, heading);
      if (!p || (dynamic && !canPlace(p))) return false;
      y = p.y;
    }
    return Math.abs(y - b.y) <= maxStepUp;
  }

  function tryAround(anchor) {
    for (const radius of [0, 0.75, 1.5]) {
      for (let i = 0; i < (radius ? 8 : 1); i++) {
        const angle = headingY + i * Math.PI / 4;
        const x = anchor.x + Math.sin(angle) * radius, z = anchor.z + Math.cos(angle) * radius;
        for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
          const h = anchor.headingY + turn;
          const p = supported(x, z, anchor.y, h);
          if (!p || !canPlace(p) || (radius && !connected(anchor, p, h, false))) continue;
          const end = { x: p.x + Math.sin(h) * DEPARTURE, y: p.y, z: p.z + Math.cos(h) * DEPARTURE };
          if (connected(p, end, h, true)) return p;
        }
      }
    }
    return null;
  }

  if (fallen && [fallen.x, fallen.y, fallen.z].every(Number.isFinite)) {
    ground(fallen.x, fallen.z, fallen.y);
    // No upward snap to a bridge/lid; no recovery mid-fall or from a submerged floor.
    if (sample.height <= fallen.y + 0.03 && fallen.y - sample.height <= 1.1 && dry(fallen.x, fallen.z, fallen.y)) {
      const found = tryAround({ ...fallen, y: sample.height, headingY });
      if (found) return found;
    }
  }
  for (const point of safePoints) {
    const found = tryAround(point);
    if (found) return found;
  }
  return null;
}
