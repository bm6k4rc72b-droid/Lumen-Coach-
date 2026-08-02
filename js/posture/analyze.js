/**
 * Static posture assessment from a single still frame.
 *
 * Modelled on the measures a physical therapist takes off a plumb-line photo:
 * craniovertebral (forward head) angle, shoulder protraction, trunk lean,
 * pelvic tilt proxy, knee position and ankle position in the sagittal view;
 * head/shoulder/pelvis levelness and knee tracking in the frontal view.
 *
 * SCREENING ONLY. These are photogrammetric estimates from one 2D frame.
 * They are not a diagnosis and cannot replace a hands-on assessment.
 */

import { KP, toPixels, angleAt, angleFromVertical, mid, dist, offLine } from '../pose/angles.js';

/* --------------------------------------------------------- normative bands */

/**
 * Each measure declares the range considered unremarkable (`ideal`), a
 * borderline band (`watch`), and the direction language used in the report.
 * Ranges are drawn from commonly cited posture-screening literature; they are
 * population guides, not per-person truth.
 */
export const MEASURES = {
  forwardHead: {
    label: 'Forward head',
    unit: '°',
    view: 'side',
    ideal: [48, 90],       // craniovertebral angle; <48° widely cited as forward head
    watch: [43, 48],
    invert: true,          // lower is worse
    about: 'Angle from the shoulder to the ear against horizontal. Smaller means the head sits further forward.',
    high: 'Head well stacked over the shoulders.',
    mid: 'Head sits slightly forward of the shoulders.',
    low: 'Head carried notably forward — the classic desk-posture pattern.',
    work: [
      'Chin tucks: 10 slow reps, 3× a day.',
      'Raise screens to eye level.',
      'Loosen the chest and strengthen the deep neck flexors.',
    ],
  },
  shoulderProtraction: {
    label: 'Shoulder position',
    unit: '°',
    view: 'side',
    ideal: [0, 12],        // shoulder ahead of the hip-ankle plumb line
    watch: [12, 20],
    about: 'How far the shoulder sits ahead of the plumb line through the ankle.',
    high: 'Shoulders stacked over the mid-foot.',
    mid: 'Shoulders drifting slightly forward.',
    low: 'Shoulders rounded well forward of the plumb line.',
    work: [
      'Doorway pec stretch, 30 s each side.',
      'Band pull-aparts and face pulls, 2–3× a week.',
      'Think "collarbones wide" when standing.',
    ],
  },
  trunkLean: {
    label: 'Trunk lean',
    unit: '°',
    view: 'side',
    ideal: [0, 5],
    watch: [5, 10],
    about: 'Tilt of the torso away from vertical.',
    high: 'Trunk upright and balanced.',
    mid: 'Slight lean through the trunk.',
    low: 'Noticeable lean — worth checking hip mobility and balance.',
    work: [
      'Hip flexor stretch, 45 s each side.',
      'Dead bug and side plank for trunk control.',
    ],
  },
  pelvicTilt: {
    label: 'Pelvic tilt',
    unit: '°',
    view: 'side',
    ideal: [0, 10],
    watch: [10, 17],
    about: 'Tilt of the hip-to-knee line, a proxy for anterior pelvic tilt. A true measure needs bony landmarks.',
    high: 'Pelvis looks neutral.',
    mid: 'Mild anterior tilt through the pelvis.',
    low: 'Pronounced anterior tilt — often pairs with a tight hip flexor and a long lower back.',
    work: [
      'Glute bridges, 3×12, squeezing at the top.',
      'Hip flexor stretch before lower-body work.',
      'Practise ribs-down breathing.',
    ],
  },
  kneePosition: {
    label: 'Knee position',
    unit: '°',
    view: 'side',
    ideal: [172, 182],     // ~180° is neutral; below = flexed, above = hyperextended
    watch: [166, 188],
    centred: 177,
    about: 'Hip–knee–ankle angle standing at rest. Around 180° is neutral.',
    high: 'Knees resting in a neutral position.',
    mid: 'Knees slightly bent or pushed back at rest.',
    low: 'Knees held well out of neutral at rest.',
    work: [
      'Stand with a soft, unlocked knee.',
      'Balance work: single-leg stands, 30 s each side.',
    ],
  },
  anklePosition: {
    label: 'Shin angle',
    unit: '°',
    view: 'side',
    ideal: [0, 6],
    watch: [6, 12],
    about: 'Lean of the shin from vertical while standing.',
    high: 'Weight balanced over the mid-foot.',
    mid: 'Weight drifting slightly forward or back.',
    low: 'Weight noticeably off the mid-foot.',
    work: ['Calf and ankle mobility work.', 'Practise standing with weight through the mid-foot.'],
  },
  shoulderLevel: {
    label: 'Shoulder level',
    unit: '°',
    view: 'front',
    ideal: [0, 2.5],
    watch: [2.5, 5],
    about: 'Height difference between the shoulders.',
    high: 'Shoulders sitting level.',
    mid: 'One shoulder slightly higher.',
    low: 'Clear shoulder height difference.',
    work: [
      'Check for a dominant carrying side (bag, child, tools).',
      'Single-arm carries on the low side.',
    ],
  },
  pelvisLevel: {
    label: 'Hip level',
    unit: '°',
    view: 'front',
    ideal: [0, 2.5],
    watch: [2.5, 5],
    about: 'Height difference between the hips.',
    high: 'Hips sitting level.',
    mid: 'One hip slightly higher.',
    low: 'Clear hip height difference — worth a professional look.',
    work: [
      'Avoid standing hip-shot on one leg.',
      'Single-leg glute work on the low side.',
    ],
  },
  headTilt: {
    label: 'Head tilt',
    unit: '°',
    view: 'front',
    ideal: [0, 3],
    watch: [3, 6],
    about: 'Sideways tilt of the head relative to level.',
    high: 'Head sitting level.',
    mid: 'Slight head tilt.',
    low: 'Noticeable head tilt.',
    work: ['Gentle lateral neck stretches, both sides.', 'Check screen and desk position.'],
  },
  kneeTracking: {
    label: 'Knee tracking',
    unit: '%',
    view: 'front',
    ideal: [0, 6],
    watch: [6, 12],
    about: 'How far the knees sit off the hip-to-ankle line, as a share of shoulder width.',
    high: 'Knees tracking over the feet.',
    mid: 'Knees drifting slightly inward or outward.',
    low: 'Knees sitting well off the hip-to-ankle line.',
    work: [
      'Banded lateral walks, 2×15 each way.',
      'Slow tempo squats with a knees-out cue.',
    ],
  },
};

