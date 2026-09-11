# W4 enemy art and animation

F8 in Play toggles the three-unit showcase. F9 steps idle, moving, aiming, firing,
hit, spin-up, and dying. The showcase and its lights are removed on exit or Stop.
The simulation keeps running behind the showcase.

Built entirely from procedural geometry: 246 Scout pieces, 282 Endo pieces, and
279 Heavy pieces, merged into one rigidly skinned metal mesh per figure. Models
have 28,164, 28,984, and 30,420 triangles respectively. Runtime instances share
body geometry, PBR steel, reflection texture and roughness map. Eye materials are
per instance for independent damage flashes and extinction. All textures are
generated with canvas; their estimated RGBA memory including mipmaps is 0.604 MiB.

The pelvis owns the spine and both thigh/shin/foot chains. Spine owns chest;
chest owns neck/head/jaw and left/right shoulder/upper-arm/forearm/hand chains.
Endo adds Weapon/Muzzle. Heavy adds Weapon/Barrels/Muzzle. Fingers have three
modeled phalanges and knuckles each, and move with the hand rather than separate
finger animation bones.

Animation uses a 165 ms transition to 95% of its target. Implemented states are
idle eye flicker, speed-driven servo walk with heel lift and level soles, Scout
quadruped sprint and standing melee, aiming, firing with recoil, hit flinch,
Heavy spin-up and barrel rotation, and staggered joint collapse with eye fade.
This is procedural posing with no foot IK and no physics ragdoll. Live unit state
and events remain authoritative in the core.

The FX pool contains 160 sparks, 48 blue-white plasma effects, 48 orange minigun
effects and two brief point lights. Current core unit_damage events omit impact
coordinates. Player shots reconstruct a rendered mesh ray intersection; other
hits fall back to a chest/head joint. Exact pellet and explosion impact locations
would require a point in the core event contract.

## Screenshots

- scout-front.png and scout-three-quarter.png
- endo-front.png and endo-three-quarter.png
- heavy-front.png and heavy-three-quarter.png
- endo-skull.png
- three-units.png
- animation-moving.png, animation-firing.png, animation-dying.png
- 24-units-live.png and headshot-sparks.png
- in-game-20m-dark.png

## Reproduction and scope

The server is `npx kite3d dev --port 4400 --no-open --force`. Its private URL is read
from /tmp/terminator-w4-dev.log by the evidence scripts and is never printed.
Capture: `node docs/evidence/w4/capture.mjs`.
Gameplay checks and frame timing: `node docs/evidence/w4/verify-play.mjs`.
Both scripts prevent editor hot reload during a capture so concurrent file writes
do not tear down the game halfway through a measurement.

PREVIEW_FALLBACK=1 uses browser request routing for four modules from 979a0c0:
lib/core/world.js, lib/core/waves.js, scripts/GameManager.script.js and lib/ui/hud.js.
It leaves files on disk untouched. This was necessary while the shared core's
QuickJS import prevented normal Play. It is an isolated art integration test,
not proof that the entire current working tree passes.

verification.json records the final successful 300-frame run with 24 live enemies,
eight of each type, the current W3 map, and the baseline integration modules.
Apple M3 Max, Chrome ANGLE Metal, 959 x 926 rendered pixels: 16.616 ms mean,
16.800 ms p95, 16.800 ms maximum, 60.18 fps, zero frames over 20 ms.
There were 110 plasma and 417 minigun effects and a tested headshot spark burst.
The unit runtime root was absent after Stop. The shared post-processing teardown
emitted `SSAOPlugin: pass/viewer not created yet` outside the unit files.

## Honest visual assessment

The result reads as a chrome, red-eyed mechanical endoskeleton, with the narrow
spine, exposed pistons, broad shoulders and weapon silhouettes in the written
reference. It is a recognizable procedural approximation, below Killing Floor 2
character fidelity. The face and armor still have obvious primitive construction.
A sculpted skull with anatomical orbital cavities, beveled teeth, more irregular
armor contours, better authored wear and contact-aware animation would get closer.
No reference PNG was present, so comparison was to docs/art-reference.md only.

## Final check result

The final `npx kite3d check` did not pass. All 12 static rows passed.
Playable, Editable and Persisted were blocked before runtime boot by the other
workstream's QuickJS integration, outside W4 ownership:

```text
Failed to resolve module specifier "quickjs-emscripten/dist/chunk-OHAYRCBA". Relative references must start with either "/", "./", or "../".
```

The exact report is frozen in check.json. No lib/core, lib/ui, map, server,
package, or saved scene file was edited by W4. Full current-game integration
and the full-game 60 fps target remain unverified until that import is fixed.

The final isolated browser assertions passed for 24 live units, the Scout's lower
quadruped stance, Heavy barrel rotation, staged collapse and extinguished eyes,
live damage/headshot feedback, both weapon effect types, and runtime-root removal
on Stop. verification-initial.json retains the first timing run for comparison.
