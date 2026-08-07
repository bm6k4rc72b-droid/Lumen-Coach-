/**
 * Labs, program engine, rPPG maths and knowledge retrieval.
 *
 * The labs tests are the important ones: they pin the safety behaviour so a
 * later change cannot quietly remove the escalation path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKERS, evaluateMarker, evaluatePanel, rangeFor, labsGuidance, clinicalReferrals,
} from '../js/labs/panel.js';
import { buildProgram, collectFindings } from '../js/program/engine.js';
import {
  PulseBuffer, analysePulse, readinessScore, resample, bandpass, findPeaks, spectrum,
} from '../js/vitals/rppg.js';
import { search, tokenise } from '../js/assistant/knowledge.js';
import { readFile } from 'node:fs/promises';

/* ============================================================== LABS === */

test('values inside the reference range pass', () => {
  const r = evaluateMarker(MARKERS.glucoseFasting, 4.8);
  assert.equal(r.level, 'good');
  assert.equal(r.seekCare, false);
});

test('values outside the range are flagged but not escalated', () => {
  const high = evaluateMarker(MARKERS.glucoseFasting, 6.4);
  assert.equal(high.flag, 'high');
  assert.equal(high.level, 'warn');
  assert.equal(high.seekCare, false, 'a mildly raised value must not trigger the urgent path');

  const low = evaluateMarker(MARKERS.ferritin, 10, { sex: 'female' });
  assert.equal(low.flag, 'low');
  assert.equal(low.seekCare, false);
});

test('the urgent tier escalates and cannot be reached by a merely abnormal value', () => {
  const urgent = evaluateMarker(MARKERS.glucoseFasting, 18);
  assert.equal(urgent.seekCare, true);
  assert.equal(urgent.level, 'bad');
  assert.match(urgent.text, /clinician/i);

  // Just outside the range is not urgent.
  assert.equal(evaluateMarker(MARKERS.glucoseFasting, 5.9).seekCare, false);
});

test('sex-specific reference ranges are applied', () => {
  assert.deepEqual(rangeFor(MARKERS.ferritin, 'female'), [15, 200]);
  assert.deepEqual(rangeFor(MARKERS.ferritin, 'male'), [30, 300]);
  // 20 µg/L is in range for a woman, low for a man.
  assert.equal(evaluateMarker(MARKERS.ferritin, 20, { sex: 'female' }).level, 'good');
  assert.equal(evaluateMarker(MARKERS.ferritin, 20, { sex: 'male' }).level, 'warn');
});

test('in-range but outside the tighter preventive band still reads as good', () => {
  const r = evaluateMarker(MARKERS.glucoseFasting, 5.3);
  assert.equal(r.level, 'good');
  assert.match(r.text, /preventive care/);
});

test('a panel sorts the most serious findings first', () => {
  const panel = evaluatePanel({
    glucoseFasting: 4.9,      // fine
    triglycerides: 2.4,       // high
    hba1c: 12.0,              // urgent
  });
  assert.equal(panel.seekCare, true);
  assert.equal(panel.urgent.length, 1);
  assert.equal(panel.urgent[0].id, 'hba1c');
  assert.equal(panel.results[0].id, 'hba1c', 'urgent findings come first');
  assert.equal(panel.measured, 3);
});

test('lifestyle tips are withheld for urgent and clinician-only markers', () => {
  const panel = evaluatePanel({ hba1c: 12.0, tsh: 6.5, triglycerides: 2.4 });

  const guidance = labsGuidance(panel);
  const ids = guidance.map((g) => g.id);
  assert.ok(!ids.includes('hba1c'), 'no tips for an urgent value');
  assert.ok(!ids.includes('tsh'), 'no tips for a clinician-only marker');
  assert.ok(ids.includes('triglycerides'), 'tips still given where lifestyle genuinely helps');

  const referrals = clinicalReferrals(panel).map((r) => r.id);
  assert.ok(referrals.includes('hba1c'));
  assert.ok(referrals.includes('tsh'));
});

