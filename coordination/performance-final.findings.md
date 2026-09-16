# Final bounded performance verification

## Acceptance: incomplete — natural fade shader coverage failed

Source tested: `23ccd98af762e63f7bb2f91ca489bc0b24bf760a`. Run HEAD was `e1d1e11918d266238e774c960e5d7d79bf5bb009`, an empty checkpoint with identical source. Only final verification tooling/evidence changed. No source fix, extra soak, editor check, restart loop, dependency change, push, or publish. Previous `sustained-*` reference evidence remains intact.

### Startup and natural soak

Actual DOM START → input ready **4994.5 ms**, next frame **5013.4 ms**, W accepted **5063.2 ms**. Startup inventory contains all 217 program IDs/names/cache keys. Warmup reports skinned/gore/vehicle fading fixtures 1/1/7; that report alone did not establish GPU coverage.

**240.50 seconds**, 13,252 frame intervals, 240 simulated seconds. Six live enemy types in every snapshot, 57 spawns and 51 kills (30 controlled rotating deaths, 21 combat). Normal World.step/AI/fire/reload/route, unchanged 180+2-second corpse lifetime. End: 24 unit corpses, 80 total records, 78 settled, 20 recycled. Route traveled 143.95 m then stalled against collision after wrapping, matching the reference fixture limitation.

| Window ends (s) | Frame p50 / p95 / p99 (ms) | Draws / corpse draws p50 | Native corpse skeleton calls p50 | GPU geometries / textures / programs |
|---:|---:|---:|---:|---:|
| 20.0 | 16.3 / 20.8 / 22.8 | 373 / 4 | 6 | 849 / 229 / 217 |
| 100.2 | 16.4 / 20.5 / 27.6 | 433 / 51 | 12 | 845 / 231 / 217 |
| 200.4 | 19.7 / 25.7 / 41.2 | 491 / 98 | 20 | 841 / 238 / 218 |
| 240.5 | 19.4 / 25.5 / 41.1 | 484 / 103 | 21 | 841 / 238 / 218 |

Maximum frame interval **79.1 ms**. Frame intervals include pacing and instrumentation; no 75 FPS, uncapped FPS, GPU timer, or causal improvement claim. Early/late corpse populations differ. Against the old reference, lower observed maximum hitch and lower native skeleton call counts do not prove a controlled overall performance gain.

### First-fade failure, actual material/program evidence

No accelerated age probe or artificial gameplay GC was used. Ordinary updates naturally crossed the 180-second boundary. The first actual rendered fading material was `Gore piece fade`, prepared material identity confirmed, opacity 0.991667, age 180.016667 seconds, at **190.520 s**, newly created program **236**. Skinned `Pooled fading wreck metal` followed at **202.571 s**, program **238**, likewise age 180.016667 and prepared identity confirmed. Detached HK `Pooled HK debris` followed at **222.477 s**, program **241**. All 15 observed transitions retain names, age, opacity, identity, and actual program/cache key in raw evidence.

There were **8 new program allocation events**, IDs 236–243, across **3 distinct cache keys**. Transient program removal/recreation means ten-second counts alone conceal some events. The per-frame count-change capture records added/removed IDs and full keys. Closest startup keys differ in output color-space (`rgbm-16` at startup versus `srgb-linear` at natural fade) and packed feature flags. This is a comparison, not a proven root cause. The next fix should verify coverage and retention of the actual transparent draw target/feature combination for all three families. No speculative production patch was made, and **no shader-coverage pass is claimed**. A fix still requires targeted GPU validation before acceptance.

### Controlled cache on/off/on microprobe

After the natural soak, paused only GameManager.update while continuing rendering. Same 80-record population, 23 settled skeletons, exact camera matrix, tick14402, all bone world/inverse matrices and skin buffers remained identical in every phase. Each phase had 300 ms settling and 2.5 s measurement. Cache instance methods were restored before Stop.

| Cache | Render CPU mean / p50 / p95 (ms) | Mean frame interval (ms) | Native corpse calls/frame | Cache skips/frame |
|---|---:|---:|---:|---:|
| on | 11.848 / 11.60 / 14.90 | 18.974 | 27 | 53 |
| off | 11.162 / 10.30 / 13.40 | 18.021 | 80 | 0 |
| on | 10.179 / 9.90 / 12.20 | 16.769 | 27 | 53 |

On phases: **zero bone-texture version increments for all23 skeletons**; off: versions advanced once or three times per frame depending on render passes. This verifies real native update/upload invalidation avoidance without changing pose. RenderManager.render times include synchronous driver submission, not GPU elapsed time. Times decreased monotonically across on/off/on, so temporal drift confounds attribution. No repeatable meaningful regression was demonstrated, and no cache revert is proposed from this short probe; a timing gain remains unproven. No screenshots; exact pose/skin comparisons provide equivalence evidence.

### Resources, Stop, official check, CPU tests

Runtime service peak **2.702 GiB**; game guard3.5GiB. MemoryHigh=MemoryMax=4GiB, TasksMax384. All memory.high/max/oom/oom_kill counters stayed zero. One browser at a time, DISPLAY=:1, CPUs0–1, 480×270, high quality, NVIDIA RTX3090Ti Vulkan, normal existing launch options. Own cgroup unused file cache reclaimed before each browser. Driver cache may be warm. One refused local `/api/lobby` request; no page exceptions or shader errors. No external-network/Mac acceptance claim.

**Stop passed:** no runtime roots, world=null, started=false, rendering restored; GPU counters601 geometries /85 textures /84 programs. Restart deliberately omitted and not claimed. Runtime browser fully closed before official check.

Fresh official CLI `checkedAt=2026-09-15T00:24:55.060Z`, mode=headless: **Playable PASS / Editable PASS / Persisted PASS**. All three semantic outcomes unmodified. Official check peak **2.975 GiB** under authorized3.8GiB guard; this is fresh evidence for this source, not the prior check. **123/123 focused serial CPU tests passed**, 13.36s, Node heap512MiB.

## Reproduce (sequential browsers)

Wait for `systemctl --user is-active terminator-v2-sustained-validation` to return `inactive`; run in a service with the same limits. Keep `npx kite3d dev --port 4758 --no-open` running. Do not expose `.kite3d/dev.json` session URLs.

```sh
DISPLAY=:1 taskset -c 0,1 node tools/v2/verify-performance-final.mjs
DISPLAY=:1 NODE_OPTIONS='--import ./tools/v2/check-browser-policy.mjs' taskset -c 0,1 npx kite3d check
node --max-old-space-size=512 --test --test-concurrency=1 \
  test/core/recent-events.test.js test/core/sustained-retention.test.js \
  test/core/sim/sim.test.js test/core/sandbox/world.test.js \
  test/ui/presentation.test.js test/ui/menu-preparation.test.js test/ui/startup.test.js \
  test/view/match-warmup.test.js test/view/startup-timing.test.js \
  test/view/settled-pose-cache.test.js test/view/ragdoll.test.js test/view/gore.test.js \
  test/view/frame-matrices.test.js test/view/effect-buffer-cleanup.test.js \
  test/view/unit-clone.test.js test/view/unit-pool-traversal.test.js \
  test/view/retained-reparent.test.js test/view/roster.test.js
```

Raw artifacts: `docs/evidence/performance-final-{soak,summary,check,check-policy}.json`, `performance-final-check.log`, `performance-final-cpu.log`. Natural-soak completion is independent of cache/Stop and official-check outcomes. Known external BlitzAPI404 remains parent-owned; publishing was not attempted.
