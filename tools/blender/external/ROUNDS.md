# Four headless comparison rounds

Images live in `.kite3d/external-rounds/<round>/sheets/`.
Each sheet includes the opened KF2 frame from `docs/reference/weapons/pistol/kf2-04.jpg`.
The opened real profile is `docs/reference/weapons/pistol/arsenal-03.jpg`.

## Round 1

Opened all eight weapon sheets before this judgment.
1. The current-model view spans only 18 pixels; the KF2 candidate spans about 230 pixels.
2. Loafbrr has a 35-pixel empty cylinder window; the KF2 cylinder fills its window.
3. The utility knife profile is about 10 pixels thick; its quarter view reveals a broad flat handle.
4. The machete blade points right; all gun muzzles point left.
5. Single-candidate sheets leave approximately 650 of 1080 vertical pixels unused.

Corrections: remove the imported glTF helper from baseline framing, use the source default pose,
roll the utility knife by 90 degrees, reverse the machete, and expand sparse sheet layouts.
No geometry is modeled or decimated.

## Round 2

Opened the revised revolver and knife sheets.
1. The baseline now spans about 230 pixels, but its muzzle points 180 degrees away from the reference.
2. Loafbrr's cylinder now fills the former 35-pixel opening, confirming the corrected rest pose.
3. Pavel's spare cylinder remains about 85 pixels from the frame, distorting its total-length normalization.
4. The KF2 knife now presents a roughly 75-pixel broadside instead of its 10-pixel edge.
5. The baseline detail cell is blank because its crop still targets the right-facing barrel.

Corrections: reverse the baseline display, move its crop onto the cylinder, identify detached source props,
and add a parent node for Kite3D's single-mesh nested-asset loader.
The first headless scene check found zero console errors but five empty single-mesh wrappers.

## Round 3

Opened five rebuilt sheets: revolver, M4, shotgun, sniper, and grenade.
1. Pavel now has zero detached spare cylinders; its silhouette spans about 195 pixels instead of 135 pixels.
2. Pavel's crop is blank after framing changed; move the crop from x=325 to x=520.
3. The baseline muzzle now points left, matching the reference's 180-degree direction.
4. The sniper's magazine now meets the receiver after a 35 mm source-space translation.
5. M4 profile width increased from about 400 to 710 sheet pixels with the expanded layout.

Corrections: recenter Pavel and baseline detail crops, improve grenade fuse framing, use exact source-license labels,
and move the captured lab camera back to include all 15 positions.
Material limitations remain visible: Webley and Pavel specular conversions look dull, and Loafbrr looks stylized.
The stock headless CLI check exceeded its 45-second deadline while Blender rendered.
Rerun validation after rendering ends, using a private headless editor when necessary.

## Round 4

Opened all eight final sheets, including their KF2 reference cells.
1. KF2's barrel spans approximately 110 of 235 profile pixels; the built barrel spans approximately 110 of 235 pixels.
2. Detective's barrel spans approximately 40 of 170 pixels; its proportions cannot replace the 1858 silhouette.
3. Pavel's receiver now fills the 480-pixel crop width; the previous crop showed only background.
4. Loafbrr's frame has roughly 3-pixel white borders at profile scale; KF2 has narrower, irregular highlights.
5. The M4 has about 10 visible handguard holes; the 4x crop still exposes smooth, largely unmarked receiver panels.

The final corrections close framing and import defects. Remaining material and silhouette defects require better source assets.
The final lab capture contains the complete 15-model row at one-metre intervals.
Opened the 1920 x 1080 lab capture after correcting the temporary camera override.
The first Play capture found 12 missing reference photographs in the private copy.
Copying the existing reference folder fixed those HTTP 404 errors. The final run has zero console or HTTP errors.
The unchanged Kite3D CLI passes Playable, Editable, and Persisted with a private headless editor connected.
