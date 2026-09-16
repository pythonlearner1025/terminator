# HD swing-out revolver review

This is a separate lab variant. The original candidate and shipped 1858 remain unchanged.
Review uses headless Blender 5.2.1 and headless Chromium Vulkan on the RTX 3090 Ti.

## Reference observations

Downloaded with yt-dlp. Cut with ffmpeg. Opened the frames before animation work.
The reproduction command is `python3 tools/blender/swingout/reference.py`.
Videos stay in the ignored cache. Reference frames are observation material, never CC0 game textures.

- Chris Baker / Lucky Gunner: https://www.youtube.com/watch?v=sPbTWGEPi2o
- Nathan Greenfield / ItsALiving: https://www.youtube.com/watch?v=dk5QmG1CDf0

The real clip is 24000/1001 fps. Measurements have at least one frame of uncertainty: 41.7 ms.
The overview was sampled at 100.1 ms intervals. Do not claim subframe mechanical measurements.

| Observation | Real footage timestamps | Approximate interval | Shipped clip |
|---|---|---|---|
| Leave firing posture, release, open | 37.9–38.3 s | 0.4 s | 0–0.58 s |
| Hand reaches rod; eject | 38.3–38.6 s | 0.3 s | 0.59–0.94 s |
| Lower, fetch loader, align and insert | 38.6–40.7 s | 2.1 s | 1.04–1.82 s |
| Close and reacquire | 40.7–41.2 s | 0.5 s | 2.16–2.60 s |
| Complete reload | 37.9–41.2 s | 3.3 s | 2.6 s |
| FPS study reload | 8.0–11.1 s | 3.1 s | 2.6 s |

The footage does not resolve hammer travel or flash duration accurately.
The 35 ms take-up, 15 ms hammer fall, 18 ms flash, and 0.4 s recovery are authored estimates.
The game has a fixed 2.6-second reload. The clip compresses the ammunition retrieval interval.

## Round 1

Opened Idle, open mechanism, swing, and insertion PNGs.
26,806 triangles. 28 draws. Three 2048 maps.
The two sleeves crossed almost the full 960-pixel image width.
Insertion hid behind both arms. Left hand floated roughly 30 mm behind the loader.
The extractor arms had the wrong radial orientation.

## Round 2

Opened Idle, ejection, insertion, closure, and open mechanism PNGs.
24,906 triangles. Three draws. Three maps.
Reduced draws by skinning the separated mechanism in one primitive.
Forearms still pinched at the cuff. Sleeve scale tracks were missing.
The loading side faced away from the camera. Hidden bullets entered the image behind the grip.

## Round 3

Opened Idle, ejection, insertion, closure, and Inspect PNGs.
Loading now faces the camera. Six holes and the star are visible.
The loader remained approximately 30 mm outside the left grip.
Added contact solves, then replaced the inherited sleeve mesh.

## Round 4

Opened the complete contact sheet and four full-resolution contact views.
24,738 triangles. Three draws. Three maps. 75 joints.
Sleeves no longer tear. The loader knob penetrated the left palm by several millimetres.
Browser captures exposed depth quantization in the narrow viewmodel depth interval.
Gas jets were about three times too broad. Ten asset tests and 17 existing tests passed.

## Round 5

Opened the loader approach and seat images, plus live ready, strike, smoke, and reload captures.
The left hand now pinches the loader handle. The depth interval has 100 times more precision.
Live Fire produced muzzle light and two narrow gap jets. Smoke remained too faint at 0.5 seconds.
Six shots emitted zero cases. Reload emitted six cases. Each case bounced five times and stopped.
Right-hand tip proxies measured 7.82, 16.01, and 11.74 mm from nearest geometry.
These distances exceed plausible fingertip padding. Retarget the right grip before final review.

## Round 6

Opened Idle and the 1.8-second loader seat at full resolution.
Right thumb, middle, ring, and little-finger probes now sit 4.5 mm from the grip surface.
The right index probe sits 2.93 mm from the trigger assembly.
The left loader tips still approached the metal too closely.
Bone probes do not certify skin clearance or anatomically valid joint motion.

## Round 7

Opened the full contact sheet, aimed view, rod push, and loader seat.
76 joints. The loader button now has a separate three-millimetre stroke.
The left fingers meet the cylinder before the crane moves.
Aimed previews use the shipped camera transform, including the -1.01-degree pitch adjustment.
The ejector thumb probe measured only 0.04 mm from metal.
The loader thumb and index probes measured less than 0.5 mm from metal.
Those clearances cannot contain the complete fingertip mesh.

## Round 8

