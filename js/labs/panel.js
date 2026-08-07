/**
 * Blood-work tracking and lifestyle context.
 *
 * ────────────────────────────────────────────────────────────────────────
 * SAFETY MODEL — read before changing anything in this file.
 *
 * This module does three things and refuses to do a fourth:
 *   1. Compares entered values against standard laboratory reference ranges.
 *   2. Flags anything outside those ranges.
 *   3. Offers general lifestyle context for markers that respond to
 *      lifestyle (diet, sleep, training, alcohol, sun exposure).
 *
 * It does NOT diagnose, does NOT name conditions as conclusions, and does
 * NOT give medication or supplement dosing. Every marker carries an
 * `urgent` band; when a value falls in it, `evaluate()` returns
 * `seekCare: true`, tips are withheld for that marker, and the UI is
 * required to lead with a contact-a-clinician message. That override is
 * deliberate — do not add a code path that suppresses it.
 *
 * Reference ranges vary between laboratories. The ranges here are common
 * adult values and are always shown alongside the reading so the user can
 * compare them with the ones printed on their own report.
 * ────────────────────────────────────────────────────────────────────────
 */

/** @typedef {'critical-low'|'low'|'borderline-low'|'in-range'|'optimal'|'borderline-high'|'high'|'critical-high'} Flag */

const F = {
  criticalLow: 'critical-low',
  low: 'low',
  inRange: 'in-range',
  high: 'high',
  criticalHigh: 'critical-high',
};

/**
 * Marker definitions.
 *
 * `ref`      standard adult reference range [low, high]
 * `refBySex` overrides keyed by 'male' | 'female'
 * `optimal`  a tighter band often discussed in preventive care (advisory only)
 * `urgent`   outside this band, the report escalates to seek-care
 * `lower`    true when a lower number is the desirable direction
 * `levers`   lifestyle factors that genuinely move this marker
 */
