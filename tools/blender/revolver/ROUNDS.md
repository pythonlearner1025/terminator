# Revolver visual rounds

## Round 0

Opened: all images in LOOK.md, plus existing turntable-contact-sheet.jpg, first-person.png, and range-contact-sheet.jpg.
These existing images were read from docs/evidence/blender-revolver/.
No baseline IoU exists because the original build lacks matching orthographic renders.

1. Barrel diameter is 36 mm; the side photograph indicates about 17 mm, an excess above 100 percent.
2. Exposed barrel uses 203 mm; the trace gives 160 mm, an excess of 27 percent.
3. Cylinder diameter/length is 1.13; the side target is .817, an excess of 38 percent.
4. Frame lower rail is about 8 px in view 1; target scaled rail varies from 6 to 17 px.
5. Grip is a straight wedge; the reference front contour bends about 24 px across its middle third.
6. Hammer is an angular 4-segment hook; the photo has an S-shaped back and concave throat.
7. Trigger bow appears 28 px wide in view 1; the corresponding frame-scaled photo bow is about 43 px.
8. Front sight appears 6 px high on a 21 px barrel; its ratio matches, but the blade has 90-degree corners.
9. Rear sight uses two raised blocks about 6 px high; the reference has a recessed continuous strap.
10. Cylinder has six deep longitudinal flutes; the photographed body has zero long flutes and six rear scallops.
11. First-person visible grip reaches y 1.0; KF2 frame 04 hides the grip below gun edge y .739.
12. Hands occupy roughly x .697-.90 in the current render; KF2 hands span x .418-.869.
13. Glove color is olive; KF2 leather is near-neutral black, about 0.10 lower normalized green in its midtones.
14. Walnut is orange and flat; the photo has 2-9 px dark pores and curved highlights across the grip swell.
15. Current recoil lacks the reference's large hand crossover; frame 01 support fingers span over 350 px.
16. Reload swings the cylinder sideways; KF2 frame 10 drops the loading lever about 52 degrees.

Round outputs use docs/evidence/blender-revolver/ because this pass already tracks that directory.
Raw intermediate panels and the source .blend remain in .kite3d/revolver-rounds/.
Each metric uses the actual round render, fixed photo masks, barrel-axis alignment, and physical scale.

## Round 1

Opened round-1.png, round-1-overlay.png, round-1-motion.png, and round-1-materials.png.
Also opened raw left.png, first-person.png, and gun-mask.png.
Left IoU: .874932. Top IoU: .850624.
Bounding-box edge errors: .625, 4.074, 1.771, 21.852 percent (left, top, right, bottom).
Build exported 17,022 weapon triangles and failed the 12,000 limit. Hands used 3,412 triangles.

1. Top grip extends about 55 source pixels beyond the photograph; top photograph has perspective foreshortening.
2. Side recoil shield ends about 18 px before the photo shoulder and looks like stacked flat disks.
3. The grip front now curves, but its broad highlight is about 80 px wide versus 25-40 px in the photo.
4. Walnut crop is about 70 percent brighter than the source midtones and lacks dark longitudinal pores.
5. Steel crop has a 55 px diffuse highlight; the photo has two narrow highlights about 10 px each.
6. Brass bow looks flat and brown; the photo has a bright 3-6 px edge around a dark center.
7. Visible gun bottom exceeds the target by 118 px. Both hands must move over the grip.
8. Support sleeve occupies under 8 percent of screen width; the target sleeve and glove span over 40 percent.
9. Gloves remain olive full gloves; the reference has black fingerless leather with visible pale fingers.
10. Reload lever opens about 35 degrees; the side reference opens about 52 degrees.
11. Right index rests above the trigger guard by about 25 mm; the reference curls through the bow.
12. Weapon triangle count exceeds the budget by 5,022; cylinder boolean bevels alone use 7,298 triangles.

## Round 2

Opened round-2.png, round-2-overlay.png, round-2-motion.png, and round-2-materials.png.
Left IoU: .875869. Top IoU: 0.000000.
Bounding-box edge errors: .625, 4.074, 1.042, 17.407 percent.
Top rendering failed alignment: a camera-center sign error displaced the gun by about 248 px.
This failed round is retained. No top success is claimed.
Weapon triangles: 14,836. Hand triangles: 3,892. The weapon budget still failed.