test('unknown markers and blank values are ignored rather than guessed at', () => {
  const panel = evaluatePanel({ notAMarker: 5, glucoseFasting: null, hba1c: 5.2 });
  assert.equal(panel.measured, 1);
  assert.equal(panel.results[0].id, 'hba1c');
});

test('every marker declares an urgent band wider than its reference range', () => {
  for (const m of Object.values(MARKERS)) {
    assert.ok(Array.isArray(m.urgent), `${m.id} has no urgent band`);
    const [lo, hi] = m.ref;
    assert.ok(m.urgent[0] <= lo, `${m.id} urgent low overlaps the reference range`);
    assert.ok(m.urgent[1] >= hi, `${m.id} urgent high overlaps the reference range`);
  }
});

/* =========================================================== PROGRAM === */

const posture = (overrides = {}) => ({
  view: 'side',
  overall: 62,
  createdAt: Date.now(),
  measures: {
    forwardHead: { id: 'forwardHead', label: 'Forward head', unit: '°', value: 38, level: 'bad', score: 30, note: 'Head carried forward.' },
    trunkLean: { id: 'trunkLean', label: 'Trunk lean', unit: '°', value: 3, level: 'good', score: 100, note: 'Upright.' },
    ...overrides,
  },
});

test('findings are ranked by severity', () => {
  const findings = collectFindings({ posture: posture() });
  assert.ok(findings.length >= 1);
  assert.equal(findings[0].id, 'posture.forwardHead');
  for (let i = 1; i < findings.length; i++) {
    assert.ok(findings[i - 1].severity >= findings[i].severity);
  }
});

test('a program targets the top finding with matching work', () => {
  const p = buildProgram({ posture: posture(), client: { name: 'Test' } });
  assert.equal(p.priorities[0].id, 'posture.forwardHead');
  const titles = p.short.blocks.map((b) => b.title);
  assert.ok(titles.includes('Neck and upper-back reset'), titles.join(', '));
  assert.equal(p.long.phases.length, 3);
  assert.ok(p.short.week.length === 7);
  assert.ok(p.habits.length >= 1);
});

test('low readiness reduces training days and adds a recovery block', () => {
  const busy = buildProgram({ posture: posture() });
  const tired = buildProgram({
    posture: posture(),
    vitals: { readiness: 28, bpm: 68, rmssd: 22, createdAt: Date.now() },
  });

  assert.equal(tired.recoveryLimited, true);
  const busyDays = busy.short.week.filter((d) => d.kind === 'Train').length;
  const tiredDays = tired.short.week.filter((d) => d.kind === 'Train').length;
  assert.ok(tiredDays < busyDays, `${tiredDays} should be fewer than ${busyDays}`);
  assert.ok(tired.short.blocks.some((b) => b.title === 'Recovery week'));
});

test('urgent bloods surface as a clinical flag and never as training work', () => {
  const panel = evaluatePanel({ hba1c: 12.0 });
  const p = buildProgram({ posture: posture(), labs: { panel, createdAt: Date.now() } });

  assert.ok(p.clinicalFlags.some((f) => f.id === 'labs.urgent'));
  assert.ok(!p.priorities.some((f) => f.id === 'labs.urgent'),
    'a clinical flag must not become a training priority');
  assert.ok(p.short.blocks.every((b) => !/blood|hba1c/i.test(b.title)));
});

test('a program is still produced with no data at all', () => {
  const p = buildProgram({});
  assert.equal(p.priorities.length, 0);
  assert.ok(p.short.blocks.length >= 2, 'still gets a strength and aerobic anchor');
  assert.ok(p.habits.length >= 1);
});

test('repeated form failures across sessions become a finding', () => {
  const set = (checks) => ({ exerciseId: 'squat', exerciseName: 'Squat', checks });
  const sessions = [1, 2, 3].map(() => ({
    startedAt: Date.now(),
    sets: [set([{ id: 'depth', label: 'Depth', worst: 'bad', goodPct: 20 }])],
  }));
  const findings = collectFindings({ sessions });
  assert.ok(findings.some((f) => f.id.startsWith('movement.squat:depth')));

  // A single bad set is noise and must not create a finding.
  const one = collectFindings({ sessions: [sessions[0]] });
  assert.equal(one.length, 0);
});

