# Tracer tuning

Player core widths increased threefold. White cores have saturated additive halos and a rear-third spatial fade.
Pistol remains thinner than M4. Shotgun retains nine visual pellets. Plasma remains blue. Sniper has the longest trail.
Enemy opacity limits prevent the volley from obscuring whole enemies. Pools, gameplay, models, and scene files stay unchanged.

All player tracers travel at 150 m/s. ProjectileView continues to read authoritative positions and velocities.
Widths and lengths below use metres. Minimum lengths use screen pixels at 1080p.

| Type | Core | Halo | Trail | Minimum pixels | Opacity | Halo colour |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Pistol | .075 | .72 | 4.8 | 72 | 1 | Orange |
| M4 | .114 | 1.02 | 8 | 112 | 1 | Orange |
| Shotgun | .081 | .75 | 3.2 | 64 | 1 | Orange |
| Plasma | .36 | 1.86 | 8 | 120 | 1 | Blue |
| Sniper | .09 | .90 | 14 | 176 | 1 | Gold |
| Round | .20 | .90 | 6 | 48 | .75 | Orange |
| Bolt | .30 | 1.05 | 6 | 48 | .55 | Enemy magenta, player blue |
| Shell | .16 | .40 | 3.2 | 48 | .45 | Orange |
| Grenade | Unchanged body | 0 | 0 | 0 | Unchanged | None |

The shared ribbon material also applies its existing .98 opacity multiplier. Knife has no tracer. Launcher uses shell styling.

[Reference findings](../../reference/kf2/tracers/NOTES.md) describe two additional KF2 clips and twelve retained frames.
The footage supports colour and contrast decisions. World lengths and the fade curve follow the owner's requested exaggeration.

Each screenshot panel is a native 1920 x 1080 headless capture. Composites preserve those pixels at 3840 x 2160.
Before and after use identical cameras, muzzles, shot ages, endpoints, assets, and fixture state.
Player eye: (-5, 1.65, 16), yaw pi, pitch .28, FOV 72. Targets are 20 m and 40 m away.
Shots appear about 1.1 m before their targets. Capture fixtures inject visual events and projectile snapshots.

- [M4 comparison](01-m4-comparison.png): 20 m above, 40 m below; before left, after right.
- [Sniper and volley comparison](02-sniper-volley-comparison.png): sniper above, incoming volley below; before left, after right.
- [M4 burst](m4-burst.gif): two seconds, 20 fps, 640 x 360, 2,325,806 bytes.

At 40 m, the connected bright M4 region grows from 29 to 394 pixels. Its diagonal grows from 13.5 to 68.1 pixels.
A brighter existing HDR sky also retains the white core and orange halo: 35 bright pixels become 421.
[Visibility measurements](visibility.json) use the largest connected region with R > 180, G > 100, and R > 1.15 B.

Headless Chrome 152 uses ANGLE Metal on Apple M3 Max. High quality, render scale 1, all benchmark effects, 24 enemies.
Each burst run uses five warmup seconds and ten measured seconds. [All measurements](performance.json) include the initial failed comparison.

| Burst run | CPU mean ms | CPU p99 ms | GPU p99 ms | Average fps |
| --- | ---: | ---: | ---: | ---: |
| Initial before | 13.472 | 17.4 | 13.238 | 59.112 |
| Initial after | 17.201 | 21.1 | 10.615 | 51.250 |
| Paired before | 13.183 | 16.5 | 13.805 | 60.003 |
| Paired after | 13.179 | 15.6 | 11.056 | 60.005 |

The initial comparison exceeded the budget. A consecutive repeat passes with CPU p99 decreasing .9 ms.
Shared-Mac timing varied. Final frame interval mean is 16.665 ms; p99 is 17.8 ms.
Tracer updates average .009 ms per frame. Projectile updates average .286 ms. Both runs report zero browser warnings.
The before repeat routes only baseline view modules from checkpoint 120ada8; the benchmark workload stays identical.

`npm test`: 147 passed, zero failed. Pool tests reuse buffers and slots across 10,000 emissions.
`npx kite3d check`: headless Playable PASS, Editable PASS, Persisted PASS, after stopping port 4674.
Editable retains the existing CAMERA_CONTAINMENT_UNVERIFIED diagnostic. [Check result](check.json).
Both capture runs report successful cleanup and zero browser errors.

Reproduce with `npx kite3d dev --port 4674 --no-open`.
Run `node test/view/tracers-browser.mjs before 120ada8`, then `node test/view/tracers-browser.mjs after --burst`.
Run `node tools/benchmark-browser.mjs --port=4674 --warmup=5 --seconds=10 --weapon-burst=on` for the burst benchmark.
Stop that server before running the native Kite3D check.

The game remains below KF2 art quality. Existing weapons, hands, and environment still look procedural.
Foreground geometry and HUD labels can occlude depth-tested ribbons. Sparse reference footage does not prove an exact KF2 reproduction.
