/**
 * Posture, body-composition and speed maths.
 *
 * Poses are synthesised so the ground truth is known exactly, then fed
 * through the same functions the camera path uses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { KP } from '../js/pose/angles.js';
import { analyzePosture, detectPostureView, rate, MEASURES, postureWork } from '../js/posture/analyze.js';
import {
  measureSilhouette, widthToCircumference, navyBodyFat, waistToHeightBand,
  compareScans, heatColor,
} from '../js/body/silhouette.js';
import { SpeedAnalyzer } from '../js/speed/analyzer.js';

const W = 720, H = 1280;

/* ----------------------------------------------------------- pose builder */

/**
 * Side-on standing pose. `forwardHeadDeg` shifts the ear ahead of the
 * shoulder; `leanDeg` tilts the trunk; `shoulderAheadPx` slides the whole
 * upper body forward of the ankle plumb line.
 */
function sidePose({
  forwardHead = 55, leanDeg = 2, shoulderAheadPx = 0, hipToKneeTilt = 88,
  kneeAngle = 178, shinLean = 2,
} = {}) {
  const rad = (d) => (d * Math.PI) / 180;
  const A = { x: 300, y: 1150 };
  const K = { x: A.x + 200 * Math.sin(rad(shinLean)), y: A.y - 200 * Math.cos(rad(shinLean)) };

  // Hip placed so the hip→knee line sits at the requested angle from horizontal.
  const thigh = 210;
  const hipAng = rad(hipToKneeTilt);
  const Hip = { x: K.x - thigh * Math.cos(hipAng), y: K.y - thigh * Math.sin(hipAng) };

  const torso = 280;
  const S = {
    x: Hip.x + torso * Math.sin(rad(leanDeg)) + shoulderAheadPx,
    y: Hip.y - torso * Math.cos(rad(leanDeg)),
  };
  // Ear placed to produce the requested craniovertebral angle.
  const earDist = 90;
  const E = { x: S.x + earDist * Math.cos(rad(forwardHead)), y: S.y - earDist * Math.sin(rad(forwardHead)) };
  const nose = { x: E.x + 30, y: E.y + 4 };

  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const put = (i, p, dx = 0) => { lm[i] = { x: (p.x + dx) / W, y: p.y / H, z: 0, visibility: 1 }; };
  const off = 6;                                   // near-total overlap = side view
  put(KP.nose, nose);
  put(KP.leftEye, E, -off); put(KP.rightEye, E, off);
  put(KP.leftEar, E, -off); put(KP.rightEar, E, off);
  put(KP.leftShoulder, S, -off); put(KP.rightShoulder, S, off);
  put(KP.leftElbow, { x: S.x + 12, y: S.y + 110 }, -off);
  put(KP.rightElbow, { x: S.x + 12, y: S.y + 110 }, off);
  put(KP.leftWrist, { x: S.x + 18, y: S.y + 210 }, -off);
  put(KP.rightWrist, { x: S.x + 18, y: S.y + 210 }, off);
  put(KP.leftHip, Hip, -off); put(KP.rightHip, Hip, off);
  put(KP.leftKnee, K, -off); put(KP.rightKnee, K, off);
  put(KP.leftAnkle, A, -off); put(KP.rightAnkle, A, off);
  put(KP.leftHeel, { x: A.x - 26, y: A.y + 8 }, -off);
  put(KP.rightHeel, { x: A.x - 26, y: A.y + 8 }, off);
  put(KP.leftFoot, { x: A.x + 60, y: A.y + 12 }, -off);
  put(KP.rightFoot, { x: A.x + 60, y: A.y + 12 }, off);
  return lm;
}

/** Front-on pose with optional shoulder/hip drop and knee deviation. */
function frontPose({ shoulderDropPx = 0, hipDropPx = 0, kneeInPx = 0, headTiltPx = 0 } = {}) {
  const cx = 360;
  const shoulderHalf = 105, hipHalf = 72;
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const put = (i, x, y) => { lm[i] = { x: x / W, y: y / H, z: 0, visibility: 1 }; };

  put(KP.nose, cx, 300);
  put(KP.leftEye, cx - 26, 288 + headTiltPx);
  put(KP.rightEye, cx + 26, 288);
  put(KP.leftEar, cx - 46, 296 + headTiltPx);
  put(KP.rightEar, cx + 46, 296);
  put(KP.leftShoulder, cx - shoulderHalf, 420 + shoulderDropPx);
  put(KP.rightShoulder, cx + shoulderHalf, 420);
  put(KP.leftElbow, cx - shoulderHalf - 12, 580);
  put(KP.rightElbow, cx + shoulderHalf + 12, 580);
  put(KP.leftWrist, cx - shoulderHalf - 18, 730);
  put(KP.rightWrist, cx + shoulderHalf + 18, 730);
  put(KP.leftHip, cx - hipHalf, 730 + hipDropPx);
  put(KP.rightHip, cx + hipHalf, 730);
  put(KP.leftKnee, cx - hipHalf + kneeInPx, 940);
  put(KP.rightKnee, cx + hipHalf - kneeInPx, 940);
  put(KP.leftAnkle, cx - hipHalf, 1150);
  put(KP.rightAnkle, cx + hipHalf, 1150);
  put(KP.leftHeel, cx - hipHalf - 8, 1160);
  put(KP.rightHeel, cx + hipHalf + 8, 1160);
  put(KP.leftFoot, cx - hipHalf, 1200);
  put(KP.rightFoot, cx + hipHalf, 1200);
  return lm;
}

