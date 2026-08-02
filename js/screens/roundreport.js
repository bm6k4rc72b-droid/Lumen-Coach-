import { el, icon, fmtDate, fmtDuration, confirmSheet, toast } from '../ui.js';
import { getRound, deleteRound, saveRound } from '../store.js';
import { SPEED_MODES, SPEED_DISCLAIMER } from '../speed/analyzer.js';
import { navigate, back } from '../router.js';

export async function render({ params }) {
  const rec = await getRound(params.id);
  if (!rec) {
    return {
      title: 'Not found',
      back: '/history',
      node: el('div.empty', null,
        el('h3', 'This session no longer exists'),
        el('a.btn.btn-primary', { href: '#/history' }, 'Back to history')),
    };
  }

  const spec = SPEED_MODES[rec.mode] || SPEED_MODES.strike;
  const t = rec.totals || {};
  const node = el('div');

  node.append(el('div.hero', null,
    el('div.overline', { style: { marginBottom: '10px' } }, `${spec.emoji} ${spec.label}`),
    el('h2', `${rec.rounds?.length || 0} round${rec.rounds?.length === 1 ? '' : 's'}`),
    el('p', `${t.strikes || 0} ${spec.unitLabel.toLowerCase()} · ${fmtDuration(t.durationMs || 0)} of work`),
  ));

  node.append(el('div.section', null,
    el('div.stat-grid', null,
      el('div.stat', el('div.stat-val', t.strikes || 0), el('div.stat-lab', spec.unitLabel)),
      el('div.stat', el('div.stat-val', (t.peakSpeed || 0).toFixed(1)), el('div.stat-lab', 'Peak m/s')),
      el('div.stat', el('div.stat-val', t.avgOutput || 0), el('div.stat-lab', 'Avg output')),
    ),
  ));

  node.append(el('div.section-head.mt-24', el('h2', 'Round by round')));
  for (const r of rec.rounds || []) {
    node.append(el('div.card', { style: { marginBottom: '10px' } },
      el('div.spread', null,
        el('div', null,
          el('div', { style: { fontWeight: '650' } }, `Round ${r.index}`),
          el('div.tiny.muted', { style: { marginTop: '3px' } },
            `${fmtDuration(r.durationMs)} · ${r.left} left / ${r.right} right`),
        ),
        el('div', { style: { textAlign: 'right' } },
          el('div', { style: { fontFamily: 'var(--num)', fontSize: '24px', fontWeight: '800' } }, r.strikes),
          el('div.tiny.muted', `${r.output}/min · peak ${r.peakSpeed}`),
        ),
      ),
    ));
  }

  const notes = el('textarea.textarea', { placeholder: 'Combinations, how it felt, what to fix…' }, rec.notes || '');
  let timer = null;
  notes.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await saveRound({ ...rec, notes: notes.value });
      toast('Notes saved', 'good', 1400);
    }, 900);
  });
  node.append(el('div.section', null, el('div.section-head', el('h2', 'Notes')), notes));

  node.append(el('div.disclaimer.mt-24', icon('info'), el('span', SPEED_DISCLAIMER)));

  node.append(el('div.btn-row.mt-16', null,
    el('button.btn', { onclick: () => navigate(`/speed?mode=${rec.mode}`) }, icon('play'), 'New session'),
    el('button.btn.btn-danger', {
      onclick: async () => {
        if (!await confirmSheet({ title: 'Delete this session?', confirmText: 'Delete', danger: true })) return;
        await deleteRound(rec.id);
        toast('Session deleted');
        back('/history');
      },
    }, icon('trash'), 'Delete'),
  ));

  return {
    title: spec.label,
    subtitle: `${fmtDate(rec.createdAt)}${rec.clientName ? ` · ${rec.clientName}` : ''}`,
    back: () => back('/history'),
    node,
  };
}
