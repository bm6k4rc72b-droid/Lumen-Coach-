/**
 * End-to-end smoke test in a real browser with a fake camera.
 *
 *   node scripts/../test/e2e.mjs          (see npm run e2e)
 *
 * Verifies: routing, IndexedDB persistence, the pose pipeline actually
 * initialising against a live MediaStream, the skin analyser producing a
 * complete result, and the service worker registering.
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
await shot('01-dashboard');

console.log('\n▸ Client creation (IndexedDB)');
await page.click('.tab[data-tab="/clients"]');
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
    const r = indexedDB.open('lumen-coach');
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
await page.waitForURL(/#\/scan\//, { timeout: 10000 });
await page.waitForSelector('.big-score', { timeout: 10000 }).catch(() => {});
check('scan saved and detail opens', await page.locator('.big-score').isVisible());
check('saved scan shows its metrics', (await page.locator('.metric').count()) >= 5);
await shot('07-scan-detail');

console.log('\n▸ History, settings, PWA');
await page.goto(BASE + '/index.html#/history', { waitUntil: 'networkidle' });
await page.click('.chip:has-text("Skin")');
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
check('app shell precached', Object.entries(cached).some(([k, n]) => k.includes('shell') && n > 20),
  JSON.stringify(cached));

console.log('\n▸ Console health');
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await writeFile(join(shots, 'summary.json'), JSON.stringify({ skin: skin.result, errors }, null, 2));
await browser.close();
server.kill();

console.log(`\n${failures ? `✗ ${failures} check(s) failed` : '✓ all e2e checks passed'}\n`);
process.exit(failures ? 1 : 0);
