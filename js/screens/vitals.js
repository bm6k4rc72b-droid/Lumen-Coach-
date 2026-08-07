import { el, icon, toast, haptic, ring, pickSheet, fmtDate, scoreClass } from '../ui.js';
import { CameraController, FrameLoop, describeCameraError, cameraSupported, secureContextOk } from '../camera.js';
import {
  PulseBuffer, analysePulse, readinessScore, roiMean, looksLikeFinger, VITALS_DISCLAIMER,
} from '../vitals/rppg.js';
import { getSettings, setSetting, listClients, getClient, saveVitals, listVitals } from '../store.js';
import { navigate } from '../router.js';

const TARGET_SECONDS = 30;

export async function render() {
  const settings = await getSettings();
  const clients = await listClients();
  let clientId = settings.activeClientId && clients.some((c) => c.id === settings.activeClientId)
    ? settings.activeClientId : null;
  let client = clientId ? await getClient(clientId) : null;
  let mode = 'finger';                    // finger | face
  const history = await listVitals(clientId, 20);

  /* ------------------------------------------------------------ markup */
  const video = el('video', { playsinline: true, muted: true, autoplay: true, 'webkit-playsinline': '' });
  const stage = el('div.stage', video);

  const guide = el('div.guide',
    el('div.guide-hint', 'Cover the rear lens completely with a fingertip · rest your hand · breathe normally'));

  const closeBtn = el('button.icon-btn.solid', { 'aria-label': 'Close' }, icon('close'));
  const modeChip = el('button.chip.on', { style: { pointerEvents: 'auto' } }, '☝︎ Fingertip');
  const qualityChip = el('span.chip', { style: { pointerEvents: 'none' } }, 'Place your finger');
  const topBar = el('div.cam-top', closeBtn,
    el('div', { style: { flex: 1, display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' } },
      modeChip, qualityChip), el('div', { style: { width: '42px' } }));

  const bpmValue = el('div', {
    style: { fontFamily: 'var(--num)', fontSize: '52px', fontWeight: '800', lineHeight: '1', letterSpacing: '-.04em' },
  }, '—');
  const bpmLabel = el('div.tiny.muted', { style: { letterSpacing: '.14em', textTransform: 'uppercase', marginTop: '4px' } }, 'bpm');
  const hrvValue = el('div', { style: { fontFamily: 'var(--num)', fontSize: '22px', fontWeight: '700' } }, '—');

  const trace = el('canvas', { width: 600, height: 90, style: { width: '100%', height: '54px', display: 'block' } });
  const progress = el('div.progress', el('i', { style: { width: '0%' } }));

  const hud = el('div.rep-hud.glass', null,
    el('div', null, bpmValue, bpmLabel),
    el('div', { style: { flex: 1, textAlign: 'right' } },
      hrvValue,
      el('div.tiny.muted', { style: { letterSpacing: '.14em', textTransform: 'uppercase', marginTop: '4px' } }, 'HRV ms'),
    ),
  );

  const startBtn = el('button.btn.btn-primary', icon('play'), 'Start reading');
  const clientBtn = el('button.icon-btn.solid', { 'aria-label': 'Choose client' }, icon('person'));
  const controls = el('div.cam-controls.glass', clientBtn, startBtn);

  const bottom = el('div.cam-bottom',
    el('div.glass', { style: { padding: '12px 14px', borderRadius: 'var(--r-md)', marginBottom: '10px' } },
      trace, el('div', { style: { marginTop: '10px' } }, progress)),
    hud, controls);

  const gate = el('div.perm');
  stage.append(guide, topBar, bottom, gate);

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
  const buffer = new PulseBuffer(TARGET_SECONDS + 6);
  const work = document.createElement('canvas');
  work.width = 160; work.height = 120;
  const workCtx = work.getContext('2d', { willReadFrequently: true });
  const traceCtx = trace.getContext('2d');

  let loop = null;
  let destroyed = false;
  let recording = false;
  let lastAnalysis = null;

  const setGate = (c) => { if (c) gate.replaceChildren(c); else gate.replaceChildren(); gate.hidden = !c; };
  const loading = (text) => el('div.perm-inner', el('div.loader'),
    el('p.mt-16', { style: { color: 'var(--text-dim)' } }, text));

  /* --------------------------------------------------------------- boot */
  async function boot() {
    setGate(loading('Starting the camera…'));
    if (!cameraSupported() || !secureContextOk()) {
      setGate(el('div.perm-inner', null,
        el('h2', 'Camera unavailable'),
        el('p', 'This reading needs camera access over a secure connection.'),
        el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => navigate('/coach') }, 'Go back')));
      return;
    }
    try {
      // Low resolution is plenty — we only need an average colour, and a
      // small frame keeps the frame rate high, which matters for HRV.
      await camera.start({ facing: mode === 'finger' ? 'environment' : 'user', quality: 'balanced' });
      stage.classList.toggle('mirror', camera.facing === 'user');
      if (settings.keepAwake) camera.requestWakeLock();
    } catch (err) {
      setGate(el('div.perm-inner', null,
        el('h2', describeCameraError(err).title),
        el('p', describeCameraError(err).body),
        el('button.btn.btn-primary.btn-lg.btn-block', { onclick: boot }, 'Try again'),
        el('button.btn.btn-lg.btn-block.btn-ghost.mt-12', { onclick: () => navigate('/coach') }, 'Go back')));
      return;
    }
    if (destroyed) return;
    setGate(null);
    startLoop();
  }

  function startLoop() {
    loop?.stop();
    loop = new FrameLoop(video, onFrame);
    loop.start();
  }

  /* --------------------------------------------------------- sampling */
  function onFrame() {
    if (destroyed) return;
    const { width, height } = camera.dimensions;
    if (!width || !height) return;

    workCtx.drawImage(video, 0, 0, work.width, work.height);

    // Fingertip: the whole frame is skin. Face: sample the forehead band.
    const roi = mode === 'finger'
      ? [20, 20, work.width - 40, work.height - 40]
      : [Math.round(work.width * 0.32), Math.round(work.height * 0.18),
        Math.round(work.width * 0.36), Math.round(work.height * 0.14)];

    const mean = roiMean(workCtx, ...roi);
    if (!mean) return;

    if (mode === 'finger' && !looksLikeFinger(mean)) {
      qualityChip.textContent = 'Cover the lens fully';
      if (recording) resetRun('Finger moved — starting again');
      return;
    }

    if (!recording) {
      qualityChip.textContent = mode === 'finger' ? 'Ready — press start' : 'Face detected — press start';
      return;
    }

    buffer.push(performance.now(), mean);
    const result = analysePulse(buffer);
    lastAnalysis = result;

    const pct = Math.min(100, (buffer.duration / TARGET_SECONDS) * 100);
    progress.firstChild.style.width = `${pct}%`;

    if (result.ready) {
      bpmValue.textContent = String(result.bpm);
      hrvValue.textContent = result.rmssd === null ? '—' : String(result.rmssd);
      qualityChip.textContent = `Signal ${result.quality} · ${result.confidence}%`;
      drawTrace(result.wave);
    } else {
      qualityChip.textContent = `Reading… ${Math.round(buffer.duration)}s`;
      if (result.wave) drawTrace(result.wave);
    }

    if (buffer.duration >= TARGET_SECONDS) finish();
  }

  function drawTrace(wave) {
    if (!wave?.length) return;
    const w = trace.width, h = trace.height;
    traceCtx.clearRect(0, 0, w, h);
    let min = Infinity, max = -Infinity;
    for (const v of wave) { if (v < min) min = v; if (v > max) max = v; }
    const span = max - min || 1;
    traceCtx.beginPath();
    wave.forEach((v, i) => {
      const x = (i / (wave.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 12) - 6;
      if (i === 0) traceCtx.moveTo(x, y); else traceCtx.lineTo(x, y);
    });
    traceCtx.strokeStyle = '#d3b072';
    traceCtx.lineWidth = 2.4;
    traceCtx.lineJoin = 'round';
    traceCtx.stroke();
  }

  function resetRun(message) {
    buffer.reset();
    progress.firstChild.style.width = '0%';
    bpmValue.textContent = '—';
    hrvValue.textContent = '—';
    if (message) toast(message, 'bad', 2400);
  }

  /* ------------------------------------------------------------ actions */
  startBtn.onclick = () => {
    if (recording) { finish(); return; }
    recording = true;
    resetRun();
    startBtn.replaceChildren(icon('stop'), document.createTextNode('Stop'));
    haptic(14);
  };

  modeChip.onclick = async () => {
    if (recording) { toast('Finish the reading first', 'bad'); return; }
    const picked = await pickSheet({
      title: 'How are we reading your pulse?',
      sub: 'Fingertip is far more reliable. Face works but is sensitive to movement and lighting.',
      options: [
        { value: 'finger', title: 'Fingertip', sub: 'Cover the rear lens with a fingertip', emoji: '☝︎' },
        { value: 'face', title: 'Face', sub: 'Sit still, evenly lit, front camera', emoji: '☺' },
      ],
      value: mode,
    });
    if (!picked || picked === mode) return;
    mode = picked;
    modeChip.textContent = mode === 'finger' ? '☝︎ Fingertip' : '☺ Face';
    guide.querySelector('.guide-hint').textContent = mode === 'finger'
      ? 'Cover the rear lens completely with a fingertip · rest your hand · breathe normally'
      : 'Sit still, face evenly lit, look at the camera · breathe normally';
    resetRun();
    camera.stop();
    boot();
  };

  clientBtn.onclick = async () => {
    const picked = await pickSheet({
      title: 'Whose reading is this?',
      options: [
        { value: '__none', title: 'Unassigned', sub: 'General history', emoji: '○' },
        ...clients.map((c) => ({ value: c.id, title: c.name, sub: 'Client', emoji: '●' })),
      ],
      value: clientId || '__none',
    });
    if (picked === undefined) return;
    clientId = picked === '__none' ? null : picked;
    client = clientId ? await getClient(clientId) : null;
    await setSetting('activeClientId', clientId);
    toast(client ? `Saving to ${client.name}` : 'Saving to general history');
  };

  closeBtn.onclick = () => navigate('/coach');

  /* ------------------------------------------------------------ finish */
  async function finish() {
    recording = false;
    startBtn.replaceChildren(icon('play'), document.createTextNode('Start reading'));
    const result = lastAnalysis;
    if (!result?.ready) {
      toast('Signal was too weak to trust — try again, holding very still', 'bad', 3600);
      resetRun();
      return;
    }
    haptic(18);
    loop?.stop();
    camera.stop();

    const readiness = readinessScore({ bpm: result.bpm, rmssd: result.rmssd }, history);
    showResult(result, readiness);
  }

  function showResult(result, readiness) {
    stage.style.display = 'none';
    resultView.style.display = '';
    resultView.scrollTop = 0;

    const wrap = el('div');
    wrap.append(el('div.spread', { style: { marginBottom: '16px' } },
      el('button.icon-btn.solid', { 'aria-label': 'Again', onclick: again }, icon('flip')),
      el('div', { style: { textAlign: 'center', flex: 1 } },
        el('div', { style: { fontFamily: 'var(--serif)', fontSize: '17px' } }, 'Recovery reading'),
        el('div.tiny.muted', client ? client.name : 'Unassigned'),
      ),
      el('button.icon-btn.solid', { 'aria-label': 'Close', onclick: () => navigate('/coach') }, icon('close')),
    ));

    wrap.append(el('div.card.card-gold', { style: { textAlign: 'center' } },
      readiness?.score
        ? el('div.big-score', ring(readiness.score, { size: 132, label: 'READINESS' }))
        : el('div', { style: { padding: '10px 0' } },
          el('div', { style: { fontFamily: 'var(--num)', fontSize: '46px', fontWeight: '800' } }, result.bpm),
          el('div.stat-lab', { style: { marginTop: '6px' } }, 'BPM')),
      el('p.small.muted', { style: { margin: '12px 0 0', lineHeight: '1.65' } },
        readiness?.text || 'Reading captured.'),
    ));

    wrap.append(el('div.section', null, el('div.stat-grid', null,
      el('div.stat', el('div.stat-val', result.bpm), el('div.stat-lab', 'Heart rate')),
      el('div.stat', el('div.stat-val', result.rmssd ?? '—'), el('div.stat-lab', 'HRV RMSSD')),
      el('div.stat',
        el('div.stat-val', { style: { color: `var(--${scoreClass(result.confidence)})` } }, `${result.confidence}%`),
        el('div.stat-lab', 'Signal')),
    )));

    wrap.append(el('div.card.mt-12', null,
      el('div.overline', { style: { marginBottom: '10px' } }, 'Reading detail'),
      detailRow('Beats detected', `${result.beats}`),
      detailRow('Record length', `${result.duration}s at ${result.fps} fps`),
      detailRow('Signal-to-noise', `${result.snr}`),
      detailRow('Method', mode === 'finger' ? 'Fingertip contact' : 'Face (remote)'),
      readiness?.baseline
        ? detailRow('Your baseline', `${readiness.meanBpm} bpm · HRV ${readiness.meanRmssd} ms`)
        : null,
    ));

    if (result.confidence < 70) {
      wrap.append(el('div.card.mt-12', { style: { borderColor: 'var(--warn-dim)' } },
        el('div', { style: { fontWeight: '650', color: 'var(--warn)', marginBottom: '8px' } }, 'Signal was only fair'),
        el('p.small.muted', { style: { margin: 0, lineHeight: '1.65' } },
          mode === 'finger'
            ? 'Cover the lens completely, rest your hand on something solid, and press gently — hard pressure squeezes the capillaries and kills the signal.'
            : 'Face readings need very still sitting and even, flicker-free light. Fingertip is much more reliable.'),
      ));
    }

    wrap.append(el('div.disclaimer.mt-16', icon('info'), el('span', VITALS_DISCLAIMER)));

    const saveBtn = el('button.btn.btn-primary.btn-lg.btn-block.mt-24', icon('check'), 'Save reading');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const saved = await saveVitals({
          clientId,
          clientName: client?.name || '',
          method: mode,
          bpm: result.bpm,
          rmssd: result.rmssd,
          sdnn: result.sdnn,
          beats: result.beats,
          confidence: result.confidence,
          readiness: readiness?.score ?? null,
          readinessText: readiness?.text || '',
          notes: '',
        });
        toast('Reading saved', 'good');
        navigate(`/coach`);
        void saved;
      } catch (err) {
        console.error(err);
        toast('Could not save', 'bad');
        saveBtn.disabled = false;
      }
    };

    wrap.append(saveBtn,
      el('button.btn.btn-lg.btn-block.btn-ghost.mt-12', { onclick: again }, 'Read again'));

    if (history.length) {
      wrap.append(el('div.section-head.mt-24', el('h2', 'Recent readings')));
      wrap.append(el('div.list', null, ...history.slice(0, 6).map((h) => el('div.row', { style: { cursor: 'default' } },
        el('div.avatar.avatar-quiet', { style: { fontSize: '13px' } }, String(h.bpm)),
        el('div.row-main', null,
          el('div.row-title', `${h.bpm} bpm${h.rmssd ? ` · HRV ${h.rmssd}` : ''}`),
          el('div.row-sub', fmtDate(h.createdAt)),
        ),
        typeof h.readiness === 'number'
          ? el(`span.pill.${scoreClass(h.readiness)}`, String(h.readiness)) : null,
      ))));
    }

    wrap.append(el('div', { style: { height: '20px' } }));
    resultView.replaceChildren(wrap);
  }

  function again() {
    resultView.style.display = 'none';
    resultView.replaceChildren();
    stage.style.display = '';
    resetRun();
    lastAnalysis = null;
    if (!camera.active && !destroyed) boot();
  }

  function detailRow(k, v) {
    return el('div', {
      style: { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid var(--hairline)' },
    }, el('span.small.dim', k), el('span.small', { style: { fontWeight: '620' } }, v));
  }

  boot();

  return {
    title: 'Recovery',
    node,
    full: true,
    hideAppBar: true,
    hideTabBar: true,
    destroy() { destroyed = true; loop?.stop(); camera.stop(); },
  };
}