export const MARKERS = {
  /* ---------------------------------------------------------- metabolic */
  glucoseFasting: {
    id: 'glucoseFasting',
    label: 'Fasting glucose',
    group: 'Metabolic',
    unit: 'mmol/L',
    altUnit: { unit: 'mg/dL', factor: 18.0182 },
    ref: [3.9, 5.5],
    optimal: [4.2, 5.0],
    urgent: [2.8, 13.9],
    about: 'Blood sugar after an overnight fast.',
    levers: [
      'Walk for 10–15 minutes after meals — one of the most reliable ways to blunt a glucose rise.',
      'Build meals around protein and fibre first; add starch alongside rather than alone.',
      'Resistance training two to three times a week improves how muscle takes up glucose.',
      'Short sleep raises fasting glucose within days. Protect the sleep window.',
    ],
  },
  hba1c: {
    id: 'hba1c',
    label: 'HbA1c',
    group: 'Metabolic',
    unit: '%',
    ref: [4.0, 5.6],
    optimal: [4.6, 5.3],
    urgent: [3.5, 10.0],
    about: 'Average blood sugar over roughly the last three months.',
    levers: [
      'This moves slowly — judge changes over 3 months, not weeks.',
      'Total weekly activity matters more than any single session.',
      'Reducing liquid sugar tends to move this marker faster than any other single change.',
    ],
  },
  insulinFasting: {
    id: 'insulinFasting',
    label: 'Fasting insulin',
    group: 'Metabolic',
    unit: 'µIU/mL',
    ref: [2, 19.6],
    optimal: [2, 8],
    urgent: [0, 50],
    about: 'How much insulin is needed to hold fasting glucose steady.',
    levers: [
      'Often shifts before glucose does, so it is a useful early signal.',
      'Resistance training plus reduced refined carbohydrate is the usual lever pair.',
    ],
  },

  /* ------------------------------------------------------------- lipids */
  cholesterolTotal: {
    id: 'cholesterolTotal',
    label: 'Total cholesterol',
    group: 'Lipids',
    unit: 'mmol/L',
    altUnit: { unit: 'mg/dL', factor: 38.67 },
    ref: [0, 5.2],
    lower: true,
    urgent: [0, 10],
    about: 'All cholesterol carried in the blood. Interpreted alongside the fractions below.',
    levers: [
      'Total on its own says little — the LDL, HDL and triglyceride split matters more.',
    ],
  },
  ldl: {
    id: 'ldl',
    label: 'LDL cholesterol',
    group: 'Lipids',
    unit: 'mmol/L',
    altUnit: { unit: 'mg/dL', factor: 38.67 },
    ref: [0, 3.0],
    optimal: [0, 2.6],
    lower: true,
    urgent: [0, 6.5],
    about: 'The fraction most consistently linked with cardiovascular risk.',
    levers: [
      'Soluble fibre — oats, beans, lentils, psyllium — lowers LDL measurably.',
      'Replacing saturated fat with unsaturated (olive oil, nuts, oily fish) is the strongest dietary lever.',
      'Regular aerobic training helps, though usually less than diet for this marker.',
    ],
  },
  hdl: {
    id: 'hdl',
    label: 'HDL cholesterol',
    group: 'Lipids',
    unit: 'mmol/L',
    altUnit: { unit: 'mg/dL', factor: 38.67 },
    ref: [1.0, 2.5],
    refBySex: { female: [1.3, 2.5], male: [1.0, 2.5] },
    higherBetter: true,
    urgent: [0.5, 4],
    about: 'Generally associated with lower cardiovascular risk.',
    levers: [
      'Aerobic exercise is the most reliable way to raise it.',
      'Responds slowly — expect months, not weeks.',
    ],
  },
  triglycerides: {
    id: 'triglycerides',
    label: 'Triglycerides',
    group: 'Lipids',
    unit: 'mmol/L',
    altUnit: { unit: 'mg/dL', factor: 88.57 },
    ref: [0, 1.7],
    optimal: [0, 1.1],
    lower: true,
    urgent: [0, 5.6],
    about: 'Circulating fat. Very sensitive to recent diet and alcohol.',
    levers: [
      'Alcohol and refined sugar raise this quickly, and reducing them lowers it quickly.',
      'One of the fastest-moving markers on the panel — weeks, not months.',
      'Must be measured fasted to mean anything.',
    ],
  },

  /* ------------------------------------------------------------ thyroid */
  tsh: {
    id: 'tsh',
    label: 'TSH',
    group: 'Thyroid',
    unit: 'mIU/L',
    ref: [0.4, 4.0],
    optimal: [0.5, 2.5],
    urgent: [0.1, 10],
    about: 'The pituitary signal that drives the thyroid. Interpreted with T4.',
    clinicalOnly: true,
    levers: [
      'Thyroid results belong with a clinician — they need to be read alongside T4, T3 and antibodies.',
    ],
  },
  freeT4: {
    id: 'freeT4',
    label: 'Free T4',
    group: 'Thyroid',
    unit: 'pmol/L',
    ref: [9, 19],
    urgent: [6, 30],
    clinicalOnly: true,
    about: 'The main circulating thyroid hormone.',
    levers: ['Interpreted by a clinician alongside TSH.'],
  },

  /* ------------------------------------------- iron, blood and vitamins */
  ferritin: {
    id: 'ferritin',
    label: 'Ferritin',
    group: 'Iron & blood',
    unit: 'µg/L',
    ref: [30, 300],
    refBySex: { female: [15, 200], male: [30, 300] },
    optimal: [50, 150],
    urgent: [8, 1000],
    about: 'Stored iron. Low stores commonly show up as fatigue and poor training tolerance.',
    levers: [
      'Iron from meat is absorbed far better than from plants; vitamin C alongside plant sources helps.',
      'Tea and coffee with meals reduce iron absorption — move them between meals.',
      'Ferritin also rises with inflammation, so a high reading is not automatically high iron stores.',
      'Do not start iron supplements without testing and clinical advice — excess iron is harmful.',
    ],
  },
  haemoglobin: {
    id: 'haemoglobin',
    label: 'Haemoglobin',
    group: 'Iron & blood',
    unit: 'g/L',
    ref: [120, 175],
    refBySex: { female: [120, 155], male: [135, 175] },
    urgent: [80, 200],
    about: 'Oxygen-carrying capacity of the blood.',
    levers: [
      'Endurance athletes often sit slightly low from plasma volume expansion, which is normal.',
      'A genuinely low reading needs a clinician to find the cause.',
    ],
  },
  vitaminD: {
    id: 'vitaminD',
    label: 'Vitamin D (25-OH)',
    group: 'Iron & blood',
    unit: 'nmol/L',
    ref: [50, 125],
    optimal: [75, 125],
    urgent: [15, 220],
    about: 'Vitamin D status. Widely low in winter at higher latitudes.',
    levers: [
      'Sunlight on skin is the main source; how much you need varies with latitude, season and skin tone.',
      'Oily fish, egg yolk and fortified foods contribute modestly.',
      'Discuss supplement dose with your doctor rather than guessing — it is fat-soluble and can accumulate.',
    ],
  },
  b12: {
    id: 'b12',
    label: 'Vitamin B12',
    group: 'Iron & blood',
    unit: 'pmol/L',
    ref: [150, 650],
    optimal: [250, 650],
    urgent: [100, 1500],
    about: 'Needed for nerve function and red blood cell formation.',
    levers: [
      'Plant-based diets need a reliable B12 source — this is the one nutrient where that is not optional.',
      'Absorption falls with age and with some long-term medications.',
    ],
  },

  /* --------------------------------------------- liver, kidney, muscle */
  alt: {
    id: 'alt',
    label: 'ALT',
    group: 'Liver & kidney',
    unit: 'U/L',
    ref: [0, 40],
    refBySex: { female: [0, 33], male: [0, 41] },
    lower: true,
    urgent: [0, 200],
    about: 'A liver enzyme. Often mildly raised with excess body fat or alcohol.',
    levers: [
      'Reducing alcohol and losing excess abdominal fat are the two levers that move this most.',
      'Hard training can raise liver enzymes transiently — testing after a rest day gives a cleaner picture.',
    ],
  },
  creatinine: {
    id: 'creatinine',
    label: 'Creatinine',
    group: 'Liver & kidney',
    unit: 'µmol/L',
    ref: [60, 110],
    refBySex: { female: [45, 90], male: [60, 110] },
    urgent: [30, 200],
    about: 'A kidney filtration marker. Muscular people often read slightly high.',
    levers: [
      'Creatine supplementation and high muscle mass both raise this without indicating a kidney problem.',
      'Dehydration at the time of the draw raises it too.',
      'A clinician interprets this with eGFR and your build.',
    ],
  },
  ck: {
    id: 'ck',
    label: 'Creatine kinase',
    group: 'Liver & kidney',
    unit: 'U/L',
    ref: [30, 200],
    lower: true,
    urgent: [0, 1000],
    about: 'Released by muscle. Rises sharply after hard or unfamiliar training.',
    levers: [
      'Test at least 72 hours after heavy eccentric work or the number means little.',
      'Very high CK with dark urine and severe muscle pain is a medical emergency — go to urgent care.',
    ],
  },

  /* --------------------------------------------------------- hormones  */
  testosteroneTotal: {
    id: 'testosteroneTotal',
    label: 'Total testosterone',
    group: 'Hormones',
    unit: 'nmol/L',
    ref: [8.6, 29],
    refBySex: { female: [0.3, 1.7], male: [8.6, 29] },
    urgent: [0.1, 60],
    clinicalOnly: true,
    about: 'Measured in the morning; varies through the day.',
    levers: [
      'Sleep debt, very low body fat and severe energy restriction all lower it.',
      'Hormone results need clinical interpretation — never self-treat from a single reading.',
    ],
  },
  cortisolMorning: {
    id: 'cortisolMorning',
    label: 'Morning cortisol',
    group: 'Hormones',
    unit: 'nmol/L',
    ref: [140, 690],
    urgent: [50, 900],
    clinicalOnly: true,
    about: 'Peaks shortly after waking. A single reading says little on its own.',
    levers: [
      'Interpreted by a clinician — timing of the draw changes the result substantially.',
    ],
  },

  /* ----------------------------------------------------- inflammation  */
  crp: {
    id: 'crp',
    label: 'CRP (high sensitivity)',
    group: 'Inflammation',
    unit: 'mg/L',
    ref: [0, 3.0],
    optimal: [0, 1.0],
    lower: true,
    urgent: [0, 10],
    about: 'General inflammation. Rises with infection, injury and hard training.',
    levers: [
      'Any recent illness or heavy session invalidates the reading — retest when fully recovered.',
      'Sleep, body fat and alcohol all influence baseline inflammation.',
    ],
  },
};

