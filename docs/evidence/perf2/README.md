# Performance pass 2

Captured headlessly on the Apple M3 Max at 1920 by 1080, device scale 1, High quality, 24 living and rendered enemies, motion blur, bloom, SSAO, rain, smoke, and electric and steam hazards enabled. Each result uses a five-second warmup followed by a twelve-second capture:

```sh
node tools/benchmark-browser.mjs --port=4670 --seconds=12 --warmup=5 --output=docs/evidence/perf2/after.json --screenshot=docs/evidence/perf2/after.png
```

## Result

| Metric | Before | After |
| --- | ---: | ---: |
| CPU work mean | 12.429 ms | 8.493 ms |
| CPU p50 / p95 / p99 | 10.9 / 13.7 / 15.1 ms | 8.5 / 9.8 / 11.2 ms |
| GPU mean | 10.448 ms | 7.532 ms |
| GPU p50 / p95 / p99 | 9.842 / 15.339 / 17.444 ms | 7.226 / 11.171 / 13.286 ms |
| p99 workload floor | 57.326 fps | 75.267 fps |
| Draw calls mean / p99 | 301.525 / 311 | 256.799 / 265 |
| Triangles mean / p99 | 692,135 / 696,442 | 423,545 / 424,474 |
| Estimated texture memory | 656.533 MiB | 453.544 MiB |
| M4 compounded kill CPU / GPU | 936.9 / 18.793 ms | 14.3 / 20.05 ms |

The browser's headless `requestAnimationFrame` remains display-capped at about 60 Hz. The workload floor is `1000 / max(CPU p99, GPU p99)` and is the comparable 75 fps capacity measure. The p99 budget passes on both CPU and GPU. One isolated GPU maximum of 20.05 ms coincided with the deliberately compounded M4 kill; this remains above the 13.3 ms frame budget even though the former 936.9 ms main-thread stall is gone.

Warmup resolved and uploaded 101 textures, compiled 165 materials into 138 programs, and decoded all 101 audio samples before measurement. No shader compile or explicit texture upload event occurred during the after capture. Effects use fixed pools, dead-unit wreck spawning is one-shot, runtime light counts are stable, and active instanced ranges are compacted.

## Ten worst frames before

| Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | --- |
| 8 | 936.9 | 18.793 | M4 shot, kill, wreck, decal, and audio |
| 0 | 31.6 | 8.986 | 3 shader programs compiled |
| 24 | 31.3 | 8.111 | Limb loss |
| 572 | 15.1 | 19.633 | Render |
| 632 | 15.3 | 18.466 | Render |
| 9 | 12.0 | 18.345 | Render after the M4 stall |
| 142 | 11.1 | 18.325 | Render |
| 40 | 18.1 | 12.381 | Explosion |
| 230 | 10.1 | 18.073 | Render |
| 10 | 11.6 | 17.444 | Render |

## Ten worst frames after

| Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | --- |
| 8 | 14.3 | 20.050 | M4 shot, kill, wreck, limb, decal, and audio |
| 104 | 8.8 | 16.867 | Render |
| 103 | 7.6 | 16.439 | Render |
| 134 | 15.4 | 10.743 | Render |
| 28 | 8.6 | 14.154 | Render |
| 438 | 13.9 | 9.743 | Render |
| 75 | 8.1 | 13.838 | Render |
| 54 | 7.8 | 13.747 | Render |
| 7 | 8.7 | 13.523 | Render |
| 111 | 7.7 | 13.286 | Render |

## Visual and validation notes

The after frame preserves the full-resolution output, PBR unit and weapon materials, emissive eyes, rain, haze, bloom, SSAO, lighting, and HUD. High now uses 2x MSAA, a 1024 shadow map, short-distance full unit geometry with authored low-detail geometry beyond it, 20% bloom and SSAO buffers, and 65% particle density. It is materially faster but still falls short of Killing Floor 2 in environment density, animation variety, model topology, weapon detailing, and cinematic lighting. The procedural endoskeleton silhouettes and repeated crowd remain the clearest gap.

`npm test`: 91 passed, 0 failed. `npx kite3d check`: Playable PASS, Editable PASS with `CAMERA_CONTAINMENT_UNVERIFIED`, Persisted PASS.

## After integration with ragdolls

The integration used a three-second warmup and a ten-second headless capture at the same 1920 by 1080 High workload. No shader compilation or texture upload occurred during either capture.

| Metric | One M4 death | Eight M4 deaths |
| --- | ---: | ---: |
| CPU p50 / p95 / p99 | 8.1 / 9.3 / 10.0 ms | 8.8 / 10.9 / 12.1 ms |
| GPU p50 / p95 / p99 | 8.480 / 14.282 / 16.062 ms | 7.202 / 9.819 / 12.087 ms |
| First M4 kill CPU / GPU | 13.4 / 8.313 ms | 14.7 / 17.904 ms |
| Active ragdolls / mean view CPU | 1 / 0.046 ms | 8 / 0.614 ms |

| Capture | Frame | CPU ms | GPU ms | Cause |
| --- | ---: | ---: | ---: | --- |
| One death | 164 | 7.9 | 18.721 | Render tail during a garbage collection |
| One death | 383 | 8.4 | 17.116 | Render |
| One death | 280 | 8.1 | 16.812 | Render |
| Eight deaths | 8 | 14.7 | 17.904 | First M4 kill and effects |
| Eight deaths | 371 | 8.5 | 13.101 | Render |
| Eight deaths | 40 | 13.1 | 8.882 | Explosion |

The first-kill CPU and GPU frames are below 20 ms. Both CPU p99 results meet 13.3 ms. The eight-ragdoll GPU p99 also meets the target. The single-death GPU p99 misses at 16.062 ms because of render-bound tail spikes. The capture preserved every visible effect.

Three resolution decisions mattered most:

- Physics ragdolls own deaths, stop at eight active rigs, and keep wrecks for 180 seconds plus a two-second fade. `wreckSpawned` is the only death guard and resets on reuse.
- Instanced decals and embers remain. Detached limbs use cached geometry and two pre-bound pooled meshes per unit-type limb, then enter Cannon physics.
- Warmup creates one ragdoll and one detached limb, primes all physics pools, compiles the fade path, and resets every record before play.

The headless proof observed the warmup report, twelve pre-bound limb meshes, unchanged core snapshots, and zero physics bodies after Stop. `npm test` passes all 114 tests.

Evidence: [before.png](before.png), [after.png](after.png), [before.json](before.json), [after.json](after.json).
