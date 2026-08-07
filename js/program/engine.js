/**
 * Tailored program generator.
 *
 * Reads whatever assessments exist for a client — posture, body, movement
 * form, speed, skin, recovery, labs — decides what matters most right now,
 * and builds two horizons:
 *
 *   • a 4-week short block that fixes the limiting factor
 *   • a 12-week long arc that builds on it
 *
 * Fully deterministic. Same inputs always produce the same program, which
 * means a trainer can reason about why it said what it said.
 *
 * Nothing here prescribes for a medical condition. Where a lab value or
 * posture finding needs clinical input, the program says so and works
 * around it rather than through it.
 */

import { MEASURES } from '../posture/analyze.js';
import { waistToHeightBand } from '../body/silhouette.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------- findings */

/**
 * Turns raw assessments into a ranked list of findings.
 * Each finding: { id, domain, severity 0-100, title, detail, drivers }
 */
export function collectFindings({ posture, body, sessions = [], skin, vitals, labs } = {}) {
  const findings = [];

  /* -------------------------------------------------------- posture */
  if (posture?.measures) {
    for (const m of Object.values(posture.measures)) {
      if (m.level === 'good') continue;
      const spec = MEASURES[m.id];
      findings.push({
        id: `posture.${m.id}`,
        domain: 'posture',
        severity: 100 - (m.score ?? 60),
        title: spec?.label || m.label,
        detail: m.note,
        drivers: spec?.work || [],
      });
    }
  }

  /* ----------------------------------------------------------- body */
  const whtr = body?.measurement?.ratios?.waistToHeight;
  if (isNum(whtr)) {
    const band = waistToHeightBand(whtr);
    if (band && band.level !== 'good') {
      findings.push({
        id: 'body.waistToHeight',
        domain: 'body',
        severity: band.level === 'bad' ? 80 : 55,
        title: 'Waist-to-height ratio',
        detail: `Sitting at ${whtr.toFixed(2)} — ${band.label.toLowerCase()}.`,
        drivers: [],
      });
    }
  }

  /* ------------------------------------------------------- movement */
  const recent = sessions.slice(0, 6);
  const checkFails = new Map();
  for (const s of recent) {
    for (const set of s.sets || []) {
      for (const c of set.checks || []) {
        if (c.worst === 'good') continue;
        const key = `${set.exerciseId}:${c.id}`;
        const entry = checkFails.get(key) || { count: 0, label: c.label, exercise: set.exerciseName, goodPct: [] };
        entry.count += 1;
        entry.goodPct.push(c.goodPct ?? 0);
        checkFails.set(key, entry);
      }
    }
  }
  for (const [key, e] of checkFails) {
    if (e.count < 2) continue;                      // one bad set is noise
    const avgClean = e.goodPct.reduce((a, b) => a + b, 0) / e.goodPct.length;
    findings.push({
      id: `movement.${key}`,
      domain: 'movement',
      severity: clamp(100 - avgClean, 30, 90),
      title: `${e.label} — ${e.exercise}`,
      detail: `Flagged across ${e.count} sets, clean on ${Math.round(avgClean)}% of reps.`,
      drivers: [],
    });
  }

  /* ------------------------------------------------------- recovery */
  if (vitals) {
    if (isNum(vitals.readiness) && vitals.readiness < 60) {
      findings.push({
        id: 'recovery.readiness',
        domain: 'recovery',
        severity: 100 - vitals.readiness,
        title: 'Recovery is lagging',
        detail: `Readiness ${vitals.readiness}. Resting heart rate ${vitals.bpm ?? '—'} bpm, HRV ${vitals.rmssd ?? '—'} ms.`,
        drivers: [],
      });
    }
  }

  /* ----------------------------------------------------------- skin */
  if (skin?.metrics) {
    const weakest = Object.entries(skin.metrics)
      .filter(([, v]) => isNum(v.score))
      .sort((a, b) => a[1].score - b[1].score)[0];
    if (weakest && weakest[1].score < 60) {
      findings.push({
        id: `skin.${weakest[0]}`,
        domain: 'skin',
        severity: 100 - weakest[1].score,
        title: weakest[1].label || weakest[0],
        detail: 'Lowest-scoring area on the most recent skin scan.',
        drivers: [],
      });
    }
  }

  /* ----------------------------------------------------------- labs */
  if (labs?.panel) {
    for (const r of labs.panel.outOfRange || []) {
      findings.push({
        id: `labs.${r.id}`,
        domain: 'labs',
        severity: 60,
        title: r.label,
        detail: r.text,
        drivers: [],
        clinicalOnly: r.clinicalOnly,
      });
    }
    if (labs.panel.seekCare) {
      findings.push({
        id: 'labs.urgent',
        domain: 'labs',
        severity: 100,
        title: 'Bloods need clinical review',
        detail: 'One or more values are well outside the usual range.',
        clinical: true,
        drivers: [],
      });
    }
  }

  return findings.sort((a, b) => b.severity - a.severity);
}

