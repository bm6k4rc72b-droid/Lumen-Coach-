/**
 * On-device skin wellness analysis.
 *
 * Everything runs locally on the captured frame — no upload, no model.
 * The metrics are *image* measurements (evenness, redness, micro-texture,
 * shine, spot density) mapped onto encouraging 0–100 wellness scores.
 *
 * This is a general wellness tool, not a medical device or a diagnosis.
 *
 * Design notes
 * ------------
 * • Every measurement is taken relative to the person's *own* skin baseline
 *   (median tone inside the framing oval), so results are consistent across
 *   skin tones rather than tuned to one of them.
 * • Texture measurements are normalised by local brightness, so a dim gym
 *   bathroom and bright daylight give comparable readings.
 */

const WORK_SIZE = 512;

/* ------------------------------------------------------------ colour maths */

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fLab = (t) => (t > 0.008856451679 ? Math.cbrt(t) : t * 7.787037 + 16 / 116);

/** sRGB (0..255) → CIE L*a*b* (D65). */
function rgbToLab(r, g, b) {
  const R = srgbToLinear(r / 255), G = srgbToLinear(g / 255), B = srgbToLinear(b / 255);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/* --------------------------------------------------------------- utilities */

function median(arr) {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort();
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function percentile(sortedLike, p) {
  if (!sortedLike.length) return 0;
  const a = Float64Array.from(sortedLike).sort();
  const idx = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))));
  return a[idx];
}

function mad(values, med) {
  if (!values.length) return 0;
  const devs = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) devs[i] = Math.abs(values[i] - med);
  return median(devs);
}

function stdev(values) {
  if (values.length < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let acc = 0;
  for (const v of values) acc += (v - mean) ** 2;
  return Math.sqrt(acc / values.length);
}

/**
 * Separable box blur (three passes ≈ Gaussian) on a Float32 plane.
 * Each pass blurs along rows and writes transposed, so two passes bring the
 * plane back to its original orientation having blurred both axes.
 */
function boxBlur(src, w, h, radius, passes = 3) {
  if (radius < 1) return Float32Array.from(src);
  const a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    blurRowsTransposed(a, b, w, h, radius);   // w×h → h×w
    blurRowsTransposed(b, a, h, w, radius);   // h×w → w×h
  }
  return a;
}

function blurRowsTransposed(src, dst, w, h, radius) {
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[row + clamp(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[x * h + y] = sum / win;
      sum -= src[row + clamp(x - radius, 0, w - 1)];
      sum += src[row + clamp(x + radius + 1, 0, w - 1)];
    }
  }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);

/** Maps a raw measurement onto 0–100 where `best` scores 100 and `worst` scores 0. */
function scoreFrom(value, best, worst) {
  if (value === null || !Number.isFinite(value)) return null;
  const t = (value - worst) / (best - worst);
  return Math.round(clamp01(t) * 100);
}

/* ------------------------------------------------------------- preparation */

/** Draws the source onto a working canvas, downscaled for speed. */
function toWorkingImage(source) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, WORK_SIZE / Math.max(sw, sh));
  const w = Math.max(64, Math.round(sw * scale));
  const h = Math.max(64, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h), w, h };
}

/**
 * Elliptical region matching the on-screen framing guide.
 * `region` = 'face' (tall oval) or 'area' (wide rounded box).
 */
function buildRoi(w, h, region) {
  const cx = w / 2;
  const cy = region === 'face' ? h * 0.46 : h * 0.5;
  const rx = region === 'face' ? w * 0.33 : w * 0.40;
  const ry = region === 'face' ? h * 0.31 : h * 0.34;
  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) { mask[y * w + x] = 1; count++; }
    }
  }
  return { mask, count, cx, cy, rx, ry };
}

/* ------------------------------------------------------------ main analysis */

/**
 * @param {HTMLCanvasElement|HTMLVideoElement|HTMLImageElement} source
 * @param {{region?: 'face'|'area'}} opts
 * @returns {object} metrics + quality report
 */
