// js/euc-rider.js — the player's electric unicycle: EUC Thrills' controller and rider rig, riding New York.
//
// Ownership (EUC_THRILLS_CODE_ARCHITECTURE_GUIDE.md §4, §7, §11):
//   - The city keeps its one variable-dt loop. This module owns a fixed-step accumulator inside it and runs the EUC
//     simulation at SIMULATION.hz (120), at most MAX_CATCH_UP steps per frame; it never starts a loop of its own.
//   - The controller is the authority for where the rider is. The entity's position/heading/speed are written from
//     the interpolated pose every frame for the city's camera, traffic, minimap and HUD; nothing writes them back.
//   - The rig is placed by rig.apply(pose); controllers.js must not copy entity.position into it.
//   - Input: the city's held keys (W/S/A/D, Shift, Space; touch and gamepad blend into the same keys) become an EUC
//     ActionSnapshot. The hop is an edge, buffered for INPUT.actionBufferSeconds and claimed only on a step where the
//     controller can accept it (canAcceptHop / canAcceptSpin), as Game.ts does. keys.reset (R, gamepad B, touch)
//     rights a crashed rider in place.
//   - Per-step edges (hop, landing, kerb/wall impact, crash, recovery) are queued on entity.events for consumers that
//     run once per frame (audio). Consumers call drainEvents(); the queue is capped so nobody has to.
import * as THREE from 'three/webgpu';
import { EucController, createPose, copyPose, lerpPose } from './euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from './euc/input/actions.js';
import { SIMULATION, INPUT } from './euc/data/tuning.js';
import { createRidingRig } from './euc/render/ridingRig.js';
import { riderLook } from './euc/render/riderLook.js';
import { machineLook } from './euc/render/machineLook.js';

const STEP = 1 / SIMULATION.hz;
// The fork's roster: original fictional characters only (js/euc/render/riderLook.js is sliced to these three).
// Trollina rides her own livery of the standard wheel; the cop rides the standard wheel, as upstream's copRider.ts does.
export const RIDERS = Object.freeze({
  'cool-rider': { name: 'Cool Rider', machine: 'standard' },
  trollina: { name: 'Trollina', machine: 'trollina' },
  cop: { name: 'Officer Dorkins', machine: 'standard' }
});
// Who the player may ride. Officer Dorkins is kept for a future chasing character, not as a player.
export const PLAYABLE_RIDERS = Object.freeze(['cool-rider', 'trollina']);
const MAX_EVENTS = 64;
const MAX_CATCH_UP = 5; // the shipped EUC Thrills ceiling (src/app/loop.ts)

// Stock EUC Thrills wheel tuning (owner decision 2026-10-23: kerb hopping matters). Manhattan's curbs are 0.22 m
// (city-config.js ISLAND_BOUNDS.sidewalkHeight); the stock wheel levers itself onto 1.35 x its 0.16 m pedal height
// = 0.216 m, so every curb must be hopped. Rolling into one at >= EUC.obstacleCrashSpeed (3.5 m/s) is a crash.
export const NYC_TUNING = Object.freeze({});

export function isPlayableRider(id) {
  return PLAYABLE_RIDERS.includes(id);
}

function buildRig(scene, riderId) {
  const rig = createRidingRig(riderLook(riderId), machineLook(RIDERS[riderId].machine));
  rig.group.traverse((o) => {
    if (o.isMesh) o.receiveShadow = true; // castShadow is the look's own decision (riderLook.ts rule 3)
  });
  scene.add(rig.group);
  return rig;
}

