// js/nemesis-chase.js — the rules of Officer Dorkins' chase (Nemesis stage b): when he ambushes, when the player has
// lost him, and what the HUD says about it. The rules are pure (tested in Node); NemesisHud is the DOM writer.
//
// After EUC Thrills' chase referee (src/simulation/chase.ts, ChaseRun: a gap that stays open, and a quiet spell, both
// on hold clocks), turned round for free riding: there the rider survives a clock and the cop always comes back; here
// he ambushes now and then, and the rider can shake him off.
//   - Ambush: a random wait after Ride (and after each escape), never while the rider is down or just back up.
//   - He only starts counting once he has seen the player: he arrives out of sight on purpose.
//   - Escape needs BOTH sustained time unseen AND a sustained distance gap. Seeing the rider resets both clocks;
//     being down or recovering clears escape progress, never the pursuit or its knockdown tally.
//   - Then he gives up and flies off; the next ambush is a while later.
//   - Three confirmed paddle knockdowns are warnings; the fourth captures. main.js hands off to booking.js.
//     This referee never relocates the rider or changes their physics.

export const CHASE_RULES = Object.freeze({
  firstMin: 15, // s of riding after Ride before the first ambush...
  firstMax: 30,
  againMin: 45, // ...and after he gives up, before the next
  againMax: 100,
  calmSeconds: 4, // s back on the wheel after a crash before an ambush may start
  retrySeconds: 1, // no spot to appear at: try again this much later
  sightRange: 110, // m: how far he can see the player (with a clear line)
  loseSeconds: 12, // s continuously out of sight, AND...
  outrunDistance: 150, // m: further than this...
  outrunSeconds: 6, // ...this long, also unseen: escaped
  acquireSeconds: 60, // s: failed to acquire anyone at all; silently withdraw, not a credited escape
  leaveSeconds: 8, // s he flies off for at most (gone sooner once out of view)
  recoverySeconds: 3, // s after getting up before he can swing again; no escape progress during this grace period
  warningKnockdowns: 3, // all three are warnings; the next confirmed knockdown captures
  leaveMinSeconds: 1.5,
  bannerSeconds: 2.6, // the "after you" and "lost him" banners
});

/**
 * The chase referee. update(dt, facts) with facts { riding, crashed, distance, sees, inView } returns the event of the
 * step: 'ambush' (spawn him now; call postpone() if that failed), 'escaped' (he gives up: fly him off), 'gone' (hide
 * him), 'missed' (failed initial acquisition: silent withdrawal), or null. knockedDown() records only a successful
 * controller hardKnock, once per swing. No crash, get-up or brief sight break clears the tally.
 */
