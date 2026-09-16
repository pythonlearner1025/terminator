"""Write the review table from measured gate data. Do not turn failures into passes."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[3]
folder=ROOT/'tools/blender/hd'
gate=json.loads((folder/'rounds/gate-6.json').read_text())
base=json.loads((folder/'rounds/performance-visible-original-0.json').read_text())
after=json.loads((folder/'rounds/performance-visible-hd-6.json').read_text())
lines=['# Weapon HD acceptance report','','Status: INCOMPLETE. These drafts do not meet every acceptance gate.','The six-round limit is reached. No failed gate is reported as a pass.','','## Before and after','','| Weapon | Original triangles | Final triangles | Main round sections | Runtime maps |','| --- | ---: | ---: | --- | --- |',
'| Shotgun | 1,740 | 31,832 | Barrel and tube: 12 to 72. Pump: 16 to 64. | Three 2048 maps before and after. |',
'| Revolver | 1,982 | 28,158 | Main cylinder and barrel: 16 to 64. | Three 2048 maps before and after. |','','Smaller internal circular loops remain below 64 segments. The main-section count does not certify every internal loop.','','## G1 and G2, every angle','','| Weapon | Yaw | IoU | Added exterior area | Mean Lab difference | SSIM |','| --- | ---: | ---: | ---: | ---: | ---: |']
for weapon,data in gate['weapons'].items():
 for a,b in zip(data['G1']['angles'],data['G2']['angles']):
  lines.append(f"| {weapon} | {a['yaw']} | {a['IoU']:.6f} | {a['addedMaskAreaFraction']*100:.4f}% | {b['meanLab']:.6f} | {b['SSIM']:.9f} |")
lines+=['','G1 requires IoU at least 0.985 and added exterior area below two percent.','G2 requires mean Lab difference at most 2.0 and SSIM at least 0.95.','The gate JSON lists each added part and its measured exterior area at all eight angles.','','## Gate outcome','','| Gate | Shotgun | Revolver |','| --- | --- | --- |']
for g in ['G1','G2','G3','G4','G5','G6']:
 fields=[]
 for w,d in gate['weapons'].items():
  item=d[g];result='PASS' if item['pass'] else 'FAIL'
  if g=='G1':note='Eight angles'
  elif g=='G2':note=f"Minimum SSIM {min(a['SSIM'] for a in item['angles']):.9f}"
  elif g=='G3':note=f"Gradient ratio {item['gradientRatio']:.6f}; AO contrast {item['aoP95MinusP5']:.3f}"
  elif g=='G4':note=f"Coplanar fraction {item['coplanarFraction']*100:.6f}%"
  elif g=='G5':note=f"Frame delta {item['frameTimeDeltaMs']:+.6f} ms; one draw"
  else:note='Opened. Photo detail remains unresolved.'
  fields.append(result+': '+note)
 lines.append('| '+g+' | '+' | '.join(fields)+' |')
lines+=['','G3 measures normal-map gradients over the complete map. AO contrast uses occupied UV pixels.','The distinct high sources contain geometric relief absent from the low meshes.','G4 counts all manifold edges below one degree after welding and triangulation. Its limit remains eight percent.','G5 retains three 2048 images and one material primitive per weapon.','G6 remains failed for both weapons. The crops do not match the photographs within five percent.','','## Per-part triangle table','','Counts below are the exported low mesh counts. Repeated hardware appears as separate parts.','','| Weapon | Part | Triangles | Measured section segments | Purpose |','| --- | --- | ---: | --- | --- |']
for weapon,data in gate['weapons'].items():
 for p in data['G4']['parts']:
  segments=sorted(set(a['measuredSegments'] for a in p.get('circularSections',[])))
  seg=', '.join(map(str,segments)) if segments else str(p.get('segments') or '')
  reason='Added visible hardware' if p.get('added') else ('Round perimeter and bevels' if segments else 'Original feature with edge bevels')
  lines.append(f"| {weapon} | {p['name']} | {p['triangles']:,} | {seg} | {reason} |")
lines+=['','## Added features','','Shotgun: four receiver pin heads, a visual shell lifter, two sling eyes, and baked pump and grain relief.','The base already contained the ejection port, trigger group, bead sight, and stock seam. Their edges were refined.','Revolver: six frame screw heads, ejector rod and collar, cylinder release, and two grip escutcheons.','The high source adds flute relief, grain, grip texture, and hammer texture.','The existing trigger guard receives bevels. It was not replaced with a new mechanical assembly.','','## Rounds','','| Round | Fixed | Still different |','| --- | --- | --- |',
'| 0 | Recorded untouched originals and references. | Low polygon sections and weak detail. |',
'| 1 | Refined arcs and transferred corner normals. | Silhouette drift and unfinished materials. |',
'| 2 | Added hardware and separate high-source bakes. | Grip facets and pale wood. |',
'| 3 | Corrected geometry build and removed base-shading patches. | Broad grain and insufficient normal detail. |',
'| 4 | Retained source UVs and recomputed relief normals. | Uniform wood and incomplete ring refinement. |',
'| 5 | Restored CC0 grain and audited circular sections. | Incorrect grip grain direction and small segment counts. |',
'| 6 | Measured round sections and corrected tangent shading. | Shotgun SSIM, both topology gates, and photo detail. |','','## Frame time and verification','',
f"Original visible fixture: {base['frameIntervalMs']['mean']:.6f} ms mean. Final fixture: {after['frameIntervalMs']['mean']:.6f} ms mean.",
f"Delta: {after['frameIntervalMs']['mean']-base['frameIntervalMs']['mean']:+.6f} ms. Final p95: {after['frameIntervalMs']['p95']:.3f} ms.",
f"GPU mean: {base['gpuFrameMs']['mean']:.6f} ms before; {after['gpuFrameMs']['mean']:.6f} ms after.",
'Both fixtures submit all 24 live enemies to the main camera. Browser errors and missing resources are zero.',
'The final fixture is about 36.6 fps. It does not reach 60 fps.',
'These are Linux RTX 3090 Ti measurements. They do not establish MacBook or Bunker 7 performance.',
'The visible baseline uses the repaired lab and original weapon meshes. It does not measure initial project loading.',
'All 276 tests pass. Kite3D Playable, Editable, and Persisted pass. The final check records zero console errors.',
'The saved scene keeps all previous node properties and adds only the two candidate nodes.',
'', '## Remaining visual work','','Cylinder flutes need stronger shaped boundaries. Grip diamonds and hammer checkering need cleaner definition.','Small internal loops still need refinement. Some high-source bake patches remain visible in close inspection.','The blued surfaces are too dark under the current lab lighting. Both assets remain below KF2 first-person quality.','','## Evidence and node names','','Opened final contact: `tools/blender/hd/rounds/round-6-contact.jpg`.','Opened lab pairs: `docs/evidence/weapons-hd/shotgun-rack.png` and `docs/evidence/weapons-hd/revolver-rack.png`.','Final gate: `tools/blender/hd/rounds/gate-6.json`. Full opened image review: `tools/blender/hd/ROUNDS.md`.','','- `Candidate shotgun 3dmodels-cc0-hd`','- `Candidate revolver loafbrr-cc0-hd`','','Each new node sits one metre beside its original. Height and rotation match.']
(folder/'REPORT.md').write_text('\n'.join(lines)+'\n')
