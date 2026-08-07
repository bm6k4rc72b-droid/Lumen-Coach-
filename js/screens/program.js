import { el, icon, fmtDate, confirmSheet, toast } from '../ui.js';
import { getProgram, deleteProgram, saveProgram } from '../store.js';
import { PROGRAM_DISCLAIMER } from '../program/engine.js';
import { navigate, back } from '../router.js';

export async function render({ params }) {
  const rec = await getProgram(params.id);
  if (!rec?.program) {
    return {
      title: 'Not found',
      back: '/coach',
      node: el('div.empty', null,
        el('h3', 'This program no longer exists'),
        el('a.btn.btn-primary', { href: '#/coach' }, 'Back to coach')),
    };
  }
  const p = rec.program;
  const node = el('div');

  /* ---------------------------------------------------------- header */
  node.append(el('div.hero', null,
    el('div.overline', { style: { marginBottom: '10px' } }, p.short.title),
    el('h2', p.priorities.length
      ? `Fix ${p.priorities[0].title.toLowerCase()} first.`
      : 'Build the base.'),
    el('p', p.short.subtitle),
  ));

  /* ------------------------------------------------ clinical first */
  if (p.clinicalFlags.length) {
    node.append(el('div.card.mt-12', {
      style: { borderColor: 'rgba(217,122,114,.45)', background: 'rgba(217,122,114,.07)' },
    },
      el('div', { style: { fontWeight: '700', color: 'var(--bad)', marginBottom: '8px' } }, 'Clear these with a clinician first'),
      el('p.small', { style: { margin: 0, lineHeight: '1.65', color: 'var(--text-dim)' } },
        'The program deliberately works around these rather than through them.'),
      el('div.mt-12', ...p.clinicalFlags.map((f) => el('div', {
        style: { padding: '7px 0', borderTop: '1px solid var(--hairline)' },
      },
        el('div.small', { style: { fontWeight: '620' } }, f.title),
        el('div.tiny.muted', { style: { marginTop: '2px' } }, f.detail),
      ))),
    ));
  }

  if (p.recoveryLimited) {
    node.append(el('div.card.mt-12', { style: { borderColor: 'var(--gold-line)' } },
      el('div', { style: { fontWeight: '650', color: 'var(--gold-bright)', marginBottom: '6px' } }, 'Recovery is the limiter'),
      el('p.small.muted', { style: { margin: 0, lineHeight: '1.65' } },
        'Training volume has been reduced and the week rebuilt around two harder days. Push the volume back up once readiness recovers.'),
    ));
  }

  /* -------------------------------------------------------- priorities */
  if (p.priorities.length) {
    node.append(el('div.section-head.mt-24', el('h2', 'Why this program')));
    node.append(el('div.card', null, ...p.priorities.map((f, i) => el('div', {
      style: { display: 'flex', gap: '13px', padding: '11px 0', borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' },
    },
      el('div', {
        style: {
          width: '24px', height: '24px', flex: 'none', display: 'grid', placeItems: 'center',
          borderRadius: '8px', background: 'var(--gold-wash)', color: 'var(--gold-bright)',
          fontSize: '12px', fontWeight: '700',
        },
      }, String(i + 1)),
      el('div', { style: { flex: 1 } },
        el('div', { style: { fontWeight: '620', fontSize: '14.5px' } }, f.title),
        el('div.tiny.muted', { style: { marginTop: '3px', lineHeight: '1.5' } }, f.detail),
      ),
      el('span.pill.warn', domainLabel(f.domain)),
    ))));
  }

  /* ------------------------------------------------------- the blocks */
  node.append(el('div.section-head.mt-24', el('h2', 'The work')));
  for (const b of p.short.blocks) {
    node.append(el('div.card', { style: { marginBottom: '10px' } },
      el('div.spread', null,
        el('div', { style: { fontWeight: '660' } }, b.title),
        el('span.pill.gold', b.frequency),
      ),
      el('div.tiny.muted', { style: { marginTop: '4px' } }, `For: ${b.because}`),
      el('ul.tips', { style: { margin: '12px 0 0', paddingLeft: '20px' } },
        ...b.items.map((i) => el('li', i))),
    ));
  }

  /* ---------------------------------------------------------- the week */
  node.append(el('div.section-head.mt-24', el('h2', 'A typical week')));
  const week = el('div.card');
  p.short.week.forEach((d, i) => {
    week.append(el('div', {
      style: {
        display: 'flex', gap: '13px', alignItems: 'flex-start', padding: '11px 0',
        borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
      },
    },
      el('div', { style: { width: '76px', flex: 'none' } },
        el('div.small', { style: { fontWeight: '650' } }, d.day.slice(0, 3)),
        el('div.tiny', {
          style: { marginTop: '2px', color: d.kind === 'Train' ? 'var(--gold)' : 'var(--text-faint)' },
        }, d.kind),
      ),
      el('div', { style: { flex: 1 } }, d.blocks.length
        ? d.blocks.map((b) => el('div.small.dim', { style: { padding: '2px 0' } }, b))
        : el('div.tiny.muted', 'Full rest')),
    ));
  });
  node.append(week);

  /* -------------------------------------------------------- long arc */
  node.append(el('div.section-head.mt-24', el('h2', p.long.title)));
  for (const phase of p.long.phases) {
    node.append(el('div.card', { style: { marginBottom: '10px' } },
      el('div.spread', null,
        el('div', null,
          el('div.overline', `Weeks ${phase.weeks}`),
          el('div', { style: { fontFamily: 'var(--serif)', fontSize: '19px', marginTop: '5px' } }, phase.name),
        ),
      ),
      el('p.small.muted', { style: { margin: '10px 0 0', lineHeight: '1.65' } }, phase.aim),
      el('div.wrap.mt-12', null, ...phase.focus.map((f) => el('span.chip', { style: { pointerEvents: 'none' } }, f))),
      el('div.tiny.muted', { style: { marginTop: '11px' } }, phase.intensity),
    ));
  }

  /* ---------------------------------------------------------- habits */
  if (p.habits.length) {
    node.append(el('div.section-head.mt-24', el('h2', 'Habits that matter most')));
    node.append(el('div.card', el('ul.tips', { style: { margin: 0, paddingLeft: '20px' } },
      ...p.habits.map((h) => el('li', h)))));
  }

  /* --------------------------------------------------------- rescan */
  if (p.rescan.length) {
    node.append(el('div.section-head.mt-24', el('h2', 'Re-measure')));
    node.append(el('div.card', null, ...p.rescan.map((r, i) => el('div', {
      style: { padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' },
    },
      el('div.spread', null,
        el('span.small', { style: { fontWeight: '620' } }, r.what),
        el('span.pill.neutral', r.when),
      ),
      el('div.tiny.muted', { style: { marginTop: '4px' } }, r.why),
    ))));
  }

  /* ----------------------------------------------------------- notes */
  const notes = el('textarea.textarea', { placeholder: 'Adjustments, injuries, what you actually did…' }, rec.notes || '');
  let t = null;
  notes.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      await saveProgram({ ...rec, notes: notes.value });
      toast('Notes saved', 'good', 1400);
    }, 900);
  });
  node.append(el('div.section', null, el('div.section-head', el('h2', 'Notes')), notes));

  node.append(el('div.disclaimer.mt-16', icon('info'), el('span', PROGRAM_DISCLAIMER)));

  node.append(el('div.btn-row.mt-16', null,
    el('button.btn', { onclick: () => navigate('/coach') }, 'Back to coach'),
    el('button.btn.btn-danger', {
      onclick: async () => {
        if (!await confirmSheet({ title: 'Delete this program?', confirmText: 'Delete', danger: true })) return;
        await deleteProgram(rec.id);
        toast('Program deleted');
        back('/coach');
      },
    }, icon('trash'), 'Delete'),
  ));

  return {
    title: 'Program',
    subtitle: `${fmtDate(rec.createdAt)}${rec.clientName ? ` · ${rec.clientName}` : ''}`,
    back: () => back('/coach'),
    node,
  };
}

function domainLabel(d) {
  return ({
    posture: 'Posture', body: 'Body', movement: 'Movement',
    recovery: 'Recovery', skin: 'Skin', labs: 'Bloods',
  })[d] || d;
}
