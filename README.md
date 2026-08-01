# Lumen Coach

A mobile-first Progressive Web App for personal trainers and their clients:
**real-time exercise form analysis** from the phone camera, and an on-device
**skin wellness scan**. Everything runs locally — no accounts, no uploads, no
backend.

Built for iPhone (Safari) and Android (Chrome), installable to the home screen
and usable like a native app.

---

## What it does

### 1. Live movement analysis

- On-device pose estimation (MediaPipe Pose Landmarker, 33 landmarks) with a
  live skeleton overlay drawn exactly on the person.
- Real-time joint angles: **knees, hips, ankles, shoulders, elbows and torso
  lean**, plus shin angle, spinal alignment and knee tracking.
- Eight movements with their own rules and coaching language:
  squat · deadlift · push-up · lunge · overhead press · bent-over row ·
  glute bridge · **side-view running form**.
- Automatic rep counting, per-rep form scoring, and colour-coded feedback —
  **green** keep going, **amber** adjust, **red** stop and reset.
- Cadence and approximate speed for running and treadmill work.
- Trainers start a session, pick an exercise, save sets with rep counts, form
  scores, joint-angle ranges and notes, all against a client profile.

### 2. Skin wellness scan

Capture the face (or a specific area) and get an encouraging, non-clinical
snapshot of:

| Metric | What it looks at |
| --- | --- |
| Tone evenness | Consistency of tone across the scanned area |
| Calm & comfort | Visible redness or irritation |
| Texture & smoothness | Fine surface micro-texture |
| Apparent hydration | How plump and light-diffusing the surface looks |
| Pore refinement | Visibility of pores at this distance |
| Even pigmentation | Darker spots and patches |
| Oil & moisture balance | Where the skin sits between dry and oily |

Results come with gentle lifestyle suggestions, a photo-quality check, and a
history strip so changes are visible over time.

> **This is a general wellness tool, not a medical device.** It does not
> diagnose, treat or screen for any condition. Anything changing, painful or
> worrying belongs with a doctor or dermatologist.

### 3. Clients & sessions

Client list with notes, goals and height (used for speed estimates), full
session history with per-set breakdowns, and skin-scan history per client.
Export/import everything as a JSON backup.

---

## Running it

Any static file server works — there is **no build step**.

```bash
npm start          # http://localhost:8080
```

Camera access requires a **secure context**: `https://` or `localhost`. To test
on a real phone on your network, put it behind HTTPS (a tunnel such as
`ngrok`/`cloudflared`, or a self-signed certificate).

### Installing to the home screen

- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** menu → *Install app* (or the in-app Install button)

### Optional: fully offline / self-hosted models

By default the MediaPipe runtime and pose model load from a CDN on first use
and are then cached by the service worker. To self-host them instead (offline
from the very first launch, no third-party requests):

```bash
npm run vendor          # lite model  (~28 MB in ./vendor)
npm run vendor:full     # also fetch the higher-accuracy model
```

The app detects `./vendor/vendor.json` at runtime and prefers local assets
automatically. `vendor/` is git-ignored — run this at deploy time.

### Deploying

Copy the repository contents to any static host (GitHub Pages, Netlify, S3,
nginx). Everything uses relative paths and hash-based routing, so it works from
a subdirectory without server rewrites.

---

## Testing

```bash
npm test              # pose maths + rep engine (node:test, no browser)
node test/e2e.mjs     # full browser run: fake camera, real MediaPipe, PWA checks
```

`npm test` synthesises poses with forward kinematics, so joint angles have an
exact ground truth to assert against, and drives the rep engine through
squats, push-ups, presses and a simulated running gait.

`test/e2e.mjs` launches Chromium with a fake camera, walks the whole app
(client creation → live analysis → skin scan → history), verifies the pose
model actually initialises against a live `MediaStream`, checks the skin
engine separates calm skin from irritated skin on both light and deep skin
tones, and confirms the service worker precaches the shell. Screenshots land
in `test-results/`.

Regenerate the icon set with `npm run icons`.

---

## How it works

```
index.html            app shell (appbar · view · tab bar)
sw.js                 service worker: shell precache, model cache, offline
manifest.webmanifest  installability, shortcuts, icons
js/
  main.js             route table, SW registration, install prompt
  router.js           hash router with screen lifecycle (destroy stops cameras)
  store.js            IndexedDB: clients, sessions, scans, settings, backups
  camera.js           getUserMedia, permission diagnostics, wake lock, frame loop
  ui.js               DOM helpers, sheets, toasts, rings, formatting
  session-state.js    the in-progress session (survives an accidental reload)
  pose/
    angles.js         One Euro smoothing + joint geometry
    exercises.js      per-exercise rep spec, form checks and cues
    analyzer.js       rep state machine, scoring, cadence and speed
    landmarker.js     MediaPipe loading (vendor → CDN), GPU with CPU fallback
    overlay.js        skeleton + angle rendering in display space
  skin/
    analyze.js        Lab conversion, adaptive skin mask, frequency analysis
    guidance.js       wellness copy, suggestions, trends
  screens/            one module per route
```

**Angles** are computed in pixel space (never normalised space) so aspect ratio
never skews a reading, and smoothed with a One Euro filter — low jitter when
still, low lag when moving.

**Reps** use a hysteresis state machine on the exercise's primary joint, with a
350 ms debounce so a bounce at the top never counts. Each rep is scored from
weighted checks evaluated against the *worst* value reached inside that rep,
not the value at the instant it ended.

**Speed** for running scales step length by the client's height. It is a solid
relative measure between sessions, not a calibrated instrument — the UI always
labels it as an estimate.

**Skin metrics** are measured relative to the person's *own* baseline tone
(median inside the framing guide) and normalised by local brightness. The skin
mask is deliberately asymmetric — tight on the blue/green side to reject hair
and background, open on the red side so flushed or irritated skin is measured
rather than discarded. That keeps readings consistent across skin tones and
lighting.

**Performance**: inference runs on the GPU delegate where available (CPU
fallback is automatic), frames are driven by `requestVideoFrameCallback` where
supported, and the loop adapts its frame budget to measured inference cost so
the preview stays smooth on mid-range phones. HUD text repaints at ~11 Hz
independently of the render loop.

---

## Privacy

Camera frames are processed in memory and never recorded or transmitted.
Clients, sessions and scans live in IndexedDB on the device; skin scans keep a
small local thumbnail. The only network requests the app can make are for the
pose model and runtime (skipped entirely when self-hosted). Settings → *Export
backup* moves your data; Settings → *Delete everything* removes it.
