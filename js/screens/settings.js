import { el, icon, toast, confirmSheet, pickSheet } from '../ui.js';
import { getSettings, setSetting, exportAll, importAll, clearAll, estimateUsage } from '../store.js';
import { install, promptInstall } from '../main.js';
import { isStandalone, isIOS } from '../camera.js';
import { poseEngine } from '../pose/landmarker.js';
import { navigate } from '../router.js';

export async function render() {
  const settings = await getSettings();
  const usage = await estimateUsage();

  const node = el('div');

  /* ------------------------------------------------------------ camera */
  node.append(section('Analysis', el('div.card', null,
    row('Model quality', settings.modelQuality === 'full' ? 'Full — more accurate' : 'Lite — fastest', async () => {
      const picked = await pickSheet({
        title: 'Movement model',
        sub: 'Lite is recommended on mid-range phones. Full is more precise but needs more power.',
        options: [
          { value: 'lite', title: 'Lite', sub: 'Fastest, smoothest preview', emoji: '⚡' },
          { value: 'full', title: 'Full', sub: 'More accurate joints, heavier', emoji: '🎯' },
        ],
        value: settings.modelQuality,
      });
      if (!picked || picked === settings.modelQuality) return;
      await setSetting('modelQuality', picked);
      poseEngine.close();
      toast('Model updated — it loads next time you start');
      navigate('/settings');
    }),
    toggle('Skeleton overlay', 'Draw the tracked body on the camera', settings.showSkeleton,
      (v) => setSetting('showSkeleton', v)),
    toggle('Angle labels', 'Show joint angles on the overlay', settings.showAngles,
      (v) => setSetting('showAngles', v)),
    toggle('Haptic feedback', 'Buzz on each completed rep', settings.haptics,
      (v) => setSetting('haptics', v)),
    toggle('Keep screen awake', 'Stops the phone sleeping mid-set', settings.keepAwake,
      (v) => setSetting('keepAwake', v)),
  )));

  /* --------------------------------------------------------------- app */
  const appCard = el('div.card');
  if (!isStandalone) {
    appCard.append(install.available
      ? row('Install app', 'Add Krysaril to your home screen', async () => {
        const ok = await promptInstall();
        if (ok) toast('Installing…', 'good');
      })
      : row('Add to home screen', isIOS ? 'Share → Add to Home Screen' : 'Browser menu → Install app', () => {
        toast(isIOS
          ? 'In Safari: tap Share, then Add to Home Screen'
          : 'Open the browser menu and choose Install app', '', 4200);
      }));
  } else {
    appCard.append(row('Installed', 'Running as a home-screen app', null));
  }
  appCard.append(row('How it works', 'Methods, accuracy and limits', () => navigate('/about')));
  node.append(section('App', appCard));

  /* -------------------------------------------------------------- data */
  node.append(section('Your data', el('div.card', null,
    row('Export backup', 'Download everything as a JSON file', async () => {
      try {
        const data = await exportAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: `krysaril-backup-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast('Backup downloaded', 'good');
      } catch (err) {
        console.error(err);
        toast('Export failed', 'bad');
      }
    }),
    importRow(),
    row('Delete everything', 'Clients, sessions, assessments and scans on this device', async () => {
      const ok = await confirmSheet({
        title: 'Delete all data?',
        message: 'Every client, session, assessment and scan stored on this device will be removed. This cannot be undone.',
        confirmText: 'Delete everything',
        danger: true,
      });
      if (!ok) return;
      await clearAll();
      toast('All data deleted');
      navigate('/');
    }, true),
  )));

  if (usage?.usage) {
    node.append(el('p.tiny.muted.center.mt-12',
      `${formatBytes(usage.usage)} used on this device${usage.quota ? ` of ${formatBytes(usage.quota)} available` : ''}`));
  }

  node.append(el('p.tiny.muted.center.mt-24', { style: { lineHeight: '1.6' } },
    'Krysaril · everything runs on-device',
    el('br'),
    'Wellness guidance only — not medical advice.'));

  return { title: 'Settings', node };
}

function section(title, card) {
  return el('div.section', null, el('div.section-head', el('h2', title)), card);
}

function row(title, sub, onclick, danger = false) {
  return el('button', {
    onclick: onclick || undefined,
    disabled: !onclick,
    style: {
      display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
      minHeight: '56px', padding: '10px 0', background: 'none', border: 'none',
      borderBottom: '1px solid var(--line-soft)', textAlign: 'left',
      cursor: onclick ? 'pointer' : 'default', opacity: onclick ? 1 : .8,
    },
  },
    el('div', { style: { flex: 1 } },
      el('div', { style: { fontSize: '15px', fontWeight: '620', color: danger ? 'var(--bad)' : undefined } }, title),
      el('div.tiny.muted', { style: { marginTop: '2px' } }, sub),
    ),
    onclick ? el('span.row-chev', icon('chev')) : null,
  );
}

function toggle(title, desc, value, onChange) {
  const btn = el('button.toggle', { role: 'switch', 'aria-checked': String(!!value), 'aria-label': title });
  btn.onclick = async () => {
    const next = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(next));
    await onChange(next);
  };
  return el('div.switch', { style: { borderBottom: '1px solid var(--line-soft)' } },
    el('div', { style: { flex: 1 } },
      el('div.switch-label', title),
      el('div.switch-desc', desc),
    ),
    btn,
  );
}

function importRow() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const counts = await importAll(JSON.parse(await file.text()));
      toast(`Imported ${counts.clients} clients and ${counts.sessions + counts.scans + counts.postures + counts.bodyscans + counts.rounds} records`, 'good', 4000);
      navigate('/');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Import failed', 'bad');
    } finally {
      input.value = '';
    }
  };
  const node = row('Restore backup', 'Merge a previously exported file', () => input.click());
  node.append(input);
  return node;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
