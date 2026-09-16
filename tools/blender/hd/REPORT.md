# Weapon HD acceptance report

Status: INCOMPLETE. These drafts do not meet every acceptance gate.
The six-round limit is reached. No failed gate is reported as a pass.

## Before and after

| Weapon | Original triangles | Final triangles | Main round sections | Runtime maps |
| --- | ---: | ---: | --- | --- |
| Shotgun | 1,740 | 31,832 | Barrel and tube: 12 to 72. Pump: 16 to 64. | Three 2048 maps before and after. |
| Revolver | 1,982 | 28,158 | Main cylinder and barrel: 16 to 64. | Three 2048 maps before and after. |

Smaller internal circular loops remain below 64 segments. The main-section count does not certify every internal loop.

## G1 and G2, every angle

| Weapon | Yaw | IoU | Added exterior area | Mean Lab difference | SSIM |
| --- | ---: | ---: | ---: | ---: | ---: |
| shotgun | 0 | 0.990865 | 0.9120% | 0.622543 | 0.980602424 |
| shotgun | 45 | 0.997635 | 0.0305% | 0.656627 | 0.981192587 |
| shotgun | 90 | 0.996058 | 0.0519% | 0.899852 | 0.949781097 |
| shotgun | 135 | 0.997610 | 0.0331% | 0.785895 | 0.963894578 |
| shotgun | 180 | 0.990825 | 0.9140% | 0.736835 | 0.970136749 |
| shotgun | 225 | 0.997534 | 0.0446% | 0.780677 | 0.974438184 |
| shotgun | 270 | 0.993930 | 0.0347% | 1.196250 | 0.972887721 |
| shotgun | 315 | 0.997377 | 0.0420% | 0.793494 | 0.978566296 |
| revolver | 0 | 0.999650 | 0.0175% | 0.533865 | 0.979121723 |
| revolver | 45 | 0.999279 | 0.0267% | 0.631819 | 0.972460652 |
| revolver | 90 | 0.993108 | 0.6940% | 0.590598 | 0.950340429 |
| revolver | 135 | 0.999151 | 0.0402% | 0.496727 | 0.979002594 |
| revolver | 180 | 0.999594 | 0.0182% | 0.420070 | 0.983181160 |
| revolver | 225 | 0.999535 | 0.0018% | 0.457971 | 0.981756806 |
| revolver | 270 | 0.990918 | 0.9067% | 0.461727 | 0.966113996 |
| revolver | 315 | 0.999577 | 0.0009% | 0.545417 | 0.977981935 |

G1 requires IoU at least 0.985 and added exterior area below two percent.
G2 requires mean Lab difference at most 2.0 and SSIM at least 0.95.
The gate JSON lists each added part and its measured exterior area at all eight angles.

## Gate outcome

| Gate | Shotgun | Revolver |
| --- | --- | --- |
| G1 | PASS: Eight angles | PASS: Eight angles |
| G2 | FAIL: Minimum SSIM 0.949781097 | PASS: Minimum SSIM 0.950340429 |
| G3 | PASS: Gradient ratio 2.188661; AO contrast 1.000 | PASS: Gradient ratio 2.037117; AO contrast 1.000 |
| G4 | FAIL: Coplanar fraction 27.568644% | FAIL: Coplanar fraction 30.500622% |
| G5 | PASS: Frame delta +0.098779 ms; one draw | PASS: Frame delta +0.098779 ms; one draw |
| G6 | FAIL: Opened. Photo detail remains unresolved. | FAIL: Opened. Photo detail remains unresolved. |

G3 measures normal-map gradients over the complete map. AO contrast uses occupied UV pixels.
The distinct high sources contain geometric relief absent from the low meshes.
G4 counts all manifold edges below one degree after welding and triangulation. Its limit remains eight percent.
G5 retains three 2048 images and one material primitive per weapon.
G6 remains failed for both weapons. The crops do not match the photographs within five percent.

## Per-part triangle table

Counts below are the exported low mesh counts. Repeated hardware appears as separate parts.

