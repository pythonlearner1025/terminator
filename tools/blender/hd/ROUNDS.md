# Measured visual review

The literal gate remains unchanged. A failed or missing gate is never a pass.
All desktop applications remain headless.
The baseline uses the committed originals. `input-hashes.json` beside this file protects their bytes.

## Round 0: untouched baseline

Opened both original profiles, quarter views, eight-angle indexes, and both baseline difference sheets.
Opened the two KF2 profiles and quarter views beside the real photographs.

1. The shotgun has 1,740 triangles. Its broad stock edge stays sharp in the 4x crop.
2. The revolver has 1,982 triangles. Its cylinder has no photograph-like flute highlights in the profile.
3. The original revolver texture was enlarged from 1,024 to 2,048 pixels. The resize created no new detail.
4. Identical A and B renders give IoU 1.0, Lab difference 0.0, and SSIM 1.0 at all eight angles.
5. The initial range measurement gives 37.650 ms mean with 24 enemies. Five missing reference files produce 50 console errors.

The initial performance run does not establish weapon cost. The candidates sit outside the gameplay camera.
After recovery, a second range run gives 25.420 ms and zero errors. The originals remain unchanged.
The explicit visible-weapon baseline gives 27.227 ms with both original weapons and all 24 enemies visible.
This Linux result does not establish MacBook performance or the 60 fps target.

## Round 1: curved edges and texture preservation

The first bevel trial introduced broad faceting. Its revolver SSIM fell to 0.858.
The opened A/B heat maps exposed the regression. Area-weighted normals caused most of it.
Source corner-normal transfer restored smooth shading and preserved the original UV coordinates.
A second defect projected interior cylinder vertices onto an outer ring. The build now moves only arc vertices.

1. Revolver minimum IoU improved to 0.99124 after the ring projection fix.
2. Revolver maximum Lab difference fell from 2.843 to 0.625.
3. Revolver minimum SSIM rose from 0.858 to 0.95246.
4. Shotgun maximum Lab difference fell from 3.014 to 1.189. Minimum SSIM rose from 0.931 to 0.96935.
5. Shotgun minimum IoU remained 0.98342 before the radius correction. This failed the 0.985 gate.

The build reduces the refined shotgun ring radius by 0.5 percent and remeasures it.
G4 still counts every triangulation diagonal. The literal coplanar-edge gate remains failed.
No finished surface bake existed in this round. G3 and final asset cost remain failed or unmeasured.

## Round 2: separate relief bake and one material

Opened both four-column contact sheets and both eight-angle A/B difference sheets.
Opened the individual final profiles and quarter views.
An initial hardware transform error produced an oversized box. The corrected export uses verified metre bounds.

1. Exported shotgun geometry reaches 31,852 triangles. The revolver reaches 28,422 triangles.
2. Both assets use one primitive and three 2,048-pixel images. The visible-weapon fixture loads without console errors.
3. Normal gradient ratios reach 1.868 and 1.865. Both relief sources contain geometry absent from the low mesh.
4. The shotgun minimum IoU is 0.98311. The revolver minimum original-map SSIM is 0.94173. Both are failures.
5. The revolver grip acquired visible polygon patches in the final normal bake. Its warm wood also became too pale.

The visible-weapon frame mean is 26.717 ms. The original fixture is 27.227 ms. The difference is -0.510 ms.
The 24 enemies remain visible and alive throughout the fixture. This does not reach 60 fps.
G4 remains failed at 25.708 percent for the shotgun and 28.982 percent for the revolver.
The opened grip regression fails G6. Round 3 separates the relief delta from the high mesh's base shading.

## Round 3: corrected ring geometry and grip shading

Opened the final contact sheet, both final A/B/heat rows, and both eight-angle original-map sheets.
Opened the stock photograph and cylinder crop beside the new contact sheet.
The first geometry build failed on an invalid BMesh vertex. A fallback reused the round 1 mesh.
The build now skips invalid handles. Later rounds refuse a missing geometry source.
Every Blender command now uses a nonzero Python error exit code.
The corrected geometry, maps, and renders replaced that failed attempt within this round.

1. Shotgun minimum IoU increased from 0.98311 to 0.98737. All eight silhouette angles now pass.
2. Shotgun minimum original-map SSIM increased from 0.96619 to 0.97652.
3. Revolver minimum original-map SSIM remains 0.94313. Its end view still fails the 0.95 threshold.
4. Normal gradient ratios fell to 0.864 and 1.147 after removing incorrect high-source shading. Both fail 1.3.
5. The shotgun uses 35,692 triangles. This exceeds the preferred upper target by 692 triangles.

