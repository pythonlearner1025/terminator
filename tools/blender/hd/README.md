# HD candidate drafts

These are CC0 comparison drafts. They do not meet the complete acceptance gate.
See `rounds/gate-6.json` for the final measured result and `ROUNDS.md` for the opened image reviews.
No gameplay data, animation clips, original candidates, or production weapon assets changed.

## Rebuild

Use Node 20 or newer, the installed project dependencies, Blender 5.2.1, and the packages in `requirements.txt`.
Blender uses OPTIX for Cycles bakes and renders. All browser and Blender tools run headlessly.

```sh
npm run build:weapons-hd -- 6
python3 tools/blender/hd/compare.py 6
python3 tools/blender/hd/compose.py 6
/snap/bin/blender -b --python-exit-code 1 -P tools/blender/hd/package-sources.py -- 6
```

The comparison requires the untouched round 0 renders in `.kite3d/hd/round-0/`.
Create those with `asset_inspect.py`, then run `compare.py 0`, before comparing a later round.
The contact sheet also uses the committed reference images in `docs/reference/weapons/hd/`.
`LOOK.md` records the opened references and their measurements.

`build.py` refines circular sections and bevels existing edges. It does not subdivide plain receiver panels.
`surface.py` adds hardware and creates distinct relief geometry for the high source.
`finish.py` combines the baked maps with the original CC0 texture detail.
`export.py` writes one mesh and one material per weapon into new asset folders.
`register.mjs` adds only the two new candidates. `npm run scene` regenerates the lab scene.

## Editable sources and maps

`sources/shotgun.blend` and `sources/revolver.blend` contain the low mesh and a hidden high relief source.
Unhide `High relief source` to inspect its geometry. The source files use relative texture paths.
Rebuild the bakes with `surface.py`; the saved source scenes support further Blender editing.

Each runtime asset contains three 2048-by-2048 PNG images:

| Map | Contents |
| --- | --- |
| `main-albedo.png` | Dark blue steel, retained CC0 wood grain, edge wear, and cavity dirt. |
| `main-normal.png` | Tangent normals with a Cycles bake of distinct geometric relief. |
| `main-orm.png` | Red: baked AO. Green: roughness and oil sheen. Blue: metalness. |

The high source includes grain, pump grooves, cylinder relief, and grip and hammer texture.
The final normal removes the high source's base shading before adding its relief delta.
The shotgun proof normal transfers the untouched source's shading into the refined mesh's tangent frames.
The temporary proof maps preserve source appearance for G2. They are not the final coloured maps.

`sources/*-ao.png` holds the offline AO bake. `sources/*-curvature.png` holds the high-source pointiness bake.
Curvature controls wear in the albedo and roughness finish. The game does not load these offline images.
Three RGBA8 images with full mip chains cost approximately 64 MiB per weapon. The original image budget is unchanged.

## Validation and limitations

Run the dev server on port 4357 with `--no-open` before the browser tools.
`performance.mjs N --visible-weapons --hd` measures both visible drafts with 24 live enemies.
Run it alone after all Blender and test processes finish. It records CPU, GPU, and frame intervals.
The fixture uses the Linux RTX 3090 Ti workstation. It does not establish MacBook or Bunker 7 performance.
The original baseline remains `rounds/performance-visible-original-0.json`.

`check.mjs` runs the unmodified `npx kite3d check` through a connected headless editor.
It records asset topology, map sizes, browser errors, and the three independent check outcomes.
`capture.mjs` photographs the actual placed pairs with a temporary camera. It never saves that camera.

The lab also references five ignored external models. Those must exist for a complete lab check.
Their sources and existing conversion workflow remain in `tools/blender/external/SOURCES.md`.
Recovered reference models remain ignored and are not included in these CC0 derivatives.

G4 counts every manifold edge below one degree after position welding and triangulation.
The threshold remains eight percent. It has not been relaxed to exclude triangulation diagonals.
G6 requires an opened final comparison and a manual review. Image hashes invalidate stale reviews.
No result is marked as a complete pass when a required gate fails.
