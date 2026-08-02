import { el, icon, pickSheet, confirmSheet, toast, scoreClass, fmtDuration } from '../ui.js';
import { EXERCISES, getExercise } from '../pose/exercises.js';
import { listClients, getSettings, setSetting } from '../store.js';
import { navigate } from '../router.js';
import { getActive, startSession, setClient, removeSet, finishSession, sessionStats, discardSession } from '../session-state.js';

const LAST_EXERCISE_KEY = 'krysaril.lastExercise';

export async function render() {
  const [clients, settings] = await Promise.all([listClients(), getSettings()]);
  let session = getActive();

  let clientId = session?.clientId ?? settings.activeClientId ?? null;
  let client = clients.find((c) => c.id === clientId) || null;
  if (!client) clientId = null;

  let exerciseId = localStorage.getItem(LAST_EXERCISE_KEY) || 'squat';
  if (!EXERCISES.some((e) => e.id === exerciseId)) exerciseId = 'squat';

  const node = el('div');
  const clientBtn = el('button.row');
  const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } });
  const setupCard = el('div.card.mt-12');
  const sessionBox = el('div');

  function paintClient() {
    clientBtn.replaceChildren(
      el('div.avatar', { style: { background: client ? undefined : 'var(--surface-2)' } }, client ? initialsOf(client.name) : '＋'),
      el('div.row-main', null,
        el('div.row-title', client ? client.name : 'No client selected'),
        el('div.row-sub', client ? 'Sets will save to this client' : 'Optional — you can train unassigned'),
      ),
      el('span.row-chev', icon('chev')),
    );
  }

  clientBtn.onclick = async () => {
    const options = [
      { value: '__none', title: 'No client', sub: 'Save to general history', emoji: '👤' },
      ...clients.map((c) => ({ value: c.id, title: c.name, sub: c.goals || 'Client', emoji: '🧍' })),
      { value: '__new', title: 'Add a new client', sub: 'Opens the client list', emoji: '＋' },
    ];
    const picked = await pickSheet({ title: 'Who are you training?', options, value: clientId || '__none' });
    if (picked === undefined) return;
    if (picked === '__new') { navigate('/clients'); return; }
    clientId = picked === '__none' ? null : picked;
    client = clients.find((c) => c.id === clientId) || null;
    await setSetting('activeClientId', clientId);
    if (session) setClient(clientId, client?.name || '');
    paintClient();
  };

  function paintExercises() {
    grid.replaceChildren(...EXERCISES.map((ex) => {
      const selected = ex.id === exerciseId;
      return el('button.card', {
        onclick: () => { exerciseId = ex.id; localStorage.setItem(LAST_EXERCISE_KEY, ex.id); paintExercises(); paintSetup(); },
        style: {
          padding: '14px 12px', textAlign: 'left', cursor: 'pointer', margin: 0,
          borderColor: selected ? 'var(--gold-line)' : undefined,
          background: selected ? 'var(--gold-wash)' : undefined,
        },
      },
        el('div', { style: { fontSize: '24px', lineHeight: '1' } }, ex.emoji),
        el('div', { style: { marginTop: '8px', fontWeight: '660', fontSize: '15px' } }, ex.name),
        el('div.tiny.muted', { style: { marginTop: '2px' } }, ex.group),
      );
    }));
  }

  function paintSetup() {
    const ex = getExercise(exerciseId);
    setupCard.replaceChildren(
      el('div', { style: { fontWeight: '660', marginBottom: '6px' } }, `${ex.emoji}  ${ex.name} set-up`),
      el('p.small.muted', { style: { margin: '0 0 8px', lineHeight: '1.55' } }, ex.setup),
      el('p.tiny.muted', { style: { margin: 0, lineHeight: '1.5' } }, ex.cameraHint),
      el('div.wrap.mt-12', null,
        ...(ex.hud || []).slice(0, 4).map((k) => el('span.chip', { style: { pointerEvents: 'none' } }, hudLabel(k))),
      ),
    );
  }

  function paintSession() {
    session = getActive();
    sessionBox.replaceChildren();
    if (!session || !session.sets.length) return;
    const stats = sessionStats(session);
    sessionBox.append(el('div.section', null,
      el('div.section-head', null,
        el('h2', 'This session'),
        el('span.tiny.muted', `${stats.sets} sets · ${stats.reps} reps`),
      ),
      el('div.list', null, ...session.sets.map((s) => el('div.row', { style: { cursor: 'default' } },
        el('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } }, s.emoji || '🏋️'),
        el('div.row-main', null,
          el('div.row-title', s.exerciseName),
          el('div.row-sub', `${s.reps} reps${s.durationMs ? ` · ${fmtDuration(s.durationMs)}` : ''}${s.notes ? ` · ${s.notes.slice(0, 24)}` : ''}`),
        ),
        typeof s.score === 'number' ? el(`span.pill.${scoreClass(s.score)}`, `${s.score}%`) : null,
        el('button.icon-btn', {
          'aria-label': 'Remove set',
          onclick: async () => {
            const ok = await confirmSheet({ title: 'Remove this set?', confirmText: 'Remove', danger: true });
            if (!ok) return;
            removeSet(s.id);
            paintSession();
          },
        }, icon('close')),
      ))),
      el('div.btn-row.mt-12', null,
        el('button.btn', {
          onclick: async () => {
            const ok = await confirmSheet({
              title: 'Discard this session?',
              message: 'Nothing will be saved.',
              confirmText: 'Discard',
              danger: true,
            });
            if (!ok) return;
            discardSession();
            paintSession();
            toast('Session discarded');
          },
        }, 'Discard'),
        el('button.btn.btn-primary', {
          onclick: async () => {
            const saved = await finishSession();
            if (!saved) return;
            toast('Session saved', 'good');
            navigate(`/session/${saved.id}`);
          },
        }, icon('check'), 'Finish & save'),
      ),
    ));
  }

  node.append(
    el('div.section', null,
      el('div.section-head', null, el('h2', 'Client')),
      clientBtn,
    ),
    el('div.section', null,
      el('div.section-head', null, el('h2', 'Mode')),
      el('div.btn-row', null,
        el('button.card', {
          style: { padding: '15px 13px', textAlign: 'left', cursor: 'pointer', margin: 0, borderColor: 'var(--gold-line)', background: 'var(--gold-wash)' },
        },
          el('div', { style: { fontSize: '15px', fontWeight: '650' } }, 'Form analysis'),
          el('div.tiny.muted', { style: { marginTop: '3px' } }, 'Reps, angles, scoring'),
        ),
        el('button.card', {
          onclick: () => navigate('/speed'),
          style: { padding: '15px 13px', textAlign: 'left', cursor: 'pointer', margin: 0 },
        },
          el('div', { style: { fontSize: '15px', fontWeight: '650' } }, 'Speed & output'),
          el('div.tiny.muted', { style: { marginTop: '3px' } }, 'Rounds, strikes, m/s'),
        ),
      ),
    ),
    el('div.section', null,
      el('div.section-head', null, el('h2', 'Exercise')),
      grid,
      setupCard,
    ),
    sessionBox,
    el('button.btn.btn-primary.btn-lg.btn-block.mt-24', {
      onclick: () => {
        if (!getActive()) startSession({ clientId, clientName: client?.name || '' });
        navigate(`/live?ex=${exerciseId}`);
      },
    }, icon('camera'), 'Start live analysis'),
    el('p.tiny.muted.center.mt-12', { style: { lineHeight: '1.55' } },
      'Camera stays on your device. Nothing is uploaded or recorded.'),
  );

  paintClient();
  paintExercises();
  paintSetup();
  paintSession();

  return {
    title: 'Train',
    subtitle: session ? 'Session in progress' : 'Set up your analysis',
    node,
  };
}

function initialsOf(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

function hudLabel(key) {
  return ({
    knee: 'Knee angle', kneeFront: 'Front knee', kneeRear: 'Rear knee', hip: 'Hip angle',
    ankle: 'Ankle angle', shoulder: 'Shoulder angle', elbow: 'Elbow angle',
    torsoLean: 'Torso lean', torsoFromHorizontal: 'Hinge angle', neck: 'Neck',
    plank: 'Body line', shin: 'Shin angle', cadence: 'Cadence',
  })[key] || key;
}
