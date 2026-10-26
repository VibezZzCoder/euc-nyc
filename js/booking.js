// Civic Detention's short booking ritual. Original code/dialogue © 2026 VibezZzCoder, MIT (see LICENSE).
// Pure lifecycle first; the optional DOM shell below catches input while main.js owns placement and the scene.
export const BOOKING_RULES = Object.freeze({ transferSeconds: 1.1, intakeSeconds: 3.6, signatureSeconds: 4.4,
  writeDelay: 1, tearSeconds: 2.4 });
export const BOOKING_TEXT = Object.freeze({
  captured: { heading: 'Busted.', line: 'Three warnings. One form.', reply: 'Dorkins is taking you to Civic Detention.' },
  intake: { heading: 'Intake.', line: 'Front wheel?', reply: '“That is the wheel.”' },
  signature: { heading: 'Official business.', line: 'Just needs my signature.', reply: '' },
  released: { heading: 'Released.', line: 'Paperwork’s gone. Case closed.', reply: 'Wheel count on release: 1. Still 1.' },
});

export function createBookingDirector(rules = BOOKING_RULES) {
  const state = { phase: 'idle', age: 0, number: 0, rider: '', knockdowns: 0, retry: 0 };
  return {
    state,
    get active() { return state.phase !== 'idle'; },
    start(rider, knockdowns) {
      if (state.phase !== 'idle') return false;
      Object.assign(state, { phase: 'captured', age: 0, number: state.number + 1, rider, knockdowns, retry: 0 });
      return true;
    },
    arrive() {
      if (state.phase !== 'captured') return false;
      state.phase = 'intake';
      state.age = 0;
      return true;
    },
    update(dt, visible = true) {
      if (!visible || !(dt > 0) || state.phase === 'idle' || state.phase === 'released') return null;
      state.age += dt;
      if (state.phase === 'captured') {
        state.retry -= dt;
        if (state.age < rules.transferSeconds || state.retry > 0) return null;
        state.retry = 0.5; // bounded retry if a pedestrian temporarily occupies intake
        return 'transfer';
      }
      const span = state.phase === 'intake' ? rules.intakeSeconds : rules.signatureSeconds;
      if (state.age < span) return null;
      state.age -= span;
      state.phase = state.phase === 'intake' ? 'signature' : 'released';
      return state.phase;
    },
    finish() {
      if (state.phase === 'idle') return false;
      state.phase = 'idle';
      state.age = 0;
      return true;
    },
  };
}

/** A native modal traps focus and makes the rest of the HUD inert. No background input path may bypass it. */
export class BookingScreen {
  constructor({ root, onRelease }) {
    this.root = root;
    this.onRelease = onRelease;
    this.last = {};
    this.phase = 'idle';
    this.padPrevious = null;
    this.skip = root.querySelector('#booking-skip');
    this.release = root.querySelector('#booking-release');
    this.skip.addEventListener('click', () => this.finish());
    this.release.addEventListener('click', () => this.finish());
    root.addEventListener('cancel', (e) => { e.preventDefault(); this.finish(); });
    this.onKey = (e) => {
      if (this.phase === 'idle' || e.code === 'Tab' || e.code === 'KeyN') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'keydown' || e.repeat) return;
      if (e.code === 'Escape' || ((e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter')
        && (this.phase === 'released' || document.activeElement === this.skip))) this.finish();
    };
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKey, true);
    window.addEventListener('blur', () => { this.padPrevious = null; });
    document.addEventListener('visibilitychange', () => { this.padPrevious = null; });
  }

  set(key, value, write) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    write(value);
  }

  finish() {
    if (this.phase === 'idle') return;
    if (this.onRelease()) return;
    this.root.querySelector('#booking-note').textContent = 'One moment — clearing the exit. Try again.';
    this.root.querySelector('.booking-subtitle').textContent = 'Clearing the exit. Try again.';
  }

  update(state) {
    if (state.phase === 'idle') {
      if (this.phase !== 'idle') {
        this.root.close();
        document.body.classList.remove('booking-open');
      }
      this.phase = 'idle';
      return;
    }
    const opening = this.phase === 'idle';
    this.phase = state.phase;
    if (opening) {
      this.last = {};
      this.padPrevious = null;
      document.body.classList.add('booking-open');
      this.root.showModal();
      this.skip.focus({ preventScroll: true });
    }
    this.set('phase', state.phase, (phase) => {
      this.root.dataset.phase = phase;
      this.root.querySelector('.booking-subtitle').textContent = phase === 'captured' ? 'Transfer to intake' : 'Vehicle processing';
      const copy = BOOKING_TEXT[phase];
      for (const key of ['heading', 'line', 'reply']) this.root.querySelector(`#booking-${key}`).textContent = copy[key];
      this.root.querySelector('#booking-stamp').textContent = phase === 'released' ? 'RELEASED' : 'VOID';
      this.root.querySelector('#booking-note').textContent = phase === 'released'
        ? 'Heat cleared. No fine. Keep rolling.' : 'Please remain at the desk.';
      this.release.disabled = phase !== 'released';
      if (phase === 'released') this.release.focus({ preventScroll: true });
    });
    this.set('rider', state.rider, (name) => { this.root.querySelector('#booking-rider').textContent = name; });
    this.set('number', state.number, (n) => { this.root.querySelector('#booking-number').textContent = `EUC-${String(n).padStart(3, '0')}`; });
    const torn = state.phase === 'released' || (state.phase === 'signature' && state.age >= BOOKING_RULES.tearSeconds);
    this.set('torn', torn, (value) => { this.root.dataset.torn = String(value); });
    const signing = state.phase === 'signature' && state.age >= BOOKING_RULES.writeDelay;
    this.set('signing', signing, (value) => { this.root.dataset.signing = String(value); });
  }

  /** Own pad edges while the riding poll is suspended. A already held at capture never skips the scene. */
  updateGamepad() {
    if (this.phase === 'idle' || document.hidden || !document.hasFocus()) { this.padPrevious = null; return; }
    let pad = null;
    try { pad = [...navigator.getGamepads?.() ?? []].find((p) => p?.connected && p.mapping === 'standard'); } catch { /* optional */ }
    if (!pad) { this.padPrevious = null; return; }
    const pressed = [0, 1, 9].map((i) => !!pad.buttons[i]?.pressed);
    const before = this.padPrevious;
    this.padPrevious = pressed;
    if (!before) return;
    if (pressed[1] && !before[1]) this.finish();
    else if (this.phase === 'released' && ((pressed[0] && !before[0]) || (pressed[2] && !before[2]))) this.finish();
  }
}
