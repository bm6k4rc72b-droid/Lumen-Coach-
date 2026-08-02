/**
 * The training session currently in progress.
 *
 * Kept in memory (and mirrored to sessionStorage so an accidental reload does
 * not lose a client's sets) until the trainer ends the session.
 */

import { saveSession, uid } from './store.js';

const KEY = 'krysaril.activeSession';

let active = null;

function persist() {
  try {
    if (active) sessionStorage.setItem(KEY, JSON.stringify(active));
    else sessionStorage.removeItem(KEY);
  } catch { /* private mode — in-memory only */ }
}

function restore() {
  if (active !== null) return active;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) active = JSON.parse(raw);
  } catch { active = null; }
  return active;
}

export function getActive() { return restore(); }

export function startSession({ clientId = null, clientName = '' } = {}) {
  active = {
    id: uid('ses'),
    clientId,
    clientName,
    startedAt: Date.now(),
    endedAt: null,
    sets: [],
    notes: '',
  };
  persist();
  return active;
}

export function ensureSession(opts) {
  return restore() || startSession(opts);
}

export function addSet(set) {
  const session = ensureSession({});
  const record = {
    id: uid('set'),
    at: Date.now(),
    ...set,
  };
  session.sets.push(record);
  persist();
  return record;
}

export function removeSet(setId) {
  const session = restore();
  if (!session) return;
  session.sets = session.sets.filter((s) => s.id !== setId);
  persist();
}

export function setNotes(notes) {
  const session = restore();
  if (!session) return;
  session.notes = notes;
  persist();
}

export function setClient(clientId, clientName) {
  const session = ensureSession({});
  session.clientId = clientId;
  session.clientName = clientName;
  persist();
}

export function sessionStats(session = restore()) {
  if (!session) return { sets: 0, reps: 0, score: null, exercises: [] };
  const reps = session.sets.reduce((a, s) => a + (s.reps || 0), 0);
  const scored = session.sets.filter((s) => typeof s.score === 'number');
  const score = scored.length
    ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length)
    : null;
  const exercises = [...new Set(session.sets.map((s) => s.exerciseName))];
  return { sets: session.sets.length, reps, score, exercises };
}

/** Persists to IndexedDB and clears the in-progress session. */
export async function finishSession() {
  const session = restore();
  if (!session) return null;
  const stats = sessionStats(session);
  const record = {
    ...session,
    endedAt: Date.now(),
    durationMs: Date.now() - session.startedAt,
    totalReps: stats.reps,
    avgScore: stats.score,
    exercises: stats.exercises,
  };
  const saved = await saveSession(record);
  active = null;
  persist();
  return saved;
}

export function discardSession() {
  active = null;
  persist();
}
