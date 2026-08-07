import { el, icon, fmtDate, fmtDuration, scoreClass } from '../ui.js';
import {
  listSessions, listScans, listPostures, listBodyScans, listRounds,
  listVitals, listLabs, listPrograms,
} from '../store.js';
import { navigate } from '../router.js';

const TABS = [
  { id: 'training', label: 'Training' },
  { id: 'posture', label: 'Posture' },
  { id: 'body', label: 'Body' },
  { id: 'speed', label: 'Speed' },
  { id: 'skin', label: 'Skin' },
  { id: 'vitals', label: 'Recovery' },
  { id: 'labs', label: 'Bloods' },
  { id: 'programs', label: 'Programs' },
];

export async function render({ query }) {
  const [sessions, postures, bodies, rounds, scans, vitals, labs, programs] = await Promise.all([
    listSessions(), listPostures(), listBodyScans(), listRounds(), listScans(),
    listVitals(), listLabs(), listPrograms(),
  ]);

  const data = {
    training: sessions, posture: postures, body: bodies, speed: rounds, skin: scans,
    vitals, labs, programs,
  };
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));

  let tab = TABS.some((t) => t.id === query.tab) ? query.tab
    : (TABS.find((t) => counts[t.id] > 0)?.id || 'training');

  const tabs = el('div.wrap', { style: { marginBottom: '18px' } });
  const body = el('div');

  function paint() {
    tabs.replaceChildren(...TABS.map((t) => el(`button.chip${tab === t.id ? '.on' : ''}`, {
      onclick: () => { tab = t.id; paint(); },
    }, `${t.label} ${counts[t.id]}`)));

    body.replaceChildren();
    const items = data[tab];
    if (!items.length) {
      body.append(el('div.empty', null,
        el('h3', `No ${TABS.find((t) => t.id === tab).label.toLowerCase()} records yet`),
        el('p', EMPTY_COPY[tab]),
        el('a.btn.btn-primary', { href: `#${EMPTY_ROUTE[tab]}` }, EMPTY_CTA[tab]),
      ));
      return;
    }
    for (const group of groupByDay(items, tab)) {
      body.append(el('div.section-head', { style: { marginTop: '20px' } }, el('h2', group.label)));
      body.append(el('div.list', null, ...group.items.map((item) => ROW[tab](item))));
    }
  }

  paint();

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    title: 'History',
    subtitle: `${total} record${total === 1 ? '' : 's'}`,
    node: el('div', tabs, body),
  };
}

const EMPTY_COPY = {
  training: 'Recorded sets, joint angles and form scores appear here.',
  posture: 'Alignment assessments and how they change over time appear here.',
  body: 'Silhouette measurements and change heatmaps appear here.',
  speed: 'Round-by-round output and hand speed appear here.',
  skin: 'Skin wellness snapshots appear here.',
  vitals: 'Heart-rate and HRV readings, and how readiness tracks against your own baseline, appear here.',
  labs: 'Blood panels you have entered, with each marker against its reference range, appear here.',
  programs: 'Programs built from your assessments appear here.',
};
const EMPTY_ROUTE = {
  training: '/train', posture: '/posture', body: '/body', speed: '/speed', skin: '/skin',
  vitals: '/vitals', labs: '/labs', programs: '/coach',
};
const EMPTY_CTA = {
  training: 'Start a session', posture: 'Assess posture', body: 'Scan body',
  speed: 'Track a round', skin: 'Scan skin',
  vitals: 'Take a reading', labs: 'Enter a panel', programs: 'Build a program',
};

const dateKey = (tab) => (tab === 'training' ? 'startedAt' : 'createdAt');

