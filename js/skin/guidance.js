/**
 * Turns skin metrics into warm, non-clinical language plus everyday
 * lifestyle suggestions. Wellness guidance only — never a diagnosis.
 */

const BANDS = [
  { min: 85, key: 'excellent' },
  { min: 70, key: 'good' },
  { min: 55, key: 'fair' },
  { min: 0, key: 'focus' },
];

export function bandOf(score) {
  if (score === null || score === undefined) return 'unknown';
  return BANDS.find((b) => score >= b.min).key;
}

export function levelOf(score) {
  if (score === null || score === undefined) return 'neutral';
  if (score >= 75) return 'good';
  if (score >= 55) return 'warn';
  return 'bad';
}

const COPY = {
  evenness: {
    title: 'Tone evenness',
    blurb: 'How consistent your skin tone looks across the area we scanned.',
    excellent: 'Beautifully even tone across the whole area.',
    good: 'Your tone reads nice and consistent.',
    fair: 'A little variation in tone — very normal, and easy to soften over time.',
    focus: 'Tone looks a bit patchy today. Gentle, consistent care makes a real difference here.',
  },
  calm: {
    title: 'Calm & comfort',
    blurb: 'Visible redness or flushing in the scanned area.',
    excellent: 'Skin looks calm and settled.',
    good: 'Mostly calm, with just a hint of warmth.',
    fair: 'Some visible warmth or flushing showing up.',
    focus: 'Noticeable redness right now — kindness and simplicity will serve you well.',
  },
  smoothness: {
    title: 'Texture & smoothness',
    blurb: 'Fine surface texture at close range.',
    excellent: 'Surface looks smooth and refined.',
    good: 'Texture is looking good overall.',
    fair: 'A little surface texture showing.',
    focus: 'Texture is more pronounced today — hydration and gentle exfoliation help.',
  },
  hydration: {
    title: 'Apparent hydration',
    blurb: 'How plump and light-diffusing the surface appears.',
    excellent: 'Skin looks well hydrated and bouncy.',
    good: 'Hydration looks healthy.',
    fair: 'Skin could be a little thirstier than usual.',
    focus: 'Skin is reading dehydrated — water inside and out is the fastest win.',
  },
  poreRefinement: {
    title: 'Pore refinement',
    blurb: 'How visible pores appear at this distance.',
    excellent: 'Pores are barely visible.',
    good: 'Pores look refined.',
    fair: 'Pores are a little more visible in places.',
    focus: 'Pores are quite visible today — a gentle cleanse routine helps them look smaller.',
  },
  clarity: {
    title: 'Even pigmentation',
    blurb: 'Darker spots or patches compared with your surrounding tone.',
    excellent: 'Pigmentation looks lovely and even.',
    good: 'Just a few small spots of deeper tone.',
    fair: 'Some uneven pigmentation showing up.',
    focus: 'Several deeper patches today — daily SPF is the single best protector.',
  },
  balance: {
    title: 'Oil & moisture balance',
    blurb: 'Where your skin sits between dry and oily right now.',
    excellent: 'Beautifully balanced — not dry, not shiny.',
    good: 'Sitting in a comfortable balance.',
    fair: 'Leaning a little to one side of balanced.',
    focus: 'Quite far from balanced today — simplify the routine for a few days.',
  },
};

export function metricCopy(key, score) {
  const c = COPY[key];
  if (!c) return { title: key, blurb: '', note: '' };
  return { title: c.title, blurb: c.blurb, note: c[bandOf(score)] || '' };
}

export function balanceLabel(balance) {
  if (balance === null || balance === undefined) return 'Unknown';
  if (balance < 32) return 'Leaning dry';
  if (balance < 45) return 'Slightly dry';
  if (balance <= 58) return 'Nicely balanced';
  if (balance <= 72) return 'Slightly oily';
  return 'Leaning oily';
}

export function headline(overall) {
  switch (bandOf(overall)) {
    case 'excellent': return 'Your skin is looking radiant today';
    case 'good': return 'Your skin is in a really good place';
    case 'fair': return 'A solid baseline with room to glow';
    case 'focus': return 'A gentle reset week could do wonders';
    default: return 'Here is your skin snapshot';
  }
}

