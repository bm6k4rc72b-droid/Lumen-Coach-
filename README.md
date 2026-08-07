# Krysaril

*krysis* — Greek **κρίσις**, judgement: the act of discerning, of telling one
thing from another.

A mobile-first Progressive Web App that measures the body six ways from a
phone camera — **movement form**, **postural alignment**, **body composition
change**, **strike speed and output**, **heart rate and HRV**, and **skin
wellness** — reads a **blood panel** you type in, and turns whatever it finds
into a **training program**. A built-in coach answers questions about your own
results by text or voice. Everything runs on-device. No accounts, no uploads,
no backend.

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

### 5. Recovery — heart rate and HRV from the camera

Photoplethysmography: each heartbeat changes how much green light the skin
absorbs, far too little to see but well above a phone camera's noise floor once
averaged over thousands of pixels. Hold a fingertip over the lens (or use face
mode), and 25 seconds gives resting heart rate, RMSSD and SDNN. Once there are
three past readings it scores **readiness** against your own baseline rather
than a population norm, because absolute HRV differs enormously between people.

> **It refuses more often than it guesses.** Two independent spectral gates
> must both pass before a number is shown: the share of in-band energy at the
> winning frequency, and how far that peak stands above the median bin. Across
> 200 synthetic pulse-free recordings, zero were reported as a heart rate. It
> cannot detect an irregular rhythm and is not a medical device.

### 6. Skin — wellness snapshot

Tone evenness, localised redness, micro-texture, apparent hydration, pore
visibility, pigmentation and oil balance, measured against your own baseline so
results hold across skin tones.

### Blood work

Enter the markers on your report — 20 of them across metabolic, lipids,
thyroid, iron, liver and kidney, hormones and inflammation — and each is placed
against its reference range, sex-specific where that matters. The report shows
where every value sits in its band and the change since your last panel.

The safety model is the point of this feature:

| Tier | What happens |
| --- | --- |
| In range | Shown, no advice needed |
| Outside range, lifestyle moves it | Specific levers (e.g. triglycerides) |
| Outside range, needs interpreting | Listed under **For your doctor**, no tips |
| Far outside range | Doctor banner at the top of the report, all tips withheld |

The urgent tier is checked first and can never be overridden by anything below
it. Krysaril does not diagnose, does not interpret a panel as a whole, and
deliberately says less the more abnormal a value is.

### Programs

From your own results — not a template — Krysaril builds a 4-week block and a
12-week arc. It ranks findings by severity, targets the worst one first, and
writes a week around it. A movement fault needs to show in at least two sets
before it counts as a finding; one bad set is noise. Low readiness reduces the
training days rather than the intensity of each. Anything flagged for a
clinician is excluded from the training plan entirely and listed separately —
the program works *around* it, never through it.

### Coach

An assistant that answers from your own measurements first ("how am I doing",
"what should I prioritise", "how's my readiness"), then from a knowledge base
of 23 topics, and only then — if you supply your own Anthropic API key — from
Claude. It talks by text or by voice, and it speaks answers back.

The knowledge base is a plain JSON file fetched network-first on every launch,
so editing `knowledge/kb.json` and redeploying updates every device the next
time it is online, with no app release. The last good copy is kept locally so
the coach still answers offline.

> **Bring your own key.** Krysaril has no backend, so there is no server to
> hold a key. Claude is optional and everything else works without it. The key
> stays in your browser and goes only to Anthropic — but because this is a
> public static site, use a dedicated key you can revoke.

### Clients

Every session, assessment, scan, panel and program files against a client
record with notes, goals, height and tape measurements. Full history, JSON
export/import.

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
npm test              # 62 unit tests: pose, posture, body, speed, labs,
                      # program, rPPG and retrieval maths
npm run e2e           # full browser run with a fake camera
npm run e2e:subpath   # served from a subdirectory (the GitHub Pages case)
```

`npm test` synthesises poses with forward kinematics, so every joint angle,
posture measure and silhouette width has an exact ground truth to assert
against. It drives the rep engine through squats, push-ups and presses, checks
the posture bands at their edges, verifies the US Navy formula against worked
examples, and confirms strike detection counts one strike per extension cycle
and none while a hand sits at guard.

The labs tests pin the safety behaviour so a later change cannot quietly remove
the escalation path: that a merely abnormal value never reaches the urgent
tier, that tips are withheld for urgent and clinician-only markers, and that an
urgent blood value surfaces as a clinical flag and never as training work. The
rPPG tests sweep 60 noise seeds to assert no pulseless recording is ever
reported as a heart rate, and that nothing the app is willing to publish is
more than 3 bpm out.

`npm run e2e` launches Chromium with a fake camera, walks every screen, verifies
the pose model initialises against a live `MediaStream`, exercises the posture,
body and skin engines in-page, runs a live round on the speed tracker, and
confirms the service worker precaches the shell. It also enters a blood panel
containing one urgent value end-to-end and checks the doctor banner appears
while lifestyle tips do not, asks the coach a question and checks it is
answered from the knowledge base, and builds a program and checks the urgent
value lands under the clinical flags rather than in the week's work.
Screenshots land in `test-results/`.

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
                      rounds, skin scans, vitals, labs, programs, settings,
                      backups
  camera.js           getUserMedia, permission diagnostics, wake lock, frames
  ui.js               DOM helpers, sheets, toasts, rings, formatting
  session-state.js    the in-progress session (survives an accidental reload)
  pose/               One Euro smoothing · joint geometry · exercise rules ·
                      rep state machine · MediaPipe loading · overlay
  posture/            clinical measures, reference bands, annotated chart
  body/               silhouette measurement, ratios, change heatmap
  speed/              strike detection, hand speed, round summaries
  skin/               Lab conversion, adaptive skin mask, frequency analysis
  vitals/             rPPG: resample, detrend, bandpass, DFT, HRV, readiness
  labs/               marker definitions, reference ranges, safety tiers
  program/            findings, block library, week builder, phase arc
  assistant/          knowledge loading and retrieval, chat routing, voice
  screens/            one module per route
knowledge/kb.json     the coach's knowledge base — edit and redeploy to update
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

**Recovery** resamples the irregular frame timestamps onto a fixed grid,
detrends, bandpasses 0.7–4 Hz zero-phase, and takes a direct DFT over 240 bins
in that band. A 20-second record holds only about 66 independent bins, so the
largest of them collects a large share of the energy by chance — which is why
the share-of-band figure alone cannot gate a reading, and peak-over-median does
the real work.

**Programs** rank findings by severity across posture, body, movement,
recovery, skin and bloods, then draw from a block library keyed to each
finding. Clinical flags are filtered out of the priorities before the week is
built, so they cannot become sets and reps.

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

Blood values you enter are stored in IndexedDB on the device like everything
else and are never transmitted. The coach answers from your data locally; only
if you connect your own Anthropic key does a question — with a compressed
summary of your results — go to Anthropic, and never anywhere else.

Krysaril is a coaching and screening aid. It does not replace a qualified
trainer, a physiotherapist or a doctor. It does not interpret blood work, and
it cannot detect an irregular heart rhythm.
