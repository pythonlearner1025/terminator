"""Export new single-material assets. Never replace a CC0 input."""
import bpy,sys,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(Path(__file__).parent))
from surface import atlas_material
ROUND=int(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else 2
for weapon,slug in [('shotgun','3dmodels-cc0'),('revolver','loafbrr-cc0')]:
    folder=ROOT/f'.kite3d/hd/round-{ROUND}/{weapon}'
    bpy.ops.wm.open_mainfile(filepath=str(folder/'low.blend'))
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    if len(meshes)!=1:raise RuntimeError('One mesh per weapon required')
    low=meshes[0];low.data.materials.clear();low.data.materials.append(atlas_material(folder,'main'))
    for p in low.data.polygons:p.material_index=0
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/'low.blend'))
    output=ROOT/f'assets/models/weapons-candidates/{weapon}/{slug}-hd';output.mkdir(parents=True,exist_ok=True)
    display=bpy.data.objects.new(slug+'-hd display',None);bpy.context.scene.collection.objects.link(display)
    low.parent=display
    bpy.ops.object.select_all(action='DESELECT');low.select_set(True);display.select_set(True);bpy.context.view_layer.objects.active=low
    bpy.ops.export_scene.gltf(filepath=str(output/f'{slug}-hd.gltf'),export_format='GLTF_SEPARATE',
        export_yup=True,export_animations=False,export_apply=True,export_extras=True,use_selection=True)
    path=output/f'{slug}-hd.gltf';doc=json.loads(path.read_text())
    for mat in doc.get('materials',[]):
        orm=mat.get('pbrMetallicRoughness',{}).get('metallicRoughnessTexture')
        if orm:mat['occlusionTexture']={**orm,'strength':1}
    path.write_text(json.dumps(doc,indent=2)+'\n')
    counts=sum(doc['accessors'][p['indices']]['count']//3 for m in doc['meshes'] for p in m['primitives'])
    draws=sum(len(m['primitives']) for m in doc['meshes'])
    if counts>40000:raise RuntimeError(f'{weapon}: {counts} triangles exceeds 40000')
    report=json.loads((ROOT/f'assets/models/weapons-candidates/{weapon}/{slug}/conversion.json').read_text())
    report.update(triangles=counts,derivativeOf=slug,derivativeAuthor='Codex, directed by the project owner',
        drawCalls=draws,textureResolution=2048,bakeRound=ROUND,
        sourceMeshNames=[p['name'] for p in json.loads((folder/'parts.json').read_text())],
        validation='Draft. Consult tools/blender/hd/rounds for measured gate failures.')
    (output/'conversion.json').write_text(json.dumps(report,indent=2)+'\n')
    (folder/'export.json').write_text(json.dumps({'triangles':counts,'drawCalls':draws,'textureMaps':[2048,2048,2048],
        'path':str(path.relative_to(ROOT))},indent=2)+'\n')
    print('EXPORTED',weapon,counts,draws,flush=True)
