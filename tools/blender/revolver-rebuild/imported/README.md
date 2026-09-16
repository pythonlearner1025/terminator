# DJMaesen imported hand rig

**Result: usable native skinning through the retained source transform controls.**
The importer passed, exited 0, rendered, and independently reopened its output.
Both inspection blends also passed fresh-process validation of all 4,246 vertices.
No hand modeling, gun changes, runtime integration, or animation retargeting.

## Source and attribution

“First Person arms” by **DJMaesen** ([profile](https://sketchfab.com/bumstrum)),
[Sketchfab model](https://sketchfab.com/3d-models/first-person-arms-e3c42c05b22944e5839deb8e003f0987),
licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Keep this attribution with redistribution. Changes here: recovery of the public
viewer representation into Blender, presentation normalization, inspection cameras,
packed reference AO map, and a static grip demonstration. Geometry, skin weights,
and UVs are unchanged after import.

This is recovered viewer skeletal data reconstructed as a native Blender armature,
not the original authoring project or its IK rig. The provided importer was used
unchanged; its SHA-256 is
`bdf08bdbce3cfb26fd1e2b144895b904a1f0dc04bca60a14233f58497e23dd4a`.

## Open for inspection

Artifact root (ignored; intentionally absent from Git):

```text
/home/minjune/games/terminator-v2/revolver-imported-hands/generated/imported-hands/
```

| File | Purpose |
| --- | --- |
| `neutral.blend` | Packed neutral source for local Blender inspection; four maps, control hints and embedded guide |
| `test-grip.blend` | Editable static grip; all source controls and native constraints remain live |
| `source/model.blend` | Untouched importer result; its three shader maps are packed |
| `neutral.png`, `test-grip.png` | Same fixed full-arm camera, 640 × 360 |
| `neutral-detail.png`, `test-grip-detail.png` | Same fixed close camera, 640 × 360; visually reviewed |
| `rig-report.json` | Full machine-readable inventory, mapping, 38 individual joint tests, hashes and reopen evidence |
| `source/status.json`, `import-cli.exitcode` | Importer `passed` and CLI `0` |
| `source/reopen-validation.json` | Importer's independent reopen proof |
| `neutral-reopen.json`, `test-grip-reopen.json` | Independent all-vertex validation of the two inspection files |
| `source/attribution.json`, `source/texture-files.json` | Source/license metadata and original recovered map paths |

Use only the shared wrapper for Blender, including interactive inspection:

```bash
/home/minjune/games/terminator-v2/coordination/revolver-blender \
  /home/minjune/games/terminator-v2/revolver-imported-hands/generated/imported-hands/neutral.blend
```

## Pose controls

Select the named **Empty in Object Mode** and rotate in local space. Native pose
bones follow those objects using WORLD-to-WORLD `COPY_TRANSFORMS`. Direct edits to
pose bones are overridden. **Do not remove those constraints or source controls.**
The embedded `HAND RIG INSPECTION` text explains this too. Viewport defaults to Solid
with source axes visible for inexpensive inspection; switch to Material Preview
when desired. The mesh is one object containing both arms.

| Part | Left controls | Right controls |
| --- | --- | --- |
| Thumb | `L_thumb1_05`, `L_thumb2_06`, `L_thumb3_07` | `R_thumb1_028`, `R_thumb2_029`, `R_thumb3_030` |
| Index | `L_point1_09`, `L_point2_00`, `L_point3_010` | `R_point1_032`, `R_point2_033`, `R_point3_034` |
| Middle | `L_middle1_012`, `L_middle2_013`, `L_middle3_014` | `R_middle1_036`, `R_middle2_037`, `R_middle3_038` |
| Ring | `L_ring1_017`, `L_ring2_018`, `L_ring3_019` | `R_ring1_041`, `R_ring2_042`, `R_ring3_043` |
| Little | `L_pink1_021`, `L_pink2_022`, `L_pink3_023` | `R_pink1_045`, `R_pink2_046`, `R_pink3_047` |
| Wrist | `L_wrist_04` | `R_wrist_027` |
| Forearm/elbow | `L_elbow_03` | `R_elbow_026` |
| Upper arm | `L_arm_02` | `R_arm_025` |
| Palm | `L_palm_016` | `R_palm_040` |

Finger chains have three weighted joints plus a fourth unweighted endpoint. Thumb,
index and middle descend from wrist; ring and little descend through palm. Both
arms descend from `chest_01`. The chest is unweighted. Original bone and control
parent relationships, all 49 bones and all 49 constraints are retained.

Local **negative X** curls these fingers. The script applies offsets relative to
the imported `matrix_basis`: non-thumb fingers −35°/−45°/−30°, thumbs
−10°/−25°/−25°, wrists −8°. The grip is a static deformation demonstration and is
not fitted to a revolver. No keyframes or actions were added.

## Evidence

- One mesh, one native armature, one material; **7,240 triangles, 4,246 loaded
  vertices, all weighted**, 38 weighted bones, 49 bones total. Sketchfab's listing
  reports 3,624 vertices; the decoded viewer mesh has 4,246. Use loaded counts for
  integration budgeting; triangle count agrees exactly.
- Two preserved UV layers: `UVMap` and `UVMap6`, each with 21,720 loop coordinates.
- Four 2048 × 2048 maps retained: color, roughness, normal, AO. Color/roughness/normal
  are shader inputs. AO is packed as a reference image in both inspection blends
  and remains unconnected, matching the importer's material approximation.
- All **30 finger joints**, both wrists, forearms, palms and upper arms passed
  independent −20° local-X tests: **38 tests**. Each moved its own weighted vertices;
  no opposite-arm displacement exceeded 0.000001 m. Full per-joint counts and
  displacement values are in `rig-report.json`.
- Rest restoration error below 0.00000055 m; static grip moves 3,416 vertices.
- Fresh-process reopening of each inspection file checked every vertex against
  the source inverse-bind equation. Maximum error: neutral 0.0000020612 m;
  grip 0.0000020370 m. Saved/evaluated coordinate drift: **0** for both files.
- Structural fingerprints confirm geometry, UVs, weights, bone parents and
  constraints stayed unchanged. All four packed image hashes survived reopening.
- Original importer render and final close/full neutral and grip previews were
  visually inspected; sleeve/glove/finger forms and textured grip remain coherent.

## Reproduce

From this project root, with Node available and at least **2,400,000 kB
MemAvailable**:

```bash
tools/blender/revolver-rebuild/imported/import.sh
tools/blender/revolver-rebuild/imported/verify.sh
```

`import.sh` creates `generated/imported-hands/.venv` and installs the existing
`coordination/hand-importer` editable, including NumPy and Pillow. It does not run
`npm install` or modify the shared importer. Its exact CLI invocation is:

```bash
export PATH="$PWD/tools/blender/revolver-rebuild/imported/bin:$PATH"
generated/imported-hands/.venv/bin/sketchfab-to-blender \
  e3c42c05b22944e5839deb8e003f0987 \
  --output /home/minjune/games/terminator-v2/revolver-imported-hands/generated/imported-hands/source \
  --cache /home/minjune/games/terminator-v2/coordination/hand-viewer-cache \
  --max-texture 2048 --render-size 640 \
  --blender /home/minjune/games/terminator-v2/coordination/revolver-blender
```

The first attempt failed before Blender because the importer filters out the
user-session environment. `bin/systemd-run` restores only `XDG_RUNTIME_DIR` and
`DBUS_SESSION_BUS_ADDRESS`, then execs `/usr/bin/systemd-run`. The unchanged shared
Blender wrapper still owns serialization, the 1.8 GB memory cap, two-thread limit,
RAM preflight and `DISPLAY=:1`. The retry completed the full render; no skip-render
fallback was needed. Blender used here: 5.2.1 LTS.

`inspect_rig.py` is also a read-only standalone inventory script. `pose_tests.py`
retains geometry and constraints, applies isolated control offsets, saves poses,
and renders. `verify_saved.py` runs in a fresh Blender process per file.
`finish_report.py` requires those successful reopen exit codes and differing,
nonempty renders before setting the report to `passed`.

## Limits / remaining integration work

- No original authoring/IK rig, source animation clips, or weapon fitting is
  supplied. Pose the recovered controls or deliberately build integration later.
- Maximum asset dimension is normalized by the importer to 2 m; establish game
  units before attaching the model to gameplay.
- No collision/contact, retargeting, runtime export, or animation integration was
  tested. Material shading approximates the Sketchfab viewer.
- Project `kite3d doctor` separately reports runtime registry HTTP 404. That service
  is unrelated to this Blender asset proof; no game scene was changed or published.
- `kite3d check`: all four static script/plugin/component rows pass; headless
  WebGL context creation fails, so Playable/Editable/Persisted remain unvalidated.
  The saved Blender asset has its own successful checks above.

Pre-work checkpoint: `fddf7e9` (`before imported hand rig`).
