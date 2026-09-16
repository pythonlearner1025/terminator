"""Build editable source and shipping package from the two independently owned builders.
Run only via coordination/revolver-blender -b -P .../assemble.py -- [arguments].
"""
import argparse, importlib.util, json, math, sys, hashlib
from pathlib import Path
import bpy, bmesh
from mathutils import Matrix, Vector
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import animations
ROOT=HERE.parents[2]

def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m

def empty(name,collection,location=(0,0,0)):
    obj=bpy.data.objects.new(name,None);collection.objects.link(obj);obj.location=location;obj.rotation_mode='QUATERNION';return obj

def parent(obj,target):
    bpy.context.view_layer.update();world=obj.matrix_world.copy();obj.rotation_mode='QUATERNION';obj.parent=target;obj.matrix_world=world

def assemble(gun_module,hands_module,contract=None,material_inputs=None):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    collection=bpy.data.collections.new('Rebuild');bpy.context.scene.collection.children.link(collection)
    gun=gun_module.build_gun(collection=collection)
    contract=contract or {'anchors':gun['anchors'],'metadata':gun['metadata']}
    material_inputs=Path(material_inputs) if material_inputs else HERE/'source-assets'
    if (material_inputs/'gun').is_dir():gun_module.apply_baked_materials(list(gun['objects'].values()),material_inputs/'gun')
    hands=hands_module.build_hands(contract,collection=collection)

    parts=gun['objects'];gun_meshes=list(parts.values());a=contract['anchors']
    bpy.context.view_layer.update()
    def sight_top(obj):
        vertices=[obj.matrix_world@v.co for v in obj.data.vertices];top=max(p.z for p in vertices)
        points=[p for p in vertices if p.z>top-.00001]
        return sum(points,Vector())/len(points)
    front_top=sight_top(parts['FrontSight']);rear_top=sight_top(parts['RearSight'])
    sight_pitch=math.atan((front_top.z-rear_top.z)/(front_top.x-rear_top.x))
    sight_height=front_top.z*math.cos(sight_pitch)-front_top.x*math.sin(sight_pitch)
    # Builder geometry without UVs gets explicit sharp-edge seams and padded unwrap.
    for obj in list(parts.values()):
        if obj.type!='MESH' or obj.data.uv_layers:continue
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
        bm=bmesh.new();bm.from_mesh(obj.data)
        for edge in bm.edges:edge.seam=not edge.is_manifold or edge.calc_face_angle(0)>.65
        bm.to_mesh(obj.data);bm.free()
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.unwrap(method='ANGLE_BASED',margin=.015);bpy.ops.uv.pack_islands(rotate=True,margin=.015)
        bpy.ops.object.mode_set(mode='OBJECT')
    root=empty('RevolverRebuildRig',collection);conversion=empty('AuthoringFrame',collection);conversion.parent=root
    motion=empty('WeaponMotion',collection);motion.parent=conversion
    # Authoring -X/Z-up -> exporter Blender frame +Y/Z-up -> glTF -Z/Y-up.
    conversion.rotation_quaternion=Matrix.Rotation(-math.pi/2,4,'Z').to_quaternion()
    # Keep builders' authoring frame under this conversion root.
    def pivot(name,anchor,owner=None,basis=None):
        geom=parts[name];geom.name=name+'Geometry'
        obj=empty(name,collection,anchor)
        if basis:obj.rotation_quaternion=basis.to_quaternion()
        if owner:parent(obj,owner)
        parent(geom,obj);parts[name]=obj;return obj
    body=pivot('Body',(0,0,0))
    crane=pivot('Crane',a['CranePivot'],body)
    # Blender local -Y points rearward +X. glTF Y-up turns that into
    # runtime local +Z, which cumulative shot indexing owns.
    basis=Matrix(((0,-1,0),(1,0,0),(0,0,1)))
    cylinder=pivot('Cylinder',a['CylinderCenter'],crane,basis)
    pivot('Ejector',a['CylinderCenter'],cylinder,basis)
    for name in ('Hammer','Trigger','Latch'):pivot(name,a.get(name+'Pivot',a['HammerPivot']),body)
    for name,obj in list(parts.items()):
        if name in ('Body','Crane','Cylinder','Ejector','Hammer','Trigger','Latch'):continue
        parent(obj,body)
    for i in range(6):
        source=parts.pop('Cartridge%02d'%(i+1),None)
        if source is None:raise ValueError('Gun must supply six fresh Cartridge01..06 meshes')
        bpy.context.view_layer.update()
        origin=source.matrix_world.translation.copy();origin.x=max((source.matrix_world@v.co).x for v in source.data.vertices);source.name='Case'+str(i)+'Geometry'
        case=empty('Case'+str(i),collection,origin);case.rotation_quaternion=(basis.to_4x4()@Matrix.Rotation(math.pi,4,'X')).to_quaternion();parent(case,cylinder);parent(source,case);parts[case.name]=case
        # FX models a case from rear primer toward its mouth (+Z), and ejects
        # toward -Z. Case marker +Z therefore faces forward, opposite Cylinder.
        fresh=case.copy();collection.objects.link(fresh);fresh.name='Fresh'+str(i)
        replacement=source.copy();replacement.data=source.data;collection.objects.link(replacement);replacement.name='Fresh'+str(i)+'Geometry';replacement.parent=fresh
        fresh.scale=(.001,)*3;parts[fresh.name]=fresh
        bullet=empty('Bullet'+str(i),collection);bullet.parent=case;parts[bullet.name]=bullet
    # A fresh speedloader explains simultaneous six-round insertion. Its geometry is
    # independent of reference meshes and shares an existing dark gun material.
    bm=bmesh.new()
    bmesh.ops.create_cone(bm,cap_ends=True,segments=24,radius1=.0195,radius2=.0195,depth=.007)
    bmesh.ops.create_cone(bm,cap_ends=True,segments=16,radius1=.006,radius2=.005,depth=.015,matrix=Matrix.Translation((0,0,.010)))
    mesh=bpy.data.meshes.new('SpeedloaderTopology');bm.to_mesh(mesh);bm.free()
    loader=bpy.data.objects.new('Speedloader',mesh);collection.objects.link(loader);loader.parent=cylinder;loader.location=(0,-.036,0);loader.rotation_mode='QUATERNION';loader.rotation_quaternion=Matrix.Rotation(math.pi/2,4,'X').to_quaternion();loader.scale=(.001,)*3
    dark=next((m for m in bpy.data.materials if 'rubber' in m.name.lower()),None)
    if dark:mesh.materials.append(dark)
    bpy.ops.object.select_all(action='DESELECT');loader.select_set(True);bpy.context.view_layer.objects.active=loader
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.015);bpy.ops.object.mode_set(mode='OBJECT')
    parts['Speedloader']=loader
    for name,pos,owner in [('Muzzle',a['Muzzle'],parts['Frame']),('CylinderGapLeft',(a['CylinderCenter'][0]-.028,-.026,a['CylinderCenter'][2]),body),('CylinderGapRight',(a['CylinderCenter'][0]-.028,.026,a['CylinderCenter'][2]),body),('Ejection',a['CylinderCenter'],cylinder)]:
        marker=empty(name,collection,pos);marker.rotation_quaternion=Matrix.Rotation(-math.pi/2,4,'Z').to_quaternion();parent(marker,owner);parts[name]=marker
    # Parenting conversion last ensures authored matrices remain authored locally.
    body.parent=motion
    if not hands['metadata'].get('imported'):
        raise ValueError('Retired handmade hand builders are not accepted for this package')
    hands['source_root'].parent=motion
    hands_module.apply_pose(hands,'grip')
    hands_module.bind_trigger_contact(hands,parts['Trigger'])
    hands['armature']['handsMetadata']=json.dumps(hands['metadata'])
    for side,label in [('R','HandRight'),('L','HandLeft')]:
        control=hands['controls'][hands['mapping'][side]['wrist']['joint']]
        attachment=empty(label,collection)
        attachment.parent=motion
        constraint=attachment.constraints.new('COPY_TRANSFORMS');constraint.target=control;constraint.owner_space=constraint.target_space='WORLD'
        hands.setdefault('attachments',[]).append(attachment)
    def pose(result,gesture):hands_module.apply_pose(result,gesture)
    def move_left(result,delta,release,contact=None):
        hands_module.move_support(result,motion,delta,release,contact)
    root['weaponAsset']='revolver-rebuild'
    root['viewModel']={'embeddedHands':True,'cartridgePresentation':'separate-replacements','embeddedHandMeshes':[m.name for m in hands['meshes']],'mechanism':'swingout','gameplayWeapon':'pistol','forwardAxis':'-Z','fov':54,'hip':[.11,-.13,-.47],'hipRotation':[0,.06,0], 'sight':{'height':sight_height,'distance':.40,'pitch':sight_pitch},'fire':{'discharge':.05},'reload':{'eject':.35},'clipContacts':animations.CONTACTS,'revision':'imported-hands-retarget-v2','handSource':'DJMaesen e3c42c05b22944e5839deb8e003f0987 CC BY 4.0'}
    root['EmbeddedHands']=True
    bpy.context.view_layer.update()
    rest=[(o,o.location.copy(),o.rotation_quaternion.copy(),o.scale.copy()) for o in [motion,*parts.values()]]
    return {'root':root,'motion':motion,'parts':parts,'hands':hands,'contract':contract,'rest':rest,'pose_helper':pose,'move_left':move_left,'hand_adapter':hands_module,'collection':collection,'gun':gun,'gun_meshes':gun_meshes}

