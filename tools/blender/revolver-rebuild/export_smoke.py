"""Ten-frame native bone/driver export plumbing check; NOT a reviewed game asset.
Only Idle (3 frames) + Fire (7 frames). No dense nine-clip bake or render.
"""
import bpy,sys,json
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import assemble,animations,imported_hands
out=HERE/'generated/imported-export-smoke';out.mkdir(parents=True,exist_ok=True)
rig=assemble.assemble(assemble.module(sys.argv[sys.argv.index('--')+1],'gun'),imported_hands)
animations.DURATIONS={'Idle':2/60,'Fire':.1};animations.bake(rig)
bpy.ops.object.select_all(action='DESELECT');controls=set(rig['hands']['controls'].values())
for obj in rig['collection'].objects:
 if obj not in controls:obj.select_set(True)
constraints=[c for b in rig['hands']['armature'].pose.bones for c in b.constraints]+[c for a in rig['hands']['attachments'] for c in a.constraints]
for c in constraints:c.mute=True
bpy.context.view_layer.objects.active=rig['root']
bpy.ops.export_scene.gltf(filepath=str(out/'smoke.gltf'),export_format='GLTF_SEPARATE',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_anim_slide_to_zero=True,export_extras=True,export_skins=True,export_def_bones=False,export_morph=False)
for c in constraints:c.mute=False
for obj in rig['collection'].objects:
 if obj.animation_data:
  for track in obj.animation_data.nla_tracks:track.mute=track.name!='Idle'
bpy.context.scene.frame_set(0);bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(out/'smoke.blend'));print('EXPORT_SMOKE',out)
