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
const BUTTON_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

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
    this.buttonKeys = new Map(); // code -> { element, action }; separate from global riding keys
    this.chargeLatched = false; // assistive click has no key/pointer release
    this.media = window.matchMedia('(any-pointer: coarse)');
    if (!this.root || !this.stick) return;
    this.buttons = [...this.root.querySelectorAll('[data-touch]')].filter((el) => BUTTON_ACTIONS.has(el.dataset.touch));
    this.chargeButton = this.buttons.find((el) => el.dataset.touch === 'boost');
    this.chargeButton?.setAttribute('aria-pressed', 'false');
    this.chargeButton?.setAttribute('aria-label', 'Crouch and charge a bigger hop; hold in the air to tuck. '
      + 'Hold with Enter or Space. Assistive activation toggles charge until activated again, held, or HOP is released.');

    this.root.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.root.addEventListener('keydown', (event) => this.onButtonKey(event, true));
    this.root.addEventListener('keyup', (event) => this.onButtonKey(event, false));
    window.addEventListener('keyup', (event) => this.onButtonKey(event, false));
    this.root.addEventListener('focusout', (event) => {
      for (const [code, owned] of this.buttonKeys) if (owned.element === event.target) this.releaseKey(code);
    });
    this.root.addEventListener('click', (event) => this.onButtonClick(event));
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
    return this.enabled && this.available && !document.hidden && this.controller.inputEnabled !== false;
  }

  buttonFromTarget(target) {
    const element = target instanceof Element ? target.closest('[data-touch]') : null;
    return element && this.root.contains(element) && BUTTON_ACTIONS.has(element.dataset.touch) ? element : null;
  }

  canPressButton(element) {
    return this.canInteract() && !element.disabled && (element.dataset.touch !== 'reset' || this.down);
  }

  writeButton(element, pulse = false) {
    const action = element.dataset.touch;
    const pressed = pulse || (action === 'boost' && this.chargeLatched)
      || [...this.buttonPointers.values(), ...this.buttonKeys.values()].some((owned) => owned.element === element);
    const wasPressed = element.dataset.pressed === 'true';
    element.dataset.pressed = String(pressed);
    if (action === 'boost') element.setAttribute('aria-pressed', String(pressed));
    if (pressed !== wasPressed) this.controller.setTouchInput(action, Number(pressed));
    // Keep an assistive charge through the hop hold (including a one-foot/tuck), then release it.
    // Physical CHARGE holds and the keyboard/gamepad sources remain independently owned.
    if (action === 'up' && wasPressed && !pressed && this.chargeLatched) {
      this.chargeLatched = false;
      this.writeButton(this.chargeButton);
    }
  }

  onButtonKey(event, isDown) {
    if (!BUTTON_KEYS.has(event.code)) return;
    const element = this.buttonFromTarget(event.target);
    if (!element && !this.buttonKeys.has(event.code)) return;
    // We implement a hold, not the native Enter click/Space key-up click. Keep both defaults and
    // bubbling riding bindings out of this path; detail-zero clicks without keys remain accessible.
    const prevented = event.defaultPrevented;
    event.preventDefault();
    event.stopPropagation();
    if (!isDown) { this.releaseKey(event.code); return; }
    if (prevented || event.repeat || this.buttonKeys.has(event.code) || event.ctrlKey || event.metaKey
      || event.altKey || event.isComposing || !this.canPressButton(element) || document.activeElement !== element) return;
    if (element.dataset.touch === 'boost') this.chargeLatched = false; // transfer a toggle to the physical hold
    this.buttonKeys.set(event.code, { element, action: element.dataset.touch });
    this.writeButton(element);
  }

  releaseKey(code) {
    const owned = this.buttonKeys.get(code);
    if (!owned) return;
    this.buttonKeys.delete(code);
    this.writeButton(owned.element);
  }

  onButtonClick(event) {
    const element = this.buttonFromTarget(event.target);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    // A pointer already acted on down/up. Its compatibility click must never add another hop
    // or latch CHARGE. Native keyboard clicks were prevented by onButtonKey.
    if (event.detail !== 0 || event.pointerType || !this.canPressButton(element)) return;
    if ([...this.buttonPointers.values(), ...this.buttonKeys.values()].some((owned) => owned.element === element)) return;
    if (element.dataset.touch === 'boost') {
      this.chargeLatched = !this.chargeLatched;
      this.writeButton(element);
    } else {
      // The manager buffers these one-shots even when the complete pulse falls between frames.
      this.writeButton(element, true);
      this.writeButton(element);
    }
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
      for (const [code, owned] of this.buttonKeys) if (owned.action === 'reset') this.releaseKey(code);
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
    } else if (BUTTON_ACTIONS.has(control) && this.canPressButton(element) && event.button === 0) {
      const busy = [...this.buttonPointers.values()].some((owned) => owned.element === element);
      if (!busy && event.pointerId !== this.stickPointer && !this.buttonPointers.has(event.pointerId)) {
        this.buttonPointers.set(event.pointerId, { element, action: control });
        if (control === 'boost') this.chargeLatched = false;
        this.writeButton(element);
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
    this.writeButton(owned.element);
  }

  reset() {
    this.stickPointer = null;
    if (this.stick) this.stick.dataset.active = 'false';
    this.buttonPointers.clear();
    this.buttonKeys.clear();
    this.chargeLatched = false;
    for (const element of this.buttons || []) this.writeButton(element);
    this.axes = { throttle: NaN, steer: NaN };
    if (this.root) this.writeStick(0, 0);
    // Resize cancels queued touch taps and trick intent, not just levels. Retain other sources.
    if (this.controller.cancelTouchInput) this.controller.cancelTouchInput();
    else this.controller.clearTouchInput();
  }
}

