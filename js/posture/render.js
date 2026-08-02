/**
 * Renders the annotated posture image: the captured frame, a plumb line,
 * alignment segments and boxed angle callouts — the chart a therapist would
 * mark up by hand.
 */

import { KP, toPixels } from '../pose/angles.js';

const COLOR = {
  good: '#7cc9a4',
  warn: '#e0b667',
  bad: '#d97a72',
  plumb: 'rgba(211, 176, 114, .78)',
  bone: 'rgba(242, 237, 228, .92)',
  shadow: 'rgba(0, 0, 0, .62)',
};

/**
 * @param {HTMLCanvasElement|HTMLImageElement} source captured frame
 * @param {Array} landmarks normalised landmarks for that frame
 * @param {object} analysis result of analyzePosture
 * @param {{maxWidth?: number}} opts
 * @returns {HTMLCanvasElement}
 */
export function renderPostureChart(source, landmarks, analysis, { maxWidth = 900 } = {}) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  const scale = Math.min(1, maxWidth / sw);
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(source, 0, 0, w, h);

  // Darken slightly so champagne annotation reads over any background.
  ctx.fillStyle = 'rgba(8, 9, 11, .30)';
  ctx.fillRect(0, 0, w, h);

  const px = toPixels(landmarks, w, h);
  const u = w / 390;                     // scale annotation to the frame width
  const P = (i) => (px[i] && px[i].v >= 0.4 ? px[i] : null);

  /* ------------------------------------------------------------ plumb line */
  const ankle = midOf(P(KP.leftAnkle), P(KP.rightAnkle));
  if (ankle) {
    ctx.save();
    ctx.setLineDash([6 * u, 7 * u]);
    ctx.strokeStyle = COLOR.plumb;
    ctx.lineWidth = 1.4 * u;
    ctx.beginPath();
    ctx.moveTo(ankle.x, h * 0.02);
    ctx.lineTo(ankle.x, ankle.y);
    ctx.stroke();
    ctx.restore();
  }

  /* --------------------------------------------------------------- segments */
  const segments = analysis.view === 'side'
    ? sideSegments(analysis, P)
    : frontSegments(P);

  for (const seg of segments) {
    if (!seg.a || !seg.b) continue;
    ctx.strokeStyle = COLOR.shadow;
    ctx.lineWidth = 5.5 * u;
    ctx.lineCap = 'round';
    line(ctx, seg.a, seg.b);
    ctx.strokeStyle = seg.color || COLOR.bone;
    ctx.lineWidth = 2.6 * u;
    line(ctx, seg.a, seg.b);

    // Joint pucks at each end, like the reference chart.
    for (const p of [seg.a, seg.b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.2 * u, 0, Math.PI * 2);
      ctx.fillStyle = '#0b0c0f';
      ctx.fill();
      ctx.lineWidth = 2 * u;
      ctx.strokeStyle = seg.color || COLOR.bone;
      ctx.stroke();
    }
  }

  /* --------------------------------------------------------------- callouts */
  const anchors = calloutAnchors(analysis, P, w, h);
  const placed = [];
  for (const { id, at, side } of anchors) {
    const m = analysis.measures[id];
    if (!m || !at) continue;
    const text = `${Math.round(m.value)}${m.unit === '%' ? '%' : '°'}`;
    const box = callout(ctx, at, text, m.level, side, u, placed, w, h);
    if (box) placed.push(box);
  }

  return canvas;
}

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function midOf(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function levelColor(level) {
  return COLOR[level] || COLOR.bone;
}

function sideSegments(analysis, P) {
  const side = analysis.points?.side === 'left' ? 'left' : 'right';
  const S = P(side === 'left' ? KP.leftShoulder : KP.rightShoulder);
  const E = P(side === 'left' ? KP.leftEar : KP.rightEar);
  const H = P(side === 'left' ? KP.leftHip : KP.rightHip);
  const K = P(side === 'left' ? KP.leftKnee : KP.rightKnee);
  const A = P(side === 'left' ? KP.leftAnkle : KP.rightAnkle);
  const m = analysis.measures;
  return [
    { a: E, b: S, color: levelColor(m.forwardHead?.level) },
    { a: S, b: H, color: levelColor(m.trunkLean?.level) },
    { a: H, b: K, color: levelColor(m.pelvicTilt?.level) },
    { a: K, b: A, color: levelColor(m.kneePosition?.level) },
  ];
}

function frontSegments(P) {
  return [
    { a: P(KP.leftShoulder), b: P(KP.rightShoulder) },
    { a: P(KP.leftHip), b: P(KP.rightHip) },
    { a: P(KP.leftEye), b: P(KP.rightEye) },
    { a: P(KP.leftHip), b: P(KP.leftKnee) },
    { a: P(KP.leftKnee), b: P(KP.leftAnkle) },
    { a: P(KP.rightHip), b: P(KP.rightKnee) },
    { a: P(KP.rightKnee), b: P(KP.rightAnkle) },
  ];
}

function calloutAnchors(analysis, P, w) {
  const side = analysis.points?.side === 'left' ? 'left' : 'right';
  const pick = (l, r) => P(side === 'left' ? l : r);
  const facingRight = (P(KP.nose)?.x ?? w / 2) > (P(KP.leftShoulder)?.x ?? w / 2);
  const out = facingRight ? 'left' : 'right';

  if (analysis.view === 'side') {
    return [
      { id: 'forwardHead', at: pick(KP.leftEar, KP.rightEar), side: out },
      { id: 'shoulderProtraction', at: pick(KP.leftShoulder, KP.rightShoulder), side: out === 'left' ? 'right' : 'left' },
      { id: 'trunkLean', at: pick(KP.leftShoulder, KP.rightShoulder), side: out },
      { id: 'pelvicTilt', at: pick(KP.leftHip, KP.rightHip), side: out },
      { id: 'kneePosition', at: pick(KP.leftKnee, KP.rightKnee), side: out === 'left' ? 'right' : 'left' },
      { id: 'anklePosition', at: pick(KP.leftAnkle, KP.rightAnkle), side: out },
    ];
  }
  return [
    { id: 'headTilt', at: P(KP.nose), side: 'right' },
    { id: 'shoulderLevel', at: P(KP.leftShoulder), side: 'left' },
    { id: 'pelvisLevel', at: P(KP.leftHip), side: 'left' },
    { id: 'kneeTracking', at: P(KP.rightKnee), side: 'right' },
  ];
}

/** Draws a boxed value with a leader line, avoiding already-placed boxes. */
function callout(ctx, at, text, level, side, u, placed, w, h) {
  ctx.font = `700 ${15 * u}px ui-rounded, -apple-system, system-ui, sans-serif`;
  const padX = 9 * u;
  const bw = ctx.measureText(text).width + padX * 2;
  const bh = 27 * u;
  const gap = 40 * u;

  let x = side === 'left' ? at.x - gap - bw : at.x + gap;
  let y = at.y - bh / 2;

  x = Math.max(6 * u, Math.min(x, w - bw - 6 * u));
  y = Math.max(6 * u, Math.min(y, h - bh - 6 * u));

  // Nudge downward until it clears anything already drawn.
  let guard = 0;
  while (guard++ < 14 && placed.some((b) => overlaps(b, { x, y, w: bw, h: bh }, 5 * u))) {
    y += bh + 6 * u;
    if (y > h - bh - 6 * u) { y = 6 * u; x += (side === 'left' ? -1 : 1) * 8 * u; }
  }

  const cx = side === 'left' ? x + bw : x;
  ctx.strokeStyle = 'rgba(242, 237, 228, .45)';
  ctx.lineWidth = 1.1 * u;
  ctx.setLineDash([3 * u, 3 * u]);
  line(ctx, { x: cx, y: y + bh / 2 }, at);
  ctx.setLineDash([]);

  roundRect(ctx, x, y, bw, bh, 7 * u);
  ctx.fillStyle = 'rgba(10, 11, 14, .86)';
  ctx.fill();
  ctx.strokeStyle = levelColor(level);
  ctx.lineWidth = 1.4 * u;
  ctx.stroke();

  ctx.fillStyle = levelColor(level);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + bw / 2, y + bh / 2 + 0.5 * u);

  return { x, y, w: bw, h: bh };
}

function overlaps(a, b, pad = 0) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x ||
           a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
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

/** Small square thumbnail of the annotated chart for history lists. */
export function chartThumbnail(canvas, size = 420, quality = 0.8) {
  const side = Math.min(canvas.width, canvas.height);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, 0, 0, size, size);
  return out.toDataURL('image/jpeg', quality);
}
