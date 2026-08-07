/**
 * The coach's answering brain.
 *
 * Two engines, in this order:
 *
 *  1. LOCAL — answers grounded in the client's own measurements plus the
 *     knowledge base. Deterministic, instant, works offline, no key needed.
 *     This handles "how am I doing", "what should I work on", "what does my
 *     posture score mean" and every topic in the KB.
 *
 *  2. CLAUDE (optional) — for open-ended questions the KB does not cover.
 *     Requires the user to supply their own API key, which is stored only in
 *     this browser and sent only to Anthropic. Off by default.
 *
 * Even with Claude enabled, the client's own data is summarised into the
 * prompt by the same local code, so answers stay grounded in real numbers.
 */

import { loadKnowledge, search } from './knowledge.js';
import { programSummary } from '../program/engine.js';
import { MEASURES } from '../posture/analyze.js';

const KEY_STORE = 'krysaril.assistantKey';
const MODEL = 'claude-sonnet-4-5';

/* ---------------------------------------------------------- key handling */

export function getApiKey() {
  try { return localStorage.getItem(KEY_STORE) || null; } catch { return null; }
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORE, key.trim());
    else localStorage.removeItem(KEY_STORE);
  } catch { /* private mode */ }
}

export function hasApiKey() { return !!getApiKey(); }

/* ------------------------------------------------------- data grounding */

/**
 * Compresses everything measured about a client into a short factual brief.
 * Used both to answer locally and as context for Claude.
 */
export function buildContext({ client, posture, body, sessions = [], skin, vitals, labs, program } = {}) {
  const lines = [];

  if (client?.name) lines.push(`Client: ${client.name}${client.heightCm ? `, ${client.heightCm} cm` : ''}.`);

  if (posture?.measures) {
    const flagged = Object.values(posture.measures).filter((m) => m.level !== 'good');
    const when = relDays(posture.createdAt);
    lines.push(flagged.length
      ? `Posture (${posture.view} view, ${when}): overall ${posture.overall}. Outside range: ${flagged.map((m) => `${m.label} ${m.value}${m.unit}`).join(', ')}.`
      : `Posture (${posture.view} view, ${when}): overall ${posture.overall}, everything within range.`);
  }

  if (body?.measurement) {
    const r = body.measurement.ratios || {};
    const parts = [];
    if (r.waistToHeight) parts.push(`waist-to-height ${r.waistToHeight.toFixed(2)}`);
    if (r.waistToHip) parts.push(`waist-to-hip ${r.waistToHip.toFixed(2)}`);
    const changed = Object.values(body.comparison?.levels || {})
      .filter((l) => l.deltaCm !== null && Math.abs(l.deltaCm) >= 0.5)
      .map((l) => `${l.label.toLowerCase()} ${l.deltaCm > 0 ? '+' : ''}${l.deltaCm} cm`);
    lines.push(`Body (${relDays(body.createdAt)}): ${parts.join(', ') || 'measured'}${changed.length ? `. Changed since last: ${changed.join(', ')}` : ''}.`);
  }

  if (sessions.length) {
    const last = sessions[0];
    lines.push(`Last training session (${relDays(last.startedAt)}): ${last.exercises?.join(', ') || 'session'}, ${last.totalReps || 0} reps, average form ${last.avgScore ?? '—'}%.`);
    const weak = weakestChecks(sessions.slice(0, 5));
    if (weak.length) lines.push(`Recurring form flags: ${weak.join('; ')}.`);
  }

  if (vitals) {
    lines.push(`Recovery (${relDays(vitals.createdAt)}): heart rate ${vitals.bpm} bpm${vitals.rmssd ? `, HRV ${vitals.rmssd} ms` : ''}${vitals.readiness ? `, readiness ${vitals.readiness}` : ''}.`);
  }

  if (skin?.metrics) {
    const weakest = Object.entries(skin.metrics)
      .filter(([, v]) => typeof v.score === 'number')
      .sort((a, b) => a[1].score - b[1].score)[0];
    lines.push(`Skin (${relDays(skin.createdAt)}): overall ${skin.overall}${weakest ? `, lowest area ${weakest[1].label || weakest[0]} at ${weakest[1].score}` : ''}.`);
  }

  if (labs?.panel) {
    const out = labs.panel.outOfRange || [];
    lines.push(`Bloods (${relDays(labs.createdAt)}): ${labs.panel.measured} markers entered, ${out.length} outside reference range${out.length ? ` (${out.map((r) => r.label).join(', ')})` : ''}${labs.panel.seekCare ? '. SOME VALUES FLAGGED FOR PROMPT CLINICAL REVIEW.' : ''}.`);
  }

  if (program) lines.push(`Current program: ${programSummary(program)}`);

  return lines;
}

