# Tracer realism pass

Player and enemy rounds now use narrow velocity-aligned quads with HDR cores and no painted halo.
Exposure sets world length. White heads grade through yellow into orange tails; the last forty percent fades.
Plasma concentrates light in its leading tenth. The existing player heat-shimmer hook stops at impact.
Residual lines fade by point age at five percent peak intensity. All endpoints stop at observed impacts.
Shells retain physical bodies and use thin gray smoke lines. Fixed pools reuse every slot and instance buffer.

[Reference study](../../reference/tracers/NOTES.md) records five video sections, three photos, and fifteen findings.
Retained reference images total 1,082,663 bytes. Videos remain in ignored scratch storage. No reference assets ship.

| Type | Core m | Exposure length m | Head / tail | Linger ms | HDR intensity |
| --- | ---: | ---: | --- | ---: | ---: |
| Pistol | .022 | 2.5 | Warm white / orange | 140 | 12 |
| M4 | .026 | 3.6 | Warm white / orange | 160 | 14 |
| Shotgun pellet | .020 | .9 | Warm white / orange | 120 | 8 |
| Player plasma | .034 | 3.9 | Blue-white / blue | 180 | 14 |
| Sniper | .028 | 5.5 | Warm white / orange | 180 | 16 |
| Enemy round | .024 | 1.0 at 30 m/s | Warm white / hot orange | 140 | 12 |
| Enemy bolt | .045 | 1.4 at 18 m/s | Pink-white / magenta | 160 | 12 |
| Player bolt | .045 | 1.4 at 18 m/s | Blue-white / blue | 160 | 12 |
| Shell / launcher | .035 smoke | 1.2 smoke | Gray / gray | 180 | 1, nonadditive |
| Grenade / knife | None | None | None | 0 | 0 |

Player visual speed remains 150 m/s. Shotgun keeps nine cosmetic pellets. Gameplay data stays unchanged.
HDR values multiply linear RGB. Bolt line opacity is .85. Shell smoke opacity is .16.
The core has a 1.5-pixel coverage floor. A 16-pixel end-on dash floor replaces the old 112-pixel M4 floor.
Without that small directional floor, the muzzle-aligned 40 m exposure projected below one pixel.
Measured bright core width is 2.93 pixels at 20 m and 2.85 pixels at 40 m.
High enables bloom. Low also enables bloom by default; the proof explicitly disables it and still resolves the core.

- [M4 comparison](01-m4-comparison.png): 20 m above, 40 m below; current master left, new renderer right.
- [Sniper and volley](02-sniper-volley-comparison.png): 40 m sniper above; nine incoming rounds and bolts below.
- [Reference and bloom](03-reference-bloom-comparison.png): real night footage, long exposure, and labeled 8x pixel crops.
- [Two-second M4 burst](m4-burst.gif): 40 frames at 20 fps, 640 x 360, 1,808,804 bytes.

Scene captures use native 1920 x 1080 pixels. The three composites preserve those panels at 3840 x 2160.
The camera matches the prior evidence: eye (-5, 1.65, 16), yaw pi, pitch .28, FOV 72.
Volley pitch is zero. Its fixture uses balcony-height paths above HUD labels, with identical before/after positions.
Rounds move at 30 m/s; bolts move at 18 m/s. Their final z distance is 20 m.
The reference footage gives no calibrated range. The comparison matches viewing direction, not verified physical distance.
All captures use headless Chrome, fixed event fixtures, real muzzle positions, and unchanged map and enemy assets.
Both capture runs report zero browser errors and successful Stop cleanup.

[Measurements](metrics.json) retain every benchmark run, camera records, pixel measurements, and both check results.
The unchanged benchmark uses High, 1920 x 1080, 24 enemies, all effects, and the weapon-burst fixture.
Chrome 152 uses ANGLE Metal on Apple M3 Max. Each run warms five seconds and measures ten seconds.

| Run | CPU p99 ms | GPU p99 ms | Mean frame interval ms | FPS |
| --- | ---: | ---: | ---: | ---: |
| Initial before | 19.1 | 23.780 | 17.549 | 56.985 |
| Initial after | 34.9 | 53.956 | 29.649 | 33.727 |
| Consecutive before | 34.2 | 48.300 | 30.141 | 33.177 |
| Consecutive after | 27.0 | 40.547 | 25.183 | 39.709 |
| Repeat before | 25.3 | 35.002 | 22.683 | 44.086 |
| Repeat after | 28.6 | 35.354 | 24.662 | 40.549 |
| Final before | 35.3 | 47.594 | 30.267 | 33.039 |
| Final after | 28.9 | 42.048 | 24.807 | 40.311 |

The final pair uses the committed 16-pixel directional floor. Earlier after runs used eight pixels.
The final pair passes the 1 ms budget, with CPU p99 decreasing 6.4 ms. Initial and repeat pairs failed.
Timing varied across runs. These measurements cannot establish a stable performance improvement or sustained 60 fps.
Final tracer CPU averages .023 to .016 ms/frame. Projectile CPU averages .445 to .079 ms/frame.
All benchmark runs report zero browser warnings. Baseline routing reads local checkpoint 45a439f without switching branches.

`npm test`: 152 passed, zero failed. Pool tests cover 10,000 emissions and fixed buffer and vector identities.
One repeat failed the existing simulation-speed threshold at 21.3x. A subsequent full run passed without code changes.
Default `npx kite3d check` timed out before 30 frames. The complete suite passes with headless Chrome and Metal.
Playable PASS. Editable PASS, with the existing CAMERA_CONTAINMENT_UNVERIFIED diagnostic. Persisted PASS.
The dev server was stopped before both checks. No browser window or OS input was used.

Reproduce:

```sh
npx kite3d dev --port 4676 --no-open
node test/view/tracers2-browser.mjs after --burst
node test/view/tracers2-browser.mjs before 45a439f
node test/view/tracers2-benchmark.mjs --baseline=45a439f --port=4676 --warmup=5 --seconds=10 --weapon-burst=on
node tools/benchmark-browser.mjs --port=4676 --warmup=5 --seconds=10 --weapon-burst=on
python3 test/view/tracers2-evidence.py
# Stop the development server before this check.
NODE_OPTIONS='--import=./test/view/tracers2-check.mjs' npx kite3d check
```

The game still falls below KF2 overall. Existing weapon, hand, and environment silhouettes remain procedural.
The existing coarse bloom spreads faint light farther than the requested three-to-five-core-width envelope.
Low upscaling softens the core. HUD labels and scene geometry still correctly occlude depth-tested streaks.
The requested bloom envelope and sustained 60 fps remain unmet. Reference distance remains unverified.
