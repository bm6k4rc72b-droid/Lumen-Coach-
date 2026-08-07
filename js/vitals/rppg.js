/**
 * Camera photoplethysmography — heart rate and HRV from skin colour.
 *
 * Each heartbeat pushes a pulse of blood through the capillary bed, which
 * changes how much green light the skin absorbs. The change is far too small
 * to see, but it is comfortably above the noise floor of a phone camera when
 * averaged over thousands of pixels.
 *
 * Pipeline: ROI mean → detrend → bandpass 0.7–4 Hz (42–240 bpm) → Welch-style
 * FFT for rate → peak detection on the filtered wave for beat intervals →
 * RMSSD for HRV. An SNR gate refuses to report a number it cannot stand behind.
 *
 * ACCURACY: fingertip contact is the reliable mode. Face mode works but is
 * sensitive to movement and lighting flicker. Neither is a medical device;
 * this measures resting trend, not cardiac rhythm.
 */

const MIN_HZ = 0.7;    // 42 bpm
const MAX_HZ = 4.0;    // 240 bpm

/**
 * Two independent gates on "is there actually a pulse in here".
 *
 * MIN_SNR is the share of in-band energy sitting at the winning frequency.
 * On its own it is not enough: over a 20 s record the band holds only ~66
 * independent bins, so the largest of them collects a big share by chance —
 * measured over 200 noise-only records the share reached 0.40, well past any
 * threshold that would still admit a weak real pulse.
 *
 * MIN_PROMINENCE — peak power over the median bin — is what actually
 * separates them. The same 200 noise-only records topped out at 23, while a
 * poor but genuine pulse starts around 26 and a good one runs into the
 * hundreds. Both gates must pass.
 */
const MIN_SNR = 0.25;
const MIN_PROMINENCE = 25;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* --------------------------------------------------------- signal buffer */

export class PulseBuffer {
  /**
   * @param {number} seconds how much history to keep
   */
  constructor(seconds = 30) {
    this.seconds = seconds;
    this.t = [];
    this.g = [];
    this.r = [];
  }

  reset() { this.t = []; this.g = []; this.r = []; }

  /** @param {number} timeMs @param {{r:number,g:number,b:number}} mean */
  push(timeMs, mean) {
    this.t.push(timeMs);
    this.g.push(mean.g);
    this.r.push(mean.r);
    const cutoff = timeMs - this.seconds * 1000;
    while (this.t.length && this.t[0] < cutoff) {
      this.t.shift(); this.g.shift(); this.r.shift();
    }
  }

  get duration() {
    return this.t.length > 1 ? (this.t[this.t.length - 1] - this.t[0]) / 1000 : 0;
  }

  /** Effective sample rate in Hz. */
  get fps() {
    return this.duration > 0 ? (this.t.length - 1) / this.duration : 0;
  }
}

/* -------------------------------------------------------- signal helpers */

/** Resamples an irregular series onto a fixed grid — cameras drop frames. */
export function resample(times, values, hz) {
  if (times.length < 4) return null;
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const n = Math.floor(((t1 - t0) / 1000) * hz);
  if (n < 8) return null;
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + (i / hz) * 1000;
    while (j < times.length - 2 && times[j + 1] < t) j++;
    const span = times[j + 1] - times[j];
    const k = span > 0 ? (t - times[j]) / span : 0;
    out[i] = values[j] + (values[j + 1] - values[j]) * k;
  }
  return out;
}

/** Removes slow drift with a moving-average subtraction. */
export function detrend(x, window) {
  const n = x.length;
  const w = Math.max(3, Math.min(window | 0, n - 1));
  const out = new Float64Array(n);
  let sum = 0;
  const half = w >> 1;
  for (let i = 0; i < n; i++) {
    sum += x[i];
    if (i >= w) sum -= x[i - w];
    const mean = sum / Math.min(i + 1, w);
    const centre = Math.max(0, Math.min(n - 1, i - half));
    out[centre] = x[centre] - mean;
  }
  return out;
}

/** Single-pole bandpass, applied forward then backward for zero phase lag. */
export function bandpass(x, hz, lo = MIN_HZ, hi = MAX_HZ) {
  const highPassed = onePole(x, hz, lo, 'high');
  const forward = onePole(highPassed, hz, hi, 'low');
  const reversed = Float64Array.from(forward).reverse();
  const back = onePole(onePole(reversed, hz, lo, 'high'), hz, hi, 'low');
  return Float64Array.from(back).reverse();
}

