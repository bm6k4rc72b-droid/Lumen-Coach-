/**
 * Pose maths + rep engine tests.
 *
 * Poses are synthesised with forward kinematics so we know the ground-truth
 * joint angles exactly, then fed through the same pipeline the camera uses.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeAngles, toPixels, KP } from '../js/pose/angles.js';
import { FormAnalyzer } from '../js/pose/analyzer.js';

const W = 720, H = 1280;
const rad = (d) => (d * Math.PI) / 180;

/**
 * Side-view skeleton (facing screen-right) with an exact knee angle.
 * @returns 33 normalised landmarks
 */
function makePose({
  kneeAngle = 170,
  torsoLean = 8,
  shinLean = 10,
  elbowAngle = 160,
  ankleX = 300,
  ankleY = 1150,
  armForward = 40,
  lateral = 12,
} = {}) {
  const shin = 200, thigh = 210, torso = 280;

  const A = { x: ankleX, y: ankleY };
  const K = { x: A.x + shin * Math.sin(rad(shinLean)), y: A.y - shin * Math.cos(rad(shinLean)) };

  // Rotate the knee→ankle vector by ±kneeAngle; keep the branch that puts the hip higher.
  const ka = { x: A.x - K.x, y: A.y - K.y };
  const phi = Math.atan2(ka.y, ka.x);
  const candidates = [phi + rad(kneeAngle), phi - rad(kneeAngle)].map((ang) => ({
    x: K.x + thigh * Math.cos(ang),
    y: K.y + thigh * Math.sin(ang),
  }));
  const Hip = candidates[0].y <= candidates[1].y ? candidates[0] : candidates[1];

  const S = { x: Hip.x + torso * Math.sin(rad(torsoLean)), y: Hip.y - torso * Math.cos(rad(torsoLean)) };

  // Arms: elbow in front of the shoulder, wrist set by the elbow angle.
  const E = { x: S.x + armForward, y: S.y + 95 };
  const se = { x: S.x - E.x, y: S.y - E.y };
  const psi = Math.atan2(se.y, se.x);
  const wristAng = psi - rad(elbowAngle);
  const Wr = { x: E.x + 90 * Math.cos(wristAng), y: E.y + 90 * Math.sin(wristAng) };

  const Ear = { x: S.x - 8, y: S.y - 72 };
  const Nose = { x: S.x + 34, y: S.y - 78 };
  const Foot = { x: A.x + 62, y: A.y + 12 };
  const Heel = { x: A.x - 26, y: A.y + 10 };

  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const put = (i, p, dx = 0) => { lm[i] = { x: (p.x + dx) / W, y: p.y / H, z: 0, visibility: 1 }; };

  put(KP.nose, Nose);
  put(KP.leftEar, Ear, -lateral / 2);
  put(KP.rightEar, Ear, lateral / 2);
  put(KP.leftShoulder, S, -lateral / 2);
  put(KP.rightShoulder, S, lateral / 2);
  put(KP.leftElbow, E, -lateral / 2);
  put(KP.rightElbow, E, lateral / 2);
  put(KP.leftWrist, Wr, -lateral / 2);
  put(KP.rightWrist, Wr, lateral / 2);
  put(KP.leftHip, Hip, -lateral / 2);
  put(KP.rightHip, Hip, lateral / 2);
  put(KP.leftKnee, K, -lateral / 2);
  put(KP.rightKnee, K, lateral / 2);
  put(KP.leftAnkle, A, -lateral / 2);
  put(KP.rightAnkle, A, lateral / 2);
  put(KP.leftHeel, Heel, -lateral / 2);
  put(KP.rightHeel, Heel, lateral / 2);
  put(KP.leftFoot, Foot, -lateral / 2);
  put(KP.rightFoot, Foot, lateral / 2);
  return lm;
}

const angleOf = (pose) => computeAngles(toPixels(pose, W, H)).angles;

/* ------------------------------------------------------------- geometry */

test('knee angle matches the synthesised ground truth', () => {
  for (const truth of [80, 100, 130, 170]) {
    const a = angleOf(makePose({ kneeAngle: truth }));
    assert.ok(Math.abs(a.knee - truth) < 1.5, `knee ${a.knee?.toFixed(1)} vs ${truth}`);
  }
});

