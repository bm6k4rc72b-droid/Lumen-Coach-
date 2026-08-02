import { el, icon } from '../ui.js';
import { DISCLAIMER } from '../skin/guidance.js';
import { POSTURE_DISCLAIMER } from '../posture/analyze.js';
import { BODY_DISCLAIMER } from '../body/silhouette.js';
import { SPEED_DISCLAIMER } from '../speed/analyzer.js';
import { back } from '../router.js';

export async function render() {
  const node = el('div');

  node.append(el('div.hero', null,
    el('div.overline', { style: { marginBottom: '12px' } }, 'Method'),
    el('h2', 'What the numbers mean'),
    el('p', 'Krysaril measures rather than guesses, and says so when a measurement is an estimate. '
      + 'Everything runs in your browser — no frame ever leaves the device.'),
  ));

  node.append(block('Movement analysis', [
    'A pose model (MediaPipe Pose Landmarker) locates 33 body landmarks in every camera frame, on-device.',
    'Landmarks are smoothed with a One Euro filter, then converted into joint angles — knees, hips, ankles, shoulders, elbows and torso lean — in pixel space, so the aspect ratio never skews a reading.',
    'Each exercise has its own rules: a rep is detected by a hysteresis state machine on the primary joint, and every rep is scored against weighted form checks measured at the worst point of the rep, not the instant it ended.',
  ]));

  node.append(block('Posture assessment', [
    'A single still is measured against a plumb line dropped from the ankle: craniovertebral angle for forward head, shoulder position, trunk lean, a pelvic tilt proxy, knee and shin position in the side view; head, shoulder and hip levelness plus knee tracking in the front view.',
    'Each measure is rated against reference ranges from posture-screening literature. Those ranges are population guides — a value outside them is a prompt to look closer, not a verdict.',
    'This is photogrammetry from one 2D frame. Camera height, lens distortion, footwear, clothing and how someone happens to be standing all move the numbers, which is why the same setup each time matters more than any single reading.',
  ], POSTURE_DISCLAIMER));

  node.append(block('Body composition', [
    'The pose model also returns a person segmentation mask. Krysaril traces that outline and measures its width at eight anatomical levels, converting pixels to centimetres using the client\'s height.',
    'From those widths it derives waist-to-height and waist-to-hip — waist-to-height being the best-evidenced single tape measure for health risk — and, once you have two scans, tints the silhouette by how much each level changed.',
    'A camera cannot see beneath the skin, so Krysaril will not print a body-fat percentage off a photo. If you want one, enter three tape measurements and it applies the US Navy formula, which typically sits within 3–4 points of DEXA.',
    'Circumferences shown from the silhouette assume an elliptical cross-section, since depth is invisible from one angle. That assumption is the largest error term in this feature.',
  ], BODY_DISCLAIMER));

  node.append(block('Speed & output', [
    'A strike is an extension–retraction cycle of one hand, measured against that athlete\'s own reach, with a refractory window so a single punch cannot double-count.',
    'Hand speed comes from wrist displacement between frames scaled by height, reported in metres per second. Output is strikes over the last ten seconds, expressed per minute, so it responds to a flurry instead of flattening it.',
  ], SPEED_DISCLAIMER));

  node.append(block('Skin wellness', [
    'The photo is analysed locally in a canvas: converted to CIE L*a*b*, skin pixels isolated adaptively against the person\'s own tone, and separated into fine, mid and coarse detail.',
    'From that Krysaril measures tone evenness, localised redness, micro-texture, pore visibility, darker patches and surface shine.',
    'Redness is measured relative to your own baseline rather than an absolute threshold. A uniformly warm complexion is someone\'s natural tone, not irritation — treating it otherwise would penalise deeper and warmer skin tones, so only localised redness counts.',
  ], DISCLAIMER));

  node.append(block('Privacy', [
    'Clients, sessions, assessments and scans live in your browser\'s local database on this device only.',
    'Camera frames are processed in memory. The body scan stores only the silhouette outline — the photograph itself is discarded.',
    'The pose model is either bundled with the app or downloaded once and cached. Nothing else touches the network.',
    'Settings → Export backup moves your data to another device.',
  ]));

  node.append(el('p.tiny.muted.center.mt-24', { style: { lineHeight: '1.7' } },
    'Krysaril is a coaching and screening aid. It does not replace a qualified trainer, '
    + 'a physiotherapist or a doctor.'));

  return { title: 'How it works', back: () => back('/settings'), node };
}

function block(title, paragraphs, disclaimer) {
  return el('div.section', null,
    el('div.section-head', el('h2', title)),
    el('div.card', null,
      ...paragraphs.map((p) => el('p.small', {
        style: { margin: '0 0 12px', lineHeight: '1.7', color: 'var(--text-dim)' },
      }, p)),
      disclaimer ? el('div.disclaimer', { style: { marginTop: '6px' } }, icon('info'), el('span', disclaimer)) : null,
    ),
  );
}
