import { el, icon, fmtDate, relDay, scoreClass, toast } from '../ui.js';
import { listClients, listSessions, listScans } from '../store.js';
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

export async function render() {
  const [clients, sessions, scans] = await Promise.all([
    listClients(), listSessions(null, 40), listScans(null, 20),
  ]);

  const weekAgo = Date.now() - 7 * 86400000;
  const thisWeek = sessions.filter((s) => s.startedAt >= weekAgo);
  const scored = sessions.filter((s) => typeof s.avgScore === 'number');
  const avgScore = scored.length
    ? Math.round(scored.slice(0, 10).reduce((a, s) => a + s.avgScore, 0) / Math.min(10, scored.length))
    : null;

  const active = getActive();
  const node = el('div');

  /* -------------------------------------------------------------- hero */
  node.append(el('div.hero', null,
    el('h2', `${greeting()} 👋`),
    el('p', clients.length
      ? 'Ready when you are — live form analysis and skin wellness, all on this device.'
      : 'Add your first client to start tracking form scores and skin wellness over time.'),
  ));

  /* --------------------------------------------- session in progress */
  if (active) {
    const stats = sessionStats(active);
    node.append(el('div.card.mt-12', {
      style: { borderColor: 'rgba(240,165,187,.45)', background: 'rgba(240,165,187,.07)' },
    },
      el('div.spread', null,
        el('div', null,
          el('span.badge-live', el('i'), 'SESSION LIVE'),
          el('div', { style: { marginTop: '8px', fontWeight: '650' } },
            active.clientName || 'Unassigned session'),
          el('div.small.muted', { style: { marginTop: '2px' } },
            `${stats.sets} ${stats.sets === 1 ? 'set' : 'sets'} · ${stats.reps} reps${stats.score !== null ? ` · ${stats.score}% form` : ''}`),
        ),
        el('button.btn.btn-primary.btn-sm', { onclick: () => navigate('/train') }, 'Resume'),
      ),
    ));
  }

  /* ------------------------------------------------------ quick actions */
  node.append(el('div.section', null,
    el('div.btn-row', null,
      actionCard('Movement', 'Live form analysis', '🏋️', () => navigate('/train')),
      actionCard('Skin scan', 'Wellness snapshot', '✨', () => navigate('/skin')),
    ),
  ));

  /* ------------------------------------------------------------- stats */
  node.append(el('div.section', null,
    el('div.stat-grid', null,
      stat(clients.length, clients.length === 1 ? 'Client' : 'Clients'),
      stat(thisWeek.length, 'Sessions / 7d'),
      stat(avgScore === null ? '—' : `${avgScore}`, 'Avg form', avgScore),
    ),
  ));

  /* ------------------------------------------------------------ clients */
  if (clients.length) {
    node.append(el('div.section', null,
      el('div.section-head', null,
        el('h2', 'Clients'),
        el('a', { href: '#/clients' }, 'See all'),
      ),
      el('div.list', null, ...clients.slice(0, 3).map(clientRow)),
    ));
  } else {
    node.append(el('div.section', null,
      el('div.empty', null,
        el('h3', 'No clients yet'),
        el('p', 'Create a client to save sessions, form scores and skin scans against their profile.'),
        el('button.btn.btn-primary', { onclick: () => navigate('/clients') }, icon('plus'), 'Add a client'),
      ),
    ));
  }

  /* ----------------------------------------------------------- activity */
  const activity = [
    ...sessions.slice(0, 6).map((s) => ({ kind: 'session', at: s.startedAt, data: s })),
    ...scans.slice(0, 6).map((s) => ({ kind: 'scan', at: s.createdAt, data: s })),
  ].sort((a, b) => b.at - a.at).slice(0, 5);

  if (activity.length) {
    node.append(el('div.section', null,
      el('div.section-head', null,
        el('h2', 'Recent activity'),
        el('a', { href: '#/history' }, 'History'),
      ),
      el('div.list', null, ...activity.map(activityRow)),
    ));
  }

  /* ------------------------------------------------------- install hint */
  if (!isStandalone) node.append(installCard());

  node.append(el('p.tiny.muted.center.mt-24', { style: { lineHeight: '1.6' } },
    'Everything you record stays on this device.',
    el('br'),
    el('a', { href: '#/about', style: { color: 'var(--rose)' } }, 'How the analysis works'),
  ));

  return {
    title: 'Lumen Coach',
    subtitle: 'Form & skin wellness',
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

function actionCard(title, sub, emoji, onclick) {
  return el('button.card', {
    onclick,
    style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start', cursor: 'pointer', textAlign: 'left', minHeight: '104px' },
  },
    el('span', { style: { fontSize: '26px', lineHeight: '1' } }, emoji),
    el('span', { style: { fontSize: '16px', fontWeight: '680' } }, title),
    el('span.tiny.muted', sub),
  );
}

function clientRow(c) {
  return el('a.row', { href: `#/client/${c.id}` },
    el('div.avatar', initialsOf(c.name)),
    el('div.row-main', null,
      el('div.row-title', c.name),
      el('div.row-sub', c.lastActiveAt ? `Active ${relDay(c.lastActiveAt)}` : 'New client'),
    ),
    el('span.row-chev', icon('chev')),
  );
}

function initialsOf(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

function activityRow(item) {
  if (item.kind === 'session') {
    const s = item.data;
    return el('a.row', { href: `#/session/${s.id}` },
      el('div.avatar', { style: { background: 'var(--surface-2)', color: 'var(--rose)', fontSize: '19px' } }, '🏋️'),
      el('div.row-main', null,
        el('div.row-title', s.exercises?.length ? s.exercises.join(', ') : 'Training session'),
        el('div.row-sub', `${fmtDate(s.startedAt)} · ${s.totalReps || 0} reps`),
      ),
      s.avgScore !== null && s.avgScore !== undefined
        ? el(`span.pill.${scoreClass(s.avgScore)}`, `${s.avgScore}%`)
        : el('span.row-chev', icon('chev')),
    );
  }
  const s = item.data;
  return el('a.row', { href: `#/scan/${s.id}` },
    s.thumb
      ? el('img', { src: s.thumb, alt: '', style: { width: '44px', height: '44px', borderRadius: '14px', objectFit: 'cover', flex: 'none' } })
      : el('div.avatar', { style: { background: 'var(--surface-2)' } }, '✨'),
    el('div.row-main', null,
      el('div.row-title', 'Skin scan'),
      el('div.row-sub', fmtDate(s.createdAt)),
    ),
    s.overall !== null && s.overall !== undefined
      ? el(`span.pill.${scoreClass(s.overall)}`, `${s.overall}`)
      : el('span.row-chev', icon('chev')),
  );
}

function installCard() {
  const card = el('div.card.mt-24');
  if (install.available) {
    card.append(
      el('div.spread', null,
        el('div', null,
          el('div', { style: { fontWeight: '660' } }, 'Add to home screen'),
          el('div.small.muted.mt-8', 'Run Lumen full-screen with faster camera start-up.'),
        ),
      ),
      el('button.btn.btn-primary.btn-block.mt-12', {
        onclick: async () => {
          const ok = await promptInstall();
          if (ok) toast('Installing…', 'good');
        },
      }, 'Install app'),
    );
  } else if (isIOS) {
    card.append(
      el('div', { style: { fontWeight: '660' } }, 'Add to your home screen'),
      el('p.small.muted.mt-8', { style: { lineHeight: '1.55', margin: '8px 0 0' } },
        'In Safari, tap the Share button ',
        el('span', { style: { fontWeight: '700' } }, '􀈂'),
        ' at the bottom of the screen, then choose ',
        el('strong', { style: { color: 'var(--text)' } }, 'Add to Home Screen'),
        '. Lumen then opens full-screen like a native app.'),
    );
  } else {
    card.append(
      el('div', { style: { fontWeight: '660' } }, 'Add to your home screen'),
      el('p.small.muted', { style: { lineHeight: '1.55', margin: '8px 0 0' } },
        'Open your browser menu and choose ',
        el('strong', { style: { color: 'var(--text)' } }, 'Install app'),
        ' or ',
        el('strong', { style: { color: 'var(--text)' } }, 'Add to Home screen'),
        '.'),
    );
  }
  return card;
}