export const MARKER_GROUPS = [...new Set(Object.values(MARKERS).map((m) => m.group))];

/* ------------------------------------------------------------ evaluation */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Reference range for this marker, taking sex into account. */
export function rangeFor(marker, sex) {
  if (marker.refBySex && sex && marker.refBySex[sex]) return marker.refBySex[sex];
  return marker.ref;
}

/**
 * Evaluates a single value.
 * @returns {{flag: Flag, level: 'good'|'warn'|'bad', seekCare: boolean, range: number[], text: string}}
 */
export function evaluateMarker(marker, value, { sex = null } = {}) {
  if (!isNum(value)) return null;
  const range = rangeFor(marker, sex);
  const [lo, hi] = range;
  const [uLo, uHi] = marker.urgent || [-Infinity, Infinity];

  // The urgent tier is checked first and can never be overridden below.
  if (value < uLo || value > uHi) {
    return {
      flag: value < uLo ? F.criticalLow : F.criticalHigh,
      level: 'bad',
      seekCare: true,
      range,
      text: `Well outside the usual range. This needs a clinician to look at it promptly.`,
    };
  }

  if (value < lo) {
    return { flag: F.low, level: 'warn', seekCare: false, range, text: 'Below the standard reference range.' };
  }
  if (value > hi) {
    return { flag: F.high, level: 'warn', seekCare: false, range, text: 'Above the standard reference range.' };
  }

  if (marker.optimal && (value < marker.optimal[0] || value > marker.optimal[1])) {
    return {
      flag: F.inRange,
      level: 'good',
      seekCare: false,
      range,
      text: `In range, though outside the tighter ${marker.optimal[0]}–${marker.optimal[1]} band often discussed in preventive care.`,
    };
  }

  return { flag: F.inRange, level: 'good', seekCare: false, range, text: 'Within the reference range.' };
}

