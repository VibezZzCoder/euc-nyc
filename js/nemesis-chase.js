// js/nemesis-chase.js — the rules of Officer Dorkins' chase (Nemesis stage b): when he ambushes, when the player has
// lost him, and what the HUD says about it. The rules are pure (tested in Node); NemesisHud is the DOM writer.
//
// After EUC Thrills' chase referee (src/simulation/chase.ts, ChaseRun: a gap that stays open, and a quiet spell, both
// on hold clocks), turned round for free riding: there the rider survives a clock and the cop always comes back; here
// he ambushes now and then, and the rider can shake him off.
//   - Ambush: a random wait after Ride (and after each escape), never while the rider is down or just back up.
//   - He only starts counting once he has seen the player: he arrives out of sight on purpose.
//   - Escape: out of his sight for `loseSeconds` in a row, or more than `outrunDistance` away for `outrunSeconds`.
//     The clocks stand still while the rider is down (a crash is no hiding place).
//   - Then he gives up and flies off; the next ambush is a while later.
//   - Or his paddle connects (js/nemesis-swing.js): busted. He hovers over the fallen rider a moment, then flies off
//     the same way.

export const CHASE_RULES = Object.freeze({
  firstMin: 15, // s of riding after Ride before the first ambush...
  firstMax: 30,
  againMin: 45, // ...and after he gives up, before the next
  againMax: 100,
  calmSeconds: 4, // s back on the wheel after a crash before an ambush may start
  retrySeconds: 1, // no spot to appear at: try again this much later
  sightRange: 70, // m: how far he can see the player (with a clear line)
  loseSeconds: 6, // s out of his sight in a row: lost him
  outrunDistance: 150, // m: further than this...
  outrunSeconds: 2, // ...this long: outran him
  acquireSeconds: 40, // s: never seen the player by then (stuck far off): he gives up
  leaveSeconds: 8, // s he flies off for at most (gone sooner once out of view)
  bustedHoverSeconds: 1.2, // s he hovers over a rider he has knocked down before he flies off
  leaveMinSeconds: 1.5,
  bannerSeconds: 2.6, // the "after you" and "lost him" banners
});

/**
 * The chase referee. update(dt, facts) with facts { riding, crashed, distance, sees, inView } returns the event of the
 * step: 'ambush' (spawn him now; call postpone() if that failed), 'escaped' (he gives up: fly him off), 'gone' (hide
 * him), or null. busted() ends a chase with a hit; while state.leaveTime < 0 after it, he hovers.
 */
export function createChaseDirector({ rules = CHASE_RULES, random = Math.random } = {}) {
  const r = rules;
  const between = (lo, hi) => lo + (hi - lo) * random();
  const s = {
    phase: 'waiting', // 'waiting' | 'chasing' | 'leaving'
    wait: between(r.firstMin, r.firstMax),
    calm: 0,
    acquired: false,
    chaseTime: 0,
    unseen: 0,
    far: 0,
    leaveTime: 0,
    lastEvent: null,
    eventAge: Infinity,
  };
  const fire = (event) => {
    s.lastEvent = event;
    s.eventAge = 0;
    return event;
  };
  return {
    state: s,
    /** His spawn failed: stay waiting and try again shortly. */
    postpone(seconds = r.retrySeconds) {
      s.phase = 'waiting';
      s.wait = seconds;
      s.lastEvent = null;
      s.eventAge = Infinity;
    },
    /** His paddle connected: the chase is over, he leaves after a moment's hover. */
    busted() {
      if (s.phase !== 'chasing') return;
      s.phase = 'leaving';
      s.leaveTime = -r.bustedHoverSeconds;
      fire('busted');
    },
    /** For testing and QA: ambush on the next step. */
    soon() {
      if (s.phase === 'waiting') {
        s.wait = 0;
        s.calm = 0;
      }
    },
    update(dt, { riding = false, crashed = false, distance = Infinity, sees = false, inView = false } = {}) {
      s.eventAge += dt;
      if (s.phase === 'waiting') {
        if (!riding) return null;
        s.calm = crashed ? r.calmSeconds : Math.max(0, s.calm - dt);
        s.wait -= dt;
        if (s.wait > 0 || s.calm > 0 || crashed) return null;
        s.phase = 'chasing';
        s.acquired = false;
        s.chaseTime = s.unseen = s.far = 0;
        return fire('ambush');
      }
      if (s.phase === 'chasing') {
        s.chaseTime += dt;
        if (sees) s.acquired = true;
        let escaped = false;
        if (!s.acquired) escaped = s.chaseTime >= r.acquireSeconds;
        else if (!crashed) {
          s.unseen = sees ? 0 : s.unseen + dt;
          s.far = distance > r.outrunDistance ? s.far + dt : 0;
          escaped = s.unseen >= r.loseSeconds || s.far >= r.outrunSeconds;
        }
        if (!escaped) return null;
        s.phase = 'leaving';
        s.leaveTime = 0;
        return fire('escaped');
      }
      s.leaveTime += dt;
      if (s.leaveTime < 0 || (s.leaveTime < r.leaveSeconds && (s.leaveTime < r.leaveMinSeconds || inView))) return null;
      s.phase = 'waiting';
      s.wait = between(r.againMin, r.againMax);
      s.calm = 0;
      return 'gone';
    },
  };
}

