/**
 * Exercise definitions: rep detection, per-frame form checks and coaching cues.
 *
 * Each check runs on a frame context and returns { value, unit, level, cue }.
 * `level` is one of 'good' | 'warn' | 'bad' and drives every colour in the UI.
 *
 * Nothing here is medical or prescriptive — cues are coaching language.
 */

import { KP, angleAt, dist, bodyPixelHeight } from './angles.js';

export const LEVELS = { good: 'good', warn: 'warn', bad: 'bad' };

/** Score contribution per level. */
export const LEVEL_SCORE = { good: 100, warn: 72, bad: 42 };

/**
 * Banded evaluation: value inside `good` scores green, inside `warn` amber,
 * anything else red. Bands are [min, max] inclusive.
 */
function band(value, good, warn) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const inside = (b) => b && value >= b[0] && value <= b[1];
  if (inside(good)) return 'good';
  if (inside(warn)) return 'warn';
  return 'bad';
}

/** Builds a check from bands + cue text keyed by level. */
function makeCheck({ id, label, unit = '°', weight = 1, phase = 'any', get, good, warn, cues, hint }) {
  return {
    id, label, unit, weight, phase, hint,
    evaluate(ctx) {
      const value = get(ctx);
      const level = band(value, good, warn);
      if (level === null) return null;
      return { id, label, unit, weight, value, level, cue: cues[level] || cues.good };
    },
  };
}

/* ------------------------------------------------------------ shared checks */

const absMin = (a, b) => (a === null ? b : b === null ? a : Math.min(a, b));
const absMax = (a, b) => (a === null ? b : b === null ? a : Math.max(a, b));

const symmetryCheck = (getL, getR, label, id = 'symmetry') => makeCheck({
  id, label, weight: 0.7, phase: 'bottom',
  get: (c) => {
    const l = getL(c.angles), r = getR(c.angles);
    return l === null || r === null ? null : Math.abs(l - r);
  },
  good: [0, 10], warn: [10, 20],
  cues: {
    good: 'Nicely even side to side',
    warn: 'Slight imbalance — even out the weight',
    bad: 'One side is working harder — reset and go lighter',
  },
  hint: 'Difference between left and right joint angles.',
});

const torsoCheck = ({ good, warn, cues, weight = 1, id = 'torso', label = 'Torso lean' }) => makeCheck({
  id, label, weight, phase: 'any',
  // Worst lean reached inside the rep, not the value at the instant it ended.
  get: (c) => c.repMax?.torsoLean ?? c.angles.torsoLean,
  good, warn, cues,
  hint: 'Greatest angle of the torso away from vertical during the rep.',
});

const kneeTrackCheck = (weight = 1) => makeCheck({
  id: 'kneeTrack', label: 'Knee tracking', unit: '%', weight, phase: 'bottom',
  get: (c) => {
    if (c.view === 'side') return null;   // only meaningful facing the camera
    const l = c.angles.kneeTrackL, r = c.angles.kneeTrackR;
    if (l === null && r === null) return null;
    return Math.max(Math.abs(l ?? 0), Math.abs(r ?? 0));
  },
  good: [0, 9], warn: [9, 16],
  cues: {
    good: 'Knees tracking over the toes',
    warn: 'Watch the knees — think "spread the floor"',
    bad: 'Knees caving in — push them out over your toes',
  },
  hint: 'How far the knees drift from the hip-to-ankle line, as % of shoulder width.',
});

/* ---------------------------------------------------------------- exercises */