1. Repair the top camera center sign and calibrate its projected barrel scale; the current top overlap is zero.
2. Exposed grip still reaches y 493 rather than 399, a 94 px difference.
3. The gun top sits at y 320 rather than 298, a 22 px difference.
4. Finger segments have roughly 2-4 px joints and disconnected-looking tips; the reference finger contour is continuous.
5. Glove highlights cover about 60 percent of each finger width; the reference leather highlight covers about 20 percent.
6. Walnut lacks the source's 2-9 px pores; the current grain appears wider than 15 px.
7. Brass still lacks a 3-6 px rounded highlight because the bow face is a planar extrusion.
8. The shoulder behind the cylinder is about 18 px too short and visibly faceted into 3 bands.
9. Side mask excludes reflected photo pixels inside the metal; fill only small enclosed highlight holes, preserving real openings.
10. The loading lever now reaches 52 degrees, but reload gun pitch differs by more than 30 degrees from frame 03.
11. Cylinder and frame remain 8,780 triangles together; reduce joined, triangulated geometry to 5,500 triangles.

## Round 3

Opened round-3.png, round-3-overlay.png, round-3-motion.png, and round-3-materials.png.
Left IoU: .886321. Top IoU: .884868.
Bounding-box edge errors: 1.146, .926, .208, 9.259 percent.
The joined meshes now pass the 12,000 triangle budget.
Small enclosed photo highlight holes below 1,000 px are filled. The 2,994 px window and 11,985 px trigger opening stay open.
The top camera now uses 7 degrees of photograph inclination and calibrates the projected 203 mm barrel.

1. The loading-rod region misses 6,961 photo pixels; the separate round rammer is absent.
2. The frame region misses 11,700 pixels, concentrated along the recoil shoulder and grip backstrap.
3. The grip misses 4,619 photo pixels; its upper back curve is 15-25 px too narrow.
4. The top grip is about 18 px too wide on its upper edge and needs a measured lenticular cross section.
5. The steel wear mix covers most flat faces and shifts them brown; target wear follows narrow edges and sparse scratches.
6. Brass has lost its gold hue and rounded highlights; rebuild the bow as a traced curved tube.
7. The gun bottom remains 50 px below the target because small wood patches show between both hands.
8. Finger joints still look like separate blocks, with 2-4 px seams; switch to continuous weighted finger meshes.
9. Sleeve surfaces show no folds larger than 2 px; KF2 has folds about 15-35 px wide.
10. Reload gun pitch is over 30 degrees below the reference; increase the presentation tilt without changing clip timing.

Method changes next: rebuild the repeated hand joint issue as continuous skin, the brass bow as a swept trace,
and the recoil shoulder as a curved volume. These replace parts that remained visibly wrong across three rounds.

## Round 4

Opened round-4.png, round-4-overlay.png, round-4-motion.png, and round-4-materials.png.
Also opened the round-3 gun mask and current baked albedo atlas.
Left IoU: .922666. Top IoU: .886787.
Bounding-box edge errors: 1.146, .926, .208, 3.333 percent.
Triangles: 11,236 weapon and 4,424 hands. The side and framing gates pass.

1. Top cylinder center is 3 px above the photo. The grip center is 19 px above it at source x 1250.
2. The top recoil shoulder is 24 px wider than the reference near x 1050. Keep side height but reduce its lateral radius.
3. The side cylinder opening retains a 7-10 px white border, where the photo gap is about 2-5 px.
4. Steel and walnut still lack the source's sharp 2-9 px wear and grain. The albedo atlas confirms broad flat regions.
5. Curvature wear changes entire steel faces. Replace that failed mask with a bevel-normal edge mask and sparse surface scratches.
6. Brass highlight now exists, but its bow is about 5 px thicker than the photographed lower edge.
7. Continuous fingers removed the detached joints. The left hand still has a narrow vertical finger silhouette instead of a 120 px diagonal crossover.
8. Cloth has geometric folds, but remains too uniform: the crop lacks the reference's roughly 15-35 px mottled folds.
9. Reload first pose is closer to vertical, but the middle pose remains vertical when frame 10 is horizontal, about 65 degrees apart.
10. The recoil shoulder now looks spherical from three quarter. The photo shoulder is a flatter, approximately 2:1 oval.

The top centroid offsets imply about 3 degrees of lateral camera inclination.
Next, reconstruct that camera inclination from the observed cylinder and grip offsets. Do not offset the physical grip asymmetrically.

## Round 5

Opened round-5.png, round-5-overlay.png, round-5-motion.png, and round-5-materials.png.
Left IoU: .920061. Top IoU: .868980.
Bounding-box edge errors: 1.146, .926, .208, 3.333 percent.
Five of seven revolver tests pass. Thumb contact and reload hand reach fail after the geometry changes.

1. Top camera inclination introduces about 6 px of barrel slope; reconstruct an orthonormal camera basis aligned to the barrel.
2. Top grip centroid now falls below its target; separate camera roll from lateral inclination before changing geometry.
3. Walnut now has pores, but they form spots rather than the photo's long 2-9 px streaks.
4. Frame faces remain dark and plain; KF2 has silver engraved faces with visible scrolls about 10-25 px across.
5. The support hand still spans under 90 px; the reference diagonal hand spans roughly 190 px.
6. The middle reload pose rotates to a side view, but the palm leaves the loader by about 170 mm.
7. At Fire .2 s, the thumb misses the hammer by about 25 mm. Move the wrist before solving the thumb chain.
8. Brass lower bow is now within about 3 px thickness, but its surface remains more granular than the photo.
9. Glove mottling is visible, yet the brightest patches remain about 30 percent brighter than KF2's leather.
10. The top recoil shoulder is flatter, but the rear hammer still projects roughly 12 px beyond the reference width.