/* ============================================================== rPPG === */

/** Synthesises a clean pulse wave at a known rate. */
/**
 * Deterministic white noise. The obvious `sin(i * 12.9898) * 43758.5453 % 1`
 * hash must not be used here: sampled at integer indices it aliases into a
 * strong periodic tone, which the analyser correctly reads as a *cleaner*
 * signal rather than a dirtier one.
 */
function whiteNoise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

function syntheticPulse(bpm, seconds, fps, { noise = 0, seed = 1337 } = {}) {
  const buffer = new PulseBuffer(seconds + 5);
  const f = bpm / 60;
  const rand = whiteNoise(seed);
  for (let i = 0; i < seconds * fps; i++) {
    const t = (i / fps) * 1000;
    const phase = 2 * Math.PI * f * (i / fps);
    // Pulse waveform plus a slow drift the detrender should remove.
    const pulse = bpm ? Math.sin(phase) + 0.3 * Math.sin(2 * phase) : 0;
    const drift = 0.02 * i;
    const n = noise ? rand() * noise : 0;
    buffer.push(t, { r: 180, g: 128 + pulse * 2 + drift + n, b: 110 });
  }
  return buffer;
}

test('heart rate is recovered from a synthetic pulse', () => {
  for (const bpm of [54, 72, 96]) {
    const result = analysePulse(syntheticPulse(bpm, 20, 30));
    assert.equal(result.ready, true, `not ready at ${bpm}`);
    assert.ok(Math.abs(result.bpm - bpm) <= 3, `got ${result.bpm}, wanted ${bpm}`);
  }
});

test('a short recording refuses to report a number', () => {
  const result = analysePulse(syntheticPulse(72, 4, 30));
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'collecting');
});

test('confidence falls as the signal is buried in noise', () => {
  const levels = [0, 4, 8, 14].map((noise) =>
    analysePulse(syntheticPulse(72, 20, 30, { noise })).confidence);
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] <= levels[i - 1],
      `confidence rose with noise: ${levels.join(' → ')}`);
  }
  assert.ok(levels[levels.length - 1] < levels[0], `no fall at all: ${levels.join(' → ')}`);
});

test('a recording with no pulse in it is never reported as a heart rate', () => {
  // Whether a *particular* noise record squeaks past a threshold is luck, so
  // this sweeps seeds. Length and beat count are both satisfied throughout —
  // noise has plenty of local maxima — so only the spectral gates can catch it.
  let accepted = 0;
  let sawBeats = false;
  for (let s = 1; s <= 60; s++) {
    const r = analysePulse(syntheticPulse(0, 20, 30, { noise: 10, seed: s * 7919 }));
    if (r.ready) accepted++;
    if (r.beats >= 6) sawBeats = true;
  }
  assert.equal(accepted, 0, `${accepted}/60 pulseless records were reported as a heart rate`);
  assert.ok(sawBeats, 'noise does produce beat-like peaks — that is exactly the trap');
});

test('a reading is never published with the wrong rate', () => {
  // The guarantee that matters: across signal qualities, anything the app is
  // willing to show has to be right. Refusing is always allowed.
  for (const noise of [0, 2, 4, 8, 14, 30]) {
    for (let s = 1; s <= 12; s++) {
      const r = analysePulse(syntheticPulse(68, 20, 30, { noise, seed: s * 7919 }));
      if (!r.ready) continue;
      assert.ok(Math.abs(r.bpm - 68) <= 3,
        `published ${r.bpm} bpm for a 68 bpm signal at noise ${noise}, seed ${s}`);
    }
  }
});

test('a usable-but-imperfect signal is still accepted', () => {
  // The gates must not be so tight that a real, slightly noisy reading is
  // rejected — that would make the feature useless rather than merely safe.
  let accepted = 0;
  for (let s = 1; s <= 20; s++) {
    if (analysePulse(syntheticPulse(68, 20, 30, { noise: 4, seed: s * 7919 })).ready) accepted++;
  }
  assert.equal(accepted, 20, `only ${accepted}/20 good readings accepted`);
});

