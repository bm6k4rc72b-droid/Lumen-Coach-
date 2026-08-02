import { el, icon, toast, haptic, pickSheet, confirmSheet, fmtDuration } from '../ui.js';
import { CameraController, FrameLoop, describeCameraError, cameraSupported, secureContextOk } from '../camera.js';
import { poseEngine } from '../pose/landmarker.js';
import { Overlay } from '../pose/overlay.js';
import { LandmarkSmoother } from '../pose/angles.js';
import { SpeedAnalyzer, SPEED_MODES, sessionTotals, SPEED_DISCLAIMER } from '../speed/analyzer.js';
import { getSettings, setSetting, listClients, getClient, saveRound } from '../store.js';
import { navigate } from '../router.js';

const HUD_MS = 90;

export async function render({ query }) {
  const settings = await getSettings();
  const clients = await listClients();
  let clientId = settings.activeClientId && clients.some((c) => c.id === settings.activeClientId)
    ? settings.activeClientId : null;
  let client = clientId ? await getClient(clientId) : null;

  let mode = SPEED_MODES[query.mode] ? query.mode : 'strike';
  let roundLength = settings.roundLengthSec;
  let restLength = settings.restLengthSec;

  /* ------------------------------------------------------------- markup */
  const video = el('video', { playsinline: true, muted: true, autoplay: true, 'webkit-playsinline': '' });
  const canvas = el('canvas.overlay');
  const stage = el('div.stage', video, canvas, el('div.stage-scrim-top'), el('div.stage-scrim-bottom'));

  const closeBtn = el('button.icon-btn.solid', { 'aria-label': 'End session' }, icon('close'));
  const flipBtn = el('button.icon-btn.solid', { 'aria-label': 'Switch camera' }, icon('flip'));
  const modeChip = el('button.chip.on', { style: { pointerEvents: 'auto' } }, `${SPEED_MODES[mode].emoji} ${SPEED_MODES[mode].label}`);
  const roundChip = el('span.chip', { style: { pointerEvents: 'none' } }, 'Round 1');

  const topBar = el('div.cam-top', closeBtn,
    el('div', { style: { flex: 1, display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' } },
      modeChip, roundChip),
    flipBtn);

  const clock = el('div.round-clock', formatClock(roundLength * 1000));
  const clockLabel = el('div.tiny.muted', { style: { letterSpacing: '.14em', textTransform: 'uppercase' } }, 'Ready');
  const countEl = el('div', { style: { fontFamily: 'var(--num)', fontSize: '38px', fontWeight: '800', lineHeight: '1', letterSpacing: '-.04em' } }, '0');
  const countLabel = el('div.tiny.muted', { style: { letterSpacing: '.14em', textTransform: 'uppercase', marginTop: '4px' } }, SPEED_MODES[mode].unitLabel);

  const clockCard = el('div.rep-hud.glass', null,
    el('div', null, clock, clockLabel),
    el('div', { style: { flex: 1, textAlign: 'right' } }, countEl, countLabel),
  );

  const tiles = el('div.metric-tiles');
  const startBtn = el('button.btn.btn-primary', icon('play'), 'Start round');
  const endBtn = el('button.btn', { disabled: true }, icon('stop'), 'End round');
  const controls = el('div.cam-controls.glass', endBtn, startBtn);

  const bottom = el('div.cam-bottom', tiles, clockCard, controls);
  const gate = el('div.perm');
  stage.append(topBar, bottom, gate);

  const summaryView = el('div', {
    style: {
      position: 'absolute', inset: 0, overflowY: 'auto', display: 'none',
      background: 'var(--bg)', WebkitOverflowScrolling: 'touch',
      padding: 'calc(var(--safe-t) + 14px) calc(var(--pad) + var(--safe-r)) calc(var(--safe-b) + 30px) calc(var(--pad) + var(--safe-l))',
    },
  });

  const node = el('div', {
    style: { position: 'fixed', inset: 0, background: '#000', display: 'flex', flexDirection: 'column' },
  }, stage, summaryView);

  /* -------------------------------------------------------------- state */
  const camera = new CameraController(video);
  const overlay = new Overlay(canvas);
  const smoother = new LandmarkSmoother({ minCutoff: 2.2, beta: 0.09 });   // fast hands need a looser filter
  const analyzer = new SpeedAnalyzer({ heightCm: client?.heightCm || 170, mode });

  let loop = null;
  let destroyed = false;
  let phase = 'idle';            // idle | live | rest
  let phaseEndsAt = 0;
  let roundStartedAt = 0;
  let roundIndex = 0;
  const rounds = [];
  let lastHud = 0;
  let ticker = null;

  const setGate = (c) => { if (c) gate.replaceChildren(c); else gate.replaceChildren(); gate.hidden = !c; };
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
      await camera.start({ facing: settings.facing, quality: 'balanced' });
      stage.classList.toggle('mirror', camera.facing === 'user');
      if (settings.keepAwake) camera.requestWakeLock();
    } catch (err) { showError(describeCameraError(err)); return; }
    if (destroyed) return;
    try {
      setGate(loading('Loading the movement model…'));
      await poseEngine.load(settings.modelQuality, (s) => setGate(loading(s)));
      await poseEngine.setSegmentation(false);
    } catch (err) {
      console.error(err);
      showError({ title: 'Movement model unavailable', body: 'The model could not load. Check your connection and try again.' });
      return;
    }
    if (destroyed) return;
    setGate(null);
    paintTiles(analyzer.snapshot(performance.now(), false));
    startLoop();
  }

  function showError({ title, body }, retry = true) {
    setGate(el('div.perm-inner', null,
      el('div', { style: { fontSize: '32px', marginBottom: '10px' } }, '📷'),
      el('h2', title), el('p', body),
      el('div.stack', null,
        retry ? el('button.btn.btn-primary.btn-lg.btn-block', { onclick: boot }, 'Try again') : null,
        el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => navigate('/train') }, 'Go back')),
    ));
  }

  function startLoop() {
    loop?.stop();
    loop = new FrameLoop(video, onFrame);
    loop.start();
  }

  /* --------------------------------------------------------- frame loop */
  function onFrame(mediaTime) {
    if (destroyed || !poseEngine.ready) return;
    const { width, height } = camera.dimensions;
    if (!width || !height) return;
    const raw = poseEngine.detect(video, mediaTime);
    if (raw === undefined) return;

    const now = performance.now();
    const landmarks = raw ? smoother.apply(raw, now) : (smoother.reset(), null);
    const result = analyzer.push(landmarks, width, height, now, { active: phase === 'live' });

    overlay.draw(landmarks, {
      videoW: width, videoH: height,
      level: phase === 'live' ? 'good' : 'idle',
      showSkeleton: settings.showSkeleton,
      showAngles: false,
      angles: null, hud: [],
    });

    if (result.landed?.length) {
      haptic(10);
      countEl.textContent = String(result.count);
      countEl.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
        { duration: 220, easing: 'ease-out' });
    }

    if (now - lastHud >= HUD_MS) {
      lastHud = now;
      paintTiles(result);
      countEl.textContent = String(result.count);
    }
  }

  function paintTiles(result) {
    tiles.replaceChildren(
      tile(result.output || 0, 'Output / min'),
      tile(result.liveSpeed ? result.liveSpeed.toFixed(1) : '0.0', 'Speed m/s'),
      tile(result.peakSpeed ? result.peakSpeed.toFixed(1) : '0.0', 'Peak m/s'),
    );
  }

  function tile(v, k) {
    return el('div.metric-tile', el('div.v', String(v)), el('div.k', k));
  }

  /* -------------------------------------------------------------- clock */
  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      const remaining = phaseEndsAt - Date.now();
      clock.textContent = formatClock(Math.max(0, remaining));
      if (remaining <= 0) {
        if (phase === 'live') endRound(true);
        else if (phase === 'rest') beginRound();
      } else if (phase === 'live' && remaining <= 10000 && remaining > 9000) {
        haptic([20, 60, 20]);
      }
    }, 200);
  }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  function beginRound() {
    roundIndex += 1;
    phase = 'live';
    roundStartedAt = Date.now();
    phaseEndsAt = roundStartedAt + roundLength * 1000;
    analyzer.startRound(performance.now());
    clock.classList.remove('rest');
    clockLabel.textContent = 'Round live';
    roundChip.textContent = `Round ${roundIndex}`;
    startBtn.disabled = true;
    endBtn.disabled = false;
    countEl.textContent = '0';
    haptic([30, 40, 30]);
    startTicker();
  }

  function beginRest() {
    phase = 'rest';
    phaseEndsAt = Date.now() + restLength * 1000;
    clock.classList.add('rest');
    clockLabel.textContent = 'Rest';
    startBtn.disabled = false;
    endBtn.disabled = true;
    startTicker();
  }

  function endRound(auto = false) {
    if (phase !== 'live') return;
    const duration = Date.now() - roundStartedAt;
    const summary = analyzer.summary(roundIndex, duration);
    rounds.push(summary);
    phase = 'idle';
    stopTicker();
    startBtn.disabled = false;
    endBtn.disabled = true;
    haptic([40, 60, 40]);
    toast(`Round ${roundIndex}: ${summary.strikes} · peak ${summary.peakSpeed} m/s`, 'good', 3200);
    if (auto && restLength > 0) beginRest();
    else {
      clock.textContent = formatClock(roundLength * 1000);
      clockLabel.textContent = 'Ready';
    }
  }

  /* ------------------------------------------------------------ actions */
  startBtn.onclick = () => { stopTicker(); beginRound(); };
  endBtn.onclick = () => endRound(false);

  modeChip.onclick = async () => {
    if (phase === 'live') { toast('Finish the round first', 'bad'); return; }
    const picked = await pickSheet({
      title: 'What are we tracking?',
      options: Object.values(SPEED_MODES).map((m) => ({
        value: m.id, title: m.label, sub: m.hint, emoji: m.emoji,
      })),
      value: mode,
    });
    if (!picked || picked === mode) return;
    mode = picked;
    analyzer.setMode(mode);
    modeChip.textContent = `${SPEED_MODES[mode].emoji} ${SPEED_MODES[mode].label}`;
    countLabel.textContent = SPEED_MODES[mode].unitLabel;
    toast(SPEED_MODES[mode].hint, '', 3400);
  };

  roundChip.onclick = () => {};

  flipBtn.onclick = async () => {
    try {
      const facing = await camera.switchFacing();
      await setSetting('facing', facing);
      stage.classList.toggle('mirror', facing === 'user');
      smoother.reset();
      startLoop();
    } catch (err) { toast(describeCameraError(err).title, 'bad'); }
  };

  closeBtn.onclick = async () => {
    if (phase === 'live') {
      if (!await confirmSheet({ title: 'End the round?', message: 'The round so far will be kept.', confirmText: 'End round' })) return;
      endRound(false);
    }
    if (!rounds.length) { navigate('/train'); return; }
    showSummary();
  };

  /* ------------------------------------------------------------ summary */
  function showSummary() {
    stopTicker();
    loop?.stop();
    camera.stop();
    stage.style.display = 'none';
    summaryView.style.display = '';
    summaryView.scrollTop = 0;

    const totals = sessionTotals(rounds);
    const wrap = el('div');

    wrap.append(el('div', { style: { textAlign: 'center', marginBottom: '18px' } },
      el('div.overline', 'Session complete'),
      el('h2', { class: 'display', style: { fontSize: '26px', marginTop: '8px' } },
        `${rounds.length} round${rounds.length === 1 ? '' : 's'}`),
    ));

    wrap.append(el('div.stat-grid', null,
      el('div.stat', el('div.stat-val', totals.strikes), el('div.stat-lab', SPEED_MODES[mode].unitLabel)),
      el('div.stat', el('div.stat-val', totals.peakSpeed.toFixed(1)), el('div.stat-lab', 'Peak m/s')),
      el('div.stat', el('div.stat-val', totals.avgOutput), el('div.stat-lab', 'Avg output')),
    ));

    wrap.append(el('div.section-head.mt-24', el('h2', 'Rounds')));
    for (const r of rounds) {
      wrap.append(el('div.card', { style: { marginBottom: '10px' } },
        el('div.spread', null,
          el('div', null,
            el('div', { style: { fontWeight: '650' } }, `Round ${r.index}`),
            el('div.tiny.muted', { style: { marginTop: '3px' } },
              `${fmtDuration(r.durationMs)} · ${r.left} left / ${r.right} right`),
          ),
          el('div', { style: { textAlign: 'right' } },
            el('div', { style: { fontFamily: 'var(--num)', fontSize: '24px', fontWeight: '800' } }, r.strikes),
            el('div.tiny.muted', `${r.output}/min · peak ${r.peakSpeed}`),
          ),
        ),
        r.timeline.length ? sparkline(r) : null,
      ));
    }

    wrap.append(el('div.disclaimer.mt-16', icon('info'), el('span', SPEED_DISCLAIMER)));

    const saveBtn = el('button.btn.btn-primary.btn-lg.btn-block.mt-24', icon('check'), 'Save session');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const saved = await saveRound({
          clientId,
          clientName: client?.name || '',
          mode,
          rounds,
          totals,
          notes: '',
        });
        toast('Session saved', 'good');
        navigate(`/round/${saved.id}`);
      } catch (err) {
        console.error(err);
        toast('Could not save', 'bad');
        saveBtn.disabled = false;
      }
    };

    wrap.append(saveBtn,
      el('button.btn.btn-lg.btn-block.btn-ghost.mt-12', { onclick: () => navigate('/train') }, 'Discard'),
      el('div', { style: { height: '20px' } }));

    summaryView.replaceChildren(wrap);
  }

  /* -------------------------------------------------------- lifecycle */
  const onVisibility = () => {
    if (document.hidden) { loop?.stop(); camera.releaseWakeLock(); }
    else if (!destroyed && camera.active && poseEngine.ready) {
      startLoop();
      if (settings.keepAwake) camera.requestWakeLock();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  boot();

  return {
    title: 'Speed',
    node,
    full: true,
    hideAppBar: true,
    hideTabBar: true,
    destroy() {
      destroyed = true;
      stopTicker();
      loop?.stop();
      camera.stop();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

function formatClock(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Strike density over the round, drawn as thin bars. */
function sparkline(round) {
  const buckets = 30;
  const counts = new Array(buckets).fill(0);
  for (const s of round.timeline) {
    const i = Math.min(buckets - 1, Math.floor((s.at / Math.max(1, round.durationMs)) * buckets));
    counts[i] += 1;
  }
  const peak = Math.max(1, ...counts);
  const wrap = el('div', {
    style: { display: 'flex', alignItems: 'flex-end', gap: '2px', height: '32px', marginTop: '12px' },
  });
  for (const c of counts) {
    wrap.append(el('div', {
      style: {
        flex: 1,
        height: `${Math.max(6, (c / peak) * 100)}%`,
        borderRadius: '2px',
        background: c ? 'linear-gradient(180deg, var(--gold-bright), var(--gold-deep))' : 'var(--surface-2)',
        opacity: c ? 1 : .6,
      },
    }));
  }
  return wrap;
}