/* --------------------------------------------------------- block library */

/**
 * Training blocks, keyed by what they address. Each is a concrete piece of
 * work a trainer would actually write on a sheet.
 */
const BLOCKS = {
  forwardHead: {
    title: 'Neck and upper-back reset',
    items: [
      'Chin tucks — 3×10, 3-second hold',
      'Prone Y-raise — 3×12, slow',
      'Wall angels — 2×10, ribs down',
    ],
    frequency: 'Daily, 6 minutes',
  },
  shoulderProtraction: {
    title: 'Open the front, build the back',
    items: [
      'Doorway pec stretch — 2×30 s each side',
      'Band pull-apart — 3×15',
      'Face pull — 3×12, pause at the face',
    ],
    frequency: '4× a week',
  },
  pelvicTilt: {
    title: 'Pelvic control',
    items: [
      'Half-kneeling hip flexor stretch — 2×45 s each side',
      'Glute bridge — 3×12, 2-second squeeze',
      'Dead bug — 3×8 each side, ribs down',
    ],
    frequency: '4× a week',
  },
  trunkLean: {
    title: 'Trunk and balance',
    items: [
      'Side plank — 3×30 s each side',
      'Single-leg stand — 3×30 s each side, eyes closed to progress',
      'Suitcase carry — 3×20 m each side',
    ],
    frequency: '3× a week',
  },
  levelness: {
    title: 'Side-to-side balance',
    items: [
      'Single-leg glute bridge — 3×10 each side, weaker side first',
      'Offset (single-arm) carry on the low side — 3×20 m',
      'Copenhagen plank — 2×20 s each side',
    ],
    frequency: '3× a week',
  },
  kneeTracking: {
    title: 'Knee tracking',
    items: [
      'Banded lateral walk — 3×15 each direction',
      'Tempo goblet squat — 4×8, 3 seconds down, knees out',
      'Step-down from a low box — 3×8 each leg, controlled',
    ],
    frequency: '3× a week',
  },
  depth: {
    title: 'Squat depth and ankle range',
    items: [
      'Wall ankle mobilisation — 2×10 each side',
      'Goblet squat hold — 3×30 s at the bottom',
      'Tempo squat to a box — 4×6, pause 2 s',
    ],
    frequency: '3× a week',
  },
  bracing: {
    title: 'Bracing and back position',
    items: [
      'Hip hinge drill with a dowel — 3×10',
      'Romanian deadlift, light — 4×8, tempo 3-1-1',
      'Bird dog — 3×8 each side',
    ],
    frequency: '3× a week',
  },
  aerobicBase: {
    title: 'Aerobic base',
    items: [
      'Zone 2 — conversational pace, 30–45 min',
      'Post-meal walk — 10–15 min after the largest meal',
    ],
    frequency: '3–4× a week',
  },
  strengthBase: {
    title: 'Full-body strength',
    items: [
      'Squat pattern — 3×6–8',
      'Hinge pattern — 3×6–8',
      'Push — 3×8–10',
      'Pull — 3×8–10',
      'Carry — 3×30 m',
    ],
    frequency: '2–3× a week',
  },
  power: {
    title: 'Speed and power',
    items: [
      'Countermovement jumps — 4×3, full recovery',
      'Medicine ball throws — 4×5',
      'Short sprints or bag rounds — 6×15 s, 60 s rest',
    ],
    frequency: '2× a week',
  },
  deload: {
    title: 'Recovery week',
    items: [
      'Cut working sets by about a third, hold the weight',
      'Keep the movements, remove the grind',
      'Add one full rest day',
    ],
    frequency: 'This week',
  },
};

