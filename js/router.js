/**
 * Hash router — works from any static host and inside an installed PWA
 * without server rewrites.
 *
 * Routes are registered as '/clients' or '/client/:id'.
 * A screen module exports `render(ctx)` returning { title, subtitle, actions, node, full, destroy }.
 */

const routes = [];
let current = null;
let pending = 0;

export function route(pattern, loader) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }) + '$');
  routes.push({ rx, keys, loader });
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === target) { handle(); return; }
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
}

export function back(fallback = '/') {
  if (history.length > 1 && document.referrer !== '') history.back();
  else navigate(fallback, { replace: true });
}

function parse() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { path: path || '/', query };
}

async function handle() {
  const token = ++pending;
  const { path, query } = parse();

  const match = routes
    .map((r) => ({ r, m: r.rx.exec(path) }))
    .find(({ m }) => m);

  if (!match) { navigate('/', { replace: true }); return; }

  const params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m[i + 1])]));

  // Tear down the previous screen (stops camera loops, timers, etc.)
  if (current?.destroy) {
    try { current.destroy(); } catch (e) { console.warn('destroy failed', e); }
  }
  current = null;

  const view = document.getElementById('view');
  view.replaceChildren();

  let screen;
  try {
    const mod = await match.r.loader();
    if (token !== pending) return;               // a newer navigation won
    screen = await mod.render({ params, query, path });
  } catch (err) {
    console.error('Route failed', path, err);
    if (token !== pending) return;
    screen = {
      title: 'Something went wrong',
      node: errorNode(err),
    };
  }
  if (token !== pending) {
    if (screen?.destroy) screen.destroy();
    return;
  }

  current = screen;
  view.className = 'view' + (screen.full ? ' full' : '');
  view.replaceChildren(screen.node);
  view.scrollTop = 0;
  window.scrollTo(0, 0);

  applyChrome(screen, path);
  document.title = screen.title ? `${screen.title} · Lumen Coach` : 'Lumen Coach';
  document.body.classList.toggle('immersive', !!screen.full);
}

function errorNode(err) {
  const node = document.createElement('div');
  node.className = 'card';
  node.innerHTML = `<h3 style="margin-bottom:8px">Screen failed to load</h3>
    <p class="small muted" style="line-height:1.5">${String(err?.message || err).replace(/</g, '&lt;')}</p>`;
  return node;
}

function applyChrome(screen, path) {
  const bar = document.getElementById('appbar');
  const backBtn = document.getElementById('backBtn');
  const titleEl = document.getElementById('appTitle');
  const subEl = document.getElementById('appSubtitle');
  const actions = document.getElementById('appbarActions');
  const tabbar = document.getElementById('tabbar');

  bar.hidden = !!screen.hideAppBar;
  tabbar.hidden = !!screen.hideTabBar;

  titleEl.textContent = screen.title || 'Lumen';
  subEl.textContent = screen.subtitle || '';
  subEl.hidden = !screen.subtitle;

  backBtn.hidden = !screen.back;
  backBtn.onclick = () => (typeof screen.back === 'function' ? screen.back() : back(screen.back));

  actions.replaceChildren(...(screen.actions || []));

  const base = '/' + (path.split('/')[1] || '');
  for (const tab of tabbar.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === base || (base === '/session' && tab.dataset.tab === '/train'));
  }
}

export function start() {
  window.addEventListener('hashchange', handle);
  if (!location.hash) history.replaceState(null, '', '#/');
  handle();
}

export function currentScreen() { return current; }
