import { el, icon, initials, fmtDate, fmtDuration, scoreClass, confirmSheet, toast, ring } from '../ui.js';
import { getClient, listSessions, listScans, deleteClient, setSetting } from '../store.js';
import { clientSheet } from './clients.js';
import { navigate, back } from '../router.js';
import { startSession, getActive, setClient } from '../session-state.js';

export async function render({ params }) {
  const client = await getClient(params.id);
  if (!client) {
    return {
      title: 'Client not found',
      back: '/clients',
      node: el('div.empty', null,
        el('h3', 'This client no longer exists'),
        el('p', 'They may have been deleted from this device.'),
        el('a.btn.btn-primary', { href: '#/clients' }, 'Back to clients'),
      ),
    };
  }

  const [sessions, scans] = await Promise.all([listSessions(client.id), listScans(client.id)]);
  const scored = sessions.filter((s) => typeof s.avgScore === 'number');
  const avg = scored.length ? Math.round(scored.reduce((a, s) => a + s.avgScore, 0) / scored.length) : null;
  const totalReps = sessions.reduce((a, s) => a + (s.totalReps || 0), 0);
  const lastScan = scans[0] || null;

  const node = el('div');

  node.append(el('div.card', { style: { display: 'flex', gap: '14px', alignItems: 'center' } },
    el('div.avatar', { style: { width: '56px', height: '56px', fontSize: '20px', borderRadius: '18px' } }, initials(client.name)),
    el('div', { style: { flex: '1', minWidth: '0' } },
      el('div', { style: { fontSize: '19px', fontWeight: '680' } }, client.name),
      el('div.small.muted', { style: { marginTop: '3px' } },
        [client.goals || null, client.heightCm ? `${client.heightCm} cm` : null].filter(Boolean).join(' · ') || 'No goals set'),
    ),
    el('button.icon-btn.solid', {
      'aria-label': 'Edit client',
      onclick: async () => { if (await clientSheet(client)) navigate(`/client/${client.id}`); },
    }, icon('note')),
  ));

  node.append(el('div.section', null,
    el('div.stat-grid', null,
      el('div.stat', null, el('div.stat-val', sessions.length), el('div.stat-lab', 'Sessions')),
      el('div.stat', null, el('div.stat-val', totalReps), el('div.stat-lab', 'Total reps')),
      el('div.stat', null,
        el('div.stat-val', { style: { color: avg === null ? null : `var(--${scoreClass(avg)})` } }, avg === null ? '—' : `${avg}`),
        el('div.stat-lab', 'Avg form')),
    ),
  ));

  node.append(el('div.section', null,
    el('div.btn-row', null,
      el('button.btn.btn-primary.btn-lg', {
        onclick: async () => {
          const active = getActive();
          if (active && active.clientId !== client.id && active.sets.length) {
            const ok = await confirmSheet({
              title: 'Switch this session?',
              message: `A session with ${active.clientName || 'another client'} is still open. Reassign it to ${client.name}?`,
              confirmText: 'Reassign session',
            });
            if (!ok) return;
          }
          if (active) setClient(client.id, client.name);
          else startSession({ clientId: client.id, clientName: client.name });
          await setSetting('activeClientId', client.id);
          navigate('/train');
        },
      }, icon('play'), 'Start session'),
      el('button.btn.btn-lg', {
        onclick: async () => {
          await setSetting('activeClientId', client.id);
          navigate('/skin');
        },
      }, '✨ Skin scan'),
    ),
  ));

  if (client.notes) {
    node.append(el('div.section', null,
      el('div.section-head', null, el('h2', 'Notes')),
      el('div.card', el('p.small', { style: { margin: 0, whiteSpace: 'pre-wrap', lineHeight: '1.55', color: 'var(--text-dim)' } }, client.notes)),
    ));
  }

  /* --------------------------------------------------------- skin trend */
  if (scans.length) {
    const strip = el('div.thumb-strip', null, ...scans.slice(0, 12).map((s) => el('button.thumb', {
      onclick: () => navigate(`/skinscan/${s.id}`),
    },
      s.thumb ? el('img', { src: s.thumb, alt: '' }) : el('div', { style: { height: '92px', display: 'grid', placeItems: 'center', fontSize: '22px' } }, '✨'),
      el('div.cap', { style: { color: `var(--${scoreClass(s.overall)})`, fontWeight: '700' } }, s.overall ?? '—'),
    )));

    node.append(el('div.section', null,
      el('div.section-head', null,
        el('h2', 'Skin scans'),
        el('button', { onclick: () => navigate('/skin') }, 'New scan'),
      ),
      lastScan ? el('div.card.card-tight', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '10px' } },
        ring(lastScan.overall, { size: 58, stroke: 6 }),
        el('div', { style: { flex: 1 } },
          el('div', { style: { fontWeight: '650' } }, 'Latest scan'),
          el('div.tiny.muted', { style: { marginTop: '2px' } }, fmtDate(lastScan.createdAt)),
        ),
        el('button.btn.btn-sm', { onclick: () => navigate(`/skinscan/${lastScan.id}`) }, 'Open'),
      ) : null,
      strip,
    ));
  }

  /* ----------------------------------------------------------- sessions */
  node.append(el('div.section', null,
    el('div.section-head', null, el('h2', 'Session history')),
    sessions.length
      ? el('div.list', null, ...sessions.map((s) => el('a.row', { href: `#/session/${s.id}` },
        el('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '19px' } }, '🏋️'),
        el('div.row-main', null,
          el('div.row-title', s.exercises?.length ? s.exercises.join(', ') : 'Session'),
          el('div.row-sub', `${fmtDate(s.startedAt)} · ${s.sets?.length || 0} sets · ${s.totalReps || 0} reps${s.durationMs ? ` · ${fmtDuration(s.durationMs)}` : ''}`),
        ),
        typeof s.avgScore === 'number' ? el(`span.pill.${scoreClass(s.avgScore)}`, `${s.avgScore}%`) : el('span.row-chev', icon('chev')),
      )))
      : el('div.empty', null,
        el('h3', 'No sessions yet'),
        el('p', 'Start a session to capture reps, joint angles and form scores.'),
      ),
  ));

  node.append(el('button.btn.btn-danger.btn-block.mt-24', {
    onclick: async () => {
      const ok = await confirmSheet({
        title: `Delete ${client.name}?`,
        message: `This removes their profile, ${sessions.length} session${sessions.length === 1 ? '' : 's'} and ${scans.length} skin scan${scans.length === 1 ? '' : 's'} from this device. It cannot be undone.`,
        confirmText: 'Delete permanently',
        danger: true,
      });
      if (!ok) return;
      await deleteClient(client.id);
      toast('Client deleted');
      navigate('/clients');
    },
  }, icon('trash'), 'Delete client'));

  return {
    title: client.name,
    subtitle: sessions.length ? `Last session ${fmtDate(sessions[0].startedAt)}` : 'No sessions yet',
    back: () => back('/clients'),
    node,
  };
}
