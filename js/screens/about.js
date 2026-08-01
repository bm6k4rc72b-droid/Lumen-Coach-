import { el, icon } from '../ui.js';
import { DISCLAIMER } from '../skin/guidance.js';
import { back } from '../router.js';

export async function render() {
  const node = el('div');

  node.append(el('div.hero', null,
    el('h2', 'How Lumen works'),
    el('p', 'Two kinds of analysis, both running entirely in your browser. Nothing leaves this device.'),
  ));

  node.append(block('🏋️', 'Movement analysis', [
    'A pose model (MediaPipe Pose Landmarker) finds 33 body landmarks in each camera frame, on-device.',
    'Landmarks are smoothed with a One Euro filter, then converted into joint angles — knees, hips, ankles, shoulders, elbows and torso lean — in pixel space, so the aspect ratio never skews the numbers.',
    'Each exercise has its own rules: a rep is detected by a hysteresis state machine on the primary joint, and every rep is scored against weighted form checks (depth, alignment, tempo, symmetry).',
    'Colour coding is consistent everywhere: green means keep going, amber means adjust, red means stop and reset.',
  ]));

  node.append(block('🏃', 'Cadence and speed', [
    'Foot strikes are detected from the scissoring of the ankles, so cadence works on a treadmill as well as outdoors.',
    'Speed is estimated by scaling step length with the client\'s height. It is a good relative measure for comparing sessions, not a calibrated instrument — treat it as approximate.',
  ]));

  node.append(block('✨', 'Skin wellness scan', [
    'The photo is analysed locally in a canvas. We convert it to CIE L*a*b*, isolate skin pixels adaptively (using your own tone as the baseline, so it works across all skin tones), and separate the image into fine, mid and coarse detail.',
    'From that we measure tone evenness, redness, micro-texture, pore visibility, darker patches and surface shine, then map each onto an encouraging 0–100 score.',
    'Lighting matters. Soft, even, indirect light gives the most consistent readings, and comparing scans taken in similar light is far more meaningful than a single number.',
  ]));

  node.append(el('div.disclaimer.mt-16', icon('info'), el('span', DISCLAIMER)));

  node.append(block('🔒', 'Privacy', [
    'Clients, sessions and scans are stored in your browser\'s local database (IndexedDB) on this device only.',
    'Camera frames are processed in memory and never recorded or uploaded. Skin scans keep a small thumbnail so you can see your history.',
    'The pose model is downloaded once (or self-hosted with the bundled vendor script) and then cached for offline use.',
    'Use Settings → Export backup to move your data to another device.',
  ]));

  node.append(el('p.tiny.muted.center.mt-24', { style: { lineHeight: '1.6' } },
    'Lumen Coach is a coaching aid. It does not replace a qualified trainer, a physiotherapist or a doctor.'));

  return {
    title: 'How it works',
    back: () => back('/settings'),
    node,
  };
}

function block(emoji, title, paragraphs) {
  return el('div.section', null,
    el('div.card', null,
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' } },
        el('span', { style: { fontSize: '22px' } }, emoji),
        el('h3', { style: { fontSize: '16px' } }, title),
      ),
      ...paragraphs.map((p) => el('p.small', {
        style: { margin: '0 0 10px', lineHeight: '1.6', color: 'var(--text-dim)' },
      }, p)),
    ),
  );
}
