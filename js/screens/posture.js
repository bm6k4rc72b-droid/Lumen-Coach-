import { el, icon, toast, haptic, ring, pickSheet } from '../ui.js';
import { CameraController, FrameLoop, describeCameraError, cameraSupported, secureContextOk } from '../camera.js';
import { poseEngine } from '../pose/landmarker.js';
import { LandmarkSmoother } from '../pose/angles.js';
import { analyzePosture, detectPostureView, postureWork, MEASURES, POSTURE_DISCLAIMER } from '../posture/analyze.js';
import { renderPostureChart, chartThumbnail } from '../posture/render.js';
import { toPixels } from '../pose/angles.js';
import { getSettings, setSetting, listClients, getClient, savePosture, listPostures } from '../store.js';
import { navigate } from '../router.js';

export async function render() {
  const settings = await getSettings();
  const clients = await listClients();
  let clientId = settings.activeClientId && clients.some((c) => c.id === settings.activeClientId)
    ? settings.activeClientId : null;
  let client = clientId ? await getClient(clientId) : null;
  let view = 'side';
  let timerSec = 5;

  /* ------------------------------------------------------------- markup */
  const video = el('video', { playsinline: true, muted: true, autoplay: true, 'webkit-playsinline': '' });
  const stage = el('div.stage', video);

  const guide = el('div.guide', el('div.guide-plumb'), el('div.guide-body'),
    el('div.guide-hint', 'Stand side-on · whole body in frame · arms relaxed'));

  const closeBtn = el('button.icon-btn.solid', { 'aria-label': 'Close' }, icon('close'));
  const flipBtn = el('button.icon-btn.solid', { 'aria-label': 'Switch camera' }, icon('flip'));
  const viewChip = el('button.chip.on', { style: { pointerEvents: 'auto' } }, 'Side view');
  const readChip = el('span.chip', { style: { pointerEvents: 'none' } }, 'Finding you…');

  const topBar = el('div.cam-top', closeBtn,
    el('div', { style: { flex: 1, display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' } },
      viewChip, readChip),
    flipBtn);

  const shutter = el('button.shutter', { 'aria-label': 'Capture posture', disabled: true }, el('i'));
  const timerBtn = el('button.icon-btn.solid', { 'aria-label': 'Self timer' }, el('span', { style: { fontSize: '13px', fontWeight: '700' } }, `${timerSec}s`));
  const clientBtn = el('button.icon-btn.solid', { 'aria-label': 'Choose client' }, icon('person'));

  const captureBar = el('div.cam-bottom', null,
    el('div.glass', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', borderRadius: 'var(--r-lg)' },
    }, timerBtn, shutter, clientBtn),
    el('p.tiny', {
      style: { textAlign: 'center', margin: '11px 4px 0', color: 'rgba(242,237,228,.55)', lineHeight: '1.5' },
    }, 'Screening estimate from one photo — not a diagnosis.'),
  );

  const countdown = el('div', {
    style: {
      position: 'absolute', inset: 0, display: 'none', placeItems: 'center', zIndex: 7,
      fontFamily: 'var(--num)', fontSize: '96px', fontWeight: '800', color: 'var(--gold-bright)',
      textShadow: '0 4px 40px rgba(0,0,0,.8)', pointerEvents: 'none',
    },
  });

  const gate = el('div.perm');
  const captureView = el('div', { style: { position: 'absolute', inset: 0 } }, guide, topBar, captureBar, countdown, gate);
  stage.append(captureView);

  const resultView = el('div', {
    style: {
      position: 'absolute', inset: 0, overflowY: 'auto', display: 'none',
      background: 'var(--bg)', WebkitOverflowScrolling: 'touch',
      padding: 'calc(var(--safe-t) + 14px) calc(var(--pad) + var(--safe-r)) calc(var(--safe-b) + 30px) calc(var(--pad) + var(--safe-l))',
    },
  });

  const node = el('div', {
    style: { position: 'fixed', inset: 0, background: '#000', display: 'flex', flexDirection: 'column' },
  }, stage, resultView);

  /* -------------------------------------------------------------- state */
  const camera = new CameraController(video);
  const smoother = new LandmarkSmoother({ minCutoff: 1.4, beta: 0.02 });
  let loop = null;
  let destroyed = false;
  let lastLandmarks = null;
  let counting = false;

  const setGate = (content) => {
    if (content) gate.replaceChildren(content); else gate.replaceChildren();
    gate.hidden = !content;
  };
  const loading = (text) => el('div.perm-inner', el('div.loader'),
    el('p.mt-16', { style: { color: 'var(--text-dim)' } }, text));

  /* --------------------------------------------------------------- boot */
  async function boot() {
    setGate(loading('Starting the camera…'));
    if (!cameraSupported() || !secureContextOk()) {
      showError(describeCameraError({ name: secureContextOk() ? 'NotFoundError' : 'SecurityError' }), false);
      return;
    }
    try {
      await camera.start({ facing: settings.facing, quality: 'high' });
      stage.classList.toggle('mirror', camera.facing === 'user');
      if (settings.keepAwake) camera.requestWakeLock();
    } catch (err) {
      showError(describeCameraError(err));
      return;
    }
    if (destroyed) return;
    try {
      setGate(loading('Loading the movement model…'));
      await poseEngine.load(settings.modelQuality, (s) => setGate(loading(s)));
      await poseEngine.setSegmentation(false);
    } catch (err) {
      console.error(err);
      showError({
        title: 'Movement model unavailable',
        body: 'The pose model could not load. Check your connection and try again — it is cached after the first success.',
      });
      return;
    }
    if (destroyed) return;
    setGate(null);
    shutter.disabled = false;
    startLoop();
  }

  function showError({ title, body }, retry = true) {
    setGate(el('div.perm-inner', null,
      el('div', { style: { fontSize: '32px', marginBottom: '10px' } }, '📷'),
      el('h2', title),
      el('p', body),
      el('div.stack', null,
        retry ? el('button.btn.btn-primary.btn-lg.btn-block', { onclick: boot }, 'Try again') : null,
        el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => navigate('/scan') }, 'Go back'),
      ),
    ));
  }

  function startLoop() {
    loop?.stop();
    loop = new FrameLoop(video, onFrame);
    loop.minInterval = 100;          // a static pose needs no more than 10 fps
    loop.start();
  }

  function onFrame(mediaTime) {
    if (destroyed || !poseEngine.ready) return;
    const { width, height } = camera.dimensions;
    if (!width || !height) return;
    const raw = poseEngine.detect(video, mediaTime);
    if (raw === undefined) return;
    lastLandmarks = raw ? smoother.apply(raw, performance.now()) : null;

    if (!lastLandmarks) {
      readChip.textContent = 'Step into frame';
      return;
    }
    const px = toPixels(lastLandmarks, width, height);
    const seen = detectPostureView(px);
    const ready = coverageOk(px);
    readChip.textContent = !ready ? 'Show your whole body'
      : seen === view ? 'Ready — hold still' : `Detected ${seen} view`;
  }

  function coverageOk(px) {
    const need = [0, 11, 12, 23, 24, 25, 26, 27, 28];
    return need.every((i) => (px[i]?.v ?? 0) >= 0.45);
  }

  /* ------------------------------------------------------------ actions */
  viewChip.onclick = async () => {
    const picked = await pickSheet({
      title: 'Which view?',
      sub: 'Side view reads forward head, pelvic tilt and trunk lean. Front view reads levelness and knee tracking.',
      options: [
        { value: 'side', title: 'Side view', sub: 'Sagittal — the fuller assessment', emoji: '📐' },
        { value: 'front', title: 'Front view', sub: 'Levelness and knee tracking', emoji: '⚖️' },
      ],
      value: view,
    });
    if (!picked) return;
    view = picked;
    viewChip.textContent = view === 'side' ? 'Side view' : 'Front view';
    guide.querySelector('.guide-hint').textContent = view === 'side'
      ? 'Stand side-on · whole body in frame · arms relaxed'
      : 'Face the camera · feet hip-width · arms by your sides';
  };

  timerBtn.onclick = async () => {
    const picked = await pickSheet({
      title: 'Self timer',
      sub: 'Gives you time to step back and settle into a natural stance.',
      options: [
        { value: 0, title: 'Off', sub: 'Capture immediately', emoji: '⚡' },
        { value: 5, title: '5 seconds', sub: 'Enough to step back', emoji: '⏱' },
        { value: 10, title: '10 seconds', sub: 'Comfortable for solo scans', emoji: '⏳' },
      ],
      value: timerSec,
    });
    if (picked === undefined) return;
    timerSec = picked;
    timerBtn.replaceChildren(el('span', { style: { fontSize: '13px', fontWeight: '700' } }, timerSec ? `${timerSec}s` : 'off'));
  };

  clientBtn.onclick = async () => {
    const picked = await pickSheet({
      title: 'Save this assessment to…',
      options: [
        { value: '__none', title: 'Unassigned', sub: 'Saves to general history', emoji: '○' },
        ...clients.map((c) => ({ value: c.id, title: c.name, sub: c.heightCm ? `${c.heightCm} cm` : 'Client', emoji: '●' })),
      ],
      value: clientId || '__none',
    });
    if (picked === undefined) return;
    clientId = picked === '__none' ? null : picked;
    client = clientId ? await getClient(clientId) : null;
    await setSetting('activeClientId', clientId);
    toast(client ? `Saving to ${client.name}` : 'Saving to general history');
  };

  flipBtn.onclick = async () => {
    try {
      const facing = await camera.switchFacing();
      await setSetting('facing', facing);
      stage.classList.toggle('mirror', facing === 'user');
      smoother.reset();
      startLoop();
    } catch (err) { toast(describeCameraError(err).title, 'bad'); }
  };

  closeBtn.onclick = () => navigate('/scan');

  shutter.onclick = async () => {
    if (counting) return;
    if (!timerSec) { capture(); return; }
    counting = true;
    shutter.disabled = true;
    countdown.style.display = 'grid';
    for (let n = timerSec; n > 0; n--) {
      countdown.textContent = String(n);
      haptic(8);
      await new Promise((r) => setTimeout(r, 1000));
      if (destroyed) return;
    }
    countdown.style.display = 'none';
    counting = false;
    shutter.disabled = false;
    capture();
  };

  /* ----------------------------------------------------------- analysis */
  function capture() {
    const { width, height } = camera.dimensions;
    if (!lastLandmarks) { toast('No one detected in frame', 'bad'); return; }
    const frame = camera.captureFrame({ maxSize: 1280 });
    if (!frame) { toast('Camera is not ready', 'bad'); return; }
    haptic(16);

    const analysis = analyzePosture(lastLandmarks, width, height, { view });
    if (!Object.keys(analysis.measures).length) {
      toast('Could not read enough landmarks — try more space around you', 'bad');
      return;
    }
    const chart = renderPostureChart(frame, lastLandmarks, analysis);
    camera.stop();
    loop?.stop();
    showResults(analysis, chart);
  }

  async function showResults(analysis, chart) {
    const previous = (await listPostures(clientId, 1))[0] || null;
    captureView.style.display = 'none';
    stage.style.display = 'none';
    resultView.style.display = '';
    resultView.scrollTop = 0;
    resultView.replaceChildren(buildReport(analysis, chart, previous));
  }

  function resume() {
    resultView.style.display = 'none';
    resultView.replaceChildren();
    stage.style.display = '';
    captureView.style.display = '';
    if (!camera.active && !destroyed) boot();
  }

  function buildReport(analysis, chart, previous) {
    const wrap = el('div');
    const chartUrl = chart.toDataURL('image/jpeg', 0.9);

    wrap.append(el('div.spread', { style: { marginBottom: '16px' } },
      el('button.icon-btn.solid', { 'aria-label': 'Retake', onclick: resume }, icon('flip')),
      el('div', { style: { textAlign: 'center', flex: 1 } },
        el('div', { style: { fontFamily: 'var(--serif)', fontSize: '17px' } }, 'Posture assessment'),
        el('div.tiny.muted', `${analysis.view === 'side' ? 'Side view' : 'Front view'}${client ? ` · ${client.name}` : ''}`),
      ),
      el('button.icon-btn.solid', { 'aria-label': 'Close', onclick: () => navigate('/scan') }, icon('close')),
    ));

    wrap.append(el('div.card', { style: { padding: '10px' } },
      el('img', { src: chartUrl, alt: 'Annotated posture chart', style: { width: '100%', display: 'block', borderRadius: '14px' } }),
    ));

    const delta = previous && typeof previous.overall === 'number' && typeof analysis.overall === 'number'
      ? analysis.overall - previous.overall : null;

    wrap.append(el('div.card.card-gold.mt-12', { style: { textAlign: 'center' } },
      el('div.big-score', ring(analysis.overall, { size: 132, label: 'ALIGNMENT' })),
      el('p.small.muted', { style: { margin: '10px 0 0', lineHeight: '1.6' } },
        summaryLine(analysis)),
      delta !== null
        ? el('div.mt-12', el(`span.pill.${delta >= 0 ? 'good' : 'warn'}`,
          `${delta >= 0 ? '+' : ''}${delta} vs last assessment`))
        : null,
    ));

    const card = el('div.card');
    for (const m of Object.values(analysis.measures)) {
      const spec = MEASURES[m.id];
      card.append(el('div.metric', null,
        el('div.metric-top', null,
          el('span.metric-name', m.label),
          el('span.metric-val', { style: { color: `var(--${m.level})` } }, `${m.value}${m.unit}`),
        ),
        deviationBar(m, spec),
        el('div.metric-note', m.note),
        el('div.tiny.muted', { style: { marginTop: '6px', opacity: .8 } }, spec?.about || ''),
      ));
    }
    wrap.append(el('div.section-head.mt-24', el('h2', 'Measurements')), card);

    const work = postureWork(analysis);
    if (work.length) {
      wrap.append(el('div.section-head.mt-24', el('h2', 'Corrective focus')));
      for (const w of work) {
        wrap.append(el('div.card', { style: { marginBottom: '10px' } },
          el('div.spread', null,
            el('div', { style: { fontWeight: '650' } }, w.title),
            el(`span.pill.${w.level}`, w.level === 'warn' ? 'Watch' : 'Focus'),
          ),
          el('ul.tips', { style: { margin: '11px 0 0', paddingLeft: '20px' } },
            ...w.items.map((i) => el('li', i))),
        ));
      }
    } else {
      wrap.append(el('div.card.mt-24', el('p.small.dim', { style: { margin: 0, lineHeight: '1.6' } },
        'Everything measured sits inside its reference range. Re-scan every few weeks to catch drift early.')));
    }

    wrap.append(el('div.disclaimer.mt-16', icon('info'), el('span', POSTURE_DISCLAIMER)));

    const saveBtn = el('button.btn.btn-primary.btn-lg.btn-block.mt-24', icon('check'), 'Save assessment');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const saved = await savePosture({
          clientId,
          clientName: client?.name || '',
          view: analysis.view,
          overall: analysis.overall,
          measures: analysis.measures,
          thumb: chartThumbnail(chart),
          chart: chartUrl,
          notes: '',
        });
        haptic(18);
        toast('Assessment saved', 'good');
        navigate(`/posture/${saved.id}`);
      } catch (err) {
        console.error(err);
        toast('Could not save', 'bad');
        saveBtn.disabled = false;
      }
    };

    wrap.append(saveBtn,
      el('button.btn.btn-lg.btn-block.btn-ghost.mt-12', { onclick: resume }, 'Retake'),
      el('div', { style: { height: '20px' } }));
    return wrap;
  }

  boot();

  return {
    title: 'Posture',
    node,
    full: true,
    hideAppBar: true,
    hideTabBar: true,
    destroy() {
      destroyed = true;
      loop?.stop();
      camera.stop();
    },
  };
}

/** Marker position on the deviation bar, centred on the ideal band. */
function deviationBar(m, spec) {
  if (!spec) return el('div.bar', el('i', { style: { width: '50%', background: `var(--${m.level})` } }));
  const [lo, hi] = spec.ideal;
  const span = Math.max(hi - lo, 1);
  const centre = (lo + hi) / 2;
  // 42–58% of the bar is the ideal band; scale outwards from there.
  const pct = 50 + ((m.value - centre) / span) * 16;
  const bar = el('div.dev', el('div.ideal'));
  bar.append(el('div.mark', { style: { left: `${Math.max(3, Math.min(97, pct))}%`, background: `var(--${m.level})` } }));
  return bar;
}

function summaryLine(analysis) {
  const flagged = Object.values(analysis.measures).filter((m) => m.level !== 'good');
  if (!flagged.length) return 'Every measure sits inside its reference range.';
  const names = flagged.sort((a, b) => a.score - b.score).slice(0, 2).map((m) => m.label.toLowerCase());
  return `Worth attention: ${names.join(' and ')}. The rest reads within range.`;
}
