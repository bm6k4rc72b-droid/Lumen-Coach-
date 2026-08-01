/**
 * Turns a stream of pose frames into reps, form scores, cues and gait metrics.
 *
 * Everything is incremental — one `push(frame)` per analysed video frame — so
 * it stays cheap enough for mid-range phones.
 */

import { KP, computeAngles, toPixels, bodyPixelHeight, dist } from './angles.js';
import { deriveForExercise, getExercise, LEVEL_SCORE } from './exercises.js';

const BUFFER_MS = 6000;
const SEVERITY = { good: 0, warn: 1, bad: 2 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Rolling min/max tracker over an angle object. */
function extend(target, angles, cmp) {
  for (const [k, v] of Object.entries(angles)) {
    if (!isNum(v)) continue;
    if (!isNum(target[k]) || cmp(v, target[k])) target[k] = v;
  }
}

export class FormAnalyzer {
  constructor(exerciseId, opts = {}) {
    this.setExercise(exerciseId);
    this.heightCm = opts.heightCm || 170;
    this.reps = [];
    this.frames = [];
    this.startedAt = performance.now();
    this.lastCueAt = 0;
    this.cue = null;
    this.state = null;      // 'ready' | 'active'
    this.repMin = {};
    this.repMax = {};
    this.repStart = 0;
    this.stepTimes = [];
    this.lastCrossSign = 0;
    this.gaitSignal = null;
    this.lastSeenAt = 0;
  }

  setExercise(exerciseId) {
    this.exercise = getExercise(exerciseId);
    this.exerciseId = this.exercise.id;
    this.resetRepState();
    this.reps = [];
    this.stepTimes = [];
    this.frames = [];
  }

  resetRepState() {
    this.state = null;
    this.repMin = {};
    this.repMax = {};
    this.repStart = 0;
  }

  reset() {
    this.reps = [];
    this.frames = [];
    this.stepTimes = [];
    this.gaitSignal = null;
    this.lastCrossSign = 0;
    this.resetRepState();
    this.startedAt = performance.now();
  }

  /**
   * @param {Array|null} landmarks smoothed normalised landmarks (or null)
   * @returns {object} live analysis for this frame
   */
  push(landmarks, width, height, t = performance.now()) {
    if (!landmarks || landmarks.length < 33) {
      const stale = t - this.lastSeenAt > 900;
      if (stale) this.resetRepState();
      return this.emptyResult(stale);
    }
    this.lastSeenAt = t;

    const px = toPixels(landmarks, width, height);
    const { angles, points, shoulderWidth, view, facing, coverage } = computeAngles(px);
    deriveForExercise(this.exerciseId, angles, px, points, shoulderWidth);

    const bodyPx = bodyPixelHeight(px);
    this.frames.push({ t, angles, points, px, bodyPx, shoulderWidth });
    while (this.frames.length && t - this.frames[0].t > BUFFER_MS) this.frames.shift();

    const gait = this.exercise.gait ? this.updateGait(t, px, points, bodyPx) : null;

    const ctx = {
      t, angles, points, px, shoulderWidth, view, facing, coverage,
      repMin: this.repMin, repMax: this.repMax,
      wobble: this.wobble(shoulderWidth),
      torsoSwing: this.torsoSwing(),
      cadence: gait?.cadence ?? null,
      overstride: gait?.overstride ?? null,
      bounce: gait?.bounce ?? null,
    };

    let completedRep = null;
    if (!this.exercise.gait) completedRep = this.updateReps(ctx, t);

    const evaluated = this.evaluate(ctx);
    const cue = this.pickCue(evaluated, coverage, t);

    return {
      ok: true,
      angles, points, px, view, facing, coverage,
      checks: evaluated,
      cue,
      level: cue?.level || 'idle',
      reps: this.reps.length,
      repCount: this.reps.length,
      lastRep: this.reps[this.reps.length - 1] || null,
      completedRep,
      phase: this.state === 'active' ? 'work' : 'ready',
      score: this.score(),
      gait,
      liveScore: scoreOf(evaluated),
    };
  }

  emptyResult(stale) {
    return {
      ok: false,
      angles: null, points: null, px: null, checks: [],
      cue: { level: 'idle', text: stale ? 'Step into frame — full body visible' : 'Finding you…' },
      level: 'idle',
      reps: this.reps.length,
      repCount: this.reps.length,
      lastRep: this.reps[this.reps.length - 1] || null,
      completedRep: null,
      phase: 'ready',
      score: this.score(),
      gait: null,
      liveScore: null,
    };
  }

  /* ------------------------------------------------------------ rep engine */

  updateReps(ctx, t) {
    const spec = this.exercise.rep;
    if (!spec) return null;
    const m = spec.metric(ctx.angles);
    if (!isNum(m)) return null;

    // Track extremes for whichever rep is in progress.
    extend(this.repMin, ctx.angles, (v, cur) => v < cur);
    extend(this.repMax, ctx.angles, (v, cur) => v > cur);

    const enter = spec.dir === 'down' ? m < spec.down : m > spec.up;
    const exit = spec.dir === 'down' ? m > spec.up : m < spec.down;

    if (this.state === null) {
      // Wait until we see the "start" position before arming.
      if (exit) this.state = 'ready';
      return null;
    }

    if (this.state === 'ready' && enter) {
      this.state = 'active';
      this.repStart = t;
      this.repMin = { ...ctx.angles };
      this.repMax = { ...ctx.angles };
      return null;
    }

    if (this.state === 'active' && exit) {
      const duration = t - this.repStart;
      this.state = 'ready';
      if (duration < 350) { this.resetExtremes(ctx); return null; }   // debounce twitches

      const repCtx = { ...ctx, repMin: this.repMin, repMax: this.repMax };
      const checks = this.evaluate(repCtx, true);
      const rep = {
        index: this.reps.length + 1,
        at: Date.now(),
        durationMs: Math.round(duration),
        score: scoreOf(checks) ?? 0,
        checks: checks.map(({ id, label, value, level, unit }) => ({
          id, label, level, unit, value: isNum(value) ? Math.round(value * 10) / 10 : null,
        })),
        angles: snapshotAngles(this.repMin, this.repMax),
      };
      this.reps.push(rep);
      this.resetExtremes(ctx);
      return rep;
    }
    return null;
  }

  resetExtremes(ctx) {
    this.repMin = { ...ctx.angles };
    this.repMax = { ...ctx.angles };
  }

  /* -------------------------------------------------------------- checking */

  evaluate(ctx, all = false) {
    const out = [];
    for (const check of this.exercise.checks) {
      // Phase-gated checks only make sense once a rep has produced extremes.
      if (!all && check.phase !== 'any' && this.state !== 'active' && !this.reps.length) continue;
      const res = check.evaluate(ctx);
      if (res) out.push(res);
    }
    return out;
  }

  pickCue(checks, coverage, t) {
    if (coverage < 0.55) {
      return { level: 'idle', text: 'Move back so your whole body is in frame' };
    }
    if (!checks.length) {
      return { level: 'idle', text: this.exercise.gait ? 'Start running when ready' : 'Start your first rep when ready' };
    }
    const worst = [...checks].sort((a, b) =>
      (SEVERITY[b.level] - SEVERITY[a.level]) || (b.weight - a.weight))[0];

    // Hold a cue briefly so the banner is readable rather than flickering.
    const hold = worst.level === 'good' ? 1500 : 900;
    if (this.cue && t - this.lastCueAt < hold && SEVERITY[worst.level] <= SEVERITY[this.cue.level]) {
      return this.cue;
    }
    this.cue = { level: worst.level, text: worst.cue, checkId: worst.id };
    this.lastCueAt = t;
    return this.cue;
  }

  /* ------------------------------------------------------------ stability */

  wobble(shoulderWidth) {
    if (this.frames.length < 8 || !shoulderWidth) return null;
    const recent = this.frames.slice(-40).map((f) => f.points.hipMid?.x).filter(isNum);
    if (recent.length < 8) return null;
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const sd = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length);
    return (sd / shoulderWidth) * 100;
  }

  torsoSwing() {
    const window = this.state === 'active' ? this.frames.filter((f) => f.t >= this.repStart) : this.frames.slice(-40);
    const vals = window.map((f) => f.angles.torsoLean).filter(isNum);
    if (vals.length < 6) return null;
    return Math.max(...vals) - Math.min(...vals);
  }

  /* ------------------------------------------------------------------ gait */

  /**
   * Step detection from the scissoring of the ankles in the sagittal plane.
   * One zero-crossing of (leftAnkle.x − rightAnkle.x) ≈ one foot strike.
   */
  updateGait(t, px, points, bodyPx) {
    const la = px[KP.leftAnkle], ra = px[KP.rightAnkle];
    if (!la || !ra || !bodyPx || la.v < 0.4 || ra.v < 0.4) return this.gaitSummary(bodyPx, points, px);

    const raw = (la.x - ra.x) / bodyPx;
    this.gaitSignal = this.gaitSignal === null ? raw : this.gaitSignal + 0.35 * (raw - this.gaitSignal);

    const sign = Math.sign(this.gaitSignal);
    const amplitude = Math.abs(this.gaitSignal);
    const last = this.stepTimes[this.stepTimes.length - 1];

    if (sign !== 0 && this.lastCrossSign !== 0 && sign !== this.lastCrossSign) {
      if (!last || t - last > 180) this.stepTimes.push(t);
    }
    if (sign !== 0 && amplitude > 0.02) this.lastCrossSign = sign;

    while (this.stepTimes.length && t - this.stepTimes[0] > 8000) this.stepTimes.shift();

    return this.gaitSummary(bodyPx, points, px, t);
  }

  gaitSummary(bodyPx, points, px, t = performance.now()) {
    const steps = this.stepTimes;
    let cadence = null;
    if (steps.length >= 4) {
      const spans = [];
      for (let i = 1; i < steps.length; i++) spans.push(steps[i] - steps[i - 1]);
      spans.sort((a, b) => a - b);
      const median = spans[Math.floor(spans.length / 2)];
      if (median > 150 && median < 900) cadence = 60000 / median;
    }
    if (cadence && steps.length && t - steps[steps.length - 1] > 2500) cadence = null;

    // Peak ankle separation over the recent window ≈ step length in pixels.
    let stepLenPx = null;
    const recent = this.frames.slice(-90);
    for (const f of recent) {
      const d = Math.abs((f.px[KP.leftAnkle]?.x ?? 0) - (f.px[KP.rightAnkle]?.x ?? 0));
      if (isNum(d)) stepLenPx = stepLenPx === null ? d : Math.max(stepLenPx, d);
    }

    const mPerPx = bodyPx ? (this.heightCm / 100) / bodyPx : null;
    const stepLength = stepLenPx && mPerPx ? stepLenPx * mPerPx : null;
    const speed = cadence && stepLength ? stepLength * (cadence / 60) : null;   // m/s

    // Overstride: lead ankle ahead of the hip at maximum extension.
    let overstride = null;
    if (bodyPx && points?.hipMid && px) {
      const lead = Math.max(
        Math.abs((px[KP.leftAnkle]?.x ?? points.hipMid.x) - points.hipMid.x),
        Math.abs((px[KP.rightAnkle]?.x ?? points.hipMid.x) - points.hipMid.x),
      );
      overstride = (lead / bodyPx) * 100;
    }

    // Vertical oscillation of the hips over the recent window.
    let bounce = null;
    const hipY = recent.map((f) => f.points.hipMid?.y).filter(isNum);
    if (hipY.length > 20 && bodyPx) {
      bounce = ((Math.max(...hipY) - Math.min(...hipY)) / bodyPx) * 100;
    }

    return {
      cadence: cadence ? Math.round(cadence) : null,
      steps: steps.length,
      stepLength: stepLength ? Math.round(stepLength * 100) / 100 : null,
      speed: speed ? Math.round(speed * 100) / 100 : null,
      kph: speed ? Math.round(speed * 3.6 * 10) / 10 : null,
      paceSecPerKm: speed && speed > 0.5 ? Math.round(1000 / speed) : null,
      overstride: overstride === null ? null : Math.round(overstride * 10) / 10,
      bounce: bounce === null ? null : Math.round(bounce * 10) / 10,
    };
  }

  /* ---------------------------------------------------------------- output */

  score() {
    if (!this.reps.length) return null;
    return Math.round(this.reps.reduce((a, r) => a + r.score, 0) / this.reps.length);
  }

  /** Aggregated summary for saving a set. */
  summary() {
    const reps = this.reps;
    const byCheck = new Map();
    for (const rep of reps) {
      for (const c of rep.checks) {
        if (!byCheck.has(c.id)) byCheck.set(c.id, { id: c.id, label: c.label, unit: c.unit, values: [], levels: [] });
        const entry = byCheck.get(c.id);
        if (isNum(c.value)) entry.values.push(c.value);
        entry.levels.push(c.level);
      }
    }
    const checks = [...byCheck.values()].map((e) => {
      const avg = e.values.length ? e.values.reduce((a, b) => a + b, 0) / e.values.length : null;
      const worst = e.levels.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), 'good');
      const goodPct = Math.round((e.levels.filter((l) => l === 'good').length / e.levels.length) * 100);
      return {
        id: e.id, label: e.label, unit: e.unit,
        avg: avg === null ? null : Math.round(avg * 10) / 10,
        worst, goodPct,
      };
    });

    const durations = reps.map((r) => r.durationMs);
    return {
      reps: reps.length,
      score: this.score(),
      checks,
      tempoMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      bestRep: reps.length ? Math.max(...reps.map((r) => r.score)) : null,
      worstRep: reps.length ? Math.min(...reps.map((r) => r.score)) : null,
      repDetail: reps.map((r) => ({ index: r.index, score: r.score, durationMs: r.durationMs, angles: r.angles })),
    };
  }
}

function scoreOf(checks) {
  if (!checks.length) return null;
  let sum = 0, weight = 0;
  for (const c of checks) {
    sum += LEVEL_SCORE[c.level] * c.weight;
    weight += c.weight;
  }
  return weight ? Math.round(sum / weight) : null;
}

/** Keeps the angles a trainer actually reviews later. */
function snapshotAngles(minAngles, maxAngles) {
  const keys = ['knee', 'kneeFront', 'kneeRear', 'hip', 'ankle', 'shoulder', 'elbow', 'torsoLean', 'plank', 'shin'];
  const out = {};
  for (const k of keys) {
    const lo = minAngles[k], hi = maxAngles[k];
    if (!isNum(lo) && !isNum(hi)) continue;
    out[k] = {
      min: isNum(lo) ? Math.round(lo) : null,
      max: isNum(hi) ? Math.round(hi) : null,
    };
  }
  return out;
}

export { dist };
