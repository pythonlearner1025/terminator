# Revolver texture finish

This is **scripted mesh-aware UV painting**, not manual brush painting. The
original baked basecolor is the immutable bottom layer; named physical regions
drive asymmetric scratches, contact-edge polish, handling oil, recess grime,
grip rubbing and the fictional `V-07` / `06-1842` markings. No global noise or
blanket curvature wear is used. Original low-sample AO is not amplified across
broad surfaces; it only modulates grime within the authored recess masks.

## Maps and material contract

| Map | Size | Interpretation |
| --- | --- | --- |
| gun-basecolor.png | 2048² | sRGB, finished graphite steel and original walnut grain |
| gun-orm.png | 2048² | Non-Color; R AO, G absolute roughness, B absolute metalness |
| gun-normal.png | 1024² | Original real tangent-space bake, bytes unchanged |
| gun-ao.png | 1024² | Original AO bake/source, bytes unchanged |

The 1024 atlas had too few texels on the long underlug cap for a small readable
rollmark. The finish uses the barrel's better-resolved side UVs and the approved
2048 basecolor/ORM size. **UV coordinates are unchanged.** Basecolor's original
layer is bilinearly upsampled; ORM R duplicates each original AO texel into an
exact 2×2 block (nearest resampling). No new AO values or normal detail are baked.

All five gun materials read the shared ORM's green/blue channels directly in
Blender; glTF uses the same map for occlusion and metallicRoughnessTexture with
both factors exactly 1. Source images are packed from freshly loaded PNG pixels
and verified against disk after reopening. The existing AO image slot becomes
ORM in glTF. Six materials, all existing draw primitives, texture count, normal
and hand maps remain unchanged. Two RGBA8 1024 maps become 2048: **+24 MiB base
level, +32 MiB with a complete mip chain**. Original AO remains available on disk.

## Editable layers

`../source-assets/gun/paint-layers/` contains:

- `original-basecolor.png`: exact immutable input from base commit `d76440e`.
- `contact-edge`, `handling-oil`, `recess-grime`, `directional-scratches`,
  `arsenal-markings`, `grip-rub`: editable 8-bit grayscale masks; white means full
  layer influence. Edit these PNGs in an image editor and use `--composite`.
- `roughness`, `metallic`: derived channel previews, overwritten by composition.
- `material-regions`, `object-regions`: derived ID masks for selecting regions.

`paint.py --generate-masks` **replaces** editable masks from the physical regions
and fixed seed in the script, then composites. `paint.py --composite` reads the
saved masks without overwriting them. Both modes quantize/read the same masks,
so an unedited recomposite is byte-deterministic. To change placement, adjust
the meter-space `spot`, `band`, `packets`, or `label` definitions. To change finish
strength/colors, edit the composite section. Rear-left barrel scuffing primarily
changes roughness; other packets vary in direction, length, taper and breaks.

The mesh-position/normal/UV raster is extracted from the saved source without
modifying it. Source UVs, topology, rig, control anchors and actions are never
rebuilt. `gun.apply_baked_materials` keeps the exact topology-checked UV restore
for future builds and calls `attach_baked_texture_nodes`; texture-only source
updates call that latter helper directly and do not touch UVs.

## Reproduce and verify

Run from the project root. No npm installation or dependency changes are needed.
CPU painting uses installed NumPy/Pillow/SciPy and the host DejaVu Sans Mono font.
The Blender launcher uses the existing shared flock, DISPLAY=:1, two threads and
the **in-snap 1800M scope cap before loading the source**. It never uses Xvfb.

```sh
TEX=tools/blender/revolver-rebuild/texture-paint
python3 "$TEX/prepare.py"
# Read original packed source and establish base fingerprints / before captures.
TEXTURE_SOURCE=tools/blender/revolver-rebuild/generated/texture-paint/before/source.blend "$TEX/run.sh" extract
TEXTURE_SOURCE=tools/blender/revolver-rebuild/generated/texture-paint/before/source.blend "$TEX/run.sh" render --stage before
# Or regenerate the mesh raster from the current source: "$TEX/run.sh" extract.
OPENBLAS_NUM_THREADS=2 OMP_NUM_THREADS=2 python3 "$TEX/paint.py" --composite
# Use --generate-masks instead only to deliberately replace edited masks.
"$TEX/run.sh" update
"$TEX/run.sh" verify
"$TEX/run.sh" render --stage after
OPENBLAS_NUM_THREADS=2 python3 "$TEX/runtime.py"
python3 "$TEX/gallery.py"
```

`prepare.py` gets original files directly from immutable base commit `d76440e`
and refuses to overwrite changed evidence. `extract` only records the baseline
fingerprints when the opened Blend matches that commit's exact bytes. `verify`
compares fresh-process source mesh geometry, UVs, weights, transforms, anchors,
bone rest data, constraint properties, curves, NLA configuration, cameras and
packed hand images, then checks material links and packed PNG bytes.

`runtime.py --check` compares BIN/images/glTF directly to the base commit,
including byte-identical text outside the five gun PBR blocks and AO image
name/URI. Nodes, mesh accessors, skins and all nine animation sections retain even
their original JSON numeric formatting. It checks every URI, factors, nonzero
wear layers, material roughness variation and exact AO replication. It never
reexports or changes the runtime BIN. The existing full export verifier and
weapon regressions provide additional independent checks.

## Review and limits

Ignored `../generated/texture-paint/index.html` has five unchanged-light/camera
before/after pairs: left, right, threequarter, player POV and Inspect at 1.5s.
These are actual Eevee renders of the assembled source; hands are hidden only in
gun closeups. It is not gameplay capture. Normal player framing deliberately
resolves the overall finish rather than tiny serial lettering. Fine wear is
limited by the inherited uneven atlas density and fixed baked normal; scratches
and markings alter basecolor/roughness rather than carved surface relief.

The old animation-video source hashes remain an archive. They are not changed
or claimed to show this finish. New source/map hashes and validation results are
recorded in the separate shipping `texture-manifest.json`.

Final validation: 47 weapon tests passed; the existing export verifier reported
no failures/warnings. Fresh source reopening, source/runtime pixels, direct base
contracts, AO replication and deterministic mask recomposition passed. One
bounded Kite3D headless attempt passed all four static rows but failed all three
runtime outcomes with **Error creating WebGL context**. Doctor's remote runtime
registry returned HTTP 404; its local checks passed. No runtime Kite3D pass is
claimed for this checkout and no unrelated scene/game changes were made.