export function createChaseDirector({ rules = CHASE_RULES, random = Math.random } = {}) {
  const r = rules;
  const between = (lo, hi) => lo + (hi - lo) * random();
  const s = {
    phase: 'waiting', // 'waiting' | 'chasing' | 'leaving' | 'captured'
    wait: between(r.firstMin, r.firstMax),
    calm: 0,
    acquired: false,
    sees: false,
    knockdowns: 0,
    recovery: 0,
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
    /** Only call after hardKnock succeeds, not on a miss, rejected contact or an unrelated crash. */
    knockedDown() {
      if (s.phase !== 'chasing' || s.recovery > 0) return false;
      s.knockdowns++;
      s.recovery = r.recoverySeconds;
      s.unseen = s.far = 0;
      if (s.knockdowns > r.warningKnockdowns) {
        s.phase = 'captured';
        fire('captured');
      } else fire('warning');
      return true;
    },
    /** Booking finished and the rider has actually been placed safely outside. */
    release() {
      if (s.phase !== 'captured') return false;
      s.phase = 'waiting';
      s.wait = between(r.againMin, r.againMax);
      s.knockdowns = s.recovery = s.unseen = s.far = s.calm = 0;
      s.acquired = s.sees = false;
      fire('released');
      return true;
    },
    /** For testing and QA: ambush on the next step. */
    soon() {
      if (s.phase === 'waiting') {
        s.wait = 0;
        s.calm = 0;
      }
    },
    update(dt, { riding = false, crashed = false, distance = Infinity, sees = false, inView = false } = {}) {
      if (!(dt > 0) || !riding) return null;
      if (s.phase === 'captured') return null; // booking owns the lifecycle until a successful release
      s.eventAge += dt;
      if (s.phase === 'waiting') {
        s.calm = crashed ? r.calmSeconds : Math.max(0, s.calm - dt);
        s.wait -= dt;
        if (s.wait > 0 || s.calm > 0 || crashed) return null;
        s.phase = 'chasing';
        s.acquired = false;
        s.sees = false;
        s.knockdowns = s.recovery = 0;
        s.chaseTime = s.unseen = s.far = 0;
        return fire('ambush');
      }
      if (s.phase === 'chasing') {
        s.chaseTime += dt;
        s.sees = sees;
        if (sees) s.acquired = true;
        let escaped = false;
        if (!s.acquired) escaped = s.chaseTime >= r.acquireSeconds;
        if (crashed) s.recovery = r.recoverySeconds;
        else s.recovery = Math.max(0, s.recovery - dt);
        if (crashed || s.recovery > 0) s.unseen = s.far = 0;
        else if (s.acquired) {
          s.unseen = sees ? 0 : s.unseen + dt;
          s.far = !sees && distance > r.outrunDistance ? s.far + dt : 0;
          escaped = s.unseen >= r.loseSeconds && s.far >= r.outrunSeconds;
        }
        if (!escaped) return null;
        s.phase = 'leaving';
        s.leaveTime = 0;
        return fire(s.acquired ? 'escaped' : 'missed');
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
 * Escape meter fills only while BOTH requirements are being met. A separate three-segment heat strip and exact hit
 * count survive recovery / searching. 'paddle' (the readable wind-up) wins over transient banners.
 */
export function chaseHudView(state, distance, rules = CHASE_RULES, swingPhase = 'idle') {
  let banner = ['ambush', 'escaped', 'warning', 'captured', 'released'].includes(state.lastEvent)
    ? (state.eventAge < rules.bannerSeconds ? state.lastEvent : null) : null;
  if (swingPhase === 'windup' && state.phase === 'chasing') banner = 'paddle';
  const knockdowns = state.knockdowns;
  const heat = Math.min(rules.warningKnockdowns, knockdowns);
  const hot = knockdowns >= rules.warningKnockdowns;
  const heatText = hot ? `${heat}/${rules.warningKnockdowns} · arrest risk`
    : `Warnings ${knockdowns}/${rules.warningKnockdowns}`;
  const bannerText = banner === 'warning' ? (hot ? 'Final warning · arrest risk!' : `Warning ${knockdowns}/${rules.warningKnockdowns} · on your feet!`)
    : banner === 'paddle' && hot ? 'Arrest risk! Hop or swerve' : CHASE_TEXT[banner] || '';
  let cue = null, losing = 0;
  if (state.phase === 'chasing') {
    cue = !state.acquired ? 'incoming' : state.recovery > 0 ? 'recovering' : state.sees ? 'seen' : state.far > 0 ? 'far' : 'unseen';
    losing = Math.min(1, state.unseen / rules.loseSeconds, state.far / rules.outrunSeconds);
  }
  return { banner, bannerText, cue, metres: Math.round(Number.isFinite(distance) ? distance : 0), losing,
    knockdowns, heat, hot, heatText };
}

export const CHASE_TEXT = Object.freeze({
  ambush: 'Officer Dorkins is after you!',
  escaped: 'You lost him',
  captured: 'Busted · off to Civic Detention',
  released: 'Released · back to riding',
  paddle: 'Paddle! Hop or swerve',
  seen: 'Officer Dorkins',
  incoming: 'Dorkins is closing in',
  recovering: 'Catch your breath · still pursued',
  unseen: 'Searching · get more distance',
  far: 'Stay hidden · losing him',
});

/** DOM writer: touches a node only when its value changes. Every element is optional. */
export class NemesisHud {
  constructor(doc = document) {
    this.el = {
      banner: doc.getElementById('hud-chase-banner'),
      cue: doc.getElementById('hud-chase'),
      text: doc.getElementById('hud-chase-text'),
      meter: doc.getElementById('hud-chase-meter'),
      heat: doc.getElementById('hud-chase-heat'),
      heatText: doc.getElementById('hud-chase-heat-text'),
    };
    this.last = {};
  }

  set(key, value, write) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    write(value);
  }

  update(view) {
    const { banner, cue, text, meter, heat, heatText } = this.el;
    if (banner) {
      this.set('banner', view.banner, (b) => {
        banner.hidden = !b;
        if (!b) return;
        banner.dataset.kind = b;
      });
      if (view.banner) this.set('bannerText', view.bannerText, (t) => { banner.textContent = t; });
    }
    if (cue) {
      this.set('cue', view.cue, (c) => {
        cue.hidden = !c;
        if (c) cue.dataset.state = c;
      });
      if (!view.cue) return;
      this.set('hot', view.hot, (h) => { cue.dataset.hot = String(h); });
      if (heat) this.set('heat', view.heat, (h) => { heat.dataset.level = String(h); });
      if (heatText) this.set('heatText', view.heatText, (t) => { heatText.textContent = t; });
      const label = view.cue === 'seen' ? `${CHASE_TEXT.seen} · ${view.metres} m` : CHASE_TEXT[view.cue];
      if (text) this.set('text', label, (t) => { text.textContent = t; });
      if (meter) this.set('meter', Math.round(view.losing * 20), (m) => { meter.style.width = `${m * 5}%`; });
    }
  }
}
