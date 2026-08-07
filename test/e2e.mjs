/**
 * End-to-end smoke test in a real browser with a fake camera.
 *
 *   npm run e2e
 *
 * Verifies: routing, IndexedDB persistence, the pose pipeline initialising
 * against a live MediaStream, the posture / body / skin / speed engines
 * producing complete results, and the service worker registering.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'test-results');
const PORT = 8123;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const server = spawn('npx', ['--yes', 'http-server', root, '-p', String(PORT), '-c-1', '--silent'], {
  stdio: 'ignore',
});
process.on('exit', () => server.kill());

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/index.html');
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('static server never came up');
}

await waitForServer();
await mkdir(shots, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },      // iPhone 14 Pro logical size
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  permissions: ['camera'],
  colorScheme: 'dark',
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) errors.push(m.text());
});

const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });

console.log('\n▸ Dashboard');
await page.goto(BASE + '/index.html#/', { waitUntil: 'networkidle' });
await page.waitForSelector('.hero', { timeout: 10000 });
check('app shell renders', await page.locator('.hero h2').isVisible());
check('tab bar present', (await page.locator('.tabbar .tab').count()) === 5);
check('coach tab replaced clients in the bar', (await page.locator('.tab[data-tab="/coach"]').count()) === 1);
check('six capture entry points', (await page.locator('.section .card').count()) >= 6);
await shot('01-dashboard');

console.log('\n▸ Client creation (IndexedDB)');
await page.goto(BASE + '/index.html#/clients', { waitUntil: 'networkidle' });
await page.waitForSelector('.empty h3, .row');
await page.click('button:has-text("Add")');
await page.waitForSelector('.sheet');
await page.fill('.sheet input.input >> nth=0', 'Priya Shah');
await page.fill('.sheet input.input >> nth=1', '168');
await page.fill('.sheet textarea', 'Right knee sensitive to deep squats.');
await page.click('.sheet button:has-text("Create client")');
await page.waitForURL(/#\/client\//, { timeout: 5000 });
await page.waitForFunction(() => document.getElementById('appTitle')?.textContent === 'Priya Shah',
  null, { timeout: 8000 }).catch(() => {});
check('client detail opens after create', (await page.locator('h1').textContent()) === 'Priya Shah');
await shot('02-client');

const stored = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('krysaril');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return new Promise((res) => {
    const req = db.transaction('clients').objectStore('clients').getAll();
    req.onsuccess = () => res(req.result);
  });
});
check('client persisted to IndexedDB', stored.length === 1 && stored[0].heightCm === 168);

console.log('\n▸ Training setup');
await page.click('.tab[data-tab="/train"]');
await page.waitForSelector('.card:has-text("set-up")');
check('exercise grid shows all 8 exercises', (await page.locator('.card:has(.tiny)').count()) >= 8);
await page.click('button:has-text("Deadlift")');
check('exercise selection updates the set-up card',
  (await page.locator('.card:has-text("set-up")').textContent()).includes('Deadlift'));
await page.click('button:has-text("Squat")');
await shot('03-train-setup');

console.log('\n▸ Live pose analysis (fake camera + real MediaPipe)');
await page.click('button:has-text("Start live analysis")');
await page.waitForURL(/#\/live/);
await page.waitForSelector('.coach', { timeout: 15000 });

// The gate hides only once the camera AND the model are both up.
await page.waitForFunction(() => {
  const g = document.querySelector('.perm');
  return g && g.hidden;
}, null, { timeout: 90000 }).catch(() => {});

const gateHidden = await page.locator('.perm').isHidden();
check('camera + pose model started', gateHidden,
  gateHidden ? '' : await page.locator('.perm h2').textContent().catch(() => 'still loading'));

const status = await page.locator('.cam-top .chip').nth(1).textContent();
check('inference delegate reported', /GPU|CPU/.test(status), status);

await page.waitForTimeout(2500);
const live = await page.evaluate(() => ({
  tiles: document.querySelectorAll('.angle').length,
  coach: document.querySelector('.coach')?.textContent?.trim(),
  canvasW: document.querySelector('canvas.overlay')?.width,
  videoW: document.querySelector('video')?.videoWidth,
}));
check('angle HUD renders 4 tiles', live.tiles === 4, String(live.tiles));
check('overlay canvas sized to the display', live.canvasW > 0, String(live.canvasW));
check('camera stream is live', live.videoW > 0, `${live.videoW}px wide`);
check('coaching banner has copy', (live.coach || '').length > 4, live.coach);
await shot('04-live');

console.log('\n▸ Skin analysis engine');
await page.goto(BASE + '/index.html#/', { waitUntil: 'networkidle' });
const skin = await page.evaluate(async (tone) => {
  const { analyzeSkin, makeThumbnail } = await import('./js/skin/analyze.js');

  /** Synthetic skin patch. `mode` controls how much redness/texture/spots. */
  const build = (mode, base) => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 800;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    const irritated = mode === 'irritated';
    const cx = 320, cy = 368;

    // Texture frequency is kept inside the analyser's working resolution
    // (the image is downscaled to 512px), matching real skin micro-texture.
    const freq = 0.7;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const grain = (Math.sin(x * freq) + Math.cos(y * freq * 1.3)) * (irritated ? 7 : 1);
        let r = base[0] + grain, g = base[1] + grain, b = base[2] + grain;

        if (irritated) {
          // Localised flush over both cheeks — what irritation actually looks
          // like, and what a relative measure is designed to catch.
          for (const px of [cx - 130, cx + 130]) {
            const d = Math.hypot((x - px) / 95, (y - cy) / 85);
            if (d < 1) r += 40 * (1 - d);
          }
          // Scattered darker patches, all inside the framing oval.
          for (let s = 0; s < 10; s++) {
            const px = cx + Math.cos(s * 2.1) * 110, py = cy + Math.sin(s * 1.7) * 120;
            if ((x - px) ** 2 + (y - py) ** 2 < 22 * 22) { r -= 40; g -= 35; b -= 30; }
          }
        }
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };

  const calmCanvas = build('calm', tone);
  const t0 = performance.now();
  const calm = analyzeSkin(calmCanvas, { region: 'face' });
  const ms = performance.now() - t0;
  const irritated = analyzeSkin(build('irritated', tone), { region: 'face' });
  return { calm, irritated, ms, thumbLen: makeThumbnail(calmCanvas).length };
}, [196, 152, 134]);

