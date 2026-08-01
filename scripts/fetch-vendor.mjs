/**
 * Self-hosts the MediaPipe runtime + pose models so the app works fully
 * offline (and without a CDN) from the very first launch.
 *
 *   node scripts/fetch-vendor.mjs            # lite model only (~9 MB + wasm)
 *   node scripts/fetch-vendor.mjs --full     # also fetch the full model
 *
 * The app checks for ./vendor/vendor.json at runtime and prefers these files
 * over the CDN automatically. `vendor/` is git-ignored — run this at deploy
 * time if you want an offline-first build.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = join(root, 'vendor');

const TASKS_VERSION = process.env.TASKS_VISION_VERSION || '1.0.1';
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const MODELS = {
  lite: `${MODEL_CDN}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  full: `${MODEL_CDN}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
};

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  await pipeline(res.body, createWriteStream(dest));
  return dest;
}

const wantFull = process.argv.includes('--full');

console.log(`Fetching @mediapipe/tasks-vision@${TASKS_VERSION}…`);
const work = join(tmpdir(), `lumen-vendor-${Date.now()}`);
await mkdir(work, { recursive: true });
await exec('npm', ['pack', `@mediapipe/tasks-vision@${TASKS_VERSION}`, '--silent'], { cwd: work });
const [tarball] = (await exec('sh', ['-c', 'ls *.tgz'], { cwd: work })).stdout.trim().split('\n');
await exec('tar', ['xzf', tarball], { cwd: work });

const tasksDir = join(vendorDir, 'tasks-vision');
const wasmDir = join(tasksDir, 'wasm');
const modelsDir = join(vendorDir, 'models');
await mkdir(wasmDir, { recursive: true });
await mkdir(modelsDir, { recursive: true });

await exec('cp', [join(work, 'package', 'vision_bundle.mjs'), join(tasksDir, 'vision_bundle.mjs')]);
for (const file of WASM_FILES) {
  await exec('cp', [join(work, 'package', 'wasm', file), join(wasmDir, file)]);
  console.log(`  ✓ wasm/${file}`);
}
await rm(work, { recursive: true, force: true });

const models = ['lite', ...(wantFull ? ['full'] : [])];
for (const quality of models) {
  const name = `pose_landmarker_${quality}.task`;
  process.stdout.write(`Fetching ${name}… `);
  await download(MODELS[quality], join(modelsDir, name));
  console.log('✓');
}

await writeFile(join(vendorDir, 'vendor.json'), JSON.stringify({
  tasksVision: TASKS_VERSION,
  models,
  fetchedAt: new Date().toISOString(),
}, null, 2));

console.log('\nVendored assets ready in ./vendor — the app will now run fully offline.');
if (!wantFull) console.log('Tip: re-run with --full to also self-host the higher-accuracy model.');
