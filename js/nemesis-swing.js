// js/nemesis-swing.js — Officer Dorkins' paddle swoop (Nemesis stage c): the swing's phases and arc, and whether it
// connects. Pure (tested in Node).
//
// The arc is EUC Thrills' paddle (src/simulation/paddle.ts @ 5f45fff, MIT, (c) VibezZzCoder: `angle`, `restAngle`,
// `armCommitment`, `writeHeadFor`), with its vendored PADDLE tuning, held on his right. Changed for the chase:
//   - A long, readable wind-up (EUC Thrills: 0.10 s): he dives in alongside the player, paddle drawn back, his light
//     bar racing. Then a committed sweep: he flies on as he was, so a hop or a swerve at the right moment makes it miss.
//   - A low swat: the head aims `headDrop` m under his shoulder, at the player's wheel and legs, so a well-timed hop
//     clears it.
//   - Whether it connects is decided on the paddle as drawn (js/nemesis.js feeds the drawn face's path here), against
//     the rider as an upright capsule.
import { PADDLE, CHASE } from './euc/data/tuning.js';

export const SWING = Object.freeze({
  windupSeconds: 0.7, // the telegraph
  activeSeconds: 0.16, // the sweep
  recoverSeconds: 0.4,
  cooldownSeconds: 2.5, // after a miss, before he tries again
  triggerRange: 7, // m: close enough (and in sight) to start one
  maxQuarrySpeed: 15, // m/s: faster than this the player is getting away from him; no swing
  lateral: PADDLE.pivotOffset + PADDLE.reach, // 1.64 m: he flies this far to the player's left, so they are in his arc
  swoopHeight: 0.1, // m: the bottom of his machine above the player's ground as he swoops (the drawn paddle stays
  //                    above it: paddle.js keeps its tip over his machine's bottom)
  headDrop: 1.6, // m under the shoulder pivot the head aims for at full commitment (about the road)
  leanRoll: 0.35, // rad he leans out over his paddle side, crouched, at full commitment (to swat low)
  hitRadius: CHASE.riderHitRadius + PADDLE.headRadius, // 0.35 + 0.16 m
  riderHeight: 1.75, // m: the rider capsule, from the wheel's contact up
});

const smoothstep = (t) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/** The swing state. update(dt) returns 'strike' on the step the sweep starts, 'done' on the step it ends, else null. */
export function createSwing(tuning = SWING) {
  const t = tuning;
  const span = { windup: t.windupSeconds, active: t.activeSeconds, recover: t.recoverSeconds };
  const s = { phase: 'idle', elapsed: 0, cooldown: 0 };
  // Fractions of the latest frame actually spent striking (empty when from > to). Keep the last slice even when
  // this update finishes in recovery; drawing back and returning the paddle must remain harmless.
  const contact = { from: 1, to: 0 };
  const progress = () => (span[s.phase] > 0 ? Math.min(1, s.elapsed / span[s.phase]) : 1);
  const restAngle = PADDLE.startAngle + PADDLE.sweepRadians / 2;
  const strikeStart = PADDLE.startAngle;
  const strikeEnd = PADDLE.startAngle + PADDLE.sweepRadians;
  return {
    state: s,
    contact,
    get phase() {
      return s.phase;
    },
    get ready() {
      return s.phase === 'idle' && s.cooldown <= 0;
    },
    start() {
      s.phase = 'windup';
      s.elapsed = 0;
      contact.from = 1; contact.to = 0;
    },
    /** Called off (the player went down some other way): back to carrying, a short wait. */
    cancel(cooldown = 1) {
      s.phase = 'idle';
      s.elapsed = 0;
      s.cooldown = cooldown;
      contact.from = 1; contact.to = 0;
    },
    update(dt) {
      contact.from = 1; contact.to = 0;
      if (!(dt > 0)) return null;
      const untilStrike = s.phase === 'windup' ? span.windup - s.elapsed : s.phase === 'active' ? -s.elapsed : Infinity;
      if (untilStrike <= dt && untilStrike + span.active >= 0) {
        contact.from = Math.max(0, untilStrike / dt);
        contact.to = Math.min(1, (untilStrike + span.active) / dt);
      }
      s.cooldown = Math.max(0, s.cooldown - dt);
      if (s.phase === 'idle') return null;
      s.elapsed += dt;
      if (s.elapsed < span[s.phase]) return null;
      s.elapsed -= span[s.phase];
      if (s.phase === 'windup') {
        s.phase = 'active';
        return 'strike';
      }
      if (s.phase === 'active') {
        s.phase = 'recover';
        return null;
      }
      s.phase = 'idle';
      s.elapsed = 0;
      s.cooldown = t.cooldownSeconds;
      return 'done';
    },
    /** The paddle's angle from his heading (right-hand side), as paddle.ts `angle`. */
    get angle() {
      const p = progress();
      switch (s.phase) {
        case 'windup':
          return restAngle + (strikeStart - restAngle) * smoothstep(p);
        case 'active':
          return strikeStart + (strikeEnd - strikeStart) * p;
        case 'recover':
          return strikeEnd + (restAngle - strikeEnd) * smoothstep(p);
        default:
          return restAngle;
      }
    },
    /** How far his arm is committed to the swing, 0 (carrying) .. 1, as paddle.ts `armCommitment`. */
    get commitment() {
      const p = progress();
      if (s.phase === 'windup') return smoothstep(p);
      if (s.phase === 'active') return 1;
      if (s.phase === 'recover') return 1 - smoothstep(p);
      return 0;
    },
    /** Where the head aims for him at (x, y, z) facing `heading` (y: the bottom of his machine), as writeHeadFor. */
    headTarget(x, y, z, heading, out) {
      const cos = Math.cos(heading), sin = Math.sin(heading);
      const yaw = heading + this.angle;
      out.x = x - cos * PADDLE.pivotOffset + Math.sin(yaw) * PADDLE.reach;
      out.y = y + PADDLE.pivotHeight - t.headDrop * this.commitment;
      out.z = z + sin * PADDLE.pivotOffset + Math.cos(yaw) * PADDLE.reach;
      return out;
    },
  };
}

const FULL_FRAME = Object.freeze({ from: 0, to: 1 });

/**
 * Drawn face a→b against the rider previous→current, at the SAME instant. Work in relative coordinates so forward,
 * reverse and hopping cannot tunnel through it or collide with a place the rider has already left. Solve the segment
 * exactly, clipped to the striking part of this frame; six discrete samples used to miss grazing contacts.
 * The upright hit volume retains the existing radius/height and hop clearance; no enlarged invisible reach.
 */
export function sweptHit(ax, ay, az, bx, by, bz, rider, tuning = SWING, previous = rider, interval = FULL_FRAME) {
  let lo = Math.max(0, interval.from), hi = Math.min(1, interval.to);
  if (lo > hi) return false;
  ax -= previous.x; ay -= previous.bottom; az -= previous.z;
  bx -= rider.x; by -= rider.bottom; bz -= rider.z;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const bottom = -PADDLE.headRadius, top = tuning.riderHeight;
  if (Math.abs(dy) < 1e-12) {
    if (ay < bottom || ay > top) return false;
  } else {
    const a = (bottom - ay) / dy, b = (top - ay) / dy;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
    if (lo > hi) return false;
  }
  const lengthSq = dx * dx + dz * dz;
  const k = lengthSq > 1e-12 ? Math.max(lo, Math.min(hi, -(ax * dx + az * dz) / lengthSq)) : lo;
  const x = ax + dx * k, z = az + dz * k;
  return x * x + z * z <= tuning.hitRadius * tuning.hitRadius;
}
