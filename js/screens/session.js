import { el, icon, ring, fmtDate, fmtDuration, scoreClass, confirmSheet, toast } from '../ui.js';
import { getSession, deleteSession, saveSession } from '../store.js';
import { HUD_LABELS } from '../pose/exercises.js';
import { back, navigate } from '../router.js';

export async function render({ params }) {
  const session = await getSession(params.id);
  if (!session) {
    return {
      title: 'Session not found',
      back: '/history',
      node: el('div.empty', null, el('h3', 'This session no longer exists'), el('a.btn.btn-primary', { href: '#/history' }, 'Back to history')),
    };
  }

  const node = el('div');

  node.append(el('div.card', { style: { display: 'flex', gap: '16px', alignItems: 'center' } },
    ring(session.avgScore ?? null, { size: 84, stroke: 8, label: 'FORM' }),
    el('div', { style: { flex: 1 } },
      el('div', { style: { fontWeight: '680', fontSize: '17px' } },
        session.exercises?.length ? session.exercises.join(', ') : 'Training session'),
      el('div.small.muted', { style: { marginTop: '4px', lineHeight: '1.5' } },
        `${session.sets?.length || 0} sets · ${session.totalReps || 0} reps`,
        session.durationMs ? ` · ${fmtDuration(session.durationMs)}` : '',
      ),
      session.clientName
        ? el('a.small', { href: `#/client/${session.clientId}`, style: { color: 'var(--rose)', display: 'inline-block', marginTop: '6px' } }, session.clientName)
        : el('div.tiny.muted.mt-8', 'Unassigned session'),
    ),
  ));

  /* --------------------------------------------------------------- sets */
  node.append(el('div.section-head.mt-24', el('h2', 'Sets')));
  for (const set of session.sets || []) {
    node.append(setCard(set));
  }
  if (!session.sets?.length) {
    node.append(el('div.empty', el('p', 'No sets were recorded in this session.')));
  }

  /* -------------------------------------------------------------- notes */
  const notes = el('textarea.textarea', { placeholder: 'Session notes, programming, how it felt…' }, session.notes || '');
  let t = null;
  notes.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      await saveSession({ ...session, notes: notes.value });
      toast('Notes saved', 'good', 1400);
    }, 900);
  });
  node.append(el('div.section', null, el('div.section-head', el('h2', 'Session notes')), notes));

  node.append(el('div.btn-row.mt-24', null,
    el('button.btn', { onclick: () => navigate('/train') }, icon('play'), 'New session'),
    el('button.btn.btn-danger', {
      onclick: async () => {
        const ok = await confirmSheet({ title: 'Delete this session?', confirmText: 'Delete', danger: true });
        if (!ok) return;
        await deleteSession(session.id);
        toast('Session deleted');
        back('/history');
      },
    }, icon('trash'), 'Delete'),
  ));

  return {
    title: session.clientName || 'Session',
    subtitle: fmtDate(session.startedAt),
    back: () => back('/history'),
    node,
  };
}

function setCard(set) {
  const card = el('div.card', { style: { marginBottom: '12px' } });

  card.append(el('div.spread', null,
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      el('span', { style: { fontSize: '22px' } }, set.emoji || '🏋️'),
      el('div', null,
        el('div', { style: { fontWeight: '660' } }, set.exerciseName),
        el('div.tiny.muted', { style: { marginTop: '2px' } },
          set.gait
            ? `${set.gait.steps} steps · ${set.gait.cadence ?? '—'} spm`
            : `${set.reps} reps${set.tempoMs ? ` · ${(set.tempoMs / 1000).toFixed(1)}s tempo` : ''}`),
      ),
    ),
    typeof set.score === 'number' ? el(`span.pill.${scoreClass(set.score)}`, `${set.score}%`) : null,
  ));

  if (set.gait) {
    const g = set.gait;
    card.append(el('div.stat-grid.mt-12', null,
      miniStat(g.cadence ? `${g.cadence}` : '—', 'spm'),
      miniStat(g.kph ? `${g.kph}` : '—', 'km/h (est)'),
      miniStat(g.stepLength ? `${g.stepLength}` : '—', 'step (m)'),
    ));
  }

  if (set.checks?.length) {
    const list = el('div.mt-12');
    for (const c of set.checks) {
      list.append(el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderTop: '1px solid var(--line-soft)' },
      },
        el('span.small.dim', { style: { flex: 1 } }, c.label),
        c.avg !== null && c.avg !== undefined
          ? el('span.tiny.muted', `avg ${c.avg}${c.unit || ''}`) : null,
        el(`span.pill.${c.worst}`, `${c.goodPct}%`),
      ));
    }
    card.append(list);
  }

  // Per-rep angle ranges — the detail a trainer actually reviews later.
  const angleRep = set.repDetail?.find((r) => r.angles && Object.keys(r.angles).length);
  if (angleRep) {
    const keys = Object.keys(angleRep.angles).slice(0, 6);
    const ranges = keys.map((k) => {
      const mins = set.repDetail.map((r) => r.angles?.[k]?.min).filter((v) => typeof v === 'number');
      const maxs = set.repDetail.map((r) => r.angles?.[k]?.max).filter((v) => typeof v === 'number');
      if (!mins.length || !maxs.length) return null;
      return el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '13px' } },
        el('span.muted', HUD_LABELS[k] || k),
        el('span', { style: { fontFamily: 'var(--font-num)', fontWeight: '650' } },
          `${Math.round(Math.min(...mins))}° – ${Math.round(Math.max(...maxs))}°`),
      );
    }).filter(Boolean);
    if (ranges.length) {
      card.append(el('details', { style: { marginTop: '10px' } },
        el('summary', { style: { fontSize: '13px', color: 'var(--rose)', cursor: 'pointer', padding: '4px 0' } }, 'Joint angle ranges'),
        el('div', { style: { marginTop: '6px' } }, ...ranges),
      ));
    }
  }

  if (set.notes) {
    card.append(el('p.small.muted', { style: { margin: '10px 0 0', lineHeight: '1.5', whiteSpace: 'pre-wrap' } }, set.notes));
  }

  return card;
}

function miniStat(value, label) {
  return el('div.stat', null, el('div.stat-val', { style: { fontSize: '19px' } }, value), el('div.stat-lab', label));
}
