# Revolver animation video gallery

The deliverable is **Blender Eevee material previews**, sampled offline from the
approved packed source. It is not gameplay footage, a live FPS benchmark, or
normal-input proof. Browser capture was abandoned after memory pressure; the coordinating
agent selected Blender source previews as the fallback. Its failed evidence remains in `.kite3d/video-attempts/`.

## Reproduce

Run from this checkout with its exact existing dependencies (no installation
through the shared `node_modules` symlink), ffmpeg/ffprobe, and installed Blender:

```sh
tools/blender/revolver-rebuild/video/build.sh
```

This runs one Blender process per clip, then sequential two-thread encoding and
full decoding checks. Default output, ignored by Git:

```text
tools/blender/revolver-rebuild/generated/animation-videos/
  index.html                    self-contained offline gallery, ~2.72 MiB
  Idle.mp4 Draw.mp4 Fire.mp4 Reload.mp4
  AimIn.mp4 AimOut.mp4 AimIdle.mp4 Sprint.mp4 Inspect.mp4
  Revolver-All-Animations.mp4   labeled complete reel
  capture-manifest.json        output SHA256, frame counts, durations, cameras
  SHA256SUMS                   includes manifest hash
  verification.json            full decode, motion, source hashes, controls
  posters/                     actual decoded MP4 frames
  evidence/                    per-frame sample times, PNG hashes, NLA, caps
  frames/<Clip>/0000.png ...   every independently rendered frame
```

Open `index.html` directly. All ten videos, posters, controls and actual MP4
downloads are embedded. No network/server is required; source-credit links are
external. Native keyboard-accessible video controls, Play/Restart, 0.25×/0.5×/1×
speed buttons and reel chapter buttons are provided. Starting any player pauses
the others; no autoplay and `preload="none"` keep initial decoder load low.

Individual stages, useful for a bounded retry:

```sh
tools/blender/revolver-rebuild/video/render.sh --clip Reload
node tools/blender/revolver-rebuild/video/encode.mjs
node tools/blender/revolver-rebuild/video/verify.mjs
```

Use the shared resource lock around standalone encoding/verification when other
heavy work is scheduled. `build.sh` does this automatically. `--limit 1 --out
.kite3d/blender-video-probe` on `render.sh` renders a diagnostic frame, marked
incomplete and refused by the encoder.

## Exact capture method

- Packed source SHA256:
  `a1c506b177832cc183884cd75e2d58767e6e9a2a3004020956bd99b957019bf7`.
- Approved freeze manifest SHA256:
  `13551b6d725a8afa11673b681ff894b18c2e1d707029648506b95e772a65c6c6`.
- Exported glTF SHA256:
  `0b464109a9056cdb17d6c3785f4ee7f13ec531a95c79aca2b3586349d2259363`.
- Integration base `6975545`, pre-work checkpoint `4a65c66`.
- Open the saved Blend; select the matching named NLA track on **all animated
  objects** (72 tracks in this source). Clear active actions and solo flags;
  retain the source's native controls, constraints and baked animations.
- Use `scene.frame_set(floor(seconds*60), subframe=...)`. No builder,
  `animations.sample`, refitting, glTF re-export or Blend save is performed.
- Fixed 640×480 camera at the player origin, looking along Blender +Y, with
  54° **vertical** FOV and 0.02 near plane. Metadata hip placement and the existing
  `assemble.render_sample` root transform formulas supply AimIn/AimOut placement.
  Camera and area lights never auto-fit or track individual poses.
- Eevee with source textures/materials, gray world, three fixed area lights,
  Standard view transform, 16 temporal render samples where supported.
- Output samples are 0, 1/30, 2/30, … plus the exact terminal pose; native source
  rate is 60 Hz. Fifteen additional rendered endpoint frames are placed on each
  side. The final partial interval is padded to one encoded frame. Thus a 2 s
  clip has 91 frames / 3.033333 s including holds and terminal-frame inclusion.
- Every PNG, including each hold frame, comes from an actual render call.
  No synthesized/interpolated video frames or still-image slideshow. Standard
  authored NLA interpolation at source subframes is retained.
- H264/yuv420p, silent, 30/1 fps, MP4 faststart. ffmpeg adds the clip name and
  **BLENDER PREVIEW / 30 FPS** label. Reel timestamps derive from frame numbers
  to prevent MP4 container-duration rounding gaps.

Draw starts below the viewport; Sprint deliberately remains low in the fixed
player framing. Idle/AimIdle motion is subtle. These are the unchanged authored
poses, not camera reframing errors. Sampled visual evidence does not certify
continuous collision-free geometry. Prior independent QA established source to
export fidelity at 93 instants; this run does not repeat that comparison.

## Resource isolation

`render.sh` requires 3 GiB available memory and uses the existing shared wrapper
`coordination/revolver-blender` and its shared Blender/browser flock. Each clip
has a 240 s deadline and two render threads. The snap launcher creates a new
scope, so `limit-snap.py` applies MemoryMax1800M, MemoryHigh1600M, Tasks192 and
CPU200% to **its own detected snap scope only**, before loading the source.
`render.py` refuses to render without the effective memory cap and records peak,
OOM and task-limit counters. It never touches a human Blender process or UI.

The wrapper path can be overridden with `REVOLVER_BLENDER`; it must preserve
shared locking and the same caps. The local `limit-snap.py` check intentionally
supports this host's snap installation only. No browser is required for the
delivered workflow. No Mac render, install, publish or PR operation is involved.

## Verification and credit

`encode.mjs` verifies every PNG hash, probes frame counts/durations/dimensions,
and checks fixed camera and reversed AimIn/AimOut endpoints. `verify.mjs` fully
decodes all ten MP4s, measures decoded weapon-region frame changes, verifies
source hashes and embedded MP4/download identities, and executes the actual
inline gallery handlers with event targets for play exclusivity, speeds,
restart, chapters and background pause. No gallery browser visual test is
claimed. Frame sequences and decoded posters were visually inspected separately.

[First Person arms](https://sketchfab.com/3d-models/first-person-arms-e3c42c05b22944e5839deb8e003f0987)
by [DJMaesen](https://sketchfab.com/DJMaesen),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Arms were fitted and
retargeted to this revolver; original attribution and license are retained.

Only the scripts and this documentation are committed. Generated media, gallery,
manifest, screenshots and evidence stay ignored for parent handoff.