/**
 * Taps by a second finger. While one thumb holds the stick (or any other finger is down), phone browsers send
 * `pointerdown` and `pointerup` for the other thumb's tap but no `click`, so Menu, Map, the cameras and the other HUD
 * buttons did nothing while steering, and nor did Resume, the picker or the map's Close once they were open. This
 * activates such a tap on release, once.
 *   - Only touch presses on a `<button>` in the riding HUD (`.hud`), its popovers (Teleport, cameras), the game menu
 *     (Pause and the rider picker) and the full map. Never the booking dialog (its Skip / Back to riding keep their
 *     own deliberate activation rules) or the touch controls (they own their pointers).
 *   - Only a press during which another finger was down at some moment. An only finger keeps the browser's click.
 *   - It must be a tap: released within `hold` ms, never further than `slop` px from where it landed (coalesced moves
 *     are read point by point), still over the button it landed on, no long-press menu on it. A finger already down
 *     when a menu or the map opened over it presses nothing there: it landed on another element.
 *   - A finger that lands on the menu's or map's own surface (not a button) and drags (a pan, pinch or list scroll)
 *     owns the gesture until it lifts: every press down at that moment or landing meanwhile is void, as the map
 *     cancels a gesture when a second finger joins. A surface finger at rest does not.
 *   - Taking one tap disarms every other press still resting on a button, so lifting it later presses nothing, and a
 *     resting finger cannot take the focus (a picker entry's highlight) back from the tapped button afterwards.
 *   - If the browser does send a click for a release activated here (no new finger down in between, within `echo` ms
 *     and `2 × slop` px), that click is dropped so nothing acts twice. A new contact always gets its own click.
 *   - Focus follows a native tap: the button is focused, clicked, and outside a `<dialog>` blurred again (main.js
 *     blurs pointer-clicked buttons there), so Space still hops after a HUD tap and the picker keeps its focus.
 * Retains one small entry per finger on the screen. `reset()` forgets them (blur, resize, page hide).
 */
const HELD_TAP_SCOPE = '.hud, .popover, #game-menu, #fullmap-modal';
const HELD_TAP_SURFACE = '#game-menu, #fullmap-modal';
const HELD_TAP_EXCLUDED = '#booking-overlay, #touch-controls';