const m = skin.calm.metrics;
const bad = skin.irritated.metrics;
check('overall wellness score produced', Number.isFinite(skin.calm.overall), String(skin.calm.overall));
check('all seven metrics scored', Object.values(m).every((x) => Number.isFinite(x.score)),
  Object.entries(m).map(([k, v]) => `${k}=${v.score}`).join(' '));
check('scores are in range 0–100', Object.values(m).every((x) => x.score >= 0 && x.score <= 100));
check('redness lowers the calm score', bad.calm.score < m.calm.score - 5,
  `calm ${m.calm.score} → irritated ${bad.calm.score}`);
check('dark patches lower pigmentation clarity', bad.clarity.score < m.clarity.score - 5,
  `clarity ${m.clarity.score} → ${bad.clarity.score}`);
check('rougher texture lowers smoothness', bad.smoothness.score < m.smoothness.score,
  `smoothness ${m.smoothness.score} → ${bad.smoothness.score}`);
check('overall score separates the two', skin.irritated.overall < skin.calm.overall - 5,
  `${skin.calm.overall} vs ${skin.irritated.overall}`);
check('quality report present', typeof skin.calm.quality.score === 'number', `q=${skin.calm.quality.score}`);
check('analysis is fast enough for phones', skin.ms < 1500, `${skin.ms.toFixed(0)}ms`);
check('thumbnail generated', skin.thumbLen > 1000, `${skin.thumbLen} chars`);

// Fairness: the same localised irritation must be detected across skin tones,
// and a calm face of any tone must score well.
const tones = await page.evaluate(async () => {
  const { analyzeSkin } = await import('./js/skin/analyze.js');
  const make = (base, flush) => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 800;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const grain = (Math.sin(x * 0.7) + Math.cos(y * 0.9)) * 1;
        let red = 0;
        if (flush) {
          for (const px of [320 - 130, 320 + 130]) {
            const d = Math.hypot((x - px) / 95, (y - 368) / 85);
            if (d < 1) red += 40 * (1 - d);
          }
        }
        img.data[i] = base[0] + grain + red;
        img.data[i + 1] = base[1] + grain;
        img.data[i + 2] = base[2] + grain;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };
  const run = (base) => ({
    calm: analyzeSkin(make(base, false), { region: 'face' }),
    flushed: analyzeSkin(make(base, true), { region: 'face' }),
  });
  return { deep: run([92, 62, 48]), medium: run([148, 108, 88]), light: run([236, 196, 178]) };
}, null);

