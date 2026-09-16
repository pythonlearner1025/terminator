"""Measure bone contact proxies. These are diagnostics, not full skin collision certification."""
import bpy,json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[3]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'.kite3d/swingout.blend'))
arm=bpy.data.objects['SwingoutRig'];weapon=bpy.data.objects['Swingout_Mechanism'];result=[]
for name,time in [('Idle',0),('Reload',.18),('Reload',.30),('Reload',.58),('Reload',.84),('Reload',1.5),('Reload',1.8)]:
 action=bpy.data.actions[name];arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0];bpy.context.scene.frame_set(int(time*120)+1)
 deps=bpy.context.evaluated_depsgraph_get();tree=BVHTree.FromObject(weapon,deps)
 points={}
 for side in ['Right','Left']:
  for f in ['Thumb','Index','Middle','Ring','Little']:
   p=arm.pose.bones[side+f+'Tip'].head;co,normal,index,distance=tree.find_nearest(p);points[side+f]=round(distance*1000,2)
 result.append({'clip':name,'seconds':time,'boneTipToNearestMetalOrWoodMM':points})
(ROOT/'tools/blender/swingout/rounds/contact-proxies.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
