/**
 * Camera plumbing: permissions, stream lifecycle, wake lock and stills.
 * Written around the quirks of iOS Safari and Android Chrome.
 */

export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function secureContextOk() {
  return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

/** Turns a getUserMedia rejection into something a human can act on. */
export function describeCameraError(err) {
  const name = err?.name || '';
  if (!secureContextOk()) {
    return {
      title: 'Secure connection needed',
      body: 'Browsers only allow camera access over HTTPS. Open this app on an https:// address (or localhost) and try again.',
    };
  }
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        title: 'Camera access is blocked',
        body: isIOS
          ? 'Tap "AA" or the ⓘ in the address bar → Website Settings → Camera → Allow, then reload. In the installed app, check Settings → Krysaril → Camera.'
          : 'Tap the lock icon in the address bar → Permissions → Camera → Allow, then reload this page.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        title: 'No camera available',
        body: 'We could not find a camera matching that setting. Try switching between the front and back camera.',
      };
    case 'NotReadableError':
    case 'AbortError':
      return {
        title: 'Camera is busy',
        body: 'Another app or tab is using the camera. Close it and try again.',
      };
    default:
      return {
        title: 'Camera could not start',
        body: err?.message ? String(err.message) : 'Something interrupted the camera. Please try again.',
      };
  }
}

/** Best-effort read of the permission state without prompting. */
export async function cameraPermissionState() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'camera' });
    return status.state;      // 'granted' | 'denied' | 'prompt'
  } catch {
    return 'unknown';
  }
}

export class CameraController {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.facing = 'environment';
    this.wakeLock = null;
    this.track = null;
  }

  get active() { return !!this.stream; }

  get dimensions() {
    return {
      width: this.video?.videoWidth || 0,
      height: this.video?.videoHeight || 0,
    };
  }

  /**
   * Starts (or restarts) the stream. Falls back gracefully when the exact
   * resolution or facing mode is not available.
   */
  async start({ facing = this.facing, quality = 'balanced' } = {}) {
    if (!cameraSupported()) {
      const err = new Error('This browser does not support camera access.');
      err.name = 'NotFoundError';
      throw err;
    }
    this.stop({ keepWakeLock: true });
    this.facing = facing;

    const sizes = quality === 'high'
      ? [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, {}]
      : [{ width: 1280, height: 720 }, { width: 960, height: 540 }, {}];

    let lastErr = null;
    for (const size of sizes) {
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: size.width ? { ideal: size.width } : undefined,
          height: size.height ? { ideal: size.height } : undefined,
          frameRate: { ideal: 30, max: 60 },
        },
      };
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err) {
        lastErr = err;
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw err;
      }
    }
    if (!this.stream) throw lastErr || new Error('Camera unavailable');

    this.track = this.stream.getVideoTracks()[0] || null;

    const v = this.video;
    v.srcObject = this.stream;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.muted = true;
    v.autoplay = true;

    await new Promise((resolve, reject) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      const fail = (e) => { if (!settled) { settled = true; reject(e); } };
      if (v.readyState >= 2 && v.videoWidth) { done(); return; }
      v.onloadedmetadata = done;
      v.onerror = () => fail(new Error('Video element failed to load the camera stream.'));
      setTimeout(done, 4000);   // some Android builds never fire the event
    });

    try { await v.play(); } catch (e) { console.warn('Autoplay blocked; will retry on tap', e); }
    return this.stream;
  }

  async switchFacing() {
    const next = this.facing === 'environment' ? 'user' : 'environment';
    await this.start({ facing: next });
    return next;
  }

  /** Captures the current frame at native resolution. */
  captureFrame({ maxSize = 1440 } = {}) {
    const v = this.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.min(1, maxSize / Math.max(vw, vh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener?.('release', () => { this.wakeLock = null; });
      }
    } catch { /* not fatal */ }
  }

  releaseWakeLock() {
    try { this.wakeLock?.release?.(); } catch { /* ignore */ }
    this.wakeLock = null;
  }

  stop({ keepWakeLock = false } = {}) {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
      this.stream = null;
      this.track = null;
    }
    if (this.video) {
      try { this.video.pause(); } catch { /* ignore */ }
      this.video.srcObject = null;
    }
    if (!keepWakeLock) this.releaseWakeLock();
  }
}

/**
 * Drives a per-frame callback using requestVideoFrameCallback when available
 * (accurate, skips duplicate frames) and rAF otherwise.
 */
export class FrameLoop {
  constructor(video, onFrame) {
    this.video = video;
    this.onFrame = onFrame;
    this.running = false;
    this.handle = null;
    this.useRVFC = typeof video.requestVideoFrameCallback === 'function';
    this.lastRun = 0;
    this.minInterval = 0;   // adaptive throttle in ms
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick = this.tick.bind(this);
    this.schedule();
  }

  schedule() {
    if (!this.running) return;
    this.handle = this.useRVFC
      ? this.video.requestVideoFrameCallback(this.tick)
      : requestAnimationFrame(this.tick);
  }

  tick(now, meta) {
    if (!this.running) return;
    const t = typeof now === 'number' ? now : performance.now();
    if (t - this.lastRun >= this.minInterval) {
      this.lastRun = t;
      try {
        this.onFrame(meta?.mediaTime !== undefined ? meta.mediaTime * 1000 : t);
      } catch (err) {
        console.error('Frame callback failed', err);
      }
    }
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.handle !== null) {
      if (this.useRVFC) this.video.cancelVideoFrameCallback?.(this.handle);
      else cancelAnimationFrame(this.handle);
      this.handle = null;
    }
  }
}