Opened all nine clips in the contact sheet. Opened ejection, seating, Inspect, and Sprint individually.
Reduced the Inspect turn from 64.2 to 50.4 degrees. The entire barrel now stays inside the reviewed frame.
Sprint now lowers and rolls the gun, with a continuous 0.8-second loop.
Loader thumb, index, and middle probes measure 4.5, 5.48, and 5.06 mm from metal.
The ejection thumb and one loading little-finger pose still have insufficient skin clearance.
The inherited hand topology pinches at strongly bent joints. This remains visible at quarter speed.

## Round 9: game effects and integration

Opened the actual quarter-speed Fire and Reload contact sheets beside the downloaded reference sheets.
Opened live Idle, AimIdle, recoil, muzzle flash, smoke, extraction, insertion, and ground-case captures.
The flash illuminates the hands, gun, firing table, and nearby prop.
The muzzle flame and two gap jets last one 60-Hz simulation frame in the captured firing sequence.
Six shots emit zero cases. Reload emits six cases with six distinct paths.
The capture records 30 impacts and 30 synthesized impact sounds. The audio context reports no failures.
I verified playback calls. I did not perform a listening assessment.

The first ground review failed. Cases settled below the 29.5-mm firing mat.
The final effect traces the predicted landing surface once for each case.
All six cases now settle at center height 35 mm, on that mat.
The final ground image shows open black mouths, metal highlights, and six separate resting directions.
Corrected the procedural case face winding after inspecting the black, reversed surfaces.

Removed the Fire crossfade that left the cylinder between chambers at hammer impact.
Reload completion now exchanges coincident seated cartridges without blending them through the gun.
Added tests for all six chamber indexes and this completion boundary.
Fixed a lighting callback leak during variant swaps.
The earlier same-page performance runs showed 6.38 ms of CPU drift between baseline runs.
Those runs remain in `rounds/performance/same-page-before-fix.json` and are not the final comparison.

## Mechanical layout

Coordinates use metres. +Z follows the bore. +Y points up. X crosses the frame.

| Part | Support and motion |
| --- | --- |
| Crane | Z journal at (0, 0.043, 0.148); swings 84.8 degrees |
| Cylinder | Child of Crane; Z axis at (0, 0.07742234, 0.10964); indexes 60 degrees |
| Ejector | Child of Cylinder; translates 42 mm along -Z |
| Extractor star | Rigid with the ejector; six arms support the six rims |
| Hammer | X pin at (0, 0.057, 0.061); cocks 35.5 degrees, then falls |
| Trigger | X pin at (0, 0.046, 0.083); rotates 15.5 degrees |
| Latch | Slides 3 mm along +Z in the existing frame slot |
| Loader | Left-hand prop; approaches the open cylinder along its chamber axes |
| Loader button | Child of Loader; translates 3 mm along +Z |
| Cases | Follow the extractor for 42 mm; release onto independent ballistic paths |
| Hands | Wrist and individual finger joints carry contact poses and recoil |

The source supplies the six chamber walls. Added cartridges occupy the holes with 0.65-mm radial clearance.
A cartridge clears its chamber before its independent ejection motion starts.
The new crane, axle sleeve, journal, and bearing connect the rotating cylinder to the frame.
Pin placement follows source geometry. It has not been checked against a manufacturer's dimensional drawing.

## Clip review

| Clip | Seconds | Appearance in the opened frames |
| --- | --- | --- |
| Idle | 2.0, loop | Small breathing motion; both hands retain the grip |
| Draw | 0.65 | Rises from below the camera, then settles |
| Fire | 0.40 | Take-up, hammer fall, sharp lift, overshoot, slower recovery |
| Reload | 2.60 | Latch, cup, swing, rod push, case dump, loader, closure, recovery |
| AimIn | 0.20 | Moves toward the centered sight line |
| AimOut | 0.20 | Returns from the sight line to the hip position |
| AimIdle | 2.0, loop | Centered sights and reduced breathing |
| Sprint | 0.80, loop | Lowered gun, inward roll, repeated restrained motion |
| Inspect | 3.20 | Shows both sides of the barrel, frame, and grip |

## Runtime cost

The asset contains 24,738 triangles, three mesh draws, 76 joints, and three 2048-square maps.
The original 1858 contains 18,588 triangles, 14 mesh draws, and three 2048-square maps.
The new package occupies 9,792,649 bytes, including its generated manifest.
Three RGBA atlases require about 64 MiB with complete mip chains.

