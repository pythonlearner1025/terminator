# Real grenade pass evidence

All captures are headless Chromium at 1920 by 1080 on the assigned port 4720.

- [Grenade in flight](./grenade-in-flight.png) shows the PBR-mapped M67 projectile after leaving the hand. `results.json` confirms albedo, normal, roughness, metalness, and ambient occlusion maps on every projectile mesh.
- [Grenade explosion](./grenade-explosion.png) shows the existing pooled blast at the authoritative event position. The proof records detonation at tick 150, radius 4, no remaining projectile or projectile visual, distance-scaled camera shake, and clean runtime teardown.
- [24 enemy benchmark](./24-enemies.png) shows the measured high-quality stress scene with every enemy visible and all effects enabled.

`npm test` passes 98 of 98 tests. `npx kite3d check` passes Playable, Editable, and Persisted. Editable retains the existing `CAMERA_CONTAINMENT_UNVERIFIED` warning.

`performance.json` records a 22.087 ms mean frame interval, 25 ms p95, and 45.275 effective fps. GPU time was 10.712 ms mean and 15.312 ms p95. This loaded-machine run misses the 60 fps target.

The grenade proof window reported no browser errors. Startup still reports the existing missing unit HDR path. The in-flight model is the procedural weapon-pass M67 and the blast remains a stylized sprite and particle effect, so both still fall short of KF2 asset and volumetric explosion quality.
