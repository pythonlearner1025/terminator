# Integrated sustained-play verification

Validated branch includes startup warmup `02a069b`, menu preparation `d8c3545` (parent's integration of `231004f`), GPU teardown `39ca0ef`, core retirement `9298452` (from `1d86ae5`), and HUD aggregation `ae48391` (from `bce3265`). Core/HUD clean final implementation heads were cherry-picked; their checkpoints were excluded. Verification checkpoint: `44d1bd5`.

## Results

- **DOM START → input ready: 5,051.5 ms; next frame: 5,071.6 ms.** Actual W input reached the simulation by 5,134.4 ms. New disposable browser/profile, local runtime, NVIDIA RTX 3090 Ti Vulkan, 480×270, CPUs 0–1, high quality. Driver shader cache may be warm. This is neither a published-network nor Mac/cold-driver acceptance result.
- **240.37 real seconds, 13,138 frame intervals**, with six active enemies in every ten-second snapshot; total simulation entities stayed at 6–7. 55 spawns, 49 deaths (30 controlled, 19 normal combat), 239.78 simulated seconds. No simulation fast-forward or revived-ID shortcut.
- **104/104 combined serial focused CPU tests pass** in 14.80 seconds.
- **Official Kite3D headless check: Playable PASS, Editable PASS, Persisted PASS.** No runtime errors, cleanup violations, or semantic drift. The verification preload supplies browser policy only; engine assertions/serialization remain unchanged. Peak check cgroup memory: 3,512,598,528 bytes (3.27 GiB).

Each table row describes its preceding ten-second window. Percentiles are frame intervals, not CPU-only FPS estimates or GPU timer-query measurements.

| Window ends | Frame p50 / p95 / p99, ms | Draw calls p50 | Corpse draws p50 | Corpse skeleton updates p50 | GPU geometries / textures / programs |
|---:|---:|---:|---:|---:|---:|
| 20 s | 16.6 / 19.7 / 21.6 | 354 | 3 | 4 | 849 / 229 / 217 |
| 100 s | 16.7 / 21.7 / 28.8 | 432 | 47 | 30 | 845 / 231 / 217 |
| 200 s | 20.0 / 26.5 / 43.4 | 486 | 103 | 76 | 840 / 237 / 218 |
| 240 s | 19.4 / 24.5 / 27.4 | 485 | 104 | 71 | 838 / 237 / 218 |

The core/HUD patches bound the demonstrated CPU history scans; this run **does not establish that sustained slowdown is solved**. Visible corpse work still grows. At 100 seconds all 37 ragdoll/debris records were settled, with zero active physics ragdolls, yet corpse draws and skeleton updates remained. `RagdollSystem.freeze()` releases physics bodies and adjusts bounds; it does not remove the visible skinned meshes. No corpse lifetimes, visuals, scene content, or quality were altered for this result.

Natural expiry began after three minutes. At the end there were 23 unit ragdoll corpses, eight roster deaths, 77 total ragdoll/debris records (75 settled), and 19 recycled records. Visuals rose from seven to 37. Programs were 217 in most snapshots and 218 at 200 and 240 seconds. The maximum frame interval was **255.6 ms** near 200 seconds; the final window also contained a 154.7 ms interval. Program names/timer-query causality were not captured, so neither hitch is attributed to compilation. This is not a no-hitch or stable-FPS claim.

## Workload and limits

`verify-sustained.mjs` uses normal GameManager fixed-step accumulation, `World.step`, AI, collision, movement, M4 fire and reload. The director's existing sandbox mode pauses wave escalation, makes the player invulnerable, and keeps one live unit of each of the six types. One rotating victim is killed every eight real seconds in addition to normal weapon kills; deaths use normal damage/effects paths. Ammo reserve is replenished; reload timing stays active.

The route moved about 144 m and then stalled against collision when rejoining its first leg. Later samples therefore show stationary firing/AI, not continued navigation. Live population matches throughout, but camera/visibility and corpse composition are not identical between early/late windows. Per-frame render/skeleton wrappers add measurement overhead. Arrays are drained every ten seconds; only interval summaries are retained.

The worker had MemoryMax 4 GiB, MemoryHigh 3500 MiB, TasksMax 384. The browser guard closes only the owned browser above 3.5 GiB. MemoryHigh recorded 1,229 events by about 80 seconds and did not increase through the later samples; max/oom/oom_kill stayed zero. Snapshot JS heap ranged 958–1,224 MB, ending at 1,041 MB. Event log (4,767) and replay (14,387) still retain match history; this is not an application-wide bounded-memory claim. Two local lobby requests were refused; no page exceptions or shader errors were captured.

## Stop and restart

Natural Stop after the four-minute run removed all named runtime roots, set manager world to null, restored rendering, and reduced GPU counters to 601 geometries / 85 textures / 84 programs. The following natural restart exceeded the 3.5 GiB guard during warmup; the run's peak including abort was 3.59 GiB. It was closed before 4 GiB, and that restart is **not** reported as successful.

A separate bounded follow-up used a 768 MiB JS old-space threshold and explicit CDP garbage collection **after each Stop**. Two actual DOM starts took 4,892.5 and 3,358.3 ms; both Stops removed runtime roots and returned geometries/textures to 598/85, with programs 81 then 82. Post-GC heaps were 593 MB then 835 MB. This verifies functional restart and removal of runtime roots under the stated setup, not automatic-GC timing, identical program count, or heap plateau.

The editor-hosted check repeatedly hit the same guard while holding authoring and Play viewers together. Initial interim logs obscured the guard; completed reports and Chrome stderr established the cause. The official headless path disposes each viewer before creating the next and passed under the unchanged guard. A stale `/api/state` predicate in the inherited runner was also corrected to require a timestamp newer than the current navigation.

## Reproduce

From this project, keep `npx kite3d dev --port 4758 --no-open` running. Session URLs/tokens stay in `.kite3d/dev.json`, never in committed evidence. All browser commands below are **sequential** and use disposable profiles. Reclaiming unused file cache targets only this worker's cgroup; never drop global caches. No screenshots are needed.

```sh
# Main recording; includes the natural restart attempt and its guard if reproduced.
DISPLAY=:1 taskset -c 0,1 node tools/v2/verify-sustained.mjs

# Diagnostic editor/short-restart follow-up, with explicit GC documented above.
# Its exit can be nonzero for the editor guard even if both runtime cycles pass.
DISPLAY=:1 taskset -c 0,1 node tools/v2/verify-sustained-cleanup.mjs

# All three official Kite3D outcomes, with no editor browser left connected.
DISPLAY=:1 NODE_OPTIONS='--import ./tools/v2/check-browser-policy.mjs' taskset -c 0,1 npx kite3d check

node --max-old-space-size=512 --test --test-concurrency=1 \
  test/core/sustained-retention.test.js test/core/sim/sim.test.js \
  test/core/sandbox/world.test.js test/net/party-clients.test.js \
  test/net/party-relay.test.js test/ui/presentation.test.js \
  test/ui/menu-preparation.test.js test/ui/startup.test.js \
  test/view/match-warmup.test.js test/view/startup-timing.test.js \
  test/view/retained-reparent.test.js test/view/roster.test.js \
  test/view/effect-buffer-cleanup.test.js test/view/ragdoll.test.js \
  test/view/unit-pool-traversal.test.js
```

Raw artifacts: `sustained-validation.json` (all 24 samples and natural restart abort), `sustained-cleanup.json` (editor guard and two short restart cycles), `sustained-kite3d-check.json`, `sustained-kite3d-check.log`, `sustained-check-browser-policy.json`, and `sustained-cpu.log`.

Publishing was not attempted. The known Blitz runtime-registry HTTP 404 remains a parent-owned publishing issue; local version/package/Node/Git checks passed. No shared dependencies or game/scene/quality files were changed by verification work.
