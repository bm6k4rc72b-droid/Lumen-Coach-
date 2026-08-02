import { el, icon, ring, fmtDate, confirmSheet, toast, scoreClass } from '../ui.js';
import { getPosture, deletePosture, savePosture, listPostures } from '../store.js';
import { MEASURES, POSTURE_DISCLAIMER } from '../posture/analyze.js';
import { navigate, back } from '../router.js';

export async function render({ params }) {
  const rec = await getPosture(params.id);
  if (!rec) {
    return {
      title: 'Not found',
      back: '/scan',
      node: el('div.empty', null,
        el('h3', 'This assessment no longer exists'),
        el('a.btn.btn-primary', { href: '#/scan' }, 'Back to scans')),
    };
  }

  const siblings = (await listPostures(rec.clientId ?? null)).filter((s) => s.view === rec.view);
  const idx = siblings.findIndex((s) => s.id === rec.id);
  const previous = idx >= 0 ? siblings[idx + 1] : null;
  const delta = previous && typeof previous.overall === 'number' && typeof rec.overall === 'number'
    ? rec.overall - previous.overall : null;

  const node = el('div');

  if (rec.chart) {
    node.append(el('div.card', { style: { padding: '10px' } },
      el('img', { src: rec.chart, alt: 'Annotated posture chart', style: { width: '100%', display: 'block', borderRadius: '14px' } })));
  }

  node.append(el('div.card.card-gold.mt-12', { style: { textAlign: 'center' } },
    el('div.big-score', ring(rec.overall, { size: 128, label: 'ALIGNMENT' })),
    el('div.tiny.muted', { style: { marginTop: '8px' } },
      `${rec.view === 'side' ? 'Side view' : 'Front view'} · ${fmtDate(rec.createdAt)}`),
    delta !== null
      ? el('div.mt-12', el(`span.pill.${delta >= 0 ? 'good' : 'warn'}`,
        `${delta >= 0 ? '+' : ''}${delta} since ${fmtDate(previous.createdAt)}`))
      : null,
  ));

  /* ------------------------------------------------------- measurements */
  const card = el('div.card');
  for (const m of Object.values(rec.measures || {})) {
    const spec = MEASURES[m.id];
    const prev = previous?.measures?.[m.id];
    const change = prev && typeof prev.value === 'number'
      ? Math.round((m.value - prev.value) * 10) / 10 : null;
    card.append(el('div.metric', null,
      el('div.metric-top', null,
        el('span.metric-name', m.label),
        el('span', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
          change !== null && Math.abs(change) >= 0.5
            ? el('span.tiny.muted', `${change > 0 ? '+' : ''}${change}${m.unit}`)
            : null,
          el('span.metric-val', { style: { color: `var(--${m.level})` } }, `${m.value}${m.unit}`),
        ),
      ),
      el('div.bar', el('i', { style: { width: `${m.score}%`, background: `var(--${m.level})` } })),
      el('div.metric-note', m.note),
      spec ? el('div.tiny.muted', { style: { marginTop: '6px', opacity: .8 } },
        `Reference range ${spec.ideal[0]}–${spec.ideal[1]}${spec.unit}`) : null,
    ));
  }
  node.append(el('div.section-head.mt-24', el('h2', 'Measurements')), card);

  /* -------------------------------------------------------------- notes */
  const notes = el('textarea.textarea', { placeholder: 'Footwear, symptoms, what you worked on…' }, rec.notes || '');
  let t = null;
  notes.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      await savePosture({ ...rec, notes: notes.value });
      toast('Notes saved', 'good', 1400);
    }, 900);
  });
  node.append(el('div.section', null, el('div.section-head', el('h2', 'Notes')), notes));

  /* ------------------------------------------------------------ history */
  if (siblings.length > 1) {
    node.append(el('div.section', null,
      el('div.section-head', el('h2', `${rec.view === 'side' ? 'Side' : 'Front'} view over time`)),
      el('div.thumb-strip', null, ...siblings.slice(0, 14).map((s) => el('button.thumb', {
        onclick: () => navigate(`/posture/${s.id}`),
        style: s.id === rec.id ? { borderColor: 'var(--gold-line)' } : null,
      },
        s.thumb ? el('img', { src: s.thumb, alt: '' })
          : el('div', { style: { height: '96px', display: 'grid', placeItems: 'center' } }, '—'),
        el('div.cap', { style: { color: `var(--${scoreClass(s.overall)})`, fontWeight: '700' } }, s.overall ?? '—'),
      ))),
    ));
  }

  node.append(el('div.disclaimer.mt-24', icon('info'), el('span', POSTURE_DISCLAIMER)));

  node.append(el('div.btn-row.mt-16', null,
    el('button.btn', { onclick: () => navigate('/posture') }, icon('camera'), 'New scan'),
    el('button.btn.btn-danger', {
      onclick: async () => {
        if (!await confirmSheet({ title: 'Delete this assessment?', confirmText: 'Delete', danger: true })) return;
        await deletePosture(rec.id);
        toast('Assessment deleted');
        back('/scan');
      },
    }, icon('trash'), 'Delete'),
  ));

  return {
    title: 'Posture',
    subtitle: `${fmtDate(rec.createdAt)}${rec.clientName ? ` · ${rec.clientName}` : ''}`,
    back: () => back('/scan'),
    node,
  };
}