The wood shows approximately five broad bands across the stock crop. The photograph shows much finer irregular grain.
The cylinder crop still lacks the photograph's 136-by-46-pixel flute shape. G6 remains failed.
Round 4 reduces small sight bevels, retains the original UV layout, and recomputes normals after geometric relief.

## Round 4: source UVs and fine grain

Opened both quarter renders, both final A/B/heat rows, both eight-angle proofs, and the contact sheet.
Opened the original shotgun albedo to inspect its native wood grain.

1. Shotgun triangle count fell from 35,692 to 34,092. Smaller sight bevels removed 1,600 triangles.
2. Both silhouette gates pass. Minimum IoU is 0.98739 for the shotgun and 0.99082 for the revolver.
3. Revolver minimum SSIM improved from 0.94313 to 0.94831. It still fails 0.95.
4. Revolver normal gradient ratio rose from 1.147 to 2.299. Shotgun ratio remains below 1.3 at 0.996.
5. The five broad stock bands disappeared. The finish lost the original's fine colour variation and now appears too uniform.

The cylinder retains weak flute shading against the photo's bright 46-pixel flute width.
Round 5 restores the CC0 wood colour detail and deepens the distinct high-source flute relief.
It also matches new hardware's temporary proof maps to the original revolver's measured neutral base.

## Round 5: CC0 grain and circular-section audit

Opened both A/B/heat rows, both eight-angle comparisons, the quarter render, and the contact sheet.
Compared the new grain and cylinder with the opened stock and cylinder photographs.

1. The shotgun keeps 34,092 triangles and a minimum SSIM of 0.97998.
2. Shotgun normal gradient ratio increases to 1.102. It still fails 1.3.
3. Revolver normal gradient ratio reaches 2.310. Its minimum SSIM remains below 0.95 at 0.94783.
4. Restored grain adds fine colour variation. The revolver grain runs roughly 90 degrees from the photograph's direction.
5. An independent section audit found retained 12- and 16-segment rings. Earlier nominal segment labels were not proof.

The final round fits each complete circular section and excludes cap diagonals from subdivision.
It measures every refined section before beveling. It also removes the old grip stipple from the final normal map.
The source UV proof continues to use the original normal map.

## Round 6: measured circular sections and final proof

Opened both quarter renders, both final A/B/heat rows, both eight-angle proofs, and the final contact sheet.
Opened the real revolver quarter photo beside that sheet. Opened both offline AO and curvature maps.
The first screenshot camera used the wrong constructor signature. It produced an inverted view.
The corrected camera uses the engine signature and a fixed quaternion. No camera changes were saved.

1. Main shotgun barrel and magazine sections measure 72 segments. The pump measures 64.
2. Main revolver cylinder and barrel sections measure 64 segments. Smaller internal loops remain below this target.
3. Shotgun triangle count falls to 31,832. Revolver triangle count falls to 28,158.
4. Circular refinement initially lowers shotgun SSIM to 0.88896. Transferring original tangent shading restores it to 0.949781.
5. Shotgun and revolver normal gradient ratios reach 2.189 and 2.037. Both exceed 1.3.

Shotgun SSIM still fails the 0.95 threshold. Revolver minimum SSIM is 0.950340 and passes.
Both silhouette gates pass at all eight angles. Both coplanar-edge fractions remain above eight percent.
The final fractions are 27.569 percent and 30.501 percent. G4 remains failed.

The grip grain now runs along the grip. Its diamonds and the cylinder's flute boundaries still lack photo detail.
The photo cylinder flute spans approximately 136 by 46 pixels. The render retains a broad, weakly defined central reflection.
These differences exceed five percent. G6 remains failed. The six-round limit is reached.

The final visible-weapon frame mean is 27.325 ms. The original fixture mean is 27.227 ms.
The measured delta is +0.099 ms. GPU means are 0.618 ms and 0.591 ms.
An earlier round 6 revision measured 28.795 ms. Its record remains beside the final measurement.
Rounds 3 and 5 also exceeded the frame delta threshold. Those failures remain in their gate files.
The final result is not 60 fps. It does not establish MacBook performance.
