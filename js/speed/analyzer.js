/**
 * Speed & output tracking for striking and speed work.
 *
 * A strike is detected as an extension–retraction cycle of one hand: the wrist
 * accelerates away from the shoulder past a distance threshold, peaks, then
 * comes back. Hand speed is converted to m/s using the athlete's height as the
 * scale reference, so it is an estimate — good for comparing rounds, not a
 * calibrated radar gun.
 */

import { KP, toPixels, dist, mid, bodyPixelHeight } from '../pose/angles.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Per-hand extension state machine. */
class HandTracker {
  constructor(name) {
    this.name = name;
    this.state = 'in';        // 'in' (guard) | 'out' (extending)
    this.peakSpeed = 0;
    this.startedAt = 0;
    this.lastPos = null;
    this.lastT = 0;
    this.speed = 0;           // smoothed, in metres per second
    this.lastStrikeAt = 0;
  }

  reset() {
    this.state = 'in';
    this.peakSpeed = 0;
    this.lastPos = null;
    this.speed = 0;
  }

  /**
   * @returns {object|null} a completed strike, if this frame finished one
   */
  update(wrist, shoulder, reach, mPerPx, t, opts) {
    if (!wrist || !shoulder || !isNum(reach) || reach <= 0) { this.lastPos = null; return null; }

    // Instantaneous hand speed.
    if (this.lastPos && t > this.lastT) {
      const dtSec = (t - this.lastT) / 1000;
      if (dtSec > 0.004 && dtSec < 0.5) {
        const raw = (dist(wrist, this.lastPos) * mPerPx) / dtSec;
        this.speed = this.speed + 0.45 * (raw - this.speed);
      }
    }
    this.lastPos = { x: wrist.x, y: wrist.y };
    this.lastT = t;

    // Extension measured against the athlete's own reach.
    const extension = dist(wrist, shoulder) / reach;

    if (this.state === 'in' && extension > opts.extendAt) {
      this.state = 'out';
      this.startedAt = t;
      this.peakSpeed = this.speed;
      return null;
    }

    if (this.state === 'out') {
      this.peakSpeed = Math.max(this.peakSpeed, this.speed);
      if (extension < opts.retractAt) {
        this.state = 'in';
        const duration = t - this.startedAt;
        const gap = t - this.lastStrikeAt;
        const fast = duration >= opts.minDurationMs && duration <= opts.maxDurationMs;
        if (!fast || gap < opts.refractoryMs || this.peakSpeed < opts.minSpeed) {
          this.peakSpeed = 0;
          return null;
        }
        this.lastStrikeAt = t;
        const strike = {
          hand: this.name,
          at: t,
          durationMs: Math.round(duration),
          peakSpeed: Math.round(this.peakSpeed * 100) / 100,
        };
        this.peakSpeed = 0;
        return strike;
      }
    }
    return null;
  }
}

export const SPEED_MODES = {
  strike: {
    id: 'strike',
    label: 'Strike work',
    emoji: '🥊',
    hint: 'Face the camera from about 2.5 m so both hands stay in frame.',
    extendAt: 0.78,
    retractAt: 0.55,
    minDurationMs: 110,
    maxDurationMs: 1200,
    refractoryMs: 130,
    minSpeed: 1.6,
    unitLabel: 'Punches',
  },
  speed: {
    id: 'speed',
    label: 'Speed reps',
    emoji: '⚡',
    hint: 'Any fast repeated arm drive — jabs, ropes, band punches.',
    extendAt: 0.72,
    retractAt: 0.52,
    minDurationMs: 90,
    maxDurationMs: 1500,
    refractoryMs: 110,
    minSpeed: 1.2,
    unitLabel: 'Reps',
  },
};

export class SpeedAnalyzer {
  constructor({ heightCm = 170, mode = 'strike' } = {}) {
    this.heightCm = heightCm;
    this.setMode(mode);
    this.reset();
  }

  setMode(mode) {
    this.mode = SPEED_MODES[mode] ? mode : 'strike';
    this.opts = SPEED_MODES[this.mode];
  }

  reset() {
    this.left = new HandTracker('left');
    this.right = new HandTracker('right');
    this.strikes = [];
    this.startedAt = null;      // null, not 0 — 0 is a valid timestamp
    this.lastSeenAt = 0;
  }

  /** Clears counters for a new round but keeps configuration. */
  startRound(t = performance.now()) {
    this.left.reset();
    this.right.reset();
    this.strikes = [];
    this.startedAt = t;
  }