## Round 6

Opened round-6.png, round-6-overlay.png, round-6-motion.png, and round-6-materials.png.
Also opened first-person.png, gun-mask.png, kf2-04.jpg, kf2-10.jpg, and arsenal-03.jpg.
Left IoU: .919148. Top IoU: .919169.
Bounding-box edge errors: 1.146, .926, 2.083, 16.852 percent.
All seven revolver tests pass. The repaired thumb solver and loader contact pass their distance checks.

1. Exposed grip reaches y 490, 91 px below the target. The raw gun mask confirms real exposed wood, not threshold noise.
2. The left palm ends near x 646. KF2 skin continues across a roughly 65 px wide palm and thumb bridge.
3. Four nearly parallel fingers span about 100 px. KF2 shows a curled support hand with mainly two visible finger contours.
4. Frame faces lack the 10-25 px scrollwork seen in KF2. Build an original engraved silver material with a baked stencil.
5. Walnut still lacks visible 2-9 px vertical grain. Replace generated coordinates with physical object-space grain.
6. Reload middle pose points left; the KF2 single-hand pose points right, about 150 degrees apart in screen direction.
7. The top grip contour differs by about 8 px at its widest lower shoulder. Its overall IoU now passes.
8. Side cylinder and loading rod leave narrow red strips about 2-5 px wide. Increase the measured rammer radius by .3 mm.
9. Cloth remains smooth grey despite the dark albedo. Reduce specular response and add explicit seam strips.
10. The left glove covers the whole palm. KF2 exposes skin for about 65 px before the thumb tip.

Method change: replace the repeated flat metal appearance with an original image stencil and physical-coordinate material maps.
Rebuild the support palm from the measured screen contour, because finger-only placement did not reproduce the hand silhouette.

## Round 7

Opened round-7.png, round-7-overlay.png, round-7-motion.png, and round-7-materials.png.
Left IoU: .921073. Top IoU: .919169.
Bounding-box edge errors: 1.146, .926, .312, 2.037 percent.
All three image gates pass. All seven revolver tests pass.
The visual difference gate does not pass.

1. The support palm ends in a straight roughly 60 px edge. KF2 shows a rounded thumb web and metacarpal contour.
2. Skin and glove meet along one straight ring. The reference glove edge varies by about 10 px around the hand.
3. The engraved frame has 5-10 px hammered-looking noise. KF2 silver has finer noise under 3 px.
4. The original cylinder ornament is dark on dark steel. KF2 uses visibly lighter lines, about 2-3 px wide.
5. Grain remains weak in the enlarged walnut crop, under roughly 5 percent contrast versus about 20 percent in the photo.
6. The middle reload now points right, but its muzzle leaves the 960 px frame. The target muzzle is at x 819.
7. The right palm is about 15 px too broad and lacks 2-4 px seam ridges.
8. The support sleeve begins about 70 px too far right, reducing its lower-frame coverage.
9. The rear shoulder is bright silver with simple curves; KF2 has a 15-25 px engraved scroll on its visible rear face.
10. Cylinder machining highlights are still broad, about 25 px versus the photograph's 8-15 px bands.

Method change: remesh the joined palm and fingers, then transfer skin weights and material regions from the original surfaces.
This replaces visible intersections and planar palm caps that persisted across three rounds.

## Round 8

Opened round-8.png, round-8-overlay.png, round-8-motion.png, and round-8-materials.png.
Left IoU: .921073. Top IoU: .919169.
Bounding-box edge errors: 1.146, .926, .312, 2.037 percent.
CPU baking and headless Metal rendering produce the same silhouette metrics.

1. Reload translation used the wrong local-axis sign. Most of the gun now leaves the right edge at the middle pose.
2. The support thumb web is smoother, but the palm still has an approximately 60 px rectangular material boundary.
3. The walnut crop still has spotted grain with over 5 px blobs. Replace the noise-based grain with a directional image stencil.
4. Frame noise is finer, but the visible rear shoulder lacks KF2's approximately 20 px engraved pattern.
5. The glove crop is about 20 percent lighter than its KF2 comparison and has no 2-4 px stitching.
6. The cylinder motif now reads clearly, but has only one central medallion. KF2 ornament spans about 75 percent of its side.
7. The first-person muzzle remains about 10 px narrower than KF2 despite passing bounding-box gates.
8. The remeshed right palm shows faceted patches about 15 px wide. Inspect and repair skin-weight transfer.