/* ------------------------------------------------------------- posture */

test('view detection separates side from front', () => {
  assert.equal(analyzePosture(sidePose(), W, H, { view: 'auto' }).view, 'side');
  assert.equal(analyzePosture(frontPose(), W, H, { view: 'auto' }).view, 'front');
});

test('craniovertebral angle tracks the synthesised forward-head value', () => {
  for (const truth of [38, 48, 58]) {
    const r = analyzePosture(sidePose({ forwardHead: truth }), W, H, { view: 'side' });
    assert.ok(Math.abs(r.measures.forwardHead.value - truth) < 2,
      `got ${r.measures.forwardHead.value} want ${truth}`);
  }
});

test('a forward head is flagged and a neutral one is not', () => {
  const bad = analyzePosture(sidePose({ forwardHead: 38 }), W, H, { view: 'side' });
  const good = analyzePosture(sidePose({ forwardHead: 60 }), W, H, { view: 'side' });
  assert.equal(bad.measures.forwardHead.level, 'bad');
  assert.equal(good.measures.forwardHead.level, 'good');
  assert.ok(good.overall > bad.overall, `${good.overall} should beat ${bad.overall}`);
});

test('shoulders ahead of the plumb line raise shoulder protraction', () => {
  const stacked = analyzePosture(sidePose({ shoulderAheadPx: 0 }), W, H, { view: 'side' });
  const rounded = analyzePosture(sidePose({ shoulderAheadPx: 150 }), W, H, { view: 'side' });
  assert.ok(rounded.measures.shoulderProtraction.value > stacked.measures.shoulderProtraction.value + 5);
  assert.notEqual(rounded.measures.shoulderProtraction.level, 'good');
});

test('front view measures levelness and knee tracking', () => {
  const level = analyzePosture(frontPose(), W, H, { view: 'front' });
  assert.equal(level.measures.shoulderLevel.level, 'good');
  assert.equal(level.measures.pelvisLevel.level, 'good');

  const uneven = analyzePosture(frontPose({ shoulderDropPx: 26, hipDropPx: 20 }), W, H, { view: 'front' });
  assert.notEqual(uneven.measures.shoulderLevel.level, 'good');
  assert.notEqual(uneven.measures.pelvisLevel.level, 'good');

  const valgus = analyzePosture(frontPose({ kneeInPx: 34 }), W, H, { view: 'front' });
  assert.ok(valgus.measures.kneeTracking.value > level.measures.kneeTracking.value + 5);
});

test('rating bands behave at the edges', () => {
  const m = MEASURES.forwardHead;
  assert.equal(rate(m, 60).level, 'good');
  assert.equal(rate(m, 45).level, 'warn');
  assert.equal(rate(m, 30).level, 'bad');
  assert.equal(rate(m, null), null);
  assert.equal(rate(m, 60).score, 100);
  assert.ok(rate(m, 30).score < rate(m, 45).score);
});

test('corrective work targets the worst measures first', () => {
  const r = analyzePosture(sidePose({ forwardHead: 34, shoulderAheadPx: 170 }), W, H, { view: 'side' });
  const work = postureWork(r);
  assert.ok(work.length >= 1);
  assert.ok(work.every((w) => Array.isArray(w.items) && w.items.length));
  const scores = work.map((w) => r.measures[w.id].score);
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b), 'worst first');
});

/* ---------------------------------------------------------------- body */

