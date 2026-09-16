"""Hands-only geometry, skin-surface collision and source data validation."""
import bpy,bmesh,json,importlib.util,sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(HERE/('generated/hands/hands-fitted.blend' if '--fitted' in sys.argv else 'generated/hands/hands.blend')))
rig=bpy.data.objects['HandsRig'];meta=json.loads(rig['handsMetadata']);deps=bpy.context.evaluated_depsgraph_get();report={'meshValidation':{},'handContact':{}}
meshes=[bpy.data.objects[n+s] for s in ('Right','Left') for n in ('HandMesh','Sleeve')]
if '--finalize' in sys.argv:
    spec=importlib.util.spec_from_file_location('hands_finish',HERE/'hands.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    assert helper.apply_baked_materials(meshes,HERE/'generated/hands')
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'generated/hands/hands.blend'))
for obj in meshes:
    copy=obj.data.copy();report['meshValidation'][obj.name]={'blenderChangedInvalidData':copy.validate(verbose=True)};bpy.data.meshes.remove(copy)
    obj.data.calc_loop_triangles();uv=obj.data.uv_layers.active.data;collapsed=[]
    for tri in obj.data.loop_triangles:
        a,b,c=[uv[i].uv for i in tri.loops];area=abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))*.5
        if area<=1e-12:collapsed.append(tri.index)
    report['meshValidation'][obj.name]['collapsedUVTriangles']=collapsed
for side,other in [('Right','Left'),('Left','Right')]:
    target=bpy.data.objects['HandMesh'+other].evaluated_get(deps);tm=target.to_mesh()
    tree=BVHTree.FromPolygons([target.matrix_world@v.co for v in tm.vertices],[p.vertices[:] for p in tm.polygons]);target.to_mesh_clear()
    obj=bpy.data.objects['HandMesh'+side].evaluated_get(deps);mesh=obj.to_mesh();samples=[]
    for digit,ids in meta['padVertexIndices'][side].items():
        distances=[];signed=[];normals=[]
        for i in ids:
            co=obj.matrix_world@mesh.vertices[i].co;loc,n,face,d=tree.find_nearest(co);distances.append(d);signed.append((co-loc).dot(n));normals.append(list(n))
        report['handContact'][side+digit]={'minDistance':min(distances),'minSignedNearestFaceGap':min(signed),'deepestOutwardNormal':normals[signed.index(min(signed))]}
    obj.to_mesh_clear()
(HERE/'generated/hands/hand-surface-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
spec=importlib.util.spec_from_file_location('hands',HERE/'hands.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
contract=json.loads((HERE/'generated/hands/hands-contract.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
fresh=h.build_hands({'anchors':contract['anchors']})
report['rebuildTextureMatch']={'uvSignature':h.uv_signature(fresh['meshes']),'materials':fresh['metadata']['materials']}
(HERE/'generated/hands/hand-surface-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print('REBUILD ATLAS',report['rebuildTextureMatch'])

contract['surfaceAudit']=report
contract['sourceSha256']=__import__('hashlib').sha256((HERE/'hands.py').read_bytes()).hexdigest()
(HERE/'generated/hands/hands-contract.json').write_text(json.dumps(contract,indent=2)+'\n')
Path('/home/minjune/games/terminator-v2/coordination/revolver-hands-contract.json').write_text(json.dumps(contract,indent=2)+'\n')