The package also exports a neutral bone. Replace the transfer operator with explicit normalized weights.

Method change: build a real 2048-pixel directional walnut source, because repeated shader-noise adjustments did not match the grain.
Keep the profile camera and projection fixed while refining materials and animation.

## Round 9

Opened round-9.png, round-9-overlay.png, round-9-motion.png, and round-9-materials.png.
Left IoU: .921073. Top IoU: .919169.
Bounding-box edge errors: 1.146, .926, .312, 2.037 percent.
All seven revolver tests pass. Metal baking completes headlessly. Integration files remain unchanged.

1. Walnut now has strong vertical grain, but stripe spacing is nearly constant at about 10 px. The photo varies from 2-9 px.
2. Steel has almost no scratches across its broad faces. The photo shows 2-6 px scratches and worn contour edges.
3. The silver frame has only isolated scrolls. KF2 ornament covers roughly 60 percent of the visible frame.
4. The glove still lacks 2-4 px seam ridges, while KF2 has a defined border around its dorsal panel.
5. The left glove boundary remains about 60 px straight. Rebuild its material boundary from the measured screen contour.
6. Reload middle pose is back in frame, but its barrel slopes about 14 degrees upward rather than 4 degrees downward.
7. Reload first pose shows a fully visible muzzle at y 110; the reference muzzle is clipped above y 0.
8. The first-person barrel width remains about 10 px below KF2. This is a projection and stylization difference, not a silhouette-gate failure.

Next, add measured seam paths and contour wear. Use irregular directional grain instead of uniformly spaced stripes.

A follow-up weight audit found 28 unweighted Frame vertices at the rear sight cut. They receive explicit Frame weights next.

## Round 10

Opened round-10.png, round-10-overlay.png, round-10-motion.png, and round-10-materials.png.
Left IoU: .921073. Top IoU: .919169.
Bounding-box edge errors: 1.146, .926, .312, 2.037 percent.

1. The glove edge now follows the contour but has triangular teeth about 10 px deep. KF2 edge irregularity is about 2 px.
2. The cylinder medallion reads as six overlapping ellipses. KF2 uses branching scrolls across about 75 percent of the side.
3. Walnut grain is less regular, but pores still lack the photo's 2-9 px width variation and sharp contrast.
4. Brass remains darker than the source by roughly 20 percent in the enlarged lower-bow crop.
5. Cylinder highlights form broad blobs about 25 px tall. The photo has narrow axial bands about 8-15 px tall.
6. The right glove seam forms a small approximately 25 px polygon; the reference border follows the larger dorsal hand contour.
7. Reload middle pose still slopes upward by about 12 degrees. The reference slopes downward by about 4 degrees.
8. The early reload muzzle remains about 110 px below the frame edge. The target clips it above the frame.

Method change: replace triangle-based glove material boundaries with a continuous baked shader mask.
Replace the repeated cylinder ellipses with original branching scrollwork and use narrow studio lights for the material comparison.

## Round 11

Opened round-11.png, round-11-overlay.png, round-11-motion.png, and round-11-materials.png.
Left IoU: .921073. Top IoU: .919169.
Bounding-box edge errors: 1.146, .926, .312, 2.037 percent.

1. The new glove shader failed: the entire support hand is white. Its two source colors came from different node trees.
2. The first-person gun remains about 12 percent narrower than KF2. Adjust the exported viewmodel field of view and placement together.
3. The early reload muzzle is still roughly 60 px below the frame edge. A closer presentation should also improve this framing.
4. Cylinder scrolls now span most of its side, but contain repeated 20 px loops instead of varied leaf forms.
5. Walnut pores are still softer than the photo by roughly 3-5 px in the enlarged crop.
6. Brass is smoother, but its highlight is still about 20 percent dimmer than the photo.
7. The middle reload barrel remains about 12 degrees upward, against the reference's 4 degrees downward.
8. The support palm contour remains roughly 20 px narrower than KF2 near the thumb base.

Fix the failed shader with source colors built inside one node tree. Preserve the failed white-hand round as evidence.
The runtime reads viewModel.fov, so the next projection change will apply to both the render and the game.

## Round 12

Opened round-12.png, round-12-overlay.png, round-12-motion.png, and round-12-materials.png.
Left IoU: .921073. Top IoU: .919169.
Bounding-box edge errors: 1.250, 1.296, .729, .556 percent.
The fixed glove shader restores skin and leather. The exported 44-degree view now matches the render.

