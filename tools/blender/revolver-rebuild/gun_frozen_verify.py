"""Compare approved frozen grip geometry and articulation matrices with pre-fix blend."""
import bpy,json
from pathlib import Path
P=Path(__file__).resolve().parent/'generated/gun';bpy.ops.wm.open_mainfile(filepath=str(P/'gun.blend'))
names=['GripCore','GripLeft','GripRight','Body','Frame','Barrel','FrontSight','RearSight','TriggerGuard','Crane','Cylinder','Ejector','Hammer','Trigger','Latch']
current={n:bpy.data.objects[n] for n in names};mesh_names={o.data.name for n,o in current.items() if n.startswith('Grip')}
with bpy.data.libraries.load(str(P/'round3/before.blend'),link=False) as (src,dst):dst.objects=names
for o in dst.objects:bpy.context.scene.collection.objects.link(o)
bpy.context.view_layer.update()
report={'frozenGrip':{},'articulationMatricesIdentical':{}}
for old in dst.objects:
 new=current[old.name.removesuffix('.001')] if old.name.removesuffix('.001') in current else None
 # IDs may get another suffix if the immutable reference uses a legacy name.
 if new is None:new=next(current[n] for n in names if old.name.startswith(n+'.'))
 name=new.name
 report['articulationMatricesIdentical'][name]=all(abs(old.matrix_world[i][j]-new.matrix_world[i][j])==0 for i in range(4) for j in range(4))
 if name.startswith('Grip'):
  same_vertices=len(old.data.vertices)==len(new.data.vertices) and all(tuple(a.co)==tuple(b.co) for a,b in zip(old.data.vertices,new.data.vertices))
  same_faces=len(old.data.polygons)==len(new.data.polygons) and all(tuple(a.vertices)==tuple(b.vertices) for a,b in zip(old.data.polygons,new.data.polygons))
  report['frozenGrip'][name]={'vertexPositionsExactlyIdentical':same_vertices,'polygonTopologyExactlyIdentical':same_faces}
report['pass']=all(report['articulationMatricesIdentical'].values()) and all(all(v.values()) for v in report['frozenGrip'].values())
(P/'round3/frozen-verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));assert report['pass']