export function bindHeldFingerTaps(doc = document, { slop = 12, echo = 400, hold = 1000, now = () => performance.now() } = {}) {
  if (!doc?.addEventListener) return { reset() {} };
  // pointerId -> { button, surface, moved, x, y, at, held, dead }; button null: not on a covered button; surface:
  // landed on the menu's or map's own content; moved: that surface finger has dragged beyond the slop
  const fingers = new Map();
  let activated = null; // { at, x, y } of the last release activated here, until a new contact or the next click
  const panning = () => { for (const finger of fingers.values()) if (finger.moved) return true; return false; };
  const elementOf = (target) => (target?.nodeType === 1 ? target : target?.parentElement) ?? null;
  const buttonOf = (target) => {
    const button = elementOf(target)?.closest?.('button');
    return button && !button.disabled && button.closest(HELD_TAP_SCOPE) && !button.closest(HELD_TAP_EXCLUDED) ? button : null;
  };
  doc.addEventListener('pointerdown', (event) => {
    activated = null;
    if (event.pointerType !== 'touch') return;
    for (const finger of fingers.values()) finger.held = true;
    const button = buttonOf(event.target);
    const surface = !button && !!elementOf(event.target)?.closest?.(HELD_TAP_SURFACE);
    // A pan or pinch already under way owns the gesture: a press that starts during it is void from the start.
    fingers.set(event.pointerId, { button, surface, moved: false, x: event.clientX, y: event.clientY, at: now(),
      held: fingers.size > 0, dead: panning() });
  }, { capture: true, passive: true });
  doc.addEventListener('pointermove', (event) => {
    const finger = fingers.get(event.pointerId);
    if (!finger || (!finger.button && !finger.surface) || (finger.surface ? finger.moved : finger.dead)) return;
    for (const point of [event, ...(event.getCoalescedEvents?.() ?? [])]) {
      if (Math.hypot(point.clientX - finger.x, point.clientY - finger.y) <= slop) continue;
      if (!finger.surface) { finger.dead = true; break; }
      finger.moved = true; // until it lifts, no press acts (those down now, and any that land meanwhile)
      for (const other of fingers.values()) other.dead = true;
      break;
    }
  }, { capture: true, passive: true });
  // Focus before the latest focus change: Chromium focuses the element under a finger when it raises that finger's
  // long-press menu, also for a finger merely resting while another finger tapped (and focus is a picker highlight).
  let focused = null, before = null, tapTaken = false;
  doc.addEventListener('focusin', (event) => { before = focused; focused = event.target; }, true);
  // A long-press menu disarms only its own press (Chromium also raises one when the stick finger lifts mid-tap). If a
  // tap was taken in this gesture and the menu's finger pulled focus to the element under it, focus goes back.
  doc.addEventListener('contextmenu', (event) => {
    const button = buttonOf(event.target);
    for (const [id, finger] of fingers) if (id === event.pointerId || (button && finger.button === button)) finger.dead = true;
    const pulled = doc.activeElement;
    if (!tapTaken || !pulled || pulled !== focused || !pulled.contains?.(elementOf(event.target))) return;
    if (before?.isConnected && !before.disabled && before.getClientRects?.().length) before.focus({ preventScroll: true });
    else pulled.blur?.();
  }, true);
  const end = (event, released) => {
    if (event.pointerType !== 'touch') return;
    const finger = fingers.get(event.pointerId);
    fingers.delete(event.pointerId);
    if (!fingers.size) tapTaken = false;
    if (!released || !finger?.button || !finger.held || finger.dead || now() - finger.at > hold
      || Math.hypot(event.clientX - finger.x, event.clientY - finger.y) > slop
      || buttonOf(doc.elementFromPoint?.(event.clientX, event.clientY)) !== finger.button) return;
    for (const other of fingers.values()) other.dead = true;
    tapTaken = fingers.size > 0;
    activated = { at: now(), x: event.clientX, y: event.clientY };
    const button = finger.button;
    if (doc.activeElement !== button) button.focus?.({ preventScroll: true });
    button.click();
    if (!button.closest('dialog') && doc.activeElement === button) { button.blur(); focused = null; }
  };
  doc.addEventListener('pointerup', (event) => end(event, true), true);
  doc.addEventListener('pointercancel', (event) => end(event, false), true);
  doc.addEventListener('click', (event) => {
    if (!event.isTrusted || !activated) return;
    const echoed = now() - activated.at < echo
      && Math.hypot(event.clientX - activated.x, event.clientY - activated.y) <= slop * 2;
    activated = null;
    if (echoed) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  return { reset() { fingers.clear(); activated = null; tapTaken = false; focused = before = null; } };
}

export { TouchControls };
