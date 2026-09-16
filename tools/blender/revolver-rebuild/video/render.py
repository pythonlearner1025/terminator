"""Render saved approved NLA tracks. Never rebuild, refit, or save the Blend."""
import argparse, hashlib, json, math, os, subprocess, sys, time
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

parser=argparse.ArgumentParser()
parser.add_argument('--clip',default='Idle')
parser.add_argument('--out',default='tools/blender/revolver-rebuild/generated/animation-videos')
parser.add_argument('--limit',type=int,default=0,help='Probe only; cannot be encoded as a complete clip')
a=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
out=Path(a.out).resolve();(out/'frames'/a.clip).mkdir(parents=True,exist_ok=True);(out/'evidence').mkdir(exist_ok=True)
source=Path(bpy.data.filepath)
if sha(source)!='a1c506b177832cc183884cd75e2d58767e6e9a2a3004020956bd99b957019bf7':raise RuntimeError('Packed approved source changed')
manifest_path=Path('../coordination/revolver-retarget-ready.json')
approved='13551b6d725a8afa11673b681ff894b18c2e1d707029648506b95e772a65c6c6'
if sha(manifest_path)!=approved:raise RuntimeError('Approved freeze manifest changed')
freeze=json.loads(manifest_path.read_text());duration=freeze['clips'][a.clip]
files=subprocess.check_output(['git','ls-files','main.js','lib','scripts','package.json','assets.json','assets','tools/blender/revolver-rebuild/source','tools/blender/revolver-rebuild/source-assets'],text=True).splitlines()
before={f:sha(f) for f in files}
scene=bpy.context.scene;root=bpy.data.objects['RevolverRebuildRig'];vm=root['viewModel'];source_fps=scene.render.fps/scene.render.fps_base
if abs(source_fps-60)>1e-6:raise RuntimeError('Expected native60Hz source')
inventory=[]
for obj in scene.objects:
    ad=obj.animation_data
    if not ad:continue
    ad.action=None
    for track in ad.nla_tracks:
        track.is_solo=False;track.mute=track.name!=a.clip
        if track.name==a.clip:
            inventory.append({'object':obj.name,'track':track.name,'strips':[{'action':s.action.name,'start':s.frame_start,'end':s.frame_end,'actionStart':s.action_frame_start,'actionEnd':s.action_frame_end} for s in track.strips]})
if len(inventory)<2:raise RuntimeError('Missing saved NLA tracks')
mesh=bpy.data.objects['DJMaesenArms'];armatures=[m.object for m in mesh.modifiers if m.type=='ARMATURE']
if len(armatures)!=1 or len(armatures[0].data.bones)!=49:raise RuntimeError('Wrong native source skin')
for obj in scene.objects:
    if obj.type=='LIGHT':obj.hide_render=True
