from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parents[3];rows=json.loads((ROOT/'tools/blender/external/candidates.json').read_text())
text=['# Downloaded weapon candidates','','All archives remain under ignored `tools/blender/cache/external/`.','The triangle count describes the converted display asset, not its unused props.','No mesh was decimated. Original geometry was already below 30,000 triangles.','','| Weapon / candidate | Source URL | Author | License | Source format | Triangles | Textures | Shippable |','| --- | --- | --- | --- | --- | ---: | --- | --- |']
license_rows=[]
for c in rows:
 base=Path('assets/models/weapons-candidates'if c['shippable']else'assets/reference/weapons')/c['weapon']/c['id'];report=json.loads((ROOT/base/'conversion.json').read_text())
 fmt=Path(c['file']).suffix[1:].upper()
 if c['id']=='kf2-1858-reference':fmt='MDL/VVD/VTX/VTF through SourceIO BLEND'
 size=', '.join(sorted(set(str(v[0])+'x'+str(v[1])for v in report['sourceTextureSizes'].values())))
 text.append(f'| {c["weapon"]} / {c["id"]} | {c["source"]} | {c["author"]} | {c["license"]} | {fmt} | {report["triangles"]:,} | Source {size}; separate 2048 albedo, normal, roughness, metalness, AO, ORM | {"yes"if c["shippable"]else"no"} |')
 if c['shippable']:
  for f in sorted((ROOT/base).iterdir()):
   if f.suffix in ['.png','.gltf','.bin','.json']:
    license_rows.append(f'| `{f.relative_to(ROOT)}` | {c["author"]} | {c["license"]} | [{c["id"]}]({c["source"]}) |')
text+=['','## Access attempts','','| Site / item | Result |','| --- | --- |',
'| The Models Resource, KF2 | Public ZIPs downloaded. AA-12 and utility knife converted. The KF2 index has no 1858 entry. |',
'| p3dm.ru, Boomstick model 18510 | Public page lists FBX/TGA, Tripwire, personal use only. Download endpoint 7518 returned HTML, not an archive. |',
'| GameBanana, mod 589022 | Public API and ZIP succeeded. SourceIO imported the first-person KF2 1858 MDL and VTF maps. |',
'| Sketchfab, rivetech Remington 1858 0ca1c88c62d047228562a4b26d95e686 | Page offers CC Attribution. Anonymous download API returned HTTP 401. Skipped authentication. |',
'| Sketchfab, M79 f1309916894a45e3ae6eb24f17f728d4 | Page offers CC Attribution. Anonymous download API returned HTTP 401. |',
'| Sketchfab, tomian Remington 1858 4ba5b953981d4d7e921209a4a1baa898 | Public listing shows 376,100 triangles. No download option appeared. |',
'| Sketchfab, KF2 uploads | Search found no usable anonymous KF2 1858 download. Used the GameBanana port instead. |',
'| Fab search, Remington 1858 | HTTP 403. No account or captcha attempt. |',
'| Smithsonian 3D search, Remington | HTTP 403. No museum scan downloaded. Existing photograph remains the physical reference. |',
'| itch.io, 3DModelsCC0 pack | Public zero-price flow downloaded Guns&Explosives.rar, 162,200,198 bytes. |',
'| itch.io, Stein Games Classic Weapons Pack | Public zero-price flow downloaded version 1.1, 130,441,022 bytes. M14 stays reference-only pending provenance. |',
'| itch.io, Top Bit Studios Hand Cannon | Page accessible. Medieval hand cannon does not match these weapon classes. Not downloaded. |',
'| OpenGameArt | Direct ZIP, BLEND, and 7z downloads succeeded. Primary pages supply the license claims. |',
'','## Scope and conversion limits','',
'Four licensed revolvers are comparison alternatives, not Remington 1858 replacements.',
'The M79 search did not produce an anonymous downloadable model. The launcher reference includes a Danish rifle and underbarrel launcher.',
'The M14 uses source material names WPN_MS16_L and WPN_ATT_BULLETS_01. Its claimed CC0 provenance needs clarification.',
'CC-BY-SA is reference-only under the owner policy. This classification does not assert that the license forbids commerce.',
'Original 1K textures are resized to 2K. Resizing does not create extra detail.',
'Legacy specular maps receive approximate roughness and metalness conversions. Missing AO uses neutral white.',
'Pavel includes an unused spare-cylinder prop. The display conversion removes that detached prop without simplifying the weapon.',
'Loafbrr uses the closed rest pose. The sniper magazine moves 35 mm into the supplied receiver.',
'All candidate meshes keep their source names. Display roots provide static grip pivots and metre normalization.',
'KF2 1858 uses 355 mm overall length. The 203 mm barrel has not been independently calibrated from source vertices.',
'','## Disk locations and lab nodes','','| Candidate | Converted file | Saved lab node |','| --- | --- | --- |']
for c in rows:
 base='assets/models/weapons-candidates'if c['shippable']else'assets/reference/weapons';text.append(f'| {c["weapon"]} / {c["id"]} | `{base}/{c["weapon"]}/{c["id"]}/{c["id"]}.gltf` | `Candidate {c["weapon"]} {c["id"]}` |')
text+=['','The editor replaces spaces with underscores in imported node names. Find all nodes below `Candidates`.']
(ROOT/'tools/blender/external/SOURCES.md').write_text('\n'.join(text)+'\n')
p=ROOT/'assets/LICENSES.md';existing=p.read_text();marker='\n## External weapon candidate files\n';existing=existing.split(marker)[0]
p.write_text(existing+marker+'\nModels and source textures retain these licenses. Conversion changes scale, pose, format, and texture packing.\n\n| File | Author | License | Source |\n| --- | --- | --- | --- |\n'+'\n'.join(license_rows)+'\n')
print('Wrote source ledger and per-file license entries.')
