# Presentation pass evidence

Branch: `pass/presentation`. Captured on September 11, 2026. All browsers ran headless.
No editor window was focused, moved, or resized. No publish was performed.

`npm test`: 89 tests pass. `results.json`: 14 browser assertions pass, no browser errors.
The browser flow verifies real loading progress, cursor tracking without core ticks,
keyboard and mouse rebinding, persistence/reset, first-play controls, the live Hard
budget and HUD, repeated match startup, and the active 24-enemy workload.
`party-results.json`: six checks pass through a real host/guest relay on port 7811,
including first-time guest controls, readiness, Hell on Earth budget/health propagation,
and continued online simulation during binding changes. No page errors.

Kite3D: Playable, Editable, and Persisted pass, with 15 static checks passing.
Editable includes the engine's `CAMERA_CONTAINMENT_UNVERIFIED` note.
The default software-rendered headless shell timed out. The unmodified checker passes
with the installed full Chromium executable in headless mode:

```sh
NODE_OPTIONS="--import=$PWD/docs/evidence/pass-presentation/chromium-launch.mjs" npx kite3d check
```

## Frame time

1920 x 1080, DPR 1, High, Apple M3 Max through ANGLE Metal. Recorded 15.00 seconds
and 227 rendered frames, with exactly 24 enemies alive throughout: 8 Endo, 8 Scout,
8 Heavy. Simulation, AI, rendering and effects ran normally. Fixture health was raised
to preserve the workload, with sustained plasma input and periodic grenades.
The run records 1,150 shot events and 8 explosions. No test workers from this pass ran
during this measurement. Other workloads on the shared Mac were not controlled.

| Metric | Result |
| --- | --- |
| Mean frame time | 65.95 ms |
| Median | 31.10 ms |
| p95 | 259.10 ms |
| Rendered frames per second | 15.13 |

The 60 fps target is not met. An earlier frozen-results-screen sample was discarded.
A separate sample taken during concurrent tests was also replaced with the run above.

## Screenshots

Exactly five evidence screenshots, all 1920 x 1080:

- [01-menu.png](01-menu.png): full existing Endo, new mapped materials, live lighting and particles.
- [02-bindings.png](02-bindings.png): all 24 actions, including a rebound key and mouse button.
- [03-loading.png](03-loading.png): actual texture/font loading progress with slowed network requests.
- [04-controls.png](04-controls.png): one-time controls card before the simulation starts.
- [05-wave.png](05-wave.png): first-wave Hard difficulty and budget in the HUD.

Six separate storefront captures and the icon are in `docs/store/`, with capture staging
and asset provenance documented there. Reproduce the browser evidence and benchmark with
`node docs/evidence/pass-presentation/capture.mjs`. The game server must use port 4650,
and the lobby server uses `PORT=7811 npm run server`.

## Remaining gaps

The existing procedural Endo silhouette, facial proportions and baked detail still fall
short of KF2. The map, weapons and gameplay effects also retain their earlier prototype
quality in this worktree. This is not a ship-quality graphics result.
The new loading UI covers presentation textures and the font; earlier engine bootstrap
has no progress hook in this pass. The server's static rules still advertise default
scaling, although live lobby budgets and wave summaries carry the selected difficulty.
