// js/solid-rects.js — a block's building parts as a few solid rectangles for the rider's colliders.
//
// buildings.js carves every building into non-overlapping parts { x0, x1, z0, z1, y0, y1 } (tiers stack, so a tower's
// upper parts stand inside its lower ones). The wheel must collide with exactly the ground those parts cover, not with
// the whole block: plazas, project lawns, yards and the gaps between buildings are open. And with as few boxes as
// possible: the EUC sampler scans every box in its grid cell on each query, many times per 120 Hz step.
//
//   1. Part edges (snapped to the centimetre) cut the block into a grid; a cell is solid if any part covers it.
//   2. Courts no opening reaches (light wells, ring courtyards) are filled: nothing can get in, so they need no walls.
//   3. Solid cells merge into rectangles: runs along x, stacked along z while they start and end at the same x.
//      (Trying both axes saved about 1% of the boxes for twice the work.)
//   4. Each rectangle is as tall as the tallest part over it, up to `maxY`. Nothing the rider does reaches higher, so a
//      tower's upper tiers add nothing.
//
// It runs once per block at start-up (about 5,000 blocks, 100,000 parts), so it works in reused typed arrays.
//
// No three.js: the headless tests import this file directly.

const SNAP = 100; // 1 cm

// Scratch arrays, grown as needed and reused from block to block
let cellCap = 0, h, stack;
let partCap = 0, box, ys, xe, ze;
let edgeCap = 0, prevU0, prevU1, prevV0, prevY, curU0, curU1, curV0, curY;

function growCells(n) {
  if (n <= cellCap) return;
  cellCap = Math.max(n, cellCap * 2, 4096);
  h = new Float32Array(cellCap);
  stack = new Int32Array(cellCap);
}
function growParts(n) {
  if (n <= partCap) return;
  partCap = Math.max(n, partCap * 2, 256);
  box = new Int32Array(partCap * 4);
  ys = new Float32Array(partCap);
  xe = new Int32Array(partCap * 2);
  ze = new Int32Array(partCap * 2);
}
function growEdges(n) {
  if (n <= edgeCap) return;
  edgeCap = Math.max(n, edgeCap * 2, 512);
  prevU0 = new Int32Array(edgeCap); prevU1 = new Int32Array(edgeCap); prevV0 = new Int32Array(edgeCap); prevY = new Float32Array(edgeCap);
  curU0 = new Int32Array(edgeCap); curU1 = new Int32Array(edgeCap); curV0 = new Int32Array(edgeCap); curY = new Float32Array(edgeCap);
}

// Sorted distinct values of a typed array, in place; returns the count
function uniq(a) {
  a.sort();
  let n = 0;
  for (let i = 0; i < a.length; i++) if (n === 0 || a[i] !== a[n - 1]) a[n++] = a[i];
  return n;
}

// Index of v in the sorted a[0..n)
function find(a, n, v) {
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * @param {{x0:number,x1:number,z0:number,z1:number,y1:number,y0?:number}[]} parts (y0: where a tier starts, default 0)
 * @param {number} [maxY] cap on the rectangles' heights
 * @returns {{x0:number,x1:number,z0:number,z1:number,y1:number}[]} disjoint rectangles covering the parts' ground (and
 *   the courts enclosed by it)
 */
