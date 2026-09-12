Scout gait restoration, September 11, 2026.

Restores the forward pelvis fold and low head from e66bac9, adds a paired gallop with spinal flex, and keeps Scouts on four limbs until stationary melee. Four independent world-space hand/foot contacts follow the actual stair treads and dock ramp. Endo and Heavy retain their biped IK. The existing anatomy, PBR textures, optics, and damage systems remain in place. No core or scene files changed.

The performance gate also prevented new Scouts from ever animating: its missing initial timestamp made elapsed time stay at one tick. Scout initialization now starts the existing 30 Hz clock. Pose targets, contact records, limb names, and math scratch objects are allocated at rig binding; the animation loop reuses them. Ground sampling reads the core's surface definitions and height evaluator without allocating support arrays.

Validation: `npm test` passes 94 tests. `npx kite3d check` passes Playable, Editable, and Persisted, with the existing `CAMERA_CONTAINMENT_UNVERIFIED` warning for Map preview ground. Headless motion verification reports no page errors and unchanged core snapshots. Every limb plants on flat ground, stairs through 3.15 m, and the dock ramp through 0.7 m. Planted target error is below 0.001 mm; sampled pad clearance is 7.44 mm. Endo/Heavy foot target errors remain below 6 mm.

Measured on Apple M3 Max, headless Chrome 152 using ANGLE Metal, 1920 x 1080:

| Measurement | Mean | P95 |
| --- | ---: | ---: |
| 24 galloping Scout rigs, one 30 Hz animation update | 1.34 ms | 1.70 ms |
| Full frame interval, 24 mixed enemies, all effects | 17.76 ms | 21.10 ms |
| Full frame CPU work | 15.19 ms | 18.20 ms |

The full-frame run lasted 10 seconds after 3 seconds of warmup, with 562 intervals, high quality, native render scale, rain, smoke, both hazards, two shots per frame, and ten impact bursts per second. Eight Scouts shuttled through short paths. All 24 animation clocks were seeded in that disposable benchmark fixture so stationary Endo/Heavy animation was included. Result: 56.3 fps, below the 60 fps target. The regular Endo/Heavy spawn-clock bug is outside this Scout-only change and remains for the orchestrator.

Reproduce motion, contact, clock, and direct animation cost checks with `node tools/verify-scout.mjs` while port 4680 is running. Full-frame instrumentation comes from `tools/benchmark-browser.mjs`; the measured stress fixture is retained locally at `.kite3d/scout-stress.mjs`.

Two unretouched 1920 x 1080 captures from the existing unit showcase, with fixed camera framing and stage lights:

- [Gallop mid-stride](gallop-mid-stride.png): front support and recovering hind limbs.
- [Melee rise](melee-rise.png): bent knees, raised torso and striking hand.

KF2 gap: the restored motion reads as a quadruped, but the procedural castings, exposed primitive joints, bright chrome response, and simple attack timing still fall short of sculpted production characters and authored animation. This pass restores the Scout rather than claiming the overall AAA quality or frame-rate target is complete.
