"""Fast pose-only review of the last built hands.blend; no source mesh imports."""
import bpy,sys,json,importlib.util
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('hands',HERE/'hands.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
bpy.ops.wm.open_mainfile(filepath=str(HERE/'generated/hands/hands.blend'))
rig=bpy.data.objects['HandsRig'];meta=json.loads(rig['handsMetadata'])
result={'armature':rig,'meshes':[bpy.data.objects[n+s] for s in ('Right','Left') for n in ('HandMesh','Sleeve')],'metadata':meta,'bones':meta['bones']}
gun={o.name:o for o in bpy.data.collections['Rebuild'].objects if o.type=='MESH' and o not in result['meshes']}
out=HERE/'generated/review/hands';records={}
bpy.context.scene.render.engine='BLENDER_WORKBENCH'
for gesture in ['grip','support','reload']:
 h.apply_pose(result,gesture);records[gesture]=h.contact_report(result,gun)
 for view in ['player','back','palm']:
  cam=bpy.data.objects['HandsReview.'+view.capitalize()];bpy.context.scene.camera=cam
  bpy.context.scene.render.filepath=str(out/(gesture+'-'+view+'.png'));bpy.ops.render.render(write_still=True)
(out/'pose-contacts.json').write_text(json.dumps(records,indent=2))
h.apply_pose(result,'grip');bpy.context.scene.camera=bpy.data.objects['HandsReview.Player']
contract=json.loads((HERE/'generated/hands/hands-contract.json').read_text())
for gesture,contact in records.items():contract['evidence'][gesture]['contact']=contact
(HERE/'generated/hands/hands-contract.json').write_text(json.dumps(contract,indent=2)+'\n')
if result['meshes'][0].data.materials[0].name=='ResistanceHandsAtlas':
 bpy.context.scene.render.engine='BLENDER_EEVEE'
 for view in ('player','palm'):
  bpy.context.scene.camera=bpy.data.objects['HandsReview.'+view.capitalize()];bpy.context.scene.render.filepath=str(out/('grip-'+view+'-material.png'));bpy.ops.render.render(write_still=True)
bpy.context.scene.camera=bpy.data.objects['HandsReview.Player']
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'generated/hands/hands.blend'))
