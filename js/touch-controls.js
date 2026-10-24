// js/touch-controls.js — EUC Thrills' touch controls, in the city.
//
// Ported from EUC Thrills @5f45fff (src/input/touch.ts, src/ui/touchControls.ts, the .euc-touch rules in
// src/ui/game.css): one floating stick and a thumb cluster, the same anatomy in portrait and landscape.
//   - The stick lives in an invisible zone over the bottom-left of the screen. It appears under the finger where it
//     lands (floating origin). Up leans forward, down brakes and reverses, sideways carves. Each axis has its own
//     5 px dead zone, a 1.35 power curve and full travel at 84 px (INPUT.touchStick*, vendored tuning).
//   - HOP (Space) and CHARGE (Shift: crouch, which charges a bigger hop) sit under the right thumb. GET UP (R) appears
//     in the cluster only while the rider is down.
//   - Pointer Events. Each finger owns at most one control until it lifts, so a second finger never steals the stick or
//     a button. Release goes by pointer id on window, so a finger that slides off can never leave a control stuck.
//   - Touch input stays separate from the keyboard (controllers.js blends the strongest), so lifting a finger never
//     releases a held key. Drags outside the controls still orbit and pinch the camera (cameras.js).
// The fork keeps its own action names: forward / backward / left / right (0..1), up (hop), boost (crouch), reset.
import { INPUT } from './euc/data/tuning.js';

/** Signed 0..1 intent from a finger displacement in CSS px (EUC Thrills touch.ts axisFromDisplacement). */
export function axisFromDisplacement(displacementPx, travelPx = INPUT.touchStickTravelPx,
  deadZonePx = INPUT.touchStickDeadZonePx, curve = INPUT.touchStickCurve) {
  if (!Number.isFinite(displacementPx)) return 0;
  const magnitude = Math.abs(displacementPx);
  if (!(magnitude > deadZonePx)) return 0;
  const span = Math.max(1, travelPx - deadZonePx);
  const normalised = Math.min(1, (magnitude - deadZonePx) / span);
  const shaped = curve === 1 ? normalised : Math.pow(normalised, curve);
  return displacementPx < 0 ? -shaped : shaped;
}

/**
 * Stick intent from the finger's origin and current point. Screen Y grows down: pulling down brakes. Full steering
 * stays reachable when the stick lands near a screen edge (travel shrinks to the room available, touch.ts steerTravel).
 */
export function stickAxes(originX, originY, x, y, viewportWidth = Infinity, travelPx = INPUT.touchStickTravelPx) {
  const dx = x - originX;
  let steerTravel = travelPx;
  if (Number.isFinite(viewportWidth) && viewportWidth > 0) {
    const room = dx < 0 ? originX : viewportWidth - originX;
    if (Number.isFinite(room) && room > 0) steerTravel = Math.min(travelPx, Math.max(INPUT.touchStickDeadZonePx, room));
  }
  return {
    steer: axisFromDisplacement(dx, steerTravel),
    throttle: axisFromDisplacement(originY - y, travelPx)
  };
}

const BUTTON_ACTIONS = new Set(['up', 'boost', 'reset']);

class TouchControls {
  constructor(controllerManager) {
    this.controller = controllerManager;
    this.root = document.getElementById('touch-controls');
    this.stick = document.getElementById('touch-stick');
    this.enabled = true;
    this.available = false;
    this.touchSeen = false;
    this.down = false;
    this.onAvailabilityChange = null;
    this.stickPointer = null;
    this.origin = { x: 0, y: 0 };
    this.axes = { throttle: 0, steer: 0 };
    this.buttonPointers = new Map(); // pointerId -> { element, action }
    this.media = window.matchMedia('(any-pointer: coarse)');
    if (!this.root || !this.stick) return;

    this.root.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    for (const type of ['pointerup', 'pointercancel']) {
      window.addEventListener(type, (event) => this.release(event.pointerId), { passive: true });
    }
    window.addEventListener('pointermove', (event) => this.onPointerMove(event), { passive: true });
    this.root.addEventListener('lostpointercapture', (event) => this.release(event.pointerId));
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());

