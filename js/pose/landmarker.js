/**
 * Loads MediaPipe Pose Landmarker and runs it against a <video> element.
 *
 * Assets are resolved in this order:
 *   1. ./vendor/…  (populated by `npm run vendor` — fully offline capable)
 *   2. jsDelivr + Google model CDN (cached by the service worker after first use)
 */

const TASKS_VERSION = '1.0.1';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';

const MODELS = {
  lite: { file: 'pose_landmarker_lite.task', dir: 'pose_landmarker_lite', label: 'Lite — fastest' },
  full: { file: 'pose_landmarker_full.task', dir: 'pose_landmarker_full', label: 'Full — more accurate' },
};

let assetsPromise = null;

/**
 * Resolves an app-relative path against the document, not against this module.
 * `import()` would otherwise resolve relative specifiers against js/pose/.
 */
const appUrl = (path) => new URL(path, document.baseURI).href;

/** Detects whether a self-hosted copy of the assets exists. */
async function resolveAssets() {
  if (assetsPromise) return assetsPromise;
  assetsPromise = (async () => {
    try {
      const res = await fetch(appUrl('vendor/vendor.json'), { cache: 'no-store' });
      if (res.ok) {
        const info = await res.json();
        if (info?.tasksVision) {
          const models = new Set(info.models || ['lite']);
          return {
            local: true,
            bundle: appUrl('vendor/tasks-vision/vision_bundle.mjs'),
            wasmDir: appUrl('vendor/tasks-vision/wasm'),
            has: (q) => models.has(q),
            modelUrl: (q) => appUrl(`vendor/models/${MODELS[q].file}`),
          };
        }
      }
    } catch { /* no local vendor — fall through to CDN */ }
    return {
      local: false,
      bundle: `${CDN_BASE}/vision_bundle.mjs`,
      wasmDir: `${CDN_BASE}/wasm`,
      has: () => true,
      modelUrl: (q) => `${MODEL_CDN}/${MODELS[q].dir}/float16/1/${MODELS[q].file}`,
    };
  })();
  return assetsPromise;
}

export class PoseEngine {
  constructor() {
    this.landmarker = null;
    this.quality = null;
    this.delegate = null;
    this.lastTimestamp = -1;
    this.busy = false;
    this.frameTimes = [];
    this.assets = null;
    this.segmentation = false;
  }

  get ready() { return !!this.landmarker; }

  /**
   * @param {'lite'|'full'} quality
   * @param {(stage:string)=>void} onProgress
   */
  async load(quality = 'lite', onProgress = () => {}) {
    if (this.landmarker && this.quality === quality) return this;

    const assets = this.assets || (this.assets = await resolveAssets());
    onProgress(assets.local ? 'Loading on-device model…' : 'Downloading pose model…');

    const vision = await import(/* @vite-ignore */ assets.bundle);
    const fileset = await vision.FilesetResolver.forVisionTasks(assets.wasmDir);

    // Fall back to lite when a self-hosted build only vendored that model.
    const wanted = MODELS[quality] && assets.has(quality) ? quality : 'lite';
    const modelAssetPath = assets.modelUrl(wanted);
    const base = {
      baseOptions: { modelAssetPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    };

    if (this.landmarker) { try { this.landmarker.close(); } catch { /* ignore */ } this.landmarker = null; }

    try {
      onProgress('Starting GPU acceleration…');
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, base);
      this.delegate = 'GPU';
    } catch (gpuErr) {
      console.warn('GPU delegate unavailable, falling back to CPU', gpuErr);
      onProgress('Starting CPU mode…');
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        ...base,
        baseOptions: { modelAssetPath, delegate: 'CPU' },
      });
      this.delegate = 'CPU';
    }

    this.quality = wanted;
    this.segmentation = false;
    this.lastTimestamp = -1;
    return this;
  }

  /**
   * Runs detection for one video frame.
   * Returns landmarks (normalised) or null when nobody is detected.
   */
  detect(video, timestampMs) {
    if (!this.landmarker || this.busy) return undefined;
    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    let ts = Math.max(Math.round(timestampMs), this.lastTimestamp + 1);
    this.lastTimestamp = ts;

    this.busy = true;
    const t0 = performance.now();
    let result = null;
    try {
      result = this.landmarker.detectForVideo(video, ts);
    } catch (err) {
      console.warn('Pose detection failed', err);
      return undefined;
    } finally {
      this.busy = false;
      const dt = performance.now() - t0;
      this.frameTimes.push(dt);
      if (this.frameTimes.length > 30) this.frameTimes.shift();
    }
    const landmarks = result?.landmarks?.[0];
    return landmarks && landmarks.length ? landmarks : null;
  }

  /**
   * Toggles the person segmentation mask on or off.
   * Only the body scan needs it; leaving it off keeps the live loop cheap.
   */
  async setSegmentation(enabled) {
    if (!this.landmarker || this.segmentation === enabled) return;
    await this.landmarker.setOptions({ outputSegmentationMasks: !!enabled });
    this.segmentation = !!enabled;
  }

  /**
   * One-shot detection that also copies out the segmentation mask.
   * The mask's backing memory is only valid until the next call, so the
   * pixel data is copied before returning.
   */
  detectWithMask(video, timestampMs) {
    if (!this.landmarker) return null;
    const ts = Math.max(Math.round(timestampMs), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    let result;
    try {
      result = this.landmarker.detectForVideo(video, ts);
    } catch (err) {
      console.warn('Segmented detection failed', err);
      return null;
    }
    const landmarks = result?.landmarks?.[0] || null;
    const mpMask = result?.segmentationMasks?.[0] || null;
    if (!mpMask) return { landmarks, mask: null, maskW: 0, maskH: 0 };

    const maskW = mpMask.width;
    const maskH = mpMask.height;
    let mask = null;
    try {
      mask = Float32Array.from(mpMask.getAsFloat32Array());
    } catch {
      try {
        const bytes = mpMask.getAsUint8Array();
        mask = Float32Array.from(bytes, (v) => v / 255);
      } catch { mask = null; }
    }
    try { mpMask.close?.(); } catch { /* already released */ }
    return { landmarks, mask, maskW, maskH };
  }

  /** Average inference cost in ms — used to adapt the frame budget. */
  get inferenceMs() {
    if (!this.frameTimes.length) return 0;
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  close() {
    if (this.landmarker) {
      try { this.landmarker.close(); } catch { /* ignore */ }
      this.landmarker = null;
    }
    this.quality = null;
  }
}

export const poseEngine = new PoseEngine();
export { MODELS };
