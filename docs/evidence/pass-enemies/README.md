# Enemy fidelity pass

This pass improves the existing three enemies. It does not reach KF2 fidelity or the requested 60 fps. No new roster entries were added. Core gameplay, brains, budgets and the saved scene are unchanged.

The shared 2048px atlas supplies albedo, normal and packed AO/roughness/metalness, with 256px optical maps and 512px impact maps. The deterministic baker is `generators/unit-textures.py` (Python, Pillow, NumPy). The reflection HDRI is Poly Haven's CC0 Studio Small 09; per-file provenance is in `assets/LICENSES.md`. Stopped generators now display the full articulated figures.

The skull has open orbital and nasal apertures, cavity walls, recessed optics, a hinged mandible and individually modeled teeth. All three bodies use moving hydraulic rods. Runtime bodies share geometry and materials, switch to reduced geometry beyond 9m and batch optical lenses and glow across the crowd. Enemy effects live exclusively in `lib/view/units-fx.js` with capped particle, decal, ember and detached-limb pools.

Motion includes target tracking, pitched aim, body-part flinches, stagger, stair/ramp foot IK with hip lowering, and a gravity-driven limp fall constrained above the floor. The fixture measured a maximum ankle target error of 1.6cm and minimum corpse/limb clearance of 6mm. Four accelerated hit rays matched the rendered skinned mesh. Animation left the complete core snapshot unchanged; Stop removed all unit/effect roots.

Final validation: **83/83 `npm test` tests passed**. **Playable, Editable and Persisted passed** in `npx kite3d check`, with 15 static rows passing. The engine reports `CAMERA_CONTAINMENT_UNVERIFIED` alongside the passing Editable outcome. `check.json` contains the outcome summary; `results.json` contains the visual assertions and measurements. No JavaScript or renderer errors occurred in the final harness run.

Performance: full Chrome running headless on **Apple M3 Max / ANGLE Metal**, 1920x1080, render scale 1, full map/HUD/weapon and live core brains. Exactly 24 enemies remained alive (8 of each type) during all 360 measured/rendered frames. Plasma, minigun, sparks, oil and impact decals ran during sampling. The mean was **42.23ms (23.68 fps)**, median **33.40ms**, p95 **83.40ms**. Unit view updates averaged 2.26ms and measured render submission averaged 9.23ms. Mean draw calls were 327. The 60 fps target is **not met**. The separately labeled control with unit rendering hidden is diagnostic only and is not used as the enemy frame-time result.

Screenshots, all 1920x1080:

- `01-endo-skull.png`: close-up in the runtime inspection stage.
- `02-roster.png`: Scout, Endo and Heavy inspection stage.
- `03-damage-wreck.png`: grounded collapse and detached arm fixture.
- `04-live-24.png`: the live 24-enemy stress fixture after the crowd closes in. Player health is raised for measurement.

Remaining gaps: the skull and armor still show procedural plate construction, repeated wear and overly uniform proportions. Chrome uses a studio reflection probe rather than reflections of Bunker 7. The fall is a constrained limp pose, not a complete joint collision ragdoll; wall/body collisions and Scout hand planting remain approximate. Damage dents are normal-mapped decals, not mesh deformation. Limb loss currently removes a non-weapon arm after accumulated heavy damage. Core damage events omit exact impact points, so pellet and explosive impacts use approximations. T-1000, HK-Aerial and HK-Tank are deferred because the earlier quality and performance targets are not yet solid.

Reproduce with `npx kite3d dev --port 4620 --no-open`, then `node docs/evidence/pass-enemies/verify.mjs`. The harness reads authentication privately from this worktree, always launches headless Chrome and closes it afterward. Screenshots pause rendering only while copying the already rendered frame. Performance sampling requires and verifies active rendering throughout; it never measures that pause. `ENEMIES_MOTION_ONLY=1` and `ENEMIES_ART_ONLY=1` rerun the fixtures without replacing the full measurement report.