function onePole(x, hz, cutoff, mode) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / hz;
  const out = new Float64Array(x.length);
  if (mode === 'low') {
    const a = dt / (rc + dt);
    out[0] = x[0];
    for (let i = 1; i < x.length; i++) out[i] = out[i - 1] + a * (x[i] - out[i - 1]);
  } else {
    const a = rc / (rc + dt);
    out[0] = 0;
    for (let i = 1; i < x.length; i++) out[i] = a * (out[i - 1] + x[i] - x[i - 1]);
  }
  return out;
}

/**
 * Power at each frequency in the plausible pulse band.
 * A direct DFT over ~200 bins is cheap enough here and avoids an FFT
 * dependency plus the zero-padding that would come with it.
 */
export function spectrum(x, hz, lo = MIN_HZ, hi = MAX_HZ, bins = 240) {
  const n = x.length;
  if (n < 16) return null;
  const out = [];
  for (let b = 0; b < bins; b++) {
    const f = lo + ((hi - lo) * b) / (bins - 1);
    const w = (2 * Math.PI * f) / hz;
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      // Hann window suppresses spectral leakage from the finite record.
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const v = x[i] * win;
      re += v * Math.cos(w * i);
      im -= v * Math.sin(w * i);
    }
    out.push({ f, power: (re * re + im * im) / n });
  }
  return out;
}

