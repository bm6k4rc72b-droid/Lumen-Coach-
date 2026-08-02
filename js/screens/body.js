import { el, icon, toast, haptic, pickSheet, sheet } from '../ui.js';
import { CameraController, FrameLoop, describeCameraError, cameraSupported, secureContextOk } from '../camera.js';
import { poseEngine } from '../pose/landmarker.js';
import { LandmarkSmoother, toPixels } from '../pose/angles.js';
import {
  measureSilhouette, compareScans, navyBodyFat, waistToHeightBand, BODY_DISCLAIMER,
} from '../body/silhouette.js';
import { renderBodyMap, annotateLevels, bodyThumbnail } from '../body/heatmap.js';
import { getSettings, setSetting, listClients, getClient, saveBodyScan, listBodyScans, saveClient } from '../store.js';
import { navigate } from '../router.js';

export async function render() {
  const settings = await getSettings();
  const clients = await listClients();
  let clientId = settings.activeClientId && clients.some((c) => c.id === settings.activeClientId)
    ? settings.activeClientId : null;
  let client = clientId ? await getClient(clientId) : null;
  let timerSec = 5;

  const video = el('video', { playsinline: true, muted: true, autoplay: true, 'webkit-playsinline': '' });
  const stage = el('div.stage', video);

  const guide = el('div.guide', el('div.guide-body'),
    el('div.guide-hint', 'Face the camera · arms slightly away from your sides · fitted clothing gives the truest outline'));

  const closeBtn = el('button.icon-btn.solid', { 'aria-label': 'Close' }, icon('close'));
  const flipBtn = el('button.icon-btn.solid', { 'aria-label': 'Switch camera' }, icon('flip'));
  const readChip = el('span.chip', { style: { pointerEvents: 'none' } }, 'Finding you…');
  const topBar = el('div.cam-top', closeBtn,
    el('div', { style: { flex: 1, display: 'flex', justifyContent: 'center' } }, readChip), flipBtn);

  const shutter = el('button.shutter', { 'aria-label': 'Capture body scan', disabled: true }, el('i'));
  const timerBtn = el('button.icon-btn.solid', { 'aria-label': 'Self timer' },
    el('span', { style: { fontSize: '13px', fontWeight: '700' } }, `${timerSec}s`));
  const clientBtn = el('button.icon-btn.solid', { 'aria-label': 'Choose client' }, icon('person'));

  const captureBar = el('div.cam-bottom', null,
    el('div.glass', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', borderRadius: 'var(--r-lg)' },
    }, timerBtn, shutter, clientBtn),
    el('p.tiny', {
      style: { textAlign: 'center', margin: '11px 4px 0', color: 'rgba(242,237,228,.55)', lineHeight: '1.5' },
    }, 'Silhouette measurement — the photo itself is never stored.'),
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

  const camera = new CameraController(video);
  const smoother = new LandmarkSmoother({ minCutoff: 1.4, beta: 0.02 });
  let loop = null;
  let destroyed = false;
  let lastLandmarks = null;
  let counting = false;

  const setGate = (c) => { if (c) gate.replaceChildren(c); else gate.replaceChildren(); gate.hidden = !c; };
  const loading = (text) => el('div.perm-inner', el('div.loader'),
    el('p.mt-16', { style: { color: 'var(--text-dim)' } }, text));

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
    } catch (err) { showError(describeCameraError(err)); return; }
    if (destroyed) return;
    try {
      setGate(loading('Loading the body model…'));
      await poseEngine.load(settings.modelQuality, (s) => setGate(loading(s)));
      await poseEngine.setSegmentation(true);
    } catch (err) {
      console.error(err);
      showError({ title: 'Body model unavailable', body: 'The model could not load. Check your connection and try again.' });
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
      el('h2', title), el('p', body),
      el('div.stack', null,
        retry ? el('button.btn.btn-primary.btn-lg.btn-block', { onclick: boot }, 'Try again') : null,
        el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => navigate('/scan') }, 'Go back')),
    ));
  }

  function startLoop() {
    loop?.stop();
    loop = new FrameLoop(video, onFrame);
    loop.minInterval = 140;
    loop.start();
  }

  function onFrame(mediaTime) {
    if (destroyed || !poseEngine.ready) return;
    const { width, height } = camera.dimensions;
    if (!width || !height) return;
    const raw = poseEngine.detect(video, mediaTime);
    if (raw === undefined) return;
    lastLandmarks = raw ? smoother.apply(raw, performance.now()) : null;
    if (!lastLandmarks) { readChip.textContent = 'Step into frame'; return; }
    const px = toPixels(lastLandmarks, width, height);
    const need = [0, 11, 12, 23, 24, 25, 26, 27, 28];
    readChip.textContent = need.every((i) => (px[i]?.v ?? 0) >= 0.45)
      ? 'Ready — hold still' : 'Show your whole body';
  }

  /* ------------------------------------------------------------ actions */
  timerBtn.onclick = async () => {
    const picked = await pickSheet({
      title: 'Self timer',
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
      title: 'Save this scan to…',
      sub: 'Height is needed to convert the outline into centimetres.',
      options: [
        { value: '__none', title: 'Unassigned', sub: 'Uses a default 170 cm', emoji: '○' },
        ...clients.map((c) => ({ value: c.id, title: c.name, sub: c.heightCm ? `${c.heightCm} cm` : 'No height set', emoji: '●' })),
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
  async function capture() {
    if (!lastLandmarks) { toast('No one detected in frame', 'bad'); return; }
    setGate(loading('Measuring your outline…'));
    await new Promise((r) => setTimeout(r, 40));

    const shot = poseEngine.detectWithMask(video, performance.now());
    if (!shot?.mask || !shot.landmarks) {
      setGate(null);
      toast('Could not separate you from the background — try a plainer wall', 'bad');
      return;
    }

    const heightCm = client?.heightCm || 170;
    const measurement = measureSilhouette(shot.mask, shot.maskW, shot.maskH, shot.landmarks, { heightCm });
    if (!measurement) {
      setGate(null);
      toast('Move back so your whole body is in frame', 'bad');
      return;
    }

    const previous = (await listBodyScans(clientId, 1))[0] || null;
    const comparison = compareScans(measurement, previous?.measurement || null);

    const map = renderBodyMap(shot.mask, measurement, comparison?.profileDelta || null);
    annotateLevels(map, measurement, comparison);

    haptic(16);
    camera.stop();
    loop?.stop();
    setGate(null);
    showResults({ measurement, comparison, previous, heightCm }, map);
  }

  function resume() {
    resultView.style.display = 'none';
    resultView.replaceChildren();
    stage.style.display = '';
    captureView.style.display = '';
    if (!camera.active && !destroyed) boot();
  }

  function showResults(data, map) {
    captureView.style.display = 'none';
    stage.style.display = 'none';
    resultView.style.display = '';
    resultView.scrollTop = 0;
    resultView.replaceChildren(buildReport(data, map));
  }

  function buildReport({ measurement, comparison, previous, heightCm }, map) {
    const wrap = el('div');
    const mapUrl = map.toDataURL('image/jpeg', 0.9);

    wrap.append(el('div.spread', { style: { marginBottom: '16px' } },
      el('button.icon-btn.solid', { 'aria-label': 'Retake', onclick: resume }, icon('flip')),
      el('div', { style: { textAlign: 'center', flex: 1 } },
        el('div', { style: { fontFamily: 'var(--serif)', fontSize: '17px' } }, 'Body composition'),
        el('div.tiny.muted', `${heightCm} cm reference${client ? ` · ${client.name}` : ''}`),
      ),
      el('button.icon-btn.solid', { 'aria-label': 'Close', onclick: () => navigate('/scan') }, icon('close')),
    ));

    wrap.append(el('div.card', { style: { padding: '12px' } },
      el('img', { src: mapUrl, alt: 'Body silhouette map', style: { width: '100%', display: 'block', borderRadius: '14px' } }),
      comparison?.profileDelta
        ? el('div.heat-legend', el('span', 'Slimmer'), el('span.ramp'), el('span', 'Fuller'))
        : el('p.tiny.muted', { style: { margin: '12px 2px 0', lineHeight: '1.55', textAlign: 'center' } },
          'This is your baseline. Scan again in a couple of weeks and this silhouette turns into a change heatmap.'),
    ));

    /* ------------------------------------------------------- key ratios */
    const r = measurement.ratios;
    const whtBand = waistToHeightBand(r.waistToHeight);
    wrap.append(el('div.section-head.mt-24', el('h2', 'Key ratios')));
    wrap.append(el('div.card', null,
      ratioRow('Waist to height', r.waistToHeight, whtBand,
        'The single best-evidenced tape measure for health risk. Under 0.5 is the usual target.'),
      ratioRow('Waist to hip', r.waistToHip, null,
        'Describes your shape distribution. Track the direction it moves rather than the absolute number.'),
      ratioRow('Shoulder to waist', r.shoulderToWaist, null,
        'The V-taper figure. Rises as shoulders build or the waist comes down.'),
    ));

    /* -------------------------------------------------- level by level */
    wrap.append(el('div.section-head.mt-24', el('h2', comparison?.profileDelta ? 'Where you changed' : 'Measurements')));
    const grid = el('div.measure-grid');
    for (const lvl of Object.values(comparison?.levels || {})) {
      grid.append(el('div.measure', null,
        el('div.k', lvl.label),
        el('div.v', `${lvl.cm} cm`),
        lvl.deltaCm !== null
          ? el(`div.d.${lvl.direction}`, `${lvl.deltaCm > 0 ? '+' : ''}${lvl.deltaCm} cm`)
          : el('div.d.flat', 'baseline'),
      ));
    }
    wrap.append(grid);
    wrap.append(el('p.tiny.muted', { style: { margin: '10px 2px 0', lineHeight: '1.55' } },
      'Widths are measured across your silhouette at each level, converted using your height.'));

    if (comparison?.summary?.biggestLoss && comparison.summary.compared > 1) {
      const { biggestLoss, biggestGain } = comparison.summary;
      wrap.append(el('div.card.card-gold.mt-16', null,
        el('div.overline', { style: { marginBottom: '8px' } }, 'Since last scan'),
        el('p.small', { style: { margin: 0, lineHeight: '1.65', color: 'var(--text-dim)' } },
          biggestLoss.deltaCm < -0.4
            ? `Biggest reduction at the ${biggestLoss.label.toLowerCase()} (${biggestLoss.deltaCm} cm). `
            : '',
          biggestGain.deltaCm > 0.4
            ? `Biggest increase at the ${biggestGain.label.toLowerCase()} (+${biggestGain.deltaCm} cm).`
            : 'Nothing has moved much — which is its own useful signal.'),
      ));
    }

    /* -------------------------------------------------------- body fat */
    wrap.append(el('div.section-head.mt-24', el('h2', 'Body fat estimate')));
    const bfCard = el('div.card');
    renderBodyFat(bfCard, measurement, heightCm);
    wrap.append(bfCard);

    wrap.append(el('div.disclaimer.mt-16', icon('info'), el('span', BODY_DISCLAIMER)));

    const saveBtn = el('button.btn.btn-primary.btn-lg.btn-block.mt-24', icon('check'), 'Save scan');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const saved = await saveBodyScan({
          clientId,
          clientName: client?.name || '',
          heightCm,
          measurement: {
            widths: measurement.widths,
            rows: measurement.rows,
            profile: measurement.profile,
            ratios: measurement.ratios,
            circumference: measurement.circumference,
          },
          comparison: comparison ? { levels: comparison.levels, summary: comparison.summary } : null,
          previousId: previous?.id || null,
          map: mapUrl,
          thumb: bodyThumbnail(map),
          notes: '',
        });
        haptic(18);
        toast('Body scan saved', 'good');
        navigate(`/bodyscan/${saved.id}`);
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

  /**
   * Body fat needs tape measurements to mean anything. Offer the honest path
   * (Navy formula from real measurements) rather than inventing a number.
   */
  function renderBodyFat(card, measurement, heightCm) {
    const stored = client ? {
      sex: client.sex, neckCm: client.neckCm, waistCm: client.waistCm, hipCm: client.hipCm,
    } : {};
    const bf = navyBodyFat({ sex: stored.sex, heightCm, ...stored });

    card.replaceChildren();
    if (bf !== null) {
      card.append(
        el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
          el('div', { style: { fontFamily: 'var(--num)', fontSize: '34px', fontWeight: '800', letterSpacing: '-.03em' } }, `${bf}%`),
          el('span.pill.gold', 'US Navy method'),
        ),
        el('p.small.muted', { style: { margin: '10px 0 0', lineHeight: '1.6' } },
          'Calculated from your tape measurements. Typical error against DEXA is around ±3–4 percentage points, so treat the trend as the signal, not the digit.'),
      );
    } else {
      card.append(
        el('p.small.dim', { style: { margin: '0 0 14px', lineHeight: '1.65' } },
          'A camera cannot see beneath the skin, so Krysaril will not invent a body-fat figure from a photo. '
          + 'Add three tape measurements and it will calculate one properly using the US Navy method.'),
      );
    }
    card.append(el('button.btn.btn-gold-ghost.btn-block.mt-12', {
      onclick: () => measurementSheet(measurement, heightCm, card),
    }, bf !== null ? 'Update measurements' : 'Add tape measurements'));
  }

  function measurementSheet(measurement, heightCm, card) {
    const suggest = measurement.circumference;
    sheet((close) => {
      const sex = el('select.select', null,
        el('option', { value: '' }, 'Select…'),
        el('option', { value: 'female', selected: client?.sex === 'female' }, 'Female'),
        el('option', { value: 'male', selected: client?.sex === 'male' }, 'Male'),
      );
      const neck = el('input.input', { type: 'number', inputmode: 'decimal', placeholder: suggest.neck ? `≈ ${suggest.neck}` : '36', value: client?.neckCm || '' });
      const waist = el('input.input', { type: 'number', inputmode: 'decimal', placeholder: suggest.waist ? `≈ ${suggest.waist}` : '78', value: client?.waistCm || '' });
      const hip = el('input.input', { type: 'number', inputmode: 'decimal', placeholder: suggest.hips ? `≈ ${suggest.hips}` : '96', value: client?.hipCm || '' });

      return el('div', null,
        el('h2', 'Tape measurements'),
        el('p.sub', 'Measured with a tape, in centimetres. The placeholders are what the silhouette estimated — replace them with real numbers for an accurate result.'),
        el('label.field', null, el('span', 'Sex (the formula differs)'), sex),
        el('label.field', null, el('span', 'Neck — below the larynx'), neck),
        el('label.field', null, el('span', 'Waist — at the navel'), waist),
        el('label.field', null, el('span', 'Hips — widest point (needed for female)'), hip),
        el('div.stack.mt-8', null,
          el('button.btn.btn-primary.btn-lg.btn-block', {
            onclick: async () => {
              const patch = {
                sex: sex.value || null,
                neckCm: neck.value ? Number(neck.value) : null,
                waistCm: waist.value ? Number(waist.value) : null,
                hipCm: hip.value ? Number(hip.value) : null,
              };
              if (client) {
                client = await saveClient({ ...client, ...patch });
              } else {
                Object.assign(stashed, patch);
                client = { ...stashed, heightCm };
              }
              renderBodyFat(card, measurement, heightCm);
              close(true);
            },
          }, 'Calculate'),
          el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => close(false) }, 'Cancel'),
        ),
      );
    });
  }

  // Holds measurements when no client is selected, so the number still works.
  const stashed = {};

  boot();

  return {
    title: 'Body',
    node,
    full: true,
    hideAppBar: true,
    hideTabBar: true,
    destroy() {
      destroyed = true;
      loop?.stop();
      camera.stop();
      poseEngine.setSegmentation(false).catch(() => {});
    },
  };
}

function ratioRow(label, value, band, note) {
  return el('div.metric', null,
    el('div.metric-top', null,
      el('span.metric-name', label),
      el('span', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        band ? el(`span.pill.${band.level}`, band.label) : null,
        el('span.metric-val', value === null || value === undefined ? '—' : value.toFixed(2)),
      ),
    ),
    el('div.metric-note', note),
  );
}
