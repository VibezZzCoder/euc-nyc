// js/nemesis-brain.js — Officer Dorkins' pursuit: pure maths over the road graph, no three.js (tested in Node).
//
// He flies a hover-wheel (js/nemesis.js), so nothing on the ground holds him up: no kerbs, no traffic, no one-way
// streets. Far off he flies the streets' open corridors above the traffic (A* over road-network.js's graph, either way
// along every road); close by, with a clear line to the player, he goes straight for them and drops low behind them.
// Anything under his way that is not too tall (cars, kiosks, park walls, low buildings) he climbs over.
// Conventions as the city's: metres, Y up, north = -z, x += sin(heading), z += cos(heading).

export const HOVER = Object.freeze({
  cruiseSpeed: 24, // m/s (~86 km/h): closes on ordinary cruising; the player's ~28 m/s wheel can still outrun him
  accel: 9, // m/s^2, any direction in the horizontal
  turnRate: 3, // rad/s he can swing his heading
  highAltitude: 7, // m above the player's ground, following the streets
  lowAltitude: 1.1, // m (the bottom of his machine) when close behind the player
  lowFrom: 12, // m from the player: fully low inside this...
  highFrom: 45, // ...fully high beyond this
  directRange: 45, // m: within this and in clear view he flies straight at the player
  overRange: 120, // m: within this, with a clear line to above the player, he flies straight there over the top (parks,
  //                 plazas, across a block of low roofs), not round by the streets
  followDistance: 3, // m behind the player he settles at
  arriveDecel: 6, // m/s^2 he plans to stop at, arriving behind the player
  climbSpeed: 7, // m/s
  climbAccel: 14, // m/s^2
  clearance: 2, // m he keeps above anything under his way
  overMax: 40, // m: taller than this he does not climb over (the streets go round it)
  minHeight: 0.4, // m above whatever is under him, always
  cornerSpeed: 7, // m/s through a right-angle turn (a ~5 m radius at his acceleration: inside a cross street)
  cornerExitAlignment: 0.9, // keep corner speed until velocity points along the new street, not just past its junction
  plannedDecel: 5, // m/s^2 he plans to slow at before a turn
  lookAheadMin: 6,
  lookAheadPerSpeed: 0.5, // s
  probeSeconds: [0.3, 0.7, 1.2], // ahead of him, where he looks for things to climb over
  replanSeconds: 0.75,
  sightSeconds: 0.1,
  maxBank: 0.6, // rad
  pitchPerAccel: 0.03, // rad of forward lean per m/s^2
  cruisePitch: 0.12, // rad of forward lean at cruise
  maxPitch: 0.35,
  swoopGain: 3, // 1/s: how hard he closes on his spot beside the player
  swoopSpeed: 22, // m/s, at most, swooping in
  swoopAccel: 20, // m/s^2
  swoopTurnRate: 8, // rad/s
});


const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Undirected graph of the road network: the open corridors between the buildings he flies along, either way.
 * @param {{nodes: {x:number, z:number}[], edges: {from:object, to:object}[]}} network
 */
export function buildPursuitGraph(network, cell = 64) {
  const index = new Map(network.nodes.map((n, i) => [n, i]));
  const count = network.nodes.length;
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  network.nodes.forEach((n, i) => {
    xs[i] = n.x;
    zs[i] = n.z;
  });
  const links = Array.from({ length: count }, () => new Set());
  for (const e of network.edges) {
    const a = index.get(e.from), b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    links[a].add(b);
    links[b].add(a);
  }
  const adj = links.map((set, a) => [...set].map((b) => ({ to: b, cost: Math.hypot(xs[b] - xs[a], zs[b] - zs[a]) })));
  const cells = new Map();
  const key = (ix, iz) => ix * 65536 + iz;
  for (let i = 0; i < count; i++) {
    const k = key(Math.floor(xs[i] / cell), Math.floor(zs[i] / cell));
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(i);
  }
  /** The nearest node to (x, z) within `maxDistance`, or -1. */
  function nearest(x, z, maxDistance = 256) {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = -1, bestD = maxDistance * maxDistance;
    for (let r = 0; r * cell <= maxDistance + cell; r++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          const list = cells.get(key(ix, iz));
          if (!list) continue;
          for (const i of list) {
            const d = (xs[i] - x) ** 2 + (zs[i] - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      if (best >= 0 && (r * cell) ** 2 > bestD) break; // nothing in a further ring can be nearer
    }
    return best;
  }
  /** Up to `limit` nodes within `maxDistance` of (x, z), nearest first. */
  function nearestList(x, z, maxDistance = 200, limit = 8) {
    const found = [];
    const r = Math.ceil(maxDistance / cell);
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const list = cells.get(key(ix, iz));
        if (!list) continue;
        for (const i of list) {
          const d = Math.hypot(xs[i] - x, zs[i] - z);
          if (d <= maxDistance) found.push([d, i]);
        }
      }
    }
    found.sort((a, b) => a[0] - b[0]);
    return found.slice(0, limit).map((e) => e[1]);
  }
  return { count, xs, zs, adj, nearest, nearestList };
}

