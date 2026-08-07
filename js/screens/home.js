import { el, icon, fmtDate, relDay, scoreClass, initials, toast } from '../ui.js';
import { listClients, listSessions, listScans, listPostures, listBodyScans, listRounds } from '../store.js';
import { getActive, sessionStats } from '../session-state.js';
import { navigate } from '../router.js';
import { install, promptInstall } from '../main.js';
import { isIOS, isStandalone } from '../camera.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Late one';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const ACTIONS = [
  { id: 'train', title: 'Movement', line: 'Live form analysis', route: '/train',
    glyph: 'M6.5 9v6M17.5 9v6M3.5 10.5v3M20.5 10.5v3M6.5 12h11' },
  { id: 'posture', title: 'Posture', line: 'Alignment angles', route: '/posture',
    glyph: 'M12 4.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 7.6v6M8.6 10h6.8M12 13.6L9.6 20M12 13.6L14.4 20' },
  { id: 'body', title: 'Body', line: 'Shape & change', route: '/body',
    glyph: 'M12 3.8a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM9.2 8.4h5.6l.7 4.8h-1.7L13.3 20h-1.5l-.6-4.6h-.4L10.2 20H8.7l.5-6.8H7.8z' },
  { id: 'speed', title: 'Speed', line: 'Output & rounds', route: '/speed',
    glyph: 'M13 3l-7 10h5l-1 8 7-10h-5z' },
  { id: 'vitals', title: 'Recovery', line: 'Heart rate & HRV', route: '/vitals',
    glyph: 'M3.5 12.5h3.2l1.9-4.4 2.7 8.2 2.1-5 1.4 2.6h5.7' },
  { id: 'labs', title: 'Bloods', line: 'Labs & ranges', route: '/labs',
    glyph: 'M9.4 3.6h5.2M10.6 3.6v6.1L6.9 17a2.2 2.2 0 0 0 1.9 3.3h6.4a2.2 2.2 0 0 0 1.9-3.3l-3.7-7.3V3.6M8.4 14h7.2' },
];

