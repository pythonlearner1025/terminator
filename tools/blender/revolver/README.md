# Blender revolver

Run `REVOLVER_ROUND=1 npm run build:revolver` from the project root.
Blender runs headless. CPU Cycles bakes the maps. Metal compute renders the contact views.
Run `python3 tools/blender/revolver/compose.py 1` after the build finishes.
Change the round number for each iteration.

`LOOK.md` records opened references and measurements. `profiles.json` stores metre-scaled photo traces.
`trace.py` regenerates those traces from reference silhouettes and measured part outlines.
`model.py` constructs the revolver. `hands.py` poses both source-derived hands and constructs sleeves.
`engraving.py` creates original scroll and walnut stencils. `wear.py` bakes traced contour wear.
The old remeshing and glove detail stages do not run. Study photo pixels never enter exported textures.
`uv-layout.json` stores the final authored UV coordinates with topology hashes. Changed geometry requires a new UV layout.
`build.py` rejects stale UV layouts, bakes three 2048-pixel atlases, and exports nine named clips.
`register.mjs` checks budgets, preserves names, and registers the package.
`render.py` writes matched reference views and three poses from Fire and Reload.

Raw panels and the editable Blender file stay under `.kite3d/revolver-rounds/`.
Contact sheets, independent silhouette overlays, and metrics go under `docs/evidence/blender-revolver/rounds/`.
`ROUNDS.md` records opened outputs, measured errors, and the next changes.
The task explicitly selects this already tracked evidence directory.

Run `node --test test/view/revolver.test.js` and `npm test` for validation.
Run `node tools/blender/revolver/capture.mjs <isolated-project>` for the headless range captures and 24-enemy measurement.
Use `--performance-only` to repeat timing after builds and tests finish.
The capture script refuses ports 4300 and 4310. Start its isolated server with `--no-open`.
It consumes three core shots and captures Fire at 0.2 seconds with the range clock at 0.25x.
Reload captures the clip midpoint at 1.3 seconds. Results go into docs/evidence/blender-revolver/pass3/.
It also captures Idle, Reload, and AimIdle. `performance.mjs` measures a separate temporary 24-enemy range fixture.

The cylinder swing and speed loader preserve the established fictional cartridge conversion.
The original 1858 and KF2 reload have a fixed cylinder. Exact reload choreography therefore remains different.
Read the final round log for remaining visual limits. Silhouette overlap alone does not establish KF2 quality.

Run two complete builds with `determinism.mjs record` between them, then run `determinism.mjs compare`.
That command checks all five exported files, the weapon manifest, and assets.json.

## Pass 3 build source

The hands use Dan Ulrich's CC0 scan topology from Blender Human Base Meshes v1.4.1.
Download and extract the bundle into the ignored build cache before building:

```sh
mkdir -p tools/blender/cache
curl -fL https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip -o tools/blender/cache/human-base-meshes-bundle-v1.4.1.zip
unzip -q tools/blender/cache/human-base-meshes-bundle-v1.4.1.zip -d tools/blender/cache
```

`hands.py` imports `Hand  - Realistic`, resets bundle transforms, applies one multiresolution level,
poses its continuous anatomy, transfers weights to the existing named rig, and decimates each hand.
No voxel remeshing or procedural palm replacement runs in this pass.

`sample_materials.py` measures the opened reference crops in CIELAB using D65 and Delta E76.
`sampled_finish.py` creates original steel, brass, skin, and cloth textures from measured color statistics.
The walnut uses stained CC0 Poly Haven diffuse and roughness maps.
All shipped maps remain CC0. Photo and video files stay under the excluded reference directory.

Set `REVOLVER_WRITE_UV=1` only when changing geometry. It records a new stable layout.
The layout reserves 70 percent of atlas width for the weapon, with separate regions for each hand.
Subsequent builds reuse the recorded layout and reject topology drift.

The walnut uses Poly Haven black_walnut_veneer_01, under CC0.
Download its source diffuse and roughness maps into the same ignored cache:

```sh
curl -fL https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/black_walnut_veneer_01/black_walnut_veneer_01_diff_2k.jpg -o tools/blender/cache/black_walnut_veneer_01_diff_2k.jpg
curl -fL https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/black_walnut_veneer_01/black_walnut_veneer_01_rough_2k.jpg -o tools/blender/cache/black_walnut_veneer_01_rough_2k.jpg
```

## Pass 3 result

Ten design rounds are complete. All 273 tests pass. Two consecutive builds produce identical exported files.
The isolated headless check passes Playable, Editable, and Persisted.
Mean color differences pass, but hands, cuffs, material detail, and full framing still fail visual acceptance.
The 24-enemy range averages 23.87 ms per frame. It does not meet 60 FPS.
Read docs/evidence/blender-revolver/pass3/README.md before accepting this experimental asset.
