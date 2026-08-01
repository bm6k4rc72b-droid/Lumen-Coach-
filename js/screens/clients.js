import { el, icon, sheet, toast, initials, relDay } from '../ui.js';
import { listClients, saveClient, setSetting } from '../store.js';
import { navigate } from '../router.js';

export async function render() {
  const node = el('div');
  const list = el('div.list');
  const search = el('input.input', { type: 'search', placeholder: 'Search clients', 'aria-label': 'Search clients' });

  let clients = await listClients();

  function paint(filter = '') {
    const q = filter.trim().toLowerCase();
    const shown = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
    list.replaceChildren();
    if (!shown.length) {
      list.append(el('div.empty', null,
        el('h3', q ? 'No matches' : 'No clients yet'),
        el('p', q
          ? 'Try a different name.'
          : 'Clients keep every session, form score and skin scan together in one place.'),
        q ? null : el('button.btn.btn-primary', { onclick: add }, icon('plus'), 'Add your first client'),
      ));
      return;
    }
    for (const c of shown) {
      list.append(el('a.row', { href: `#/client/${c.id}` },
        el('div.avatar', initials(c.name)),
        el('div.row-main', null,
          el('div.row-title', c.name),
          el('div.row-sub', [
            c.lastActiveAt ? `Active ${relDay(c.lastActiveAt)}` : 'New',
            c.notes ? c.notes.split('\n')[0].slice(0, 44) : null,
          ].filter(Boolean).join(' · ')),
        ),
        el('span.row-chev', icon('chev')),
      ));
    }
  }

  search.addEventListener('input', () => paint(search.value));

  async function add() {
    const created = await clientSheet();
    if (!created) return;
    clients = await listClients();
    // Whoever you just added is almost certainly who you are about to work
    // with, so make them the active client for sessions and scans.
    await setSetting('activeClientId', created.id);
    paint(search.value);
    toast(`${created.name} added`, 'good');
    navigate(`/client/${created.id}`);
  }

  node.append(
    el('div', { style: { marginBottom: '14px' } }, search),
    list,
    el('button.btn.btn-primary.btn-lg.btn-block.mt-16', { onclick: add }, icon('plus'), 'Add client'),
  );

  paint();

  return {
    title: 'Clients',
    subtitle: `${clients.length} ${clients.length === 1 ? 'person' : 'people'}`,
    node,
  };
}

/** Shared create/edit sheet. Resolves with the saved client, or undefined. */
export function clientSheet(existing = null) {
  return sheet((close) => {
    const name = el('input.input', { value: existing?.name || '', placeholder: 'e.g. Priya Shah', autocapitalize: 'words' });
    const height = el('input.input', {
      type: 'number', inputmode: 'numeric', min: '100', max: '230',
      value: existing?.heightCm || '', placeholder: '170',
    });
    const goals = el('input.input', { value: existing?.goals || '', placeholder: 'e.g. Strength + running form' });
    const notes = el('textarea.textarea', { placeholder: 'Injuries, preferences, anything worth remembering…' }, existing?.notes || '');

    const save = async () => {
      if (!name.value.trim()) { name.focus(); toast('A name helps you find them later', 'bad'); return; }
      const saved = await saveClient({
        id: existing?.id,
        name: name.value,
        heightCm: height.value ? Number(height.value) : null,
        goals: goals.value,
        notes: notes.value,
      });
      close(saved);
    };

    return el('div', null,
      el('h2', existing ? 'Edit client' : 'New client'),
      el('p.sub', existing ? 'Update their details.' : 'Only a name is required — the rest helps tailor the analysis.'),
      el('label.field', null, el('span', 'Name'), name),
      el('label.field', null, el('span', 'Height (cm) — improves running speed estimates'), height),
      el('label.field', null, el('span', 'Goals'), goals),
      el('label.field', null, el('span', 'Notes'), notes),
      el('div.stack.mt-8', null,
        el('button.btn.btn-primary.btn-lg.btn-block', { onclick: save }, existing ? 'Save changes' : 'Create client'),
        el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => close(undefined) }, 'Cancel'),
      ),
    );
  });
}
