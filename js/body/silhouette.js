/**
 * Body composition scan from a single silhouette.
 *
 * Uses the pose segmentation mask to trace the body outline, measures its
 * width at anatomical levels keyed off the pose landmarks, and converts those
 * widths to real units using the client's height.
 *
 * WHAT THIS IS: a repeatable photo measurement, good for tracking change.
 * WHAT THIS IS NOT: a body-fat measurement. A phone camera cannot see beneath
 * the skin. Where a body-fat figure is shown it comes from circumference
 * formulae (US Navy) or waist-to-height, and is an estimate with real error
 * bars — never treat it as a DEXA result.
 */

import { KP, toPixels, mid } from '../pose/angles.js';

/** Vertical levels we measure, as a fraction between two landmarks. */
export const LEVELS = [
  { id: 'neck', label: 'Neck', from: 'shoulder', to: 'ear', t: 0.55 },
  { id: 'shoulders', label: 'Shoulders', from: 'shoulder', to: 'hip', t: 0.06 },
  { id: 'chest', label: 'Chest', from: 'shoulder', to: 'hip', t: 0.26 },
  { id: 'ribs', label: 'Ribs', from: 'shoulder', to: 'hip', t: 0.48 },
  { id: 'waist', label: 'Waist', from: 'shoulder', to: 'hip', t: 0.72 },
  { id: 'hips', label: 'Hips', from: 'shoulder', to: 'hip', t: 1.0 },
  { id: 'thigh', label: 'Thigh', from: 'hip', to: 'knee', t: 0.32 },
  { id: 'calf', label: 'Calf', from: 'knee', to: 'ankle', t: 0.36 },
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Measures silhouette width at each level.
 *
 * @param {Float32Array} mask   person probability per pixel, row-major
 * @param {number} maskW
 * @param {number} maskH
 * @param {Array} landmarks     normalised pose landmarks for the same frame
 * @param {{heightCm?: number}} opts
 */
export function measureSilhouette(mask, maskW, maskH, landmarks, { heightCm = 170 } = {}) {
  if (!mask || !maskW || !maskH || !landmarks) return null;

  const px = toPixels(landmarks, maskW, maskH);
  const anchors = {
    ear: mid(px[KP.leftEar], px[KP.rightEar]),
    shoulder: mid(px[KP.leftShoulder], px[KP.rightShoulder]),
    hip: mid(px[KP.leftHip], px[KP.rightHip]),
    knee: mid(px[KP.leftKnee], px[KP.rightKnee]),
    ankle: mid(px[KP.leftAnkle], px[KP.rightAnkle]),
  };
  if (!anchors.shoulder || !anchors.hip || !anchors.ankle) return null;

  // Pixel height of the person: crown (≈8% above the nose) to ankle.
  const nose = px[KP.nose];
  const topY = nose ? nose.y - (anchors.ankle.y - nose.y) * 0.08 : anchors.shoulder.y;
  const bodyPx = Math.abs(anchors.ankle.y - topY);
  if (bodyPx < 40) return null;

  const cmPerPx = heightCm / bodyPx;

  const rows = [];
  const widths = {};
  for (const level of LEVELS) {
    const a = anchors[level.from];
    const b = anchors[level.to];
    if (!a || !b) continue;
    const y = Math.round(a.y + (b.y - a.y) * level.t);
    const span = rowSpan(mask, maskW, maskH, y);
    if (!span) continue;
    widths[level.id] = {
      id: level.id,
      label: level.label,
      y,
      px: span.width,
      cm: Math.round(span.width * cmPerPx * 10) / 10,
      left: span.left,
      right: span.right,
    };
    rows.push(widths[level.id]);
  }

  // A full-body outline profile for the heatmap: width at every 1% of height.
  const profile = [];
  for (let i = 0; i < 100; i++) {
    const y = Math.round(topY + (bodyPx * i) / 99);
    const span = rowSpan(mask, maskW, maskH, y);
    profile.push(span ? Math.round(span.width * cmPerPx * 100) / 100 : 0);
  }

  const shoulderW = widths.shoulders?.cm ?? null;
  const waistW = widths.waist?.cm ?? null;
  const hipW = widths.hips?.cm ?? null;

  const ratios = {
    waistToHip: isNum(waistW) && isNum(hipW) && hipW > 0
      ? Math.round((waistW / hipW) * 1000) / 1000 : null,
    waistToHeight: isNum(waistW)
      ? Math.round((widthToCircumference(waistW) / heightCm) * 1000) / 1000 : null,
    shoulderToWaist: isNum(shoulderW) && isNum(waistW) && waistW > 0
      ? Math.round((shoulderW / waistW) * 1000) / 1000 : null,
  };

  return {
    widths,
    rows,
    profile,
    bodyPx,
    cmPerPx,
    heightCm,
    topY,
    bottomY: anchors.ankle.y,
    circumference: {
      waist: isNum(waistW) ? Math.round(widthToCircumference(waistW)) : null,
      hips: isNum(hipW) ? Math.round(widthToCircumference(hipW)) : null,
      chest: isNum(widths.chest?.cm) ? Math.round(widthToCircumference(widths.chest.cm)) : null,
      neck: isNum(widths.neck?.cm) ? Math.round(widthToCircumference(widths.neck.cm)) : null,
    },
    ratios,
    maskW,
    maskH,
  };
}

/**
 * Front-on width → circumference.
 *
 * A torso cross-section is closer to an ellipse than a circle. Depth is not
 * visible from one photo, so we assume a depth of ~0.72 × width — a common
 * anthropometric approximation — and use Ramanujan's ellipse perimeter.
 * This is the single biggest source of error in the circumference figures.
 */
export function widthToCircumference(widthCm, depthRatio = 0.72) {
  const a = widthCm / 2;
  const b = (widthCm * depthRatio) / 2;
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Widest run of person pixels on one row, ignoring stray specks. */
function rowSpan(mask, w, h, y) {
  if (y < 0 || y >= h) return null;
  const base = y * w;
  let bestLeft = -1, bestRight = -1, bestLen = 0;
  let runStart = -1;
  for (let x = 0; x < w; x++) {
    const on = mask[base + x] > 0.5;
    if (on && runStart < 0) runStart = x;
    if ((!on || x === w - 1) && runStart >= 0) {
      const end = on ? x : x - 1;
      const len = end - runStart + 1;
      if (len > bestLen) { bestLen = len; bestLeft = runStart; bestRight = end; }
      runStart = -1;
    }
  }
  if (bestLen < 3) return null;
  return { left: bestLeft, right: bestRight, width: bestLen };
}

/* --------------------------------------------------------- body fat models */

/**
 * US Navy circumference method. Requires real tape measurements — the honest
 * path when someone wants a body-fat number.
 * @returns {number|null} body fat percentage
 */
export function navyBodyFat({ sex, heightCm, neckCm, waistCm, hipCm }) {
  if (!heightCm || !neckCm || !waistCm) return null;
  if (sex === 'female' && !hipCm) return null;
  const log10 = Math.log10;
  let bf;
  if (sex === 'female') {
    bf = 495 / (1.29579 - 0.35004 * log10(waistCm + hipCm - neckCm) + 0.22100 * log10(heightCm)) - 450;
  } else {
    bf = 495 / (1.0324 - 0.19077 * log10(waistCm - neckCm) + 0.15456 * log10(heightCm)) - 450;
  }
  return Number.isFinite(bf) ? Math.round(clamp(bf, 2, 65) * 10) / 10 : null;
}

/** Waist-to-height risk banding — the best-evidenced single tape measure. */
export function waistToHeightBand(ratio) {
  if (!isNum(ratio)) return null;
  if (ratio < 0.40) return { level: 'warn', label: 'Below typical range' };
  if (ratio < 0.50) return { level: 'good', label: 'Healthy range' };
  if (ratio < 0.60) return { level: 'warn', label: 'Increased range' };
  return { level: 'bad', label: 'High range' };
}

/* -------------------------------------------------------------- comparison */

/**
 * Compares two scans level by level.
 * @returns {{levels: object, profileDelta: number[], summary: object}}
 */
export function compareScans(current, previous) {
  if (!current) return null;
  const levels = {};
  for (const level of LEVELS) {
    const now = current.widths?.[level.id];
    if (!now) continue;
    const then = previous?.widths?.[level.id];
    const deltaCm = then ? Math.round((now.cm - then.cm) * 10) / 10 : null;
    levels[level.id] = {
      id: level.id,
      label: level.label,
      cm: now.cm,
      deltaCm,
      direction: deltaCm === null ? 'flat' : deltaCm > 0.4 ? 'up' : deltaCm < -0.4 ? 'down' : 'flat',
    };
  }

  let profileDelta = null;
  if (previous?.profile?.length === current.profile?.length) {
    profileDelta = current.profile.map((v, i) => {
      const before = previous.profile[i];
      return isNum(v) && isNum(before) && before > 0 ? Math.round((v - before) * 100) / 100 : 0;
    });
  }

  const changed = Object.values(levels).filter((l) => l.deltaCm !== null);
  const summary = {
    measured: Object.keys(levels).length,
    compared: changed.length,
    biggestLoss: changed.length ? changed.reduce((a, b) => (b.deltaCm < a.deltaCm ? b : a)) : null,
    biggestGain: changed.length ? changed.reduce((a, b) => (b.deltaCm > a.deltaCm ? b : a)) : null,
  };

  return { levels, profileDelta, summary };
}

/**
 * Colour for a change in cm. Blue = smaller, warm = larger, neutral between.
 * `range` is the delta that saturates the ramp.
 */
export function heatColor(deltaCm, range = 2.5) {
  if (!isNum(deltaCm)) return 'rgba(207, 200, 187, .35)';
  const t = clamp(deltaCm / range, -1, 1);
  const cold = [76, 143, 209];
  const midC = [207, 200, 187];
  const hot = [217, 105, 79];
  const mixTo = t < 0 ? cold : hot;
  const k = Math.abs(t);
  const c = midC.map((m, i) => Math.round(m + (mixTo[i] - m) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export const BODY_DISCLAIMER =
  'Krysaril Body measures the outline of your body in a photo. It is designed for tracking change between scans taken the same way — same distance, same light, same clothing, same time of day. It cannot see beneath the skin, so it does not measure body fat directly: any body-fat figure shown is estimated from circumference formulae and carries several percentage points of error. It is not a medical assessment.';
