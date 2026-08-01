import { el, icon, fmtDate, fmtDuration, scoreClass } from '../ui.js';
import { listSessions, listScans } from '../store.js';

export async function render({ query }) {
  const [sessions, scans] = await Promise.all([listSessions(), listScans()]);
  let tab = query.tab === 'skin' ? 'skin' : 'training';

  const tabs = el('div.wrap', { style: { marginBottom: '16px' } });
  const body = el('div');

  function paint() {
    tabs.replaceChildren(
      el(`button.chip${tab === 'training' ? '.on' : ''}`, { onclick: () => { tab = 'training'; paint(); } },
        `🏋️ Training (${sessions.length})`),
      el(`button.chip${tab === 'skin' ? '.on' : ''}`, { onclick: () => { tab = 'skin'; paint(); } },
        `✨ Skin (${scans.length})`),
    );

    body.replaceChildren();
    const items = tab === 'training' ? sessions : scans;
    if (!items.length) {
      body.append(el('div.empty', null,
        el('h3', tab === 'training' ? 'No sessions yet' : 'No skin scans yet'),
        el('p', tab === 'training'
          ? 'Recorded sets, joint angles and form scores will show up here.'
          : 'Take your first scan to start tracking how your skin changes.'),
        el('a.btn.btn-primary', { href: tab === 'training' ? '#/train' : '#/skin' },
          tab === 'training' ? 'Start a session' : 'Scan my skin'),
      ));
      return;
    }

    for (const group of groupByDay(items, tab)) {
      body.append(el('div.section-head', { style: { marginTop: '18px' } }, el('h2', group.label)));
      body.append(el('div.list', null, ...group.items.map((item) =>
        tab === 'training' ? sessionRow(item) : scanRow(item))));
    }
  }

  paint();

  return {
    title: 'History',
    subtitle: `${sessions.length} sessions · ${scans.length} scans`,
    node: el('div', tabs, body),
  };
}

function groupByDay(items, tab) {
  const key = (i) => new Date(tab === 'training' ? i.startedAt : i.createdAt).toDateString();
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  return [...map.entries()].map(([k, list]) => ({
    label: k === today ? 'Today' : k === yesterday ? 'Yesterday'
      : new Date(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
    items: list,
  }));
}

function sessionRow(s) {
  return el('a.row', { href: `#/session/${s.id}` },
    el('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '19px' } }, '🏋️'),
    el('div.row-main', null,
      el('div.row-title', s.exercises?.length ? s.exercises.join(', ') : 'Training session'),
      el('div.row-sub', [
        s.clientName || 'Unassigned',
        `${s.totalReps || 0} reps`,
        s.durationMs ? fmtDuration(s.durationMs) : null,
      ].filter(Boolean).join(' · ')),
    ),
    typeof s.avgScore === 'number' ? el(`span.pill.${scoreClass(s.avgScore)}`, `${s.avgScore}%`) : el('span.row-chev', icon('chev')),
  );
}

function scanRow(s) {
  return el('a.row', { href: `#/scan/${s.id}` },
    s.thumb
      ? el('img', { src: s.thumb, alt: '', style: { width: '44px', height: '44px', borderRadius: '14px', objectFit: 'cover', flex: 'none' } })
      : el('div.avatar', { style: { background: 'var(--surface-2)' } }, '✨'),
    el('div.row-main', null,
      el('div.row-title', s.region === 'area' ? 'Skin area scan' : 'Face scan'),
      el('div.row-sub', [s.clientName || 'Personal', fmtDate(s.createdAt)].filter(Boolean).join(' · ')),
    ),
    typeof s.overall === 'number' ? el(`span.pill.${scoreClass(s.overall)}`, `${s.overall}`) : el('span.row-chev', icon('chev')),
  );
}
