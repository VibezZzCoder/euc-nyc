// Original fictional exterior at the historic Tombs site. Geometry and rider bodies share dimensions.
import * as THREE from 'three/webgpu';
import { positionWorld, texture as sampleTexture, vec2 } from 'three/tsl';
import { CIVIC_JAIL } from './city-config.js';
import { cityUniforms } from './tsl-materials.js';
import { headlightBeamScale } from './vehicle-lights.js';
import { batchStaticGroupMeshes } from './city-grid.js';

export function buildCivicJail(parent, rideBuilder) {
  const site = CIVIC_JAIL;
  const group = new THREE.Group();
  group.name = 'CivicDetention';
  group.position.set(site.x, 0, site.z);
  parent.add(group);
  const structure = new THREE.Group();
  const details = new THREE.Group();
  group.add(structure, details);
  const stone = new THREE.MeshStandardNodeMaterial({ color: 0xb9b5a9, roughness: 0.88 });
  // A small mipmapped, staggered ashlar tile gives the austere walls the city's masonry vocabulary.
  const masonry = document.createElement('canvas');
  masonry.width = masonry.height = 512;
  const mc = masonry.getContext('2d');
  mc.fillStyle = '#77766e'; mc.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) {
    const tone = ((row * 19 + ((col + 4) % 4) * 31) % 11) - 5;
    mc.fillStyle = `rgb(${185 + tone},${181 + tone},${169 + tone})`;
    mc.fillRect(col * 128 + (row % 2) * 64 + 1, row * 64 + 1, 126, 62);
    mc.fillStyle = 'rgba(255,255,245,0.10)';
    mc.fillRect(col * 128 + (row % 2) * 64 + 2, row * 64 + 2, 124, 1);
  }
  const masonryTexture = new THREE.CanvasTexture(masonry);
  masonryTexture.colorSpace = THREE.SRGBColorSpace;
  masonryTexture.wrapS = masonryTexture.wrapT = THREE.RepeatWrapping;
  stone.colorNode = sampleTexture(masonryTexture, vec2(positionWorld.x.add(positionWorld.z), positionWorld.y).mul(0.125)).rgb;
  const trim = new THREE.MeshStandardNodeMaterial({ color: 0xd4cdbc, roughness: 0.78 });
  const roof = new THREE.MeshStandardNodeMaterial({ color: 0x60635f, roughness: 0.94 });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x343e42, roughness: 0.64, metalness: 0.45 });
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x15242b, roughness: 0.3, metalness: 0.12 });
  const lamp = new THREE.MeshStandardNodeMaterial({ color: 0xf5dfaa, emissive: 0xffd292, emissiveIntensity: 0.6, roughness: 0.6 });
  function box(x, y, z, w, h, d, material, solid = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    // Structural masses cast the silhouette; centimetre-scale bars/trim stay in the visible mesh only.
    mesh.castShadow = solid || (w > 1 && h > 1 && d > 1);
    mesh.receiveShadow = true;
    (mesh.castShadow ? structure : details).add(mesh);
    if (solid && rideBuilder) {
      const body = rideBuilder.addRideSolid(site.x + x, site.z + z, w, d, y - h / 2, y + h / 2, 0, true);
      body.layered = true;
    }
    return mesh;
  }
  for (const p of site.parts) box(p.x, (p.bottom + p.top) / 2, p.z, p.w, p.top - p.bottom, p.d, stone, true);

  // Shallow masonry bands stay close to the structural wall; repeated barred openings read at riding distance.
  for (const y of [3.6, 11.8]) box(0, y, 0, 52.3, 0.35, 66.3, trim);
  // The base course wraps the walls, but stops at the outside edges of the entrance surround.
  // A single full-width box projects ahead of the door faces and looks like a bar across them.
  box(0, 0.6, -33.075, 52.3, 0.35, 0.15, trim);
  for (const side of [-1, 1]) {
    box(side * 26.075, 0.6, 0, 0.15, 0.35, 66.3, trim);
    box(side * 14.275, 0.6, 33.075, 23.75, 0.35, 0.15, trim);
  }
  for (let y = 14; y < 50; y += 4) box(0, y, -4, 40.1, 0.12, 50.1, trim);
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-0.9, -1.13); frameShape.lineTo(0.9, -1.13); frameShape.lineTo(0.9, 1.13); frameShape.lineTo(-0.9, 1.13); frameShape.closePath();
  const opening = new THREE.Path();
  opening.moveTo(-0.725, -0.95); opening.lineTo(-0.725, 0.95); opening.lineTo(0.725, 0.95); opening.lineTo(0.725, -0.95); opening.closePath();
  frameShape.holes.push(opening);
  const frameGeometry = new THREE.ExtrudeGeometry(frameShape, { depth: 0.22, bevelEnabled: false, steps: 1 });
  function windowFrame(x, y, z, yaw) {
    const mesh = new THREE.Mesh(frameGeometry, trim);
    mesh.position.set(x, y, z); mesh.rotation.y = yaw;
    mesh.receiveShadow = true;
    details.add(mesh);
  }
  for (const y of [16, 20, 24, 28, 32, 36, 40, 44, 48]) {
    for (const side of [-1, 1]) {
      for (let x = -16; x <= 16; x += 4) {
        windowFrame(x, y, -4 + side * 25, side > 0 ? 0 : Math.PI);
        box(x, y, -4 + side * 25.05, 1.45, 1.9, 0.1, glass);
        for (const dx of [-0.45, 0, 0.45]) box(x + dx, y, -4 + side * 25.15, 0.065, 2, 0.075, steel);
      }
      for (let z = -24; z <= 16; z += 4) {
        windowFrame(side * 20, y, z, side * Math.PI / 2);
        box(side * 20.05, y, z, 0.1, 1.9, 1.45, glass);
        for (const dz of [-0.45, 0, 0.45]) box(side * 20.15, y, z + dz, 0.075, 2, 0.065, steel);
      }
    }
  }
  for (const x of [-19.2, -10, 10, 19.2]) box(x, 31.2, -4, 0.45, 38, 50.4, trim);
  box(0, 50.4, -4, 40.5, 0.36, 50.5, trim);
  box(0, 50.62, -4, 39.6, 0.08, 49.6, roof, true);
  box(0, 12.27, 0, 51.4, 0.1, 65.4, roof, true);
  for (const side of [-1, 1]) {
    box(side * 19.9, 51, -4, 0.4, 0.8, 50, trim, true);
    box(0, 51, -4 + side * 24.9, 39.4, 0.8, 0.4, trim, true);
  }
  box(-9, 51.8, -8, 8, 2.4, 12, steel);
  box(8, 51.1, -15, 7, 1, 5, steel);
  for (let y = 51; y <= 52.6; y += 0.4) box(-9, y, -1.96, 7, 0.08, 0.08, trim);

  // White Street entrance: a closed intake door and an open-sided canopy, with a clear forecourt.
  box(0, 1.7, 33.06, 3.6, 2.96, 0.12, steel);
  box(0, 1.7, 33.14, 0.08, 2.96, 0.05, trim);
  for (const x of [-2.15, 2.15]) box(x, 1.8, 33, 0.5, 3.16, 0.28, trim);
  box(0, 3.25, 33, 4.8, 0.35, 0.28, trim);
  for (const x of [-0.25, 0.25]) box(x, 1.4, 33.18, 0.045, 0.42, 0.06, trim);
  for (const x of [-1.1, 1.1]) box(x, 2.2, 33.14, 0.8, 0.6, 0.06, glass);
  box(0, 3.55, 34, 8.4, 0.3, 2.8, steel, true);
  // Surface-mounted canopy downlight: the emitting lens and spotlight share the same physical source.
  box(0, 3.33, 34.6, 1.4, 0.14, 0.65, steel);
  box(0, 3.245, 34.6, 1.2, 0.03, 0.45, lamp);
  for (const x of [-3.8, 3.8]) box(x, 1.83, 34.8, 0.35, 3.22, 0.35, steel, true);
  for (const x of [-6, 6]) box(x, 3.1, 33.18, 0.65, 0.3, 0.24, lamp);
  for (const side of [-1, 1]) for (let z = -27; z <= 25; z += 6) {
    box(side * 26.06, 7.6, z, 0.12, 1.7, 1.1, glass);
    for (const dz of [-0.33, 0, 0.33]) box(side * 26.16, 7.6, z + dz, 0.08, 1.8, 0.06, steel);
  }
  for (const x of [-21, -15, 15, 21]) {
    box(x, 7.6, 33.06, 1.1, 1.7, 0.12, glass);
    for (const dx of [-0.33, 0, 0.33]) box(x + dx, 7.6, 33.16, 0.06, 1.8, 0.08, steel);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 172;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c3038'; ctx.fillRect(0, 0, 1024, 172);
  ctx.strokeStyle = '#d7bd7b'; ctx.lineWidth = 10; ctx.strokeRect(8, 8, 1008, 156);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f4ead1'; ctx.font = '700 68px Inter, Arial, sans-serif';
  ctx.fillText('CIVIC DETENTION', 512, 70, 950);
  ctx.fillStyle = '#d7bd7b'; ctx.font = '600 26px Inter, Arial, sans-serif';
  ctx.fillText('INTAKE / RELEASE · WHITE ST', 512, 131, 920);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.MeshStandardNodeMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.8 });
  box(0, 4.4, 33.13, 8, 1.34375, 0.16, sign);
  // One fixed, unshadowed clustered light: keep intake readable at night without another render pass.
  const entranceLight = new THREE.SpotLight(0xffe0ad, 0, 12, 1.1, 0.95, 2);
  entranceLight.position.set(0, 3.215, 34.6);
  entranceLight.target.position.set(0, 1, 33);
  group.add(entranceLight, entranceLight.target);
  // Keep local bounds and separate shadow flags; the city-wide batcher would otherwise merge both back together.
  batchStaticGroupMeshes(structure);
  batchStaticGroupMeshes(details);
  return {
    group,
    materials: new Set([stone, trim, roof, steel, glass, lamp, sign]),
    update(cameraPosition) {
      const near = Math.hypot(cameraPosition.x - site.x, cameraPosition.z - site.z) < 1200;
      details.visible = near; // sub-pixel window bars/frames; the entire architectural silhouette stays visible
      const beam = headlightBeamScale(cityUniforms.uInteriorGlow.value);
      lamp.emissiveIntensity = 1.2 * beam;
      entranceLight.intensity = near ? 40 * beam : 0;
      entranceLight.position.y = entranceLight.intensity > 0 ? 3.215 : -1000;
    }
  };
}
