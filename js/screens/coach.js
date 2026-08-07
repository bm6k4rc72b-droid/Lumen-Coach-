import { el, icon, toast, sheet, relDay, fmtDate } from '../ui.js';
import { loadKnowledge, knowledgeStatus, suggestedTopics } from '../assistant/knowledge.js';
import { ask, hasApiKey, setApiKey, getApiKey, ASSISTANT_DISCLAIMER, MODEL } from '../assistant/chat.js';
import {
  voiceSupport, Listener, speak, cancelSpeech, primeSpeech, spokenSummary,
} from '../assistant/voice.js';
import { buildProgram, programSummary } from '../program/engine.js';
import { getSettings, setSetting, listClients, getClient, latestFor, saveProgram } from '../store.js';
import { navigate } from '../router.js';

export async function render() {
  const settings = await getSettings();
  const clients = await listClients();
  let clientId = settings.activeClientId && clients.some((c) => c.id === settings.activeClientId)
    ? settings.activeClientId : null;
  let client = clientId ? await getClient(clientId) : null;
  let data = await latestFor(clientId);
  let voiceMode = false;

  const kb = await loadKnowledge();

  const node = el('div');

  /* ------------------------------------------------------------ header */
  const clientChip = el('button.chip');
  function paintChip() {
    clientChip.textContent = client ? `● ${client.name}` : '○ Unassigned';
  }
  clientChip.onclick = async () => {
    const { pickSheet } = await import('../ui.js');
    const picked = await pickSheet({
      title: 'Who are we coaching?',
      options: [
        { value: '__none', title: 'Unassigned', sub: 'General history', emoji: '○' },
        ...clients.map((c) => ({ value: c.id, title: c.name, sub: c.goals || 'Client', emoji: '●' })),
      ],
      value: clientId || '__none',
    });
    if (picked === undefined) return;
    clientId = picked === '__none' ? null : picked;
    client = clientId ? await getClient(clientId) : null;
    await setSetting('activeClientId', clientId);
    data = await latestFor(clientId);
    paintChip();
    paintProgramCard();
    transcript.replaceChildren(welcome());
  };
  paintChip();

  /* ----------------------------------------------------- program card */
  const programCard = el('div');
  function paintProgramCard() {
    const p = data.program?.program || null;
    programCard.replaceChildren(
      el('div.section-head', null,
        el('h2', 'Your program'),
        p ? el('button', { onclick: regenerate }, 'Regenerate') : null,
      ),
      p
        ? el('button.card.card-gold', {
          onclick: () => navigate(`/program/${data.program.id}`),
          style: { display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' },
        },
          el('div.spread', null,
            el('div', { style: { flex: 1, minWidth: 0 } },
              el('div', { style: { fontWeight: '660', fontSize: '16px' } }, p.short.title),
              el('div.tiny.muted', { style: { marginTop: '4px' } }, programSummary(p)),
            ),
            el('span.row-chev', icon('chev')),
          ),
          el('div.wrap.mt-12', null,
            ...p.short.blocks.slice(0, 3).map((b) => el('span.chip', { style: { pointerEvents: 'none' } }, b.title))),
          el('div.tiny.muted', { style: { marginTop: '12px' } }, `Built ${relDay(data.program.createdAt)}`),
        )
        : el('div.card', null,
          el('p.small.dim', { style: { margin: '0 0 14px', lineHeight: '1.7' } },
            countMeasured(data)
              ? 'Krysaril can build a 4-week block and a 12-week arc from what you have measured so far.'
              : 'Run a posture assessment, a body scan or a few training sessions first — the program is built from your own results, not from a template.'),
          el('button.btn.btn-primary.btn-block', {
            onclick: regenerate, disabled: !countMeasured(data),
          }, 'Build my program'),
        ),
    );
  }

  async function regenerate() {
    data = await latestFor(clientId);
    const program = buildProgram({
      client,
      posture: data.posture,
      body: data.body,
      sessions: data.sessions,
      skin: data.skin,
      vitals: data.vitals,
      labs: data.labs,
    });
    const saved = await saveProgram({ clientId, clientName: client?.name || '', program });
    data.program = saved;
    toast('Program built', 'good');
    navigate(`/program/${saved.id}`);
  }

  /* ------------------------------------------------------- transcript */
  const transcript = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

  function bubble(role, text, meta) {
    const mine = role === 'user';
    return el('div', {
      style: {
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '88%',
        padding: '13px 16px',
        borderRadius: mine ? '18px 18px 6px 18px' : '18px 18px 18px 6px',
        background: mine ? 'var(--gold-wash)' : 'var(--surface)',
        border: `1px solid ${mine ? 'var(--gold-line)' : 'var(--hairline)'}`,
        fontSize: '14.5px',
        lineHeight: '1.65',
        whiteSpace: 'pre-wrap',
        color: mine ? 'var(--gold-bright)' : 'var(--text)',
      },
    },
      text,
      meta ? el('div.tiny.muted', { style: { marginTop: '9px', opacity: .8 } }, meta) : null,
    );
  }

  function welcome() {
    const topics = suggestedTopics(kb.entries, 6);
    return el('div', null,
      bubble('coach',
        client
          ? `I have ${countMeasured(data)} assessment${countMeasured(data) === 1 ? '' : 's'} for ${client.name}. Ask me anything — how they are progressing, what to prioritise, or any topic below.`
          : 'Ask me about your training, your scans, or anything below. I answer from your own measurements first.'),
      el('div.wrap.mt-12', null, ...topics.map((t) => el('button.chip', {
        onclick: () => submit(t),
      }, t))),
    );
  }

  transcript.append(welcome());

  /* ------------------------------------------------------------ input */
  const field = el('input.input', {
    type: 'text', placeholder: 'Ask the coach…', autocomplete: 'off',
    'aria-label': 'Ask the coach a question',
  });
  const sendBtn = el('button.btn.btn-primary', { 'aria-label': 'Send' }, icon('chev'));
  const micBtn = el('button.btn', { 'aria-label': 'Speak your question' }, micIcon());

  const inputRow = el('div', {
    style: { display: 'flex', gap: '8px', alignItems: 'stretch', marginTop: '16px' },
  },
    el('div', { style: { flex: 1 } }, field),
    voiceSupport.listen ? micBtn : null,
    sendBtn,
  );

  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(field.value); });
  sendBtn.onclick = () => submit(field.value);

  let busy = false;
  async function submit(question) {
    const q = String(question || '').trim();
    if (!q || busy) return;
    busy = true;
    field.value = '';
    cancelSpeech();

    transcript.append(bubble('user', q));
    const thinking = bubble('coach', '…');
    transcript.append(thinking);
    scrollDown();

    try {
      const answer = await ask(q, { client, ...data, program: data.program?.program });
      const label = { data: 'From your records', kb: `Knowledge base v${kb.version}`, claude: `Claude · ${MODEL}`, none: null }[answer.engine];
      thinking.replaceWith(bubble('coach', answer.text, label));
      if (voiceMode) await speak(spokenSummary(answer.text));
    } catch (err) {
      console.error(err);
      thinking.replaceWith(bubble('coach', 'Something went wrong answering that. Try again.'));
    } finally {
      busy = false;
      scrollDown();
    }
  }

  function scrollDown() {
    requestAnimationFrame(() => {
      transcript.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  /* ------------------------------------------------------------ voice */
  let listener = null;
  micBtn.onclick = () => {
    primeSpeech();
    if (listener?.listening) { listener.stop(); return; }
    micBtn.classList.add('btn-primary');
    field.placeholder = 'Listening…';
    listener = new Listener({
      onPartial: (t) => { field.value = t; },
      onResult: (t) => submit(t),
      onEnd: () => {
        micBtn.classList.remove('btn-primary');
        field.placeholder = 'Ask the coach…';
      },
      onError: (err) => {
        micBtn.classList.remove('btn-primary');
        field.placeholder = 'Ask the coach…';
        toast(err.message, 'bad', 3600);
      },
    });
    listener.start();
  };

  const voiceToggle = el('button.chip', {
    onclick: () => {
      voiceMode = !voiceMode;
      voiceToggle.classList.toggle('on', voiceMode);
      voiceToggle.textContent = voiceMode ? '🔊 Voice replies on' : '🔈 Voice replies off';
      if (voiceMode) { primeSpeech(); speak('Voice replies on.'); } else cancelSpeech();
    },
  }, '🔈 Voice replies off');

  /* --------------------------------------------------------- controls */
  const status = knowledgeStatus();
  const kbLine = el('p.tiny.muted.center.mt-12', { style: { lineHeight: '1.6' } },
    `Knowledge base v${status?.version || '—'} · ${status?.entries || 0} topics · `,
    status?.source === 'network' ? 'refreshed just now' : 'using the last downloaded copy',
    el('br'),
    hasApiKey() ? 'Claude connected for open questions' : 'Offline answers only — connect Claude in Settings for open questions',
  );

  node.append(
    el('div.spread', { style: { marginBottom: '14px' } },
      clientChip,
      el('div.wrap', null, voiceSupport.speak ? voiceToggle : null,
        el('button.chip', { onclick: () => keySheet(() => navigate('/coach')) }, hasApiKey() ? '🔑 Claude on' : '🔑 Connect Claude')),
    ),
    programCard,
    el('div.section', null,
      el('div.section-head', null,
        el('h2', 'Coach'),
        el('button', { onclick: () => transcript.replaceChildren(welcome()) }, 'Clear'),
      ),
      transcript,
      inputRow,
      kbLine,
    ),
    el('div.section', null,
      el('div.section-head', el('h2', 'Assessments feeding this')),
      el('div.list', null,
        dataRow('Posture', data.posture, (d) => `${d.view === 'side' ? 'Side' : 'Front'} view · ${d.overall}`, '/posture'),
        dataRow('Body', data.body, (d) => d.measurement?.ratios?.waistToHeight ? `WHtR ${d.measurement.ratios.waistToHeight.toFixed(2)}` : 'Measured', '/body'),
        dataRow('Recovery', data.vitals, (d) => `${d.bpm} bpm${d.readiness ? ` · readiness ${d.readiness}` : ''}`, '/vitals'),
        dataRow('Bloods', data.labs, (d) => `${d.panel?.measured || 0} markers · ${d.panel?.outOfRange?.length || 0} outside range`, '/labs'),
        dataRow('Skin', data.skin, (d) => `Overall ${d.overall}`, '/skin'),
      ),
    ),
    el('div.disclaimer.mt-24', icon('info'), el('span', ASSISTANT_DISCLAIMER)),
  );

  paintProgramCard();

  return {
    title: 'Coach',
    subtitle: client ? client.name : 'Program & assistant',
    node,
    destroy() { cancelSpeech(); listener?.abort(); },
  };
}

function countMeasured(data) {
  return [data.posture, data.body, data.vitals, data.labs, data.skin, data.sessions?.length]
    .filter(Boolean).length;
}

function dataRow(label, record, describe, route) {
  return el('button.row', { onclick: () => navigate(record ? route : route) },
    el('div.avatar.avatar-quiet', { style: { fontSize: '9.5px', letterSpacing: '.06em' } },
      label.slice(0, 4).toUpperCase()),
    el('div.row-main', null,
      el('div.row-title', label),
      el('div.row-sub', record ? `${describe(record)} · ${fmtDate(record.createdAt || record.startedAt)}` : 'Not measured yet'),
    ),
    record
      ? el('span.pill.gold', 'In use')
      : el('span.pill.neutral', 'Add'),
  );
}

function micIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    + '<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  return s;
}

/** Bring-your-own-key sheet. The key never leaves this device except to Anthropic. */
export function keySheet(onDone = () => {}) {
  return sheet((close) => {
    const input = el('input.input', {
      type: 'password', placeholder: 'sk-ant-…', value: getApiKey() || '',
      autocomplete: 'off', spellcheck: 'false',
    });
    return el('div', null,
      el('h2', 'Connect Claude'),
      el('p.sub', 'Optional. Krysaril answers from your own data and its knowledge base without this — '
        + 'connecting Claude only adds open-ended questions outside those topics.'),
      el('div.disclaimer', { style: { marginBottom: '16px' } }, icon('info'),
        el('span', 'Your key is stored in this browser only and is sent directly to Anthropic, never to us or anyone else. '
          + 'Because this app is a public static site, do not use a key you share with other people — '
          + 'create a dedicated one you can revoke.')),
      el('label.field', null, el('span', 'Anthropic API key'), input),
      el('div.stack', null,
        el('button.btn.btn-primary.btn-lg.btn-block', {
          onclick: () => { setApiKey(input.value); toast(input.value ? 'Claude connected' : 'Key removed', 'good'); close(true); onDone(); },
        }, 'Save'),
        getApiKey()
          ? el('button.btn.btn-lg.btn-block.btn-danger', {
            onclick: () => { setApiKey(null); toast('Key removed'); close(true); onDone(); },
          }, 'Remove key')
          : null,
        el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => close(false) }, 'Cancel'),
      ),
    );
  });
}
