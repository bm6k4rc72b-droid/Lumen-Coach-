import { el, icon, fmtDate, confirmSheet, toast } from '../ui.js';
import { getLabs, deleteLabs, saveLabs, listLabs } from '../store.js';
import {
  MARKERS, labsGuidance, clinicalReferrals, LABS_DISCLAIMER, URGENT_BANNER,
} from '../labs/panel.js';
import { navigate, back } from '../router.js';

export async function render({ params }) {
  const rec = await getLabs(params.id);
  if (!rec) {
    return {
      title: 'Not found',
      back: '/labs',
      node: el('div.empty', null,
        el('h3', 'This panel no longer exists'),
        el('a.btn.btn-primary', { href: '#/labs' }, 'Back to labs')),
    };
  }

  const panel = rec.panel;
  const siblings = await listLabs(rec.clientId ?? null);
  const idx = siblings.findIndex((s) => s.id === rec.id);
  const previous = idx >= 0 ? siblings[idx + 1] : null;

  const node = el('div');

  /* -------------------------------------------- urgent banner first */
  if (panel.seekCare) {
    node.append(el('div.card', {
      style: {
        borderColor: 'rgba(217,122,114,.55)',
        background: 'linear-gradient(180deg, rgba(217,122,114,.14), transparent)',
      },
    },
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' } },
        el('span', { style: { fontSize: '20px' } }, '⚠︎'),
        el('div', { style: { fontWeight: '700', color: 'var(--bad)', fontSize: '15px' } }, 'Contact a doctor'),
      ),
      el('p.small', { style: { margin: 0, lineHeight: '1.7', color: 'var(--text-dim)' } }, URGENT_BANNER),
      el('div.mt-12', ...panel.urgent.map((r) => el('div', {
        style: { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--hairline)' },
      },
        el('span.small', { style: { fontWeight: '620' } }, r.label),
        el('span', { style: { fontFamily: 'var(--num)', fontWeight: '700', color: 'var(--bad)' } },
          `${r.value} ${r.unit}`),
      ))),
    ));
  }

  /* ----------------------------------------------------- headline */
  node.append(el(`div.card${panel.seekCare ? '.mt-12' : ''}`, { style: { textAlign: 'center' } },
    el('div', { style: { display: 'flex', justifyContent: 'center', gap: '26px', padding: '6px 0 2px' } },
      tally(panel.inRange.length, 'In range', 'good'),
      tally(panel.outOfRange.length, 'Outside', panel.outOfRange.length ? 'warn' : 'neutral'),
      tally(panel.urgent.length, 'Flagged', panel.urgent.length ? 'bad' : 'neutral'),
    ),
    el('p.small.muted', { style: { margin: '14px 0 0', lineHeight: '1.65' } },
      panel.outOfRange.length || panel.urgent.length
        ? 'One marker outside range on a panel this size is common — roughly one healthy reading in twenty falls outside by chance. The pattern and the trend matter more than any single value.'
        : `All ${panel.measured} markers you entered sit inside their reference ranges.`),
  ));

  /* ------------------------------------------------------ results */
  const card = el('div.card');
  for (const r of panel.results) {
    const marker = MARKERS[r.id];
    const prev = previous?.values?.[r.id];
    const delta = typeof prev === 'number' ? Math.round((r.value - prev) * 100) / 100 : null;
    card.append(el('div.metric', null,
      el('div.metric-top', null,
        el('span.metric-name', r.label),
        el('span', { style: { display: 'flex', alignItems: 'baseline', gap: '9px' } },
          delta !== null && delta !== 0
            ? el('span.tiny.muted', `${delta > 0 ? '+' : ''}${delta}`) : null,
          el('span.metric-val', { style: { color: `var(--${r.level})` } }, `${r.value} ${r.unit}`),
        ),
      ),
      rangeBar(r),
      el('div.metric-note', r.text),
      marker ? el('div.tiny.muted', { style: { marginTop: '6px', opacity: .85 } },
        `Reference ${r.range[0]}–${r.range[1]} ${r.unit} · ${marker.about}`) : null,
    ));
  }
  node.append(el('div.section-head.mt-24', el('h2', 'Markers')), card);

  /* ---------------------------------------------- clinical referrals */
  const referrals = clinicalReferrals(panel);
  if (referrals.length) {
    node.append(el('div.section-head.mt-24', el('h2', 'For your doctor')));
    node.append(el('div.card', null,
      el('p.small.dim', { style: { margin: '0 0 12px', lineHeight: '1.65' } },
        'These need a clinician rather than lifestyle advice. Krysaril is deliberately not offering tips on them.'),
      ...referrals.map((r) => el('div', {
        style: { display: 'flex', gap: '10px', padding: '8px 0', borderTop: '1px solid var(--hairline)' },
      },
        el('span.small', { style: { fontWeight: '620', flex: 'none' } }, r.label),
        el('span.tiny.muted', { style: { flex: 1, textAlign: 'right' } }, r.reason),
      )),
    ));
  }

  /* --------------------------------------------------- lifestyle tips */
  const guidance = labsGuidance(panel);
  if (guidance.length) {
    node.append(el('div.section-head.mt-24', el('h2', 'Lifestyle levers')));
    for (const g of guidance) {
      node.append(el('div.card', { style: { marginBottom: '10px' } },
        el('div.spread', null,
          el('div', { style: { fontWeight: '650' } }, g.title),
          el(`span.pill.${g.direction === 'low' ? 'warn' : 'warn'}`, g.direction === 'low' ? 'Below range' : 'Above range'),
        ),
        el('ul.tips', { style: { margin: '11px 0 0', paddingLeft: '20px' } },
          ...g.items.map((i) => el('li', i))),
      ));
    }
  }

  /* ---------------------------------------------------------- notes */
  const notes = el('textarea.textarea', {
    placeholder: 'Lab name, fasted or not, medications, how you felt…',
  }, rec.notes || '');
  let t = null;
  notes.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      await saveLabs({ ...rec, notes: notes.value });
      toast('Notes saved', 'good', 1400);
    }, 900);
  });
  node.append(el('div.section', null, el('div.section-head', el('h2', 'Notes')), notes));

  node.append(el('div.disclaimer.mt-16', icon('info'), el('span', LABS_DISCLAIMER)));

  node.append(el('div.btn-row.mt-16', null,
    el('button.btn', { onclick: () => navigate('/labs') }, icon('plus'), 'New panel'),
    el('button.btn.btn-danger', {
      onclick: async () => {
        if (!await confirmSheet({ title: 'Delete this panel?', confirmText: 'Delete', danger: true })) return;
        await deleteLabs(rec.id);
        toast('Panel deleted');
        back('/labs');
      },
    }, icon('trash'), 'Delete'),
  ));

  return {
    title: 'Blood work',
    subtitle: `${fmtDate(rec.createdAt)}${rec.clientName ? ` · ${rec.clientName}` : ''}`,
    back: () => back('/coach'),
    node,
  };
}

function tally(n, label, level) {
  return el('div', null,
    el('div', {
      style: {
        fontFamily: 'var(--num)', fontSize: '30px', fontWeight: '800', lineHeight: '1',
        color: level === 'neutral' ? 'var(--text-faint)' : `var(--${level})`,
      },
    }, n),
    el('div.stat-lab', { style: { marginTop: '6px' } }, label),
  );
}

/** Shows where the value sits inside (or outside) its reference range. */
function rangeBar(r) {
  const [lo, hi] = r.range;
  const span = hi - lo || 1;
  // Draw the reference band across the middle 70% so out-of-range still shows.
  const pct = 15 + ((r.value - lo) / span) * 70;
  const bar = el('div.dev', el('div.ideal', {
    style: { left: '15%', right: '15%' },
  }));
  bar.append(el('div.mark', {
    style: { left: `${Math.max(2, Math.min(98, pct))}%`, background: `var(--${r.level})` },
  }));
  return bar;
}