/** Habit prescriptions, keyed by finding domain. */
const HABITS = {
  recovery: [
    'Fix a consistent wake time — it moves HRV more than bedtime does.',
    'No hard training within 3 hours of sleep.',
    'Ten minutes of daylight within an hour of waking.',
  ],
  body: [
    'Protein at every meal — roughly a palm-sized portion.',
    'Walk after your largest meal.',
    'Keep liquid calories for genuine occasions.',
  ],
  skin: [
    'SPF 30+ every morning, all year.',
    'Hydrate on damp skin, then seal with a moisturiser.',
    'Keep the routine simple while anything is irritated.',
  ],
  labs: [
    'Retest under the same conditions — fasted, same time of day, rested.',
    'Take the report to your next appointment rather than acting alone.',
  ],
  posture: [
    'Change position every 45 minutes — the best posture is the next one.',
    'Screen at eye level.',
  ],
  movement: [
    'Film one working set a week from the same angle.',
    'Leave two reps in reserve while a pattern is being rebuilt.',
  ],
};

/** Maps a finding id onto the block that addresses it. */
function blockFor(finding) {
  const [domain, rest = ''] = finding.id.split('.');
  if (domain === 'posture') {
    if (rest === 'forwardHead') return BLOCKS.forwardHead;
    if (rest === 'shoulderProtraction') return BLOCKS.shoulderProtraction;
    if (rest === 'pelvicTilt') return BLOCKS.pelvicTilt;
    if (rest === 'trunkLean') return BLOCKS.trunkLean;
    if (rest === 'shoulderLevel' || rest === 'pelvisLevel') return BLOCKS.levelness;
    if (rest === 'kneeTracking') return BLOCKS.kneeTracking;
    return BLOCKS.trunkLean;
  }
  if (domain === 'movement') {
    if (rest.includes('depth')) return BLOCKS.depth;
    if (rest.includes('kneeTrack')) return BLOCKS.kneeTracking;
    if (rest.includes('backLine') || rest.includes('hinge') || rest.includes('plank')) return BLOCKS.bracing;
    return BLOCKS.strengthBase;
  }
  if (domain === 'body') return BLOCKS.aerobicBase;
  if (domain === 'recovery') return BLOCKS.deload;
  return null;
}

/* ------------------------------------------------------------ generation */

/**
 * @param {object} data latest records: { posture, body, sessions, skin, vitals, labs, client }
 * @returns {object} program
 */
