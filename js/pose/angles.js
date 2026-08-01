/**
 * Joint geometry for MediaPipe Pose landmarks.
 *
 * Landmarks arrive normalised (0..1) relative to the video frame, so every
 * angle is computed in *pixel* space to avoid aspect-ratio distortion.
 */

export const KP = {
  nose: 0,
  leftEye: 2, rightEye: 5,
  leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftFoot: 31, rightFoot: 32,
};

/** Pairs drawn by the skeleton overlay (torso, arms, legs). */
export const SKELETON = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31],
  [28, 30], [30, 32], [28, 32],
];

/** Landmarks worth drawing as joints. */
export const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];

const DEG = 180 / Math.PI;

/* --------------------------------------------------------------- filtering */

/**
 * One Euro filter — low jitter when still, low lag when moving.
 * Far better than a fixed EMA for on-body overlays.
 */
class OneEuro {
  constructor({ minCutoff = 1.2, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.t = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value, t) {
    if (this.x === null) { this.x = value; this.t = t; return value; }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    const dxRaw = (value - this.x) / dt;
    this.dx = this.dx + OneEuro.alpha(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = this.x + OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** Smooths a whole landmark array (x, y, z) with per-channel One Euro filters. */
export class LandmarkSmoother {
  constructor(opts) {
    this.opts = opts;
    this.filters = new Map();
  }
  reset() { this.filters.clear(); }
  apply(landmarks, t = performance.now()) {
    if (!landmarks) return landmarks;
    return landmarks.map((lm, i) => {
      let f = this.filters.get(i);
      if (!f) {
        f = { x: new OneEuro(this.opts), y: new OneEuro(this.opts), z: new OneEuro(this.opts) };
        this.filters.set(i, f);
      }
      return {
        x: f.x.filter(lm.x, t),
        y: f.y.filter(lm.y, t),
        z: f.z.filter(lm.z ?? 0, t),
        visibility: lm.visibility ?? 1,
      };
    });
  }
}

/* -------------------------------------------------------------------- maths */

export function toPixels(landmarks, w, h) {
  return landmarks.map((l) => ({ x: l.x * w, y: l.y * h, z: (l.z ?? 0) * w, v: l.visibility ?? 1 }));
}

/** Interior angle ABC in degrees (0..180). */
export function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (n1 < 1e-6 || n2 < 1e-6) return null;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return Math.acos(cos) * DEG;
}

/**
 * Angle of segment a→b measured from vertical (0 = perfectly upright).
 * Image coordinates grow downward, so "up" is −y.
 */
export function angleFromVertical(a, b) {
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return Math.abs(Math.atan2(dx, -dy) * DEG);
}

/** Angle of segment a→b measured from horizontal (0 = flat). */
export function angleFromHorizontal(a, b) {
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return Math.abs(Math.atan2(dy, Math.abs(dx)) * DEG);
}

export function mid(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2, v: Math.min(a.v ?? 1, b.v ?? 1) };
}

export function dist(a, b) { return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null; }

/** Perpendicular distance of point p from the infinite line a→b (signed by side). */
export function offLine(p, a, b) {
  if (!p || !a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  return ((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/* ------------------------------------------------------------ full analysis */

const MIN_VIS = 0.5;

function vis(p) { return p && (p.v ?? 1) >= MIN_VIS ? p : null; }

/**
 * Computes every joint angle we surface, plus orientation metadata.
 * @param {Array} px landmarks already converted to pixel space
 */
export function computeAngles(px) {
  const g = (i) => vis(px[i]);
  const raw = (i) => px[i];

  const shoulders = { L: raw(KP.leftShoulder), R: raw(KP.rightShoulder) };
  const hips = { L: raw(KP.leftHip), R: raw(KP.rightHip) };

  const shoulderMid = mid(shoulders.L, shoulders.R);
  const hipMid = mid(hips.L, hips.R);
  const kneeMid = mid(raw(KP.leftKnee), raw(KP.rightKnee));
  const ankleMid = mid(raw(KP.leftAnkle), raw(KP.rightAnkle));

  const a = {
    kneeL: angleAt(g(KP.leftHip), g(KP.leftKnee), g(KP.leftAnkle)),
    kneeR: angleAt(g(KP.rightHip), g(KP.rightKnee), g(KP.rightAnkle)),
    hipL: angleAt(g(KP.leftShoulder), g(KP.leftHip), g(KP.leftKnee)),
    hipR: angleAt(g(KP.rightShoulder), g(KP.rightHip), g(KP.rightKnee)),
    ankleL: angleAt(g(KP.leftKnee), g(KP.leftAnkle), g(KP.leftFoot)),
    ankleR: angleAt(g(KP.rightKnee), g(KP.rightAnkle), g(KP.rightFoot)),
    shoulderL: angleAt(g(KP.leftHip), g(KP.leftShoulder), g(KP.leftElbow)),
    shoulderR: angleAt(g(KP.rightHip), g(KP.rightShoulder), g(KP.rightElbow)),
    elbowL: angleAt(g(KP.leftShoulder), g(KP.leftElbow), g(KP.leftWrist)),
    elbowR: angleAt(g(KP.rightShoulder), g(KP.rightElbow), g(KP.rightWrist)),
  };

  // Torso: 0° = vertical/upright, 90° = parallel with the floor.
  a.torsoLean = angleFromVertical(hipMid, shoulderMid);
  a.torsoFromHorizontal = a.torsoLean === null ? null : Math.abs(90 - a.torsoLean);

  // Shin angle (useful for squat/deadlift shin-to-floor coaching).
  a.shinL = angleFromVertical(raw(KP.leftAnkle), raw(KP.leftKnee));
  a.shinR = angleFromVertical(raw(KP.rightAnkle), raw(KP.rightKnee));

  // Head/neck alignment relative to the torso line.
  const earMid = mid(raw(KP.leftEar), raw(KP.rightEar));
  a.neckLean = angleFromVertical(shoulderMid, earMid);

  // Frontal-plane symmetry, normalised by shoulder width so it is scale-free.
  const shoulderWidth = dist(shoulders.L, shoulders.R) || 1;
  a.shoulderTilt = shoulders.L && shoulders.R
    ? Math.atan2(shoulders.R.y - shoulders.L.y, Math.abs(shoulders.R.x - shoulders.L.x) + 1e-6) * DEG : null;
  a.hipTilt = hips.L && hips.R
    ? Math.atan2(hips.R.y - hips.L.y, Math.abs(hips.R.x - hips.L.x) + 1e-6) * DEG : null;

  // Knee tracking: how far each knee sits off the hip→ankle line (as % of shoulder width).
  // Positive = knee collapsing inward relative to that leg's line.
  const valgusL = offLine(raw(KP.leftKnee), raw(KP.leftHip), raw(KP.leftAnkle));
  const valgusR = offLine(raw(KP.rightKnee), raw(KP.rightHip), raw(KP.rightAnkle));
  a.kneeTrackL = valgusL === null ? null : (valgusL / shoulderWidth) * 100;
  a.kneeTrackR = valgusR === null ? null : (valgusR / shoulderWidth) * 100;

  // Bilateral summaries (used when the camera can only see one side clearly).
  a.knee = pickPair(a.kneeL, a.kneeR, px[KP.leftKnee], px[KP.rightKnee]);
  a.hip = pickPair(a.hipL, a.hipR, px[KP.leftHip], px[KP.rightHip]);
  a.ankle = pickPair(a.ankleL, a.ankleR, px[KP.leftAnkle], px[KP.rightAnkle]);
  a.shoulder = pickPair(a.shoulderL, a.shoulderR, px[KP.leftShoulder], px[KP.rightShoulder]);
  a.elbow = pickPair(a.elbowL, a.elbowR, px[KP.leftElbow], px[KP.rightElbow]);
  a.shin = pickPair(a.shinL, a.shinR, px[KP.leftKnee], px[KP.rightKnee]);

  return {
    angles: a,
    points: { shoulderMid, hipMid, kneeMid, ankleMid, earMid },
    shoulderWidth,
    view: detectView(px, shoulderWidth),
    facing: detectFacing(px),
    coverage: coverage(px),
  };
}

/** Prefers the better-tracked side, else averages. */
function pickPair(left, right, lp, rp) {
  const lv = lp?.v ?? 0, rv = rp?.v ?? 0;
  if (left !== null && right !== null) {
    if (Math.abs(lv - rv) < 0.15) return (left + right) / 2;
    return lv > rv ? left : right;
  }
  return left ?? right ?? null;
}

/** 'front' when both shoulders are wide apart in view, 'side' when they overlap. */
function detectView(px, shoulderWidth) {
  const hipWidth = dist(px[KP.leftHip], px[KP.rightHip]) || 0;
  const torso = dist(mid(px[KP.leftShoulder], px[KP.rightShoulder]), mid(px[KP.leftHip], px[KP.rightHip])) || 1;
  const ratio = Math.max(shoulderWidth, hipWidth) / torso;
  if (ratio < 0.55) return 'side';
  if (ratio > 0.85) return 'front';
  return 'angled';
}

/** For side views: is the subject facing screen-left or screen-right? */
function detectFacing(px) {
  const nose = px[KP.nose];
  const sMid = mid(px[KP.leftShoulder], px[KP.rightShoulder]);
  if (!nose || !sMid) return null;
  return nose.x < sMid.x ? 'left' : 'right';
}

/** Fraction of the key body landmarks that are confidently visible. */
function coverage(px) {
  const keys = [KP.leftShoulder, KP.rightShoulder, KP.leftHip, KP.rightHip,
    KP.leftKnee, KP.rightKnee, KP.leftAnkle, KP.rightAnkle];
  const seen = keys.filter((i) => (px[i]?.v ?? 0) >= MIN_VIS).length;
  return seen / keys.length;
}

/** Rough pixel height of the person, used for speed/scale estimates. */
export function bodyPixelHeight(px) {
  const head = px[KP.nose];
  const ankles = mid(px[KP.leftAnkle], px[KP.rightAnkle]);
  if (!head || !ankles) return null;
  const noseToAnkle = Math.abs(ankles.y - head.y);
  // Nose sits ≈ 8% below the crown, so scale up to full stature.
  return noseToAnkle > 20 ? noseToAnkle / 0.92 : null;
}
