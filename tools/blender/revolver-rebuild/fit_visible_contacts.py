"""Small native digit corrections to visually approved R1. Hidden palm volume is
reported separately; this fit does not move the approved wrist or whole hand.
"""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import imported_hands as h
from assemble import module
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
gun=module(sys.argv[sys.argv.index('--')+1],'gun').build_gun();hands=h.build_hands({'anchors':gun['anchors']});bpy.context.view_layer.update();ob=hands['meshes'][0];dg=bpy.context.evaluated_depsgraph_get();trees=[]
for name in ('Body','TriggerGuard','Cylinder'):
 obj=gun['objects'][name];pts=[obj.matrix_world@v.co for v in obj.data.vertices];bounds=([min(p[i] for p in pts) for i in range(3)],[max(p[i] for p in pts) for i in range(3)]);trees.append((BVHTree.FromPolygons(pts,[list(p.vertices) for p in obj.data.polygons]),bounds))
output={'controls':{},'contacts':{},'limits':'Visible distal contact correction only; hidden palm/gun overlap is documented, not certified collision-free.'}
for side,digit,target,seed in [('R','index',(.054,.001,.003),[5,35,20,0,0]),('L','thumb',(.118,-.043,.005),[-20,60,45,0,-15])]:
 names=hands['mapping'][side][digit]['joints'];base=[hands['fit_rest'][n] for n in names];ids=hands['pad_ids'][(side,digit)];groups={g.index for g in ob.vertex_groups if g.name in names[1:]};check=[v.index for v in ob.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.5];target=Vector(target);limits=[(-30,65),(-20,85),(-20,80),(-20,20),(-20,20)]
 def score(p):
  for i,n in enumerate(names):
   m=base[i]@Matrix.Rotation(math.radians(-p[i]),4,'X')
   if i==0:m=m@Matrix.Rotation(math.radians(p[3]),4,'Y')@Matrix.Rotation(math.radians(p[4]),4,'Z')
   hands['controls'][n].matrix_basis=m
  bpy.context.view_layer.update();ev=ob.evaluated_get(dg);mesh=ev.to_mesh();pad=sum((ev.matrix_world@mesh.vertices[i].co for i in ids),Vector())/len(ids);inside=[]
  for i in check:
   point=ev.matrix_world@mesh.vertices[i].co
   for tree,bounds in trees:
    if all(bounds[0][j]<point[j]<bounds[1][j] for j in range(3)):
     q,n,_,d=tree.find_nearest(point)
     if (point-q).dot(n)<0:inside.append(d)
  ev.to_mesh_clear();return (pad-target).length_squared+10*max(inside,default=0)**2+sum((p[i]-seed[i])**2 for i in range(5))*2e-10
 best=None
 for start in [seed,[seed[0],seed[1]+20,seed[2]-10,10,-10],[seed[0],seed[1]-10,seed[2]+20,-10,10]]:
  p=start.copy()
  for step in (12,6,3,1,.5):
   for _ in range(4):
    change=False
    for i in range(5):
     old=p[i];cost=score(p)
     for d in (-step,step):
      q=p.copy();q[i]=max(limits[i][0],min(limits[i][1],old+d));c=score(q)
      if c<cost:p=q;cost=c;change=True
    if not change:break
  cost=score(p)
  if best is None or cost<best[0]:best=(cost,p.copy())
 cost=score(best[1]);output['controls'].update({n:[list(row) for row in hands['controls'][n].matrix_basis] for n in names});output['contacts'][side+':'+digit]={'params':best[1],'pad':list(h.pad_center(hands,ids)),'target':list(target),'objective':cost};print(output['contacts'][side+':'+digit],flush=True)
(HERE/'generated/visible-contact-offsets.json').write_text(json.dumps(output,indent=2))
