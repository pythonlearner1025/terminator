# Imported-hand revolver rebuild

Game asset: `assets/models/weapons/revolver-rebuild/revolver-rebuild.gltf`.
Editable source: `source/assembled/revolver-rebuild.blend` (packed textures,
original native rig and recovered control empties, nine baked actions).
Actual game evidence: [review gallery](generated/revolver-imported-review.html) and
[validation results](qa/results/imported-final.json). The 650s editor passed Playable,
Editable and Persisted; 93 independent skin poses and all gameplay assertions passed.
The separate Mac headless check timed out, so no local editor pass is claimed.

The later [texture finish](texture-paint/README.md) updates packed source/runtime
materials only. The gameplay QA and animation videos above retain their original
finish and provenance; current material evidence is the separate ignored
`generated/texture-paint/index.html` gallery and shipping `texture-manifest.json`.

Only the new revolver variant is replaced; original swingout and other weapons
remain available. Kite3D stays pinned to **0.19.0-alpha.2**. No publishing.

## Accepted source and reproduction

“First Person arms” by **DJMaesen**, [source model](https://sketchfab.com/3d-models/first-person-arms-e3c42c05b22944e5839deb8e003f0987),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Changes: native control recovery, uniform .5 scaling from import presentation,
new grasp placement and nine new animation directions. Artist geometry, weights,
UVs and map pixels are retained. No handmade skin or imported source animation
is used. The accepted skin has 4,246 source vertices, 7,240 triangles, 49 bones
and 38 weighted joints. Export splits nine vertices at attribute seams.

Portable inputs, all relative to this directory:

- `source/imported-hands/neutral.blend`: packed accepted artist rig and maps.
- `rig-report.json` and `attribution.json` in that directory: source fingerprints,
  native joint/control mapping, author and license.
- `approved-r1-right-pose.json`: exact approved firing-arm control snapshot.
- `grasp-fit.json`, `visible-contact-offsets.json`, `pinch-fit.json`: deterministic
  support grasp, small trigger/thumb corrections and loading pinch.
- `source-assets/gun/`: approved basecolor, real tangent-normal/AO bakes, exact
  topology-checked UV layout and bake provenance. No repacking after restoration.
- `gun.py`: gun worker's independently owned, tracked source. Parent integration
  combines its commit beside `assemble.py`; isolated validation accepts `--gun`.
  The packed assembled Blender file is standalone and needs no sibling checkout.

Older fit scripts and inactive palm-fit JSONs are preserved diagnostic history.
The approved snapshot overrides them. Retired `loading_pose.py` is not imported
by the current assembly. Do not rerun global fitting to rebuild the accepted pose.

## Build, render and package

Every Blender invocation must use the host's serialized, memory-bounded wrapper.
On 650s it caps Blender to 1.8GB and two threads and defers below 2.4GB free RAM.
No direct Blender launch or browser automation is part of these commands.

```sh
export REVOLVER_BLENDER=/home/minjune/games/terminator-v2/coordination/revolver-blender
npm run build:revolver-rebuild -- --output tools/blender/revolver-rebuild/generated/assembled
# Add --gun /path/to/approved/gun.py only when validating isolated worker commits.
$REVOLVER_BLENDER -b --python-exit-code 1 -P tools/blender/revolver-rebuild/render_clips.py -- --gun tools/blender/revolver-rebuild/gun.py --output tools/blender/revolver-rebuild/generated/review --material --key-poses
# Repeat with --only Reload --view left-contact for a fixed independent side view.
node tools/blender/revolver-rebuild/retarget_review.mjs tools/blender/revolver-rebuild/generated/review
node tools/blender/revolver-rebuild/register.mjs tools/blender/revolver-rebuild/generated/assembled
```

`render_clips.py` captures 640×480 hip/ADS with actual viewModel placement and
54° vertical FOV; fixed cameras never fit each pose automatically. `review.mjs`
creates a Reference | New Gun comparison from supplied captures;
`retarget_review.mjs` embeds supplied action/contact images in standalone HTML.
`reexport.py` exports a saved bake without rerunning animation fitting.

## Rig and action contract

Pose recovered native **control empties**. WORLD COPY_TRANSFORMS constraints
move the original bones; direct bone edits are overridden while drivers are live.
Native finger axes and names are retained. The imported mesh and source hierarchy
remain intact under a uniform transform. `HandRight` and `HandLeft` are stable
attachment empties; `DJMaesenArms` is the only embedded hand skin.

`animations.sample(rig, clip, seconds)` resets the complete pose deterministically.
Directions: Idle, Draw, Fire, Reload, AimIn, AimOut, AimIdle, Sprint, Inspect.
Reload fractions: release .10, open .24, eject .34, reach .48, insert .67,
close .84, return .96. Reload lasts 3.6s. The 60fps bake rounds other endpoints
to its frame grid (Fire .3167s; AimIn/AimOut .1833s).

The opposed firing thumb stays on the far backstrap side; the index pad follows
the articulated trigger through a bounded native-joint solve. Reload contacts
follow Crane/Cylinder/Ejector/Speedloader part frames. The left arm rotates around
the contacting wrist with wrist compensation, routing the elbow/sleeve below the
camera without stretching segment lengths. A native index/thumb pinch handles
the 12mm speedloader stem. The natural pinch's evaluated pad separation is 11.776mm.

Source-control actions and constraints stay editable in Blender. Export bakes
evaluated native bones and gun pivots, temporarily mutes drivers and excludes
source controls. Constant object tracks must be retained with
`export_optimize_animation_keep_anim_object=True`: otherwise Blender drops the
constant Sprint rotation even though the source preview is correct.

Authoring coordinates are meters, -X forward/Z up. `AuthoringFrame` performs a
proper rotation; shipping glTF is -Z forward/Y up with an identity metadata root.
Cylinder local +Z points rear for runtime chamber indexing. Muzzle, cylinder-gap,
ejection, Case0..5 and other independent mechanism markers preserve runtime axes.

## Evidence and limits

- Export: 27,442 unique mesh triangles, six materials, valid noncollapsed UVs,
  normalized skin weights, all nine actions and required mechanism markers.
- glTF validation samples 121 instants per action, checks seek history and exact
  Reload/Idle hand endpoints, and evaluates actual skin deformation.
- Fresh-process Blender reopen verifies source geometry/weight/UV fingerprints,
  all 49 live drivers, and independent linear skinning at sampled poses
  (maximum error 0.238µm).
- `smoke_reference.py --full` plus `verify_smoke.mjs` compare reopened skin against
  actual glTF skin across all actions and five Reload instants (maximum error 0.565µm across all thirteen samples). Despite its
  historical name, `--full` is a thirteen-instant final-export check.
- glTF Transform checks geometry, UV/skin arrays, action arrays and world transforms.
  Its near-zero source-container translation canonicalization creates 20nm world
  drift; local translation tolerance 10µm in source units, world tolerance 1µm.
  Optional specular-extension roundtrip is not covered; original shipping glTF
  retains it. No packages were added to broaden this test.
- 43 weapon/runtime regression tests passed. ADS sight top edges project within
  .027px of the 640×480 center; this is geometry alignment, not browser proof.

Multi-angle and runtime-equivalent captures were inspected. Parent approved the
R1-derived grasp and corrected reload sleeve route. Sprint's excessive cant was
also reduced after visual inspection. Hidden skin inside the opaque grip remains:
component diagnostics report up to 13.15mm overlap. Open cuffs/components and
finite samples limit ray-parity collision reports. These are **not collision-free
hands**; nearest-pad distances never certify visible contact or full clearance.
Case bullet-tip markers are empty placeholders; the cartridge meshes carry the
visible rounds. Native source AO remains in the packed neutral input; no new hand
AO/normal bake was made. Gun roughness/metallic now use the authored packed ORM
texture finish; see [texture painting](texture-paint/README.md). These are painted
material values, not newly baked geometry maps. Original AO and normal are retained.

Frozen paths, commit and SHA256 hashes are in the shared
`coordination/revolver-retarget-ready.json`. Actual gameplay/browser QA was completed separately on 650s; see the validation
results above. Source/export checks and runtime checks remain distinct evidence.
