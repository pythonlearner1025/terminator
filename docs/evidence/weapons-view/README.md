# Weapons view evidence

All eight weapons have distinct models, mechanisms, sway, recoil, aim, sprint, and switch poses.
Sniper and launcher use new M14 EBR and M79 models.
GrenadeView keeps the M67 model and now reuses sixteen warmed instances.
No core, unit, map, scene, or dependency files changed.

Study: [sources and frame counts](../../reference/kf2/SOURCES.md), [ten findings per weapon](../../reference/kf2/NOTES.md).
The study contains 112 JPEG frames, totalling less than 2 MB.
Fandom returned HTTP 403. No wiki images were obtained.
References stay in docs and remain excluded from publication.

Three observations changed animation:

- Rifle reloads lift and roll the receiver, so the sniper exposes its magazine and action.
- Reloads seat the magazine before cycling the action, so these stages use separate timer intervals.
- The M79 opens its whole barrel, so the hinge carries the barrel, fore-end, sight, and cartridge.

## Trajectory parameters

Lengths use metres. Speeds use metres per second. Glow measures full ribbon width.

| Type | Speed | Core width | Glow width | Trail length | Color |
| --- | ---: | ---: | ---: | ---: | --- |
| Pistol | 150 | .025 | .24 | 1.6 | White-orange |
| M4 | 150 | .038 | .34 | 2.4 | Orange |
| Shotgun, nine pellets | 150 | .027 | .25 | .85 | Orange |
| Plasma hitscan | 150 | .12 | .62 | 2.8 | Blue |
| Sniper | 150 | .03 | .30 | 5.5 | White |
| Enemy round | Core: 30 | .10 | .65 | 1.9 | Orange |
| Bolt | Core: 18 | .22 | 1.05 | 3.4 | Enemy magenta, player blue |
| Shell | Core: 22 enemy, 32 player | .13 | .28 | 2.4 | Dim orange, grey smoke |
| Grenade | Core velocity | .14 body | None | None | PBR olive and steel |

ProjectileView reads actual positions and velocities. It never applies these core speed constants itself.
Shell smoke lasts .65 seconds. Shells spin at 24 radians per second.
Two fixed lights illuminate nearby surfaces from plasma bolts.
Tracer ribbons use 256 slots. Projectile bodies use 192 slots. Smoke uses 192 slots.
Minimum tracer lengths range from 16 to 42 screen pixels at 1080p.
Halo width caps at 120 pixels near the camera. Depth tests remain enabled.
The pool test reuses all buffers and slot objects across 10,000 events.
Legacy shots without endpoints use cosmetic collider rays or unit centres.
Those endpoints cannot reproduce each deterministic spread or penetration result.

## Measured performance

Headless Chrome 152, ANGLE Metal, Apple M3 Max, High, 1920 x 1080, render scale 1.
Each run uses 24 visible enemies, five warmup seconds, and ten measured seconds.
All post effects remain enabled. The owner and other worktrees shared the Mac.
These sequential runs do not isolate system contention.

| Run | CPU mean ms | CPU p99 ms | GPU p99 ms | M4 kill CPU ms | FPS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before, standard | 15.526 | 20.7 | 12.11 | 19.4 | 54.939 |
| After, standard | 14.512 | 20.3 | 13.111 | 18.3 | 57.598 |
| After, eight-weapon burst | 16.02 | 23.2 | 12.909 | 20.4 | 54.532 |

The required CPU p99 limit is 13.3 ms. The burst fails that limit.
The burst kill frame also exceeds the 20 ms limit.
The burst adds all eight weapon events and 52 projectile fixtures, including four grenades.
It updates fixtures alongside normal view synchronization, so its CPU result includes that extra work.
Final burst tracer updates average .008 ms per frame. Projectile updates average .315 ms per frame.
The final burst records no shader compilation and no browser warnings.
A first-use grenade shader spike was fixed with pooled models and material warmup.
The original baseline lacked the new burst harness. Only the standard rows directly match workloads.

Reproduce with the worktree server on port 4672, using `--no-open`.
Run `node tools/benchmark-browser.mjs --port=4672 --warmup=5 --seconds=10`.
Add `--weapon-burst=on` for the expanded stress run.

## Validation and captures

`npm test`: 124 passed, zero failed, including ten new view tests.
`npx kite3d check`: Playable PASS, Editable PASS, Persisted PASS, in headless mode.
Editable includes CAMERA_CONTAINMENT_UNVERIFIED for Map preview ground.
The native check ran after the development server stopped.
`capture.mjs` passes 68 assertions, including scope FOV, mapped geometry, state immutability, and cleanup.
Its browser error list is empty.

- [01-m4-tracers.png](01-m4-tracers.png): Five travelling M4 shots during a scripted sweep.
- [02-incoming-bolts.png](02-incoming-bolts.png): Six magenta bolts and three rounds approach from roughly twenty metres.
- [03-sniper-reload.png](03-sniper-reload.png): M14 reload at 62 percent, during magazine seating.

These are isolated visual fixtures with 24 enemies. No gameplay result is claimed from injected events.
C1 weapon data and simulated enemy fire are absent from this branch.
Capture and burst scripts supply their contract data locally. Full gameplay integration still requires the C1 merge.
No weapons placeholder file existed here. The orchestrator must retain these models when merging C1 aliases.

## Remaining quality gaps

The result remains below KF2 quality. It is not ready to ship at the requested bar.
Procedural receivers and gloves lack authored anatomical deformation and individually baked edge wear.
Atlas reuse still repeats details across large surfaces. Existing environment and enemy art also limit the screenshots.
The revolver has six visible chambers. Core ammunition remains fifteen rounds, as required by the gameplay constraint.
Grenade simulation releases immediately. Its visual recovery therefore cannot show a full preparation before release.
The CPU budget and merged C1 gameplay verification remain unfinished.