/** Shortest path (node indices, start first) by A*, or [] when the goal cannot be reached. */
export function findPath(graph, start, goal) {
  if (start < 0 || goal < 0) return [];
  if (start === goal) return [start];
  const { count, xs, zs, adj } = graph;
  const g = new Float64Array(count).fill(Infinity);
  const from = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const heap = []; // [f, node], a binary min-heap on f
  const push = (f, n) => {
    heap.push([f, n]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (n) => Math.hypot(xs[n] - xs[goal], zs[n] - zs[goal]);
  g[start] = 0;
  push(h(start), start);
  while (heap.length) {
    const [, n] = pop();
    if (closed[n]) continue;
    if (n === goal) break;
    closed[n] = 1;
    for (const l of adj[n]) {
      const c = g[n] + l.cost;
      if (c < g[l.to]) {
        g[l.to] = c;
        from[l.to] = n;
        push(c + h(l.to), l.to);
      }
    }
  }
  if (from[goal] < 0) return [];
  const path = [goal];
  for (let n = from[goal]; n >= 0; n = from[n]) path.push(n);
  return path.reverse();
}

/** True when (px, pz) lies alongside the segment a -> b (between its ends, within `side` m of it). */
function alongside(graph, a, b, px, pz, side = 15) {
  const ax = graph.xs[a], az = graph.zs[a];
  const dx = graph.xs[b] - ax, dz = graph.zs[b] - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return true;
  const t = ((px - ax) * dx + (pz - az) * dz) / len2;
  const lateral = Math.abs((px - ax) * dz - (pz - az) * dx) / Math.sqrt(len2);
  return t >= 0 && t <= 1 && lateral <= side;
}

/**
 * The line to fly, as flat [x0, z0, x1, z1, ...]: from (sx, sz) along the path's nodes (the middle of the road) to
 * (tx, tz). A first node he is already past, or a last one beyond the target, is skipped.
 */
export function pathLine(graph, path, sx, sz, tx, tz) {
  let p = path;
  if (p.length >= 2 && alongside(graph, p[0], p[1], sx, sz)) p = p.slice(1);
  if (p.length >= 2 && alongside(graph, p[p.length - 2], p[p.length - 1], tx, tz)) p = p.slice(0, -1);
  // A first node he is already at (each replan starts from where he is) would only send him circling it; one node for
  // both ends means he and the player are off the same junction: straight on to them
  if (path.length === 1 || (p.length > 1 && Math.hypot(graph.xs[p[0]] - sx, graph.zs[p[0]] - sz) < 12)) p = p.slice(1);
  const out = [sx, sz];
  for (const n of p) out.push(graph.xs[n], graph.zs[n]);
  out.push(tx, tz);
  return out;
}

/**
 * A point to appear at, on a street (sampled every `step` m along the graph's roads: Manhattan's nodes can be 200 m
 * apart), `minDistance`..`maxDistance` m away and never where the player would see it (`visible(x, z)`, e.g. the
 * camera's view). Of those, one behind the way they face, and best one with an open flight to them (`open(x, z)`: by
 * the streets, the far side of a Manhattan block is 300 m round). Returns { x, z }, or null.
 */
export function pickSpawnPoint(graph, player, { minDistance = 55, maxDistance = 110, step = 15, visible = null, open = null, isUsable = null } = {}) {
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  let best = null, bestScore = -Infinity;
  const consider = (x, z) => {
    const dx = x - player.x, dz = z - player.z;
    const d = Math.hypot(dx, dz);
    if (d < minDistance || d > maxDistance) return;
    let score = -(dx * fx + dz * fz) / d; // 1 straight behind, -1 straight ahead
    if (score + (open ? 2 : 0) <= bestScore) return;
    if (isUsable && !isUsable(x, z)) return;
    if (visible && visible(x, z)) return;
    if (open && score + 2 > bestScore && open(x, z)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = { x, z };
    }
  };
  for (let a = 0; a < graph.count; a++) {
    const ax = graph.xs[a], az = graph.zs[a];
    const da = Math.hypot(ax - player.x, az - player.z);
    for (const link of graph.adj[a]) {
      if (link.to < a) continue; // each road once
      if (da - link.cost > maxDistance) continue;
      const bx = graph.xs[link.to], bz = graph.zs[link.to];
      const n = Math.max(1, Math.ceil(link.cost / step));
      for (let k = 0; k <= n; k++) consider(ax + (bx - ax) * k / n, az + (bz - az) * k / n);
    }
  }
  return best;
}

/** Last-seen pursuit, not wall vision. Seed once with ambush intel; thereafter hidden rider motion is never read.
 * He checks the last known position, pauses to look, then checks nearby road segments (junctions can be 300 m apart).
 * Returns one reusable flight target. Search candidates are built only on a transition out of sight.
 */
export function createPursuitMemory(graph) {
  const target = { x: 0, y: 0, z: 0, vx: 0, vz: 0, heading: 0 };
  const lastKnown = { ...target };
  const state = { searching: false, lastKnown, target };
  let points = [], point = -1, dwell = 0;
  function remember(quarry) {
    Object.assign(lastKnown, quarry);
    Object.assign(target, quarry);
    state.searching = false;
    points.length = 0;
    point = -1;
    dwell = 0;
  }
  function aim(x, z) {
    Object.assign(target, { x, y: lastKnown.y, z, vx: 0, vz: 0, heading: lastKnown.heading });
    dwell = 0;
  }
  function searchPoints() {
    const found = [];
    for (const a of graph.nearestList(lastKnown.x, lastKnown.z, 200, 8)) {
      for (const { to: b, cost } of graph.adj[a]) {
        if (cost < 1) continue;
        const ax = graph.xs[a], az = graph.zs[a];
        const ux = (graph.xs[b] - ax) / cost, uz = (graph.zs[b] - az) / cost;
        const along = (lastKnown.x - ax) * ux + (lastKnown.z - az) * uz;
        for (const offset of [-36, 36]) {
          const d = clamp(along + offset, 0, cost);
          const x = ax + ux * d, z = az + uz * d;
          const range = Math.hypot(x - lastKnown.x, z - lastKnown.z);
          if (range < 20 || range > 80 || found.some((p) => Math.hypot(p.x - x, p.z - z) < 12)) continue;
          found.push({ x, z });
        }
      }
    }
    // Check the direction of travel first, without chasing a hidden live position.
    const fx = Math.sin(lastKnown.heading), fz = Math.cos(lastKnown.heading);
    found.sort((a, b) => ((b.x - lastKnown.x) * fx + (b.z - lastKnown.z) * fz)
      - ((a.x - lastKnown.x) * fx + (a.z - lastKnown.z) * fz));
    return found.slice(0, 4);
  }
  return {
    state,
    seed: remember,
    update(dt, quarry, sees, flyer) {
      if (sees) remember(quarry);
      else {
        if (!state.searching) {
          state.searching = true;
          points = searchPoints();
          point = -1;
          aim(lastKnown.x, lastKnown.z);
        }
        if (Math.hypot(flyer.x - target.x, flyer.z - target.z) < 10) {
          dwell += dt;
          if (dwell >= 1.5 && points.length) {
            point = (point + 1) % points.length;
            aim(points[point].x, points[point].z);
          }
        } else dwell = 0;
      }
      return target;
    },
  };
}

/**
 * The flyer: his state and the brain that flies it.
 * @param graph  buildPursuitGraph()
 * @param options.groundAt(x, z)  the height of whatever is under (x, z): the ground, or the top of a building, post...
 * @param options.clearLine(x0, y0, z0, x1, y1, z1)  true when nothing solid stands between the two points
 * update(dt, target) moves him one frame toward target { x, y (their ground), z, vx, vz } and returns his state:
 *   { x, y, z, vx, vy, vz, heading, speed, bank, pitch, mode } (y is the bottom of his machine).
 */
export function createFlightBrain(graph, { groundAt = () => 0, clearLine = () => true, tuning = HOVER } = {}) {
  const t = tuning;
  const f = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, speed: 0, bank: 0, pitch: 0, mode: 'idle' };
  let line = null; // flat polyline, see pathLine
  let seg = 0;
  let replanIn = 0;
  let sightIn = 0;
  let inSight = false;
  let overSight = false;
  let lastHeading = 0;
  let swoopAimed = false, swoopHeading = 0, swoopY = 0;
  // A node in clear line from (x, z) at the height he follows the streets (over the posts and kiosks; the nearest one
  // can be behind a block), and of those the one on the way to (ox, oz): mid-block, the nearer end of a street can be
  // the wrong way
  const reachableNode = (x, z, ox, oz) => {
    const y = groundAt(x, z) + t.highAltitude;
    const list = graph.nearestList(x, z);
    let best = -1, bestCost = Infinity;
    for (const n of list) {
      const nx = graph.xs[n], nz = graph.zs[n];
      const cost = Math.hypot(nx - x, nz - z) + Math.hypot(ox - nx, oz - nz);
      if (cost < bestCost && clearLine(x, y, z, nx, y, nz)) {
        best = n;
        bestCost = cost;
      }
    }
    if (best >= 0) return best;
    return list.length ? list[0] : graph.nearest(x, z);
  };
  // Accelerate toward the wanted velocity and climb toward aimY, never into anything taller than he is (slide along it
  // one axis at a time, or hold and climb); then turn toward face(speed), bank into turns and lean into speed
  function move(dt, wantVx, wantVz, accel, aimY, turnRate, face, climbGain = 2.5) {
    let ax = (wantVx - f.vx) / dt, az = (wantVz - f.vz) / dt;
    const a = Math.hypot(ax, az);
    if (a > accel) {
      ax *= accel / a;
      az *= accel / a;
    }
    f.vx += ax * dt;
    f.vz += az * dt;
    const wantVy = clamp((aimY - f.y) * climbGain, -t.climbSpeed, t.climbSpeed);
    f.vy += clamp(wantVy - f.vy, -t.climbAccel * dt, t.climbAccel * dt);
    const ny = f.y + f.vy * dt;
    const nx = f.x + f.vx * dt, nz = f.z + f.vz * dt;
    if (groundAt(nx, nz) <= ny) {
      f.x = nx;
      f.z = nz;
    } else if (groundAt(nx, f.z) <= ny) {
      f.x = nx;
      f.vz = 0;
    } else if (groundAt(f.x, nz) <= ny) {
      f.z = nz;
      f.vx = 0;
    } else {
      f.vx = f.vz = 0;
      f.vy = Math.max(f.vy, t.climbSpeed * 0.5);
    }
    f.y = Math.max(f.y + f.vy * dt, groundAt(f.x, f.z));
    f.speed = Math.hypot(f.vx, f.vz);

    const turn = clamp(wrap(face(f.speed) - f.heading), -turnRate * dt, turnRate * dt);
    f.heading = wrap(f.heading + turn);
    const yawRate = wrap(f.heading - lastHeading) / dt;
    lastHeading = f.heading;
    const ease = 1 - Math.exp(-dt * 6);
    // + leans left, toward a turn to +heading (the EUC pose's rollAngle)
    f.bank += (clamp(Math.atan(f.speed * yawRate / 9.81), -t.maxBank, t.maxBank) - f.bank) * ease;
    const forwardAccel = ax * Math.sin(f.heading) + az * Math.cos(f.heading);
    const pitch = clamp(t.cruisePitch * (f.speed / t.cruiseSpeed) + t.pitchPerAccel * forwardAccel, -t.maxPitch, t.maxPitch);
    f.pitch += (pitch - f.pitch) * ease;
    return f;
  }

  return {
    state: f,
    get line() {
      return line;
    },
    /** Put him somewhere, at rest. */
    place(x, y, z, heading) {
      Object.assign(f, { x, y, z, vx: 0, vy: 0, vz: 0, heading, speed: 0, bank: 0, pitch: 0, mode: 'idle' });
      line = null;
      seg = replanIn = sightIn = 0;
      inSight = overSight = false;
      lastHeading = heading;
      swoopAimed = false;
    },
    update(dt, target) {
      if (!(dt > 0)) return f;
      swoopAimed = false;
      const dx = target.x - f.x, dz = target.z - f.z;
      const distance = Math.hypot(dx, dz);

      // 1. Where to head: straight for the player in clear view, else along the streets
      sightIn -= dt;
      if (sightIn <= 0) {
        sightIn = t.sightSeconds;
        inSight = distance <= t.directRange && clearLine(f.x, f.y + 0.9, f.z, target.x, target.y + 1.2, target.z);
        overSight = !inSight && distance <= t.overRange
          && clearLine(f.x, f.y + 0.5, f.z, target.x, target.y + t.highAltitude, target.z);
      }
      let aimX = target.x, aimZ = target.z;
      let remaining = distance;
      let cap = t.cruiseSpeed;
      if (inSight || overSight) {
        f.mode = inSight ? 'direct' : 'over';
        line = null;
      } else {
        replanIn -= dt;
        if (replanIn <= 0 || !line) {
          replanIn = t.replanSeconds;
          const path = findPath(graph, reachableNode(f.x, f.z, target.x, target.z), reachableNode(target.x, target.z, f.x, f.z));
          line = path.length ? pathLine(graph, path, f.x, f.z, target.x, target.z) : null;
          seg = 0;
        }
        f.mode = line ? 'path' : 'lost';
        if (line) {
          // where he is along the line: past a segment's end (or within 3 m of it), on to the next
          const last = line.length / 2 - 1;
          let px = f.x, pz = f.z;
          while (seg < last) {
            const ax = line[seg * 2], az = line[seg * 2 + 1], bx = line[seg * 2 + 2], bz = line[seg * 2 + 3];
            const sx = bx - ax, sz = bz - az;
            const len2 = sx * sx + sz * sz;
            const u = len2 > 1e-9 ? ((f.x - ax) * sx + (f.z - az) * sz) / len2 : 1;
            if (u < 1 && (bx - f.x) ** 2 + (bz - f.z) ** 2 > 9) {
              const c = Math.max(0, u);
              px = ax + sx * c;
              pz = az + sz * c;
              break;
            }
            seg++;
          }
          // the point a look-ahead further on, the way left, and the slowest a coming turn allows
          let reach = t.lookAheadMin + t.lookAheadPerSpeed * f.speed;
          let along = 0, cx = px, cz = pz, prevX = px, prevZ = pz, found = false;
          aimX = line[line.length - 2];
          aimZ = line[line.length - 1];
          for (let i = seg + 1; i <= last; i++) {
            const nx = line[i * 2], nz = line[i * 2 + 1];
            const step = Math.hypot(nx - cx, nz - cz);
            if (!found && reach <= step) {
              const k = step > 1e-9 ? reach / step : 0;
              aimX = cx + (nx - cx) * k;
              aimZ = cz + (nz - cz) * k;
              found = true;
            }
            reach -= step;
            along += step;
            if (i < last && along < 80) {
              const ix = nx - prevX, iz = nz - prevZ;
              const ox = line[i * 2 + 2] - nx, oz = line[i * 2 + 3] - nz;
              const turn = Math.abs(wrap(Math.atan2(ox, oz) - Math.atan2(ix, iz)));
              const corner = t.cruiseSpeed - (t.cruiseSpeed - t.cornerSpeed) * Math.min(1, turn / (Math.PI / 2));
              cap = Math.min(cap, Math.sqrt(corner * corner + 2 * t.plannedDecel * along));
            }
            prevX = cx = nx;
            prevZ = cz = nz;
          }
          remaining = seg >= last ? distance : along;
          // Cutting a corner must not go through the building on it: aim at the corner itself then
          if (seg < last && !clearLine(f.x, f.y + 0.5, f.z, aimX, f.y + 0.5, aimZ)) {
            aimX = line[seg * 2 + 2];
            aimZ = line[seg * 2 + 3];
          }
        }
      }
      if (inSight || overSight || !line) {
        // a point followDistance short of the player, on his side of them
        const k = distance > 1e-3 ? Math.max(0, distance - t.followDistance) / distance : 0;
        aimX = f.x + dx * k;
        aimZ = f.z + dz * k;
      }

      // 2. How fast: cruise, slowing for turns, and closing to followDistance behind the player
      if (f.mode === 'path' && f.speed > 1) {
        const ax = aimX - f.x, az = aimZ - f.z, length = Math.hypot(ax, az);
        if (length > 1e-6 && (ax * f.vx + az * f.vz) / (length * f.speed) < t.cornerExitAlignment) {
          cap = Math.min(cap, t.cornerSpeed); // crossing the waypoint must not accelerate him sideways out of the road
        }
      }
      const closing = distance > 1e-3 ? Math.max(0, (target.vx * dx + target.vz * dz) / distance) : 0;
      const gap = Math.max(0, remaining - t.followDistance);
      const want = clamp(closing + Math.min(Math.sqrt(2 * t.arriveDecel * gap), 2 * gap), 0, cap);

      // 3. How high: low near the player, higher along the streets, and over whatever is in the way
      let ux = aimX - f.x, uz = aimZ - f.z;
      const aimLength = Math.hypot(ux, uz);
      if (aimLength > 1e-6) {
        ux /= aimLength;
        uz /= aimLength;
      } else {
        ux = Math.sin(f.heading);
        uz = Math.cos(f.heading);
      }
      let aimY = target.y + t.lowAltitude + (t.highAltitude - t.lowAltitude) * smoothstep(t.lowFrom, t.highFrom, distance);
      const under = groundAt(f.x, f.z);
      aimY = Math.max(aimY, under + t.minHeight);
      for (const seconds of t.probeSeconds) {
        const d = Math.max(2, Math.max(want, f.speed) * seconds);
        const top = groundAt(f.x + ux * d, f.z + uz * d);
        if (top <= target.y + 0.5) continue; // the ground, a kerb
        if (top <= t.overMax) aimY = Math.max(aimY, top + t.clearance);
        else if (inSight) sightIn = Math.max(sightIn, 0.5); // too tall to go over: back to the streets for a while
      }

      // 4 and 5. Fly there; face his way (or the player when hovering)
      return move(dt, ux * want, uz * want, t.accel, aimY, t.turnRate,
        (speed) => (speed > 1.5 ? Math.atan2(f.vx, f.vz) : distance > 0.5 ? Math.atan2(dx, dz) : f.heading));
    },

    /**
     * The paddle swoop (js/nemesis-swing.js): low beside the player, `lateral` m to their left (his paddle hand is his
     * right), level with them, matching their speed, facing their way. `commit`: the swing has started, he flies on as
     * he was going (so the player can still dodge).
     */
    swoop(dt, target, { lateral, height, commit = false }) {
      if (!(dt > 0)) return f;
      let wantVx = f.vx, wantVz = f.vz;
      if (!commit) {
        swoopAimed = true;
        swoopHeading = target.heading;
        swoopY = target.y + height;
        const h = swoopHeading;
        const sx = target.x + Math.cos(h) * lateral + target.vx * 0.1;
        const sz = target.z - Math.sin(h) * lateral + target.vz * 0.1;
        wantVx = target.vx + (sx - f.x) * t.swoopGain;
        wantVz = target.vz + (sz - f.z) * t.swoopGain;
        const speed = Math.hypot(wantVx, wantVz);
        if (speed > t.swoopSpeed) {
          wantVx *= t.swoopSpeed / speed;
          wantVz *= t.swoopSpeed / speed;
        }
      }
      // Once striking, keep the last wind-up's heading AND floor as well as its velocity. Even a hidden target's
      // rotation/elevation must not steer the committed paddle. Without a wind-up, continue from our own pose.
      const h = swoopAimed ? swoopHeading : f.heading;
      const aimY = swoopAimed ? swoopY : f.y;
      move(dt, wantVx, wantVz, t.swoopAccel, Math.max(aimY, groundAt(f.x, f.z) + 0.1), t.swoopTurnRate, () => h, 7);
      f.mode = 'swoop';
      return f;
    },
  };
}