/**
 * What the HUD shows, from the director's state, his distance and his swing's phase:
 *   { banner: null | 'ambush' | 'escaped' | 'busted' | 'paddle', cue: null | 'seen' | 'unseen' | 'far', metres,
 *     losing (0..1) }.
 * The cue shows only once he has seen the player; `losing` is how near the player is to shaking him off. 'paddle'
 * (his wind-up: hop or swerve) wins over the others.
 */
export function chaseHudView(state, distance, rules = CHASE_RULES, swingPhase = 'idle') {
  let banner = state.lastEvent === 'ambush' || state.lastEvent === 'escaped' || state.lastEvent === 'busted'
    ? (state.eventAge < rules.bannerSeconds ? state.lastEvent : null) : null;
  if (swingPhase === 'windup' && state.phase === 'chasing') banner = 'paddle';
  if (state.phase !== 'chasing' || !state.acquired) return { banner, cue: null, metres: 0, losing: 0 };
  const unseen = state.unseen / rules.loseSeconds;
  const far = state.far / rules.outrunSeconds;
  const losing = Math.min(1, Math.max(unseen, far));
  const cue = state.far > 0 ? 'far' : state.unseen > 0 ? 'unseen' : 'seen';
  return { banner, cue, metres: Math.round(Number.isFinite(distance) ? distance : 0), losing };
}

export const CHASE_TEXT = Object.freeze({
  ambush: 'Officer Dorkins is after you!',
  escaped: 'You lost him',
  busted: 'Busted!',
  paddle: 'Paddle! Hop or swerve',
  seen: 'Officer Dorkins',
  unseen: 'Out of his sight',
  far: 'Pulling away',
});

/** DOM writer: touches a node only when its value changes. Every element is optional. */
export class NemesisHud {
  constructor(doc = document) {
    this.el = {
      banner: doc.getElementById('hud-chase-banner'),
      cue: doc.getElementById('hud-chase'),
      text: doc.getElementById('hud-chase-text'),
      meter: doc.getElementById('hud-chase-meter'),
    };
    this.last = {};
  }

  set(key, value, write) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    write(value);
  }

  update(view) {
    const { banner, cue, text, meter } = this.el;
    if (banner) {
      this.set('banner', view.banner, (b) => {
        banner.hidden = !b;
        if (!b) return;
        banner.dataset.kind = b;
        banner.textContent = CHASE_TEXT[b];
      });
    }
    if (cue) {
      this.set('cue', view.cue, (c) => {
        cue.hidden = !c;
        if (c) cue.dataset.state = c;
      });
      if (!view.cue) return;
      const label = view.cue === 'seen' ? `${CHASE_TEXT.seen} · ${view.metres} m` : CHASE_TEXT[view.cue];
      if (text) this.set('text', label, (t) => { text.textContent = t; });
      if (meter) this.set('meter', Math.round(view.losing * 20), (m) => { meter.style.width = `${m * 5}%`; });
    }
  }
}
