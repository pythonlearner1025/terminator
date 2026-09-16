import bpy,json,sys
from pathlib import Path
ob=bpy.data.objects['DJMaesenArms'];rows={}
samples=[('Idle',0),('Fire',3)]
if '--full' in sys.argv:samples += [('Draw',21),('Reload',51.84),('Reload',73.44),('Reload',144.72),('Reload',181.44),('Reload',216),('AimIn',5.4),('AimOut',5.4),('AimIdle',60),('Sprint',24),('Inspect',90)]
for name,frame in samples:
 for o in bpy.context.scene.objects:
  if o.animation_data:
   o.animation_data.action=None
   for t in o.animation_data.nla_tracks:t.mute=t.name!=name
 bpy.context.scene.frame_set(int(frame),subframe=frame%1);bpy.context.view_layer.update();ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();points=[ev.matrix_world@v.co for v in mesh.vertices]
 rows[name if name not in rows else name+'@'+str(frame)]={'clip':name,'seconds':frame/60,'vertices':[[p.x,p.z,-p.y] for p in points]};ev.to_mesh_clear()
Path(sys.argv[sys.argv.index('--')+1]).write_text(json.dumps(rows))