/** Rectangular-ish body mask with per-level widths, for measurement tests. */
function buildMask(w, h, shape) {
  const mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const halfWidth = shape(y) / 2;
    const cx = w / 2;
    for (let x = 0; x < w; x++) {
      if (Math.abs(x - cx) <= halfWidth) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function bodyLandmarks(w, h) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const put = (i, x, y) => { lm[i] = { x: x / w, y: y / h, z: 0, visibility: 1 }; };
  const cx = w / 2;
  put(KP.nose, cx, h * 0.10);
  put(KP.leftEar, cx - 12, h * 0.09); put(KP.rightEar, cx + 12, h * 0.09);
  put(KP.leftShoulder, cx - 40, h * 0.20); put(KP.rightShoulder, cx + 40, h * 0.20);
  put(KP.leftHip, cx - 26, h * 0.52); put(KP.rightHip, cx + 26, h * 0.52);
  put(KP.leftKnee, cx - 22, h * 0.72); put(KP.rightKnee, cx + 22, h * 0.72);
  put(KP.leftAnkle, cx - 20, h * 0.94); put(KP.rightAnkle, cx + 20, h * 0.94);
  return lm;
}

test('silhouette widths convert to centimetres via height', () => {
  const w = 200, h = 400;
  // Constant 40 px wide body. Crown→ankle spans 0.94h − (0.10h − 0.84h*0.08).
  const mask = buildMask(w, h, () => 40);
  const m = measureSilhouette(mask, w, h, bodyLandmarks(w, h), { heightCm: 180 });
  assert.ok(m, 'measurement produced');
  assert.ok(m.cmPerPx > 0);
  const waist = m.widths.waist;
  assert.ok(waist, 'waist level measured');
  // The mask spans x = cx-20 … cx+20 inclusive, so 41 pixels.
  assert.ok(Math.abs(waist.px - 41) <= 1, `waist px ${waist.px}`);
  assert.ok(Math.abs(waist.cm - waist.px * m.cmPerPx) < 0.1);
  assert.equal(m.profile.length, 100);
});

test('a wider waist raises waist-to-hip and waist-to-height', () => {
  const w = 200, h = 400;
  const slim = measureSilhouette(buildMask(w, h, (y) => (y > h * 0.36 && y < h * 0.5 ? 34 : 44)),
    w, h, bodyLandmarks(w, h), { heightCm: 175 });
  const wide = measureSilhouette(buildMask(w, h, (y) => (y > h * 0.36 && y < h * 0.5 ? 58 : 44)),
    w, h, bodyLandmarks(w, h), { heightCm: 175 });
  assert.ok(wide.ratios.waistToHip > slim.ratios.waistToHip);
  assert.ok(wide.ratios.waistToHeight > slim.ratios.waistToHeight);
  assert.ok(wide.ratios.shoulderToWaist < slim.ratios.shoulderToWaist);
});

test('width to circumference is between a circle and a flat ellipse', () => {
  const width = 30;
  const c = widthToCircumference(width);
  assert.ok(c < Math.PI * width, 'less than a circle of that diameter');
  assert.ok(c > 2 * width, 'more than a degenerate flat shape');
});

test('waist-to-height banding matches published thresholds', () => {
  assert.equal(waistToHeightBand(0.45).level, 'good');
  assert.equal(waistToHeightBand(0.55).level, 'warn');
  assert.equal(waistToHeightBand(0.65).level, 'bad');
  assert.equal(waistToHeightBand(null), null);
});

test('US Navy body fat matches known worked examples', () => {
  // Male: 180 cm, neck 38, waist 85 → ≈ 17–18%
  const male = navyBodyFat({ sex: 'male', heightCm: 180, neckCm: 38, waistCm: 85 });
  assert.ok(male > 14 && male < 21, `male ${male}`);
  // Female: 165 cm, neck 32, waist 72, hip 96 → ≈ 26–29%
  const female = navyBodyFat({ sex: 'female', heightCm: 165, neckCm: 32, waistCm: 72, hipCm: 96 });
  assert.ok(female > 23 && female < 32, `female ${female}`);
  // Female without hips cannot be computed.
  assert.equal(navyBodyFat({ sex: 'female', heightCm: 165, neckCm: 32, waistCm: 72 }), null);
  assert.equal(navyBodyFat({ heightCm: 180 }), null);
});

test('scan comparison reports direction per level', () => {
  const w = 200, h = 400;
  const before = measureSilhouette(buildMask(w, h, (y) => (y > h * 0.36 && y < h * 0.5 ? 56 : 44)),
    w, h, bodyLandmarks(w, h), { heightCm: 175 });
  const after = measureSilhouette(buildMask(w, h, (y) => (y > h * 0.36 && y < h * 0.5 ? 44 : 44)),
    w, h, bodyLandmarks(w, h), { heightCm: 175 });

  const cmp = compareScans(after, before);
  assert.equal(cmp.levels.waist.direction, 'down', `waist delta ${cmp.levels.waist.deltaCm}`);
  assert.ok(cmp.levels.waist.deltaCm < 0);
  assert.equal(cmp.profileDelta.length, 100);
  assert.equal(cmp.summary.biggestLoss.id, 'waist');

  // With no previous scan every level is a baseline.
  const baseline = compareScans(after, null);
  assert.equal(baseline.levels.waist.deltaCm, null);
  assert.equal(baseline.profileDelta, null);
});

test('heat colour runs cold to hot through neutral', () => {
  assert.match(heatColor(-3), /^rgb\(/);
  const cold = heatColor(-3), neutral = heatColor(0), hot = heatColor(3);
  assert.notEqual(cold, hot);
  assert.notEqual(neutral, cold);
  assert.equal(heatColor(null), 'rgba(207, 200, 187, .35)');
});

/* --------------------------------------------------------------- speed */

/** Pose with both wrists at a given extension fraction of full reach. */
function strikePose(extLeft, extRight) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const put = (i, x, y) => { lm[i] = { x: x / W, y: y / H, z: 0, visibility: 1 }; };
  const cx = 360;
  const shoulderY = 420, reach = 300;
  put(KP.nose, cx, 300);
  put(KP.leftEar, cx - 40, 300); put(KP.rightEar, cx + 40, 300);
  put(KP.leftShoulder, cx - 100, shoulderY);
  put(KP.rightShoulder, cx + 100, shoulderY);
  // Elbow midway so reach = upper + forearm stays constant.
  put(KP.leftElbow, cx - 100, shoulderY + reach / 2);
  put(KP.rightElbow, cx + 100, shoulderY + reach / 2);
  put(KP.leftWrist, cx - 100, shoulderY + reach * extLeft);
  put(KP.rightWrist, cx + 100, shoulderY + reach * extRight);
  put(KP.leftHip, cx - 60, 760); put(KP.rightHip, cx + 60, 760);
  put(KP.leftKnee, cx - 55, 950); put(KP.rightKnee, cx + 55, 950);
  put(KP.leftAnkle, cx - 50, 1150); put(KP.rightAnkle, cx + 50, 1150);
  return lm;
}

/** Drives one full extend–retract cycle on the chosen hand. */
function throwStrike(analyzer, t, hand = 'right', stepMs = 25) {
  const path = [0.35, 0.5, 0.68, 0.85, 0.98, 1.0, 0.9, 0.7, 0.5, 0.35];
  for (const ext of path) {
    t += stepMs;
    analyzer.push(
      hand === 'right' ? strikePose(0.35, ext) : strikePose(ext, 0.35),
      W, H, t, { active: true },
    );
  }
  return t;
}

test('strike detection counts one strike per extension cycle', () => {
  const a = new SpeedAnalyzer({ heightCm: 175, mode: 'strike' });
  a.startRound(0);
  let t = 0;
  for (let i = 0; i < 5; i++) t = throwStrike(a, t, i % 2 ? 'left' : 'right');
  assert.equal(a.strikes.length, 5, `counted ${a.strikes.length}`);
  assert.equal(a.strikes.filter((s) => s.hand === 'right').length, 3);
  assert.equal(a.strikes.filter((s) => s.hand === 'left').length, 2);
});

test('a hand held at guard produces no strikes', () => {
  const a = new SpeedAnalyzer({ heightCm: 175 });
  a.startRound(0);
  let t = 0;
  for (let i = 0; i < 80; i++) {
    t += 25;
    a.push(strikePose(0.35 + Math.sin(i / 6) * 0.05, 0.35), W, H, t, { active: true });
  }
  assert.equal(a.strikes.length, 0);
});

test('nothing is counted while the round is not live', () => {
  const a = new SpeedAnalyzer({ heightCm: 175 });
  a.startRound(0);
  let t = 0;
  const path = [0.35, 0.6, 0.9, 1.0, 0.8, 0.5, 0.35];
  for (const ext of path) { t += 25; a.push(strikePose(0.35, ext), W, H, t, { active: false }); }
  assert.equal(a.strikes.length, 0);
});

test('speed and output are reported in sane units', () => {
  const a = new SpeedAnalyzer({ heightCm: 175, mode: 'strike' });
  a.startRound(0);
  let t = 0;
  for (let i = 0; i < 6; i++) t = throwStrike(a, t);
  const snap = a.snapshot(t, true);
  assert.equal(snap.count, 6);
  assert.ok(snap.peakSpeed > 0.5 && snap.peakSpeed < 40, `peak ${snap.peakSpeed} m/s`);
  assert.ok(snap.output > 0, `output ${snap.output}`);

  const summary = a.summary(1, t);
  assert.equal(summary.strikes, 6);
  assert.equal(summary.timeline.length, 6);
  assert.ok(summary.output > 0);
  assert.ok(summary.durationMs > 0);
});

test('losing the subject does not invent strikes', () => {
  const a = new SpeedAnalyzer({ heightCm: 175 });
  a.startRound(0);
  let t = 0;
  for (let i = 0; i < 20; i++) { t += 25; a.push(null, W, H, t, { active: true }); }
  const snap = a.push(null, W, H, t + 25, { active: true });
  assert.equal(snap.tracked, false);
  assert.equal(a.strikes.length, 0);
});