1. The left palm retains an approximately 60 px planar end. Its geometry must follow the photographed outer contour.
2. The right palm still shows broad facets about 15 px across. Smooth the source palm before its volume rebuild.
3. Fire recovery hides most of the gun behind the support hand, instead of leaving the reference's roughly 100 px gun height visible.
4. Reload middle pose still slopes upward by about 12 degrees. Rotation about the barrel axis did not change that slope.
5. The early reload muzzle now clips above the frame, matching that reference feature within roughly 5 px.
6. The engraved rear shoulder remains simpler than KF2, with about two visible scrolls instead of its denser 20 px design.
7. Walnut pores remain about 3-5 px softer than the enlarged source.
8. The first-person barrel is still roughly 6-8 px narrower than KF2. The bounding-box gate passes separately.

Method change: replace the repeated tubular palm cap with a lenticular volume built from the visible KF2 palm contour.
Change reload pitch, since barrel-axis roll did not resolve the measured barrel slope across three rounds.

## Round 13

Opened round-13.png, round-13-overlay.png, round-13-motion.png, and round-13-materials.png.
Also opened the raw round-13 gun-mask.png.
Left IoU: .921073. Top IoU: .919169.
Bounding-box edge errors: 1.250, 1.296, 3.646, 19.630 percent.
Triangles: 11,236 weapon and 7,332 hands. The unwanted neutral bone is gone.

1. The smoothed right palm shrank by roughly 20 percent. The mask confirms exposed grip reaches y 505, 106 px below target.
2. The traced left palm removes the planar cap, but its wrist join has a dent roughly 10 px deep.
3. The left cuff center is about 15 px above the new palm's wrist center. Align those volumes before smoothing again.
4. The middle reload sleeve dominates more than 40 percent of the lower image. The reference keeps a bent wrist and visible fingers.
5. The sleeves rotate and translate with the hands, producing exposed ends in some poses. Anchor elbows outside the frame and blend wrist weights.
6. Fire recovery now leaves the gun visible, but its support fingers sit about 15 px lower than KF2.
7. Reload barrel slope is now about 2 degrees upward, within roughly 6 degrees of the reference.
8. Brass, walnut pores, and the rear engraving remain visibly simpler; their enlarged detail differs by more than 5 percent.

Final planned round: restore right palm volume, align the traced wrist, and anchor both forearms with blended skin weights.
The cap remains fourteen rounds. Any remaining visual errors will be reported without claiming KF2 quality.

## Round 14

Opened round-14.png, round-14-overlay.png, round-14-motion.png, and round-14-materials.png.
Left IoU: .921073. Top IoU: .919169.
Bounding-box edge errors: 1.250, 1.296, 3.646, 19.630 percent.
All seven revolver tests pass.

1. A visible grip-heel strip still reaches y 505 instead of 399. The bottom-edge error remains 19.630 percent.
2. Rest hand contours differ from KF2 by roughly 15-25 px around the wrist and support palm.
3. The anchored forearm crosses the middle reload view and obscures more than 30 percent of the gun-and-hand presentation.
4. Walnut pores remain roughly 3-5 px softer than the photographed crop.
5. Brass highlights remain about 20 percent dimmer than the studio reference under the matched light setup.
6. Rear-frame engraving remains simpler than KF2's dense approximately 20 px scroll pattern.
7. The first-person barrel remains roughly 6-8 px narrower than KF2 despite the improved 44-degree projection.
8. The middle reload barrel now points about 4 degrees downward, close to its reference angle; the hand choreography still differs substantially.

Cap reached: fourteen rounds, with every sheet and overlay opened.
Both silhouette gates pass. The framing gate and the visual-difference gate fail.
Round 12 had the best framing result at 1.296 percent maximum edge error. Later palm changes regressed grip coverage.
The final package is round 14. It is not KF2 quality and is not a shippable art result.
No extra visual rounds will be hidden or relabeled. Remaining work is validation, deterministic rebuild, range evidence, and commit.


## Export validation after the cap

No further shape, material design, or pose changes followed round 14.
Metal baking changed 14 texture pixels by one channel value between identical inputs.
CPU baking removed that drift, but Blender's UV packer still changed subpixel UV coordinates and vertex ordering.
The final UV layout now lives in uv-layout.json as explicit source data with per-mesh topology hashes.
Builds reject a stale layout. Each full build still constructs geometry, bakes all maps, and exports all clips.
Two consecutive full CPU builds then produced identical hashes for all seven registered package files.
Opened the final raw first-person.png after those builds. The recorded hand and framing defects remain visible.


## Final runtime evidence

Opened range-rest.png, range-fire.png, range-reload.png, and range-aim.png at 1920 by 1080.
Fire is captured at 0.0667 seconds with the range clock at 0.25x and a bullet in flight.
The script consumed three real core shots, one reload, and AimIdle with no console errors.
The runtime images retain large palms, finger seams, and angular sleeves. Reload exposes skin cracks of roughly 5-15 px.
The legacy grip-contact test also finds RightThumbTip 40.59 mm from the grip, above its 10 mm limit.
The full suite reports 272 passes and one failure across 273 tests. The dedicated revolver suite passes all seven tests.
No test, contact marker, gameplay code, or integration file was changed to conceal that failure.
Playable, Editable, and Persisted pass in a headless copy within this worktree on private port 4312.
The owner server on 4310 remained running. This capped pass does not meet the full success criteria.


