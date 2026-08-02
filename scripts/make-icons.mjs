/**
 * Generates the Krysaril icon set from a single vector source.
 *   node scripts/make-icons.mjs
 *
 * The mark: a plumb line bisecting an open arc — the posture/judgement
 * motif — struck in champagne on obsidian.
 *
 * Uses the Playwright Chromium that ships with this environment purely as a
 * renderer; the app itself has no runtime dependency on it.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'icons');

function svg({ size = 512, inset = 0, bleed = false } = {}) {
  const s = size;
  const pad = s * inset;
  const inner = s - pad * 2;
  const r = bleed ? 0 : s * 0.22;
  const cx = s / 2, cy = s / 2;

  const ringR = inner * 0.395;
  const hairline = Math.max(1, inner * 0.011);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="brass" x1="0.1" y1="0" x2="0.85" y2="1">
      <stop offset="0%" stop-color="#f6e8c6"/>
      <stop offset="42%" stop-color="#d9b877"/>
      <stop offset="100%" stop-color="#9d7f47"/>
    </linearGradient>
    <radialGradient id="glow" cx="24%" cy="8%" r="94%">
      <stop offset="0%" stop-color="#d3b072" stop-opacity=".26"/>
      <stop offset="58%" stop-color="#a8894f" stop-opacity=".09"/>
      <stop offset="100%" stop-color="#08090b" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="${s}" height="${s}" rx="${r}" fill="#08090b"/>
  <rect x="0" y="0" width="${s}" height="${s}" rx="${r}" fill="url(#glow)"/>

  <!-- hairline frame -->
  <circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none"
          stroke="#d3b072" stroke-opacity="0.34" stroke-width="${hairline}"/>

  <!-- serif monogram -->
  <text x="${cx}" y="${cy}" fill="url(#brass)"
        font-family="Hoefler Text, Iowan Old Style, Palatino Linotype, Palatino, Times New Roman, Georgia, serif"
        font-size="${inner * 0.60}" font-weight="400"
        text-anchor="middle" dominant-baseline="central"
        letter-spacing="${inner * 0.006}">K</text>
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
  await page.setViewportSize({ width: target.size, height: target.size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}</style>${svg(target)}`,
    { waitUntil: 'load' },
  );
  await writeFile(join(iconsDir, target.file), await page.screenshot({ omitBackground: true, type: 'png' }));
  console.log(`✓ icons/${target.file} (${target.size}×${target.size})`);
}

await browser.close();
console.log('✓ icons/favicon.svg');