function groupByDay(items, tab) {
  const key = dateKey(tab);
  const map = new Map();
  for (const item of items) {
    const k = new Date(item[key]).toDateString();
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

function thumbOrTag(item, tag) {
  return item.thumb
    ? el('img', { src: item.thumb, alt: '', style: { width: '44px', height: '44px', borderRadius: '13px', objectFit: 'cover', flex: 'none' } })
    : el('div.avatar.avatar-quiet', { style: { fontSize: '10px', letterSpacing: '.06em' } }, tag);
}

const ROW = {
  training: (s) => el('button.row', { onclick: () => navigate(`/session/${s.id}`) },
    el('div.avatar.avatar-quiet', { style: { fontSize: '10px' } }, 'MOVE'),
    el('div.row-main', null,
      el('div.row-title', s.exercises?.length ? s.exercises.join(', ') : 'Training session'),
      el('div.row-sub', [s.clientName || 'Unassigned', `${s.totalReps || 0} reps`,
        s.durationMs ? fmtDuration(s.durationMs) : null].filter(Boolean).join(' · ')),
    ),
    typeof s.avgScore === 'number'
      ? el(`span.pill.${scoreClass(s.avgScore)}`, `${s.avgScore}%`) : el('span.row-chev', icon('chev')),
  ),

  posture: (s) => el('button.row', { onclick: () => navigate(`/posture/${s.id}`) },
    thumbOrTag(s, 'POST'),
    el('div.row-main', null,
      el('div.row-title', `${s.view === 'side' ? 'Side' : 'Front'} view assessment`),
      el('div.row-sub', [s.clientName || 'Unassigned', fmtDate(s.createdAt)].join(' · ')),
    ),
    typeof s.overall === 'number'
      ? el(`span.pill.${scoreClass(s.overall)}`, `${s.overall}`) : el('span.row-chev', icon('chev')),
  ),

  body: (s) => el('button.row', { onclick: () => navigate(`/bodyscan/${s.id}`) },
    thumbOrTag(s, 'BODY'),
    el('div.row-main', null,
      el('div.row-title', 'Body composition'),
      el('div.row-sub', [s.clientName || 'Unassigned',
        s.measurement?.ratios?.waistToHeight ? `WHtR ${s.measurement.ratios.waistToHeight.toFixed(2)}` : null,
        fmtDate(s.createdAt)].filter(Boolean).join(' · ')),
    ),
    el('span.row-chev', icon('chev')),
  ),

  speed: (s) => el('button.row', { onclick: () => navigate(`/round/${s.id}`) },
    el('div.avatar.avatar-quiet', { style: { fontSize: '10px' } }, 'SPD'),
    el('div.row-main', null,
      el('div.row-title', `${s.totals?.strikes || 0} strikes · ${s.rounds?.length || 0} rounds`),
      el('div.row-sub', [s.clientName || 'Unassigned',
        s.totals?.peakSpeed ? `peak ${s.totals.peakSpeed} m/s` : null,
        fmtDate(s.createdAt)].filter(Boolean).join(' · ')),
    ),
    el('span.row-chev', icon('chev')),
  ),

  skin: (s) => el('button.row', { onclick: () => navigate(`/skinscan/${s.id}`) },
    thumbOrTag(s, 'SKIN'),
    el('div.row-main', null,
      el('div.row-title', s.region === 'area' ? 'Skin area scan' : 'Face scan'),
      el('div.row-sub', [s.clientName || 'Personal', fmtDate(s.createdAt)].join(' · ')),
    ),
    typeof s.overall === 'number'
      ? el(`span.pill.${scoreClass(s.overall)}`, `${s.overall}`) : el('span.row-chev', icon('chev')),
  ),

  vitals: (s) => el('button.row', { onclick: () => navigate('/vitals') },
    el('div.avatar.avatar-quiet', { style: { fontSize: '10px' } }, 'HRV'),
    el('div.row-main', null,
      el('div.row-title', `${s.bpm} bpm${typeof s.rmssd === 'number' ? ` · HRV ${s.rmssd} ms` : ''}`),
      el('div.row-sub', [s.clientName || 'Unassigned', s.mode === 'finger' ? 'Fingertip' : 'Face',
        fmtDate(s.createdAt)].filter(Boolean).join(' · ')),
    ),
    typeof s.readiness === 'number'
      ? el(`span.pill.${scoreClass(s.readiness)}`, `${s.readiness}`) : el('span.row-chev', icon('chev')),
  ),

  labs: (s) => el('button.row', { onclick: () => navigate(`/labsreport/${s.id}`) },
    el('div.avatar.avatar-quiet', { style: { fontSize: '10px' } }, 'LABS'),
    el('div.row-main', null,
      el('div.row-title', `${s.panel?.measured || 0} marker${s.panel?.measured === 1 ? '' : 's'}`),
      el('div.row-sub', [s.clientName || 'Unassigned',
        `${s.panel?.outOfRange?.length || 0} outside range`, fmtDate(s.createdAt)].join(' · ')),
    ),
    // A panel that needs a doctor has to be obvious in the list, not only on its own page.
    s.panel?.seekCare
      ? el('span.pill.bad', 'See a doctor')
      : el(`span.pill.${s.panel?.outOfRange?.length ? 'warn' : 'good'}`,
        s.panel?.outOfRange?.length ? 'Review' : 'In range'),
  ),

  programs: (s) => el('button.row', { onclick: () => navigate(`/program/${s.id}`) },
    el('div.avatar.avatar-quiet', { style: { fontSize: '10px' } }, 'PLAN'),
    el('div.row-main', null,
      el('div.row-title', s.program?.short?.title || 'Program'),
      el('div.row-sub', [s.clientName || 'Unassigned',
        `${s.program?.priorities?.length || 0} priorit${s.program?.priorities?.length === 1 ? 'y' : 'ies'}`,
        fmtDate(s.createdAt)].join(' · ')),
    ),
    el('span.row-chev', icon('chev')),
  ),
};
