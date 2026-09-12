The implementation passes functional checks. It does not meet the film, KF2, or frame-budget targets.

Headless Chrome 152 used ANGLE Metal on Apple M3 Max at 1920 by 1080. High settings and all effects stayed enabled.
Each benchmark used 12 measured seconds after five warmup seconds. Shared Mac load can affect comparisons.
The wave-five fixture contains five Scouts, five Endos, five Heavies, four T-1000s, four Aerials, and one Tank.
This stresses unlocked types. It does not claim to reproduce a director seed or its purchase budget.
Before uses checkpoint `2898d1d` with the same mixed fixture. After uses the committed roster implementation.

| Metric | Before | After | Required |
| --- | ---: | ---: | ---: |
| CPU p99 | 30.200 | 18.700 | 13.3 |
| GPU p99 | 43.178 | 23.764 | 13.3 |
| Frame interval mean | 26.207 | 17.181 | 16.667 |
| Frame interval p99 | 44.700 | 20.800 | Reported |
| Effective FPS | 38.157 | 58.204 | 60 |

Times use milliseconds. Both p99 limits fail. The after-run M4 death costs 20.700 ms CPU and 13.958 ms GPU.
The separate death run kills each new type, then restores all 24 enemies after the spike.
T-1000, Aerial, and Tank kill frames cost 21.800, 21.300, and 21.400 ms CPU. The 20 ms spike limit fails.
GPU times for those frames are 14.839, 10.721, and 14.235 ms. The peak active piece count is seven.
Whole-scene draw calls fall from 331.485 to 284.117 mean calls. Geometry, materials, and particles use shared resources.
The new particle pool holds 192 instances. Unit preallocation holds eight T-1000s, eight Aerials, and two Tanks.

`npm test`: 187 passed, zero failed. Nine tests cover roster registration, PBR, animation, deaths, bounds, and the boss fixture.
`npx kite3d check`: 21 static rows pass. Playable, Editable, and Persisted pass in headless mode.
Editable retains `CAMERA_CONTAINMENT_UNVERIFIED`. No visible browser was used to resolve it.
All 20 authored part bounds differ by at most 4.841 cm. Settled idle and aiming bounds also pass.
The audit measures bounds. It excludes melee blades and does not certify every bank or attack frame.
The browser capture asserts boss visibility, T-1000 naming, blade state, three deaths, and runtime disposal.
All captures and benchmarks report zero browser errors. The worktree server stopped before the final check.

- [01-t1000-blade.png](01-t1000-blade.png): chrome body and blade attack.
- [02-hkaerial-bank.png](02-hkaerial-bank.png): bank, turret, engines, and searchlight.
- [03-hktank-boss.png](03-hktank-boss.png): twin guns, tread belt, headlights, and boss health.
- [04-t1000-puddle.png](04-t1000-puddle.png): mercury pool after collapse.
- [05-hkaerial-breakup.png](05-hkaerial-breakup.png): six detached physics pieces and fireball.
- [06-hktank-wreck.png](06-hktank-wreck.png): separated turret and burning hull.

These are fixtures rendered by the game. They are not captured live matches. Each image measures 1920 by 1080.

The T-1000 still looks like a procedural mannequin. Its face and rigid joints lack human anatomy and cloth deformation.
Liquid death scales a mesh into a pool. It lacks film-quality fluid reconstruction and live scene reflections.
Vehicle silhouettes remain compact because the core volumes are fixed. The Tank lacks the film tower and broad gun spacing.
Heat haze uses moving transparency. It does not refract the background. Searchlights use translucent cones and ground scattering.
Fire and smoke use pooled billboards. Their lighting and density remain below KF2.
The full scene exceeds both frame budgets. Core, map generators, and weapon renderers remain outside this pass.

Reproduce with `node tools/capture-roster-visuals.mjs` while port 4673 runs with `--no-open`.
Reproduce performance with `node tools/benchmark-browser.mjs --port=4673 --roster=wave5 --seconds=12 --warmup=5`.
Add `--roster-deaths=on` to stress the new death paths. Stop the dev server before `npx kite3d check`.