| Weapon | Part | Triangles | Measured section segments | Purpose |
| --- | --- | ---: | --- | --- |
| shotgun | Ejection_Port | 420 |  | Original feature with edge bevels |
| shotgun | Fore_Stock | 2,560 | 64 | Round perimeter and bevels |
| shotgun | Bolt | 3,360 |  | Original feature with edge bevels |
| shotgun | Trigger | 740 |  | Original feature with edge bevels |
| shotgun | Receiver and stock | 6,832 |  | Original feature with edge bevels |
| shotgun | Bead | 640 |  | Original feature with edge bevels |
| shotgun | Bead base | 280 |  | Original feature with edge bevels |
| shotgun | Trigger guard | 3,868 |  | Original feature with edge bevels |
| shotgun | Magazine tube and cap | 4,960 | 72 | Round perimeter and bevels |
| shotgun | Barrel | 2,880 | 72 | Round perimeter and bevels |
| shotgun | Receiver pin 1 side -1 | 764 | 64 | Added visible hardware |
| shotgun | Receiver pin 1 side 1 | 764 | 64 | Added visible hardware |
| shotgun | Receiver pin 2 side -1 | 764 | 64 | Added visible hardware |
| shotgun | Receiver pin 2 side 1 | 764 | 64 | Added visible hardware |
| shotgun | Shell lifter visual | 188 |  | Added visible hardware |
| shotgun | Front sling eye | 1,024 | 64 | Added visible hardware |
| shotgun | Stock sling eye | 1,024 | 64 | Added visible hardware |
| revolver | Hammer | 874 |  | Original feature with edge bevels |
| revolver | LOW_CHamberLock | 572 |  | Original feature with edge bevels |
| revolver | LOW_CHamberRotate | 390 |  | Original feature with edge bevels |
| revolver | REV_Cylinder | 8,608 | 64 | Round perimeter and bevels |
| revolver | REV_Frame | 6,662 | 64 | Round perimeter and bevels |
| revolver | REV_Handle | 2,604 |  | Original feature with edge bevels |
| revolver | REV_Trigger | 620 |  | Original feature with edge bevels |
| revolver | Frame screw 1 side -1 | 764 | 64 | Added visible hardware |
| revolver | Frame screw 1 side 1 | 764 | 64 | Added visible hardware |
| revolver | Frame screw 2 side -1 | 764 | 64 | Added visible hardware |
| revolver | Frame screw 2 side 1 | 764 | 64 | Added visible hardware |
| revolver | Frame screw 3 side -1 | 764 | 64 | Added visible hardware |
| revolver | Frame screw 3 side 1 | 764 | 64 | Added visible hardware |
| revolver | Ejector rod | 764 | 64 | Added visible hardware |
| revolver | Ejector collar | 764 | 64 | Added visible hardware |
| revolver | Cylinder release | 188 |  | Added visible hardware |
| revolver | Grip escutcheon side -1 | 764 | 64 | Added visible hardware |
| revolver | Grip escutcheon side 1 | 764 | 64 | Added visible hardware |

## Added features

Shotgun: four receiver pin heads, a visual shell lifter, two sling eyes, and baked pump and grain relief.
The base already contained the ejection port, trigger group, bead sight, and stock seam. Their edges were refined.
Revolver: six frame screw heads, ejector rod and collar, cylinder release, and two grip escutcheons.
The high source adds flute relief, grain, grip texture, and hammer texture.
The existing trigger guard receives bevels. It was not replaced with a new mechanical assembly.

## Rounds

| Round | Fixed | Still different |
| --- | --- | --- |
| 0 | Recorded untouched originals and references. | Low polygon sections and weak detail. |
| 1 | Refined arcs and transferred corner normals. | Silhouette drift and unfinished materials. |
| 2 | Added hardware and separate high-source bakes. | Grip facets and pale wood. |
| 3 | Corrected geometry build and removed base-shading patches. | Broad grain and insufficient normal detail. |
| 4 | Retained source UVs and recomputed relief normals. | Uniform wood and incomplete ring refinement. |
| 5 | Restored CC0 grain and audited circular sections. | Incorrect grip grain direction and small segment counts. |
| 6 | Measured round sections and corrected tangent shading. | Shotgun SSIM, both topology gates, and photo detail. |

## Frame time and verification

Original visible fixture: 27.226630 ms mean. Final fixture: 27.325410 ms mean.
Delta: +0.098779 ms. Final p95: 29.900 ms.
GPU mean: 0.591113 ms before; 0.618320 ms after.
Both fixtures submit all 24 live enemies to the main camera. Browser errors and missing resources are zero.
The final fixture is about 36.6 fps. It does not reach 60 fps.
These are Linux RTX 3090 Ti measurements. They do not establish MacBook or Bunker 7 performance.
The visible baseline uses the repaired lab and original weapon meshes. It does not measure initial project loading.
All 276 tests pass. Kite3D Playable, Editable, and Persisted pass. The final check records zero console errors.
The saved scene keeps all previous node properties and adds only the two candidate nodes.

## Remaining visual work

Cylinder flutes need stronger shaped boundaries. Grip diamonds and hammer checkering need cleaner definition.
Small internal loops still need refinement. Some high-source bake patches remain visible in close inspection.
The blued surfaces are too dark under the current lab lighting. Both assets remain below KF2 first-person quality.

## Evidence and node names

Opened final contact: `tools/blender/hd/rounds/round-6-contact.jpg`.
Opened lab pairs: `docs/evidence/weapons-hd/shotgun-rack.png` and `docs/evidence/weapons-hd/revolver-rack.png`.
Final gate: `tools/blender/hd/rounds/gate-6.json`. Full opened image review: `tools/blender/hd/ROUNDS.md`.

- `Candidate shotgun 3dmodels-cc0-hd`
- `Candidate revolver loafbrr-cc0-hd`

Each new node sits one metre beside its original. Height and rotation match.
