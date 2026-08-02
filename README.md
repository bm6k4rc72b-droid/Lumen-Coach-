# Krysaril

*krysis* — Greek **κρίσις**, judgement: the act of discerning, of telling one
thing from another.

A mobile-first Progressive Web App that measures the body five ways from a
phone camera — **movement form**, **postural alignment**, **body composition
change**, **strike speed and output**, and **skin wellness**. Everything runs
on-device. No accounts, no uploads, no backend.

Built for iPhone (Safari) and Android (Chrome), installable to the home screen.

---

## What it measures

### 1. Movement — live form analysis

On-device pose estimation with a live skeleton overlay, real-time joint angles
(knees, hips, ankles, shoulders, elbows, torso lean), automatic rep counting and
per-rep form scoring across eight movements: squat · deadlift · push-up · lunge ·
overhead press · bent-over row · glute bridge · running gait. Colour-coded
coaching: **green** keep going, **amber** adjust, **red** reset.

### 2. Posture — physical-therapy style assessment

A single still, measured against a plumb line dropped from the ankle and marked
up like a therapist's chart.

| Side view | Front view |
| --- | --- |
| Forward head (craniovertebral angle) | Head tilt |
| Shoulder position vs plumb line | Shoulder level |
| Trunk lean | Hip level |
| Pelvic tilt proxy | Knee tracking |
| Knee position · shin angle | |

Each measure is rated against reference ranges from posture-screening
literature, scored, and paired with corrective work for whatever falls out of
range. Re-scan later and the report shows the delta per measure.

> **Screening, not diagnosis.** These are photogrammetric estimates from one 2D
> frame — camera height, footwear, clothing and stance all move the numbers.

### 3. Body — composition and change heatmap

Uses the pose model's person segmentation mask to trace your outline, measure
its width at eight anatomical levels, and convert to centimetres via your
height. Reports waist-to-height and waist-to-hip, and once you have two scans,
tints the silhouette by where you actually changed — cool where it shrank, warm
where it grew.

> **On body fat:** a camera cannot see beneath the skin, so Krysaril will not
> print a body-fat percentage off a photo. Enter three tape measurements and it
> applies the US Navy formula, which typically sits within 3–4 points of DEXA.
> The photograph itself is never stored — only the outline.

### 4. Speed — strike output and rounds

Round timer with rest periods, strike detection from arm extension against the
athlete's own reach, hand speed in m/s, and output as strikes per minute over a
rolling ten-second window so a flurry shows as a flurry. Per-round breakdown
with a strike-density sparkline.

### 5. Skin — wellness snapshot

Tone evenness, localised redness, micro-texture, apparent hydration, pore
visibility, pigmentation and oil balance, measured against your own baseline so
results hold across skin tones.

### Clients

Every session, assessment and scan files against a client record with notes,
goals, height and tape measurements. Full history, JSON export/import.

---

## Running it

No build step. Any static file server works.

```bash
npm start          # http://localhost:8080
```

Camera access needs a **secure context**: `https://` or `localhost`.

### Getting it onto a phone

**GitHub Pages** — Settings → Pages → Deploy from a branch → `main` → `/ (root)`.
Live at `https://<user>.github.io/<repo>/` about a minute later; open on the
phone and Add to Home Screen. Requires a public repo (or a paid plan).

**A tunnel** — for a quick trial from your laptop:

```bash
npm start                                                   # terminal 1
npx --yes cloudflared tunnel --url http://localhost:8080    # terminal 2
```

### Optional: self-hosted models

By default the MediaPipe runtime and pose model load from a CDN on first use and
are cached by the service worker. To self-host them (offline from first launch,
zero third-party requests):

```bash
npm run vendor          # lite model, ~28 MB into ./vendor
npm run vendor:full     # also fetch the higher-accuracy model
```

The app detects `./vendor/vendor.json` at runtime and prefers local assets.
`vendor/` is git-ignored — run this at deploy time.

---

## Testing

```bash
npm test              # 34 unit tests: pose, posture, body and speed maths
npm run e2e           # full browser run with a fake camera
npm run e2e:subpath   # served from a subdirectory (the GitHub Pages case)
```

`npm test` synthesises poses with forward kinematics, so every joint angle,
posture measure and silhouette width has an exact ground truth to assert
against. It drives the rep engine through squats, push-ups and presses, checks
the posture bands at their edges, verifies the US Navy formula against worked
examples, and confirms strike detection counts one strike per extension cycle
and none while a hand sits at guard.

`npm run e2e` launches Chromium with a fake camera, walks every screen, verifies
the pose model initialises against a live `MediaStream`, exercises the posture,
body and skin engines in-page, runs a live round on the speed tracker, and
confirms the service worker precaches the shell. Screenshots land in
`test-results/`.

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
  store.js            IndexedDB: clients, sessions, postures, body scans,
                      rounds, skin scans, settings, backups
  camera.js           getUserMedia, permission diagnostics, wake lock, frames
  ui.js               DOM helpers, sheets, toasts, rings, formatting
  session-state.js    the in-progress session (survives an accidental reload)
  pose/               One Euro smoothing · joint geometry · exercise rules ·
                      rep state machine · MediaPipe loading · overlay
  posture/            clinical measures, reference bands, annotated chart
  body/               silhouette measurement, ratios, change heatmap
  speed/              strike detection, hand speed, round summaries
  skin/               Lab conversion, adaptive skin mask, frequency analysis
  screens/            one module per route
```

**Angles** are computed in pixel space (never normalised space) so aspect ratio
never skews a reading, and smoothed with a One Euro filter — low jitter when
still, low lag when moving.

**Reps** use a hysteresis state machine on the primary joint with a 350 ms
debounce. Each rep is scored against the *worst* value reached inside that rep,
not the value at the instant it ended.

**Posture** measures the craniovertebral angle from the shoulder–ear line, and
everything else against a plumb line from the ankle. Reference ranges are
population guides: a value outside them is a prompt to look closer, not a
verdict.

**Body** converts silhouette width to circumference assuming an elliptical
cross-section (depth is invisible from one angle) — the largest error term in
that feature, and stated as such in the app.

**Skin** measures redness relative to your own baseline rather than an absolute
threshold. A uniformly warm complexion is someone's natural tone, not
irritation; treating it otherwise would penalise deeper and warmer skin tones,
so only *localised* redness counts.

**Performance**: GPU delegate where available with automatic CPU fallback,
`requestVideoFrameCallback` where supported, and a frame budget that adapts to
measured inference cost. Static-capture screens throttle to ~10 fps since a
held pose needs no more.

---

## Privacy

Camera frames are processed in memory and never transmitted. The body scan keeps
only the silhouette outline; the photograph is discarded. Clients, sessions,
assessments and scans live in IndexedDB on the device. The only network requests
the app can make are for the pose model and runtime — skipped entirely when
self-hosted. Settings → Export backup moves your data; Settings → Delete
everything removes it.

Krysaril is a coaching and screening aid. It does not replace a qualified
trainer, a physiotherapist or a doctor.