Opened range-performance-24.png after the final benchmark. The image shows the enemy formation and active projectile effects.
All 24 unit meshes reached the main camera during measurement. Frame mean: 29.312 ms; p95: 32.900 ms.
GPU mean: 7.217 ms. The range fixture maintained 24 living enemies and reached 131 active core projectiles.
Earlier timing was invalid because inherited lab preview bind offsets hid unit meshes.
The benchmark resets those offsets only in its temporary page. Project integration remains unchanged.
The benchmark uses stationary aim-and-fire callbacks, high quality, SSAO, bloom, motion blur, and the range's available effects.
It does not measure Bunker 7, ragdoll deaths, or unrestricted combat AI. The 60 fps goal is not met.

## Pass 3, Round 15

Opened round-15.png, round-15-materials.png, round-15-motion.png, and round-15-overlay.png.
Each sheet includes its reference views. Opened pass3-samples.png and the source hand grid before this build.
Both grip-contact and recocking tests pass. All 31 focused tests pass.

1. Frame Delta E76 is 14.47. Its opened crop lacks the photo's bright lower contour and mottled patches.
2. Barrel Delta E76 is 10.19. Its crop has a flat dark center, unlike the reference's fine longitudinal wear.
3. Cylinder Delta E76 is 10.30. Two scroll bands cover about 60 percent of the opened side crop.
4. Brass Delta E76 is 9.37. Its lower edge lacks the reference's narrow bright highlight.
5. Walnut Delta E76 is 6.74, but pores are absent from the opened crop. Color alone does not pass visual quality.
6. Both hands are absent from the rest crop. The exposed grip reaches y 520 instead of reference y 399.
7. Middle reload clips the right edge. The visible barrel extends beyond x 960 in its raw 960-pixel presentation.
8. The first-person muzzle sits near y 289, compared with the reference near y 315. Correct framing after hand visibility.

Next: fix imported hand evaluation, preserve fine grain frequencies through UV baking, add contour wear, and center the middle reload.

## Pass 3, Round 16

Opened round-16.png, round-16-materials.png, round-16-motion.png, and round-16-overlay.png beside their embedded references.
All 31 focused tests pass, including both contact assertions.

1. Material Delta E76 values are frame 4.87, barrel 2.19, cylinder 5.45, brass 3.68, and walnut 6.86.
2. Color means pass, but frame lightness spread is 5.19 versus 16.20. The opened frame lacks distinct case-color islands.
3. Walnut lightness spread is 11.63 versus 10.83. Its opened pores remain broad bands, about 25 px versus 2-9 px.
4. Hands now render, but their palms point almost vertically. The reference support hand crosses at about 35 degrees.
5. Visible grip reaches y 540 versus 399. Palm placement still exposes the heel.
6. The middle reload muzzle ends near x 870 in the 960-pixel view. It is inside frame now.
7. The middle reload forearm obscures about 35 percent of the presentation. The reference leaves the grip and fingers visible.
8. Brass remains visually flat despite a 3.68 mean color difference. Its lightness spread is 13.60 versus 23.17.

Next: orient the anatomical palms across the grip, reduce sleeve obstruction, and restore small material detail at useful atlas density.

## Pass 3, Round 17

Opened round-17.png, round-17-materials.png, round-17-motion.png, and round-17-overlay.png with their reference panels.
All 31 focused tests pass. The color gate passes independently of the visual defects below.

1. Material Delta E76 values are frame 6.41, barrel 2.11, cylinder 5.56, brass 3.50, and walnut 5.31.
2. Frame lightness spread rose to 8.78, but the reference is 16.20. The added horizontal wear line remains softer.
3. Walnut now shows grain, but its opened streaks are about 15-25 px wide versus 2-9 px in the photo.
4. The support palm forms a stretched wedge roughly 150 px long in the enlarged hand crop. KF2 has a rounded thumb base.
5. Bare wrists extend beyond the hand crop's lower edge. Reference fabric starts about 80 px earlier in that enlarged crop.
6. Grip exposure still reaches y 540 versus 399. A passing marker test does not establish correct visible hand contact.
7. The middle reload sleeve now covers roughly 45 percent of the presentation. The elbow displacement made occlusion worse.
8. Cylinder engraving spans two bands about 100 source pixels apart. Its repeated loops still differ from KF2's branching ornament.

Next: fit an orthogonal palm basis, cover the source forearm with fitted cuffs, and drive elbows below the reload wrist.

## Pass 3, Round 18

