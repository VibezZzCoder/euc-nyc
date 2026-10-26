// Temporary, non-interactive intake vignette. Original props © 2026 VibezZzCoder, MIT (see LICENSE).
// Built/precompiled at startup; no new lights, world bodies or persistent street furniture. Riding is frozen while shown.
import * as THREE from 'three/webgpu';
import { CIVIC_JAIL } from './city-config.js';
import { BOOKING_RULES } from './booking.js';

export const BOOKING_SITE = Object.freeze({ x: CIVIC_JAIL.x, y: 0.22, deskZ: CIVIC_JAIL.z + 39.5,
  riderZ: CIVIC_JAIL.z + 41.6, officerZ: CIVIC_JAIL.z + 38.1 });
export const BOOKING_STAGE = Object.freeze({ minX: CIVIC_JAIL.x - 5, maxX: CIVIC_JAIL.x + 5,
  minZ: CIVIC_JAIL.z + 35.5, maxZ: CIVIC_JAIL.z + 49.5 });

export function createBookingScene(scene, nemesis) {
  const site = BOOKING_SITE;
  const group = new THREE.Group();
  group.name = 'CivicBookingDesk';
  group.position.set(site.x, site.y, site.deskZ);
  group.userData.presentationOnly = true;
  scene.add(group);
  const navy = new THREE.MeshStandardMaterial({ color: 0x263c46, roughness: 0.75 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7e6247, roughness: 0.84 });
  const paper = new THREE.MeshBasicMaterial({ color: 0xf5eddb });
  const ink = new THREE.MeshBasicMaterial({ color: 0x17232c });
  function box(x, y, z, w, h, d, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  box(0, 0.88, 0, 1.9, 0.12, 0.85, wood);
  box(0, 0.46, 0.17, 1.7, 0.8, 0.12, navy);
  for (const x of [-0.8, 0.8]) box(x, 0.43, 0, 0.08, 0.86, 0.65, navy);
  box(-0.24, 0.965, 0, 0.52, 0.04, 0.53, navy);
  const halves = [-1, 1].map((side) => box(-0.24, 0.995, side * 0.11, 0.43, 0.012, 0.215, paper));
  const scribble = box(-0.24, 1.004, 0, 0.32, 0.004, 0.025, ink);
  // A physical work lamp explains the night key. It borrows Dorkins' existing clustered spotlight, not a new light.
  box(0.82, 1.45, 0, 0.045, 1, 0.045, navy);
  box(0.97, 1.95, 0, 0.34, 0.045, 0.045, navy);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 12), navy);
  shade.position.set(1.12, 1.9, 0); group.add(shade);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), new THREE.MeshBasicMaterial({ color: 0xffe2b3, side: THREE.DoubleSide }));
  lens.name = 'booking-desk-lens';
  lens.rotation.x = Math.PI / 2; lens.position.set(1.12, 1.808, 0); group.add(lens);
  const label = document.createElement('canvas');
  label.width = 512; label.height = 128;
  const c = label.getContext('2d');
  c.fillStyle = '#263c46'; c.fillRect(0, 0, 512, 128);
  c.fillStyle = '#f5eddb'; c.textAlign = 'center'; c.font = '700 40px Inter, sans-serif';
  c.fillText('INTAKE', 256, 51);
  c.font = '600 22px Inter, sans-serif'; c.fillText('VEHICLE PROCESSING', 256, 95);
  const texture = new THREE.CanvasTexture(label); texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.275), new THREE.MeshBasicMaterial({ map: texture }));
  sign.position.set(0, 0.52, 0.236); group.add(sign);
  const cameraView = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 52 };
  let wasStaged = false, thumped = false;
  return {
    group,
    cameraView,
    update(dt, state, aspect) {
      const staged = state.phase !== 'idle' && state.phase !== 'captured';
      group.visible = staged;
      if (!staged) { wasStaged = thumped = false; return null; }
      if (!wasStaged) {
        nemesis.beginBooking(site.x, site.y, site.officerZ);
        wasStaged = true;
      }
      const signature = state.phase === 'signature';
      const writing = signature && state.age >= BOOKING_RULES.writeDelay && state.age < BOOKING_RULES.tearSeconds;
      const torn = state.phase === 'released' || (signature && state.age >= BOOKING_RULES.tearSeconds);
      const fall = signature ? Math.max(0, Math.min(1, (state.age - BOOKING_RULES.tearSeconds) / 1.4)) : torn ? 1 : 0;
      halves.forEach((half, i) => {
        const side = i === 0 ? -1 : 1;
        half.position.set(-0.24 + side * fall * 1.7, 0.995 * (1 - fall) + 1.4 * Math.sin(Math.PI * fall), side * (0.11 + fall * 0.25));
        half.rotation.set(Math.sin(Math.PI * fall) * side * 0.45, fall * side * 0.65, Math.sin(Math.PI * fall) * side * 0.55);
        half.visible = true; // visibly fly clear of the tabletop, then stay on the floor until the scene ends
      });
      scribble.visible = writing && state.age > BOOKING_RULES.writeDelay + 0.3;
      scribble.rotation.y = Math.sin(state.age * 30) * 0.3;
      if (torn && !thumped) { nemesis.audioView.hit++; thumped = true; }
      nemesis.presentBooking(dt, { x: site.x - 0.24, y: site.y + 1.03, z: site.deskZ,
        writing, age: state.age,
        light: { x: site.x + 1.12, y: site.y + 1.8, z: site.deskZ } });
      const portrait = aspect < 0.85;
      const close = signature ? Math.min(1, state.age / 0.8) : 0;
      Object.assign(cameraView.position, { x: site.x + 3.8 - close * 1.4, y: site.y + 2.4,
        z: site.deskZ + (portrait ? 6.8 : 5.8) - close * (portrait ? 2 : 1.8) });
      Object.assign(cameraView.target, { x: site.x + (portrait ? 0 : aspect < 2.3 ? 1.2 : 0.6),
        y: site.y + (portrait ? 0.95 : 1.1), z: site.deskZ - 0.15 });
      cameraView.fov = portrait ? 55 : 50;
      return cameraView;
    },
  };
}
