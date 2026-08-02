import { el, icon, fmtDate, scoreClass, relDay } from '../ui.js';
import { listScans, listPostures, listBodyScans, getSettings, getClient } from '../store.js';
import { navigate } from '../router.js';

const SCANS = [
  {
    id: 'posture',
    title: 'Posture assessment',
    line: 'Joint angles against clinical reference ranges',
    detail: 'Forward head, shoulder position, pelvic tilt, knee and ankle alignment — measured off a plumb line and marked up like a therapist\'s chart.',
    glyph: 'M12 3.6a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zM12 7.6v6.2M8.4 10h7.2M12 13.8L9.4 20M12 13.8L14.6 20',
    route: '/posture',
  },
  {
    id: 'body',
    title: 'Body composition',
    line: 'Silhouette measurements with a change heatmap',
    detail: 'Measures your outline at eight levels, tracks waist-to-hip and waist-to-height, and shows exactly where your shape has shifted since last time.',
    glyph: 'M12 3.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM9 8.2h6l.8 5.2h-1.9L14.4 20h-1.7l-.7-5h-.2l-.7 5H9.4l.5-6.6H8.2z',
    route: '/body',
  },
  {
    id: 'skin',
    title: 'Skin wellness',
    line: 'Tone, texture, hydration and calm',
    detail: 'A close-up read of tone evenness, redness, micro-texture, pores and pigmentation, measured against your own baseline.',
    glyph: 'M12 3.6c3.5 2.6 5.8 5.2 5.8 8.5a5.8 5.8 0 0 1-11.6 0c0-3.3 2.3-5.9 5.8-8.5zM9.7 13.3a2.5 2.5 0 0 0 3.1 2.4',
    route: '/skin',
  },
];

export async function render() {
  const settings = await getSettings();
  const client = settings.activeClientId ? await getClient(settings.activeClientId) : null;

  const [skin, postures, bodies] = await Promise.all([
    listScans(null, 4), listPostures(null, 4), listBodyScans(null, 4),
  ]);
  const latest = { skin: skin[0], posture: postures[0], body: bodies[0] };

  const node = el('div');

  node.append(el('div.hero', null,
    el('div.overline', { style: { marginBottom: '10px' } }, 'Assessment'),
    el('h2', 'Three ways to read the body'),
    el('p', client
      ? `Scans save to ${client.name}. Switch client from any capture screen.`
      : 'Every scan runs on this device. Nothing is uploaded.'),
  ));

  node.append(el('div.section', null, ...SCANS.map((s) => {
    const last = latest[s.id];
    const score = last ? (last.overall ?? null) : null;
    return el('button.card', {
      onclick: () => navigate(s.route),
      style: { display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: '12px' },
    },
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
        el('div', {
          style: {
            width: '46px', height: '46px', flex: 'none', display: 'grid', placeItems: 'center',
            borderRadius: '14px', background: 'var(--gold-wash)', border: '1px solid var(--gold-line)',
          },
          html: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--gold-bright)"
                  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${s.glyph}"/></svg>`,
        }),
        el('div', { style: { flex: 1, minWidth: 0 } },
          el('div', { style: { fontSize: '16px', fontWeight: '650' } }, s.title),
          el('div.tiny.muted', { style: { marginTop: '3px' } }, s.line),
        ),
        score !== null && score !== undefined
          ? el(`span.pill.${scoreClass(score)}`, `${score}`)
          : el('span.row-chev', icon('chev')),
      ),
      el('p.small.muted', { style: { margin: '13px 0 0', lineHeight: '1.6' } }, s.detail),
      last
        ? el('div.tiny', { style: { marginTop: '11px', color: 'var(--text-faint)' } },
          `Last scan ${relDay(last.createdAt)} · ${fmtDate(last.createdAt)}`)
        : el('div.tiny.gold', { style: { marginTop: '11px' } }, 'Not scanned yet'),
    );
  })));

  const recent = [
    ...skin.map((s) => ({ kind: 'skin', route: `/skinscan/${s.id}`, label: 'Skin wellness', at: s.createdAt, score: s.overall, thumb: s.thumb })),
    ...postures.map((s) => ({ kind: 'posture', route: `/posture/${s.id}`, label: `Posture · ${s.view === 'side' ? 'Side' : 'Front'}`, at: s.createdAt, score: s.overall, thumb: s.thumb })),
    ...bodies.map((s) => ({ kind: 'body', route: `/bodyscan/${s.id}`, label: 'Body composition', at: s.createdAt, score: null, thumb: s.thumb })),
  ].sort((a, b) => b.at - a.at).slice(0, 6);

  if (recent.length) {
    node.append(el('div.section', null,
      el('div.section-head', null,
        el('h2', 'Recent scans'),
        el('a', { href: '#/history?tab=scans' }, 'All history'),
      ),
      el('div.list', null, ...recent.map((r) => el('button.row', { onclick: () => navigate(r.route) },
        r.thumb
          ? el('img', { src: r.thumb, alt: '', style: { width: '44px', height: '44px', borderRadius: '13px', objectFit: 'cover', flex: 'none' } })
          : el('div.avatar.avatar-quiet', '—'),
        el('div.row-main', null,
          el('div.row-title', r.label),
          el('div.row-sub', fmtDate(r.at)),
        ),
        typeof r.score === 'number'
          ? el(`span.pill.${scoreClass(r.score)}`, `${r.score}`)
          : el('span.row-chev', icon('chev')),
      ))),
    ));
  }

  return { title: 'Scan', subtitle: 'Posture · Body · Skin', node };
}
