"""Bounded rigid-roll contact diagnostic. Pads stay on the pinch axis; no mesh edits."""
import argparse,sys,json,math
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import bpy,assemble,animations
from mathutils import Vector
from mathutils.bvhtree import BVHTree
p=argparse.ArgumentParser();p.add_argument('--gun',required=True);p.add_argument('--hands',required=True);p.add_argument('--output',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
rig=assemble.assemble(assemble.module(a.gun,'rebuild_gun'),assemble.module(a.hands,'rebuild_hands'))
results=[]
for angle in [0,-30,30,-60,60,-90,90,-120,120,180]:
    rig['hands']['pinch_roll']=math.radians(angle);animations.sample(rig,'Reload',3.6*.67)
    deps=bpy.context.evaluated_depsgraph_get();body=bpy.data.objects['BodyGeometry'];ev=body.evaluated_get(deps);me=ev.to_mesh();tree=BVHTree.FromPolygons([ev.matrix_world@v.co for v in me.vertices],[p.vertices[:] for p in me.polygons]);ev.to_mesh_clear()
    obj=bpy.data.objects['HandMeshLeft'];ev=obj.evaluated_get(deps);me=ev.to_mesh();worst=0
    for ids in rig['hands']['metadata']['padVertexIndices']['Left'].values():
        for i in ids:
            co=ev.matrix_world@me.vertices[i].co;loc,n,face,d=tree.find_nearest(co);worst=min(worst,(co-loc).dot(n))
    ev.to_mesh_clear();results.append({'degrees':angle,'minimumSignedBodyGap':worst})
    assemble.render_sample(rig,'Reload',.67,out/('roll-'+str(angle)+'.png'),view='top-contact')
(out/'rolls.json').write_text(json.dumps(results,indent=2));print(results)