export function mergeSolidParts(parts, maxY = Infinity) {
  growParts(parts.length);
  let k = 0;
  let top = 0; // the tallest box: sealed courts on their own get it
  for (const p of parts) {
    const x0 = Math.round(p.x0 * SNAP), x1 = Math.round(p.x1 * SNAP);
    const z0 = Math.round(p.z0 * SNAP), z1 = Math.round(p.z1 * SNAP);
    // A tier starting at the cap stands on lower ones already as tall as a box can be: it adds nothing (and its edges
    // would only cut the grid finer)
    if (!(x1 > x0 && z1 > z0 && p.y1 > 0) || p.y0 >= maxY) continue;
    box[k * 4] = x0; box[k * 4 + 1] = x1; box[k * 4 + 2] = z0; box[k * 4 + 3] = z1;
    ys[k] = Math.min(p.y1, maxY);
    if (ys[k] > top) top = ys[k];
    xe[k * 2] = x0; xe[k * 2 + 1] = x1;
    ze[k * 2] = z0; ze[k * 2 + 1] = z1;
    k++;
  }
  if (!k) return [];
  const xs = xe.subarray(0, k * 2);
  const zs = ze.subarray(0, k * 2);
  const nxe = uniq(xs);
  const nze = uniq(zs);
  const nx = nxe - 1;
  const nz = nze - 1;
  const cells = nx * nz;
  growCells(cells);
  growEdges(nxe + 1);
  h.fill(0, 0, cells);
  for (let q = 0; q < k; q++) {
    const i0 = find(xs, nxe, box[q * 4]), i1 = find(xs, nxe, box[q * 4 + 1]);
    const j0 = find(zs, nze, box[q * 4 + 2]), j1 = find(zs, nze, box[q * 4 + 3]);
    const y = ys[q];
    for (let j = j0; j < j1; j++) {
      const row = j * nx;
      for (let c = row + i0, e = row + i1; c < e; c++) if (y > h[c]) h[c] = y;
    }
  }

  // 2. Open cells reached from the grid's border (4-connected) are marked -1; open cells left at 0 are sealed courts,
  //    solid like the parts around them
  let sp = 0;
  const seed = (c) => { if (h[c] === 0) { h[c] = -1; stack[sp++] = c; } };
  for (let i = 0; i < nx; i++) { seed(i); seed(cells - nx + i); }
  for (let j = 1; j < nz - 1; j++) { seed(j * nx); seed(j * nx + nx - 1); }
  while (sp) {
    const c = stack[--sp];
    const i = c % nx;
    if (i > 0) seed(c - 1);
    if (i < nx - 1) seed(c + 1);
    if (c >= nx) seed(c - nx);
    if (c < cells - nx) seed(c + nx);
  }

  // 3. Runs along x in each row j; a stack (prev*) carries on while the next row has a run with the same ends
  const out = [];
  let np = 0;
  for (let j = 0; j <= nz; j++) {
    let nc = 0;
    if (j < nz) {
      const row = j * nx;
      for (let i = 0; i < nx;) {
        if (h[row + i] < 0) { i++; continue; }
        const i0 = i;
        let y = 0;
        for (; i < nx && h[row + i] >= 0; i++) if (h[row + i] > y) y = h[row + i];
        curU0[nc] = i0; curU1[nc] = i; curY[nc] = y; nc++;
      }
    }
    // Both lists are sorted by start: walk them together
    let a = 0, b = 0;
    while (a < np || b < nc) {
      if (a < np && b < nc && prevU0[a] === curU0[b] && prevU1[a] === curU1[b]) {
        // carries on: keep its start row, raise its height
        curY[b] = Math.max(curY[b], prevY[a]);
        curV0[b] = prevV0[a];
        a++; b++;
        continue;
      }
      if (a < np && (b >= nc || prevU0[a] <= curU0[b])) {
        const y = prevY[a] || top; // a stack of sealed court only: as tall as the block
        out.push({ x0: xs[prevU0[a]] / SNAP, x1: xs[prevU1[a]] / SNAP, z0: zs[prevV0[a]] / SNAP, z1: zs[j] / SNAP, y1: y });
        a++;
      } else {
        curV0[b] = j; // a new stack starts at this row
        b++;
      }
    }
    for (let q = 0; q < nc; q++) { prevU0[q] = curU0[q]; prevU1[q] = curU1[q]; prevV0[q] = curV0[q]; prevY[q] = curY[q]; }
    np = nc;
  }
  return out;
}
