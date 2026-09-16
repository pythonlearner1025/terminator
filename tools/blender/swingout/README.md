# Swing-out revolver source

Rebuild with `npm run build:swingout`. Blender runs headless.
Use `SWINGOUT_ROUND=14` to name the review folder.

The editable source is `swingout.blend`. The build regenerates it and the glTF package.
`neutral-hand.blend` contains the unposed CC0 hand scan. It is a build dependency.
The build requires Blender, Python with Pillow, and the existing npm dependencies.
It requires no asset download.

`hands.py` builds skin and joints together from the neutral scan.
`contact.py` fits finger hinges against evaluated skin and weapon surfaces.
`animate.py` defines poses, contact intervals, and mechanical motion.
`build.py` exports all nine existing clip names and the existing part names.
The output path remains `assets/models/weapons/swingout/`.

Start the editor with `npx kite3d dev --no-open`.
The review uses the live game manager and weapon view. It uses no lab panels.

```sh
SWINGOUT_ROUND=14 SWINGOUT_LIVE=1 node tools/blender/swingout/review.mjs
python3 tools/blender/swingout/review-film.py 14
SWINGOUT_ROUND=14 /snap/bin/blender -b -t 6 -P tools/blender/swingout/skin-audit.py
node tools/blender/swingout/check.mjs
npm test
```

Live capture runs the normal game clock at 1x and 0.25x.
The film builder preserves recorded wall-clock intervals.
Without `SWINGOUT_LIVE`, capture advances real simulation ticks for close inspection.
Without live mode, encoded playback uses 60 or 15 frames per second.

The skin audit checks evaluated triangles at 120 Hz, including interpolated poses.
Bone-tip distances cannot establish skin clearance.
An audit failure means the hand bar remains open, regardless of passing Node tests.

## Neutral hand source

Dan Ulrich created the CC0 hand in Blender Human Base Meshes 1.4.1.
The source URL is https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip.
The repository stores the extracted neutral hand. The full bundle stays in the ignored cache.
`prepare-hands.py` reproduces that extraction after the bundle download documented in the older revolver README.
The source scan replaces the old revolver's baked finger folds.

The real reload and FPS reference remain observation material.
See `docs/reference/weapons/swingout/SOURCES.json` and `ROUNDS.md`.