export function analyzeSkin(source, { region = 'face' } = {}) {
  const { data: imageData, w, h } = toWorkingImage(source);
  const px = imageData.data;
  const roi = buildRoi(w, h, region);

  // --- Convert the ROI to Lab planes -------------------------------------
  const L = new Float32Array(w * h);
  const A = new Float32Array(w * h);
  const B = new Float32Array(w * h);
  const Cb = new Float32Array(w * h);
  const Cr = new Float32Array(w * h);

  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = px[p], g = px[p + 1], b = px[p + 2];
    const [l, a, bb] = rgbToLab(r, g, b);
    L[i] = l; A[i] = a; B[i] = bb;
    Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }

  // --- Adaptive skin mask, anchored to the centre of the guide ------------
  const core = [];
  const coreRx = roi.rx * 0.45, coreRy = roi.ry * 0.45;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - roi.cx) / coreRx, ny = (y - roi.cy) / coreRy;
      if (nx * nx + ny * ny <= 1) core.push(y * w + x);
    }
  }
  const coreCb = core.map((i) => Cb[i]);
  const coreCr = core.map((i) => Cr[i]);
  const coreL = core.map((i) => L[i]);
  const medCb = median(coreCb), medCr = median(coreCr), medL = median(coreL);
  const tolCb = Math.max(11, 3.2 * mad(coreCb, medCb));
  const tolCr = Math.max(11, 3.2 * mad(coreCr, medCr));

  const skin = new Uint8Array(w * h);
  const skinIdx = [];
  // Redness *is* skin, so the mask is deliberately asymmetric: it stays tight
  // on the blue/green side (hair, clothing, background) and opens up on the
  // red side so irritated or flushed areas are measured, not discarded.
  const tolCrHigh = tolCr * 2.6;
  const tolCbLow = tolCb * 2.0;
  for (let i = 0; i < w * h; i++) {
    if (!roi.mask[i]) continue;
    const dCb = Cb[i] - medCb;
    const dCr = Cr[i] - medCr;
    if (dCb > tolCb || dCb < -tolCbLow) continue;
    if (dCr > tolCrHigh || dCr < -tolCr) continue;
    if (Math.abs(L[i] - medL) > 42) continue;      // hair, shadow, background
    skin[i] = 1;
    skinIdx.push(i);
  }

  const skinFraction = roi.count ? skinIdx.length / roi.count : 0;
  const usable = skinFraction >= 0.18 ? skinIdx : [...roi.mask.keys()].filter((i) => roi.mask[i]);
  const sample = usable;

  const Ls = sample.map((i) => L[i]);
  const As = sample.map((i) => A[i]);
  const Bs = sample.map((i) => B[i]);

  const meanL = Ls.reduce((a, b) => a + b, 0) / (Ls.length || 1);
  const medA = median(As);
  const medB = median(Bs);

  // --- Quality gates ------------------------------------------------------
  const lapFull = laplacianEnergy(L, w, h, roi.mask);
  const quality = assessQuality({ meanL, sharpness: lapFull.sharpness, skinFraction, samples: sample.length });

  // --- Frequency decomposition (used by texture / pores / spots) ----------
  const fine = boxBlur(L, w, h, 1);        // suppresses sensor noise
  const mid = boxBlur(L, w, h, 4);         // smooths pores, keeps blotches
  const coarse = boxBlur(L, w, h, 14);     // overall lighting + tone field

  // --- 1. Tone evenness ---------------------------------------------------
  // Deviation from the person's own large-scale tone field: lighting-safe.
  const toneDev = [];
  for (const i of sample) toneDev.push(mid[i] - coarse[i]);
  const toneSpread = stdev(toneDev);
  const hueSpread = stdev(sample.map((i) => Math.atan2(B[i], A[i]) * 57.2958));
  const evennessRaw = toneSpread + hueSpread * 0.08;
  const evenness = scoreFrom(evennessRaw, 1.6, 8.5);

  // --- 2. Redness / visible irritation ------------------------------------
  // Measures *localised* redness — areas noticeably redder than the rest of
  // this person's skin. Deliberately relative: a uniformly warm complexion is
  // someone's natural tone, not irritation, and treating it as a problem would
  // penalise deeper and warmer skin tones for existing.
  //
  // The cut-off scales with the natural spread of their own tone (robust MAD,
  // not stdev, so a large flare cannot raise the bar that should catch it).
  const madA = mad(As, medA) * 1.4826;
  const redCut = Math.max(2.2, madA * 2.0);
  let redArea = 0, redSum = 0;
  for (const i of sample) {
    const d = A[i] - medA;
    if (d > redCut) { redArea++; redSum += d - redCut; }
  }
  const redFraction = sample.length ? redArea / sample.length : 0;
  const redIntensity = redArea ? redSum / redArea : 0;
  const redRaw = redFraction * 100 * clamp(redIntensity / 3.2, 0.6, 2.2);
  const calm = scoreFrom(redRaw, 4, 42);

  // --- 3. Texture / smoothness --------------------------------------------
  // Micro-contrast relative to local brightness.
  let texAcc = 0, texN = 0;
  for (const i of sample) {
    const local = mid[i] || 1;
    texAcc += Math.abs(fine[i] - mid[i]) / Math.max(18, local);
    texN++;
  }
  const textureRaw = texN ? (texAcc / texN) * 1000 : null;
  const smoothness = scoreFrom(textureRaw, 6, 34);

  // --- 4. Pore visibility --------------------------------------------------
  // Small dark points: pixels sitting well below their 4-px neighbourhood.
  // The baseline is sampled with a stride so it spans the whole region rather
  // than just the first rows.
  const stride = Math.max(1, Math.floor(sample.length / 4000));
  const poreBase = [];
  for (let i = 0; i < sample.length; i += stride) poreBase.push(fine[sample[i]] - mid[sample[i]]);
  const poreThreshold = Math.max(1.4, stdev(poreBase) * 1.2);
  let poreCount = 0;
  for (const i of sample) {
    if (mid[i] - fine[i] > poreThreshold) poreCount++;
  }
  const poreDensity = sample.length ? (poreCount / sample.length) * 100 : null;
  const poreRefinement = scoreFrom(poreDensity, 2.5, 20);

  // --- 5. Dark spots / uneven pigmentation ---------------------------------
  // Robust cut-off: spots must not be able to raise the threshold that is
  // meant to catch them, so this uses a median/MAD baseline, not the stdev.
  const spotDev = [];
  for (let i = 0; i < sample.length; i += stride) spotDev.push(coarse[sample[i]] - mid[sample[i]]);
  const medSpot = median(spotDev);
  const spotThreshold = Math.max(2.2, medSpot + mad(spotDev, medSpot) * 1.4826 * 2.2);
  let spotPixels = 0, spotDepth = 0;
  for (const i of sample) {
    const d = coarse[i] - mid[i];
    if (d > spotThreshold) { spotPixels++; spotDepth += d; }
  }
  const spotFraction = sample.length ? (spotPixels / sample.length) * 100 : null;
  const spotMean = spotPixels ? spotDepth / spotPixels : 0;
  const clarityRaw = spotFraction === null ? null : spotFraction * clamp(spotMean / 3.5, 0.7, 2.0);
  const clarity = scoreFrom(clarityRaw, 1.5, 22);

  // --- 6. Shine / oil vs dryness -------------------------------------------
  const p95 = percentile(Ls, 95);
  const p50 = percentile(Ls, 50);
  let shinePixels = 0;
  const shineCut = Math.max(p50 + 12, p95 - 3);
  for (const i of sample) {
    const chroma = Math.hypot(A[i] - medA, B[i] - medB);
    if (L[i] >= shineCut && chroma < 9) shinePixels++;
  }
  const shineFraction = sample.length ? (shinePixels / sample.length) * 100 : 0;
  const highlightSpread = p95 - p50;

  // Dryness reads as fine flaky micro-texture with very little surface sheen.
  const drynessRaw = (textureRaw ?? 0) * 0.6 - shineFraction * 1.4;
  const oilinessRaw = shineFraction * 1.5 + Math.max(0, highlightSpread - 12) * 0.8;

  // Balance: 50 = comfortable middle, <50 leans dry, >50 leans oily.
  const balance = Math.round(clamp(50 + (oilinessRaw - drynessRaw) * 1.6, 0, 100));
  const balanceScore = Math.round(100 - Math.abs(balance - 50) * 1.55);

  // --- 7. Apparent hydration ------------------------------------------------
  // Plump, well-hydrated skin: soft micro-texture, even light diffusion,
  // gentle (not harsh) highlight roll-off.
  const diffusion = clamp01(1 - Math.abs(highlightSpread - 16) / 24);
  const hydrationRaw =
    0.5 * (smoothness ?? 50) +
    0.25 * (evenness ?? 50) +
    0.25 * diffusion * 100 -
    Math.max(0, drynessRaw - 8) * 1.6;
  const hydration = Math.round(clamp(hydrationRaw, 0, 100));

  const metrics = {
    evenness: { score: evenness, raw: round(evennessRaw), label: 'Tone evenness' },
    calm: { score: calm, raw: round(redRaw), label: 'Calm & comfort' },
    smoothness: { score: smoothness, raw: round(textureRaw), label: 'Texture & smoothness' },
    hydration: { score: hydration, raw: round(hydrationRaw), label: 'Apparent hydration' },
    poreRefinement: { score: poreRefinement, raw: round(poreDensity), label: 'Pore refinement' },
    clarity: { score: clarity, raw: round(spotFraction), label: 'Even pigmentation' },
    balance: { score: balanceScore, raw: balance, label: 'Oil & moisture balance' },
  };

  const weights = {
    evenness: 1.1, calm: 1.2, smoothness: 1.15, hydration: 1.2,
    poreRefinement: 0.8, clarity: 1.0, balance: 0.85,
  };
  let sum = 0, wsum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const s = metrics[key].score;
    if (s === null) continue;
    sum += s * weight;
    wsum += weight;
  }
  const overall = wsum ? Math.round(sum / wsum) : null;

  return {
    overall,
    metrics,
    balance,                       // 0 dry … 100 oily
    quality,
    region,
    stats: {
      brightness: round(meanL),
      skinCoverage: round(skinFraction * 100),
      sharpness: round(lapFull.sharpness),
      shine: round(shineFraction),
      samples: sample.length,
      toneSpread: round(toneSpread),
    },
    analyzedAt: Date.now(),
    engine: 'lumen-skin-1',
  };
}

