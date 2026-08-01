/**
 * Skeleton + angle overlay renderer.
 *
 * Draws in display space, matching the `object-fit: cover` mapping the browser
 * applies to the <video>, so the skeleton lands exactly on the person.
 */

import { SKELETON, JOINTS, KP } from './angles.js';

const COLORS = {
  good: '#62dfae',
  warn: '#f6c65b',
  bad: '#fb7a8e',
  idle: '#cfd6e0',
};

/** Joints whose angle we annotate, per exercise HUD key. */
const ANGLE_ANCHORS = {
  knee: [KP.leftKnee, KP.rightKnee],
  kneeFront: [KP.leftKnee, KP.rightKnee],
  hip: [KP.leftHip, KP.rightHip],
  elbow: [KP.leftElbow, KP.rightElbow],
  shoulder: [KP.leftShoulder, KP.rightShoulder],
  ankle: [KP.leftAnkle, KP.rightAnkle],
};

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 0;
    this.h = 0;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width * this.dpr);
    const h = Math.round(rect.height * this.dpr);
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.w = w;
    this.h = h;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Maps normalised landmarks onto the covered display area. */
  transform(videoW, videoH) {
    const cw = this.canvas.width, ch = this.canvas.height;
    const scale = Math.max(cw / videoW, ch / videoH);
    return {
      scale,
      dx: (cw - videoW * scale) / 2,
      dy: (ch - videoH * scale) / 2,
      videoW, videoH,
    };
  }

  /**
   * @param {Array} landmarks normalised landmarks (or null)
   * @param {object} opts { videoW, videoH, level, showAngles, angles, hud }
   */
  draw(landmarks, opts) {
    this.resize();
    this.clear();
    if (!landmarks) return;

    const { videoW, videoH, level = 'idle', showSkeleton = true, showAngles = true, angles = null, hud = [] } = opts;
    const t = this.transform(videoW, videoH);
    const ctx = this.ctx;
    const color = COLORS[level] || COLORS.idle;
    const s = this.dpr;

    const P = (i) => {
      const lm = landmarks[i];
      if (!lm || (lm.visibility ?? 1) < 0.4) return null;
      return { x: lm.x * videoW * t.scale + t.dx, y: lm.y * videoH * t.scale + t.dy };
    };

    if (showSkeleton) {
      // Soft outline underneath keeps the skeleton readable on bright gym floors.
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.lineWidth = 8 * s;
      this.strokeBones(ctx, P);

      ctx.strokeStyle = color;
      ctx.lineWidth = 4.5 * s;
      this.strokeBones(ctx, P);

      // Joints
      for (const i of JOINTS) {
        const p = P(i);
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.2 * s, 0, Math.PI * 2);
        ctx.fillStyle = '#0b0d10';
        ctx.fill();
        ctx.lineWidth = 2.6 * s;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    if (showAngles && angles) this.drawAngles(ctx, P, angles, hud, s);
  }

  strokeBones(ctx, P) {
    ctx.beginPath();
    for (const [a, b] of SKELETON) {
      const p1 = P(a), p2 = P(b);
      if (!p1 || !p2) continue;
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
  }

  drawAngles(ctx, P, angles, hud, s) {
    const seen = new Set();
    for (const key of hud) {
      const anchors = ANGLE_ANCHORS[key];
      if (!anchors) continue;
      const value = angles[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;

      for (const idx of anchors) {
        if (seen.has(idx)) continue;
        const p = P(idx);
        if (!p) continue;
        seen.add(idx);
        this.label(ctx, p.x + 14 * s, p.y - 12 * s, `${Math.round(value)}°`, s);
        break;   // one label per angle keeps the frame calm
      }
    }
  }

  label(ctx, x, y, text, s) {
    ctx.font = `700 ${13 * s}px ui-rounded, -apple-system, system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 12 * s;
    const h = 21 * s;
    const rx = Math.min(Math.max(x, 4 * s), this.canvas.width - w - 4 * s);
    const ry = Math.min(Math.max(y - h / 2, 4 * s), this.canvas.height - h - 4 * s);

    ctx.fillStyle = 'rgba(10,12,16,.78)';
    roundRect(ctx, rx, ry, w, h, 7 * s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 1 * s;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, rx + 6 * s, ry + h / 2 + 0.5 * s);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { COLORS };