Opened round-18.png, round-18-materials.png, round-18-motion.png, and round-18-overlay.png beside their embedded references.
All 31 focused tests pass. Four required rounds are complete; quality still fails, so iteration continues.

1. Material Delta E76 values are frame 6.41, barrel 2.11, cylinder 5.56, brass 3.51, and walnut 5.49.
2. The enlarged hand crop has sharp dorsal folds about 20 px deep. The KF2 skin contour has no comparable folded sheets.
3. Skin protrudes through both cuffs in patches about 40 px across. Crop the source forearm and fit its cuff opening.
4. The middle reload arm enters from the top edge, with more than 200 px of visible vertical sleeve in its panel.
5. Grip exposure remains y 540 versus 399. The hand mesh and fingertip marker tests still measure different problems.
6. Walnut grain has narrow lines but a large chevron about 120 px wide. The reference has irregular long pores instead.
7. Frame chroma is too blue: rendered b is -9.79 versus -6.18. Warm the case colors without increasing the steel brightness.
8. The barrel's enlarged highlight remains one broad continuous band. The reference band varies across roughly 2-6 px scratches.

Next: replace discontinuous per-finger position mapping with a continuous cage deformation of the same CC0 scan.
Retain the named rig and contact points. Solve reload elbow positions in camera coordinates.

## Pass 3, Round 19

Opened round-19.png, round-19-materials.png, round-19-motion.png, and round-19-overlay.png beside their reference panels.
All 31 focused tests pass.

1. Material Delta E76 values are frame 5.64, barrel 2.11, cylinder 5.55, brass 3.50, and walnut 5.55.
2. The wrist holes are gone from the rest crop. The prior roughly 40 px skin patches no longer cross the cuffs.
3. The palms are continuous but lack visible finger separation across roughly 100 px of the enlarged grip area.
4. The support thumb points almost vertically, about 50 degrees from the reference's diagonal crossing direction.
5. Middle reload now enters from the lower left, but its sleeve overlaps the hand across roughly 50 px of the panel.
6. The visible grip still reaches y 540 versus 399. Correct source joint depth before increasing palm volume.
7. Walnut has removed the large chevron, but broad dark streaks remain about 20 px wide in the enlarged crop.
8. The frame's color cast is closer: b is -7.13 versus -6.18. Its wear contrast remains below the photo.

Next: place cage controls at the scan's actual joint depths and adjust first-person projection without scaling the gun.

## Pass 3, Round 20

Opened round-20.png, round-20-materials.png, round-20-motion.png, and round-20-overlay.png beside their reference panels.
Opened the CC0 walnut diffuse and cc0-walnut-crops.jpg before selecting that source.
All 31 focused tests pass.

1. Material Delta E76 values remain frame 5.64, barrel 2.11, cylinder 5.55, brass 3.50, and walnut 5.55.
2. The muzzle now starts at x 606, y 305, within 4 and 7 px of the reference gun box origin.
3. The rear frame sits about 50 px below the corresponding KF2 rear frame. Remove the excessive upward barrel pitch.
4. The visible hands mostly fall below y 500. KF2 exposed skin starts near y 380.
5. The middle reload gun now fits inside the panel, but the wrist sleeve overlaps roughly 30 px of the upper hand.
6. The palm mesh remains too smooth and compressed. Its visible finger contours are fewer than KF2's four separated finger tips.
7. The opened CC0 walnut has irregular 2-5 px pores at native resolution, substantially finer than the current broad bands.
8. Grip exposure still reaches y 540 versus 399. The closer framing alone does not fix hand placement.

Next: use rigid phalanx transforms with preserved scan segment lengths, add the CC0 walnut maps, and correct the hip pitch.

## Pass 3, Round 21

Opened round-21.png, round-21-materials.png, round-21-motion.png, and round-21-overlay.png beside their reference panels.
All 31 focused tests pass. The material gate fails after introducing the real walnut scan.

1. Material Delta E76 values are frame 5.64, barrel 2.11, cylinder 5.55, brass 3.42, and walnut 11.20.
2. Walnut lightness is 34.18 against 24.60. Its pores remain below about 2 px in the enlarged crop.
3. Four finger tips now separate beside the grip. The enlarged support palm still spans about 150 px versus 100 px.
4. The open cuff exposes a triangular skin patch about 45 px wide in the middle reload panel.
5. Grip exposure still reaches y 540 versus 399. The rear frame now aligns closer, but hands do not cover the grip.
6. The barrel highlight spans roughly 15 px vertically in the enlarged crop, against approximately 30 px of variable photographed wear.
7. The middle reload gun fits inside its panel. The wrist still points up about 60 degrees instead of extending from the side.
8. Silhouette overlap remains 0.921 left and 0.919 top. The remaining defects concern materials and the posed hand package.

