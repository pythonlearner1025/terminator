"""Re-export an already baked packed source, preserving constant object channels.
Run wrapper -b saved.blend -P reexport.py -- /output/directory. No re-bake.
"""
import bpy,sys,json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
out=Path(sys.argv[sys.argv.index('--')+1]);out.mkdir(parents=True,exist_ok=True)
collection=bpy.data.collections['Rebuild'];arm=bpy.data.objects['DJMaesenArms'].modifiers[0].object
controls={b.constraints[0].target for b in arm.pose.bones}
constraints=[c for b in arm.pose.bones for c in b.constraints]+[c for n in ('HandRight','HandLeft') for c in bpy.data.objects[n].constraints]
for c in constraints:c.mute=True
for obj in collection.objects:
 if obj.animation_data:
  for t in obj.animation_data.nla_tracks:t.mute=False
bpy.ops.object.select_all(action='DESELECT')
for obj in collection.objects:
 if obj not in controls:obj.select_set(True)
root=bpy.data.objects['RevolverRebuildRig'];bpy.context.view_layer.objects.active=root
sources=json.loads(root['buildSources']);sources['assemble.py']=hashlib.sha256((HERE/'assemble.py').read_bytes()).hexdigest();root['buildSources']=json.dumps(sources,sort_keys=True)
bpy.ops.export_scene.gltf(filepath=str(out/'revolver-rebuild.gltf'),export_format='GLTF_SEPARATE',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,export_anim_slide_to_zero=True,export_extras=True,export_skins=True,export_def_bones=False,export_morph=False,export_materials='EXPORT',export_image_format='AUTO')
for c in constraints:c.mute=False
for obj in collection.objects:
 if obj.animation_data:
  for t in obj.animation_data.nla_tracks:t.mute=t.name!='Idle'
bpy.context.scene.frame_set(0);bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(out/'revolver-rebuild.blend'))