def report(rig):
    out={'clips':animations.DURATIONS,'contacts':animations.CONTACTS,'meshes':[],'warnings':[]}
    for obj in rig['collection'].objects:
        if obj.type!='MESH':continue
        obj.data.calc_loop_triangles()
        out['meshes'].append({'name':obj.name,'triangles':len(obj.data.loop_triangles),'uvLayers':len(obj.data.uv_layers),'materials':len(obj.data.materials)})
        if not obj.data.uv_layers:out['warnings'].append(obj.name+' has no UVs')
    out['triangles']=sum(m['triangles'] for m in out['meshes'])
    out['contactValidation']='Not certified: inspect evaluated pad/contact report and renders; bone distances alone do not prove skin clearance.'
    return out

def render_sample(rig,name,fraction,path,view='runtime',material=False):
    # Mute NLA so sample is the only evaluator.
    for obj in rig['collection'].objects:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:track.mute=True
    animations.sample(rig,name,animations.DURATIONS[name]*fraction)
    scene=bpy.context.scene
    cam=bpy.data.objects.get('ReviewCamera')
    if not cam:
        cam=bpy.data.objects.new('ReviewCamera',bpy.data.cameras.new('ReviewCamera'));scene.collection.objects.link(cam)
    # Blender view frame after root conversion, fixed across all actions.
    if view=='runtime':
        vm=rig['root']['viewModel'];aim=1. if name=='AimIdle' else animations.smooth(fraction) if name=='AimIn' else 1-animations.smooth(fraction) if name=='AimOut' else 0.
        hip=vm['hip'];sight=vm['sight']
        rig['root'].location=(hip[0]*(1-aim),-hip[2]*(1-aim)+sight['distance']*aim,hip[1]*(1-aim)-sight['height']*aim)
        rig['root'].rotation_quaternion=(Matrix.Rotation(sight['pitch']*aim,4,'X')@Matrix.Rotation(vm['hipRotation'][1]*(1-aim),4,'Z')).to_quaternion()
        cam.location=(0,0,0);cam.rotation_euler=Vector((0,1,0)).to_track_quat('-Z','Y').to_euler()
        cam.data.sensor_fit='VERTICAL';cam.data.sensor_height=24;cam.data.lens=24/(2*math.tan(math.radians(vm['fov'])/2));cam.data.clip_start=.02
    else:
        rig['root'].location=(0,0,0);rig['root'].rotation_quaternion=(1,0,0,0)
        cam.location={'first-person':(.025,-.52,.135),'left-contact':(-.45,-.18,.14),'top-contact':(0,-.05,.55)}.get(view,(.52,-.35,.23))
        target=Vector((0,-.05,.025) if view in ('left-contact','top-contact') else (0,.04,.015));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
        cam.data.sensor_fit='HORIZONTAL';cam.data.lens=35;cam.data.clip_start=.001
    scene.camera=cam
    scene.render.engine='BLENDER_WORKBENCH';scene.render.resolution_x=640;scene.render.resolution_y=480;scene.render.resolution_percentage=100
    scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL';scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True
    if material:
        scene.render.engine='BLENDER_EEVEE'
        if hasattr(scene,'eevee') and hasattr(scene.eevee,'taa_render_samples'):scene.eevee.taa_render_samples=16
        for label,position,energy,size in [('ReviewKey',(-.25,-.3,.5),6,.4),('ReviewFill',(.3,-.1,.2),3,.4),('ReviewRim',(.1,.4,.25),5,.3)]:
            light=bpy.data.objects.get(label)
            if not light:
                data=bpy.data.lights.new(label,'AREA');data.energy=energy;data.shape='DISK';data.size=size
                light=bpy.data.objects.new(label,data);scene.collection.objects.link(light)
            light.location=rig['root'].location+Vector(position);light.rotation_euler=(rig['root'].location-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--gun',default=str(HERE/'gun.py'));parser.add_argument('--hands',default=str(HERE/'imported_hands.py'));parser.add_argument('--contract');parser.add_argument('--material-inputs',default=str(HERE/'source-assets'));parser.add_argument('--output',default=str(HERE/'generated/assembled'));parser.add_argument('--render',action='store_true');parser.add_argument('--preview',action='store_true');parser.add_argument('--material',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    hm=module(args.hands,'rebuild_hands');rig=assemble(module(args.gun,'rebuild_gun'),hm,json.loads(Path(args.contract).read_text()) if args.contract else None,args.material_inputs)
    animations.sample(rig,'Idle',0)
    evidence=report(rig)
    evidence['loadingPose']=rig['hands']['metadata']['loadingPose']
    evidence['sources']={Path(path).name:hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in [args.gun,args.hands,__file__,str(HERE/'animations.py'),args.contract] if path}
    evidence['textures']={image.name:{'sha256':hashlib.sha256(Path(bpy.path.abspath(image.filepath)).read_bytes()).hexdigest(),'size':list(image.size)} for image in bpy.data.images if image.filepath and Path(bpy.path.abspath(image.filepath)).is_file()}
    rig['root']['buildSources']=json.dumps(evidence['sources'],sort_keys=True)
    if hasattr(hm,'contact_report'):
        try:evidence['evaluatedContacts']=hm.contact_report(rig['hands'],rig['gun_meshes'])
        except Exception as exc:evidence['warnings'].append('Contact evaluation failed: '+str(exc))
    (out/'assembly-report.json').write_text(json.dumps(evidence,indent=2,default=str))
    if args.preview:
        for name,fraction in [('Idle',0),('Reload',.34),('Reload',.67)]:render_sample(rig,name,fraction,out/(name+'-'+str(fraction)+'.png'),material=args.material)
        return
    used_images={Path(bpy.path.abspath(n.image.filepath)).name for obj in rig['collection'].objects if obj.type=='MESH' for m in obj.data.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image}
    required={'gun-basecolor.png','gun-normal.png','gun-orm.png',}
    if required-used_images:raise RuntimeError('Final export requires validated baked material inputs: '+', '.join(sorted(required-used_images))+'. Restore source-assets or pass --material-inputs; use --preview only for scalar-material diagnostics.')
    animations.bake(rig)
    bpy.ops.object.select_all(action='DESELECT')
    source_controls=set(rig['hands']['controls'].values())
    for obj in rig['collection'].objects:
        if obj not in source_controls:obj.select_set(True)
    # Export the evaluated native bone bake. Preserve live source drivers in .blend.
    constraints=[c for b in rig['hands']['armature'].pose.bones for c in b.constraints]+[c for a in rig['hands']['attachments'] for c in a.constraints]
    for constraint in constraints:constraint.mute=True
    bpy.context.view_layer.objects.active=rig['root']
    bpy.ops.export_scene.gltf(filepath=str(out/'revolver-rebuild.gltf'),export_format='GLTF_SEPARATE',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,export_anim_slide_to_zero=True,export_extras=True,export_skins=True,export_def_bones=False,export_morph=False,export_materials='EXPORT',export_image_format='AUTO')
    for constraint in constraints:constraint.mute=False
    for obj in rig['collection'].objects:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:track.mute=track.name!='Idle'
    bpy.context.scene.frame_set(0)
    source_camera=bpy.data.objects.new('Camera.SourceOverview',bpy.data.cameras.new('Camera.SourceOverview'))
    bpy.context.scene.collection.objects.link(source_camera);source_camera.location=(.5,-.42,.28)
    source_camera.rotation_euler=(Vector((0,-.10,0))-source_camera.location).to_track_quat('-Z','Y').to_euler()
    source_camera.data.lens=40;source_camera.data.clip_start=.001;bpy.context.scene.camera=source_camera
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'revolver-rebuild.blend'))
    if args.render:
        for name,fraction in [('Idle',0),('Fire',.22),('Reload',.24),('Reload',.34),('Reload',.67),('Reload',.84)]:render_sample(rig,name,fraction,out/(name+'-'+str(fraction)+'.png'),material=args.material)
    print('REBUILD_ASSEMBLY',out)
if __name__=='__main__':main()
