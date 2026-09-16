# Fresh revolver source — gun worker

## Scope and API

`gun.py` exports `build_gun(collection=None, use_baked_materials=True)` returning `objects`, `anchors`, and `metadata`. It builds new bmesh/profile/sectional geometry, marks seams, unwraps, and globally packs UVs. The builder never reads a reference mesh. All geometry is in meters, front **-X**, up **Z**. It does not perform game-coordinate conversion or impose a moving hierarchy.

Required Body, Frame, Barrel, FrontSight, RearSight, GripLeft, GripRight, TriggerGuard, Crane, Cylinder, Ejector, Hammer, Trigger, and Latch objects have unique names. Additional GripCore, six screws, and Cartridge01–06 are separate objects. Cartridge rims and primers are joined into each cartridge. Crane/Cylinder/Ejector/Hammer/Trigger/Latch have useful local origins and `articulation_axis` metadata. Artist contact anchors are exposed in `ANCHORS`; they are not physical engineering specifications.

Default materials load the packaged `source-assets/gun` atlas when available. `apply_baked_materials(objects, directory)` can attach a relocated atlas. **Ship basecolor, normal, original AO, finished ORM and the UV layout sidecar with these sources.** Without those artifacts the builder uses restrained procedural steel/rubber/walnut/brass materials. The assembly exporter can embed the loaded images. The new [texture finish](texture-paint/README.md) provides editable masks and reproduction commands without rebuilding geometry or animations.

## Reproduction

Every Blender invocation must go through `/home/minjune/games/terminator-v2/coordination/revolver-blender` (flock, 1800 MB, two threads). No browser is needed.

1. `revolver-blender -b --python tools/blender/revolver-rebuild/gun_inspect.py` creates a NEW aligned reference workspace. Its output must not already exist, because the shared workstation intentionally refuses overwrite. This preserves imported source hashes and geometry.
2. `revolver-blender -b --python tools/blender/revolver-rebuild/gun_review.py` builds the gun, unwraps, measures and captures side/top/front/rear/threequarter pairs at unchanged 640×480 cameras.
3. `revolver-blender -b --python tools/blender/revolver-rebuild/gun_finish.py` bakes real 1024px tangent normals from a temporary higher-density bevel source, real geometry AO, and procedural base colors. Cycles CPU baking uses 8 samples, 4-pixel dilation. Material/checker captures use Eevee at 800×600. Temporary bake meshes are removed. It saves packed `gun.blend` and embedded `gun.glb`.
4. `python3 tools/blender/revolver-rebuild/gun_metrics.py` computes silhouette IoU and a fixed-camera comparison sheet (Pillow required).

Generated artifacts are intentionally ignored until the parent selects packaging. The standalone `gun.glb` is **authoring Z-up**, not the runtime shipping assembly. Reference/Practice are excluded from selected-object export. The `.blend` retains a hidden immutable Reference collection for review.

## Actual geometry and UV work

20,074 triangles in round two. The increase preserves the 80-section guard, smooth frontstrap/butt and conformal panels; the initial 18,000 figure was a target, not a silhouette constraint. Five material types. Articulation and cartridge detail necessarily cause more draw primitives than material count. The barrel has an open annular bore, the cylinder six boolean chamber openings with real walls, shallow sixfold flutes, and separate case geometry. The guard is a ribbon around a true aperture. All bevels are controlled small geometry, not only shader rounding. Small slots are physical screw cuts. The model uses intersecting, separately editable manufacturing-style pieces; it is not one watertight solid.

UV seams follow sharp edges plus axial cuts. Angle-based unwrap, average island scale and a shared pack use FRACTION packing with a fixed 0.01 UV margin (10.24 pixels at 1024); bakes dilate 4px. The saved checker render exposes actual UV placement. Tiny fillet islands retain visible checker density variation, but fixed atlas spacing prevents their bake dilation bleeding into adjoining islands. No constant image is described as a bake. Normal source and timings are in `bake-report.json`.

## Visual review and limits