for (const [name, r] of Object.entries(tones)) {
  check(`${name} skin tone: calm face scores well`,
    r.calm.overall >= 70 && r.calm.stats.skinCoverage > 60,
    `overall=${r.calm.overall} coverage=${r.calm.stats.skinCoverage}%`);
  check(`${name} skin tone: localised redness detected`,
    r.flushed.metrics.calm.score < r.calm.metrics.calm.score - 10,
    `${r.calm.metrics.calm.score} → ${r.flushed.metrics.calm.score}`);
}

console.log('\n▸ Skin capture screen');
await page.goto(BASE + '/index.html#/skin', { waitUntil: 'networkidle' });
await page.waitForSelector('.shutter');
await page.waitForFunction(() => !document.querySelector('.shutter')?.disabled, null, { timeout: 20000 }).catch(() => {});
check('capture UI ready', !(await page.locator('.shutter').isDisabled()));
check('framing guide visible', await page.locator('.guide-oval').isVisible());
await shot('05-skin-capture');

await page.click('.shutter');
await page.waitForSelector('.big-score', { timeout: 20000 });
check('capture → results flow works', await page.locator('.big-score').isVisible());
check('metrics list rendered', (await page.locator('.metric').count()) >= 5);
check('disclaimer shown', (await page.locator('.disclaimer').first().textContent()).includes('not'));
await shot('06-skin-results');

