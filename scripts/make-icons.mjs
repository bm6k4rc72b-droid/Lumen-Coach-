/**
 * Generates the PWA icon set from a single vector source.
 *   node scripts/make-icons.mjs
 *
 * Uses the Playwright Chromium that ships with this environment purely as a
 * renderer — no runtime dependency for the app itself.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'icons');

/**
 * @param {object} opts
 * @param {number} opts.size canvas size
 * @param {number} opts.inset safe-area inset (maskable icons need ~10%)
 * @param {boolean} opts.bleed fill the whole canvas with the background
 */
function svg({ size = 512, inset = 0, bleed = false } = {}) {
  const s = size;
  const pad = s * inset;
  const inner = s - pad * 2;
  const r = bleed ? 0 : s * 0.22;
  const cx = s / 2, cy = s / 2;
  const ringR = inner * 0.34;
  const stroke = inner * 0.075;

  // 3/4 progress arc, echoing the score rings in the app.
  const start = -125, end = 125;
  const pt = (deg, radius) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius];
  };
  const [x1, y1] = pt(start, ringR);
  const [x2, y2] = pt(end, ringR);

  const figure = () => {
    const h = inner * 0.30;
    const top = cy - h * 0.52;
    const w = inner * 0.115;
    const lw = inner * 0.052;
    return `
      <g stroke="#fff" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <circle cx="${cx}" cy="${top - lw * 0.9}" r="${lw * 0.92}" fill="#fff" stroke="none"/>
        <path d="M${cx} ${top + lw * 0.5} L${cx} ${top + h * 0.5}"/>
        <path d="M${cx - w} ${top + h * 0.16} L${cx} ${top + h * 0.24} L${cx + w} ${top + h * 0.05}"/>
        <path d="M${cx} ${top + h * 0.5} L${cx - w * 0.92} ${top + h * 0.82} L${cx - w * 0.62} ${top + h * 1.12}"/>
        <path d="M${cx} ${top + h * 0.5} L${cx + w * 0.92} ${top + h * 0.86} L${cx + w * 1.02} ${top + h * 1.2}"/>
      </g>`;
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f2a9bd"/>
      <stop offset="100%" stop-color="#b473c6"/>
    </linearGradient>
    <radialGradient id="glow" cx="26%" cy="14%" r="86%">
      <stop offset="0%" stop-color="#f2a9bd" stop-opacity=".34"/>
      <stop offset="60%" stop-color="#b473c6" stop-opacity=".12"/>
      <stop offset="100%" stop-color="#0b0d10" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="${s}" height="${s}" rx="${r}" fill="#0b0d10"/>
  <rect x="0" y="0" width="${s}" height="${s}" rx="${r}" fill="url(#glow)"/>
  <circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="#1e232b" stroke-width="${stroke}"/>
  <path d="M${x1} ${y1} A ${ringR} ${ringR} 0 1 1 ${x2} ${y2}"
        fill="none" stroke="url(#brand)" stroke-width="${stroke}" stroke-linecap="round"/>
  ${figure()}
</svg>`;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, inset: 0 },
  { file: 'icon-512.png', size: 512, inset: 0 },
  { file: 'maskable-192.png', size: 192, inset: 0.12, bleed: true },
  { file: 'maskable-512.png', size: 512, inset: 0.12, bleed: true },
  { file: 'apple-touch-icon.png', size: 180, inset: 0.04, bleed: true },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

await mkdir(iconsDir, { recursive: true });
await writeFile(join(iconsDir, 'favicon.svg'), svg({ size: 512 }), 'utf8');

for (const target of TARGETS) {
  const markup = svg(target);
  await page.setViewportSize({ width: target.size, height: target.size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}</style>${markup}`,
    { waitUntil: 'load' },
  );
  const buffer = await page.screenshot({ omitBackground: true, type: 'png' });
  await writeFile(join(iconsDir, target.file), buffer);
  console.log(`✓ icons/${target.file} (${target.size}×${target.size})`);
}

await browser.close();
console.log('✓ icons/favicon.svg');
