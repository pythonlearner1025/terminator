Bunker 7 materials, light and atmosphere pass, 2026-09-11. Code: `ee90f1e`, branch `pass/materials`.

Local Poly Haven CC0 concrete, asphalt, rust and moonlit HDRI now provide the material base. Original 1K paint, corrugation, canvas and glass bakes add wear, normal and packed ARM maps. A 2K decal atlas supplies runoff, oil, scorch, bullet impacts, caution stripes and irregular puddles. Per-object UV offsets and world-space staining break up repeats. See [per-file provenance](../../../assets/LICENSES.md).

The pass adds aimed floods, balcony lamps, mesh light shafts, rain with roof masking, one-frame lightning, smoke controls, and three depths of burning ruins. It adds pipes, cables, sandbags, supply cases, a second crushed vehicle, and trader fittings. Large metal cases have beveled edges. Existing colliders remain authoritative; structural bounds pass, and dock roof clutter is unreachable. Static geometry and static children of animated doors and hazards are batched. Bloom, SSAO, cold grading, vignette and grain are active. Optional camera rotation blur is off by default.

Performance: **35.15 ms mean (28.4 fps), 43.3 ms p95** at 1920 x 1080, render scale 1, Apple M3 Max through ANGLE Metal, headless Chrome. The 12-second sample contains 341 completed frames, 24 live enemies, about 480 draw calls and 1.47 million triangles across passes. The fixture uses eight of each enemy with stationary firing brains, real World stepping and effects, and replenished player health to retain load. Rain is at maximum, both hazard types are active, and the sample crosses a lightning event. Motion blur stays off. The screenshot HUD count includes the existing director's pending spawn count; the measured alive-unit count is 24. These are render-frame intervals, not GPU timer-query measurements. **The 60 fps target is missed.**

Validation: `npm test` passes 83/83. `npx kite3d check` passes Playable, Editable and Persisted in headless mode. Editable retains `CAMERA_CONTAINMENT_UNVERIFIED` on the merged light-preview ground. The browser fixture reports zero errors, no collider-bound overflow, 23 surface materials with complete maps, three light-preview meshes, finite geometry, one-frame lightning, zone-controlled shafts, and successful Stop cleanup with restored scene maps. [Results](results.json) records the measurements.

This remains below KF2 quality. Rubble, vehicle and building silhouettes still look procedural; the yard lacks authored prop variety and dense storytelling. Light shafts use transparent geometry, puddles reflect the HDRI and lights without scene reflections, glass has no refraction, and fire/smoke remain simple particles. Rain has no splash simulation. No KTX2 compression was added. Core gameplay, actors, weapons and HUD were not edited.

Reproduce with the worktree dev server on port 4610 and `node docs/evidence/pass-materials/capture.mjs --benchmark`. The harness stays headless and briefly suspends rendering only after a completed frame to capture unchanged pixels. Weather controls are in [weather.json](../../../lib/view/weather.json). Source downloads and bakes are reproducible through `node generators/map.download.mjs` and `python3 generators/map.bake.py` (Pillow and numpy required).

Five unedited 1920 x 1080 screenshots:

- [courtyard.png](courtyard.png)
- [facade.png](facade.png)
- [dock.png](dock.png)
- [supplies.png](supplies.png)
- [24-enemies.png](24-enemies.png)
