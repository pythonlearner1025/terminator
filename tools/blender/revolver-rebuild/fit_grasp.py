"""Bounded coordinate-descent of source controls using evaluated skin + gun barrier.
No topology/weight edits. Review is mandatory; this numerical objective is not approval.
"""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import imported_hands as h
from assemble import module
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
gun=module(sys.argv[sys.argv.index('--')+1],'gun').build_gun();hands=h.build_hands({'anchors':gun['anchors']})
bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();trees=[]
for obj in gun['objects'].values():
 if obj.name not in ('Body','GripCore','TriggerGuard','Cylinder','Trigger','Frame'):continue
 points=[obj.matrix_world@v.co for v in obj.data.vertices];bounds=([min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)])
 trees.append((obj.name,BVHTree.FromPolygons(points,[list(p.vertices) for p in obj.data.polygons]),bounds))
results=json.loads((h.SOURCE/'grasp-fit.json').read_text()) if (h.SOURCE/'grasp-fit.json').exists() else {};meshobj=hands['meshes'][0]
bpy.context.view_layer.update();ev=meshobj.evaluated_get(dg);skin=ev.to_mesh();points=[ev.matrix_world@v.co for v in skin.vertices]
right_ids={v.index for v in meshobj.data.vertices if sum(g.weight for g in v.groups if meshobj.vertex_groups[g.group].name.startswith('R_'))>.5}
right_tree=BVHTree.FromPolygons(points,[list(p.vertices) for p in skin.polygons if all(i in right_ids for i in p.vertices)])
right_bounds=([min(points[j][i] for j in right_ids) for i in range(3)],[max(points[j][i] for j in right_ids) for i in range(3)]);ev.to_mesh_clear()
for side,digit,target in [('R','index',(.053,-.0015,.002)),('R','thumb',(.064,.027,.008)),('R','middle',(.113,-.022,-.023)),('R','ring',(.119,-.023,-.042)),('R','little',(.127,-.021,-.064)),('L','thumb',(.067,-.034,.001)),('L','index',(.092,.033,-.036)),('L','middle',(.098,.032,-.053)),('L','ring',(.11,.027,-.072)),('L','little',(.121,.023,-.087))]:
 if '--right-fingers' in sys.argv and (side!='R' or digit=='thumb'):continue
 if '--support-only' in sys.argv and side!='L':continue
 if '--grip-only' in sys.argv and (side!='R' or digit not in ('middle','ring','little')):continue
 if '--thumb-only' in sys.argv and (side,digit)!=('R','thumb'):continue
 if side+':'+digit in results and digit=='thumb':target=results[side+':'+digit]['target']
 desired_height=target[2]
 ids=h.pad_indices(hands,side,digit);names=hands['mapping'][side][digit]['joints'];base=[hands['fit_rest'][n].copy() for n in names];target=Vector(target)
 groups={g.index for g in meshobj.vertex_groups if g.name in names};check=[v.index for v in meshobj.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.05]
 params=([20,80,40,-20,-20] if digit=='index' and side=='R' else [15,20,15,0,0] if digit=='thumb' else [55,40,15,0,0]);limits=[(-30,75),(-25,95),(-20,85),(-25,25),(-25,25)]
 if side+':'+digit in results:params=results[side+':'+digit]['params'].copy()
 if side=='R' and digit in ('middle','ring','little'):
  surf=gun['objects']['GripLeft'];pts=[surf.matrix_world@v.co for v in surf.data.vertices];tree=BVHTree.FromPolygons(pts,[list(p.vertices) for p in surf.data.polygons]);tree_grip=tree;probe=target.copy();probe.y=-.1;point,normal,_,_=tree.find_nearest(probe);target=point+Vector((0,-.0006,0))
  if digit=='middle':params=[30,65,9,-19,-24]

 def score(p):
  for i,n in enumerate(names):
   mat=base[i]@Matrix.Rotation(math.radians(-p[i]),4,'X')
   if i==0:mat=mat@Matrix.Rotation(math.radians(p[3]),4,'Y')@Matrix.Rotation(math.radians(p[4]),4,'Z')
   hands['controls'][n].matrix_basis=mat
  bpy.context.view_layer.update();ev=meshobj.evaluated_get(dg);mesh=ev.to_mesh();world=ev.matrix_world;pad=sum((world@mesh.vertices[i].co for i in ids),Vector())/len(ids)
  depth=[]
  for idx in check:
   pt=world@mesh.vertices[idx].co
   for _,tree,bounds in trees+([('RightSkin',right_tree,right_bounds)] if side=='L' else []):
    if not all(bounds[0][i]<pt[i]<bounds[1][i] for i in range(3)):continue
    q,n,_,d=tree.find_nearest(pt)
    if (pt-q).dot(n)<0:depth.append(d)
  ev.to_mesh_clear();guide=0
  if side=='R' and digit=='index':
   joint_target=hands['controls'][names[0]].matrix_world.translation.lerp(target,.42);joint_target.y=max(.025,joint_target.y);joint_target.z=min(-.003,joint_target.z)
   guide=.3*(hands['controls'][names[1]].matrix_world.translation-joint_target).length_squared
  if side=='L' and digit!='thumb':guide=3*(pad.z-desired_height)**2
  if side=='R' and digit in ('middle','ring','little'):guide=5*(pad.z-desired_height)**2
  if side=='R' and digit=='thumb':
   joint=hands['controls'][names[1]].matrix_world.translation
   guide=2*max(joint.y+.012,0)**2*(max(.045-joint.z,0)/.045)**2+2*max(.140-joint.x,0)**2
  if side=='R' and digit in ('middle','ring','little'):
   point,normal,_,_=tree_grip.find_nearest(pad);goal=point+normal*.0006
  elif side=='L' and digit!='thumb':
   point,normal,_,_=right_tree.find_nearest(pad);goal=point+normal*.0008
  else:goal=target
  return guide+(pad-goal).length_squared+12*sum(d*d for d in depth)/max(1,len(check))+20*max(depth,default=0)**2+sum((x/90)**2 for x in p)*.000000005
 seeds=[params.copy()]
 if digit=='thumb':seeds += [[-10,55,35,-15,20],[-20,35,55,15,-20],[10,40,30,0,0]]
 if side=='R' and digit=='index':seeds += [[0,80,50,-10,-10],[20,50,40,0,-20],[-10,70,50,-25,-35]]
 best_params=None;best_cost=float('inf')
 for seed in seeds:
  params=seed.copy()
  for step in (24,12,6,3,1):
   for _ in range(4):
    changed=False
    for i in range(5):
     best=score(params);value=params[i]
     for delta in (-step,step):
      test=params.copy();test[i]=max(limits[i][0],min(limits[i][1],value+delta));cost=score(test)
      if cost<best:best=cost;params[i]=test[i];changed=True
    if not changed:break
  cost=score(params)
  if cost<best_cost:best_cost=cost;best_params=params.copy()
 params=best_params
 cost=score(params);results[side+':'+digit]={'params':params,'ids':ids,'target':list(target),'pad':list(h.pad_center(hands,ids)),'objective':cost};print(side,digit,results[side+':'+digit],flush=True)
(HERE/'generated/grasp-fit.json').write_text(json.dumps(results,indent=2))
