// js/barricades.js — the line of police barricades where the detailed island ends (the cut, just north of 129th St).
//
// Past the cut, Upper Manhattan is drawn in low detail and is not ridden, so the end of the world is shown instead of
// being an invisible wall: blue wooden sawhorses, "POLICE LINE · DO NOT CROSS", side by side along
// city-config.js NORTH_BARRIER (z, x0..x1), across the island and its seawall coping. The rider's wall stands on the
// same line (euc-terrain.js), and traffic turns back short of it (road-network.js).
//
// One instanced mesh (one material, one canvas texture), made once at start-up; scene-culling.js (main.js) cuts it
// into a few chunks, each culled by the view and by distance.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NORTH_BARRIER } from './city-config.js';

const LENGTH = 2.44; // m: the top board
const SPACING = 2.6; // m between barricade centres
const BOARD = { h: 0.28, t: 0.05, y: 0.95 }; // the top board's height, thickness and centre height
const LEG = { w: 0.09, t: 0.045, at: 1.02, splay: 0.3 }; // A-frame legs: width, thickness, x of each pair, tilt (rad)
const TEXT_V = 0.125; // canvas rows below this v are plain paint (legs, board edges)

function barricadeTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1f4aa8';
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = '800 64px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('POLICE LINE · DO NOT CROSS', 512, 58, 960);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** UVs of every vertex on the plain painted strip (u along, v inside [0, TEXT_V]). */
function paint(g) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.02 + uv.getX(i) * 0.02, TEXT_V * 0.5);
  return g;
}

function barricadeGeometry() {
  // The top board: its two broad faces (+z and -z, BoxGeometry groups 4 and 5) carry the lettering
  const board = new THREE.BoxGeometry(LENGTH, BOARD.h, BOARD.t);
  const uv = board.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4); // px, nx, py, ny, pz, nz
    if (face >= 4) uv.setY(i, TEXT_V + uv.getY(i) * (1 - TEXT_V));
    else uv.setXY(i, 0.02, TEXT_V * 0.5);
  }
  board.translate(0, BOARD.y, 0);
  const parts = [board];
  // A-frame legs at each end, splayed across the line; they meet under the board
  const legLen = (BOARD.y - BOARD.h * 0.5 + 0.06) / Math.cos(LEG.splay);
  for (const x of [-LEG.at, LEG.at]) {
    for (const side of [-1, 1]) {
      const leg = paint(new THREE.BoxGeometry(LEG.w, legLen, LEG.t));
      leg.translate(0, legLen / 2, 0);
      leg.rotateX(side * LEG.splay);
      leg.translate(x, 0, -side * Math.sin(LEG.splay) * legLen); // feet apart, tops together under the board
      parts.push(leg);
    }
    // a brace across each A-frame, low down
    const brace = paint(new THREE.BoxGeometry(LEG.w * 0.8, 0.07, 2 * Math.sin(LEG.splay) * legLen * (1 - 0.32 / (legLen * Math.cos(LEG.splay)))));
    brace.translate(x, 0.32, 0);
    parts.push(brace);
  }
  return mergeGeometries(parts, false);
}

/** The barricades' x positions along NORTH_BARRIER (pure, for tests). */
export function barricadeSites(barrier = NORTH_BARRIER) {
  const n = Math.max(1, Math.floor((barrier.x1 - barrier.x0) / SPACING));
  const step = (barrier.x1 - barrier.x0) / n;
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(barrier.x0 + step * (i + 0.5));
  return xs;
}

export function buildNorthBarricades(scene) {
  const xs = barricadeSites();
  const material = new THREE.MeshStandardNodeMaterial({ map: barricadeTexture(), roughness: 0.72, metalness: 0 });
  const mesh = new THREE.InstancedMesh(barricadeGeometry(), material, xs.length);
  mesh.name = 'NorthBarricades';
  mesh.userData.chunkCull = true; // scene-culling.js cuts the 2.9 km line into chunks, hidden from ~1.8 km
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  xs.forEach((x, i) => {
    // a little set out of line, as barricades stand
    const h = Math.sin(x * 12.9898) * 43758.5453;
    const r = h - Math.floor(h);
    q.setFromAxisAngle(up, (r - 0.5) * 0.06);
    p.set(x, -0.02, NORTH_BARRIER.z + (r - 0.5) * 0.16);
    mesh.setMatrixAt(i, m.compose(p, q, one));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}
