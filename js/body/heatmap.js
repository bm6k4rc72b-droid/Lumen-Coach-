/**
 * Renders the body silhouette and, when a previous scan exists, tints it by
 * how much each level has changed — cool where the outline shrank, warm where
 * it grew. The photo itself is never shown; only the outline.
 */

import { heatColor } from './silhouette.js';

/**
 * @param {Float32Array} mask person probability, row-major
 * @param {object} measurement result of measureSilhouette
 * @param {number[]|null} profileDelta per-1% change in cm, or null for a plain silhouette
 * @param {{width?: number, background?: string}} opts
 * @returns {HTMLCanvasElement}
 */
export function renderBodyMap(mask, measurement, profileDelta, { width = 520, background = '#0b0d10' } = {}) {
  const { maskW, maskH, topY, bottomY } = measurement;
  const aspect = maskH / maskW;
  const w = width;
  const h = Math.round(width * aspect);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);

  const img = ctx.createImageData(w, h);
  const data = img.data;
  const span = Math.max(1, bottomY - topY);

  for (let y = 0; y < h; y++) {
    const my = Math.min(maskH - 1, Math.round((y / h) * maskH));
    // Which 1% band of the body this row belongs to.
    const t = (my - topY) / span;
    const bandIndex = Math.round(t * 99);
    const delta = profileDelta && bandIndex >= 0 && bandIndex < profileDelta.length
      ? profileDelta[bandIndex] : null;
    const [cr, cg, cb] = parseRgb(
      profileDelta ? heatColor(delta) : 'rgb(198, 192, 181)',
    );

    for (let x = 0; x < w; x++) {
      const mx = Math.min(maskW - 1, Math.round((x / w) * maskW));
      const p = mask[my * maskW + mx];
      const i = (y * w + x) * 4;
      if (p > 0.5) {
        // Soft top-down sheen so the silhouette reads as a form, not a blob.
        const sheen = 0.82 + 0.18 * (1 - Math.abs(x / w - 0.5) * 2);
        data[i] = Math.min(255, cr * sheen);
        data[i + 1] = Math.min(255, cg * sheen);
        data[i + 2] = Math.min(255, cb * sheen);
        data[i + 3] = 235;
      } else {
        data[i + 3] = 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  // Trace the outline in champagne for a crisp edge.
  outline(ctx, mask, maskW, maskH, w, h);

  return canvas;
}

function parseRgb(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (!m) return [198, 192, 181];
  const parts = m[1].split(',').map((v) => parseFloat(v));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** Marks pixels that have a non-person neighbour. */
function outline(ctx, mask, maskW, maskH, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(226, 213, 189, .55)';
  const stepX = w / maskW;
  const stepY = h / maskH;
  const size = Math.max(1, Math.ceil(Math.max(stepX, stepY)));
  for (let my = 1; my < maskH - 1; my++) {
    for (let mx = 1; mx < maskW - 1; mx++) {
      if (mask[my * maskW + mx] <= 0.5) continue;
      const edge =
        mask[my * maskW + mx - 1] <= 0.5 ||
        mask[my * maskW + mx + 1] <= 0.5 ||
        mask[(my - 1) * maskW + mx] <= 0.5 ||
        mask[(my + 1) * maskW + mx] <= 0.5;
      if (edge) ctx.fillRect(Math.round(mx * stepX), Math.round(my * stepY), size, size);
    }
  }
  ctx.restore();
}

/**
 * Draws level markers with their measurement onto an existing body map.
 * Kept separate so the plain silhouette can be reused without labels.
 */
export function annotateLevels(canvas, measurement, comparison) {
  const ctx = canvas.getContext('2d');
  const { maskW, maskH } = measurement;
  const sx = canvas.width / maskW;
  const sy = canvas.height / maskH;
  const u = canvas.width / 390;

  ctx.font = `600 ${12 * u}px ui-rounded, -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';

  for (const row of measurement.rows) {
    const y = row.y * sy;
    const right = row.right * sx;
    const change = comparison?.levels?.[row.id];

    ctx.strokeStyle = 'rgba(226, 213, 189, .32)';
    ctx.lineWidth = 1 * u;
    ctx.setLineDash([3 * u, 3 * u]);
    ctx.beginPath();
    ctx.moveTo(right + 3 * u, y);
    ctx.lineTo(canvas.width - 8 * u, y);
    ctx.stroke();
    ctx.setLineDash([]);

    const label = change?.deltaCm !== null && change?.deltaCm !== undefined
      ? `${row.label} ${change.deltaCm > 0 ? '+' : ''}${change.deltaCm}`
      : row.label;

    ctx.textAlign = 'right';
    ctx.fillStyle = change?.direction === 'up' ? '#d9694f'
      : change?.direction === 'down' ? '#4c8fd1' : 'rgba(242, 237, 228, .78)';
    ctx.fillText(label, canvas.width - 10 * u, y);
  }
  return canvas;
}

/** Square thumbnail for history lists. */
export function bodyThumbnail(canvas, size = 420, quality = 0.82) {
  const side = Math.min(canvas.width, canvas.height);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, (canvas.width - side) / 2, 0, side, Math.min(side, canvas.height), 0, 0, size, size);
  return out.toDataURL('image/jpeg', quality);
}