  /**
   * @param {Array|null} landmarks smoothed normalised landmarks
   * @returns {object} live metrics for this frame
   */
  push(landmarks, width, height, t = performance.now(), { active = true } = {}) {
    if (!landmarks || landmarks.length < 33) {
      this.left.lastPos = null;
      this.right.lastPos = null;
      return this.snapshot(t, false);
    }
    this.lastSeenAt = t;

    const px = toPixels(landmarks, width, height);
    const bodyPx = bodyPixelHeight(px);
    const mPerPx = bodyPx ? (this.heightCm / 100) / bodyPx : null;
    if (!mPerPx) return this.snapshot(t, true);

    // Reach = shoulder-to-wrist span at full extension, approximated by the
    // upper-arm + forearm segments so it scales with the individual.
    const reachL = segmentReach(px, 'left');
    const reachR = segmentReach(px, 'right');

    if (active) {
      const a = this.left.update(px[KP.leftWrist], px[KP.leftShoulder], reachL, mPerPx, t, this.opts);
      const b = this.right.update(px[KP.rightWrist], px[KP.rightShoulder], reachR, mPerPx, t, this.opts);
      if (a) this.strikes.push(a);
      if (b) this.strikes.push(b);
      return this.snapshot(t, true, [a, b].filter(Boolean));
    }
    return this.snapshot(t, true);
  }

  snapshot(t, tracked, landed = []) {
    const elapsedMs = this.startedAt === null ? 0 : Math.max(0, t - this.startedAt);
    const minutes = elapsedMs / 60000;
    const speeds = this.strikes.map((s) => s.peakSpeed).filter(isNum);

    // Output: strikes in the last 10 s, scaled to a per-minute rate — responds
    // quickly rather than averaging the whole round flat.
    const recent = this.strikes.filter((s) => t - s.at <= 10000);
    const window = Math.min(10000, elapsedMs) / 60000;

    return {
      tracked,
      landed,
      count: this.strikes.length,
      left: this.strikes.filter((s) => s.hand === 'left').length,
      right: this.strikes.filter((s) => s.hand === 'right').length,
      liveSpeed: Math.round(Math.max(this.left.speed, this.right.speed) * 10) / 10,
      peakSpeed: speeds.length ? Math.round(Math.max(...speeds) * 10) / 10 : 0,
      avgSpeed: speeds.length
        ? Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10 : 0,
      output: window > 0.02 ? Math.round(recent.length / window) : 0,
      perMinute: minutes > 0.05 ? Math.round(this.strikes.length / minutes) : 0,
      elapsedMs,
    };
  }

  /** Round summary for storage. */
  summary(roundIndex, durationMs) {
    const speeds = this.strikes.map((s) => s.peakSpeed).filter(isNum);
    const minutes = durationMs / 60000;
    return {
      index: roundIndex,
      durationMs: Math.round(durationMs),
      strikes: this.strikes.length,
      left: this.strikes.filter((s) => s.hand === 'left').length,
      right: this.strikes.filter((s) => s.hand === 'right').length,
      peakSpeed: speeds.length ? Math.round(Math.max(...speeds) * 10) / 10 : 0,
      avgSpeed: speeds.length
        ? Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 10) / 10 : 0,
      output: minutes > 0 ? Math.round(this.strikes.length / minutes) : 0,
      timeline: this.strikes.map((s) => ({
        at: Math.round(s.at - this.startedAt),
        hand: s.hand,
        peakSpeed: s.peakSpeed,
      })),
    };
  }
}

/** Upper arm + forearm length in pixels — the athlete's own reach. */
function segmentReach(px, side) {
  const S = px[side === 'left' ? KP.leftShoulder : KP.rightShoulder];
  const E = px[side === 'left' ? KP.leftElbow : KP.rightElbow];
  const W = px[side === 'left' ? KP.leftWrist : KP.rightWrist];
  const upper = dist(S, E);
  const fore = dist(E, W);
  if (isNum(upper) && isNum(fore) && upper + fore > 10) return upper + fore;
  // Fall back to a proportion of shoulder width if an elbow is hidden.
  const shoulderW = dist(px[KP.leftShoulder], px[KP.rightShoulder]);
  return isNum(shoulderW) ? shoulderW * 1.55 : null;
}

/** Aggregates a set of rounds into a session record. */
export function sessionTotals(rounds) {
  if (!rounds.length) return { strikes: 0, peakSpeed: 0, avgOutput: 0, durationMs: 0 };
  const strikes = rounds.reduce((a, r) => a + r.strikes, 0);
  const durationMs = rounds.reduce((a, r) => a + r.durationMs, 0);
  return {
    strikes,
    peakSpeed: Math.max(...rounds.map((r) => r.peakSpeed || 0)),
    avgOutput: Math.round(rounds.reduce((a, r) => a + (r.output || 0), 0) / rounds.length),
    durationMs,
  };
}

export const SPEED_DISCLAIMER =
  'Speed is estimated by scaling hand movement against your height, so it is a relative measure — excellent for comparing round to round, not a calibrated instrument. Strikes are counted from arm extension, so shadow work counts the same as bag work.';

export { dist, mid };
