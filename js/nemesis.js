// js/nemesis.js — Officer Dorkins, the chaser, on his police hover-wheel: his look, when he turns up, and his flight.
//
// docs/PLANS.md's "Nemesis", stages (a) to (c): he ambushes and chases, the player can lose him, and close by he swoops
// in with his paddle (js/nemesis-swing.js): confirmed knockdowns add warnings; pursuit continues after recovery.
//   - His machine is the stock wheel restyled (no tyre: a glowing ring in its place, thruster pods under the pedals,
//     a red and blue light bar, police navy paint). He stands on it as the riders do (EUC Thrills' rig, posed by hand).
//   - He flies (js/nemesis-brain.js): over traffic and kerbs, along the streets, low behind the player when close. No
//     collisions with traffic or the player: nothing in the city has to know about him.
//   - Draw calls: his rig casts no shadow-map shadow (it would add ~40 draws over the cascades); a soft round shadow on
//     the ground under him, fading with his height, says where he hovers. His own parts are merged by material.
//   - Everything is made once at start-up, his searchlight included (one spot light, AGENTS.md "Lights"), so the light
//     count and the shaders never change mid-ride. Hidden, he is not updated, his rig is invisible and the light parked.
//   - When he ambushes and when he gives up is js/nemesis-chase.js's (the rules, and the HUD's view of them). He
//     appears out of the player's sight and behind them; giving up, he climbs away into the sky and is gone.
//   - What the player hears of him (siren, sting, hum) is js/nemesis-audio.js's, fed from `audioView` here.
import * as THREE from 'three/webgpu';
import { Fn, uv, vec2, vec4, length, smoothstep, mrt, color, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createPose } from './euc/simulation/EucController.js';
import { PADDLE } from './euc/data/tuning.js';
import { createRidingRig } from './euc/render/ridingRig.js';
import { riderLook } from './euc/render/riderLook.js';
import { machineLook } from './euc/render/machineLook.js';
import { cityUniforms } from './tsl-materials.js';
import { headlightBeamScale } from './vehicle-lights.js';
import { buildPursuitGraph, createFlightBrain, createPursuitMemory, pickSpawnPoint, HOVER } from './nemesis-brain.js';
import { createChaseDirector, chaseHudView, CHASE_RULES } from './nemesis-chase.js';
import { createSwing, sweptHit, SWING } from './nemesis-swing.js';

const PADDLE_FACE = PADDLE.reach * 0.62; // paddle.js: the face's centre, along the shaft from the grip

export const NEMESIS_TIMING = Object.freeze({
  spawnMin: 40, // m: near enough that his siren is on you within seconds of the sting
  spawnMax: 85,
  spawnHeight: 14, // m: he drops in from above the street
  sightSeconds: 0.1, // how often he looks for the player
  leaveClimb: 11, // m/s: giving up, he climbs away...
  leaveClimbAccel: 9, // m/s^2
  leaveDrag: 1.2, // 1/s: ...as his forward speed dies away
});

const SEARCHLIGHT = Object.freeze({ intensity: 260, distance: 40, angle: 0.3, penumbra: 0.6, decay: 1.2 });
const HOVER_LOOK = Object.freeze({
  shell: 0x22314f, // police navy
  glow: 0x46c8ff,
  red: 0xff2a2a,
  blue: 0x2a5bff,
  flashHz: 2.2,
  alarmHz: 7, // the bar races while he winds up a swing
  bob: 0.04, // m of hover bob at rest
});

