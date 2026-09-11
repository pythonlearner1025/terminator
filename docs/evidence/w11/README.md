# W11 first person weapons

Six procedural weapons with two gloved hands, shared PBR gunmetal and leather,
beveled edge wear, sights, and articulated actions. The plasma receiver, shroud,
vents and cooling fins follow the Endo rifle. No external models or textures.

| Weapon | Detail and motion | Idle | Action | Reload or recovery |
| --- | --- | --- | --- | --- |
| 9mm pistol | Serrated slide, bore, magazine, slide recoil, brass ejection | [Idle](pistol-idle.png) | [Firing](pistol-firing.png) | [Magazine swap](pistol-reload.png) |
| M4 | Rails, receiver controls, bolt, magazine, brass ejection | [Idle](m4-idle.png) | [Firing](m4-firing.png) | [Magazine swap](m4-reload.png) |
| Pump shotgun | Twin tubes, ribbed pump, shell carrier, delayed shell ejection | [Idle](shotgun-idle.png) | [Firing](shotgun-firing.png) | [Shell insertion](shotgun-reload.png) |
| Plasma rifle | Endo-style box receiver, heat sinks, cell, blue muzzle glow | [Idle](plasma-idle.png) | [Firing](plasma-firing.png) | [Cell swap](plasma-reload.png) |
| Combat knife | Ground blade, guard, serrated spine, swing and recovery | [Inspection idle](knife-idle.png) | [Swing](knife-swing.png) | [Recovery](knife-recovery.png) |
| Frag grenade | Segmented body, safety lever, pin ring, pull and throw | [Inspection idle](grenade-idle.png) | [Throw](grenade-throw.png) | [Pin pull](grenade-pull.png) |

[Live Wave 1](live-wave.png) is additional evidence from real keyboard and mouse
input against running enemies. All four firearms fired and entered reload; V
selected the knife action and G selected the grenade action. See
[live-results.json](live-results.json) for observations and cleanup results.

The six-by-three references use the real game renderer and `World.step`, paused
between exact simulation ticks. The harness grants weapon inventory and isolates
weapon operations from wave spawning. Knife and grenade idle shots use temporary
empty inventory entries solely for inspection. In normal play these are quick
actions, not persistent numbered slots. They have no core reload state, so the
third references show recovery and pin pull, not invented reloads.

## Timing and integration

- Reload poses read `world.player.reloadTimer` and the weapon catalog, the same
  authoritative values used by `projectViewModel`: 1.45 / 1.8 / 2.4 / 2.1 seconds.
  Core floating-point countdown completes one tick later than those exact nominal
  durations; presentation waits for that actual completion and does not grant ammo.
- Shot animation and muzzle effects start only on accepted player shot events.
  Live fire gaps were 11 / 6 / 50 / 21 ticks, following the existing 60 Hz core.
- Shotgun insertion counts follow the rounds that core will load. Core currently
  discards partial magazines for every firearm, including the shotgun.
- Knife motion follows the 0.5 second melee cooldown. Grenade motion fits the
  current one-second cooldown. **Core detonates grenades immediately on G.** It
  has no pin-pull, projectile or fuse state. The pull and throw animation is
  cosmetic and cannot move that damage event within the allowed view-only scope.
- Breathing, idle sway, walking, sprinting, switching, action, cases and muzzle
  effects use simulation time, so the existing CameraFeel hit-stop freezes them.
- A separate 54 degree perspective camera supplies the weapon shader projection.
  World FOV settings do not change it. It shares the existing render pass, using
  compressed foreground depth to retain weapon self-occlusion and prevent walls
  from clipping the weapon. It does not cast world shadows or SSAO.
- The pre-render hook reads the final CameraFeel offset after GameManager applies
  it. RuntimeObjectOwner owns every weapon resource; Stop removes the hook and
  runtime root and restores the saved gameplay camera properties.

## Performance

Measured in Chrome on this shared development Mac at a 1151 by 926 canvas:

- Animation plus transforms: **0.014 ms mean**, 0.100 ms p95, 1,000 samples.
- Additional render submission CPU: **0.147 ms mean**, 0.100 ms median.
- Combined average CPU overhead: **0.161 ms**.
- GPU visible-minus-hidden: **-0.119 ms mean**, -0.070 ms median, 32 alternating
  pairs measured using `EXT_disjoint_timer_query_webgl2`. There was no measurable
  average GPU increase in this run. Negative deltas are not claimed as a speedup:
  foreground occlusion and concurrent GPU work affect the comparison.
- The measured M4 idle frame uses six weapon draws and 10,396 triangles. There is
  one shared PBR material, one muzzle material, two shared glove geometries across
  all six rigs, and eight pooled instanced cases. Other detail is merged per joint.

The average is below the requested 0.5 ms budget, but a strict maximum is **not
verified**. Paired p95 noise reached +1.100 ms CPU and +1.204 ms GPU. The benchmark
measures idle M4 rendering; it does not certify every combat frame on every GPU.
Raw measurements and the passing animation assertions are in
[capture-results.json](capture-results.json).

## Verification and remaining shared failure

`node docs/evidence/w11/capture.mjs` produced all 18 references with zero browser
errors and passed dry-fire, reload suppression/completion, fire cadence, shotgun
pump/insertion, CameraFeel kick/hit-stop and independent FOV assertions.

`node docs/evidence/w11/live-and-check.mjs` exercised real inputs in Wave 1. The
harness granted inventory and extra health during combat, then restored health
for the screenshot. Weapon runtime removal, camera restoration and HUD removal
all passed. There were zero live gameplay errors. Editor teardown emitted:

```text
SSAOPlugin: pass/viewer not created yet
```

`npx kite3d check` passed its 12 static rows. Playable, Editable and Persisted all
failed with the exact summary below, from the shared MapPost/SSAO teardown path
outside the weapon-owned files:

```text
Headless check failed: SSAOPlugin: pass/viewer not created yet
```

The sanitized report is [kite3d-check.json](kite3d-check.json). This is not a clean
project-wide check result. No map, unit, core, UI, server or generator source was
changed, and nothing was published.

## Reproduce

Keep `npx kite3d dev --port 4950 --no-open --force` running with its output redirected
to `.kite3d/w11-dev.log`. The drivers read its private session URL without printing
it, so another agent replacing `.kite3d/dev.json` does not redirect the captures.

```sh
PW_TEST_SCREENSHOT_NO_FONTS_READY=1 node docs/evidence/w11/capture.mjs
PW_TEST_SCREENSHOT_NO_FONTS_READY=1 node docs/evidence/w11/live-and-check.mjs
```