/**
 * Evaluates a whole panel.
 * @param {Record<string, number>} values marker id → value
 * @param {{sex?: string}} opts
 */
export function evaluatePanel(values, { sex = null } = {}) {
  const results = [];
  for (const [id, value] of Object.entries(values || {})) {
    const marker = MARKERS[id];
    if (!marker || !isNum(value)) continue;
    const evaluation = evaluateMarker(marker, value, { sex });
    if (!evaluation) continue;
    results.push({
      id,
      label: marker.label,
      group: marker.group,
      unit: marker.unit,
      value,
      about: marker.about,
      clinicalOnly: !!marker.clinicalOnly,
      ...evaluation,
    });
  }

  const urgent = results.filter((r) => r.seekCare);
  const outOfRange = results.filter((r) => !r.seekCare && r.level === 'warn');
  const inRange = results.filter((r) => r.level === 'good');

  return {
    results: results.sort((a, b) => rank(b) - rank(a)),
    urgent,
    outOfRange,
    inRange,
    seekCare: urgent.length > 0,
    measured: results.length,
    analyzedAt: Date.now(),
    engine: 'krysaril-labs-1',
  };
}

function rank(r) {
  if (r.seekCare) return 3;
  if (r.level === 'warn') return 2;
  return 1;
}

/**
 * Lifestyle context for the markers that are out of range.
 *
 * Withheld entirely for urgent values and for markers marked
 * `clinicalOnly` — in those cases the only correct output is "see your
 * clinician", which the report renders instead.
 */
export function labsGuidance(panel, { max = 5 } = {}) {
  const out = [];
  for (const r of panel.outOfRange) {
    if (out.length >= max) break;
    const marker = MARKERS[r.id];
    if (!marker || marker.clinicalOnly) continue;
    out.push({
      id: r.id,
      title: marker.label,
      direction: r.flag === F.low ? 'low' : 'high',
      items: marker.levers,
    });
  }
  return out;
}

/**
 * Markers that need a clinician regardless of how far out they are.
 * Returned separately so the UI can list them without lifestyle tips.
 */
export function clinicalReferrals(panel) {
  return [
    ...panel.urgent.map((r) => ({ id: r.id, label: r.label, reason: 'outside the usual range by a wide margin' })),
    ...panel.outOfRange
      .filter((r) => MARKERS[r.id]?.clinicalOnly)
      .map((r) => ({ id: r.id, label: r.label, reason: 'needs interpreting alongside related markers' })),
  ];
}

/** Converts a value between a marker's primary and alternate unit. */
export function convertUnit(marker, value, toAlt) {
  if (!marker.altUnit || !isNum(value)) return value;
  return toAlt ? value * marker.altUnit.factor : value / marker.altUnit.factor;
}

export const LABS_DISCLAIMER =
  'Krysaril Labs is a tracking and education tool. It compares what you enter against standard laboratory reference ranges and offers general lifestyle context — it does not diagnose anything, does not interpret your results as a whole, and does not advise on medication or supplement dosing. Reference ranges differ between laboratories, so always read these alongside the ranges printed on your own report. Your doctor is the one who interprets your bloods in the context of your history, symptoms and medications. If anything here is flagged for prompt review, contact them.';

export const URGENT_BANNER =
  'One or more values are well outside the usual range. Please contact your doctor or a clinic promptly and show them your report. Krysaril is not withholding anything from you — it simply is not the right tool to interpret readings at this level, and a clinician is.';
