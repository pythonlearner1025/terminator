"""Round-two geometric checks; measurements supplement the actual render review."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parent/'generated/gun';bpy.ops.wm.open_mainfile(filepath=str(P/'gun.blend'))
coll=bpy.data.collections['Rebuild'];required=['Body','Frame','Barrel','FrontSight','RearSight','GripLeft','GripRight','TriggerGuard','Crane','Cylinder','Ejector','Hammer','Trigger','Latch']
result={'exactRequiredNames':{n:sum(o.name==n for o in coll.all_objects) for n in required},'panels':{}}
g=bpy.data.objects['GripCore'];g.data.calc_loop_triangles();vs=[g.matrix_world@v.co for v in g.data.vertices];tree=BVHTree.FromPolygons(vs,[tuple(t.vertices) for t in g.data.loop_triangles],all_triangles=True)
for name in ['GripLeft','GripRight']:
 o=bpy.data.objects[name];o.data.calc_loop_triangles();dist=[]
 for t in o.data.loop_triangles:
  points=[o.matrix_world@o.data.vertices[i].co for i in t.vertices]
  for weights in [(1/3,1/3,1/3),(.6,.2,.2),(.2,.6,.2),(.2,.2,.6)]:
   p=sum((v*w for v,w in zip(points,weights)),Vector());near,n,idx,d=tree.find_nearest(p);dist.append((p-near).dot(n))
 result['panels'][name]={'sampleCount':len(dist),'minimumSignedClearance':min(dist),'maximumSignedClearance':max(dist),'samplesPenetratingBelowMinus10Microns':sum(d<-.00001 for d in dist)}
result['triangles']=sum(len(o.data.loop_triangles) for o in coll.all_objects if o.type=='MESH')
(P/'round2/geometry-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
