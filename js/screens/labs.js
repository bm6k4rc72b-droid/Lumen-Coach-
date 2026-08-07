import { el, icon, toast, confirmSheet, pickSheet } from '../ui.js';
import {
  MARKERS, MARKER_GROUPS, evaluatePanel, rangeFor, LABS_DISCLAIMER,
} from '../labs/panel.js';
import { listClients, getClient, getSettings, setSetting, saveLabs, listLabs, saveClient } from '../store.js';
import { navigate } from '../router.js';

export async function render() {
  const settings = await getSettings();
  const clients = await listClients();
  let clientId = settings.activeClientId && clients.some((c) => c.id === settings.activeClientId)
    ? settings.activeClientId : null;
  let client = clientId ? await getClient(clientId) : null;
  let sex = client?.sex || null;

  const previous = (await listLabs(clientId, 1))[0] || null;
  const values = { ...(previous?.values || {}) };
  const inputs = new Map();

  const node = el('div');

  /* ---------------------------------------------------------- header */
  node.append(el('div.hero', null,
    el('div.overline', { style: { marginBottom: '10px' } }, 'Blood work'),
    el('h2', 'Enter what your report says'),
    el('p', 'Krysaril compares each value against standard reference ranges and offers lifestyle '
      + 'context where lifestyle genuinely moves the marker. It does not interpret your panel — '
      + 'that is your doctor\'s job.'),
  ));

  /* ---------------------------------------------------- who and sex */
  const clientRow = el('button.row.mt-12');
  function paintClient() {
    clientRow.replaceChildren(
      el('div.avatar', { style: client ? null : { background: 'var(--surface-2)', color: 'var(--gold)' } },
        client ? initials(client.name) : '+'),
      el('div.row-main', null,
        el('div.row-title', client ? client.name : 'Unassigned'),
        el('div.row-sub', sex ? `Ranges shown for ${sex}` : 'Set sex — several ranges differ'),
      ),
      el('span.row-chev', icon('chev')),
    );
  }
  clientRow.onclick = async () => {
    const picked = await pickSheet({
      title: 'Whose bloods are these?',
      options: [
        { value: '__none', title: 'Unassigned', sub: 'Saves to general history', emoji: '○' },
        ...clients.map((c) => ({ value: c.id, title: c.name, sub: c.sex || 'No sex set', emoji: '●' })),
      ],
      value: clientId || '__none',
    });
    if (picked === undefined) return;
    clientId = picked === '__none' ? null : picked;
    client = clientId ? await getClient(clientId) : null;
    sex = client?.sex || null;
    await setSetting('activeClientId', clientId);
    paintClient();
    paintFields();
  };
  paintClient();
  node.append(clientRow);

  const sexRow = el('button.row.mt-8');
  function paintSex() {
    sexRow.replaceChildren(
      el('div.avatar.avatar-quiet', { style: { fontSize: '11px' } }, sex ? sex.slice(0, 1).toUpperCase() : '?'),
      el('div.row-main', null,
        el('div.row-title', sex ? (sex === 'female' ? 'Female ranges' : 'Male ranges') : 'Reference ranges'),
        el('div.row-sub', 'Ferritin, haemoglobin, HDL, ALT, creatinine and hormones all differ'),
      ),
      el('span.row-chev', icon('chev')),
    );
  }
  sexRow.onclick = async () => {
    const picked = await pickSheet({
      title: 'Which reference ranges?',
      sub: 'Several markers have different normal ranges.',
      options: [
        { value: 'female', title: 'Female', sub: 'Use female reference ranges', emoji: '♀' },
        { value: 'male', title: 'Male', sub: 'Use male reference ranges', emoji: '♂' },
        { value: '__none', title: 'Not specified', sub: 'Uses the wider combined range', emoji: '—' },
      ],
      value: sex || '__none',
    });
    if (picked === undefined) return;
    sex = picked === '__none' ? null : picked;
    if (client) client = await saveClient({ ...client, sex });
    paintSex();
    paintFields();
  };
  paintSex();
  node.append(sexRow);

  /* -------------------------------------------------------- the form */
  const form = el('div');

  function paintFields() {
    form.replaceChildren();
    for (const group of MARKER_GROUPS) {
      const markers = Object.values(MARKERS).filter((m) => m.group === group);
      const card = el('div.card');
      markers.forEach((m, i) => {
        const [lo, hi] = rangeFor(m, sex);
        const existing = inputs.get(m.id);
        const input = existing || el('input.input', {
          type: 'number', inputmode: 'decimal', step: 'any',
          placeholder: `${lo}–${hi}`,
          value: values[m.id] ?? '',
          'aria-label': m.label,
        });
        input.placeholder = `${lo}–${hi}`;
        input.oninput = () => {
          const v = input.value === '' ? undefined : Number(input.value);
          if (v === undefined || Number.isNaN(v)) delete values[m.id];
          else values[m.id] = v;
          updateCount();
        };
        inputs.set(m.id, input);

        card.append(el('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 0',
            borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
          },
        },
          el('div', { style: { flex: 1, minWidth: 0 } },
            el('div', { style: { fontSize: '14.5px', fontWeight: '620' } }, m.label),
            el('div.tiny.muted', { style: { marginTop: '3px' } }, `${lo}–${hi} ${m.unit}`),
          ),
          el('div', { style: { width: '104px', flex: 'none' } }, input),
        ));
      });
      form.append(el('div.section', null, el('div.section-head', el('h2', group)), card));
    }
  }

  const countLine = el('p.tiny.muted.center.mt-12');
  function updateCount() {
    const n = Object.keys(values).length;
    countLine.textContent = n ? `${n} marker${n === 1 ? '' : 's'} entered` : 'Enter only the markers on your report — blanks are ignored';
    analyseBtn.disabled = n === 0;
  }

  const analyseBtn = el('button.btn.btn-primary.btn-lg.btn-block.mt-16', { disabled: true },
    icon('check'), 'Assess panel');

  analyseBtn.onclick = async () => {
    const panel = evaluatePanel(values, { sex });
    if (!panel.measured) { toast('Enter at least one value', 'bad'); return; }
    try {
      const saved = await saveLabs({
        clientId,
        clientName: client?.name || '',
        sex,
        values,
        panel,
        notes: '',
      });
      toast('Panel saved', 'good');
      navigate(`/labsreport/${saved.id}`);
    } catch (err) {
      console.error(err);
      toast('Could not save', 'bad');
    }
  };

  paintFields();
  updateCount();

  node.append(form, analyseBtn, countLine);

  if (previous) {
    node.append(el('button.btn.btn-ghost.btn-block.mt-12', {
      onclick: () => navigate(`/labsreport/${previous.id}`),
    }, 'Open previous panel'));
  }

  node.append(el('div.disclaimer.mt-24', icon('info'), el('span', LABS_DISCLAIMER)));

  node.append(el('button.btn.btn-quiet.btn-block.mt-12', {
    onclick: async () => {
      if (!await confirmSheet({ title: 'Clear all entered values?', confirmText: 'Clear', danger: true })) return;
      for (const [id, input] of inputs) { input.value = ''; delete values[id]; }
      updateCount();
    },
  }, 'Clear form'));

  return { title: 'Labs', subtitle: 'Blood-work assessment', node };
}

function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}
