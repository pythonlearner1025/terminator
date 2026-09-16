# Fresh resistance hands

`hands.py` owns the new hands, forearms, sleeves, skeleton and reusable pose/contact API. It never imports a mesh. Dimensions are metres, with gun forward along **−X**, width Y, up Z. The measured gun contract supplies the starting grip location.

## Reproduce

Use the coordinated memory-limited Blender wrapper for every run:

```sh
/home/minjune/games/terminator-v2/coordination/revolver-blender -b \
  --python tools/blender/revolver-rebuild/review-hands.py -- --quick
```

For assembled contact evidence, pass `--gun /absolute/path/to/gun-worker/gun.py`. The review imports that file in place; no gun source enters this worker's commit. Omit `--quick` to capture neutral, grip, support and reload, each from fixed player, palm and back cameras. Then run `finish-hands.py` with the same wrapper for bounded 1024px real bakes and Eevee/checker review. Run `audit-hands.py` for Blender data validation and hand-to-hand pad distances. `--no-render` only builds and audits. Generated files live under `generated/hands` and `generated/review/hands` and are ignored pending parent packaging.

## API

```python
result = build_hands(gun_contract, collection=rebuild_collection)
apply_pose(result, 'grip')  # right grip, left support
apply_pose(result, 'reload', side='Left', amount=1.0)
set_hand_transform(result, 'Left', world_delta_matrix)
report = contact_report(result, gun_result['objects'])
```

The transform helper takes a world **delta**, not an absolute wrist transform. Animation can key bone quaternion/location/scale directly. Helpers leave root transforms unchanged when changing gestures. The one armature is `HandsRig`; the deform roots are `RightForearm` and `LeftForearm`. Their children are `HandRight` and `HandLeft`. Each digit has three bones named `RightIndex1`, `RightIndex2`, `RightIndex3`, etc.; digits are Thumb, Index, Middle, Ring and Little, repeated for Left. The mirrored hand uses baked vertex positions and face winding, with positive object scales. Local dorsal roll is consistent on both skeleton branches.

## Construction

Palm dorsal/palmar quad lattices share perimeter vertices with a continuous forearm. Four fingers branch directly from the palm's distal boundary, sharing crotch edges; the thumb branches from an eight-vertex radial socket. Palm heel, thenar/hypothenar pads, metacarpal ridges, finger-length hierarchy, tapered elliptical phalanges and joint support loops are authored in the cage. One applied subdivision smooths the surface and interpolates normalized skin weights across joints. No remeshing or imported scan geometry is used. Nail plates are deliberate thin dorsal surface islands in the hand object; the primary skin remains one connected component. Fabric sleeves are separate cuffed surfaces.

UV seams run on the inner forearm/palmar finger side and around branching sockets and nails. Angle-based unwrap, averaged island scale and rotated packing use normalized padding 0.015; each surface receives a deterministic atlas quadrant with an additional outer gutter. The source has editable skin and fabric Principled materials and nail vertex tint. `finish-hands.py` produces actual 1024px normal/AO/basecolor/roughness bakes, and combines skin and fabric into a single `ResistanceHandsAtlas` material with three shipping images: basecolor, tangent normal and ORM (occlusion/roughness/metallic). The normal source is a further subdivided geometric surface (56,256 triangles) baked onto the 14,064-triangle game surface. AO is traced from geometry; material values are baked separately. These are subtle smoothing normals, not high-resolution sculpted pores. `bake-report.json` records settings, provenance and timing. Source builds load existing baked artifacts by default; pass `use_baked_materials=False` to rebuild bake inputs. `apply_baked_materials(meshes, directory)` lets assembly load parent-packaged artifacts.

## Evidence and limitations

`hands-contract.json` records dimensions, bone hierarchy, world bind frames, evaluated pad vertex indices, triangle count, topology/weight/UV audit and fixed-camera capture paths. The shared copy is `coordination/revolver-hands-contract.json`. `contact_report` samples deformed ventral distal phalanges against evaluated gun triangles; it reports nearest and signed surface gaps. This is a diagnostic and cannot establish whole-hand collision freedom on its own. Actual captures must be inspected alongside these numbers.

Current visual findings and remaining work are recorded in the shared `revolver-hands.findings.md`; the existence of a Blender file or numeric self-score is not acceptance evidence. Animation contact changes must be reviewed at clip contact instants by the assembly worker.

## Pose fitting details

The thumb helper builds true 3D CMC opposition: the right metacarpal passes around the backstrap and its two phalanges lie along the opposite side. A local 4 mm index metacarpal extension improves trigger reach without detaching the web. Fingers use anatomical MCP/PIP/DIP bends; no IK constraints are required in the exported rig. `fit-hands.py` is a bounded diagnostic search over evaluated skin that writes suggestions, not an automatic quality gate. An unconstrained search was rejected visually because it produced excessive splay.

Subdivision weights are clamped and normalized again after surface generation because Blender can round a unit influence to 1.0000001, triggering an invalid mesh warning during glTF export. The final audit tests Blender validation on data copies rather than assuming a near-unit sum is valid.

## Atlas reuse and final checks

Baked reuse requires an exact rounded UV fingerprint match. A builder whose UVs changed refuses to attach old images. The bake report records that fingerprint and checks base-color coverage at every low-poly triangle centroid; this prevents silently reusing the earlier mismatched atlas. Base color is extracted via an emission bake of the material's actual Base Color socket, so subsurface or metallic shader classifications cannot blank parts of the color pass. Source vertex tint is removed after it has been baked, avoiding double tint in glTF.

The standalone audit rebuilds in a fresh scene and verifies that it obtains the same UV fingerprint and one-material atlas. It also checks Blender mesh validation, collapsed UV triangles, and evaluated hand-to-hand pad proximity. Small metacarpal pose offsets on the support hand keep its pads outside the firing fingers; these are bone translations with blended web weights, not disconnected geometry.

The material captures remain studio evidence. Actual gameplay framing and continuous contact throughout all nine assembled clips belong to the animation/integration review. This hand source does not claim those checks passed. The normal bake represents surface smoothing; pore detail, subtle skin creases and fabric tailoring remain modest compared with a manually sculpted hero asset.