await page.click('button:has-text("Save to history")');
await page.waitForURL(/#\/skinscan\//, { timeout: 10000 });
await page.waitForSelector('.big-score', { timeout: 10000 }).catch(() => {});
check('scan saved and detail opens', await page.locator('.big-score').isVisible());
check('saved scan shows its metrics', (await page.locator('.metric').count()) >= 5);
await shot('07-scan-detail');

console.log('\n▸ Scan hub');
await page.goto(BASE + '/index.html#/scan', { waitUntil: 'networkidle' });
await page.waitForSelector('.hero');
check('scan hub lists three assessments', (await page.locator('.section > .card').count()) >= 3);
await shot('10-scan-hub');

console.log('\n▸ Posture assessment (fake camera + real MediaPipe)');
await page.goto(BASE + '/index.html#/posture', { waitUntil: 'networkidle' });
await page.waitForSelector('.shutter', { timeout: 15000 });
await page.waitForFunction(() => !document.querySelector('.shutter')?.disabled, null, { timeout: 90000 }).catch(() => {});
check('posture capture ready', !(await page.locator('.shutter').isDisabled()));
check('plumb-line guide shown', await page.locator('.guide-plumb').isVisible());
await shot('11-posture-capture');

// The fake camera shows no person, so exercise the maths directly in-page.
const posture = await page.evaluate(async () => {
  const { analyzePosture, postureWork } = await import('./js/posture/analyze.js');
  const { renderPostureChart, chartThumbnail } = await import('./js/posture/render.js');
  const W = 720, H = 1280, rad = (d) => (d * Math.PI) / 180;
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const put = (i, x, y) => { lm[i] = { x: x / W, y: y / H, z: 0, visibility: 1 }; };
  const A = { x: 300, y: 1150 }, K = { x: 307, y: 950 }, Hip = { x: 300, y: 742 };
  const S = { x: 312, y: 465 };
  const E = { x: S.x + 90 * Math.cos(rad(41)), y: S.y - 90 * Math.sin(rad(41)) };
  const o = 6;
  put(0, E.x + 30, E.y + 4);
  put(2, E.x - o, E.y); put(5, E.x + o, E.y);
  put(7, E.x - o, E.y); put(8, E.x + o, E.y);
  put(11, S.x - o, S.y); put(12, S.x + o, S.y);
  put(13, S.x, S.y + 110); put(14, S.x, S.y + 110);
  put(15, S.x, S.y + 210); put(16, S.x, S.y + 210);
  put(23, Hip.x - o, Hip.y); put(24, Hip.x + o, Hip.y);
  put(25, K.x - o, K.y); put(26, K.x + o, K.y);
  put(27, A.x - o, A.y); put(28, A.x + o, A.y);
  put(31, A.x + 60, A.y + 12); put(32, A.x + 60, A.y + 12);

  const analysis = analyzePosture(lm, W, H, { view: 'side' });
  const frame = document.createElement('canvas');
  frame.width = W; frame.height = H;
  const ctx = frame.getContext('2d');
  ctx.fillStyle = '#333'; ctx.fillRect(0, 0, W, H);
  const chart = renderPostureChart(frame, lm, analysis);
  return {
    view: analysis.view,
    overall: analysis.overall,
    measures: Object.fromEntries(Object.entries(analysis.measures).map(([k, v]) => [k, [v.value, v.level]])),
    work: postureWork(analysis).length,
    chartW: chart.width,
    thumbLen: chartThumbnail(chart).length,
  };
});
check('posture analysis runs in the browser', posture.view === 'side' && Number.isFinite(posture.overall),
  `overall=${posture.overall}`);
check('forward head detected on a slumped pose', posture.measures.forwardHead?.[1] !== 'good',
  JSON.stringify(posture.measures.forwardHead));
check('annotated chart rendered', posture.chartW > 0 && posture.thumbLen > 1000,
  `${posture.chartW}px, thumb ${posture.thumbLen} chars`);
check('corrective work produced', posture.work >= 1, `${posture.work} areas`);

console.log('\n▸ Body composition maths');
const body = await page.evaluate(async () => {
  const { measureSilhouette, compareScans } = await import('./js/body/silhouette.js');
  const { renderBodyMap, annotateLevels, bodyThumbnail } = await import('./js/body/heatmap.js');
  const w = 180, h = 320;
  const build = (waistW) => {
    const mask = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const isWaist = y > h * 0.36 && y < h * 0.52;
      const half = (isWaist ? waistW : 46) / 2;
      for (let x = 0; x < w; x++) if (Math.abs(x - w / 2) <= half) mask[y * w + x] = 1;
    }
    return mask;
  };
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const put = (i, x, y) => { lm[i] = { x: x / w, y: y / h, z: 0, visibility: 1 }; };
  const cx = w / 2;
  put(0, cx, h * 0.10); put(7, cx - 12, h * 0.09); put(8, cx + 12, h * 0.09);
  put(11, cx - 40, h * 0.20); put(12, cx + 40, h * 0.20);
  put(23, cx - 26, h * 0.52); put(24, cx + 26, h * 0.52);
  put(25, cx - 22, h * 0.72); put(26, cx + 22, h * 0.72);
  put(27, cx - 20, h * 0.94); put(28, cx + 20, h * 0.94);

  const before = measureSilhouette(build(60), w, h, lm, { heightCm: 175 });
  const maskNow = build(46);
  const now = measureSilhouette(maskNow, w, h, lm, { heightCm: 175 });
  const cmp = compareScans(now, before);
  const map = renderBodyMap(maskNow, now, cmp.profileDelta);
  annotateLevels(map, now, cmp);
  return {
    waistCm: now.widths.waist?.cm,
    whtr: now.ratios.waistToHeight,
    whr: now.ratios.waistToHip,
    waistDelta: cmp.levels.waist.deltaCm,
    direction: cmp.levels.waist.direction,
    mapW: map.width,
    thumbLen: bodyThumbnail(map).length,
  };
});
check('silhouette measured', body.waistCm > 0 && body.whtr > 0, `waist ${body.waistCm}cm WHtR ${body.whtr}`);
check('waist reduction detected', body.waistDelta < 0 && body.direction === 'down', `${body.waistDelta} cm`);
check('heatmap rendered', body.mapW > 0 && body.thumbLen > 1000, `${body.mapW}px, thumb ${body.thumbLen}`);

console.log('\n▸ Body scan screen');
await page.goto(BASE + '/index.html#/body', { waitUntil: 'networkidle' });
await page.waitForSelector('.shutter', { timeout: 15000 });
await page.waitForFunction(() => !document.querySelector('.shutter')?.disabled, null, { timeout: 90000 }).catch(() => {});
check('body capture ready', !(await page.locator('.shutter').isDisabled()));
await shot('12-body-capture');