test('beat intervals are detected for HRV', () => {
  const result = analysePulse(syntheticPulse(72, 25, 30));
  assert.ok(result.beats >= 20, `only ${result.beats} beats`);
  assert.ok(result.rmssd !== null);
  // A perfectly periodic signal has almost no variability.
  assert.ok(result.rmssd < 40, `rmssd ${result.rmssd} too high for a metronomic signal`);
});

test('signal helpers behave', () => {
  const times = [0, 100, 200, 300, 400, 500];
  const values = [0, 1, 2, 3, 4, 5];
  const rs = resample(times, values, 20);
  assert.ok(rs.length > 5);
  assert.ok(rs[0] >= 0 && rs[rs.length - 1] <= 5);

  const wave = new Float64Array(300);
  for (let i = 0; i < wave.length; i++) wave[i] = Math.sin((2 * Math.PI * 1.2 * i) / 30);
  const filtered = bandpass(wave, 30);
  const peaks = findPeaks(filtered, 30);
  assert.ok(peaks.length >= 8, `found ${peaks.length} peaks`);

  const spec = spectrum(filtered, 30);
  const top = spec.reduce((a, b) => (b.power > a.power ? b : a));
  assert.ok(Math.abs(top.f - 1.2) < 0.15, `peak at ${top.f} Hz`);
});

test('readiness needs a baseline before it scores', () => {
  const none = readinessScore({ bpm: 60, rmssd: 55 }, []);
  assert.equal(none.score, null);
  assert.equal(none.baseline, false);
  assert.match(none.text, /baseline/i);

  const history = [
    { bpm: 58, rmssd: 52 }, { bpm: 60, rmssd: 48 }, { bpm: 59, rmssd: 50 }, { bpm: 61, rmssd: 47 },
  ];
  const good = readinessScore({ bpm: 54, rmssd: 68 }, history);
  const poor = readinessScore({ bpm: 70, rmssd: 30 }, history);
  assert.ok(good.score > poor.score, `${good.score} should beat ${poor.score}`);
  assert.ok(good.score >= 1 && good.score <= 100);
  assert.ok(poor.score >= 1 && poor.score <= 100);
});

/* ========================================================= KNOWLEDGE === */

const kb = JSON.parse(await readFile(new URL('../knowledge/kb.json', import.meta.url), 'utf8'));

test('the knowledge base is well formed', () => {
  assert.ok(kb.version, 'has a version');
  assert.ok(kb.entries.length >= 15, `only ${kb.entries.length} entries`);
  for (const e of kb.entries) {
    assert.ok(e.id && e.topic && e.answer, `entry ${e.id} incomplete`);
    assert.ok(Array.isArray(e.tags) && e.tags.length, `entry ${e.id} has no tags`);
  }
  const ids = kb.entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'entry ids are unique');
});

test('retrieval finds the right topic for natural questions', () => {
  const cases = [
    ['what is HRV and why does it matter', 'hrv-basics'],
    ['my knees cave in when I squat', 'knee-valgus'],
    ['how much protein should I eat', 'protein'],
    ['can this app measure my body fat', 'body-fat-methods'],
    ['what does waist to height mean', 'waist-height'],
    ['my skin is red and irritated', 'skin-redness'],
    ['how long until my triglycerides change', 'triglycerides-fast'],
    ['where is my data stored', 'app-privacy'],
  ];
  for (const [question, expected] of cases) {
    const hits = search(kb.entries, question);
    assert.ok(hits.length, `no hit for "${question}"`);
    assert.equal(hits[0].entry.id, expected,
      `"${question}" → ${hits[0].entry.id}, wanted ${expected}`);
  }
});

test('retrieval returns nothing for an unrelated question', () => {
  assert.equal(search(kb.entries, 'what is the capital of Peru').length, 0);
  assert.equal(search(kb.entries, '').length, 0);
});

test('tokenising drops stop words', () => {
  const t = tokenise('What is the best way to do a squat?');
  assert.ok(t.includes('best'));
  assert.ok(t.includes('squat'));
  assert.ok(!t.includes('the'));
  assert.ok(!t.includes('is'));
});