Inspected actual fixed side/top/front/rear/threequarter Workbench renders and Eevee threequarter/side/rear materials plus checker. Refinements corrected the initially open recoil-shield gap, squared butt and an underlug boolean failure; the final lug is authored below the bore clearance rather than boolean-cut through overlapping joined pieces. Long full-lug proportions and cylinder/grip relationship are recognizable against the reference.

## Round two — parent-requested corrections

- Replaced the under-cylinder rectangular void with a shaped lower-frame transition, retaining about half a millimeter of cylinder-bottom clearance. Moved the closed crane behind the outer frame surface. Rounded the rear shield loft and frame outline.
- Guard uses 80 sampled curve sections with a continuous 3.7 mm strip and rounded edge bevel. Trigger is spline sampled. Grip loft is smoothly interpolated and its butt closes through rounded end sections.
- Walnut panels follow the actual grip loft as curved patches, with a 64-section rolled perimeter and 0.18–0.65 mm designed radial offset. Four samples per triangle found no panel penetration into the actual tessellated grip; measured minimum signed clearance is about 0.07 mm. Walnut uses darker grain and restrained specularity.
- Broad profile caps retain flat normals, while geometric fillets carry highlights. The real normal bake separates 49 disconnected construction pieces spatially, then restores them for assembled AO. It only bevels remaining hard edges above 60 degrees; rebaking already-rounded fillets was the source of diagonal face artifacts. The final material renders show the cleaned frame/lower rail.
- Reference objects have a `Reference::` prefix in the review workspace; their mesh coordinates and polygons are untouched. Exact required names are checked on Rebuild, including `Hammer`, and Reference is excluded from the GLB.

`gun_validate.py` records exact names and sampled panel clearances. `gun_shading_probe.py` renders a diagnostic with the normal map disabled. The generated `round2/before` and `round2/after` folders preserve comparison evidence; `round2/before-after.jpg` places side clay, side material, threequarter material, rear, and checker together.

All anchors remain unchanged. Contact geometry is smoother between the original grip sections and the panel now follows it, so the hand worker should check contact against this updated surface. No local assembly/runtime integration was performed. Parent acceptance remains pending; this worker does not approve its own final asset. Minute surface wear and engraving remain optional rather than blockers for these requested shape corrections.

## Round three — UV degeneracy fix

The assembly threshold was retained: absolute twice-UV-area `<1e-12` fails. Direct float32 inspection of the current round-two GLB found real coincident bevel vertices and nanometer-scale trigger slivers, plus failed unwrap charts after those residues were removed. `cleanup_bevel_slivers` welds within **0.1 micrometer** and dissolves degenerate edges before unwrap; it explicitly skips all three frozen grip meshes. Failed UV faces receive dominant-axis projection and separate seams, then the existing padded atlas is repacked. This changes no articulation anchor or frozen grip geometry.

The final artifact has **20,050 triangles**, no collapsed UV triangles, no zero-area geometry triangles, and minimum absolute UV determinant **1.2601475418705377e-11**. All triangles are evaluated from the exported float32 GLB, rather than inferred from UV-layer existence. `gun_uv_validate.py` runs this check using the same tolerance as assembly. `gun_frozen_verify.py` confirms exact grip vertex/topology equality and all articulation matrices against `round3/before.blend`.

**Builder packaging:** include `gun-uv-layout.json` alongside the three PNG atlases. Blender can pack the same scene differently depending on its other contents; `apply_baked_materials` now restores the exact baked UV coordinates after checking geometry signatures. Missing layout disables baked-map attachment; mismatched topology raises an error instead of silently attaching wrong maps. The shipping GLB embeds its own UVs/textures and does not require this sidecar. `gun_finish.py` writes the sidecar automatically, and `gun_bake_layout.py` can extract it from an already baked blend without rebaking. A fresh builder invocation without Reference produced identical geometry/UV bindings for all 27 meshes after restoration (`round3/baked-layout-verification.json`).

Only UV-required atlas outputs were rebaked. Five materials, approved shape and material setup preserved. Final threequarter material/checker renders were inspected after the fix. No runtime integration performed.