console.log('\n▸ Speed & output');
await page.goto(BASE + '/index.html#/speed', { waitUntil: 'networkidle' });
await page.waitForSelector('.round-clock', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.perm')?.hidden, null, { timeout: 90000 }).catch(() => {});
check('speed tracker started', await page.locator('.perm').isHidden());
check('round clock shown', (await page.locator('.round-clock').textContent()).includes(':'));
check('three live metric tiles', (await page.locator('.metric-tile').count()) === 3);
await page.click('button:has-text("Start round")');
await page.waitForTimeout(1200);
check('round goes live', (await page.locator('.rep-hud').textContent()).toLowerCase().includes('live'));
await shot('13-speed-live');
await page.click('button:has-text("End round")');
await page.waitForTimeout(400);
check('round ends cleanly', !(await page.locator('button:has-text("Start round")').isDisabled()));

console.log('\n▸ Recovery scan');
await page.goto(BASE + '/index.html#/vitals', { waitUntil: 'networkidle' });
await page.waitForSelector('.stage', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.perm')?.hidden, null, { timeout: 90000 }).catch(() => {});
check('recovery camera opens', await page.locator('.perm').isHidden());
const vitalsHud = (await page.locator('.rep-hud').innerText()).toLowerCase();
check('bpm and hrv readouts present', /bpm/.test(vitalsHud) && /hrv/.test(vitalsHud),
  vitalsHud.replace(/\n/g, ' '));
check('trace canvas present', (await page.locator('.stage canvas').count()) >= 1);
await shot('14-vitals');

// The fake camera has no pulse in it, so drive the rPPG maths in-page instead.
const pulse = await page.evaluate(async () => {
  const { PulseBuffer, analysePulse, readinessScore } = await import('./js/vitals/rppg.js');
  const make = (bpm, noise, seed = 99) => {
    const buf = new PulseBuffer(30);
    let s = seed >>> 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    };
    for (let i = 0; i < 20 * 30; i++) {
      const ph = (2 * Math.PI * (bpm / 60) * i) / 30;
      const beat = bpm ? (Math.sin(ph) + 0.3 * Math.sin(2 * ph)) * 2 : 0;
      const g = 128 + beat + rand() * noise;
      buf.push((i / 30) * 1000, { r: 180, g, b: 110 });
    }
    return analysePulse(buf);
  };
  const clean = make(68, 0);
  // Whether one noise record slips past a threshold is luck, so sweep seeds.
  let pulselessAccepted = 0;
  for (let s = 1; s <= 25; s++) if (make(0, 10, s * 7919).ready) pulselessAccepted++;
  const history = [{ bpm: 60, rmssd: 50 }, { bpm: 59, rmssd: 48 }, { bpm: 61, rmssd: 52 }];
  return {
    bpm: clean.bpm,
    ready: clean.ready,
    rmssd: clean.rmssd,
    pulselessAccepted,
    readiness: readinessScore({ bpm: clean.bpm, rmssd: clean.rmssd }, history).score,
  };
});
check('heart rate recovered in-browser', pulse.ready && Math.abs(pulse.bpm - 68) <= 3, `${pulse.bpm} bpm`);
check('hrv computed', pulse.rmssd !== null, `rmssd ${pulse.rmssd}`);
check('pulseless recordings are all refused', pulse.pulselessAccepted === 0,
  `${pulse.pulselessAccepted}/25 accepted`);
check('readiness scores against a baseline', pulse.readiness >= 1 && pulse.readiness <= 100, String(pulse.readiness));

console.log('\n▸ Blood work');
await page.goto(BASE + '/index.html#/labs', { waitUntil: 'networkidle' });
await page.waitForSelector('input[aria-label="HbA1c"]', { timeout: 10000 });
check('every marker gets a field', (await page.locator('.section .card input.input').count()) >= 18);
check('assess is disabled until something is entered',
  await page.locator('button:has-text("Assess panel")').isDisabled());
// One value far outside range, one merely raised that lifestyle genuinely moves.
await page.fill('input[aria-label="HbA1c"]', '12');
await page.fill('input[aria-label="Triglycerides"]', '2.4');
await page.fill('input[aria-label="Fasting glucose"]', '4.9');
await shot('15-labs-entry');
await page.click('button:has-text("Assess panel")');
await page.waitForURL(/#\/labsreport\//, { timeout: 8000 });
await page.waitForSelector('.metric', { timeout: 8000 });

const report = await page.evaluate(() => document.body.innerText);
check('urgent value raises the doctor banner', /contact a doctor/i.test(report));
check('report lists the referral section', /for your doctor/i.test(report));
check('lifestyle levers still offered for triglycerides', /triglycerides/i.test(report)
  && /lifestyle levers/i.test(report));
const tipsSection = await page.locator('.card:below(:text("Lifestyle levers"))').first().innerText();
check('no lifestyle tips attached to the urgent marker', !/hba1c/i.test(tipsSection), tipsSection.slice(0, 60));
check('three markers rendered', (await page.locator('.metric').count()) === 3);
await shot('16-labs-report');

console.log('\n▸ Coach and program');
await page.evaluate(async () => {
  // Seed a posture finding so the program has real movement work to plan,
  // not only the blood-work path.
  const { savePosture, getSettings } = await import('./js/store.js');
  const { activeClientId } = await getSettings();
  await savePosture({
    clientId: activeClientId ?? null,
    view: 'side',
    overall: 61,
    measures: [
      { id: 'forwardHead', label: 'Forward head', value: 42, level: 'bad', ideal: [48, 90] },
      { id: 'shoulderProtraction', label: 'Shoulder protraction', value: 31, level: 'warn', ideal: [0, 18] },
    ],
  });
});

await page.goto(BASE + '/index.html#/coach', { waitUntil: 'networkidle' });
await page.waitForSelector('.chip', { timeout: 10000 });
check('coach greets with suggested topics', (await page.locator('.wrap .chip').count()) >= 6);
check('assessments feeding the coach are listed', (await page.locator('.list .row').count()) === 5);
check('bloods show as in use', (await page.locator('.row:has-text("Bloods") .pill.gold').count()) === 1);
await shot('17-coach');

await page.fill('input[aria-label="Ask the coach a question"]', 'my knees cave in when I squat');
await page.click('button[aria-label="Send"]');
await page.waitForFunction(
  () => !/^…$/.test(document.querySelectorAll('[style*="border-radius"]')[0]?.textContent || ''),
  null, { timeout: 8000 },
).catch(() => {});
await page.waitForTimeout(600);
const chat = await page.evaluate(() => document.body.innerText);
check('coach answers from the knowledge base', /knowledge base v/i.test(chat), chat.slice(-160).replace(/\n/g, ' '));
check('the answer is the knee-tracking topic', /valgus|knee/i.test(chat));
await shot('18-coach-answer');

await page.click('button:has-text("Build my program")');
await page.waitForURL(/#\/program\//, { timeout: 8000 });
await page.waitForSelector('.hero', { timeout: 8000 });
const program = await page.evaluate(() => document.body.innerText);
check('program page renders a week', /a typical week/i.test(program));
check('program explains why', /why this program/i.test(program));
check('long arc has three phases', (await page.locator('.overline:has-text("Weeks")').count()) === 3);
check('urgent bloods appear as a clinical flag', /clear these with a clinician first/i.test(program));
check('urgent bloods are not turned into training work',
  !/hba1c/i.test(program.split(/the work/i)[1] || ''));
check('re-measure schedule present', /re-measure/i.test(program));
await shot('19-program');

console.log('\n▸ History, settings, PWA');
await page.goto(BASE + '/index.html#/history', { waitUntil: 'networkidle' });
await page.waitForSelector('.chip');
check('history has a tab per record type', (await page.locator('.chip').count()) === 8);
await page.click('.chip:has-text("Skin")');
await page.waitForTimeout(200);
check('skin history lists the saved scan', (await page.locator('.row').count()) >= 1);
await shot('08-history');

await page.goto(BASE + '/index.html#/settings', { waitUntil: 'networkidle' });
await page.waitForSelector('.toggle');
check('settings toggles render', (await page.locator('.toggle').count()) === 4);
await shot('09-settings');

await page.goto(BASE + '/index.html#/about', { waitUntil: 'networkidle' });
await page.waitForSelector('.disclaimer', { timeout: 10000 }).catch(() => {});
check('about screen renders', (await page.locator('.card').count()) >= 4,
  `${await page.locator('.card').count()} cards`);

const manifest = await (await fetch(BASE + '/manifest.webmanifest')).json();
check('manifest is valid JSON with icons', manifest.icons.length >= 4, manifest.name);
check('manifest renamed to Krysaril', manifest.short_name === 'Krysaril', manifest.short_name);

const swReady = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(reg && (reg.active || reg.installing || reg.waiting));
});
check('service worker registered', swReady);

const cached = await page.evaluate(async () => {
  const keys = await caches.keys();
  const counts = {};
  for (const k of keys) counts[k] = (await (await caches.open(k)).keys()).length;
  return counts;
});
check('app shell precached', Object.entries(cached).some(([k, n]) => k.includes('shell') && n > 25),
  JSON.stringify(cached));

console.log('\n▸ Console health');
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await writeFile(join(shots, 'summary.json'), JSON.stringify({ skin: skin.result, errors }, null, 2));
await browser.close();
server.kill();

console.log(`\n${failures ? `✗ ${failures} check(s) failed` : '✓ all e2e checks passed'}\n`);
process.exit(failures ? 1 : 0);