function round(v) {
  return v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;
}

/** Laplacian energy → focus measure (higher is sharper). */
function laplacianEnergy(L, w, h, mask) {
  let acc = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const lap = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w];
      acc += lap * lap;
      n++;
    }
  }
  return { sharpness: n ? Math.sqrt(acc / n) : 0, samples: n };
}

function assessQuality({ meanL, sharpness, skinFraction, samples }) {
  const issues = [];
  if (samples < 500) issues.push({ id: 'tiny', text: 'Move a little closer so your skin fills the guide.' });
  if (meanL < 32) issues.push({ id: 'dark', text: 'It is quite dark — try facing a window or a soft lamp.' });
  if (meanL > 88) issues.push({ id: 'bright', text: 'The light is very strong — step out of direct glare.' });
  if (sharpness < 1.1) issues.push({ id: 'blur', text: 'The shot looks soft — hold steady and let it focus.' });
  if (skinFraction < 0.25) issues.push({ id: 'framing', text: 'Line your face up inside the oval for the best read.' });

  const score = Math.round(clamp01(
    (clamp01((meanL - 22) / 20) * 0.35) +
    (clamp01((sharpness - 0.8) / 2.2) * 0.4) +
    (clamp01(skinFraction / 0.5) * 0.25),
  ) * 100);

  return {
    score,
    good: issues.length === 0,
    level: score >= 70 ? 'good' : score >= 45 ? 'warn' : 'bad',
    issues,
  };
}

/** Produces a compact JPEG thumbnail for the scan history. */
export function makeThumbnail(source, size = 420, quality = 0.78) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const side = Math.min(sw, sh);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', quality);
}