/** The police hover-wheel: the stock rig with the cop's look, restyled. Returns { rig, update(time, speed) }. */
function createHoverRig() {
  const rig = createRidingRig(riderLook('cop'), machineLook('standard'));
  let paddleMesh = null;
  rig.group.name = 'nemesis-hover-wheel';
  rig.group.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = true;
    if (o.name === 'euc-shell') {
      o.material = o.material.clone(); // the player's rig shares the stock machine's look
      o.material.color.set(HOVER_LOOK.shell);
    }
    if (o.name === 'rider-paddle-mesh') paddleMesh = o;
  });
  rig.euc.tyre.visible = false;

  const glow = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const extras = new THREE.Group();
  extras.name = 'nemesis-hover-parts';
  rig.euc.group.add(extras);
  const radius = 0.25; // where the tyre was (WHEEL.tyreDiameter / 2)
  // The energy ring and its field, in the tyre's plane (y-z)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.86, 0.028, 10, 48),
    new THREE.MeshStandardMaterial({ color: 0x0b1020, emissive: HOVER_LOOK.glow, emissiveIntensity: 3, roughness: 0.4 }));
  ring.rotation.y = Math.PI / 2;
  ring.position.y = radius;
  const field = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.84, 40), glow(HOVER_LOOK.glow, 0.22));
  field.rotation.y = Math.PI / 2;
  field.position.y = radius;
  extras.add(ring, field);
  // Thruster pods under the pedals, each with a downward exhaust (wide at the nozzle, its tip 0.28 m below; longer and
  // brighter read as icicles by day, owner 2026-10-24); one mesh for both pods, one for both exhausts (the exhausts sit
  // at y 0 of theirs, so scaling it stretches both downward)
  const pods = new THREE.Mesh(mergeGeometries([-1, 1].map((side) =>
    new THREE.CylinderGeometry(0.055, 0.07, 0.1, 14).translate(side * 0.19, 0.09, 0))),
  new THREE.MeshStandardMaterial({ color: 0x1a2236, metalness: 0.6, roughness: 0.35 }));
  const exhaust = new THREE.Mesh(mergeGeometries([-1, 1].map((side) =>
    new THREE.ConeGeometry(0.05, 0.28, 14, 1, true).rotateX(Math.PI).translate(side * 0.19, -0.14, 0))),
  glow(HOVER_LOOK.glow, 0.35));
  exhaust.position.y = 0.04;
  extras.add(pods, exhaust);
  // The light bar on top of the shell, flashing red, then blue
  const barMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: HOVER_LOOK.red, emissiveIntensity: 6, roughness: 0.3 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.2), barMaterial);
  bar.position.set(0, 0.64, 0);
  rig.euc.body.add(bar);
  const red = new THREE.Color(HOVER_LOOK.red);
  const blue = new THREE.Color(HOVER_LOOK.blue);
  rig.group.traverse((o) => {
    o.castShadow = false;
  });

  return {
    rig,
    paddleMesh,
    /** Flash the bar (racing when `alarm`), flicker the exhausts with his speed. */
    update(time, speed, alarm = false) {
      barMaterial.emissive.copy((time * (alarm ? HOVER_LOOK.alarmHz : HOVER_LOOK.flashHz)) % 1 < 0.5 ? red : blue);
      const thrust = 0.75 + Math.min(1, speed / HOVER.cruiseSpeed) * 0.6;
      exhaust.scale.set(1, thrust * (0.92 + 0.08 * Math.sin(time * 37)), 1);
    },
  };
}

