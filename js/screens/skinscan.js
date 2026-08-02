import { el, icon, ring, bar, fmtDate, confirmSheet, toast, scoreClass } from '../ui.js';
import { getScan, deleteScan, listScans, saveScan } from '../store.js';
import { metricCopy, levelOf, suggestions, headline, subhead, balanceLabel, trend, DISCLAIMER } from '../skin/guidance.js';
import { navigate, back } from '../router.js';

export async function render({ params }) {
  const scan = await getScan(params.id);
  if (!scan) {
    return {
      title: 'Scan not found',
      back: '/history',
      node: el('div.empty', null, el('h3', 'This scan no longer exists'), el('a.btn.btn-primary', { href: '#/scan' }, 'Back to scans')),
    };
  }

  const siblings = await listScans(scan.clientId ?? null);
  const idx = siblings.findIndex((s) => s.id === scan.id);
  const previous = idx >= 0 ? siblings[idx + 1] : null;
  const change = previous ? trend({ overall: scan.overall }, { overall: previous.overall }) : null;

  const node = el('div');

  node.append(el('div.card', { style: { textAlign: 'center' } },
    el('div.big-score', ring(scan.overall, { size: 132, label: 'WELLNESS' })),
    el('h2', { style: { fontSize: '18px', marginTop: '10px', lineHeight: '1.3' } }, headline(scan.overall)),
    el('p.small.muted', { style: { margin: '8px 0 0', lineHeight: '1.55' } }, subhead(scan.overall)),
    change ? el('div.mt-12', el(`span.pill.${change.level === 'good' ? 'good' : change.level === 'warn' ? 'warn' : 'neutral'}`, change.text)) : null,
    scan.thumb ? el('img', {
      src: scan.thumb, alt: '',
      style: { width: '110px', height: '110px', objectFit: 'cover', borderRadius: '20px', marginTop: '14px', border: '1px solid var(--line)' },
    }) : null,
  ));

  const metricsCard = el('div.card');
  for (const [key, m] of Object.entries(scan.metrics || {})) {
    if (m.score === null || m.score === undefined) continue;
    const copy = metricCopy(key, m.score);
    const level = levelOf(m.score);
    metricsCard.append(el('div.metric', null,
      el('div.metric-top', null,
        el('span.metric-name', copy.title),
        el('span.metric-val', { style: { color: `var(--${level === 'neutral' ? 'text-faint' : level})` } },
          key === 'balance' ? balanceLabel(scan.balance) : `${m.score}`),
      ),
      bar(m.score, `var(--${level === 'neutral' ? 'text-faint' : level})`),
      el('div.metric-note', copy.note),
    ));
  }
  node.append(el('div.section', null, el('div.section-head', el('h2', 'What we noticed')), metricsCard));

  const tips = suggestions({ metrics: scan.metrics || {}, balance: scan.balance });
  node.append(
    el('div.section-head.mt-24', el('h2', 'Gentle suggestions')),
    el('div.card', el('ul.tips', { style: { margin: 0, paddingLeft: '20px' } },
      ...tips.map((t) => el('li', el('strong', t.title), ' — ', t.body)))),
  );

  /* ------------------------------------------------------------- notes */
  const notes = el('textarea.textarea', { placeholder: 'How did your skin feel? Products, cycle, sleep…' }, scan.notes || '');
  let saveTimer = null;
  notes.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await saveScan({ ...scan, notes: notes.value });
      toast('Notes saved', 'good', 1400);
    }, 900);
  });
  node.append(el('div.section', null, el('div.section-head', el('h2', 'Notes')), notes));

  /* ------------------------------------------------------------ history */
  if (siblings.length > 1) {
    node.append(el('div.section', null,
      el('div.section-head', el('h2', 'Progress')),
      el('div.thumb-strip', null, ...siblings.slice(0, 14).map((s) => el('button.thumb', {
        onclick: () => navigate(`/skinscan/${s.id}`),
        style: s.id === scan.id ? { borderColor: 'var(--rose)' } : null,
      },
        s.thumb ? el('img', { src: s.thumb, alt: '' })
          : el('div', { style: { height: '92px', display: 'grid', placeItems: 'center', fontSize: '22px' } }, '✨'),
        el('div.cap', { style: { color: `var(--${scoreClass(s.overall)})`, fontWeight: '700' } }, s.overall ?? '—'),
      ))),
    ));
  }

  node.append(el('div.disclaimer.mt-24', icon('info'), el('span', DISCLAIMER)));

  node.append(el('button.btn.btn-danger.btn-block.mt-16', {
    onclick: async () => {
      const ok = await confirmSheet({ title: 'Delete this scan?', confirmText: 'Delete', danger: true });
      if (!ok) return;
      await deleteScan(scan.id);
      toast('Scan deleted');
      back('/scan');
    },
  }, icon('trash'), 'Delete scan'));

  return {
    title: 'Skin scan',
    subtitle: `${fmtDate(scan.createdAt)}${scan.clientName ? ` · ${scan.clientName}` : ''}`,
    back: () => back('/scan'),
    node,
  };
}