export const EXERCISES = [
  {
    id: 'squat',
    name: 'Squat',
    emoji: '🦵',
    group: 'Lower body',
    view: 'side',
    setup: 'Stand side-on (or 45°) to the phone, whole body in frame.',
    cameraHint: 'Side view shows depth and torso. Turn to face the camera to check knee tracking.',
    hud: ['knee', 'hip', 'torsoLean', 'ankle'],
    rep: { metric: (a) => a.knee, down: 105, up: 155, dir: 'down' },
    tempoTarget: [2.0, 5.0],
    checks: [
      makeCheck({
        id: 'depth', label: 'Depth', weight: 1.4, phase: 'bottom',
        get: (c) => c.repMin.knee,
        good: [0, 100], warn: [100, 122],
        cues: {
          good: 'Great depth — hips below parallel',
          warn: 'A little deeper if your hips allow',
          bad: 'Sit down further — aim for thighs parallel',
        },
        hint: 'Smallest knee angle reached in the rep.',
      }),
      torsoCheck({
        good: [0, 42], warn: [42, 58],
        cues: {
          good: 'Chest tall and proud',
          warn: 'Chest is dropping a little — lift it',
          bad: 'Too much forward lean — sit back, chest up',
        },
      }),
      kneeTrackCheck(1.1),
      makeCheck({
        id: 'shin', label: 'Shin angle', weight: 0.6, phase: 'bottom',
        get: (c) => c.repMin.shin === null ? c.angles.shin : c.repMax.shin,
        good: [0, 40], warn: [40, 52],
        cues: {
          good: 'Balanced over mid-foot',
          warn: 'Knees drifting forward — sit back a touch',
          bad: 'Weight is on the toes — sit back into the heels',
        },
        hint: 'Shin angle from vertical at the bottom.',
      }),
      symmetryCheck((a) => a.kneeL, (a) => a.kneeR, 'Left/right balance'),
    ],
  },

  {
    id: 'deadlift',
    name: 'Deadlift',
    emoji: '🏋️',
    group: 'Lower body',
    view: 'side',
    setup: 'Stand side-on to the phone so the whole lift is visible.',
    cameraHint: 'Side view only — it needs to see the hinge and the bar path.',
    hud: ['hip', 'knee', 'torsoLean', 'shoulder'],
    rep: { metric: (a) => a.hip, down: 115, up: 158, dir: 'down' },
    tempoTarget: [2.0, 6.0],
    checks: [
      makeCheck({
        id: 'hinge', label: 'Hip hinge', weight: 1.3, phase: 'bottom',
        get: (c) => c.repMin.hip,
        good: [55, 105], warn: [40, 125],
        cues: {
          good: 'Strong hinge — hips leading',
          warn: 'Push the hips back a little further',
          bad: 'This is turning into a squat — hinge from the hips',
        },
        hint: 'Smallest hip angle reached — a hinge, not a squat.',
      }),
      makeCheck({
        id: 'kneeSoft', label: 'Knee bend', weight: 0.8, phase: 'bottom',
        get: (c) => c.repMin.knee,
        good: [120, 175], warn: [100, 180],
        cues: {
          good: 'Knees soft and stable',
          warn: 'Keep the knees a touch stiffer',
          bad: 'Knees bending too much — hinge instead',
        },
      }),
      makeCheck({
        id: 'backLine', label: 'Back line', weight: 1.5, phase: 'any',
        get: (c) => c.repMax?.backLine ?? c.angles.backLine,
        good: [0, 22], warn: [22, 34],
        cues: {
          good: 'Long, neutral spine',
          warn: 'Upper back is rounding a little — pull the shoulders back',
          bad: 'Back is rounding — reset, chest proud, lighter load',
        },
        hint: 'Deviation of the ear–shoulder–hip line from straight.',
      }),
      makeCheck({
        id: 'barPath', label: 'Bar path', unit: '%', weight: 1.0, phase: 'any',
        get: (c) => c.repMax?.barPath ?? c.angles.barPath,
        good: [0, 26], warn: [26, 45],
        cues: {
          good: 'Bar staying close',
          warn: 'Let the bar drift back into your legs',
          bad: 'Bar is swinging away — drag it up your thighs',
        },
        hint: 'Horizontal gap between wrist and shoulder, as % of shoulder width.',
      }),
      makeCheck({
        id: 'lockout', label: 'Lockout', weight: 0.9, phase: 'top',
        get: (c) => c.repMax.hip,
        good: [163, 185], warn: [152, 185],
        cues: {
          good: 'Full, tall lockout',
          warn: 'Finish taller — squeeze the glutes',
          bad: 'Stand all the way up at the top',
        },
      }),
    ],
  },

  {
    id: 'pushup',
    name: 'Push-up',
    emoji: '💪',
    group: 'Upper body',
    view: 'side',
    setup: 'Phone at floor level, side-on, whole body in frame.',
    cameraHint: 'Low side angle shows both depth and the body line.',
    hud: ['elbow', 'plank', 'shoulder', 'neck'],
    rep: { metric: (a) => a.elbow, down: 100, up: 155, dir: 'down' },
    tempoTarget: [1.5, 4.5],
    checks: [
      makeCheck({
        id: 'depth', label: 'Depth', weight: 1.3, phase: 'bottom',
        get: (c) => c.repMin.elbow,
        good: [0, 95], warn: [95, 115],
        cues: {
          good: 'Lovely depth — chest to the floor',
          warn: 'A few more centimetres down',
          bad: 'Go lower — aim for 90° at the elbow',
        },
      }),
      makeCheck({
        id: 'plank', label: 'Body line', weight: 1.5, phase: 'any',
        // Whichever extreme drifted furthest from a straight 180° line.
        get: (c) => {
          const lo = c.repMin?.plank, hi = c.repMax?.plank;
          if (typeof lo !== 'number' || typeof hi !== 'number') return c.angles.plank;
          return Math.abs(180 - lo) >= Math.abs(180 - hi) ? lo : hi;
        },
        good: [166, 190], warn: [156, 196],
        cues: {
          good: 'Straight line head to heels',
          warn: 'Squeeze the glutes to hold the line',
          bad: 'Hips are sagging or piking — brace the middle',
        },
        hint: 'Shoulder–hip–ankle angle; 180° is a perfect plank.',
      }),
      makeCheck({
        id: 'flare', label: 'Elbow angle', weight: 0.9, phase: 'bottom',
        get: (c) => c.repMin.shoulderAbduct,
        good: [15, 55], warn: [10, 70],
        cues: {
          good: 'Elbows tucked at a friendly angle',
          warn: 'Bring the elbows in slightly',
          bad: 'Elbows flaring wide — tuck them toward your ribs',
        },
        hint: 'How far the upper arm flares from the ribcage.',
      }),
      makeCheck({
        id: 'neck', label: 'Head position', weight: 0.6, phase: 'any',
        get: (c) => c.repMax?.backLine ?? c.angles.backLine,
        good: [0, 26], warn: [26, 40],
        cues: {
          good: 'Neck long and neutral',
          warn: 'Tuck the chin slightly',
          bad: 'Head is dropping — look at the floor just ahead of you',
        },
      }),
    ],
  },

  {
    id: 'lunge',
    name: 'Lunge',
    emoji: '🚶',
    group: 'Lower body',
    view: 'side',
    setup: 'Side-on shows knee angles; face the camera to check balance.',
    cameraHint: 'Either view works — side for depth, front for knee tracking.',
    hud: ['knee', 'kneeRear', 'torsoLean', 'hip'],
    rep: { metric: (a) => absMin(a.kneeL, a.kneeR), down: 105, up: 155, dir: 'down' },
    tempoTarget: [2.0, 5.5],
    checks: [
      makeCheck({
        id: 'frontKnee', label: 'Front knee', weight: 1.3, phase: 'bottom',
        get: (c) => c.repMin.kneeFront,
        good: [78, 100], warn: [70, 115],
        cues: {
          good: 'Front knee at a lovely 90°',
          warn: 'Adjust your step length a touch',
          bad: 'Aim for 90° in the front knee — check your stride',
        },
      }),
      makeCheck({
        id: 'rearKnee', label: 'Rear knee', weight: 0.9, phase: 'bottom',
        get: (c) => c.repMin.kneeRear,
        good: [75, 110], warn: [65, 125],
        cues: {
          good: 'Back knee dropping nicely',
          warn: 'Let the back knee travel a little further down',
          bad: 'Sink the back knee toward the floor',
        },
      }),
      torsoCheck({
        good: [0, 16], warn: [16, 28], weight: 1.1,
        cues: {
          good: 'Upright and balanced',
          warn: 'Lift the chest a little',
          bad: 'Leaning forward — stack your shoulders over your hips',
        },
      }),
      kneeTrackCheck(1.0),
      makeCheck({
        id: 'stability', label: 'Stability', unit: '%', weight: 0.8, phase: 'any',
        get: (c) => c.wobble,
        good: [0, 6], warn: [6, 12],
        cues: {
          good: 'Rock solid',
          warn: 'A little wobble — slow it down',
          bad: 'Lots of wobble — shorten the range and control it',
        },
        hint: 'Side-to-side hip movement as % of shoulder width.',
      }),
    ],
  },

  {
    id: 'overhead-press',
    name: 'Overhead press',
    emoji: '🙌',
    group: 'Upper body',
    view: 'front',
    setup: 'Face the camera, arms and head fully in frame.',
    cameraHint: 'Front view checks symmetry; side view checks the lean.',
    hud: ['elbow', 'shoulder', 'torsoLean', 'neck'],
    rep: { metric: (a) => a.elbow, down: 100, up: 160, dir: 'up' },
    tempoTarget: [1.5, 5.0],
    checks: [
      makeCheck({
        id: 'lockout', label: 'Lockout', weight: 1.3, phase: 'top',
        get: (c) => c.repMax.elbow,
        good: [163, 190], warn: [150, 190],
        cues: {
          good: 'Strong overhead lockout',
          warn: 'Press all the way to straight arms',
          bad: 'Finish the press — elbows fully locked',
        },
      }),
      makeCheck({
        id: 'overhead', label: 'Arms overhead', weight: 1.1, phase: 'top',
        get: (c) => c.repMax.shoulder,
        good: [155, 190], warn: [138, 190],
        cues: {
          good: 'Hands stacked over the shoulders',
          warn: 'Get the arms a touch closer to your ears',
          bad: 'Press the arms fully overhead, not forward',
        },
      }),
      torsoCheck({
        good: [0, 10], warn: [10, 20], weight: 1.2,
        label: 'Torso lean',
        cues: {
          good: 'Ribs down, torso stacked',
          warn: 'Slight lean back — squeeze the glutes',
          bad: 'Leaning back too far — brace the core, lighter load',
        },
      }),
      symmetryCheck((a) => a.elbowL, (a) => a.elbowR, 'Arm symmetry'),
      makeCheck({
        id: 'startDepth', label: 'Start position', weight: 0.7, phase: 'bottom',
        get: (c) => c.repMin.elbow,
        good: [0, 100], warn: [100, 118],
        cues: {
          good: 'Full range from the shoulders',
          warn: 'Bring the bar a little lower to start',
          bad: 'Start from the shoulders for full range',
        },
      }),
    ],
  },

  {
    id: 'row',
    name: 'Bent-over row',
    emoji: '🚣',
    group: 'Upper body',
    view: 'side',
    setup: 'Side-on to the phone, hips and hands visible.',
    cameraHint: 'Side view shows the hinge and the pull together.',
    hud: ['elbow', 'torsoFromHorizontal', 'hip', 'shoulder'],
    rep: { metric: (a) => a.elbow, down: 95, up: 150, dir: 'down' },
    tempoTarget: [1.5, 4.5],
    checks: [
      makeCheck({
        id: 'pull', label: 'Pull range', weight: 1.2, phase: 'bottom',
        get: (c) => c.repMin.elbow,
        good: [0, 88], warn: [88, 105],
        cues: {
          good: 'Full pull — elbows past the ribs',
          warn: 'Pull a little further into the ribs',
          bad: 'Drive the elbows back further',
        },
      }),
      makeCheck({
        id: 'hinge', label: 'Hinge angle', weight: 1.2, phase: 'any',
        get: (c) => c.angles.torsoFromHorizontal,
        good: [10, 50], warn: [0, 62],
        cues: {
          good: 'Great hinge position',
          warn: 'Hinge over a touch more',
          bad: 'Too upright — hinge from the hips',
        },
        hint: 'Torso angle above horizontal.',
      }),
      makeCheck({
        id: 'torsoStability', label: 'Torso stability', weight: 1.3, phase: 'any',
        get: (c) => c.torsoSwing,
        good: [0, 8], warn: [8, 15],
        cues: {
          good: 'Torso locked in place',
          warn: 'A little body English creeping in',
          bad: 'You are heaving with the torso — lighter and stricter',
        },
        hint: 'How much the torso angle swings within the rep.',
      }),
      makeCheck({
        id: 'backLine', label: 'Back line', weight: 1.1, phase: 'any',
        get: (c) => c.repMax?.backLine ?? c.angles.backLine,
        good: [0, 24], warn: [24, 36],
        cues: {
          good: 'Long neutral spine',
          warn: 'Lift the chest slightly',
          bad: 'Upper back rounding — reset your set-up',
        },
      }),
    ],
  },

  {
    id: 'glute-bridge',
    name: 'Glute bridge',
    emoji: '🌉',
    group: 'Lower body',
    view: 'side',
    setup: 'Lie down side-on to the phone, hips and knees in frame.',
    cameraHint: 'Place the phone low and side-on at hip height.',
    hud: ['hip', 'knee', 'shoulder', 'neck'],
    rep: { metric: (a) => a.hip, down: 130, up: 158, dir: 'up' },
    tempoTarget: [1.5, 5.0],
    checks: [
      makeCheck({
        id: 'extension', label: 'Hip extension', weight: 1.5, phase: 'top',
        get: (c) => c.repMax.hip,
        good: [163, 182], warn: [150, 192],
        cues: {
          good: 'Beautiful full hip extension',
          warn: 'Push the hips a little higher',
          bad: 'Drive the hips up — squeeze the glutes at the top',
        },
      }),
      makeCheck({
        id: 'shinAngle', label: 'Foot placement', weight: 0.9, phase: 'top',
        get: (c) => c.repMax.knee,
        good: [70, 110], warn: [60, 125],
        cues: {
          good: 'Feet in a great spot',
          warn: 'Shuffle the heels slightly',
          bad: 'Move the heels closer to your hips',
        },
        hint: 'Knee angle at the top — around 90° puts the load on the glutes.',
      }),
      makeCheck({
        id: 'overextend', label: 'Rib control', weight: 1.0, phase: 'top',
        get: (c) => c.repMax.hip,
        good: [0, 182], warn: [0, 192],
        cues: {
          good: 'Ribs down, glutes doing the work',
          warn: 'Careful not to arch through the lower back',
          bad: 'Arching the lower back — tuck the ribs and stop at the line',
        },
      }),
      symmetryCheck((a) => a.hipL, (a) => a.hipR, 'Hip symmetry'),
    ],
  },

  {
    id: 'running',
    name: 'Running form',
    emoji: '🏃',
    group: 'Gait',
    view: 'side',
    setup: 'Side-on to the treadmill or running lane, full body in frame.',
    cameraHint: 'Side view at hip height, about 3 m away, gives the cleanest gait read.',
    hud: ['cadence', 'knee', 'torsoLean', 'elbow'],
    gait: true,
    checks: [
      makeCheck({
        id: 'lean', label: 'Forward lean', weight: 1.2, phase: 'any',
        get: (c) => c.angles.torsoLean,
        good: [3, 12], warn: [0, 18],
        cues: {
          good: 'Lovely lean from the ankles',
          warn: 'Ease the lean — think tall and forward',
          bad: 'Too much bend at the waist — run tall',
        },
      }),
      makeCheck({
        id: 'cadence', label: 'Cadence', unit: 'spm', weight: 1.3, phase: 'any',
        get: (c) => c.cadence,
        good: [168, 192], warn: [156, 200],
        cues: {
          good: 'Cadence is in a great range',
          warn: 'Try slightly quicker, lighter steps',
          bad: 'Shorten your stride and pick the turnover up',
        },
        hint: 'Steps per minute, estimated from foot strikes.',
      }),
      makeCheck({
        id: 'overstride', label: 'Foot strike', unit: '%', weight: 1.2, phase: 'any',
        get: (c) => c.overstride,
        good: [0, 13], warn: [13, 22],
        cues: {
          good: 'Landing nicely under your hips',
          warn: 'Foot is landing slightly ahead — quicker steps',
          bad: 'Overstriding — land closer to under your hips',
        },
        hint: 'How far the lead foot lands ahead of the hip, as % of your height.',
      }),
      makeCheck({
        id: 'bounce', label: 'Vertical bounce', unit: '%', weight: 0.9, phase: 'any',
        get: (c) => c.bounce,
        good: [0, 6.5], warn: [6.5, 10],
        cues: {
          good: 'Smooth, level ride',
          warn: 'A little bouncy — drive forward, not up',
          bad: 'Lots of bounce — think of gliding forward',
        },
        hint: 'Hip rise and fall as % of your height.',
      }),
      makeCheck({
        id: 'arms', label: 'Arm carriage', weight: 0.8, phase: 'any',
        get: (c) => c.angles.elbow,
        good: [70, 110], warn: [58, 125],
        cues: {
          good: 'Relaxed arms at about 90°',
          warn: 'Soften or tighten the elbows toward 90°',
          bad: 'Arms are working against you — relax to about 90°',
        },
      }),
    ],
  },
];