/** Beat positions by local maxima above a fraction of the wave amplitude. */
export function findPeaks(x, hz, minBpm = 40) {
  const minGap = Math.max(2, Math.floor((60 / minBpm) * hz * 0.55));
  let max = -Infinity, min = Infinity;
  for (const v of x) { if (v > max) max = v; if (v < min) min = v; }
  const threshold = min + (max - min) * 0.55;

  const peaks = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] < threshold) continue;
    if (x[i] <= x[i - 1] || x[i] < x[i + 1]) continue;
    if (peaks.length && i - peaks[peaks.length - 1] < minGap) {
      // Keep the taller of two peaks that are too close together.
      if (x[i] > x[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  return peaks;
}

/* ------------------------------------------------------------- analysis */

/**
 * @param {PulseBuffer} buffer
 * @returns {object|null} { bpm, rmssd, sdnn, confidence, quality, beats }
 */
export function analysePulse(buffer) {
  const fps = buffer.fps;
  if (buffer.duration < 8 || fps < 8) {
    return { ready: false, reason: 'collecting', duration: buffer.duration, fps };
  }

  const hz = Math.min(30, Math.max(10, Math.round(fps)));
  const raw = resample(buffer.t, buffer.g, hz);
  if (!raw) return { ready: false, reason: 'collecting', duration: buffer.duration, fps };

  const detrended = detrend(raw, Math.round(hz * 1.5));
  const wave = bandpass(detrended, hz);

  const spec = spectrum(wave, hz);
  if (!spec) return { ready: false, reason: 'collecting', duration: buffer.duration, fps };

  let peak = spec[0];
  let total = 0;
  for (const s of spec) {
    total += s.power;
    if (s.power > peak.power) peak = s;
  }

  // Signal-to-noise: how much of the band's energy sits at the pulse peak
  // and its immediate neighbours, versus everywhere else.
  const nearPeak = spec
    .filter((s) => Math.abs(s.f - peak.f) < 0.12)
    .reduce((a, s) => a + s.power, 0);
  const snr = total > 0 ? nearPeak / total : 0;

  // How far the peak stands above the typical bin. A tone towers over the
  // median; a noise spectrum is lumpy but flat-ish, so its tallest bin does not.
  const sorted = spec.map((s) => s.power).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] || 1e-12;
  const prominence = peak.power / median;

  const bpm = peak.f * 60;

  // Beat-to-beat intervals for HRV.
  const peaks = findPeaks(wave, hz);
  const intervals = [];
  for (let i = 1; i < peaks.length; i++) {
    const ms = ((peaks[i] - peaks[i - 1]) / hz) * 1000;
    if (ms > 300 && ms < 1800) intervals.push(ms);
  }

  const rmssd = intervals.length >= 4 ? computeRmssd(intervals) : null;
  const sdnn = intervals.length >= 4 ? computeSdnn(intervals) : null;

  // Confidence blends spectral purity, record length and beat consistency —
  // but purity *scales* the other two rather than being averaged with them.
  // Length and beat count are both satisfied by pure noise (a long recording
  // of nothing is still long, and noise has plenty of local maxima), so as an
  // additive term they floored confidence above the reporting gate and the
  // screen showed a confident, wrong number. Nothing may vouch for a reading
  // that has no peak in the spectrum.
  const purity = clamp01(snr * 2.0) * clamp01(prominence / 80);
  const lengthScore = Math.min(1, buffer.duration / 25);
  const beatScore = intervals.length >= 6 ? 1 : intervals.length / 6;
  const confidence = Math.round(purity * (55 + lengthScore * 30 + beatScore * 15));

  const quality = confidence >= 70 ? 'good' : confidence >= 45 ? 'fair' : 'poor';

  return {
    // The two spectral gates are also applied explicitly, so no future
    // reweighting of the confidence blend can publish a rate from a spectrum
    // with nothing standing up in it.
    ready: confidence >= 45 && snr >= MIN_SNR && prominence >= MIN_PROMINENCE
      && bpm >= 40 && bpm <= 200,
    bpm: Math.round(bpm),
    rmssd: rmssd === null ? null : Math.round(rmssd),
    sdnn: sdnn === null ? null : Math.round(sdnn),
    beats: intervals.length,
    intervals,
    snr: Math.round(snr * 1000) / 1000,
    prominence: Math.round(prominence * 10) / 10,
    confidence: Math.min(100, confidence),
    quality,
    duration: Math.round(buffer.duration),
    fps: Math.round(fps),
    wave: Array.from(wave.slice(-Math.round(hz * 6))),   // last 6 s for the trace
    hz,
  };
}

function computeRmssd(intervals) {
  let acc = 0;
  for (let i = 1; i < intervals.length; i++) acc += (intervals[i] - intervals[i - 1]) ** 2;
  return Math.sqrt(acc / (intervals.length - 1));
}

function computeSdnn(intervals) {
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const varSum = intervals.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(varSum / intervals.length);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------------------------------------- readiness */

/**
 * Readiness relative to the person's own baseline. Absolute HRV numbers
 * differ enormously between people, so only the deviation is meaningful.
 *
 * @param {object} today  { bpm, rmssd }
 * @param {Array}  history previous vitals records, newest first
 */
export function readinessScore(today, history = []) {
  const past = history.filter((h) => isNum(h.rmssd) && isNum(h.bpm)).slice(0, 14);
  if (!isNum(today.bpm)) return null;

  if (past.length < 3) {
    return {
      score: null,
      baseline: false,
      text: `Baseline building — ${3 - past.length} more morning reading${past.length === 2 ? '' : 's'} and Krysaril can score readiness against your own norm.`,
    };
  }

  const meanRmssd = avg(past.map((h) => h.rmssd));
  const meanBpm = avg(past.map((h) => h.bpm));
  const sdRmssd = Math.max(3, stdev(past.map((h) => h.rmssd)));
  const sdBpm = Math.max(2, stdev(past.map((h) => h.bpm)));

  // Higher HRV and lower resting heart rate both indicate better readiness.
  const hrvZ = isNum(today.rmssd) ? (today.rmssd - meanRmssd) / sdRmssd : 0;
  const bpmZ = (meanBpm - today.bpm) / sdBpm;
  const z = isNum(today.rmssd) ? hrvZ * 0.65 + bpmZ * 0.35 : bpmZ;

  const score = Math.round(clamp(50 + z * 18, 1, 100));
  return {
    score,
    baseline: true,
    meanRmssd: Math.round(meanRmssd),
    meanBpm: Math.round(meanBpm),
    text: readinessText(score),
  };
}

function readinessText(score) {
  if (score >= 75) return 'Well recovered — a good day to push.';
  if (score >= 60) return 'Recovered. Train as planned.';
  if (score >= 45) return 'Middling. Keep the session but hold something back.';
  if (score >= 30) return 'Below your norm. Reduce intensity or make it a technique day.';
  return 'Well below your norm. Prioritise sleep and food; train easy or rest.';
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function stdev(a) {
  if (a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------ ROI */

/**
 * Mean RGB inside a rectangle of the video frame.
 * Sampling every `step` pixels keeps this well under a millisecond.
 */
export function roiMean(ctx, x, y, w, h, step = 3) {
  const data = ctx.getImageData(x, y, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  const stride = 4 * step;
  for (let i = 0; i < data.length; i += stride) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
    n++;
  }
  return n ? { r: r / n, g: g / n, b: b / n, samples: n } : null;
}

/** Fingertip covering the lens: very red, dark, low variance. */
export function looksLikeFinger(mean) {
  if (!mean) return false;
  const { r, g, b } = mean;
  return r > 60 && r > g * 1.6 && r > b * 1.6 && g < 120;
}

export const VITALS_DISCLAIMER =
  'Krysaril Recovery estimates heart rate and heart-rate variability from colour changes in the skin. It is a wellness trend tool, not a medical device: it cannot detect an irregular rhythm, and it should never be used to make a decision about symptoms. Chest pain, palpitations, breathlessness or fainting need urgent medical attention regardless of what any app shows.';
