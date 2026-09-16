"""Package editable low and distinct high geometry. Runtime assets remain three-map glTFs."""
import bpy,sys,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(Path(__file__).parent))
from surface import atlas_material
ROUND=int(sys.argv[sys.argv.index('--')+1])
output=ROOT/'tools/blender/hd/sources';output.mkdir(exist_ok=True)
for weapon,slug in [('shotgun','3dmodels-cc0'),('revolver','loafbrr-cc0')]:
    folder=ROOT/f'.kite3d/hd/round-{ROUND}/{weapon}'
    bpy.ops.wm.open_mainfile(filepath=str(folder/'bake-source.blend'))
    low=next(o for o in bpy.context.scene.objects if o.name==weapon+' HD')
    high=bpy.data.objects['High relief source']
    for o in list(bpy.context.scene.objects):
        if o not in [low,high]:bpy.data.objects.remove(o,do_unlink=True)
    material=atlas_material(ROOT/f'assets/models/weapons-candidates/{weapon}/{slug}-hd','main')
    for o in [low,high]:
        o.data.materials.clear();o.data.materials.append(material)
        for p in o.data.polygons:p.material_index=0
    low.hide_render=False;high.hide_render=True;high.hide_set(True)
    high['purpose']='Distinct sculpted relief source. Unhide to inspect. Rebuild bakes using surface.py.'
    low['purpose']='Single-material runtime mesh with source UV layout and reserved hardware tiles.'
    bpy.data.orphans_purge(do_recursive=True)
    for image in bpy.data.images:
        if image.filepath:
            absolute=Path(bpy.path.abspath(image.filepath))
            import os
            image.filepath='//'+os.path.relpath(absolute,output)
    bpy.ops.wm.save_as_mainfile(filepath=str(output/f'{weapon}.blend'),compress=True,relative_remap=False)
    for kind in ['ao','curvature']:
        shutil.copyfile(folder/f'baked-{kind}.png',output/f'{weapon}-{kind}.png')
    report={k:json.loads((folder/f'{k}.json').read_text()) for k in ['bake','finish','export','parts']}
    (output/f'{weapon}.json').write_text(json.dumps(report,indent=2)+'\n')
