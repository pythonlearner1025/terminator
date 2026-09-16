# Lobby warmup findings

Baseline: c51bc46 (atmosphere URL fix). Manual tracked-file checkpoint created before edits; shared node_modules remains read-only.

Scope: match-warmup.js, unit/weapon/FX resource warmup paths and focused tests. No orchestration edits, publish, push, or merge.

Initial inspection: warmup currently primes every gameplay pool, traverses runtime resources, compiles both projectile-light variants, renders two frames per variant, and calls GPU finish. These gates will be preserved unless evidence proves redundant work. Investigating duplicate object targets/material programs and death-pool work. No under-10-second claim; software-renderer timings are not Mac timings.

Browser budget: at most one owned Chromium process with small viewport, sequential captures only. Parent Mac timing file will be checked periodically.

## Parent evidence read

Existing Mac tab (already played/GPU warm): 4,862 ms DOM START to input frame; visual warmup 4,291 ms. Active compile 1,067 ms overlapped 835 ms texture upload; active render 1,277 ms; inactive compile 737 ms; inactive render 40 ms; finish 0 ms. Not a fresh-start result or evidence of an optimization. Waiting for parent's hard-reload quick START result.

## Capture setup

One owned dev server at port 4754. Initial Chromium launch failed at worker TasksMax=192 (pthread_create EAGAIN), not GPU memory. Own TasksMax raised to 384, memory.max remains 4 GiB. Single capture restricted to CPUs 0,1, viewport 480x270, SwiftShader. No other Chrome processes touched. Doctor runtime registration returns HTTP 404; local version pin/packages and backend health pass.

## Successful baseline capture (650 RTX, not Mac)

Corrected inherited DISPLAY=:77 (nonexistent X server) to :1 for the owned headless browser. Renderer reports NVIDIA RTX 3090 Ti Vulkan. Browser/context creation failures preceded this single successful scene capture; all failed launches exited before retry. Peak observed worker memory ~3.19 GB, cap unchanged at 4 GiB.

Fresh browser local runtime, 480x270, 2 CPU affinity, immediate programmatic startMatch after main: 6,918 ms. Not published-network or DOM-click Mac acceptance evidence.

- 1,144 renderables: Map 397, Units 624, Player 72, Grenades 51.
- 535 target material identities, 563 geometries; collection including compositor: 541 materials / 209 textures.
- Priming: 54 clones, 438 ms total, 318 ms clone work.
- Active compile 1,758 ms (texture upload 1,118 ms overlaps); 24 -> 118 programs.
- Active render 1,683 ms; 118 -> 208 programs.
- Idle compile 984 ms; its synchronous compile creates 77 additional programs (208 -> 285), then actual render during asynchronous polling adds another 77 (362 total).
- Idle render 75 ms, finish 0 ms.
- Death coverage intact: unit ragdoll 1, limbs 6, skull 1, torso split 1, dent 1, roster deaths 3.

Source explains duplicate variants: renderer.compile bypasses material.onBeforeRender (which sets SSAO_ENABLED, FIX_ENV_DIRECTION, INVERSE_ALPHAMAP), and compile runs with no compositor render target (different outputColorSpace key). Testing matching material hooks and compositor target during synchronous compilation, restoring renderer target immediately before awaiting async completion.

## Candidate evidence: shader setup/target correction

The first candidate (material before/after-render hooks + opaque compositor target) reduced 362 -> 268 resident programs. Inspecting material cache keys confirmed the remaining mismatch: the scene uses RGBM-16 opaque output but its transparent pass uses a separate NoColorSpace target. Compiling opaque and transparent/transmissive material entries against their respective actual compositor targets reduces 362 -> 210 programs (42%). All assets, pool counts, both lighting variants, two actual compositor frames per variant, and GPU finish remain.

Latest same-browser candidate startup: 4,853 ms, visual warmup 3,750 ms. These later passes have a warmer shader cache than the initial 6,918 ms baseline; use the deterministic 152-program reduction as causal evidence, not a claimed 30% cold-start timing improvement. Next: focused lifecycle/target tests and one sequential first-combat validation. No Mac acceptance claim.

## First-combat validation and additional resource fix

DOM START -> next playable frame in a new owned 480x270 RTX browser: 4,873 ms (local runtime; driver disk cache may be warm). Six-type spawn max observed frame 25.6 ms; first pistol 23 ms; first plasma 19 ms; six simultaneous deaths 45.2 ms. Death simulation includes real skull crunch, detached limbs, torso split, and all three roster death types. Stop restored rendering and removed every checked runtime root.

The six-type spawn exposed two NEW `Sweeping searchlight haze` programs. Root cause: UnitView primed optics only AFTER killing the aerial during its death warmup, so its instanced beam/spot pools were not constructed at all until combat. Fix: prime live optics before the death exercise; generic warmup then uploads and compiles the retained instance pools. This preserves the existing visuals and pool capacities. Revalidating no program creation on first spawn/shot/death.

The capture's strict zero-console assertion saw one unavailable local lobby connection (ERR_CONNECTION_REFUSED), while match fallback, gameplay and cleanup worked; no shader/page errors. Keeping that limitation in evidence rather than deleting it.

## Final verification

- Final DOM START -> next playable frame: **4,907 ms**, local RTX 3090 Ti, 480x270, two CPU affinity, new controlled browser. Driver cache may be warm. No published Mac/cold-start or 75 FPS claim.
- Final readiness report: 219 programs before pool cleanup (217 on first playable frame), includes new aerial optics coverage. The target-correction-only controlled sequence demonstrated 362 -> 210 programs before the added coverage. Final DOM flow also retains a few more menu programs, so these counts are not identical test conditions.
- First six-type spawn / pistol / plasma / six simultaneous deaths: **zero new shader programs** in every phase. Maximum observed frames: 20.8 / 22.4 / 21.9 / 42.5 ms, respectively. Synthetic six-death burst is bounded but not evidence for sustained 75 FPS.
- First-death paths: skull crunch, four detached limbs, torso split, dents, and all three roster death systems observed.
- Stop: renderEnabled=true, no checked runtime roots. No asset disposal changes; all original shared resources and pool capacities retained.
- **45 focused tests pass** (warmup, rendering suspension, roster, weapons, weapon preload, unit reuse, retained shared resources).
- **`npx kite3d check` PASS**, editor-hosted in a single owned 480x270 headless browser: Playable, Editable, Persisted all pass; runtimeErrors=0, trackedObjectCount=0, outsideRenderableCount=0, semantic drift=[] (2026-09-14T23:33:15Z). Engine logged nonfatal missing KHR_parallel_shader_compile notices; fallback remained gated.
- All owned Chrome processes closed after capture/check. Never touched parent/user Chrome. Worker memory stayed below 4 GiB; a 3.6 GiB browser-close monitor guarded the final check (not triggered). Shared node_modules unmodified.

Implementation keeps both active/idle lighting compiles, four requested full compositor warmup frames, complete texture upload, and GPU finish. It pauses automatic repeated pool renders during idle compilation. No scene/physics/quality/visual changes; no deferred combat resources. API remains warmupMatch(manager,{signal}).

Remaining acceptance work belongs to parent: fresh published-site quick START on Mac with the orchestration changes integrated. Last parent timing file still contains only the pre-change, already-warm 4,862 ms measurement.
