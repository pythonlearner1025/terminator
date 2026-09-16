"""Headless matched reference views and clip key poses using Metal compute."""
from bpy_extras.object_utils import world_to_camera_view
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='METAL';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='METAL'
scene.cycles.device='GPU'
round_id=int(os.environ.get('REVOLVER_ROUND','1')); raw=EVID/f'round-{round_id}';raw.mkdir(parents=True,exist_ok=True)
scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True
scene.cycles.samples=16;scene.cycles.use_denoising=True;scene.view_settings.view_transform='AgX'
world=scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.45,.48,.52,1);world.node_tree.nodes['Background'].inputs[1].default_value=.8
for name,position,energy,size in [('Key',(.4,.6,.5),18,.55),('Fill',(-.4,.3,.05),10,.5),('Rim',(.2,.5,-.4),22,.4)]:
 data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='RECTANGLE';data.size=size;data.size_y=.08 if name=='Key' else .22;o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=P(position);o.rotation_euler=(P((0,.04,.12))-o.location).to_track_quat('-Z','Y').to_euler()
data=bpy.data.cameras.new('Evidence camera');camera=bpy.data.objects.new('Evidence camera',data);scene.collection.objects.link(camera);scene.camera=camera
for o in meshes:
 if o.name.startswith(('Right_','Left_')):o.hide_render=True
# Uncocked silhouette matches the reference photo. Set poses explicitly before rendering.
pose('Hammer');pose('SpeedLoader',scale=.00001);pose('SpentRounds',scale=.00001)
def render(name):
 scene.render.filepath=str(raw/(name+'.png'));bpy.context.view_layer.update();bpy.ops.render.render(write_still=True)
def axes(right,up,normal,location):
 camera.matrix_world=Matrix(((P(right).x,P(up).x,P(normal).x,0),(P(right).y,P(up).y,P(normal).y,0),(P(right).z,P(up).z,P(normal).z,0),(0,0,0,1)))
 camera.location=P(location)
scene.render.resolution_x=1500;scene.render.resolution_y=1000;data.type='ORTHO';data.ortho_scale=1500*sx
axes((0,0,-1),(0,1,0),(1,0,0),(1,.078-(500-289)*sx,.320-(750-8)*sx));render('left')
st=traces['top']['metres_per_pixel'];data.ortho_scale=1500*st
angle=math.radians(7);st*=cos(angle);data.ortho_scale=1500*st;right=Vector((0,sin(angle),-cos(angle)));up=Vector((-1,0,0));normal=Vector((0,cos(angle),sin(angle)));cant=math.radians(3);up,normal=up*cos(cant)+normal*sin(cant),normal*cos(cant)-up*sin(cant);up=Vector((-normal.y,normal.x,0)).normalized();right=up.cross(normal).normalized();location=Vector((0,.078,.320))+right*((750-14)*st)-up*((500-376)*st)+normal
axes(right,up,normal,location);render('top')
data.ortho_scale=.40;scene.render.resolution_x=1000;scene.render.resolution_y=600
camera.location=P((.50,.40,.48));camera.rotation_euler=(P((0,.035,.14))-camera.location).to_track_quat('-Z','Y').to_euler();render('quarter')
for o in meshes:o.hide_render=False
# Use precisely the exported viewmodel placement.
vm=arm['viewModel'];data.type='PERSP';data.lens_unit='FOV';data.sensor_fit='VERTICAL';data.angle=math.radians(vm['fov'])
scene.render.resolution_x=960;scene.render.resolution_y=540
arm.location=P(vm['hip']);arm.rotation_mode='QUATERNION';arm.rotation_quaternion=Quaternion(P((1,0,0)),vm['hipRotation'][0])@Quaternion(P((0,1,0)),pi+vm['hipRotation'][1])
camera.location=(0,0,0);camera.rotation_euler=P((0,0,-1)).to_track_quat('-Z','Y').to_euler();bpy.context.view_layer.update()
for o in scene.objects:
 if o.type=='LIGHT':o.location=arm.matrix_world@o.location;o.rotation_euler=(arm.matrix_world@P((0,.04,.12))-o.location).to_track_quat('-Z','Y').to_euler()
action=bpy.data.actions.get('Idle');arm.animation_data.action=action
if action.slots:arm.animation_data.action_slot=action.slots[0]
scene.frame_set(1);render('first-person')
# White weapon, black hands. The hands still occlude the weapon, so the mask measures visible gun.
original={o.name:list(o.data.materials)for o in meshes}
def flat(name,color):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial');e=n.new('ShaderNodeEmission');e.inputs[0].default_value=(*color,1);m.node_tree.links.new(e.outputs[0],out.inputs[0]);return m
white=flat('Proof gun mask',(1,1,1));black=flat('Proof hand occluder',(0,0,0))
for o in meshes:o.data.materials.clear();o.data.materials.append(black if 'Hand_and_Sleeve'in o.name else white)
scene.cycles.samples=1;scene.cycles.use_denoising=False;render('gun-mask')
for o in meshes:
 o.data.materials.clear()
 for m in original[o.name]:o.data.materials.append(m)
scene.cycles.samples=12;scene.cycles.use_denoising=True
for clip,times in [('Fire',[.033333,.1,.2]),('Reload',[.3,1.1,2.1])]:
 action=bpy.data.actions.get(clip);arm.animation_data.action=action
 # Blender 5 actions require their exported slot when assigned after NLA creation.
 if action.slots:arm.animation_data.action_slot=action.slots[0]
 for i,t in enumerate(times):scene.frame_set(round(t*30)+1);render(f'{clip.lower()}-{i+1}')
arm.animation_data.action=None
(raw/'settings.json').write_text(json.dumps({'round':round_id,'seed':1858,'leftScale':sx,'topScale':st,'projection':vm.to_dict(),'clipFrames':{'Fire':[2,4,7],'Reload':[10,34,64]}},indent=2)+'\n')
