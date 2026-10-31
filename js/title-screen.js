// js/title-screen.js — the title screen between the loading screen and the ride.
//
// The city is already running behind it: the camera circles the rider (cameras.js setTitleOrbit), and the rider can
// be changed here. Nothing reaches the ride until the player starts: the overlay covers the canvas and the touch
// layer, keys are caught before the game's own listeners, and main.js does not poll the gamepad for riding while it
// is open. Start with the Ride button, Enter or Space, or A / Start on a gamepad.

const START_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);
const PAD = Object.freeze({ a: 0, lb: 4, rb: 5, start: 9, left: 14, right: 15 });

export class TitleScreen {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root          #title-overlay
   * @param {string[]} options.riders           playable rider ids, in button order
   * @param {(id: string) => void} options.onRider   pick a rider (main.js selectRider)
   * @param {() => string} options.getRider     the current rider id
   * @param {() => void} options.onStart        called once, inside the starting gesture's handler where there is one
   */
  constructor({ root, riders, onRider, getRider, onStart }) {
    this.root = root;
    this.riders = riders;
    this.onRider = onRider;
    this.getRider = getRider;
    this.onStart = onStart;
    this.isOpen = false;
    this.started = false;
    this.padPrevious = null;
    this.padIndex = null;
    this.padId = null;
    this.focused = typeof document.hasFocus !== 'function' || document.hasFocus();
    this.rideButton = root?.querySelector('#title-ride') ?? null;
    this.riderButtons = root ? [...root.querySelectorAll('[data-title-rider]')] : [];

    this.rideButton?.addEventListener('click', () => this.start());
    for (const btn of this.riderButtons) btn.addEventListener('click', () => {
      if (this.isOpen && this.canInteract()) this.onRider(btn.dataset.titleRider);
    });
    // Capture phase on window: runs before the game's key listeners, which never see a key while the title is up
    this.onKey = (e) => {
      if (!this.isOpen) return;
      if (e.code === 'Tab') return; // keyboard focus still moves between the buttons
      // Enter on a title link keeps native new-tab navigation; never reaches the riding listeners.
      if (e.target?.closest?.('a[href]') && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
        e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'keydown' || e.repeat || !this.canInteract()) return;
      if (START_KEYS.has(e.code)) {
        // Enter or Space on a focused rider button picks it; anywhere else they start the ride
        const focused = document.activeElement;
        if (focused?.dataset?.titleRider) this.onRider(focused.dataset.titleRider);
        else this.start();
      } else if (e.code === 'Digit1' || e.code === 'Digit2') {
        const id = this.riders[Number(e.code.slice(5)) - 1];
        if (id) this.onRider(id);
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.cycle(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.cycle(1);
    };
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKey, true);
    // Polling can pause entirely while hidden. The first returning sample only synchronizes holds.
    window.addEventListener('blur', () => { this.focused = false; this.padPrevious = null; });
    window.addEventListener('focus', () => { this.focused = true; this.padPrevious = null; });
    document.addEventListener('visibilitychange', () => { this.padPrevious = null; });
  }

  canInteract() {
    return !document.hidden && this.focused && (typeof document.hasFocus !== 'function' || document.hasFocus());
  }

  show() {
    if (!this.root || this.started) return;
    this.isOpen = true;
    this.padPrevious = null;
    this.setRider(this.getRider());
    document.body.classList.add('title-open');
    this.root.hidden = false;
    // Next frame, so the fade-in transition runs from the hidden state
    requestAnimationFrame(() => { if (this.isOpen) this.root.classList.add('is-shown'); });
    if (!matchMedia('(pointer: coarse)').matches) this.rideButton?.focus({ preventScroll: true });
  }

  start() {
    if (!this.isOpen || this.started || !this.canInteract()) return;
    this.started = true;
    this.isOpen = false;
    this.root.classList.remove('is-shown');
    document.body.classList.remove('title-open');
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
    // CSS reduces transitions to 0.01ms; don't leave an invisible hit-blocking overlay for 500ms.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.root.hidden = true;
    else setTimeout(() => { this.root.hidden = true; }, 500);
    this.onStart();
  }

  /** Mark the rider in use (main.js calls it whenever the rider changes). */
  setRider(id) {
    for (const btn of this.riderButtons) {
      const on = btn.dataset.titleRider === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  cycle(step) {
    const i = this.riders.indexOf(this.getRider());
    this.onRider(this.riders[(i + step + this.riders.length) % this.riders.length]);
  }

  /** Each frame while open: a gamepad's A or Start rides, LB / RB and the d-pad pick the rider (edges only). */
  update() {
    if (!this.isOpen) return;
    let pad = null;
    try {
      for (const p of navigator.getGamepads?.() ?? []) {
        if (!p?.connected || p.mapping !== 'standard') continue;
        if (p.index === this.padIndex && p.id === this.padId) { pad = p; break; }
        if (!pad) pad = p;
      }
    } catch { /* no gamepad API */ }
    if (!pad) { this.padPrevious = null; this.padIndex = this.padId = null; return; }
    if (pad.index !== this.padIndex || pad.id !== this.padId) this.padPrevious = null;
    this.padIndex = pad.index;
    this.padId = pad.id;
    const pressed = Array.from({ length: 17 }, (_, i) => Boolean(pad.buttons?.[i]?.pressed) || pad.buttons?.[i]?.value > 0.5);
    const previous = this.padPrevious;
    const interactive = this.canInteract();
    this.padPrevious = interactive ? pressed : null;
    if (!interactive) return;
    if (!previous) return; // a button already held when the pad appeared is not a press
    const edge = (i) => pressed[i] && !previous[i];
    if (edge(PAD.a) || edge(PAD.start)) this.start();
    else if (edge(PAD.lb) || edge(PAD.left)) this.cycle(-1);
    else if (edge(PAD.rb) || edge(PAD.right)) this.cycle(1);
  }
}
