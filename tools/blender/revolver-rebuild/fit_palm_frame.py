"""Bounded rigid palm-placement search in the accepted opposition orientation.
No bone lengths or skin data change. Finger contact still needs subsequent review.
"""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import imported_hands as h
from assemble import module
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
gun=module(sys.argv[sys.argv.index('--')+1],'gun').build_gun();hands=h.build_hands({'anchors':gun['anchors']});bpy.context.view_layer.update();ob=hands['meshes'][0];ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh()
names={hands['mapping']['R'][n]['joint'] for n in ('wrist','palm')};groups={g.index for g in ob.vertex_groups if g.name in names};ids=[v.index for v in ob.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.65]
points=[ev.matrix_world@mesh.vertices[i].co for i in ids];ev.to_mesh_clear();trees=[]
for name in ('GripCore','Body'):
 obj=gun['objects'][name];vs=[obj.matrix_world@v.co for v in obj.data.vertices];bounds=([min(p[i] for p in vs) for i in range(3)],[max(p[i] for p in vs) for i in range(3)])
 trees.append((BVHTree.FromPolygons(vs,[list(p.vertices) for p in obj.data.polygons]),bounds))
controls=hands['controls'];mapping=hands['mapping']['R'];wrist=controls[mapping['wrist']['joint']].matrix_world.translation.copy();index=controls[mapping['index']['joints'][0]].matrix_world.translation.copy();thumb=controls[mapping['thumb']['joints'][0]].matrix_world.translation.copy();target=Vector(gun['anchors']['TriggerContact']);back=Vector((.164,0,-.034))
def score(p):
 transform=Matrix.Translation(wrist+Vector(p[:3]))@Matrix.Rotation(p[3],4,'Y')@Matrix.Translation(-wrist)
 values=[];near=1
 for pt in points:
  pt=transform@pt;near=min(near,(pt-back).length)
  for tree,bounds in trees:
   if all(bounds[0][i]<pt[i]<bounds[1][i] for i in range(3)):
    q,n,_,d=tree.find_nearest(pt)
    if (pt-q).dot(n)<0:values.append(d)
 reach=((transform@index)-target).length
 thumb_pos=transform@thumb
 cost=12*sum(d*d for d in values)/len(points)+15*max(values,default=0)**2+20*max(reach-.091,0)**2+1.5*near*near+4*max(.157-thumb_pos.x,0)**2+2*max(thumb_pos.y-.025,0)**2+.0001*p[3]**2
 return cost,{'maxInside':max(values,default=0),'insideCount':len(values),'indexReach':reach,'backstrapGap':near,'thumbBase':list(thumb_pos),'transform':[list(r) for r in transform]}
rows=[]
for x in (-.01,0,.01,.02,.03):
 for y in (-.04,-.025,-.01,.005,.02,.035,.05):
  for z in (-.025,-.01,.005,.02):
   for pitch in (-.3,0,.3):
    p=[x,y,z,pitch];cost,stats=score(p);rows.append((cost,p,stats))
rows.sort(key=lambda r:r[0]);best=rows[0]
for step in (.006,.003,.001):
 p=best[1].copy()
 for _ in range(4):
  changed=False
  for i in range(4):
   for sign in (-1,1):
    q=p.copy();q[i]+=sign*step*(10 if i==3 else 1)
    if abs(q[3])>.4:continue
    cost,stats=score(q)
    if cost<best[0]:best=(cost,q,stats);p=q;changed=True
  if not changed:break
result={'best':best,'top':rows[:8],'baseline':score([0,0,0,0]),'limits':'Rigid source-palm search, fixed accepted yaw; visual review and finger refit still required.'};(HERE/'generated/palm-frame-fit.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