function weakestChecks(sessions) {
  const map = new Map();
  for (const s of sessions) {
    for (const set of s.sets || []) {
      for (const c of set.checks || []) {
        if (c.worst === 'good') continue;
        const key = `${set.exerciseName} — ${c.label}`;
        map.set(key, (map.get(key) || 0) + 1);
      }
    }
  }
  return [...map.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])
    .slice(0, 3).map(([k, n]) => `${k} (${n} sets)`);
}

function relDays(ts) {
  if (!ts) return 'recently';
  const d = Math.round((Date.now() - ts) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return `${Math.round(d / 30)} months ago`;
}

/* --------------------------------------------------------- local answers */

/**
 * Questions about the user's own data, answered from the records directly.
 * Returns null when the question is not one of these.
 */
function answerFromData(question, data) {
  const q = question.toLowerCase();
  const has = (...words) => words.some((w) => q.includes(w));

  if (has('how am i', 'how are we', 'how is my progress', 'progress', 'summary', 'overview', 'doing')) {
    const ctx = buildContext(data);
    if (!ctx.length) return { text: 'Nothing measured yet. Run a posture assessment or a body scan and I will have something to work with.', sources: [] };
    return {
      text: `Here is where you stand.\n\n${ctx.map((l) => `• ${l}`).join('\n')}`,
      sources: [],
    };
  }

  if (has('what should i', 'what do i work on', 'priority', 'priorities', 'focus on', 'next')) {
    const p = data.program;
    if (!p?.priorities?.length) {
      return { text: 'No priorities identified yet — I need at least a posture assessment or a few training sessions to see a pattern. Generate a program once you have one.', sources: [] };
    }
    const lines = p.priorities.map((x, i) => `${i + 1}. ${x.title} — ${x.detail}`);
    const blocks = p.short.blocks.slice(0, 3).map((b) => `• ${b.title} (${b.frequency})`);
    return {
      text: `Your top priorities right now:\n\n${lines.join('\n')}\n\nThe 4-week block addresses them with:\n${blocks.join('\n')}`,
      sources: [],
    };
  }

  if (has('readiness', 'should i train', 'train today', 'recovered', 'rest today')) {
    const v = data.vitals;
    if (!v) return { text: 'No recovery reading yet. Run a Recovery scan first thing tomorrow and I can answer that properly.', sources: [] };
    if (v.readiness === null || v.readiness === undefined) {
      return { text: `Latest reading: ${v.bpm} bpm${v.rmssd ? `, HRV ${v.rmssd} ms` : ''}. I need at least three morning readings before I can score that against your own baseline — absolute HRV numbers mean very little between people.`, sources: [] };
    }
    return {
      text: `Readiness ${v.readiness} from this morning (${v.bpm} bpm${v.rmssd ? `, HRV ${v.rmssd} ms` : ''}). ${v.readinessText || ''}`,
      sources: [],
    };
  }

  if (has('posture')) {
    const p = data.posture;
    if (!p?.measures) return null;
    const flagged = Object.values(p.measures).filter((m) => m.level !== 'good');
    if (!flagged.length) {
      return { text: `Your last ${p.view}-view assessment scored ${p.overall} with every measure inside its reference range. Re-scan in four weeks to catch any drift.`, sources: [] };
    }
    const detail = flagged.map((m) => {
      const spec = MEASURES[m.id];
      return `• ${m.label}: ${m.value}${m.unit} (range ${spec ? `${spec.ideal[0]}–${spec.ideal[1]}${spec.unit}` : '—'}) — ${m.note}`;
    });
    return {
      text: `Last ${p.view}-view assessment scored ${p.overall}. Outside range:\n\n${detail.join('\n')}`,
      sources: [],
    };
  }

  if (has('blood', 'labs', 'my results', 'panel') && data.labs?.panel) {
    const panel = data.labs.panel;
    if (panel.seekCare) {
      return {
        text: 'Some of your values are well outside the usual range, and I am not the right tool to interpret readings at that level. Please contact your doctor promptly and show them the report. I have withheld lifestyle tips for those markers deliberately — they need a clinician, not an app.',
        sources: [],
      };
    }
    const out = panel.outOfRange || [];
    if (!out.length) return { text: `All ${panel.measured} markers you entered sit inside their reference ranges. Remember one in twenty healthy readings falls outside by chance, so a clean panel and a single flag both mean less than the trend across repeat tests.`, sources: [] };
    return {
      text: `${out.length} of ${panel.measured} markers are outside range: ${out.map((r) => `${r.label} ${r.value} ${r.unit}`).join(', ')}. Open the Labs report for the lifestyle context on each. Your doctor interprets the panel as a whole — I only compare each value to its range.`,
      sources: [],
    };
  }

  return null;
}

/* --------------------------------------------------------------- answer */

/**
 * @returns {Promise<{text: string, sources: Array, engine: 'data'|'kb'|'claude'|'none'}>}
 */
export async function ask(question, data = {}, { allowRemote = true } = {}) {
  const trimmed = String(question || '').trim();
  if (!trimmed) return { text: 'Ask me anything about your training, your scans or your results.', sources: [], engine: 'none' };

  // 1. The user's own numbers first — always more useful than general advice.
  const fromData = answerFromData(trimmed, data);
  if (fromData) return { ...fromData, engine: 'data' };

  // 2. Knowledge base.
  const kb = await loadKnowledge();
  const hits = search(kb.entries, trimmed);
  if (hits.length) {
    const best = hits[0].entry;
    let text = best.answer;
    if (best.protocol?.length) {
      text += `\n\nPractically:\n${best.protocol.map((p) => `• ${p}`).join('\n')}`;
    }
    const related = hits.slice(1).map((h) => h.entry.topic);
    if (related.length) text += `\n\nRelated: ${related.join(' · ')}`;
    return { text, sources: hits.map((h) => h.entry.topic), engine: 'kb' };
  }

  // 3. Claude, only if the user has supplied a key.
  if (allowRemote && hasApiKey()) {
    try {
      const text = await askClaude(trimmed, data, kb);
      return { text, sources: ['Claude'], engine: 'claude' };
    } catch (err) {
      return {
        text: `I could not reach Claude just now (${err.message}). I can still answer anything in my built-in knowledge base — try asking about posture, recovery, HRV, body composition, blood work, programming or skin.`,
        sources: [], engine: 'none',
      };
    }
  }

  return {
    text: 'That one is outside my built-in knowledge base. I can answer on posture, movement, body composition, recovery and HRV, speed work, skin, blood-work basics and programming.\n\nFor open-ended questions, you can connect Claude in Settings — you supply your own API key and it stays on this device.',
    sources: [], engine: 'none',
  };
}

/* --------------------------------------------------------------- Claude */

const SYSTEM = `You are the coaching assistant inside Krysaril, an on-device movement, posture, body-composition and wellness app used by personal trainers and their clients.

Answer in British English, plainly and concisely — a few short paragraphs at most. You are talking to someone mid-session, often on a phone.

Ground every answer in the client data you are given. Quote their actual numbers when they are relevant. If the data does not cover what they asked, say so rather than inventing a plausible figure.

Hard limits:
- Never diagnose a medical condition, and never interpret blood work as a whole. Comparing one value to a reference range is fine; concluding what it means is not.
- Never advise on medication, and never give supplement doses.
- If someone describes pain, numbness, dizziness, chest symptoms, or anything acute, say clearly that it needs a clinician and do not work around it.
- Do not claim a measurement is more precise than it is. Camera-derived posture, body and speed figures are relative estimates, useful for tracking change.`;

async function askClaude(question, data, kb) {
  const key = getApiKey();
  if (!key) throw new Error('no key');

  const context = buildContext(data);
  const topics = kb.entries.slice(0, 24).map((e) => e.topic).join(', ');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // Required for browser-originated calls; the key never leaves this device
      // except to Anthropic.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Client data:\n${context.length ? context.join('\n') : '(nothing measured yet)'}\n\n`
          + `Topics the app already covers offline: ${topics}\n\n`
          + `Question: ${question}`,
      }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(res.status === 401 ? 'the API key was rejected' : `HTTP ${res.status}${detail ? ` — ${detail.slice(0, 120)}` : ''}`);
  }
  const json = await res.json();
  const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  return text || 'Claude returned an empty response.';
}

export const ASSISTANT_DISCLAIMER =
  'The coach answers from your own measurements and a curated knowledge base. It is not a clinician: it will not diagnose, interpret blood work as a whole, or advise on medication. Anything acute — pain, dizziness, chest symptoms — needs a doctor, not an app.';

export { MODEL };