const DEG = 180 / Math.PI;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Rates a value against a measure's bands. Returns level + 0-100 score. */
export function rate(measure, value) {
  if (!isNum(value)) return null;
  const { ideal, watch, invert } = measure;
  const inside = (b) => b && value >= b[0] && value <= b[1];

  let level;
  if (inside(ideal)) level = 'good';
  else if (inside(watch)) level = 'warn';
  else level = 'bad';

  // Score by distance from the ideal band, normalised by the watch margin.
  let score;
  if (level === 'good') {
    score = 100;
  } else {
    const nearest = value < ideal[0] ? ideal[0] : ideal[1];
    const margin = Math.max(1e-6, invert
      ? Math.abs(ideal[0] - watch[0])
      : Math.abs((value < ideal[0] ? ideal[0] - watch[0] : watch[1] - ideal[1])));
    const excess = Math.abs(value - nearest);
    score = Math.round(Math.max(0, 100 - (excess / margin) * 30));
  }
  return { level, score: Math.max(0, Math.min(100, score)) };
}

/* --------------------------------------------------------------- geometry */

/** Angle of segment a→b from horizontal, signed: positive = b is lower. */
function tiltFromHorizontal(a, b) {
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 1e-6) return null;
  return Math.atan2(dy, Math.abs(dx)) * DEG;
}

/** Picks the better-tracked side for sagittal measures. */
function sagittalSide(px) {
  const left = (px[KP.leftShoulder]?.v ?? 0) + (px[KP.leftHip]?.v ?? 0) + (px[KP.leftAnkle]?.v ?? 0);
  const right = (px[KP.rightShoulder]?.v ?? 0) + (px[KP.rightHip]?.v ?? 0) + (px[KP.rightAnkle]?.v ?? 0);
  return right > left ? 'right' : 'left';
}

/** front | side, from how wide the shoulders read relative to torso length. */
export function detectPostureView(px) {
  const shoulderW = dist(px[KP.leftShoulder], px[KP.rightShoulder]) || 0;
  const hipW = dist(px[KP.leftHip], px[KP.rightHip]) || 0;
  const torso = dist(
    mid(px[KP.leftShoulder], px[KP.rightShoulder]),
    mid(px[KP.leftHip], px[KP.rightHip]),
  ) || 1;
  const ratio = Math.max(shoulderW, hipW) / torso;
  return ratio < 0.6 ? 'side' : 'front';
}

/**
 * @param {Array} landmarks normalised MediaPipe pose landmarks
 * @returns {object} measures keyed by id, plus view + plumb-line geometry
 */