export const EXERCISE_BY_ID = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id) {
  return EXERCISE_BY_ID[id] || EXERCISES[0];
}

/* ------------------------------------------- exercise-specific derived data */

/**
 * Adds values that only make sense per exercise (plank line, front/rear knee,
 * shoulder abduction, bar path) onto the angle set.
 *
 * Everything lives on the same object as the joint angles so the analyzer's
 * per-rep min/max tracking picks it up automatically.
 */
export function deriveForExercise(exerciseId, angles, px, points, shoulderWidth) {
  const out = angles;

  // Spinal alignment: 0° means ear, shoulder and hip are stacked in a line.
  const backAngle = angleAt(points.earMid, points.shoulderMid, points.hipMid);
  out.backLine = backAngle === null ? null : 180 - backAngle;

  if (exerciseId === 'deadlift' || exerciseId === 'row') {
    const lw = px[KP.leftWrist], rw = px[KP.rightWrist];
    const wrist = (lw?.v ?? 0) >= (rw?.v ?? 0) ? lw : rw;
    out.barPath = wrist && points.shoulderMid && shoulderWidth
      ? (Math.abs(wrist.x - points.shoulderMid.x) / shoulderWidth) * 100
      : null;
  }

  if (exerciseId === 'pushup') {
    const sh = points.shoulderMid, hip = points.hipMid, ank = points.ankleMid;
    out.plank = angleAt(sh, hip, ank);
    const abdL = angleAt(px[KP.leftHip], px[KP.leftShoulder], px[KP.leftElbow]);
    const abdR = angleAt(px[KP.rightHip], px[KP.rightShoulder], px[KP.rightElbow]);
    out.shoulderAbduct = absMax(abdL, abdR);
  }

  if (exerciseId === 'lunge') {
    // The more-flexed knee is the front leg.
    const l = angles.kneeL, r = angles.kneeR;
    if (l !== null && r !== null) {
      out.kneeFront = Math.min(l, r);
      out.kneeRear = Math.max(l, r);
    } else {
      out.kneeFront = l ?? r;
      out.kneeRear = null;
    }
  }

  out.neck = angles.neckLean;
  return out;
}

/** Human labels for HUD tiles. */
export const HUD_LABELS = {
  knee: 'Knee',
  kneeFront: 'Front knee',
  kneeRear: 'Rear knee',
  hip: 'Hip',
  ankle: 'Ankle',
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  torsoLean: 'Torso',
  torsoFromHorizontal: 'Hinge',
  neck: 'Neck',
  plank: 'Body line',
  shin: 'Shin',
  cadence: 'Cadence',
};

export const HUD_UNITS = { cadence: '' };

/** Sensible green ranges for the live angle tiles (display only). */
export const HUD_BANDS = {
  knee: { good: [0, 180], warn: null },
  torsoLean: { good: [0, 45], warn: [45, 60] },
  plank: { good: [165, 190], warn: [155, 195] },
  cadence: { good: [168, 192], warn: [156, 200] },
};

export { band, bodyPixelHeight, dist };
