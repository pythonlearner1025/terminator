"""Audit evaluated skin triangles, including interpolated poses between fitted keys."""
import bpy,json,os
from pathlib import Path
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[3]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'.kite3d/swingout.blend'))
arm=bpy.data.objects['SwingoutRig'];weapon=bpy.data.objects['Swingout_Mechanism']
hands=[o for o in bpy.context.scene.objects if 'Hand_and_Sleeve' in o.name]
rows=[]
def triangles(obj,deps):
 mesh=obj.evaluated_get(deps).to_mesh();mesh.calc_loop_triangles()
 verts=[v.co.copy() for v in mesh.vertices];polys=[tuple(t.vertices) for t in mesh.loop_triangles]
 tree=BVHTree.FromPolygons(verts,polys,all_triangles=True)
 obj.evaluated_get(deps).to_mesh_clear()
 return tree,verts,polys
for clip in ['Idle','Fire','Reload']:
 action=bpy.data.actions[clip];arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
 duration={'Idle':0,'Fire':.4,'Reload':2.6}[clip]
 for frame in range(round(duration*120)+1):
  bpy.context.scene.frame_set(frame+1);deps=bpy.context.evaluated_depsgraph_get();wt,wv,wp=triangles(weapon,deps)
  row={'clip':clip,'ms':round(frame/120*1000,3),'hands':{}};ht={}
  for hand in hands:
   side='Left' if hand.name.startswith('Left') else 'Right';tree,verts,polys=triangles(hand,deps);ht[side]=tree
   overlaps=tree.overlap(wt)
   depths=[]
   for vi in {v for hi,wi in overlaps for v in polys[hi]}:
    co,n,_,d=wt.find_nearest(verts[vi]);signed=(verts[vi]-co).dot(n)
    if signed<0:depths.append(-signed*1000)
   row['hands'][side]={'weaponTrianglePairs':len(overlaps),'maxInsideMM':round(max(depths,default=0),3),'selfTrianglePairs':sum(1 for a,b in tree.overlap(tree) if a<b and not set(polys[a]).intersection(polys[b]))}
  row['handTrianglePairs']=len(ht['Left'].overlap(ht['Right']));rows.append(row)
summary={clip:{'samples':sum(r['clip']==clip for r in rows),'framesWithWeaponCrossings':sum(any(h['weaponTrianglePairs'] for h in r['hands'].values()) for r in rows if r['clip']==clip),'maxInsideMM':max(h['maxInsideMM'] for r in rows if r['clip']==clip for h in r['hands'].values()),'maxSelfTrianglePairs':max(h['selfTrianglePairs'] for r in rows if r['clip']==clip for h in r['hands'].values()),'maxHandTrianglePairs':max(r['handTrianglePairs'] for r in rows if r['clip']==clip)} for clip in ['Idle','Fire','Reload']}
out=ROOT/'tools/blender/swingout/rounds'/('round-'+os.environ.get('SWINGOUT_ROUND','10'))/'skin-audit.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps({'summary':summary,'samples':rows},indent=2)+'\n');print(json.dumps(summary),flush=True)