export async function render() {
  const [clients, sessions, scans, postures, bodies, rounds] = await Promise.all([
    listClients(), listSessions(null, 40), listScans(null, 10),
    listPostures(null, 10), listBodyScans(null, 10), listRounds(null, 10),
  ]);

  const weekAgo = Date.now() - 7 * 86400000;
  const thisWeek = sessions.filter((s) => s.startedAt >= weekAgo).length
    + rounds.filter((r) => r.createdAt >= weekAgo).length;
  const scored = sessions.filter((s) => typeof s.avgScore === 'number');
  const avgForm = scored.length
    ? Math.round(scored.slice(0, 10).reduce((a, s) => a + s.avgScore, 0) / Math.min(10, scored.length))
    : null;
  const lastPosture = postures[0];

  const active = getActive();
  const node = el('div');

  /* -------------------------------------------------------------- hero */
  node.append(el('div.hero', null,
    el('div.overline', { style: { marginBottom: '12px' } }, greeting()),
    el('h2', clients.length
      ? 'Measure it, and it changes.'
      : 'Every read stays on this device.'),
    el('p', clients.length
      ? 'Form, alignment, shape and speed — four ways to see what training is actually doing.'
      : 'Add a client to start building a record of form, posture, shape and output.'),
  ));

  /* --------------------------------------------- session in progress */
  if (active) {
    const stats = sessionStats(active);
    node.append(el('div.card.card-gold.mt-12', null,
      el('div.spread', null,
        el('div', null,
          el('span.badge-live', el('i'), 'SESSION LIVE'),
          el('div', { style: { marginTop: '10px', fontWeight: '650' } }, active.clientName || 'Unassigned session'),
          el('div.small.muted', { style: { marginTop: '3px' } },
            `${stats.sets} ${stats.sets === 1 ? 'set' : 'sets'} · ${stats.reps} reps${stats.score !== null ? ` · ${stats.score}% form` : ''}`),
        ),
        el('button.btn.btn-primary.btn-sm', { onclick: () => navigate('/train') }, 'Resume'),
      ),
    ));
  }

  /* ------------------------------------------------------ quick actions */
  node.append(el('div.section', null,
    el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
      ...ACTIONS.map((a) => el('button.card', {
        onclick: () => navigate(a.route),
        style: { padding: '16px 14px', textAlign: 'left', cursor: 'pointer', margin: 0 },
      },
        el('div', {
          style: { width: '34px', height: '34px', display: 'grid', placeItems: 'center', marginBottom: '12px' },
          html: `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--gold)"
                  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${a.glyph}"/></svg>`,
        }),
        el('div', { style: { fontSize: '15.5px', fontWeight: '650' } }, a.title),
        el('div.tiny.muted', { style: { marginTop: '3px' } }, a.line),
      )),
    ),
  ));

  /* ------------------------------------------------------------- stats */
  node.append(el('div.section', null,
    el('div.stat-grid', null,
      stat(clients.length, clients.length === 1 ? 'Client' : 'Clients'),
      stat(thisWeek, 'Sessions / 7d'),
      stat(avgForm === null ? '—' : avgForm, 'Avg form', avgForm),
    ),
  ));

  /* ------------------------------------------------- posture spotlight */
  if (lastPosture) {
    node.append(el('div.section', null,
      el('div.section-head', null,
        el('h2', 'Latest alignment'),
        el('a', { href: '#/posture' }, 'Re-scan'),
      ),
      el('button.card', {
        onclick: () => navigate(`/posture/${lastPosture.id}`),
        style: { display: 'flex', gap: '14px', alignItems: 'center', width: '100%', textAlign: 'left', cursor: 'pointer' },
      },
        lastPosture.thumb
          ? el('img', { src: lastPosture.thumb, alt: '', style: { width: '62px', height: '62px', borderRadius: '14px', objectFit: 'cover', flex: 'none' } })
          : el('div.avatar.avatar-quiet', '—'),
        el('div', { style: { flex: 1, minWidth: 0 } },
          el('div', { style: { fontWeight: '650' } },
            `${lastPosture.view === 'side' ? 'Side' : 'Front'} view assessment`),
          el('div.tiny.muted', { style: { marginTop: '4px' } },
            `${lastPosture.clientName || 'Unassigned'} · ${relDay(lastPosture.createdAt)}`),
          el('div.tiny', { style: { marginTop: '6px', color: 'var(--text-faint)' } },
            flaggedSummary(lastPosture)),
        ),
        typeof lastPosture.overall === 'number'
          ? el(`span.pill.${scoreClass(lastPosture.overall)}`, `${lastPosture.overall}`) : null,
      ),
    ));
  }

  /* ------------------------------------------------------------ clients */
  if (clients.length) {
    node.append(el('div.section', null,
      el('div.section-head', null, el('h2', 'Clients'), el('a', { href: '#/clients' }, 'See all')),
      el('div.list', null, ...clients.slice(0, 3).map((c) => el('a.row', { href: `#/client/${c.id}` },
        el('div.avatar', initials(c.name)),
        el('div.row-main', null,
          el('div.row-title', c.name),
          el('div.row-sub', c.lastActiveAt ? `Active ${relDay(c.lastActiveAt)}` : 'New client'),
        ),
        el('span.row-chev', icon('chev')),
      ))),
    ));
  } else {
    node.append(el('div.section', null,
      el('div.empty', null,
        el('h3', 'No clients yet'),
        el('p', 'Clients hold every session, assessment and scan together in one record.'),
        el('button.btn.btn-primary', { onclick: () => navigate('/clients') }, icon('plus'), 'Add a client'),
      ),
    ));
  }

  /* ----------------------------------------------------------- activity */
  const activity = [
    ...sessions.slice(0, 6).map((s) => ({ route: `/session/${s.id}`, label: s.exercises?.length ? s.exercises.join(', ') : 'Training session', at: s.startedAt, score: s.avgScore, kind: 'Movement' })),
    ...postures.slice(0, 4).map((s) => ({ route: `/posture/${s.id}`, label: 'Posture assessment', at: s.createdAt, score: s.overall, kind: 'Posture', thumb: s.thumb })),
    ...bodies.slice(0, 4).map((s) => ({ route: `/bodyscan/${s.id}`, label: 'Body composition', at: s.createdAt, score: null, kind: 'Body', thumb: s.thumb })),
    ...scans.slice(0, 4).map((s) => ({ route: `/skinscan/${s.id}`, label: 'Skin wellness', at: s.createdAt, score: s.overall, kind: 'Skin', thumb: s.thumb })),
    ...rounds.slice(0, 4).map((s) => ({ route: `/round/${s.id}`, label: `${s.totals?.strikes || 0} strikes · ${s.rounds?.length || 0} rounds`, at: s.createdAt, score: null, kind: 'Speed' })),
  ].sort((a, b) => b.at - a.at).slice(0, 6);

  if (activity.length) {
    node.append(el('div.section', null,
      el('div.section-head', null, el('h2', 'Recent'), el('a', { href: '#/history' }, 'History')),
      el('div.list', null, ...activity.map((a) => el('button.row', { onclick: () => navigate(a.route) },
        a.thumb
          ? el('img', { src: a.thumb, alt: '', style: { width: '44px', height: '44px', borderRadius: '13px', objectFit: 'cover', flex: 'none' } })
          : el('div.avatar.avatar-quiet', { style: { fontSize: '10px', letterSpacing: '.06em' } }, a.kind.slice(0, 4).toUpperCase()),
        el('div.row-main', null,
          el('div.row-title', a.label),
          el('div.row-sub', `${a.kind} · ${fmtDate(a.at)}`),
        ),
        typeof a.score === 'number'
          ? el(`span.pill.${scoreClass(a.score)}`, `${a.score}`)
          : el('span.row-chev', icon('chev')),
      ))),
    ));
  }

  if (!isStandalone) node.append(installCard());

  node.append(el('p.tiny.muted.center.mt-24', { style: { lineHeight: '1.7' } },
    'Everything you record stays on this device.',
    el('br'),
    el('a', { href: '#/about', style: { color: 'var(--gold)' } }, 'How the analysis works'),
  ));

  return {
    title: 'Krysaril',
    subtitle: 'Movement · Posture · Body',
    node,
    actions: [el('button.icon-btn', { onclick: () => navigate('/settings'), 'aria-label': 'Settings' }, icon('gear'))],
  };
}

