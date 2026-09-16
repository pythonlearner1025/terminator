"""Headless contact views. Render converted glTF, never the unconverted source."""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parents[3]
args=sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else ['1'];round_id=args[0];ids=args[1:]
configs=json.loads((ROOT/'tools/blender/external/candidates.json').read_text())
configs.append(dict(id='current-built',weapon='revolver',shippable=True,current=True))
RAW=ROOT/f'.kite3d/external-rounds/{round_id}';RAW.mkdir(parents=True,exist_ok=True)
for c in configs:
 if ids and c['id']not in ids:continue
 path=ROOT/'assets/models/weapons/pistol/pistol.gltf'if c.get('current')else ROOT/('assets/models/weapons-candidates'if c['shippable']else'assets/reference/weapons')/c['weapon']/c['id']/(c['id']+'.gltf')
 if not path.exists():continue
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(path));scene=bpy.context.scene
 if c.get('current'):
  for o in list(scene.objects):
   if o.type=='MESH'and ('Hand' in o.data.name or 'Right_'in o.name or 'Left_'in o.name or o.name=='Icosphere' or 'SpeedLoader' in o.name or 'SpentRounds' in o.name):bpy.data.objects.remove(o,do_unlink=True)
 meshes=[o for o in scene.objects if o.type=='MESH']
 if c.get('current'):
  for o in [o for o in scene.objects if not o.parent]:o.matrix_world=Matrix.Rotation(-math.pi/2,4,'Z')@o.matrix_world
 bpy.context.view_layer.update();pts=[o.matrix_world@Vector(v)for o in meshes for v in o.bound_box];lo=Vector([min(v[i]for v in pts)for i in range(3)]);hi=Vector([max(v[i]for v in pts)for i in range(3)]);center=(lo+hi)/2;length=max(hi-lo)
 scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
 prefs=bpy.context.preferences.addons['cycles'].preferences
 try:
  prefs.compute_device_type='METAL';prefs.get_devices()
  for device in prefs.devices:device.use=device.type=='METAL'
  scene.cycles.device='GPU'
 except Exception:scene.cycles.device='CPU'
 scene.render.resolution_x=960;scene.render.resolution_y=480;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True;scene.view_settings.view_transform='AgX'
 world=bpy.data.worlds.new('Reference studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.35,.39,.45,1);world.node_tree.nodes['Background'].inputs[1].default_value=.6;scene.world=world
 for name,pos,power,size in [('Key',(-.3,-.7,1.1),60,.9),('Fill',(.6,-.2,.3),25,.6),('Rim',(.2,.6,.8),90,.65)]:
  data=bpy.data.lights.new(name,'AREA');data.energy=power*length*length;data.shape='DISK';data.size=size*length;o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=center+Vector(pos)*length;o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
 camdata=bpy.data.cameras.new('Contact Camera');cam=bpy.data.objects.new('Contact Camera',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.type='ORTHO';camdata.ortho_scale=max(length*1.18,(hi.z-lo.z)*2.4)
 for view,direction in [('left',(0,-2,0)),('quarter',(-1.4,-2,.85))]:
  cam.location=center+Vector(direction)*length;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(RAW/f'{c["weapon"]}-{c["id"]}-{view}.png');bpy.ops.render.render(write_still=True)
 (RAW/f'{c["weapon"]}-{c["id"]}.json').write_text(json.dumps({'bounds':[list(lo),list(hi)],'orthoScale':camdata.ortho_scale,'center':list(center)},indent=2))
 print('RENDERED',round_id,c['weapon'],c['id'],flush=True)
