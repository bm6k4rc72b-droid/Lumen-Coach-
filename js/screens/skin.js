import { el, icon, toast, haptic, ring, bar, pickSheet } from '../ui.js';
import { CameraController, describeCameraError, cameraSupported, secureContextOk } from '../camera.js';
import { analyzeSkin, makeThumbnail } from '../skin/analyze.js';
import { metricCopy, levelOf, suggestions, headline, subhead, balanceLabel, trend, DISCLAIMER } from '../skin/guidance.js';
import { getSettings, setSetting, listClients, saveScan, listScans, getClient } from '../store.js';
import { navigate } from '../router.js';

export async function render() {
  const settings = await getSettings();
  const clients = await listClients();
  let clientId = settings.activeClientId && clients.some((c) => c.id === settings.activeClientId)
    ? settings.activeClientId : null;
  let client = clientId ? await getClient(clientId) : null;
  let region = 'face';

  /* ------------------------------------------------------------ capture */
  const video = el('video', { playsinline: true, muted: true, autoplay: true, 'webkit-playsinline': '' });
  const shot = el('img.shot', { alt: 'Captured skin photo', hidden: true });
  const stage = el('div.stage.mirror', video, shot);

  const guide = el('div.guide', el('div.guide-oval'),
    el('div.guide-hint', 'Fill the oval with your face · soft, even light · no makeup filter'));
  const closeBtn = el('button.icon-btn.solid', { 'aria-label': 'Close' }, icon('close'));
  const flipBtn = el('button.icon-btn.solid', { 'aria-label': 'Switch camera' }, icon('flip'));
  const regionChip = el('button.chip.on', { style: { pointerEvents: 'auto' } }, '😊 Face');

  const topBar = el('div.cam-top', closeBtn,
    el('div', { style: { flex: 1, display: 'flex', justifyContent: 'center' } }, regionChip),
    flipBtn);

  const shutter = el('button.shutter', { 'aria-label': 'Take photo', disabled: true }, el('i'));
  const libraryInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const libraryBtn = el('button.icon-btn.solid', { 'aria-label': 'Choose a photo from your library' }, icon('image'));
  const clientBtn = el('button.icon-btn.solid', { 'aria-label': 'Choose who this scan is for' }, icon('person'));

  const captureBar = el('div.cam-bottom', null,
    el('div.glass', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderRadius: 'var(--r-lg)' },
    },
      libraryBtn, shutter, clientBtn),
    el('p.tiny', {
      style: { textAlign: 'center', margin: '10px 4px 0', color: 'rgba(255,255,255,.6)', lineHeight: '1.45' },
    }, 'General wellness insights only — not a medical diagnosis.'),
  );

  const gate = el('div.perm');
  const captureView = el('div', { style: { position: 'absolute', inset: 0 } }, guide, topBar, captureBar, gate);
  stage.append(captureView);

  const resultView = el('div', {
    style: {
      position: 'absolute', inset: 0, overflowY: 'auto', display: 'none',
      background: 'var(--bg)', WebkitOverflowScrolling: 'touch',
      padding: 'calc(var(--safe-t) + 14px) calc(var(--pad) + var(--safe-r)) calc(var(--safe-b) + 30px) calc(var(--pad) + var(--safe-l))',
    },
  });

  // The stage is `flex: 1`, so the wrapper must be a column flex container —
  // otherwise it collapses to zero height and the controls fall off-screen.
  const node = el('div', {
    style: { position: 'fixed', inset: 0, background: '#000', display: 'flex', flexDirection: 'column' },
  }, stage, resultView);

  const camera = new CameraController(video);
  let destroyed = false;
  let lastCanvas = null;

  const setGate = (content) => {
    if (content) gate.replaceChildren(content); else gate.replaceChildren();
    gate.hidden = !content;
  };

  /* --------------------------------------------------------------- boot */
  async function boot() {
    setGate(el('div.perm-inner', el('div.loader'), el('p.mt-16', { style: { color: 'var(--text-dim)' } }, 'Starting the camera…')));
    if (!cameraSupported() || !secureContextOk()) {
      showCameraError(describeCameraError({ name: secureContextOk() ? 'NotFoundError' : 'SecurityError' }), false);
      return;
    }
    try {
      await camera.start({ facing: 'user', quality: 'high' });
      stage.classList.toggle('mirror', camera.facing === 'user');
      setGate(null);
      shutter.disabled = false;
    } catch (err) {
      showCameraError(describeCameraError(err));
    }
  }

  function showCameraError({ title, body }, retry = true) {
    setGate(el('div.perm-inner', null,
      el('div', { style: { fontSize: '34px', marginBottom: '8px' } }, '📷'),
      el('h2', title),
      el('p', body),
      el('div.stack', null,
        retry ? el('button.btn.btn-primary.btn-lg.btn-block', { onclick: boot }, 'Try again') : null,
        el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => libraryInput.click() }, 'Use a photo instead'),
        el('button.btn.btn-lg.btn-block.btn-quiet', { onclick: () => navigate('/') }, 'Go back'),
      ),
    ));
  }

  /* ------------------------------------------------------------ actions */
  regionChip.onclick = async () => {
    const picked = await pickSheet({
      title: 'What are we looking at?',
      sub: 'This only changes the framing guide and the area we measure.',
      options: [
        { value: 'face', title: 'Face', sub: 'Full-face wellness snapshot', emoji: '😊' },
        { value: 'area', title: 'Specific area', sub: 'Cheek, jawline, neck, arm…', emoji: '🔍' },
      ],
      value: region,
    });
    if (!picked) return;
    region = picked;
    regionChip.textContent = region === 'face' ? '😊 Face' : '🔍 Skin area';
    guide.replaceChildren(
      region === 'face' ? el('div.guide-oval') : el('div.guide-frame'),
      el('div.guide-hint', region === 'face'
        ? 'Fill the oval with your face · soft, even light'
        : 'Fill the frame with the area · hold about 20 cm away'),
    );
  };

  flipBtn.onclick = async () => {
    try {
      const facing = await camera.switchFacing();
      stage.classList.toggle('mirror', facing === 'user');
    } catch (err) { toast(describeCameraError(err).title, 'bad'); }
  };

  clientBtn.onclick = async () => {
    const picked = await pickSheet({
      title: 'Save this scan to…',
      options: [
        { value: '__none', title: 'Just me', sub: 'Saves to general history', emoji: '👤' },
        ...clients.map((c) => ({ value: c.id, title: c.name, sub: 'Client', emoji: '🧍' })),
      ],
      value: clientId || '__none',
    });
    if (picked === undefined) return;
    clientId = picked === '__none' ? null : picked;
    client = clientId ? await getClient(clientId) : null;
    await setSetting('activeClientId', clientId);
    toast(client ? `Saving to ${client.name}` : 'Saving to your own history');
  };

  libraryBtn.onclick = () => libraryInput.click();
  libraryInput.onchange = async () => {
    const file = libraryInput.files?.[0];
    if (!file) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = URL.createObjectURL(file);
    try {
      await img.decode();
      await runAnalysis(img, img.src);
    } catch {
      toast('Could not read that photo', 'bad');
    } finally {
      libraryInput.value = '';
    }
  };

  shutter.onclick = async () => {
    const canvas = camera.captureFrame({ maxSize: 1280 });
    if (!canvas) { toast('Camera is not ready yet', 'bad'); return; }
    haptic(14);
    await runAnalysis(canvas, canvas.toDataURL('image/jpeg', 0.9));
  };

  closeBtn.onclick = () => navigate('/');

  /* ----------------------------------------------------------- analysis */
  async function runAnalysis(source, previewUrl) {
    lastCanvas = source;
    shot.src = previewUrl;
    shot.hidden = false;
    video.style.visibility = 'hidden';
    setGate(el('div.perm-inner', el('div.loader'), el('p.mt-16', { style: { color: 'var(--text-dim)' } }, 'Reading your skin…')));

    await new Promise((r) => setTimeout(r, 60));   // let the spinner paint
    let result;
    try {
      result = analyzeSkin(source, { region });
    } catch (err) {
      console.error('Skin analysis failed', err);
      toast('Analysis failed — try another photo', 'bad');
      resume();
      return;
    }
    camera.stop({ keepWakeLock: false });
    setGate(null);
    await showResults(result, previewUrl);
  }

  function resume() {
    shot.hidden = true;
    shot.src = '';
    video.style.visibility = '';
    setGate(null);
    resultView.style.display = 'none';
    captureView.style.display = '';
    stage.style.display = '';
    if (!camera.active && !destroyed) boot();
  }

  async function showResults(result, previewUrl) {
    const previous = (await listScans(clientId, 2)).find(() => true) || null;
    const change = previous ? trend(result, { overall: previous.overall }) : null;

    captureView.style.display = 'none';
    stage.style.display = 'none';
    resultView.style.display = '';
    resultView.scrollTop = 0;
    resultView.replaceChildren(buildResults(result, previewUrl, change));
  }

  function buildResults(result, previewUrl, change) {
    const wrap = el('div');

    wrap.append(el('div.spread', { style: { marginBottom: '14px' } },
      el('button.icon-btn.solid', { 'aria-label': 'Retake', onclick: resume }, icon('flip')),
      el('div', { style: { textAlign: 'center', flex: 1 } },
        el('div', { style: { fontWeight: '680', fontSize: '16px' } }, 'Skin snapshot'),
        el('div.tiny.muted', client ? client.name : 'Personal scan'),
      ),
      el('button.icon-btn.solid', { 'aria-label': 'Close', onclick: () => navigate('/') }, icon('close')),
    ));

    if (!result.quality.good) {
      wrap.append(el('div.card', {
        style: { borderColor: 'rgba(246,198,91,.35)', background: 'rgba(246,198,91,.07)', marginBottom: '12px' },
      },
        el('div', { style: { fontWeight: '650', fontSize: '14px', color: 'var(--warn)' } }, 'Photo tips for a better read'),
        el('ul.tips', { style: { margin: '10px 0 0', paddingLeft: '20px' } },
          ...result.quality.issues.map((i) => el('li', { style: { fontSize: '13px' } }, i.text))),
        el('button.btn.btn-sm.btn-block.mt-12', { onclick: resume }, 'Retake photo'),
      ));
    }

    wrap.append(el('div.card', { style: { textAlign: 'center' } },
      el('div.big-score', ring(result.overall, { size: 138, label: 'WELLNESS' })),
      el('h2', { style: { fontSize: '19px', marginTop: '10px', lineHeight: '1.3' } }, headline(result.overall)),
      el('p.small.muted', { style: { margin: '8px 0 0', lineHeight: '1.55' } }, subhead(result.overall)),
      change ? el('div', { style: { marginTop: '12px' } },
        el(`span.pill.${change.level === 'good' ? 'good' : change.level === 'warn' ? 'warn' : 'neutral'}`, change.text)) : null,
      previewUrl ? el('img', {
        src: previewUrl, alt: '',
        style: { width: '84px', height: '84px', objectFit: 'cover', borderRadius: '18px', marginTop: '14px', border: '1px solid var(--line)' },
      }) : null,
    ));

    /* ---------------------------------------------------------- metrics */
    const metricsCard = el('div.card.mt-12');
    for (const [key, m] of Object.entries(result.metrics)) {
      if (m.score === null) continue;
      const copy = metricCopy(key, m.score);
      const level = levelOf(m.score);
      metricsCard.append(el('div.metric', null,
        el('div.metric-top', null,
          el('span.metric-name', copy.title),
          el('span.metric-val', { style: { color: `var(--${level === 'neutral' ? 'text-faint' : level})` } },
            key === 'balance' ? balanceLabel(result.balance) : `${m.score}`),
        ),
        bar(m.score, `var(--${level === 'neutral' ? 'text-faint' : level})`),
        el('div.metric-note', copy.note),
      ));
    }
    wrap.append(el('div.section-head.mt-24', el('h2', 'What we noticed')), metricsCard);

    /* ------------------------------------------------------ suggestions */
    const tips = suggestions(result);
    wrap.append(
      el('div.section-head.mt-24', el('h2', 'Gentle suggestions')),
      el('div.card', el('ul.tips', { style: { margin: 0, paddingLeft: '20px' } },
        ...tips.map((t) => el('li', el('strong', t.title), ' — ', t.body)))),
    );

    wrap.append(el('div.disclaimer.mt-16', icon('info'), el('span', DISCLAIMER)));

    /* ------------------------------------------------------------- save */
    const saveBtn = el('button.btn.btn-primary.btn-lg.btn-block.mt-24', icon('check'), 'Save to history');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const thumb = lastCanvas ? makeThumbnail(lastCanvas) : null;
        const saved = await saveScan({
          clientId,
          clientName: client?.name || '',
          overall: result.overall,
          metrics: result.metrics,
          balance: result.balance,
          quality: result.quality,
          stats: result.stats,
          region: result.region,
          thumb,
          notes: '',
          createdAt: Date.now(),
        });
        haptic(18);
        toast('Scan saved', 'good');
        navigate(`/scan/${saved.id}`);
      } catch (err) {
        console.error(err);
        toast('Could not save the scan', 'bad');
        saveBtn.disabled = false;
      }
    };

    wrap.append(saveBtn,
      el('button.btn.btn-lg.btn-block.btn-ghost.mt-12', { onclick: resume }, 'Scan again'),
      el('div', { style: { height: '20px' } }));

    return wrap;
  }

  boot();

  return {
    title: 'Skin scan',
    node,
    full: true,
    hideAppBar: true,
    hideTabBar: true,
    destroy() {
      destroyed = true;
      camera.stop();
    },
  };
}