function stat(value, label, score) {
  return el('div.stat', null,
    el('div.stat-val', { style: score !== undefined && score !== null ? { color: `var(--${scoreClass(score)})` } : null }, value),
    el('div.stat-lab', label),
  );
}

function flaggedSummary(posture) {
  const flagged = Object.values(posture.measures || {}).filter((m) => m.level !== 'good');
  if (!flagged.length) return 'All measures in range';
  return `Watching: ${flagged.slice(0, 2).map((m) => m.label.toLowerCase()).join(', ')}`;
}

function installCard() {
  const card = el('div.card.mt-24');
  if (install.available) {
    card.append(
      el('div', { style: { fontWeight: '660' } }, 'Add to home screen'),
      el('p.small.muted', { style: { margin: '8px 0 0', lineHeight: '1.6' } },
        'Run Krysaril full-screen with faster camera start-up.'),
      el('button.btn.btn-primary.btn-block.mt-12', {
        onclick: async () => { if (await promptInstall()) toast('Installing…', 'good'); },
      }, 'Install app'),
    );
  } else if (isIOS) {
    card.append(
      el('div', { style: { fontWeight: '660' } }, 'Add to your home screen'),
      el('p.small.muted', { style: { lineHeight: '1.65', margin: '8px 0 0' } },
        'In Safari, tap Share at the bottom of the screen, then ',
        el('strong', { style: { color: 'var(--text)' } }, 'Add to Home Screen'),
        '. Krysaril then opens full-screen like a native app.'),
    );
  } else {
    card.append(
      el('div', { style: { fontWeight: '660' } }, 'Add to your home screen'),
      el('p.small.muted', { style: { lineHeight: '1.65', margin: '8px 0 0' } },
        'Open your browser menu and choose ',
        el('strong', { style: { color: 'var(--text)' } }, 'Install app'), '.'),
    );
  }
  return card;
}