export function buildProgram(data = {}) {
  const findings = collectFindings(data);
  const client = data.client || {};

  const clinicalFlags = findings.filter((f) => f.clinical || f.clinicalOnly);
  const actionable = findings.filter((f) => !f.clinical && !f.clinicalOnly);
  const priorities = actionable.slice(0, 3);

  /* ---------------------------------------------------- short block */
  const shortBlocks = [];
  const seen = new Set();
  for (const f of priorities) {
    const block = blockFor(f);
    if (!block || seen.has(block.title)) continue;
    seen.add(block.title);
    shortBlocks.push({ ...block, because: f.title });
  }
  // Everyone gets a strength and an aerobic anchor unless recovery says otherwise.
  const recoveryLimited = findings.some((f) => f.domain === 'recovery' && f.severity > 40);
  if (!recoveryLimited && !seen.has(BLOCKS.strengthBase.title)) {
    shortBlocks.push({ ...BLOCKS.strengthBase, because: 'Baseline strength' });
  }
  if (!seen.has(BLOCKS.aerobicBase.title)) {
    shortBlocks.push({ ...BLOCKS.aerobicBase, because: 'Baseline conditioning' });
  }

  /* ------------------------------------------------------- habits */
  const habitDomains = [...new Set(priorities.map((f) => f.domain))];
  const habits = [];
  for (const d of habitDomains) {
    for (const h of HABITS[d] || []) {
      if (!habits.includes(h) && habits.length < 5) habits.push(h);
    }
  }
  if (!habits.length) habits.push(...HABITS.movement.slice(0, 2));

  /* --------------------------------------------------- long arc */
  const longPhases = [
    {
      weeks: '1–4',
      name: 'Restore',
      aim: priorities.length
        ? `Take the pressure off ${priorities[0].title.toLowerCase()} and rebuild the pattern underneath it.`
        : 'Build a consistent base and establish clean movement.',
      focus: shortBlocks.slice(0, 3).map((b) => b.title),
      intensity: recoveryLimited ? 'Easy — recovery is the limiter right now' : 'Moderate, two reps in reserve',
    },
    {
      weeks: '5–8',
      name: 'Build',
      aim: 'Add load to the patterns that are now clean, and keep the correctives on as maintenance.',
      focus: [BLOCKS.strengthBase.title, ...shortBlocks.slice(0, 1).map((b) => b.title)],
      intensity: 'Progressive — add load or reps weekly, one variable at a time',
    },
    {
      weeks: '9–12',
      name: 'Express',
      aim: 'Convert the base into output — speed, power and work capacity.',
      focus: [BLOCKS.power.title, BLOCKS.strengthBase.title],
      intensity: 'Hard days genuinely hard, easy days genuinely easy',
    },
  ];

  /* --------------------------------------------------- re-scan plan */
  const rescan = [];
  if (data.posture) rescan.push({ what: 'Posture assessment', when: 'Every 4 weeks', why: 'Alignment changes slowly — monthly is often enough to see it.' });
  if (data.body) rescan.push({ what: 'Body scan', when: 'Every 2 weeks', why: 'Same light, same clothing, same time of day.' });
  if (data.vitals) rescan.push({ what: 'Recovery scan', when: 'Most mornings', why: 'Trend matters far more than any single reading.' });
  if (data.skin) rescan.push({ what: 'Skin scan', when: 'Every 2 weeks', why: 'Skin shifts week to week; compare like with like.' });
  if (data.labs) rescan.push({ what: 'Bloods', when: 'With your doctor, usually 8–12 weeks', why: 'Most markers need that long to move meaningfully.' });

  const weeklyShape = buildWeek(shortBlocks, recoveryLimited);

  return {
    generatedAt: Date.now(),
    clientName: client.name || null,
    findings,
    priorities,
    clinicalFlags,
    recoveryLimited,
    short: {
      title: '4-week block',
      subtitle: priorities.length
        ? `Built around ${priorities.map((p) => p.title.toLowerCase()).join(', ')}`
        : 'Foundation block',
      blocks: shortBlocks,
      week: weeklyShape,
    },
    long: { title: '12-week arc', phases: longPhases },
    habits,
    rescan,
    engine: 'krysaril-program-1',
  };
}

/** Lays the blocks onto a week so it reads like a plan, not a list. */
function buildWeek(blocks, recoveryLimited) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const daily = blocks.filter((b) => /daily/i.test(b.frequency));
  const rest = blocks.filter((b) => !/daily/i.test(b.frequency));

  const trainingDays = recoveryLimited ? [0, 3] : [0, 2, 4];
  const week = days.map((day, i) => {
    const isTraining = trainingDays.includes(i);
    const assigned = isTraining
      ? rest.filter((_, idx) => idx % trainingDays.length === trainingDays.indexOf(i))
      : [];
    return {
      day,
      kind: isTraining ? 'Train' : (i === 6 ? 'Rest' : 'Move'),
      blocks: [
        ...daily.map((b) => b.title),
        ...assigned.map((b) => b.title),
        ...(isTraining ? [] : i === 6 ? [] : ['Easy walk 20–30 min']),
      ],
    };
  });
  return week;
}

/** One-line summary for cards and the assistant. */
export function programSummary(program) {
  if (!program) return 'No program yet.';
  if (!program.priorities.length) return 'Foundation block — build consistency, then load.';
  return `Focused on ${program.priorities.map((p) => p.title.toLowerCase()).join(', ')}.`;
}

export const PROGRAM_DISCLAIMER =
  'This program is generated from your own assessment data using fixed rules — it is a starting structure, not a prescription. It does not know about your injuries, medications or medical history. Adjust it with a qualified coach, and clear anything flagged for clinical review with your doctor first.';