test('torso lean is measured from vertical', () => {
  for (const lean of [0, 15, 40, 60]) {
    const a = angleOf(makePose({ torsoLean: lean }));
    assert.ok(Math.abs(a.torsoLean - lean) < 1.5, `torso ${a.torsoLean?.toFixed(1)} vs ${lean}`);
    assert.ok(Math.abs(a.torsoFromHorizontal - (90 - lean)) < 1.5);
  }
});

test('elbow, hip and shin angles are produced with sensible values', () => {
  const a = angleOf(makePose({ kneeAngle: 95, torsoLean: 35, shinLean: 25, elbowAngle: 110 }));
  assert.ok(Math.abs(a.elbow - 110) < 2, `elbow ${a.elbow}`);
  assert.ok(Math.abs(a.shin - 25) < 1.5, `shin ${a.shin}`);
  assert.ok(a.hip > 20 && a.hip < 120, `hip ${a.hip}`);
  assert.equal(a.kneeL !== null && a.kneeR !== null, true);
});

test('a side-on subject is classified as a side view', () => {
  const { view } = computeAngles(toPixels(makePose(), W, H));
  assert.equal(view, 'side');
});

/* -------------------------------------------------------------- reps */

/** Drives an analyzer through `count` squat cycles. */
function runSquats(analyzer, { count = 3, bottom = 85, topAngle = 172, leanAtBottom = 34, frames = 14 } = {}) {
  let t = 0;
  const step = (kneeAngle) => {
    const depth = (topAngle - kneeAngle) / (topAngle - bottom);
    const pose = makePose({
      kneeAngle,
      torsoLean: 8 + depth * (leanAtBottom - 8),
      shinLean: 6 + depth * 22,
    });
    t += 40;
    return analyzer.push(pose, W, H, t);
  };

  step(topAngle);
  let last = null;
  for (let rep = 0; rep < count; rep++) {
    for (let i = 1; i <= frames; i++) step(topAngle - ((topAngle - bottom) * i) / frames);
    for (let i = frames - 1; i >= 0; i--) last = step(topAngle - ((topAngle - bottom) * i) / frames);
  }
  return last;
}

test('counts one rep per squat cycle', () => {
  for (const count of [1, 3, 6]) {
    const analyzer = new FormAnalyzer('squat');
    const result = runSquats(analyzer, { count });
    assert.equal(result.reps, count, `expected ${count} reps, got ${result.reps}`);
  }
});

test('a small bounce at the top does not add phantom reps', () => {
  const analyzer = new FormAnalyzer('squat');
  let t = 0;
  for (let i = 0; i < 60; i++) {
    t += 40;
    analyzer.push(makePose({ kneeAngle: 168 + Math.sin(i / 3) * 6 }), W, H, t);
  }
  assert.equal(analyzer.reps.length, 0);
});

test('deep, upright squats score well; shallow leaning squats do not', () => {
  const good = new FormAnalyzer('squat');
  runSquats(good, { count: 3, bottom: 82, leanAtBottom: 30 });
  const goodScore = good.score();

  const poor = new FormAnalyzer('squat');
  runSquats(poor, { count: 3, bottom: 132, leanAtBottom: 66 });
  const poorScore = poor.score();

  assert.ok(goodScore >= 85, `good squat scored ${goodScore}`);
  assert.ok(poorScore <= 60, `poor squat scored ${poorScore}`);
  assert.ok(goodScore - poorScore > 25, 'scores should separate clearly');
});

test('rep records carry depth and duration', () => {
  const analyzer = new FormAnalyzer('squat');
  runSquats(analyzer, { count: 2, bottom: 88 });
  const [rep] = analyzer.reps;
  assert.equal(rep.index, 1);
  assert.ok(rep.durationMs > 300, `duration ${rep.durationMs}`);
  assert.ok(Math.abs(rep.angles.knee.min - 88) < 4, `depth ${rep.angles.knee.min}`);
  // The rep window closes as soon as the lifter passes the "stood up" threshold.
  assert.ok(rep.angles.knee.max > 150, `top of rep ${rep.angles.knee.max}`);
  assert.ok(rep.checks.some((c) => c.id === 'depth'));
});

test('the set summary aggregates every rep', () => {
  const analyzer = new FormAnalyzer('squat');
  runSquats(analyzer, { count: 4 });
  const summary = analyzer.summary();
  assert.equal(summary.reps, 4);
  assert.equal(summary.repDetail.length, 4);
  assert.ok(summary.tempoMs > 0);
  assert.ok(summary.checks.length >= 3);
  for (const c of summary.checks) {
    assert.ok(c.goodPct >= 0 && c.goodPct <= 100);
  }
});

