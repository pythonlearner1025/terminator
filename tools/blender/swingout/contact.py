"""Mesh-aware finger fitting, executed only by the Blender build.

Five joint freedoms replace unconstrained 3-axis CCD at every joint. The distal
joints only hinge. The fit includes the actual weighted skin vertices, the moving
weapon surface, and the other digits. Export contains ordinary sampled bones.
"""
import numpy as np
from mathutils.bvhtree import BVHTree

contact_cache={}
finger_data={}
for side in ['Left','Right']:
 obj=next(o for o in hands if o.name.startswith(side))
 for finger in ['Thumb','Index','Middle','Ring','Little']:
  names=[side+finger+str(j) for j in [1,2,3]]
  ids={obj.vertex_groups[n].index for n in names if n in obj.vertex_groups}
  verts=[v for v in obj.data.vertices if sum(g.weight for g in v.groups if g.group in ids)>.6]
  finger_data[side+finger]=(obj,names,verts)

def rotation(axis,angle):
 return Quaternion(Vector(axis),float(angle)).to_matrix().to_4x4()

def constrained_contact(side,finger,target,weight=1):
 if weight<=.00001:return
 obj,names,verts=finger_data[side+finger]
 bones=[arm.pose.bones[n] for n in names];tip=arm.pose.bones[side+finger+'Tip']
 start=[b.matrix.copy() for b in bones]
 key=(side,finger,round(weight,4),tuple(round(x,5) for m in start for row in m for x in row),tuple(round(x,5) for x in target))
 if key in contact_cache:
  for b,m in zip(bones,contact_cache[key]):b.matrix=m;bpy.context.view_layer.update()
  return
 points=[b.head.copy() for b in bones]+[tip.head.copy()]
 desired=tip.head.lerp(target,weight)
 # Hinge planes follow the physical phalanges, not arbitrary imported bone tails.
 axes=[]
 for j in [1,2]:
  a=(points[j]-points[j-1]).normalized();b=(points[j+1]-points[j]).normalized()
  axis=a.cross(b)
  if axis.length<.01:axis=(points[1]-points[0]).cross(P((0,1,0)))
  if axis.length<.01:axis=Vector((0,1,0))
  axes.append(axis.normalized())
 # Finger skin and bind weights, including the fixed contribution from the palm.
 rest_inv=[rest[n].inverted() for n in names]
 weights=np.zeros((len(verts),3));local=np.zeros((3,len(verts),4));fixed=np.zeros((len(verts),3))
 for k,v in enumerate(verts):
  for g in v.groups:
   n=obj.vertex_groups[g.group].name
   if n in names:
    j=names.index(n);weights[k,j]=g.weight;local[j,k]=[* (rest_inv[j]@v.co),1]
   elif n in arm.pose.bones:fixed[k]+=np.array(delta(n)@v.co)*g.weight
 # Each moving part is already evaluated in the current pose.
 tree=BVHTree.FromObject(weapon,bpy.context.evaluated_depsgraph_get())
 contact_trees=[tree]
 if side=='Left':contact_trees.append(BVHTree.FromObject(next(o for o in hands if o.name.startswith('Right')),bpy.context.evaluated_depsgraph_get()))
 # Skin vertices have a 0.35-mm guard. Capsule guards prevent finger crossings.
 others=[]
 for other in ['Thumb','Index','Middle','Ring','Little']:
  if other==finger:continue
  chain=[arm.pose.bones[side+other+str(j)].head.copy() for j in [1,2,3]]+[arm.pose.bones[side+other+'Tip'].head.copy()]
  for a,b in zip(chain[1:],chain[2:]):others.append((np.array(a),np.array(b)))
 base_tip=start[2].inverted()@points[3]
 def evaluate(x,keep=False):
  q=Quaternion(Vector(x[:3]).normalized(),float(np.linalg.norm(x[:3]))) if np.linalg.norm(x[:3])>1e-9 else Quaternion()
  m0=Matrix.Translation(points[0])@q.to_matrix().to_4x4()@Matrix.Translation(-points[0])@start[0]
  d0=m0@start[0].inverted();p1=d0@points[1]
  m1=Matrix.Translation(p1)@rotation(d0.to_3x3()@axes[0],x[3])@Matrix.Translation(-p1)@d0@start[1]
  d1=m1@start[1].inverted();p2=d1@points[2]
  m2=Matrix.Translation(p2)@rotation(d1.to_3x3()@axes[1],x[4])@Matrix.Translation(-p2)@d1@start[2]
  mats=[m0,m1,m2];end=m2@base_tip
  skin=fixed.copy()
  for j in range(3):skin+=(local[j]@np.array(mats[j]).T)[:,:3]*weights[:,j,None]
  # Signed distance against actual skin. All vertices participate in the solve.
  barriers=[]
  for collider in contact_trees:
   for p in skin:
    co,n,_,dist=collider.find_nearest(Vector(p))
    signed=(Vector(p)-co).dot(n)
    barriers.append(max(0,.00035-signed)*3 if dist<.020 else 0)
  chain=np.array([points[0],p1,p2,end]);cross=[]
  for p in chain[2:]:
   for a,b in others:
    v=b-a;nearest=a+v*np.clip(np.dot(p-a,v)/max(np.dot(v,v),1e-12),0,1)
    cross.append(max(0,.012-np.linalg.norm(p-nearest))*2)
  bends=[]
  for j,limit in [(1,math.radians(100)),(2,math.radians(80))]:
   a=chain[j]-chain[j-1];b=chain[j+1]-chain[j]
   angle=math.acos(np.clip(np.dot(a,b)/max(np.linalg.norm(a)*np.linalg.norm(b),1e-9),-1,1))
   bends.append(max(0,angle-limit)*.04)
  residual=np.r_[np.array(end-desired)*2,barriers,cross,bends,x*.0018]
  return (residual,mats,skin) if keep else residual
 x=np.zeros(5);res=evaluate(x)
 # Damped least squares, bounded trust steps. No SciPy or external build dependency.
 for iteration in range(22):
  eps=.002;jac=np.column_stack([(evaluate(x+np.eye(5)[j]*eps)-res)/eps for j in range(5)])
  step=np.linalg.solve(jac.T@jac+np.eye(5)*.00003,-jac.T@res)
  step=np.clip(step,-.18,.18)
  candidate=np.clip(x+step,[-2,-2,-2,-2,-2],[2,2,2,2,2]);new=evaluate(candidate)
  if new@new>=res@res:
   candidate=x+(candidate-x)*.25;new=evaluate(candidate)
   if new@new>=res@res:break
  x,res=candidate,new
 _,mats,skin=evaluate(x,True)
 contact_cache[key]=[m.copy() for m in mats]
 for b,m in zip(bones,mats):b.matrix=m;bpy.context.view_layer.update()
 return float(np.linalg.norm(np.array(tip.head-desired)))

def fit_palm(side,other_hand=False):
 """Resolve the palm before curling digits; a fingertip solve cannot repair a buried wrist."""
 obj=next(o for o in hands if o.name.startswith(side));palm_id=obj.vertex_groups[side+'Palm'].index
 indices=[v.index for v in obj.data.vertices if any(g.group==palm_id and g.weight>.8 for g in v.groups)]
 for iteration in range(8):
  deps=bpy.context.evaluated_depsgraph_get();evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh()
  points=[mesh.vertices[i].co.copy() for i in indices];evaluated.to_mesh_clear()
  trees=[BVHTree.FromObject(weapon,deps)]
  if other_hand:trees.append(BVHTree.FromObject(next(o for o in hands if not o.name.startswith(side)),deps))
  correction=Vector();worst=0
  for tree in trees:
   for p in points:
    co,n,_,dist=tree.find_nearest(p);signed=(p-co).dot(n)
    if signed<.0005 and dist<.025:
     depth=.0005-signed
     if depth>worst:worst=depth;correction=n*min(.008,depth)
  if worst<.0001:break
  b=arm.pose.bones['Hand'+side];m=b.matrix.copy();m.translation+=correction;b.matrix=m;bpy.context.view_layer.update()
