/**
 * Krysaril — app entry point.
 * Registers routes, boots the service worker and wires the install prompt.
 */

import { route, start, navigate } from './router.js';
import { toast } from './ui.js';

/* ------------------------------------------------------------------ routes */

route('/', () => import('./screens/home.js'));
route('/clients', () => import('./screens/clients.js'));
route('/client/:id', () => import('./screens/client.js'));
route('/train', () => import('./screens/train.js'));
route('/live', () => import('./screens/live.js'));
route('/speed', () => import('./screens/speed.js'));
route('/round/:id', () => import('./screens/roundreport.js'));
route('/scan', () => import('./screens/scanhub.js'));
route('/skin', () => import('./screens/skin.js'));
route('/skinscan/:id', () => import('./screens/skinscan.js'));
route('/posture', () => import('./screens/posture.js'));
route('/posture/:id', () => import('./screens/posturereport.js'));
route('/body', () => import('./screens/body.js'));
route('/bodyscan/:id', () => import('./screens/bodyreport.js'));
route('/history', () => import('./screens/history.js'));
route('/session/:id', () => import('./screens/session.js'));
route('/settings', () => import('./screens/settings.js'));
route('/about', () => import('./screens/about.js'));

/* --------------------------------------------------------- service worker */

const swSupported = 'serviceWorker' in navigator &&
  (window.isSecureContext || location.hostname === 'localhost');

if (swSupported) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Update ready — reopen the app to apply', '', 4000);
          }
        });
      });
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  });
}

/* --------------------------------------------------------- install prompt */

export const install = {
  deferred: null,
  available: false,
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  install.deferred = e;
  install.available = true;
  window.dispatchEvent(new CustomEvent('krysaril:installable'));
});

window.addEventListener('appinstalled', () => {
  install.deferred = null;
  install.available = false;
  toast('Krysaril added to your home screen', 'good');
});

export async function promptInstall() {
  if (!install.deferred) return false;
  install.deferred.prompt();
  const { outcome } = await install.deferred.userChoice;
  install.deferred = null;
  install.available = false;
  return outcome === 'accepted';
}

/* ------------------------------------------------------------------- boot */

// Keeps iOS from bouncing the whole page while a camera view is open.
document.addEventListener('gesturestart', (e) => e.preventDefault());

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection', e.reason);
});

start();

// Deep-link safety: an unknown hash lands on the dashboard.
if (!location.hash || location.hash === '#') navigate('/', { replace: true });