test('coaching cues escalate with bad form', () => {
  const analyzer = new FormAnalyzer('squat');
  const result = runSquats(analyzer, { count: 2, bottom: 140, leanAtBottom: 70 });
  assert.ok(['warn', 'bad'].includes(result.cue.level), `cue level ${result.cue.level}`);
  assert.ok(result.cue.text.length > 5);
});

test('losing the subject clears the rep state instead of counting junk', () => {
  const analyzer = new FormAnalyzer('squat');
  runSquats(analyzer, { count: 1 });
  const before = analyzer.reps.length;
  let t = 100000;
  for (let i = 0; i < 30; i++) analyzer.push(null, W, H, (t += 40));
  const result = analyzer.push(null, W, H, (t += 40));
  assert.equal(result.ok, false);
  assert.equal(result.reps, before);
  assert.equal(analyzer.state, null);
});

/* ------------------------------------------------------- other exercises */

test('push-ups count from the elbow and flag a sagging body line', () => {
  const analyzer = new FormAnalyzer('pushup');
  let t = 0;
  const push = (elbow, hipDrop) => {
    // Horizontal body: reuse the generator, then rotate is unnecessary — we
    // only need shoulder/hip/ankle collinearity, which hipDrop breaks.
    const pose = makePose({ elbowAngle: elbow, kneeAngle: 175, torsoLean: 88 });
    const hipY = pose[KP.leftHip].y + hipDrop;
    pose[KP.leftHip] = { ...pose[KP.leftHip], y: hipY };
    pose[KP.rightHip] = { ...pose[KP.rightHip], y: hipY };
    t += 80;
    return analyzer.push(pose, W, H, t);
  };
  push(170, 0);
  for (let r = 0; r < 3; r++) {
    for (const e of [160, 150, 135, 120, 105, 95, 84, 80, 84, 95, 110, 130, 150, 165, 172]) push(e, 0.03);
  }
  assert.equal(analyzer.reps.length, 3);
  const plank = analyzer.reps[0].checks.find((c) => c.id === 'plank');
  assert.ok(plank, 'plank check should be present');
  assert.ok(['warn', 'bad'].includes(plank.level), `sagging hips scored ${plank.level}`);
});

test('overhead press counts at the top of the press', () => {
  const analyzer = new FormAnalyzer('overhead-press');
  let t = 0;
  const press = (elbow) => analyzer.push(makePose({ elbowAngle: elbow }), W, H, (t += 80));
  press(80);
  for (let r = 0; r < 4; r++) {
    for (const e of [90, 105, 125, 145, 162, 172, 176, 168, 150, 130, 110, 95, 82]) press(e);
  }
  assert.equal(analyzer.reps.length, 4);
});

/* -------------------------------------------------------------- gait */

test('cadence is estimated from foot strikes', () => {
  const analyzer = new FormAnalyzer('running', { heightCm: 170 });
  const targetSpm = 180;
  const periodMs = (120 / targetSpm) * 1000;   // one full stride = two steps
  let t = 0;
  for (let i = 0; i < 260; i++) {
    t += 25;
    const phase = (2 * Math.PI * t) / periodMs;
    const pose = makePose({ kneeAngle: 150, torsoLean: 8 });
    const swing = Math.sin(phase) * 90;
    pose[KP.leftAnkle] = { ...pose[KP.leftAnkle], x: pose[KP.leftAnkle].x + swing / W };
    pose[KP.rightAnkle] = { ...pose[KP.rightAnkle], x: pose[KP.rightAnkle].x - swing / W };
    var last = analyzer.push(pose, W, H, t);
  }
  const cadence = last.gait.cadence;
  assert.ok(cadence !== null, 'cadence should be estimated');
  assert.ok(Math.abs(cadence - targetSpm) < 12, `cadence ${cadence} vs ${targetSpm}`);
  assert.ok(last.gait.speed > 0, 'speed estimate should be positive');
  assert.ok(last.gait.stepLength > 0.1 && last.gait.stepLength < 3, `step length ${last.gait.stepLength}`);
});

test('gait metrics stay null before enough strides are seen', () => {
  const analyzer = new FormAnalyzer('running');
  const result = analyzer.push(makePose(), W, H, 40);
  assert.equal(result.gait.cadence, null);
  assert.equal(result.reps, 0);
});
