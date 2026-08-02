/**
 * Krysaril service worker.
 *
 * • App shell   → precached, cache-first (instant launch, works offline)
 * • Navigation  → shell fallback so the installed app always opens
 * • Model/WASM  → cache-first with background fill (MediaPipe is large but static)
 * • Everything else → network-first with a cache fallback
 */

const VERSION = 'v2.0.0';
const SHELL_CACHE = `krysaril-shell-${VERSION}`;
const MODEL_CACHE = 'krysaril-models-v1';
const RUNTIME_CACHE = `krysaril-runtime-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/app.css',
  './js/main.js',
  './js/router.js',
  './js/store.js',
  './js/ui.js',
  './js/camera.js',
  './js/session-state.js',
  './js/pose/angles.js',
  './js/pose/analyzer.js',
  './js/pose/exercises.js',
  './js/pose/landmarker.js',
  './js/pose/overlay.js',
  './js/skin/analyze.js',
  './js/skin/guidance.js',
  './js/posture/analyze.js',
  './js/posture/render.js',
  './js/body/silhouette.js',
  './js/body/heatmap.js',
  './js/speed/analyzer.js',
  './js/screens/home.js',
  './js/screens/clients.js',
  './js/screens/client.js',
  './js/screens/train.js',
  './js/screens/live.js',
  './js/screens/skin.js',
  './js/screens/skinscan.js',
  './js/screens/scanhub.js',
  './js/screens/posture.js',
  './js/screens/posturereport.js',
  './js/screens/body.js',
  './js/screens/bodyreport.js',
  './js/screens/speed.js',
  './js/screens/roundreport.js',
  './js/screens/session.js',
  './js/screens/history.js',
  './js/screens/settings.js',
  './js/screens/about.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.svg',
];

const MODEL_HOSTS = [
  'cdn.jsdelivr.net',
  'storage.googleapis.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Individual adds so one 404 cannot fail the whole install.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
        console.warn('[sw] precache skipped', url, err.message);
      })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, MODEL_CACHE, RUNTIME_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache camera/stream style requests or extensions.
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // 1. Navigations → app shell.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
          new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // 2. Pose model + wasm → cache-first, kept across app updates.
  if (MODEL_HOSTS.includes(url.hostname) || url.pathname.includes('/vendor/')) {
    event.respondWith(cacheFirst(request, MODEL_CACHE));
    return;
  }

  // 3. Same-origin app files → cache-first with revalidation.
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // 4. Anything else → network with cache fallback.
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => null);
  return hit || (await network) || new Response('', { status: 504, statusText: 'Offline' });
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    return (await cache.match(request)) || new Response('', { status: 504, statusText: 'Offline' });
  }
}