Flash uses three 96-triangle solid flame meshes. It adds three draws during the brief flash.
Smoke uses 24 instanced quads and the existing CC0 256-square smoke texture. It adds one draw.
Each shot emits four muzzle puffs and two cylinder-gap puffs.
Puffs move, expand, drift, and thin over 2.6–3.1 seconds.
Cases use one instanced mesh with 24 slots. Each hollow case contains 252 triangles.
Six active cases add 1,512 triangles. All 24 slots add 6,048 triangles.
Effects add at most five draws and no render pass.
Surface detection uses six raycasts per reload. Frame updates use the cached landing heights.
The impact synthesizer has six variants and an eight-voice limit. It downloads no samples.

## Remaining shortfalls

This is a playable, rebuildable lab variant. It does not meet the full requested animation bar.
The strongest remaining defect is hand deformation and contact during rod operation and loader insertion.
The procedural joint solver cannot certify every skin triangle against every moving surface.
The 2.6-second gameplay reload compresses the measured 3.3-second real reload.
A partial reload still uses six spent-looking cases. It does not preserve unfired-round appearance.
Brass collides with the selected landing surface. It does not collide with vertical walls.
The fixed pool replaces its oldest cases after four full reloads.
The skin and sleeves lack the detail and deformation quality of the FPS reference.
Subframe hammer and flash timings are authored estimates, not measurements from the 24-fps footage.

Gameplay starts projectile simulation before the visual hammer strike at 50 ms.
The firing presentation still needs coordination with that gameplay event.

## Final validation and performance

All 289 Node tests pass. Twelve tests cover the new mechanism.
Playable, Editable, and Persisted pass after stopping the modern variant.
The browser proof reports no errors. The stopped scene retains no modern muzzle-effect root or lab selector.

The benchmark uses headless Chromium, Vulkan, and the RTX 3090 Ti at 1920×1080.
Each ABBA run creates a fresh world. Each run warms for seven seconds and measures ten seconds.
All runs submit 24 enemy meshes: eight Scout, eight Endo, and eight Heavy.

| Run | Variant | Mean frame interval, ms | Mean CPU frame, ms | Mean GPU, ms | CPU p95, ms |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | pistol | 26.682 | 25.228 | 0.607 | 28.900 |
| 2 | swingout | 25.931 | 24.477 | 0.589 | 27.400 |
| 3 | swingout | 27.913 | 26.414 | 0.590 | 29.500 |
| 4 | pistol | 28.341 | 26.858 | 0.607 | 29.100 |

pistol: frameIntervalMs 27.511 ms, cpuFrameMs 26.043 ms, gpuFrameMs 0.607 ms.

swingout: frameIntervalMs 26.922 ms, cpuFrameMs 25.445 ms, gpuFrameMs 0.589 ms.

No frame-time regression appeared in this fixture. CPU timing still varies between runs.
This measures stationary firing enemies in the range. It does not measure Bunker 7 navigation.
Opened the baseline and modern 24-enemy captures, including their held Idle poses.

The original pistol, its builder, gameplay defaults, and `lib/core` have no changes.
Rebuild with `npm run build:swingout`. Select F1 → Revolver Build → HD Swing-out Revolver.

## Owner follow-up: builds 10–13

This follow-up does not meet the complete work order.
The hands still fail. The complete reload remains below the requested bar.
The committed source and evidence contain partial repairs, not an accepted final asset.

### Reference review

Reopened the cached real and FPS reference frames before editing.
The real footage shows a large posture change before extraction.
The FPS reference exposes long case bodies below the open cylinder.
Its loader hand leaves a clear view of the carrier and cylinder interface.
The current hands still obscure those interfaces.
The existing 3.3-second real measurement remains an observation, with 41.7 ms frame uncertainty.
The authored reload remains 2.6 seconds.

### Cause and source changes

The old solver fitted tips with unrestricted rotations at every joint.
It ignored skin, palm penetration, and other fingers.
The inherited hand mesh also contained baked finger folds.

Rebuilt hand skin and joints together from the neutral CC0 scan.
Saved that scan in `neutral-hand.blend` for repeatable offline builds.
Saved the editable assembled source in `swingout.blend`.
The finger fitter now uses proximal rotation and two hinge joints.
It checks weighted skin vertices against weapon surfaces and the opposite hand.
A palm correction runs before finger fitting.
These are soft barriers. They do not guarantee collision-free poses.

### Review rounds

| Build | Opened evidence | Remaining defect |
| --- | --- | --- |
| 10 | Studio extraction, seating, and game frames at 1x and 0.25x | The inherited folded mesh still collapses. |
| 11 | Full game films and contact sheets at both speeds | Neutral skin improves the base shape. Palm and loader intersections remain. |
| 12 | Live game recordings at both clock speeds | Palm correction helps the right hand. Left fingers still cross during seating. |
| 13 | Live game recordings, full extraction frames, and skin audit | Opposite-hand barriers reduce some crossings. The full hand bar still fails. |

