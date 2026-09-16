"""Headless Cycles review. Saved PNG contact sheets are reviewed each round."""
folder=EVID/f'round-{ROUND}';folder.mkdir(parents=True,exist_ok=True)
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
try:
 prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
 for d in prefs.devices:d.use=d.type=='OPTIX'
 scene.cycles.device='GPU'
except Exception:scene.cycles.device='CPU'
scene.render.resolution_percentage=100;scene.render.resolution_x=1000;scene.render.resolution_y=650;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
world=bpy.data.worlds.new('Neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.18,.22,.28,1);world.node_tree.nodes['Background'].inputs[1].default_value=.55;scene.world=world
for name,xyz,power,size in [('Key',(.3,.5,.15),24,.5),('Fill',(-.4,.3,.18),12,.45),('Rim',(.2,.4,-.2),18,.3)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=P(xyz);o.rotation_euler=(P((0,.02,.10))-o.location).to_track_quat('-Z','Y').to_euler()
d=bpy.data.cameras.new('Review');camera=bpy.data.objects.new('Review',d);scene.collection.objects.link(camera);scene.camera=camera

def sample(name,t):
 a=bpy.data.actions.get(name);arm.animation_data.action=a
 if a.slots:arm.animation_data.action_slot=a.slots[0]
 scene.frame_set(int(t*120)+1,subframe=t*120-int(t*120));bpy.context.view_layer.update()
def render(label):
 scene.render.filepath=str(folder/(label+'.png'));bpy.ops.render.render(write_still=True)
d.type='ORTHO';d.ortho_scale=.44;camera.location=P((.55,.25,-.22));camera.rotation_euler=(P((0,.045,.13))-camera.location).to_track_quat('-Z','Y').to_euler();sample('Idle',0)
for o in hands:o.hide_render=True
render('mechanism-closed')
sample('Reload',1.24);render('mechanism-open')
for o in hands:o.hide_render=False
# Use the exact shipped first-person projection and root transform.
vm=arm['viewModel'];d.type='PERSP';d.lens_unit='FOV';d.sensor_fit='VERTICAL';d.angle=math.radians(vm['fov']);scene.render.resolution_x=960;scene.render.resolution_y=540
arm.location=P(vm['hip']);arm.rotation_mode='QUATERNION';arm.rotation_quaternion=Quaternion(P((0,1,0)),pi+vm['hipRotation'][1]);camera.location=(0,0,0);camera.rotation_euler=P((0,0,-1)).to_track_quat('-Z','Y').to_euler();bpy.context.view_layer.update()
for o in scene.objects:
 if o.type=='LIGHT':o.location=arm.matrix_world@o.location;o.rotation_euler=(arm.matrix_world@P((0,.04,.12))-o.location).to_track_quat('-Z','Y').to_euler()
shots={'Idle':[0],'Draw':[.12,.4],'Fire':[.025,.05,.067,.20],'Reload':[.18,.30,.58,.84,.95,1.24,1.5,1.80,2.05,2.22,2.6],'AimIn':[.10],'AimOut':[.10],'AimIdle':[0],'Sprint':[.2,.6],'Inspect':[.7,1.4,2.2]}
for name,times in shots.items():
 for t in times:
  aim=1 if name=='AimIdle' else (t/.2 if name=='AimIn' else 1-t/.2 if name=='AimOut' else 0)
  arm.location=P((vm['hip'][0]*(1-aim),vm['hip'][1]*(1-aim)-vm['sight']['height']*aim,vm['hip'][2]*(1-aim)-vm['sight']['distance']*aim))
  arm.rotation_quaternion=Quaternion(P((1,0,0)),vm['sight'].get('pitch',0)*aim)@Quaternion(P((0,1,0)),pi+vm['hipRotation'][1]*(1-aim))
  sample(name,t);render(f'{name}-{t:.3f}')
print('REVIEW',folder,flush=True)