export function analyzePosture(landmarks, width, height, { view = 'auto' } = {}) {
  const px = toPixels(landmarks, width, height);
  const resolvedView = view === 'auto' ? detectPostureView(px) : view;

  const shoulderMid = mid(px[KP.leftShoulder], px[KP.rightShoulder]);
  const hipMid = mid(px[KP.leftHip], px[KP.rightHip]);
  const ankleMid = mid(px[KP.leftAnkle], px[KP.rightAnkle]);
  const earMid = mid(px[KP.leftEar], px[KP.rightEar]);
  const kneeMid = mid(px[KP.leftKnee], px[KP.rightKnee]);
  const shoulderWidth = dist(px[KP.leftShoulder], px[KP.rightShoulder]) || 1;

  const values = {};
  const points = { shoulderMid, hipMid, ankleMid, earMid, kneeMid };

  if (resolvedView === 'side') {
    const side = sagittalSide(px);
    const S = px[side === 'left' ? KP.leftShoulder : KP.rightShoulder];
    const E = px[side === 'left' ? KP.leftEar : KP.rightEar];
    const H = px[side === 'left' ? KP.leftHip : KP.rightHip];
    const K = px[side === 'left' ? KP.leftKnee : KP.rightKnee];
    const A = px[side === 'left' ? KP.leftAnkle : KP.rightAnkle];
    points.side = side;
    points.sagittal = { S, E, H, K, A };

    // Craniovertebral angle: shoulder→ear against horizontal.
    if (S && E) {
      const dx = Math.abs(E.x - S.x);
      const dy = Math.abs(S.y - E.y);
      values.forwardHead = Math.atan2(dy, Math.max(1e-6, dx)) * DEG;
    }

    // Shoulder ahead of the ankle plumb line, expressed as an angle.
    if (S && A) {
      const dx = Math.abs(S.x - A.x);
      const dy = Math.abs(A.y - S.y);
      values.shoulderProtraction = Math.atan2(dx, Math.max(1e-6, dy)) * DEG;
    }

    values.trunkLean = angleFromVertical(hipMid, shoulderMid);
    if (H && K) values.pelvicTilt = Math.abs(90 - Math.abs(tiltFromHorizontal(H, K) ?? 90));
    values.kneePosition = angleAt(H, K, A);
    if (A && K) values.anklePosition = angleFromVertical(A, K);
  } else {
    values.shoulderLevel = Math.abs(tiltFromHorizontal(px[KP.leftShoulder], px[KP.rightShoulder]) ?? NaN);
    values.pelvisLevel = Math.abs(tiltFromHorizontal(px[KP.leftHip], px[KP.rightHip]) ?? NaN);
    values.headTilt = Math.abs(tiltFromHorizontal(px[KP.leftEye], px[KP.rightEye]) ?? NaN);

    const trackL = offLine(px[KP.leftKnee], px[KP.leftHip], px[KP.leftAnkle]);
    const trackR = offLine(px[KP.rightKnee], px[KP.rightHip], px[KP.rightAnkle]);
    if (trackL !== null || trackR !== null) {
      values.kneeTracking = (Math.max(Math.abs(trackL ?? 0), Math.abs(trackR ?? 0)) / shoulderWidth) * 100;
    }
    values.trunkLean = angleFromVertical(hipMid, shoulderMid);
  }

  // Rate everything that applies to this view.
  const measures = {};
  for (const [id, spec] of Object.entries(MEASURES)) {
    if (spec.view !== resolvedView && !(id === 'trunkLean')) continue;
    const value = values[id];
    const rated = rate(spec, value);
    if (!rated) continue;
    measures[id] = {
      id,
      label: spec.label,
      unit: spec.unit,
      value: Math.round(value * 10) / 10,
      ...rated,
      note: rated.level === 'good' ? spec.high : rated.level === 'warn' ? spec.mid : spec.low,
      about: spec.about,
    };
  }

  const scores = Object.values(measures).map((m) => m.score);
  const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  return {
    view: resolvedView,
    measures,
    overall,
    points,
    shoulderWidth,
    coverage: coverageOf(px),
    analyzedAt: Date.now(),
    engine: 'krysaril-posture-1',
  };
}

function coverageOf(px) {
  const keys = [KP.leftShoulder, KP.rightShoulder, KP.leftHip, KP.rightHip,
    KP.leftKnee, KP.rightKnee, KP.leftAnkle, KP.rightAnkle, KP.leftEar, KP.rightEar];
  const seen = keys.filter((i) => (px[i]?.v ?? 0) >= 0.5).length;
  return seen / keys.length;
}

/** Suggestions for the weakest measures, most affected first. */
export function postureWork(result, max = 4) {
  const ranked = Object.values(result.measures || {})
    .filter((m) => m.level !== 'good')
    .sort((a, b) => a.score - b.score);

  const out = [];
  for (const m of ranked) {
    const spec = MEASURES[m.id];
    if (!spec) continue;
    out.push({ id: m.id, title: spec.label, level: m.level, items: spec.work });
    if (out.length >= max) break;
  }
  return out;
}

export const POSTURE_DISCLAIMER =
  'Krysaril Posture is a screening tool, not a diagnosis. It estimates alignment from a single 2D photo, so camera angle, footwear, clothing and stance all affect the numbers. Use it to track change over time and to guide conversation — not to diagnose or treat. Pain, numbness, or a sudden change in posture belongs with a physiotherapist or doctor.';