/** A soft round shadow on the ground under him: one quad, darkest at its centre. */
function createHoverShadow() {
  const strength = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const opacity = Fn(() => smoothstep(1.0, 0.15, length(uv().sub(vec2(0.5, 0.5)).mul(2.0))).mul(strength))();
  material.colorNode = color(0x020305);
  material.opacityNode = opacity;
  // as the cars' contact shadows (tsl-materials.js): no normal, and it damps the wet road's reflections under it
  material.mrtNode = mrt({ normal: vec4(0.0, 0.0, 0.0, 0.0), metalRough: vec4(0.0, 1.0, 0.0, opacity.mul(0.88)) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
  mesh.name = 'nemesis-shadow';
  mesh.renderOrder = 1;
  return {
    mesh,
    /** Under (x, z) on ground `ground`, for his machine's bottom `height` m above it. */
    place(x, ground, z, height) {
      const h = Math.max(0, height);
      const size = 1.1 + h * 0.15;
      mesh.position.set(x, ground + 0.03, z);
      mesh.scale.set(size, 1, size);
      strength.value = 0.6 * Math.max(0, 1 - h / 12);
    },
  };
}

export function createNemesis({ scene, sampler, network, getPlayer, camera }) {
  const graph = buildPursuitGraph(network);
  const probe = { height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false };
  const groundAt = (x, z) => sampler.sampleGround(x, z, probe).height;
  const origin = { x: 0, y: 0, z: 0 };
  const direction = { x: 0, y: 0, z: 0 };
  const clearLine = (x0, y0, z0, x1, y1, z1) => {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.5) return true;
    origin.x = x0;
    origin.y = y0;
    origin.z = z0;
    direction.x = dx / length;
    direction.y = dy / length;
    direction.z = dz / length;
    return sampler.raycast(origin, direction, length) === null;
  };
  const brain = createFlightBrain(graph, { groundAt, clearLine });
  const memory = createPursuitMemory(graph);

  const hover = createHoverRig();
  const { rig } = hover;
  scene.add(rig.group);
  const shadow = createHoverShadow();
  scene.add(shadow.mesh);
  const pose = createPose();
  // Made at a road node now, visible for the first (warm-up) frame so his materials compile behind the loading screen
  const start = Math.max(0, graph.nearest(0, 0, 4096));
  brain.place(graph.xs[start], 2, graph.zs[start], 0);

  const searchlight = new THREE.SpotLight(0xe8f2ff, 0, SEARCHLIGHT.distance, SEARCHLIGHT.angle, SEARCHLIGHT.penumbra, SEARCHLIGHT.decay);
  searchlight.name = 'nemesis-searchlight';
  searchlight.castShadow = false;
  scene.add(searchlight, searchlight.target);
  const parkLight = () => {
    searchlight.intensity = 0;
    searchlight.position.set(0, -1000, 0);
    searchlight.target.position.set(0, -1001, 0);
  };
  parkLight();

  const target = { x: 0, y: 0, z: 0, vx: 0, vz: 0, heading: 0 };
  const swing = createSwing();
  const swingHead = new THREE.Vector3();
  const face = new THREE.Vector3();
  const lastFace = new THREE.Vector3();
  const quarry = { x: 0, z: 0, bottom: 0 };
  const lastQuarry = { x: 0, z: 0, bottom: 0 };
  let quarryEntity = null;
  let faceValid = false;
  let struck = false;
  const director = createChaseDirector();
  const facts = { riding: false, crashed: false, distance: Infinity, sees: false, inView: false };
  const audioView = { present: false, chasing: false, x: 0, z: 0, range: Infinity, closing: 0, speed: 0, chaseTime: 0,
    sting: 0, windup: 0, swing: 0, hit: 0, swinging: false, pan: 0 };
  let sightIn = 0;
  let lastRange = Infinity;
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
  let frames = 0;
  let time = 0;

  function inFrustum(x, y, z, radius) {
    if (!camera) return false;
    sphere.center.set(x, y, z);
    sphere.radius = radius;
    if (sphere.center.distanceTo(camera.position) > 250) return false;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    return frustum.intersectsSphere(sphere);
  }
  // Spawning: would the player see him drop in at (x, z)? (In the camera's view, and not behind a building.)
  function visibleAt(x, z) {
    const g = groundAt(x, z), h = NEMESIS_TIMING.spawnHeight;
    if (!inFrustum(x, g + h / 2, z, h / 2 + 1.5)) return false;
    const c = camera.position;
    return clearLine(c.x, c.y, c.z, x, g + 1.5, z) || clearLine(c.x, c.y, c.z, x, g + h, z);
  }

  // Giving up: straight up and away (up is always clear over a street), his forward speed dying away
  function leave(dt) {
    const f = brain.state;
    f.vy = Math.min(NEMESIS_TIMING.leaveClimb, f.vy + NEMESIS_TIMING.leaveClimbAccel * dt);
    const drag = Math.exp(-dt * NEMESIS_TIMING.leaveDrag);
    f.vx *= drag;
    f.vz *= drag;
    const nx = f.x + f.vx * dt, nz = f.z + f.vz * dt, ny = f.y + f.vy * dt;
    if (groundAt(nx, nz) <= ny) {
      f.x = nx;
      f.z = nz;
    } else f.vx = f.vz = 0;
    f.y = ny;
    f.speed = Math.hypot(f.vx, f.vz);
    const ease = 1 - Math.exp(-dt * 3);
    f.bank -= f.bank * ease;
    f.pitch += (-0.15 - f.pitch) * ease;
    f.mode = 'leaving';
    return f;
  }

  function pose_(f) {
    const slow = 1 - Math.min(1, f.speed / 3);
    pose.x = f.x;
    pose.y = f.y + HOVER_LOOK.bob * slow * Math.sin(time * 2.3);
    pose.z = f.z;
    pose.headingY = f.heading;
    pose.speed = f.speed;
    // Swinging, he crouches and leans out over his paddle side (his right: a negative roll), to swat low
    const commit = swing.commitment;
    pose.crouch = commit;
    pose.tuck = commit;
    pose.rollAngle = f.bank - SWING.leanRoll * commit;
    pose.riderRoll = f.bank - SWING.leanRoll * commit;
    pose.wheelPitch = f.pitch;
    pose.riderPitch = f.pitch * 0.5;
    rig.setTrickPose(0, 0);
    // He carries his paddle (commitment 0) and swings it, as EUC Thrills' cop does: recorded before the stance is solved
    swing.headTarget(pose.x, pose.y, pose.z, pose.headingY, swingHead);
    rig.applySwing(swingHead, swing.angle, swing.commitment);
    rig.apply(pose);
    rig.applyStatus(0, time, 1);
    hover.update(time, f.speed, swing.phase === 'windup');
    const ground = groundAt(f.x, f.z);
    shadow.place(f.x, ground, f.z, f.y - ground);
  }
  pose_(brain.state);

  const nemesis = {
    rig,
    brain,
    memory,
    graph,
    searchlight,
    director,
    audioView,
    active: false,
    /** What the HUD shows (nemesis-chase.js chaseHudView). */
    get hudView() {
      return chaseHudView(director.state, facts.distance, CHASE_RULES, swing.phase);
    },
    swing,
    /** Presentation only: booking owns his pose; no hit tests or flight while at the intake desk. */
    beginBooking(x, y, z) {
      brain.place(x, y, z, 0);
      swing.cancel(0);
      faceValid = false;
      nemesis.active = true;
      rig.group.visible = shadow.mesh.visible = true;
      audioView.present = true;
      audioView.chasing = audioView.swinging = false;
      parkLight();
    },
    presentBooking(dt, action) {
      time += dt;
      const f = brain.state;
      pose_(f);
      if (action.writing) {
        pose.crouch = 0.12;
        pose.riderPitch = 0.08;
        swingHead.set(action.x + Math.sin(action.age * 24) * 0.09,
          action.y + Math.abs(Math.sin(action.age * 12)) * 0.04, action.z);
        rig.applySwing(swingHead, 0.45, 0.8);
        rig.apply(pose);
      }
      audioView.x = f.x; audioView.z = f.z; audioView.speed = 0;
      const p = getPlayer();
      audioView.range = Math.hypot(p.position.x - f.x, p.position.z - f.z);
      const beam = headlightBeamScale(cityUniforms.uInteriorGlow.value);
      if (beam > 0.001) {
        searchlight.position.set(action.light.x, action.light.y, action.light.z);
        searchlight.target.position.set(f.x - 0.1, f.y + 1.05, f.z);
        searchlight.angle = 0.95; searchlight.penumbra = 0.85; searchlight.distance = 8; searchlight.decay = 2;
        searchlight.color.set(0xffe0b0);
        searchlight.intensity = 8 * beam;
      } else parkLight();
    },
    /** Ambush on the next frame (testing and QA). */
    ambushSoon() {
      director.soon();
    },
    get position() {
      return brain.state;
    },

    /** True when the camera could see him (his bounding sphere is in its frustum, within 250 m). */
    inView() {
      const f = brain.state;
      return inFrustum(f.x, f.y + 1, f.z, 1.5);
    },

    hide() {
      nemesis.active = false;
      rig.group.visible = false;
      shadow.mesh.visible = false;
      parkLight();
      searchlight.angle = SEARCHLIGHT.angle; searchlight.penumbra = SEARCHLIGHT.penumbra;
      searchlight.distance = SEARCHLIGHT.distance; searchlight.decay = SEARCHLIGHT.decay;
      searchlight.color.set(0xe8f2ff);
      audioView.present = audioView.chasing = false;
      audioView.range = Infinity;
      faceValid = false;
    },

    /** Appear where the player would not see him drop in, behind them, above a street, facing them. */
    spawn() {
      const p = getPlayer();
      // The road graph is sparse in places (along and inside Central Park): widen the ring until a point fits
      let spot = null;
      for (const scale of [1, 2, 3, 5]) {
        spot = pickSpawnPoint(graph, { x: p.position.x, z: p.position.z, heading: p.heading }, {
          minDistance: scale === 1 ? NEMESIS_TIMING.spawnMin : 40,
          maxDistance: NEMESIS_TIMING.spawnMax * scale,
          visible: visibleAt,
          // an open flight from there to above the player: no 300 m round a Manhattan block
          open: (x, z) => clearLine(x, groundAt(x, z) + NEMESIS_TIMING.spawnHeight, z,
            p.position.x, groundAt(p.position.x, p.position.z) + HOVER.highAltitude, p.position.z),
          isUsable: (x, z) => !sampler.isOffLimits(x, z),
        });
        if (spot) break;
      }
      if (!spot) return false;
      const { x, z } = spot;
      brain.place(x, groundAt(x, z) + NEMESIS_TIMING.spawnHeight, z, Math.atan2(p.position.x - x, p.position.z - z));
      rig.group.visible = true;
      shadow.mesh.visible = true;
      nemesis.active = true;
      sightIn = 0;
      facts.sees = false;
      memory.seed({ x: p.position.x, y: p.position.y, z: p.position.z, vx: 0, vz: 0, heading: p.heading });
      lastRange = Infinity;
      swing.cancel(0);
      faceValid = false;
      return true;
    },

    /** One frame. `riding` is false while the title screen holds the game. */
    update(dt, riding) {
      frames++;
      if (frames === 2) nemesis.hide(); // after the warm-up frame
      if (frames < 2) return;
      if (!riding) return; // title, full map and hidden tab freeze the pursuit, including its escape clocks
      const p = getPlayer();
      facts.riding = riding;
      facts.crashed = !!p.controller?.crashed;
      if (!nemesis.active) {
        facts.distance = Infinity;
        facts.sees = facts.inView = false;
        if (director.update(dt, facts) === 'ambush') {
          if (nemesis.spawn()) audioView.sting++;
          else director.postpone();
        }
        return;
      }
      time += dt;
      target.x = p.position.x;
      target.y = sampler.sampleGround(p.position.x, p.position.z, probe, p.position.y).height;
      target.z = p.position.z;
      target.vx = Math.sin(p.heading) * p.speed;
      target.vz = Math.cos(p.heading) * p.speed;
      target.heading = p.heading;
      const chasing = director.state.phase === 'chasing';
      const before = brain.state;
      facts.distance = Math.hypot(target.x - before.x, target.z - before.z);
      sightIn -= dt;
      if (sightIn <= 0) {
        sightIn = NEMESIS_TIMING.sightSeconds;
        facts.sees = chasing && facts.distance <= CHASE_RULES.sightRange
          && clearLine(before.x, before.y + 0.9, before.z, target.x, target.y + 1.2, target.z);
      }
      const pursuit = memory.update(dt, target, facts.sees, before);

      // The paddle swoop: close, in sight, the player up and not getting away; called off if they go down another way
      if (chasing && swing.ready && director.state.acquired && facts.sees && facts.distance <= SWING.triggerRange
        && !facts.crashed && director.state.recovery <= 0 && Math.abs(p.speed) <= SWING.maxQuarrySpeed) {
        swing.start();
        struck = false;
        audioView.windup++;
      } else if (swing.phase === 'windup' && (facts.crashed || !facts.sees || !chasing)) swing.cancel();
      if (swing.update(dt) === 'strike') audioView.swing++;
      const striking = swing.contact.from <= swing.contact.to;

      let f;
      if (chasing && (swing.phase === 'windup' || swing.phase === 'active' || striking)) {
        f = brain.swoop(dt, target, { lateral: SWING.lateral, height: SWING.swoopHeight, commit: swing.phase !== 'windup' });
      } else if (chasing) f = brain.update(dt, pursuit);
      else f = leave(dt);
      pose_(f);

      // Sweep BOTH drawn poses over the same striking interval, including a frame that ends in recovery.
      const paddleMesh = hover.paddleMesh;
      if (paddleMesh) {
        paddleMesh.updateWorldMatrix(true, false);
        face.set(0, 0, PADDLE_FACE).applyMatrix4(paddleMesh.matrixWorld);
        quarry.x = p.position.x;
        quarry.z = p.position.z;
        quarry.bottom = p.position.y;
        // A teleport/rider replacement has no swept travel path. Ordinary riding moves < 2 m at the frame-dt cap.
        if (quarryEntity !== p || Math.hypot(quarry.x - lastQuarry.x, quarry.bottom - lastQuarry.bottom, quarry.z - lastQuarry.z) > 5) faceValid = false;
        if (chasing && striking && faceValid && !struck && !p.controller?.crashed) {
          if (sweptHit(lastFace.x, lastFace.y, lastFace.z, face.x, face.y, face.z, quarry, SWING, lastQuarry, swing.contact)) {
            if (p.controller?.hardKnock?.(face.x - lastFace.x, face.z - lastFace.z)) {
              struck = true;
              audioView.hit++;
              director.knockedDown();
              facts.crashed = true;
            }
          }
        }
        lastFace.copy(face);
        lastQuarry.x = quarry.x; lastQuarry.z = quarry.z; lastQuarry.bottom = quarry.bottom;
        quarryEntity = p;
        faceValid = paddleMesh.parent?.visible !== false;
      }

      // At night, light his known/search target, never track a hidden rider through a wall.
      const beam = chasing ? headlightBeamScale(cityUniforms.uInteriorGlow.value) : 0;
      if (beam > 0.001) {
        searchlight.position.set(f.x, f.y + 0.1, f.z);
        searchlight.target.position.set(pursuit.x, pursuit.y, pursuit.z);
        searchlight.intensity = SEARCHLIGHT.intensity * beam;
      } else if (searchlight.intensity !== 0) parkLight();

      const distance = Math.hypot(target.x - f.x, target.z - f.z);
      facts.distance = distance;
      facts.inView = director.state.phase === 'leaving' && nemesis.inView();
      const event = director.update(dt, facts);
      if (event === 'gone') {
        nemesis.hide();
        return;
      }

      const range = Math.hypot(distance, f.y - target.y);
      audioView.present = true;
      audioView.chasing = director.state.phase === 'chasing';
      audioView.x = f.x;
      audioView.z = f.z;
      const closing = Number.isFinite(lastRange) ? (lastRange - range) / dt : 0;
      audioView.closing += (closing - audioView.closing) * (1 - Math.exp(-dt * 4));
      lastRange = range;
      audioView.range = range;
      audioView.speed = f.speed;
      audioView.chaseTime = director.state.chaseTime;
      audioView.swinging = swing.phase === 'windup' || swing.phase === 'active';
    },
  };
  return nemesis;
}
