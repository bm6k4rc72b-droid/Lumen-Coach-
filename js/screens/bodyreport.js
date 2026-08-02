import { el, icon, fmtDate, confirmSheet, toast } from '../ui.js';
import { getBodyScan, deleteBodyScan, saveBodyScan, listBodyScans } from '../store.js';
import { waistToHeightBand, BODY_DISCLAIMER } from '../body/silhouette.js';
import { navigate, back } from '../router.js';

export async function render({ params }) {
  const rec = await getBodyScan(params.id);
  if (!rec) {
    return {
      title: 'Not found',
      back: '/scan',
      node: el('div.empty', null,
        el('h3', 'This scan no longer exists'),
        el('a.btn.btn-primary', { href: '#/scan' }, 'Back to scans')),
    };
  }

  const siblings = await listBodyScans(rec.clientId ?? null);
  const node = el('div');

  if (rec.map) {
    node.append(el('div.card', { style: { padding: '12px' } },
      el('img', { src: rec.map, alt: 'Body silhouette map', style: { width: '100%', display: 'block', borderRadius: '14px' } }),
      rec.comparison?.levels
        ? el('div.heat-legend', el('span', 'Slimmer'), el('span.ramp'), el('span', 'Fuller'))
        : null,
    ));
  }

  const r = rec.measurement?.ratios || {};
  const band = waistToHeightBand(r.waistToHeight);
  node.append(el('div.section-head.mt-24', el('h2', 'Key ratios')));
  node.append(el('div.card', null,
    ratio('Waist to height', r.waistToHeight, band),
    ratio('Waist to hip', r.waistToHip, null),
    ratio('Shoulder to waist', r.shoulderToWaist, null),
  ));

  const levels = Object.values(rec.comparison?.levels || {});
  if (levels.length) {
    node.append(el('div.section-head.mt-24', el('h2', 'Measurements')));
    const grid = el('div.measure-grid');
    for (const lvl of levels) {
      grid.append(el('div.measure', null,
        el('div.k', lvl.label),
        el('div.v', `${lvl.cm} cm`),
        lvl.deltaCm !== null && lvl.deltaCm !== undefined
          ? el(`div.d.${lvl.direction}`, `${lvl.deltaCm > 0 ? '+' : ''}${lvl.deltaCm} cm`)
          : el('div.d.flat', 'baseline'),
      ));
    }
    node.append(grid);
  }

  const circ = rec.measurement?.circumference || {};
  if (circ.waist) {
    node.append(el('div.section-head.mt-24', el('h2', 'Estimated circumferences')));
    node.append(el('div.card', null,
      el('p.tiny.muted', { style: { margin: '0 0 12px', lineHeight: '1.55' } },
        'Derived from silhouette width assuming an elliptical cross-section. Use a tape for anything that matters.'),
      ...Object.entries(circ).filter(([, v]) => v).map(([k, v]) => el('div', {
        style: { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--hairline)' },
      },
        el('span.small.dim', k[0].toUpperCase() + k.slice(1)),
        el('span', { style: { fontFamily: 'var(--num)', fontWeight: '650' } }, `≈ ${v} cm`),
      )),
    ));
  }

  const notes = el('textarea.textarea', { placeholder: 'Weight, training block, how you felt…' }, rec.notes || '');
  let t = null;
  notes.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      await saveBodyScan({ ...rec, notes: notes.value });
      toast('Notes saved', 'good', 1400);
    }, 900);
  });
  node.append(el('div.section', null, el('div.section-head', el('h2', 'Notes')), notes));

  if (siblings.length > 1) {
    node.append(el('div.section', null,
      el('div.section-head', el('h2', 'Progress')),
      el('div.thumb-strip', null, ...siblings.slice(0, 14).map((s) => el('button.thumb', {
        onclick: () => navigate(`/bodyscan/${s.id}`),
        style: s.id === rec.id ? { borderColor: 'var(--gold-line)' } : null,
      },
        s.thumb ? el('img', { src: s.thumb, alt: '' })
          : el('div', { style: { height: '96px', display: 'grid', placeItems: 'center' } }, '—'),
        el('div.cap', new Date(s.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })),
      ))),
    ));
  }

  node.append(el('div.disclaimer.mt-24', icon('info'), el('span', BODY_DISCLAIMER)));

  node.append(el('div.btn-row.mt-16', null,
    el('button.btn', { onclick: () => navigate('/body') }, icon('camera'), 'New scan'),
    el('button.btn.btn-danger', {
      onclick: async () => {
        if (!await confirmSheet({ title: 'Delete this scan?', confirmText: 'Delete', danger: true })) return;
        await deleteBodyScan(rec.id);
        toast('Scan deleted');
        back('/scan');
      },
    }, icon('trash'), 'Delete'),
  ));

  return {
    title: 'Body composition',
    subtitle: `${fmtDate(rec.createdAt)}${rec.clientName ? ` · ${rec.clientName}` : ''}`,
    back: () => back('/scan'),
    node,
  };
}

function ratio(label, value, band) {
  return el('div.metric', null,
    el('div.metric-top', null,
      el('span.metric-name', label),
      el('span', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        band ? el(`span.pill.${band.level}`, band.label) : null,
        el('span.metric-val', value === null || value === undefined ? '—' : Number(value).toFixed(2)),
      ),
    ),
  );
}
