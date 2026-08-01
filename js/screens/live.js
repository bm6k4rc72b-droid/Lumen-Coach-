import { el, icon, toast, haptic, pickSheet, sheet, confirmSheet, scoreClass } from '../ui.js';
import { CameraController, FrameLoop, describeCameraError, cameraSupported, secureContextOk } from '../camera.js';
import { poseEngine } from '../pose/landmarker.js';
import { Overlay } from '../pose/overlay.js';
import { LandmarkSmoother } from '../pose/angles.js';
import { FormAnalyzer } from '../pose/analyzer.js';
import { EXERCISES, getExercise, HUD_LABELS, HUD_BANDS, band } from '../pose/exercises.js';
import { getSettings, setSetting, getClient } from '../store.js';
import { addSet, ensureSession } from '../session-state.js';
import { navigate } from '../router.js';

const HUD_REFRESH_MS = 90;

export async function render({ query }) {
  const settings = await getSettings();
  let exercise = getExercise(query.ex || 'squat');

  const session = ensureSession({});
  const client = session?.clientId ? await getClient(session.clientId) : null;

  /* ------------------------------------------------------------- markup */
  const video = el('video', { playsinline: true, muted: true, autoplay: true, 'webkit-playsinline': '' });
  const canvas = el('canvas.overlay');
  const stage = el('div.stage', video, canvas,
    el('div.stage-scrim-top'), el('div.stage-scrim-bottom'));

  const exerciseChip = el('button.chip.on', { style: { pointerEvents: 'auto' } }, `${exercise.emoji} ${exercise.name}`);
  const statusChip = el('span.chip', { style: { pointerEvents: 'none' } }, 'Starting…');

  const closeBtn = el('button.icon-btn.solid', { 'aria-label': 'End live analysis' }, icon('close'));
  const flipBtn = el('button.icon-btn.solid', { 'aria-label': 'Switch camera' }, icon('flip'));

  const topBar = el('div.cam-top', null,
    closeBtn,
    el('div', { style: { flex: 1, display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', pointerEvents: 'none' } },
      exerciseChip, statusChip),
    flipBtn,
  );

  const coach = el('div.coach.idle.glass', el('span.dot'), el('span', 'Getting the camera ready…'));
  const anglesRow = el('div.angles');
  const repCount = el('div.rep-count', '0');
  const repMeta = el('div.rep-meta', 'Reps');
  const scoreRing = el('div.score-ring');

  const repHud = el('div.rep-hud.glass', repCount, repMeta, scoreRing);

  const saveBtn = el('button.btn.btn-primary', { disabled: true }, icon('check'), 'Save set');
  const resetBtn = el('button.btn', null, 'Reset');
  const controls = el('div.cam-controls.glass', resetBtn, saveBtn);

  const bottom = el('div.cam-bottom', coach, anglesRow, repHud, controls);

  const gate = el('div.perm');
  const node = el('div', { style: { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' } }, stage);
  stage.append(topBar, bottom, gate);

  /* -------------------------------------------------------------- state */
  const camera = new CameraController(video);
  const overlay = new Overlay(canvas);
  const smoother = new LandmarkSmoother({ minCutoff: 1.1, beta: 0.03 });
  const analyzer = new FormAnalyzer(exercise.id, { heightCm: client?.heightCm || 170 });

  let loop = null;
  let destroyed = false;
  let mirrored = settings.facing === 'user';
  let lastHudAt = 0;
  let lastResult = null;
  let saving = false;
  let setStartedAt = Date.now();

  const setGate = (content) => {
    if (content) gate.replaceChildren(content); else gate.replaceChildren();
    gate.hidden = !content;
  };

  const loadingGate = (text) => el('div.perm-inner', null,
    el('div.loader'),
    el('p.mt-16', { style: { color: 'var(--text-dim)' } }, text),
  );

  const errorGate = ({ title, body, retry = true }) => el('div.perm-inner', null,
    el('div', { style: { fontSize: '34px', marginBottom: '8px' } }, '📷'),
    el('h2', title),
    el('p', body),
    el('div.stack', null,
      retry ? el('button.btn.btn-primary.btn-lg.btn-block', { onclick: () => boot() }, 'Try again') : null,
      el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => leave() }, 'Go back'),
    ),
  );

  /* --------------------------------------------------------------- boot */
  async function boot() {
    setGate(loadingGate('Starting the camera…'));
    if (!cameraSupported() || !secureContextOk()) {
      setGate(errorGate({
        ...describeCameraError({ name: secureContextOk() ? 'NotFoundError' : 'SecurityError' }),
        retry: false,
      }));
      return;
    }
    try {
      await camera.start({ facing: settings.facing, quality: 'balanced' });
      mirrored = camera.facing === 'user';
      stage.classList.toggle('mirror', mirrored);
      if (settings.keepAwake) camera.requestWakeLock();
    } catch (err) {
      console.warn('Camera start failed', err);
      setGate(errorGate(describeCameraError(err)));
      return;
    }
    if (destroyed) return;

    try {
      setGate(loadingGate('Loading the movement model…'));
      await poseEngine.load(settings.modelQuality, (stage2) => setGate(loadingGate(stage2)));
    } catch (err) {
      console.error('Pose model failed to load', err);
      setGate(errorGate({
        title: 'Movement model unavailable',
        body: navigator.onLine
          ? 'The pose model could not be loaded. Check your connection and try again — it is cached after the first successful load.'
          : 'You are offline and the pose model has not been cached yet. Connect once to download it, then it works offline.',
      }));
      return;
    }
    if (destroyed) return;

    setGate(null);
    statusChip.textContent = `${poseEngine.delegate === 'GPU' ? 'GPU' : 'CPU'} · ${settings.modelQuality}`;
    coach.querySelector('span:last-child').textContent = exercise.gait
      ? 'Start running when you are ready'
      : 'Step into frame — full body visible';

    startLoop();
  }

  function startLoop() {
    loop?.stop();
    loop = new FrameLoop(video, onFrame);
    loop.start();
  }

  /* --------------------------------------------------------- frame loop */
  function onFrame(mediaTimeMs) {
    if (destroyed || !poseEngine.ready) return;
    const { width, height } = camera.dimensions;
    if (!width || !height) return;

    const raw = poseEngine.detect(video, mediaTimeMs);
    if (raw === undefined) return;                 // busy or failed — skip frame

    const now = performance.now();
    const landmarks = raw ? smoother.apply(raw, now) : (smoother.reset(), null);
    const result = analyzer.push(landmarks, width, height, now);
    lastResult = result;

    overlay.draw(landmarks, {
      videoW: width,
      videoH: height,
      level: result.level === 'idle' ? 'idle' : result.level,
      showSkeleton: settings.showSkeleton,
      showAngles: settings.showAngles,
      angles: result.angles,
      hud: exercise.hud,
    });

    if (result.completedRep) {
      if (settings.haptics) haptic(result.completedRep.score >= 80 ? 18 : [10, 40, 10]);
      repCount.textContent = String(result.reps);
      repCount.animate?.(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }],
        { duration: 260, easing: 'ease-out' },
      );
    }

    if (now - lastHudAt >= HUD_REFRESH_MS) {
      lastHudAt = now;
      paintHud(result);
      adaptBudget();
    }
  }

  /** Keeps the preview smooth on slower phones by skipping inference frames. */
  function adaptBudget() {
    if (!loop) return;
    const cost = poseEngine.inferenceMs;
    if (cost > 70) loop.minInterval = 100;        // ~10 analysed fps
    else if (cost > 45) loop.minInterval = 66;    // ~15 fps
    else if (cost > 28) loop.minInterval = 40;    // ~25 fps
    else loop.minInterval = 0;                    // as fast as frames arrive
  }

  /* ---------------------------------------------------------------- HUD */
  function paintHud(result) {
    const cue = result.cue || { level: 'idle', text: '' };
    coach.className = `coach glass ${cue.level}`;
    coach.replaceChildren(el('span.dot'), el('span', cue.text));

    repCount.textContent = String(result.reps);
    const gait = result.gait;

    if (exercise.gait) {
      repMeta.replaceChildren(
        el('div', { style: { fontWeight: '650', color: 'var(--text)' } },
          gait?.cadence ? `${gait.cadence} spm` : 'Detecting cadence…'),
        el('div', gait?.kph ? `≈ ${gait.kph} km/h · ${paceText(gait.paceSecPerKm)}` : 'Speed needs a few strides'),
      );
      repCount.textContent = gait?.steps ? String(gait.steps) : '0';
      repMeta.prepend(el('div.tiny.muted', 'Steps detected'));
    } else {
      repMeta.replaceChildren(
        el('div', { style: { fontWeight: '650', color: 'var(--text)' } }, result.reps === 1 ? 'rep' : 'reps'),
        el('div', result.lastRep
          ? `Last rep ${result.lastRep.score}% · ${(result.lastRep.durationMs / 1000).toFixed(1)}s`
          : 'Move through your first rep'),
      );
    }

    const shown = result.score ?? result.liveScore;
    scoreRing.replaceChildren(smallRing(shown));

    paintAngles(result);
    saveBtn.disabled = saving || (exercise.gait ? !(gait?.steps > 6) : result.reps === 0);
  }

  function paintAngles(result) {
    const keys = exercise.hud || [];
    const tiles = keys.map((key) => {
      let value = null;
      let unit = '°';
      if (key === 'cadence') { value = result.gait?.cadence ?? null; unit = ''; }
      else value = result.angles?.[key] ?? null;

      const bands = HUD_BANDS[key];
      let level = '';
      if (bands && typeof value === 'number') {
        level = band(value, bands.good, bands.warn) || '';
      }
      return el(`div.angle${level ? '.' + level : ''}`,
        el('div.angle-val', typeof value === 'number' ? `${Math.round(value)}${unit}` : '—'),
        el('div.angle-lab', HUD_LABELS[key] || key),
      );
    });
    anglesRow.replaceChildren(...tiles);
  }

  function smallRing(score) {
    const size = 54, stroke = 6;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, score ?? 0)) / 100;
    const color = score === null || score === undefined ? 'var(--text-faint)' : `var(--${scoreClass(score)})`;
    const wrap = el('div', { style: { position: 'relative', width: size + 'px', height: size + 'px' } });
    wrap.innerHTML = `<svg viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg);width:100%;height:100%">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>
    </svg>
    <span style="position:absolute;inset:0;display:grid;place-items:center;font:700 15px ui-rounded,system-ui;color:${color}">
      ${score === null || score === undefined ? '—' : Math.round(score)}</span>`;
    return wrap;
  }

  function paceText(secPerKm) {
    if (!secPerKm) return '';
    const m = Math.floor(secPerKm / 60);
    const s = String(Math.round(secPerKm % 60)).padStart(2, '0');
    return `${m}:${s} /km`;
  }

  /* ------------------------------------------------------------ actions */
  exerciseChip.onclick = async () => {
    const picked = await pickSheet({
      title: 'Switch exercise',
      sub: 'Reps in progress for the current exercise are kept until you save or reset.',
      options: EXERCISES.map((e) => ({ value: e.id, title: e.name, sub: e.setup, emoji: e.emoji })),
      value: exercise.id,
    });
    if (!picked || picked === exercise.id) return;
    if (analyzer.reps.length) {
      const keep = await confirmSheet({
        title: 'Save the current set first?',
        message: `You have ${analyzer.reps.length} unsaved reps of ${exercise.name}.`,
        confirmText: 'Save set first',
      });
      if (keep) await saveSet({ silent: true });
    }
    exercise = getExercise(picked);
    analyzer.setExercise(exercise.id);
    setStartedAt = Date.now();
    exerciseChip.textContent = `${exercise.emoji} ${exercise.name}`;
    localStorage.setItem('lumen.lastExercise', exercise.id);
    toast(`${exercise.name} — ${exercise.setup}`, '', 3400);
  };

  flipBtn.onclick = async () => {
    try {
      const facing = await camera.switchFacing();
      await setSetting('facing', facing);
      settings.facing = facing;
      mirrored = facing === 'user';
      stage.classList.toggle('mirror', mirrored);
      smoother.reset();
      startLoop();
    } catch (err) {
      toast(describeCameraError(err).title, 'bad');
    }
  };

  resetBtn.onclick = async () => {
    if (analyzer.reps.length) {
      const ok = await confirmSheet({
        title: 'Reset this set?',
        message: `${analyzer.reps.length} reps will be discarded.`,
        confirmText: 'Reset',
        danger: true,
      });
      if (!ok) return;
    }
    analyzer.reset();
    smoother.reset();
    setStartedAt = Date.now();
    toast('Set reset');
  };

  saveBtn.onclick = () => saveSet({});

  async function saveSet({ silent = false } = {}) {
    if (saving) return false;
    const summary = analyzer.summary();
    const gait = lastResult?.gait || null;
    if (!summary.reps && !(gait?.steps > 6)) { toast('No reps captured yet', 'bad'); return false; }

    saving = true;
    let notes = '';
    if (!silent) {
      notes = await notesSheet(exercise, summary, gait) ?? null;
      if (notes === null) { saving = false; return false; }   // cancelled
    }

    addSet({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      emoji: exercise.emoji,
      reps: summary.reps,
      score: summary.score,
      tempoMs: summary.tempoMs,
      durationMs: Date.now() - setStartedAt,
      checks: summary.checks,
      repDetail: summary.repDetail,
      gait: gait && gait.steps ? gait : null,
      notes: notes || '',
    });

    analyzer.reset();
    smoother.reset();
    setStartedAt = Date.now();
    saving = false;
    if (!silent) {
      haptic(20);
      toast(`Set saved — ${summary.reps} reps${summary.score !== null ? ` at ${summary.score}%` : ''}`, 'good');
    }
    return true;
  }

  async function leave() {
    if (analyzer.reps.length >= 1) {
      const answer = await sheet((close) => el('div', null,
        el('h2', 'Save this set?'),
        el('p.sub', `${analyzer.reps.length} reps of ${exercise.name} have not been saved yet.`),
        el('div.stack', null,
          el('button.btn.btn-primary.btn-lg.btn-block', { onclick: () => close('save') }, 'Save set and exit'),
          el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => close('discard') }, 'Exit without saving'),
          el('button.btn.btn-lg.btn-block.btn-quiet', { onclick: () => close('cancel') }, 'Keep training'),
        ),
      ));
      if (answer === 'cancel' || answer === undefined) return;
      if (answer === 'save') await saveSet({ silent: true });
    }
    navigate('/train');
  }

  closeBtn.onclick = leave;

  /* -------------------------------------------------------- lifecycle */
  const onVisibility = () => {
    if (document.hidden) { loop?.stop(); camera.releaseWakeLock(); }
    else if (!destroyed && camera.active && poseEngine.ready) {
      startLoop();
      if (settings.keepAwake) camera.requestWakeLock();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onResize = () => overlay.resize();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  boot();

  return {
    title: exercise.name,
    node,
    full: true,
    hideAppBar: true,
    hideTabBar: true,
    destroy() {
      destroyed = true;
      loop?.stop();
      camera.stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    },
  };
}

/** Optional note + confirmation before a set is stored. */
function notesSheet(exercise, summary, gait) {
  return sheet((close) => {
    const notes = el('textarea.textarea', { placeholder: 'Weight, cues used, how it felt…' });
    return el('div', null,
      el('h2', `Save ${exercise.name} set`),
      el('p.sub', summary.reps
        ? `${summary.reps} reps · ${summary.score}% average form`
        : `${gait?.steps || 0} steps · ${gait?.cadence || '—'} spm`),
      el('div.card.card-tight', { style: { marginBottom: '14px' } },
        ...summary.checks.slice(0, 5).map((c) => el('div', {
          style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '5px 0', fontSize: '13.5px' },
        },
          el('span.dim', c.label),
          el(`span.pill.${c.worst}`, `${c.goodPct}% clean`),
        )),
        !summary.checks.length ? el('div.tiny.muted', 'No per-rep checks captured.') : null,
      ),
      el('label.field', null, el('span', 'Notes (optional)'), notes),
      el('div.stack', null,
        el('button.btn.btn-primary.btn-lg.btn-block', { onclick: () => close(notes.value.trim()) }, 'Save set'),
        el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => close(null) }, 'Cancel'),
      ),
    );
  });
}