Next: darken and enlarge the scanned walnut grain, reduce palm scale, and align sleeve deformation between each cuff and elbow.

## Pass 3, Round 22

Opened round-22.png, round-22-materials.png, round-22-motion.png, and round-22-overlay.png beside their reference panels.
All 31 focused tests pass. The mean material color gate passes again.

1. Material Delta E76 values are frame 5.64, barrel 2.11, cylinder 5.55, brass 3.50, and walnut 4.19.
2. The enlarged walnut crop remains almost smooth. Its photographed pores have approximately 2-9 px widths and stronger contrast.
3. The enlarged palm width is now about 125 px, improved from 150 px. The central grip remains exposed to y 540.
4. The source cuff cut is covered. The middle reload sleeve instead forms an elbow-like bend about 90 degrees above the gun.
5. The middle reload sleeve crosses about 150 px of the weapon's panel. This remains unacceptable occlusion.
6. Rest sleeves enter almost horizontally. The KF2 left sleeve rises about 35 degrees from the lower edge.
7. Cylinder ornament remains two repeated loops with roughly 100 source pixels between their center lines.
8. The muzzle origin stays at x 604, y 303. That is within 2 and 5 px of the reference origin.

Next: move the palms behind the grip, keep elbows below the camera, strengthen scanned grain contrast, and reduce bright ornament.

## Pass 3, Round 23

Opened round-23.png, round-23-materials.png, round-23-motion.png, and round-23-overlay.png beside their reference panels.
All 31 focused tests pass. The material gate fails after the walnut contrast remap.

1. Material Delta E76 values are frame 5.64, barrel 2.11, cylinder 6.43, brass 3.41, and walnut 15.53.
2. Walnut lightness reached 36.89 against 24.60. The remap clips grain variation into a nearly constant bright endpoint.
3. Moving the palms behind the grip reduces its visible lower edge from y 540 to 439. The reference ends at 399.
4. The enlarged hands meet centrally, but resemble clasped palms. The reference support thumb crosses diagonally at about 35 degrees.
5. The middle reload sleeve no longer crosses the barrel. Its exposed wrist cut remains about 35 px wide in that panel.
6. The middle reload gun is approximately horizontal, within about 5 degrees of its reference barrel axis.
7. The cuff shows a doubled triangular fold about 40 px deep. Its stretched bone axes need alignment with the actual forearm.
8. The barrel's top-facing surface remains silver. The photographed top has a narrower worn highlight around dark steel.

Next: use a mean-preserving walnut contrast operation, align forearm bone axes, and render the actual Idle pose with deeper framing.
This is the last permitted design iteration. Any remaining failures will be reported explicitly.

## Pass 3, Round 24

Opened round-24.png, round-24-materials.png, round-24-motion.png, and round-24-overlay.png beside their reference panels.
This completes ten design rounds. The mean color gate passes; the visual acceptance gate does not.

1. Material Delta E76 values are frame 5.64, barrel 2.11, cylinder 6.43, brass 3.48, and walnut 4.25.
2. The visible gun box is [603, 301, 694, 419]. Its maximum image-edge error is 3.704 percent.
3. The final visible gun width is 91 px against 120 px. The hand overlap makes that width error 24.2 percent.
4. Walnut grain now reads in the opened crop, but its broad streaks measure about 15-25 px against 2-9 px pores.
5. The central palms still resemble clasped hands. The support thumb lacks the reference's approximately 35-degree crossing line.
6. The enlarged right cuff has a triangular folded panel about 40 px deep and a visible skin gap.
7. The middle reload sleeve crosses the grip region across roughly 70 px. The barrel remains inside the frame and unobstructed.
8. Frame lightness spread is 9.03 versus 16.20. Mean color compliance does not establish equivalent wear or case-hardening detail.
9. The top barrel still shows a broad silver face. The photo keeps dark steel between highlights about 2-6 px wide.
10. The early and late reload barrels remain near vertical, about 80 degrees from the horizontal middle reference pose.

The anatomical source, color measurements, and contact fix are implemented. The posed hands and cuff deformation remain below KF2.
The color gate uses matched arsenal crops. Measurements of pistol-photo-1..3 remain separate because their illumination differs.
The final package keeps original procedural case colors and CC0 walnut. It does not contain photo-derived texture pixels.
No additional design round follows the owner's ten-round cap. Verification rebuilds use these unchanged final inputs.


Final verification: all 273 tests pass, including the grip and recocking contacts.
Two full builds produce byte-identical assets. The repeated round-24 sheets were opened again.
The isolated headless check passes all three outcomes. The five 1920 by 1080 range captures were opened.
Fire captures 0.200 seconds. Reload captures 1.300 seconds. Both use the 0.25x range clock.
The 24-enemy range measures 23.87 ms mean frame interval. Visual acceptance and 60 FPS remain unmet.