Build 10 used sparse game stills. Builds 11–13 include full sequence recordings.
Build 11 advances actual gameplay ticks between frames.
Builds 12 and 13 use the normal game update and clock scales.
Final recordings use the corrected visible shot timing with build 13 assets.

### Skin measurements

The audit checks evaluated triangles at 120 Hz.
It includes poses between fitted keys. It does not use bone tips as skin proxies.
The two review instants below are 841.7 ms and 1800 ms.

| Build | Right penetration at 841.7 ms | Left penetration at 841.7 ms | Left penetration at 1800 ms |
| --- | ---: | ---: | ---: |
| 10 | 13.401 mm | 6.723 mm | 7.816 mm |
| 11 | 3.737 mm | 4.563 mm | 6.979 mm |
| 12 | 0.376 mm | 4.171 mm | 5.765 mm |
| 13 | 0.376 mm | 4.329 mm | 4.490 mm |

All 313 Reload audit samples still contain hand/weapon triangle crossings.
The worst reported Reload penetration is 13.681 mm.
At 1800 ms, the two hands still have 252 intersecting triangle pairs.
The audit also reports self-intersections within each hand.
The rigid wrist and finger targets do not produce a valid coupled grasp.
Further soft-barrier tuning did not remove these failures. The hand items remain open.

### Reload appearance at 1x

Opened the full game contact sheet and individual extraction frames.
The observed times below come from the game mixer, not the video frame number.

| Game time | Appearance in the opened frames |
| --- | --- |
| 0–0.317 s | The gun lowers and turns. The left hand rises toward the cylinder. |
| 0.450–0.750 s | The cylinder swings outside the frame. Its rear face becomes visible. |
| 0.867–1.000 s | Extraction exposes long brass bodies. The fingers obscure rod contact. |
| 1.117 s | The cylinder is empty. The free fall remains difficult to see at 1x. |
| 1.267–1.867 s | The loader approaches from the right. Fresh rounds enter the visible cylinder. |
| 2.000–2.417 s | The loader withdraws. The cylinder closes. |
| 2.567–2.600 s | The gun returns to its firing position. |

The cylinder stays fully open for approximately 1.48 seconds.
The rod travels 42 mm. The opening spans 84.8 degrees.
Baked case flight now lasts until 1.18 seconds before world handoff.
The source adds lateral separation to that flight.
These changes expose extraction, but they do not establish readable free fall at 1x.
Rod contact, loader contact, and finger intersections prevent acceptance of the complete reload.

### Ammunition and firing

The game preserves unfired cartridge transforms during partial reloads.
It masks replacement rounds for those chambers.
Only the fired chamber list enters the world brass effect.
Browser checks fired one, three, five, and six rounds.
Each reload emitted the matching count. Firing emitted no cases.

Fire sampling uses 120 Hz. Coarse sampling had moved hammer contact to 66.7 ms during build 11.
The source now places hammer contact at 50 ms and discharge at 58.3 ms.
Visible bullet and impact scheduling include the fractional bullet clock.
That prevents interpolation from advancing the bullet ahead of the fixed-tick hammer.
The final frame check shows no bullet at 50 ms.
It shows the first bullet and muzzle effect at 66.7 ms.
Core hitscan damage still resolves immediately. This change fixes visible presentation order.

### Remaining smaller items

Brass still has no wall collision.
The fixed pool still replaces old cases after four full reloads.
No listening assessment was completed. Audio is not accepted by this review.

### Evidence

- `rounds/final-game/`: final live Fire and Reload recordings at 1x and 0.25x.
- `rounds/13-game/`: opened extraction stills and the build 13 game review.
- `rounds/fire-order-50ms.jpg` and `rounds/fire-order-67ms.jpg`: opened timing frames.
- `rounds/fire-order.json`: exact game mixer and bullet counts.
- `rounds/partial-reloads.json`: four partial/full ammunition checks.
- `rounds/round-13/skin-audit.json`: the failing skin audit, including all samples.

Live screenshot capture is sparse. It does not establish 60 FPS animation quality.
The separate fixed-tick frame check establishes the reported hammer and visible bullet order.

### Final validation

All 294 Node tests pass. Five browser scenarios pass.
Those scenarios cover four ammunition counts and the hammer/visible-bullet order.
All nine clip names and all existing node names remain unchanged.
The package retains three mesh draws, one skin, and three 2048-square maps.
The Blender skin audit fails in all 313 Reload samples.
Passing functional tests does not close the hand or complete reload items.

The final repeat-reload inspection exposed a cached scale-mask fault.
The animation adapter now restores case and replacement-round scales before applying each chamber mask.
A regression test covers partial reload, completion, and the next full reload.
Playable, Editable, and Persisted pass after stopping the selected variant.
