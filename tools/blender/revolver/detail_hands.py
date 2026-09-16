"""Project glove borders and stitching onto the unified hand surface."""
rotation=Quaternion((1,0,0),.12)@Quaternion((0,1,0),pi+.10)
for side in ['Left','Right']:
 o=parts[side+'Palm'][0]
 if side=='Left':
  exec(compile((ROOT/'tools/blender/revolver/glove_mask.py').read_text(), 'glove_mask.py', 'exec'))
  o.data.materials.clear();o.data.materials.append(blend)
  for face in o.data.polygons:face.material_index=0
 tree=BVHTree.FromPolygons([v.co.copy()for v in o.data.vertices],[list(p.vertices)for p in o.data.polygons])
 points=[(590,434),(612,455),(637,481),(650,499)] if side=='Left' else [(720,445),(742,439),(776,459),(784,481),(762,492),(731,481),(720,445)]
 projected=[]
 for x,y in points:
  near,normal,_,_=tree.find_nearest(P(hand_trace(x,y,.46)));v=near+normal*.0007;projected.append(Vector((v.x,v.z,-v.y)))
 path_tube(side+' glove stitched border',projected,.0007,pad,side+'Palm',6)
 for a,b in zip(projected,projected[1:]):
  count=max(1,int((b-a).length/.004))
  for i in range(count):
   start=a.lerp(b,(i+.15)/count);end=a.lerp(b,(i+.50)/count)
   path_tube(side+' glove stitch',[start,end],.00034,pad,side+'Palm',4)