    this.media.addEventListener('change', () => this.updateAvailability());
    // Hybrid devices can report a fine pointer until their first touch. Capture runs before the control handlers.
    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' || this.touchSeen) return;
      this.touchSeen = true;
      this.updateAvailability();
    }, { capture: true, passive: true });
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('resize', () => this.reset()); // a rotation moves every control: drop all fingers
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });

    this.updateAvailability();
  }

  canInteract() {
    return this.enabled && this.available && !document.hidden;
  }

  updateAvailability() {
    const available = this.media.matches || this.touchSeen;
    const changed = available !== this.available;
    if (changed) this.reset();
    this.available = available;
    document.body.classList.toggle('touch-enabled', available);
    if (this.root) this.root.hidden = !this.enabled || !available;
    if (changed && typeof this.onAvailabilityChange === 'function') this.onAvailabilityChange(available);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.reset();
    if (this.root) this.root.hidden = !this.enabled || !this.available;
  }

  /** The EUC is the only mode. Kept for main.js. */
  setMode() {
    this.reset();
  }

  /** GET UP shows in the thumb cluster only while the rider is down (main.js calls this every frame). */
  setDown(down) {
    const value = Boolean(down);
    if (value === this.down || !this.root) return;
    this.down = value;
    this.root.dataset.down = String(value);
    if (!value) {
      // a finger still on GET UP must not leave reset held into the next crash
      for (const [id, owned] of this.buttonPointers) if (owned.action === 'reset') this.release(id);
    }
  }

  onPointerDown(event) {
    if (!this.canInteract()) return;
    const element = event.target instanceof Element ? event.target.closest('[data-touch]') : null;
    if (!element || !this.root.contains(element)) return;
    const control = element.dataset.touch;
    event.preventDefault();
    let accepted = false;
    if (control === 'stick') {
      // The stick is for fingers and pens; a mouse in the zone does nothing (desktop users have the keyboard)
      if (event.pointerType !== 'mouse' && this.stickPointer === null && !this.buttonPointers.has(event.pointerId)) {
        this.stickPointer = event.pointerId;
        this.origin = { x: event.clientX, y: event.clientY };
        this.root.style.setProperty('--touch-x', String(Math.round(event.clientX)));
        this.root.style.setProperty('--touch-y', String(Math.round(event.clientY)));
        this.stick.dataset.active = 'true';
        this.writeStick(0, 0);
        accepted = true;
      }
    } else if (BUTTON_ACTIONS.has(control)) {
      const busy = [...this.buttonPointers.values()].some((owned) => owned.element === element);
      if (!busy && event.pointerId !== this.stickPointer && !this.buttonPointers.has(event.pointerId)) {
        this.buttonPointers.set(event.pointerId, { element, action: control });
        element.dataset.pressed = 'true';
        this.controller.setTouchInput(control, 1);
        accepted = true;
      }
    }
    if (!accepted) return;
    try {
      element.setPointerCapture(event.pointerId);
    } catch { /* the window listeners cover release */ }
  }

  onPointerMove(event) {
    if (event.pointerId !== this.stickPointer || !this.canInteract()) return;
    const { throttle, steer } = stickAxes(this.origin.x, this.origin.y, event.clientX, event.clientY, window.innerWidth);
    this.writeStick(throttle, steer);
  }

  writeStick(throttle, steer) {
    if (throttle === this.axes.throttle && steer === this.axes.steer) return;
    this.axes = { throttle, steer };
    this.controller.setTouchInput('forward', Math.max(0, throttle));
    this.controller.setTouchInput('backward', Math.max(0, -throttle));
    this.controller.setTouchInput('right', Math.max(0, steer));
    this.controller.setTouchInput('left', Math.max(0, -steer));
    this.root.style.setProperty('--touch-throttle', throttle.toFixed(3));
    this.root.style.setProperty('--touch-steer', steer.toFixed(3));
  }

  release(pointerId) {
    if (pointerId === this.stickPointer && this.stickPointer !== null) {
      this.stickPointer = null;
      this.stick.dataset.active = 'false';
      this.writeStick(0, 0);
      return;
    }
    const owned = this.buttonPointers.get(pointerId);
    if (!owned) return;
    this.buttonPointers.delete(pointerId);
    owned.element.dataset.pressed = 'false';
    this.controller.setTouchInput(owned.action, 0);
  }

  reset() {
    if (this.stickPointer !== null) this.release(this.stickPointer);
    for (const pointerId of [...this.buttonPointers.keys()]) this.release(pointerId);
    this.axes = { throttle: NaN, steer: NaN };
    if (this.root) this.writeStick(0, 0);
    this.controller.clearTouchInput();
  }
}

export { TouchControls };
