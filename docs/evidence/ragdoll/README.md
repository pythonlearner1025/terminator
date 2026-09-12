Ragdoll pass, September 11, 2026. Branch `pass/ragdoll`.

Deaths now transfer the posed rig and movement velocity to 11 Cannon bodies with ten limited cone/twist joints. Shotgun blasts throw the torso and limbs, and head hits apply localized torque. Physics reads the map in a private 60 Hz world, with eight active ragdolls and twelve active detached limbs. Older or settled records leave the solver. Wrecks remain for 180 seconds after settling, then sink and fade for two seconds. Rig, body, constraint, and limb pools reclaim resources. Core code and authored scene files are unchanged; existing PBR maps are reused.

- [Shotgun midair](shotgun-midair.png): actual core shotgun pellets kill the fixture, captured after 16 subsequent fixed ticks. Spectator camera, HUD hidden.
- [Stair wrecks](stairs-settled.png): three dead units and detached limbs after 14 simulated seconds, supported by the actual tread heights and stairwell opening.

Both images are 1920 by 1080, captured in headless Chrome without desktop interaction.

| Measurement on Apple M3 Max, Chrome 152, ANGLE Metal | Result |
| --- | --- |
| Eight awake ragdolls, 480 fixed view frames, solver plus bone synchronization | Mean 0.744 ms; p95 1.00 ms; max 1.80 ms |
| Ragdoll construction, 32 full rigs | Mean 0.116 ms |
| 24 living enemies, native 1080p, High, all effects, 10 seconds | 60.002 fps; mean interval 16.666 ms; p95 17.4 ms |
| Same 24-enemy run, CPU frame work | Mean 8.185 ms; p95 9.8 ms |

The 24-enemy frame run and eight-ragdoll microbenchmark are separate measurements. The latter does not guarantee a strict 1 ms ceiling: its tail exceeds that target. The frame run includes rain, smoke, both hazards, motion blur, shadows, bloom, SSAO, and repeated combat effects.

`npm test`: 107 passed. `npx kite3d check`: Playable, Editable, Persisted passed; Editable includes the engine's `CAMERA_CONTAINMENT_UNVERIFIED` qualifier. Headless proof verifies unchanged core snapshots during physics, retained lifetime, reuse, and zero bodies, constraints, records, and unit roots after Stop. No gameplay console errors occurred. Startup still reports the pre-existing menu environment 404 at `/files/lib/assets/textures/units/studio_small_09_1k.hdr`, originating in `lib/view/menu-scene.js` outside this pass.

KF2 gaps remain: procedural endoskeleton silhouettes and shiny armor still look synthetic. Conservative boxes and cone limits can leave small gaps or awkward folds. Debris does not collide with other debris, so wrecks can overlap. The cap of eight ragdolls freezes the oldest pose even if airborne. Frozen wrecks are not reactivated by later shots. The 14-second settling limit bounds persistent jitter. No new sculpted models, materials, or death audio are included.

Reproduce with `npx kite3d dev --port 4710 --no-open`, then `node tools/verify-ragdoll.mjs`. Run the full frame test with `node tools/benchmark-browser.mjs --port=4710 --seconds=10 --warmup=3`. Neither command publishes.
