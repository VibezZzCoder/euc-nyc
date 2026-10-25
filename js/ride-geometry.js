// Construction-time helpers for the drawn city and its compact riding bodies. No per-frame work.
// MIT © 2026 VibezZzCoder

/** Cut a polygon by a half-plane. Retains vertices on the boundary. */
export function clipHalfPlane(poly, distance) {
  const out = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], da = distance(a), db = distance(b);
    if ((da < 0) !== (db < 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
    if (db >= 0) out.push(b);
  }
  return out;
}

/** Polygon minus a convex corridor, as disjoint polygon pieces (either winding). */
export function subtractConvex(poly, cut) {
  const area = cut.reduce((s, a, i) => { const b = cut[(i + 1) % cut.length]; return s + a.x * b.z - b.x * a.z; }, 0);
  let inside = poly;
  const pieces = [];
  for (let i = 0; i < cut.length && inside.length >= 3; i++) {
    const a = cut[i], b = cut[(i + 1) % cut.length];
    const d = p => Math.sign(area) * ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x));
    const outside = clipHalfPlane(inside, p => -d(p));
    if (outside.length >= 3) pieces.push(outside);
    inside = clipHalfPlane(inside, d);
  }
  return pieces;
}

/** Inscribed horizontal rectangles in a convex prism: no box corner sticks outside its drawn outline.
 * Adaptive slices keep taper error small without dividing a straight hull into hundreds of boxes. */
export function prismSlices(poly, tolerance = 0.1) {
  const xs = [...new Set(poly.map(p => p.x))].sort((a, b) => a - b), result = [];
  const span = x => {
    const zs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      if (x < Math.min(a.x, b.x) - 1e-7 || x > Math.max(a.x, b.x) + 1e-7) continue;
      if (Math.abs(a.x - b.x) < 1e-7) zs.push(a.z, b.z);
      else zs.push(a.z + (b.z - a.z) * (x - a.x) / (b.x - a.x));
    }
    return [Math.min(...zs), Math.max(...zs)];
  };
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1], b = xs[i], sa = span(a), sb = span(b);
    const change = Math.max(Math.abs(sb[0] - sa[0]), Math.abs(sb[1] - sa[1]));
    // Bound penetration at a pointed bow in both axes. Straight midships still need just one box.
    const n = Math.max(1, Math.ceil(change / tolerance), change > 1e-7 ? Math.ceil((b - a) / 0.15) : 1);
    for (let k = 0; k < n; k++) {
      const x0 = a + (b - a) * k / n, x1 = a + (b - a) * (k + 1) / n;
      const l = span(x0), r = span(x1), z0 = Math.max(l[0], r[0]), z1 = Math.min(l[1], r[1]);
      // Micrometre overlap prevents axis-parallel casts leaking through roundoff at a shared box face.
      if (z1 - z0 > 1e-6 && x1 - x0 > 1e-6) result.push({ x0: x0 - 1e-6, x1: x1 + 1e-6, z0, z1 });
    }
  }
  return result;
}

/** A thin sloping rail approximated by yawed boxes. Top selection is left to its actual mesh. */
export function railBodies(a, b, width, thickness, addSolid) {
  const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y, length = Math.hypot(dx, dz);
  const n = length < 1e-6 ? 1 : Math.max(1, Math.ceil(Math.abs(dy) / Math.max(0.08, thickness)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, y0 = a.y + dy * i / n, y1 = a.y + dy * (i + 1) / n;
    const body = addSolid(a.x + dx * t, a.z + dz * t, width, Math.max(thickness, length / n) + 2e-6,
      Math.min(y0, y1) - thickness / 2, Math.max(y0, y1) + thickness / 2, Math.atan2(dx, dz));
    body.support = false;
  }
}