camera=bpy.data.objects.new('VideoPreviewCamera',bpy.data.cameras.new('VideoPreviewCamera'));scene.collection.objects.link(camera)
camera.location=(0,0,0);camera.rotation_euler=Vector((0,1,0)).to_track_quat('-Z','Y').to_euler()
camera.data.sensor_fit='VERTICAL';camera.data.sensor_height=24;camera.data.lens=24/(2*math.tan(math.radians(54)/2));camera.data.clip_start=.02;camera.data.clip_end=100
scene.camera=camera
engine_types=scene.render.bl_rna.properties['engine'].enum_items.keys()
scene.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engine_types else 'BLENDER_EEVEE'
if hasattr(scene,'eevee') and hasattr(scene.eevee,'taa_render_samples'):scene.eevee.taa_render_samples=16
scene.render.resolution_x=640;scene.render.resolution_y=480;scene.render.resolution_percentage=100
scene.render.threads_mode='FIXED';scene.render.threads=2
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.compression=15
scene.render.film_transparent=False
scene.world=bpy.data.worlds.new('VideoPreviewGray');scene.world.use_nodes=True
background=scene.world.node_tree.nodes.get('Background');background.inputs['Color'].default_value=(.19,.22,.25,1);background.inputs['Strength'].default_value=.6
try:scene.view_settings.view_transform='Standard'
except:pass
scene.view_settings.exposure=0;scene.view_settings.gamma=1
hip=vm['hip'];anchor=Vector((hip[0],-hip[2],hip[1]));lights=[]
for name,offset,energy,size in [('VideoKey',(-.25,-.3,.5),6,.4),('VideoFill',(.3,-.1,.2),3,.4),('VideoRim',(.1,.4,.25),5,.3)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
    light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=anchor+Vector(offset)
    light.rotation_euler=(anchor-light.location).to_track_quat('-Z','Y').to_euler();lights.append({'name':name,'position':list(light.location),'energy':energy,'size':size})
steps=math.ceil(duration*30-1e-5);times=[0]*15+[min(i/30,duration) for i in range(steps+1)]+[duration]*15
report={'schema':'revolver-blender-video/v1','clip':a.clip,'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'renderer':scene.render.engine,'blenderVersion':bpy.app.version_string,'width':640,'height':480,'fps':30,'sourceFps':source_fps,'sourceBlendSha256':sha(source),'approvedManifestSha256':approved,'sourceRevision':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'sourceFileHashes':before,'assetHashes':{Path(f['path']).name:f['sha256'] for f in freeze['assetFiles'] if Path(f['path']).suffix in ['.gltf','.bin','.png']},'method':'Blender Eevee material preview of approved saved packed source NLA. Each output frame actually rendered; no AI frames/interpolation/slideshow. Not gameplay footage or a live FPS benchmark. Fixed54degree vertical POV, metadata hip/aim placement,30fps,15 additional rendered endpoint hold frames each side. Source/frame time recorded. Source never saved.','authoredDuration':duration,'frameCount':len(times),'encodedDuration':len(times)/30,'holdFramesEachSide':15,'selectedNlaTracks':inventory,'lights':lights,'frames':[],'cameraStates':[],'errors':[],'probeOnly':bool(a.limit)}
started=time.time()
def resource():
    try:
        cg=next(line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
        report['cgroup']=cg
        report['resources']={f:(Path('/sys/fs/cgroup'+cg)/f).read_text().strip() for f in ['memory.max','memory.high','memory.peak','memory.events','pids.max','pids.events']}
    except Exception as e:report['resourceNote']=str(e)
def save():
    resource();(out/'evidence'/f'{a.clip}.json').write_text(json.dumps(report,indent=2)+'\n')
resource()
if report.get('resources',{}).get('memory.max')!='1887436800':raise RuntimeError('Blender escaped required1.8GB cgroup; use video/render.sh direct binary')
try:
    for index,seconds in enumerate(times[:a.limit] if a.limit else times):
        frame=seconds*source_fps;scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame))
        fraction=seconds/duration;t=max(0,min(1,fraction));smooth=t*t*(3-2*t)
        aim=1 if a.clip=='AimIdle' else smooth if a.clip=='AimIn' else 1-smooth if a.clip=='AimOut' else 0
        sight=vm['sight'];root.location=(hip[0]*(1-aim),-hip[2]*(1-aim)+sight['distance']*aim,hip[1]*(1-aim)-sight['height']*aim)
        root.rotation_mode='QUATERNION';root.rotation_quaternion=(Matrix.Rotation(sight['pitch']*aim,4,'X')@Matrix.Rotation(vm['hipRotation'][1]*(1-aim),4,'Z')).to_quaternion()
        bpy.context.view_layer.update()
        file=f'frames/{a.clip}/{index:04d}.png';scene.render.filepath=str(out/file)
        bpy.ops.render.render(write_still=True)
        pose={name:[list(row) for row in bpy.data.objects[name].matrix_world] for name in ['WeaponMotion','Cylinder','Hammer','HandRight','HandLeft']}
        pose_hash=hashlib.sha256(json.dumps(pose,sort_keys=True).encode()).hexdigest()
        sample={'index':index,'file':file,'sha256':sha(out/file),'requestedSeconds':seconds,'sampledSeconds':seconds,'sourceFrame':frame,'renderFrame':index+1,'poseSha256':pose_hash}
        report['frames'].append(sample)
        if index in [15,15+steps//2,15+steps]:
            report['cameraStates'].append({'index':index,'seconds':seconds,'camera':{'position':list(camera.location),'quaternion':list(camera.rotation_euler.to_quaternion()),'verticalFov':54,'weaponRootPosition':list(root.location),'weaponRootQuaternion':list(root.rotation_quaternion),'aimPlacement':aim},'pose':pose})
        if index%30==0:save();print(f'VIDEO {a.clip}: {index+1}/{len(times)}',flush=True)
    report['uniqueFrameHashes']=len({f['sha256'] for f in report['frames']});report['uniquePoseHashes']=len({f['poseSha256'] for f in report['frames']})
    report['sourceHashesUnchanged']=all(sha(f)==h for f,h in before.items())
    if not report['sourceHashesUnchanged']:raise RuntimeError('Source changed')
    report['complete']=not a.limit and len(report['frames'])==len(times) and report['uniqueFrameHashes']>2 and report['uniquePoseHashes']>2
    print(f'VIDEO {a.clip}: complete={report["complete"]}, {len(report["frames"])} rendered frames',flush=True)
except Exception as e:
    report['errors'].append(str(e));raise
finally:
    report['elapsedWallSeconds']=time.time()-started;save()