export function subhead(overall) {
  switch (bandOf(overall)) {
    case 'excellent': return 'Whatever you are doing, it is working — keep it consistent.';
    case 'good': return 'Small, steady habits will keep this trending upward.';
    case 'fair': return 'Nothing here is a problem — just a few easy places to focus.';
    case 'focus': return 'Skin shifts week to week. Simple, gentle care goes a long way.';
    default: return 'A snapshot of how your skin looks right now.';
  }
}

/**
 * Suggestions, lowest-scoring areas first, capped so the list stays actionable.
 */
export function suggestions(result, { max = 5 } = {}) {
  const tips = [];
  const m = result.metrics;
  const s = (k) => m[k]?.score ?? 100;

  const ranked = Object.entries(m)
    .filter(([, v]) => v.score !== null)
    .sort((a, b) => a[1].score - b[1].score);

  const pool = {
    hydration: {
      title: 'Layer your hydration',
      body: 'Apply a humectant (hyaluronic acid or glycerin) to slightly damp skin, then seal it with a moisturiser. Aim for consistent water through the day too.',
    },
    calm: {
      title: 'Keep it gentle for a few days',
      body: 'Pause acids, retinoids and scrubs for 3–5 days. Lukewarm water, a creamy cleanser and a simple barrier moisturiser let redness settle.',
    },
    smoothness: {
      title: 'Gentle, regular exfoliation',
      body: 'One or two low-strength chemical exfoliant nights a week (rather than scrubbing) tends to smooth texture without upsetting the barrier.',
    },
    clarity: {
      title: 'Daily SPF is non-negotiable',
      body: 'Broad-spectrum SPF 30+ every morning is the most effective way to stop existing spots deepening — even indoors and in winter.',
    },
    poreRefinement: {
      title: 'Double-cleanse in the evening',
      body: 'An oil or balm cleanser followed by a gentle gel removes sunscreen and sebum properly, which keeps pores looking smaller.',
    },
    evenness: {
      title: 'Consistency beats intensity',
      body: 'Even tone responds to months of steady care: SPF daily, a vitamin C or niacinamide serum in the morning, and good sleep.',
    },
    balance: {
      title: 'Rebalance without stripping',
      body: result.balance > 58
        ? 'Skip harsh foaming cleansers — stripping oil usually makes skin produce more. A light gel moisturiser keeps things comfortable.'
        : 'Swap to a cream cleanser and add a richer night moisturiser. Dry indoor air is often the culprit.',
    },
  };

  for (const [key] of ranked) {
    if (tips.length >= max) break;
    if (s(key) >= 78) continue;
    if (pool[key]) tips.push({ key, ...pool[key] });
  }

  // Universal habits, always worth saying, never repeated.
  const universal = [
    { key: 'water', title: 'Hydrate from the inside', body: 'Steady water through the day (and going easy on alcohol) shows up on your skin within about a week.' },
    { key: 'sleep', title: 'Protect your sleep', body: 'Skin does most of its repair overnight. Seven to nine hours is the cheapest skincare there is.' },
    { key: 'spf', title: 'Sunscreen every morning', body: 'Broad-spectrum SPF 30+ protects tone, texture and firmness all at once.' },
  ];
  for (const u of universal) {
    if (tips.length >= max) break;
    if (!tips.some((t) => t.key === u.key)) tips.push(u);
  }

  return tips.slice(0, max);
}

/** Compares two scans and describes the trend kindly. */
export function trend(current, previous) {
  if (!previous || current.overall === null || previous.overall === null) return null;
  const delta = current.overall - previous.overall;
  const abs = Math.abs(delta);
  if (abs < 3) return { delta, level: 'neutral', text: 'Holding steady since your last scan.' };
  if (delta > 0) {
    return {
      delta, level: 'good',
      text: abs >= 8 ? `Up ${Math.round(delta)} points — lovely progress.` : `Up ${Math.round(delta)} points since last time.`,
    };
  }
  return {
    delta, level: 'warn',
    text: abs >= 8
      ? `Down ${abs} points. Skin fluctuates with sleep, stress and cycle — worth a gentle week.`
      : `Down ${abs} points — well within normal day-to-day variation.`,
  };
}

export const DISCLAIMER =
  'Lumen Skin is a general wellness tool. It looks at lighting, colour and texture in your photo — it does not diagnose, treat or screen for any medical condition. If something on your skin is changing, painful or worrying you, please see a doctor or dermatologist.';
