/**
 * Verifies the app works when served from a subdirectory (GitHub Pages style,
 * e.g. https://user.github.io/repo-name/) rather than a domain root.
 *
 *   node test/subpath.mjs
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, symlink, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8155;
const SUB = 'anthropic-claude-code';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// Serve a directory that contains the app under a nested path.
const site = await mkdtemp(join(tmpdir(), 'lumen-site-'));
await mkdir(join(site, 'nested'), { recursive: true });
await symlink(root, join(site, 'nested', SUB), 'dir');
const BASE = `http://localhost:${PORT}/nested/${SUB}`;

const server = spawn('npx', ['--yes', 'http-server', site, '-p', String(PORT), '-c-1', '--silent'], { stdio: 'ignore' });
process.on('exit', () => server.kill());

for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/index.html`)).ok) break; } catch { /* waiting */ }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  permissions: ['camera'], colorScheme: 'dark',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });

console.log(`\n▸ Served from ${BASE}`);
await page.goto(`${BASE}/index.html#/`, { waitUntil: 'networkidle' });
await page.waitForSelector('.hero', { timeout: 10000 });
check('app shell renders under a subpath', await page.locator('.hero h2').isVisible());

const manifestHref = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.href);
const manifestRes = await fetch(manifestHref);
check('manifest resolves relative to the subpath', manifestRes.ok, manifestHref);
const manifest = await manifestRes.json();
const startUrl = new URL(manifest.start_url, manifestHref).href;
check('start_url stays inside the subpath', startUrl.includes(`/${SUB}/`), startUrl);
const iconRes = await fetch(new URL(manifest.icons[0].src, manifestHref).href);
check('manifest icons resolve', iconRes.ok);

// Routing across screens.
await page.click('.tab[data-tab="/coach"]');
await page.waitForSelector('.chip', { timeout: 15000 });
check('hash routing works without server rewrites', page.url().includes('#/coach'));

// The knowledge base resolves its path the same way the pose model does, so
// it fails the same way if it is ever resolved against the module URL.
const kb = await page.evaluate(async () => {
  const { loadKnowledge } = await import('./js/assistant/knowledge.js');
  const data = await loadKnowledge({ force: true });
  return { source: data.source, entries: data.entries.length, version: data.version };
});
check('knowledge base fetched over the network under a subpath', kb.source === 'network',
  `${kb.source}, v${kb.version}, ${kb.entries} entries`);
check('knowledge base has its topics', kb.entries >= 15, String(kb.entries));

// The pose model path is the one that broke when resolved against the module
// URL instead of the document — this is the regression guard.
console.log('\n▸ Pose model asset resolution');
await page.goto(`${BASE}/index.html#/live?ex=squat`, { waitUntil: 'networkidle' });
await page.waitForSelector('.coach', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.perm')?.hidden, null, { timeout: 90000 }).catch(() => {});
const started = await page.locator('.perm').isHidden();
check('camera + pose model start under a subpath', started,
  started ? '' : await page.locator('.perm h2').textContent().catch(() => '?'));
const status = await page.locator('.cam-top .chip').nth(1).textContent();
check('inference running', /GPU|CPU/.test(status), status);

const swScope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
check('service worker scoped to the subpath', (swScope || '').includes(`/${SUB}/`), swScope);

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.kill();
console.log(`\n${failures ? `✗ ${failures} check(s) failed` : '✓ subpath deployment verified'}\n`);
process.exit(failures ? 1 : 0);
