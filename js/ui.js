/** Tiny DOM + interaction helpers shared by every screen. */

/**
 * Create an element.
 * el('div.card', { onclick }, 'text', childNode)
 */
export function el(spec, props = null, ...children) {
  const [tagPart, ...classes] = String(spec).split('.');
  const node = document.createElement(tagPart || 'div');
  if (classes.length) node.className = classes.join(' ');

  if (props && (props.nodeType || typeof props === 'string' || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'list' && typeof v !== 'object') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export function svg(paths, viewBox = '0 0 24 24') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;
  return s;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  chev: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  camera: '<path d="M4 8.5h3.2L9 6h6l1.8 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  flip: '<path d="M4 8.5V7a2 2 0 0 1 2-2h9M20 15.5V17a2 2 0 0 1-2 2H9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M17 2.5L20.5 6 17 9.5M7 14.5L3.5 18 7 21.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M4 7h16M9.5 7V5h5v2M6.5 7l.9 12.1a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  gear: '<circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5l1.4 2.2 2.6-.3.6 2.5 2.3 1.2-1 2.4 1 2.4-2.3 1.2-.6 2.5-2.6-.3L12 20.5l-1.4-2.2-2.6.3-.6-2.5-2.3-1.2 1-2.4-1-2.4L7.4 8l.6-2.5 2.6.3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5.5M12 7.6v.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  note: '<path d="M6 3.5h8.5L19 8v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3.7V8.3h4.6M8.5 13h7M8.5 16.5h4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>',
  share: '<path d="M12 3.5v11M8.2 7.3L12 3.5l3.8 3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11.5H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  person: '<circle cx="12" cy="8.4" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 19.5c.7-3.6 3.5-5.6 7-5.6s6.3 2 7 5.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M4.5 17l4.2-4.2 3.1 3.1 2.8-2.6 4.9 4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
};

export function icon(name, cls = '') {
  const s = svg(ICONS[name] || ICONS.info);
  if (cls) s.setAttribute('class', cls);
  return s;
}

/* ------------------------------------------------------------------ toasts */

export function toast(message, kind = '', ms = 2600) {
  const root = document.getElementById('toasts');
  const node = el(`div.toast${kind ? '.' + kind : ''}`, message);
  root.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 260);
  }, ms);
  return node;
}

export function haptic(pattern = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

/* ------------------------------------------------------------------ sheets */

let openSheet = null;

/**
 * Bottom sheet. `build(close)` returns the sheet body.
 * Resolves with whatever `close(value)` was called with.
 */
export function sheet(build, { dismissable = true } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('sheetRoot');
    const scrim = el('div.scrim');
    const panel = el('div.sheet', { role: 'dialog', 'aria-modal': 'true' }, el('div.sheet-grab'));

    const close = (value) => {
      if (openSheet !== handle) return;
      openSheet = null;
      document.body.classList.remove('no-scroll');
      panel.style.transition = 'transform .2s ease';
      panel.style.transform = 'translateY(100%)';
      scrim.style.opacity = '0';
      scrim.style.transition = 'opacity .2s';
      setTimeout(() => { scrim.remove(); panel.remove(); }, 200);
      window.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const handle = { close };

    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(undefined); };

    if (dismissable) scrim.addEventListener('click', () => close(undefined));
    window.addEventListener('keydown', onKey);

    panel.append(build(close));
    root.append(scrim, panel);
    document.body.classList.add('no-scroll');
    openSheet = handle;

    requestAnimationFrame(() => {
      const focusable = panel.querySelector('input, textarea, button, select');
      if (focusable && focusable.tagName !== 'BUTTON') focusable.focus();
    });
  });
}

export function confirmSheet({ title, message, confirmText = 'Confirm', danger = false }) {
  return sheet((close) => el('div', null,
    el('h2', title),
    message ? el('p.sub', message) : null,
    el('div.stack', null,
      el(`button.btn.btn-lg.btn-block${danger ? '.btn-danger' : '.btn-primary'}`,
        { onclick: () => close(true) }, confirmText),
      el('button.btn.btn-lg.btn-block.btn-ghost', { onclick: () => close(false) }, 'Cancel'),
    ),
  ));
}

/** Single-choice picker sheet. options: [{value,title,sub,emoji}] */
export function pickSheet({ title, sub, options, value }) {
  return sheet((close) => el('div', null,
    el('h2', title),
    sub ? el('p.sub', sub) : null,
    ...options.map((o) => el(`button.opt${o.value === value ? '.sel' : ''}`, { onclick: () => close(o.value) },
      o.emoji ? el('span.opt-emoji', o.emoji) : null,
      el('div.opt-main', null,
        el('div.opt-title', o.title),
        o.sub ? el('div.opt-sub', o.sub) : null,
      ),
      o.value === value ? icon('check') : null,
    )),
    el('button.btn.btn-lg.btn-block.btn-ghost.mt-8', { onclick: () => close(undefined) }, 'Cancel'),
  ));
}

/* ----------------------------------------------------------------- visuals */

export function scoreColor(score) {
  if (score === null || score === undefined || Number.isNaN(score)) return 'var(--text-faint)';
  if (score >= 80) return 'var(--good)';
  if (score >= 60) return 'var(--warn)';
  return 'var(--bad)';
}

export function scoreClass(score) {
  if (score === null || score === undefined || Number.isNaN(score)) return 'neutral';
  if (score >= 80) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}

/** SVG progress ring. */
export function ring(score, { size = 132, stroke = 10, label = null } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score ?? 0)) / 100;
  const color = scoreColor(score);
  const wrapEl = el('div.ring', { style: { width: size + 'px', height: size + 'px' } });
  wrapEl.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
              stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"
              style="transition:stroke-dashoffset .8s cubic-bezier(.2,.8,.3,1)"/>
    </svg>
    <div class="val">
      <div class="num" style="color:${color}">${score === null || score === undefined ? '—' : Math.round(score)}</div>
      ${label ? `<div class="of">${label}</div>` : ''}
    </div>`;
  return wrapEl;
}

export function bar(value, color) {
  return el('div.bar', el('i', { style: { width: `${Math.max(2, Math.min(100, value))}%`, background: color } }));
}

/* -------------------------------------------------------------- formatting */

export function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
}

export function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  if (yest) return `Yesterday, ${time}`;
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString([], opts)}, ${time}`;
}

export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function relDay(ts) {
  const days = Math.round((Date.now() - ts) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
