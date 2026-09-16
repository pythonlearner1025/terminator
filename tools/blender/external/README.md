# External candidate workflow

The lab contains ten licensed candidates and five local reference models.
Use [SOURCES.md](SOURCES.md) for download links, license boundaries, file paths, and saved node names.
Use [VERDICT.md](VERDICT.md) for judgments from opened renders.
The existing reference photographs and video frames were studied before conversion.

## Register and place

```sh
node tools/build-candidate-assets.mjs --references
npm run scene:lab
```

The `Candidates` group contains one placed node per available model, with one-metre spacing.
Select individual named nodes in the scene hierarchy. Imported names use underscores instead of spaces.
The existing lab has no generic label attachment for imported candidate nodes.
No generator or gameplay component was added.

Reference models and downloaded archives are ignored by Git and excluded from publication.
The committed registry includes their local node paths so this worktree can display them.
Before using this branch without local reference files, rebuild the licensed registry and scene:

```sh
npm run build:candidates
npm run scene:lab
```

This removes reference registrations and scene nodes. Never publish this lab as part of this task.

## Convert and compare

`candidates.json` records extracted source paths, maps, and normalization settings.
Download archives into `tools/blender/cache/external/`, using the source links in the ledger.
`fetch-itch.py` implements the public zero-price download flow without login.
The GameBanana MDL import uses SourceIO from its public GitHub repository, inside the ignored cache.
`import-source.py` imports that MDL. `extract-images.py` extracts packed source images.

```sh
python3 tools/blender/external/prepare-maps.py
blender -b -P tools/blender/external/convert.py
python3 tools/blender/external/write-sources.py
blender -b -P tools/blender/external/render.py -- 4
python3 tools/blender/external/compose.py 4
```

Every asset has separate 2048-pixel source-role maps plus packed glTF ORM maps.
Missing AO uses neutral white. Legacy specular maps use an approximate PBR conversion.
Conversion preserves source mesh names and does not decimate geometry.
The wrapper supplies the display pivot required by the nested glTF loader.
The final sheets remain local evidence, outside published game assets.

## Headless verification

The private copy prevents changes to the owner's live server metadata.
It also isolates the save/reload check from the owner's connected editor.

```sh
node tools/blender/external/proof-project.mjs
cd .kite3d/external-proof
npx --no-install kite3d dev --port 4349 --no-open
```

From the worktree root, run these separately after rendering finishes:

```sh
node tools/blender/external/capture.mjs
node tools/blender/external/check-private.mjs
node tools/blender/external/performance.mjs
npm test
```

All browser drivers launch Chrome headless. No command changes desktop focus.
The unchanged Kite3D check runs against a connected headless editor on the private server.
The performance fixture uses the existing range benchmark, with 24 visible enemies and available lab effects.
It does not establish Bunker 7 performance with every possible combat effect.