export function createEucEntity(scene, sampler, { x, z, heading = 0, rider = 'cool-rider', dynamicWorld } = {}) {
  let riderId = Object.hasOwn(RIDERS, rider) ? rider : 'cool-rider';
  const ground = sampler.sampleGround(x, z, { height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false });
  const controller = new EucController(sampler, {
    spawn: { position: { x, y: ground.height, z }, headingY: heading },
    tuning: NYC_TUNING,
    dynamicWorld,
  });
  const previous = createPose();
  const current = createPose();
  const render = createPose();
  controller.writePose(current);
  copyPose(current, previous);
  copyPose(current, render);

  let rig = buildRig(scene, riderId);
  rig.apply(render);

  let accumulator = 0;
  let simSeconds = 0;
  let hopPendingUntil = -1;
  let hopWasHeld = false;
  let resetWasHeld = false;
  let wasCrashed = controller.crashed;
  const events = [];
  const pushEvent = (e) => {
    if (events.length >= MAX_EVENTS) events.shift();
    events.push(e);
  };

  const entity = {
    type: 'euc',
    label: RIDERS[riderId].name,
    riderId,
    mesh: rig.group,
    rig,
    controller,
    events,
    position: new THREE.Vector3(x, ground.height, z),
    heading,
    speed: 0,
    // cameras.js looks at y + offset + 1.55 for riders. Looking at the rider's chest keeps the wheel above the HUD.
    cameraTargetOffset: new THREE.Vector3(0, -0.3, 0),
    chaseDistance: 4.8,
    chaseHeight: 1.9,
    pose: render,

    /** One rendered frame: run the fixed steps this frame owes, then interpolate and pose the rig. */
    update(dt, keys) {
      const throttle = (keys.forward ? Number(keys.forward) : 0) - (keys.backward ? Number(keys.backward) : 0);
      // EUC: positive steer is the rider's right. The city's "left" key turns toward +heading.
      const steer = (keys.right ? Number(keys.right) : 0) - (keys.left ? Number(keys.left) : 0);
      const hopHeld = !!keys.up;
      if (hopHeld && !hopWasHeld) hopPendingUntil = simSeconds + INPUT.actionBufferSeconds;
      hopWasHeld = hopHeld;

      const resetHeld = !!keys.reset;
      if (resetHeld && !resetWasHeld && controller.crashed) {
        // Get up where you fell, unless that is in a pond: then at the last safe spot, as the auto-recovery does
        if (sampler.isWater?.(current.x, current.z)) this.placeAt(controller.safeX, controller.safeZ, controller.safeHeading);
        else this.placeAt(current.x, current.z, current.headingY);
      }
      resetWasHeld = resetHeld;

      accumulator = Math.min(accumulator + dt, MAX_CATCH_UP * STEP);
      while (accumulator >= STEP) {
        accumulator -= STEP;
        let hop = false;
        if (hopPendingUntil >= simSeconds && (controller.canAcceptHop || controller.canAcceptSpin)) {
          hop = true;
          hopPendingUntil = -1;
        }
        copyPose(current, previous);
        controller.step(STEP, {
          ...NEUTRAL_ACTIONS,
          throttle: Math.max(-1, Math.min(1, throttle)),
          steer: Math.max(-1, Math.min(1, steer)),
          crouch: !!keys.boost,
          hop,
          hopHeld,
        });
        controller.writePose(current);
        simSeconds += STEP;
        this.recordEdges();
      }

      lerpPose(previous, current, accumulator / STEP, render);
      rig.applySwing(null, 0, 0);
      rig.setTrickPose(0, 0);
      rig.apply(render);
      rig.applyStatus(render.alert ?? 0, simSeconds, 1 - (render.recoverBlend ?? 0));

      this.position.set(render.x, render.y, render.z);
      this.heading = render.headingY;
      this.speed = render.speed;
    },

    /** Queue this step's one-shot edges for per-frame consumers. */
    recordEdges() {
      if (controller.tookOff) pushEvent({ type: 'hop', charge: controller.lastHopCharge });
      if (controller.touchedDown) {
        pushEvent({ type: 'land', impact: controller.lastLandingImpact, surface: controller.currentSurface });
      }
      if (controller.obstacleImpact > 0) pushEvent({ type: 'impact', speed: controller.obstacleImpact });
      const crashed = controller.crashed;
      if (crashed && !wasCrashed) pushEvent({ type: 'crash', speed: Math.abs(current.speed), rider: riderId });
      else if (!crashed && wasCrashed) pushEvent({ type: 'recover' });
      wasCrashed = crashed;
    },

    /** Take every queued edge since the last call. */
    drainEvents() {
      return events.splice(0, events.length);
    },

    /** Swap the rider (look and machine livery). The controller, and so the ride, carries on unchanged. */
    setRider(id) {
      if (!Object.hasOwn(RIDERS, id) || id === riderId) return false;
      scene.remove(rig.group);
      rig.dispose();
      riderId = id;
      rig = buildRig(scene, riderId);
      rig.apply(render);
      this.rig = rig;
      this.mesh = rig.group;
      this.riderId = riderId;
      this.label = RIDERS[riderId].name;
      return true;
    },

    /** Place the rider (teleport, respawn) and drop the interpolation history so nothing streaks across the city. */
    placeAt(px, pz, h = this.heading) {
      const g = sampler.sampleGround(px, pz, { height: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: false });
      const placed = controller.reset({ position: { x: px, y: g.height, z: pz }, headingY: h });
      controller.writePose(current);
      copyPose(current, previous);
      copyPose(current, render);
      accumulator = 0;
      hopPendingUntil = -1;
      const wasDown = wasCrashed;
      wasCrashed = controller.crashed;
      if (wasDown && !wasCrashed) pushEvent({ type: 'recover' });
      rig.apply(render);
      this.position.set(render.x, render.y, render.z);
      this.heading = render.headingY;
      this.speed = 0;
      return placed;
    },

    clearInput() {
      hopPendingUntil = -1;
      hopWasHeld = false;
      resetWasHeld = false;
    },

    dispose() {
      scene.remove(rig.group);
      rig.dispose();
    },
  };
  return entity;
}
