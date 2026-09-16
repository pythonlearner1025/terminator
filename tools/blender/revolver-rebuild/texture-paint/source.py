"""Read-only mesh extraction / fixed Eevee evidence / surgical packed material update.
Run through run.sh. Never assembles geometry or bakes actions.
"""
import argparse, hashlib, json, math, subprocess, sys
from pathlib import Path
import bpy
from mathutils import Vector, Matrix
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
OUT=ROOT/'generated/texture-paint'
sys.path.insert(0,str(ROOT))
import gun

def canonical(value):
    if hasattr(value,'to_dict'):return canonical(value.to_dict())
    if hasattr(value,'to_list'):return canonical(value.to_list())
    if isinstance(value,dict):return {k:canonical(v) for k,v in value.items()}
    if isinstance(value,(tuple,list)):return [canonical(v) for v in value]
    if isinstance(value,set):return sorted(value)
    if isinstance(value,bpy.types.ID):return value.name
    return value

def digest(value):
    return hashlib.sha256(json.dumps(canonical(value),sort_keys=True,separators=(',',':')).encode()).hexdigest()

def properties(item):
    result={}
    for p in item.bl_rna.properties:
        if p.identifier in {'rna_type','name'} or p.type in {'POINTER','COLLECTION'}:continue
        try:
            v=getattr(item,p.identifier)
            result[p.identifier]=list(v) if p.is_array else v
        except:pass
    return result

def fingerprints():
    meshes={}
    for me in bpy.data.meshes:
        meshes[me.name]=digest({'vertices':[list(v.co) for v in me.vertices],
          'edges':[list(e.vertices) for e in me.edges], 'polygons':[(list(p.vertices),p.material_index,p.use_smooth) for p in me.polygons],
          'uv':{uv.name:[list(x.uv) for x in uv.data] for uv in me.uv_layers},
          'weights':[[(g.group,g.weight) for g in v.groups] for v in me.vertices]})
    objects={}
    for o in bpy.data.objects:
        ad=o.animation_data
        objects[o.name]=digest({'parent':o.parent.name if o.parent else None,'matrix':[list(r) for r in o.matrix_basis],
          'parentInverse':[list(r) for r in o.matrix_parent_inverse], 'props':dict(o.items()),
          'constraints':[properties(c) for c in o.constraints], 'modifiers':[properties(m) for m in o.modifiers],
          'groups':[g.name for g in o.vertex_groups] if o.type=='MESH' else [],
          'nla':[(t.name,t.mute,[(s.action.name if s.action else None,properties(s)) for s in t.strips]) for t in ad.nla_tracks] if ad else []})
    actions={}
    for a in bpy.data.actions:
        curves=list(a.fcurves) if hasattr(a,'fcurves') else [f for l in a.layers for s in l.strips for bag in s.channelbags for f in bag.fcurves]
        actions[a.name]=digest([(f.data_path,f.array_index,[(list(k.co),list(k.handle_left),list(k.handle_right),k.interpolation) for k in f.keyframe_points]) for f in curves])
    rigs={a.name:digest([(b.name,b.parent.name if b.parent else None,[list(r) for r in b.matrix_local],b.length) for b in a.bones]) for a in bpy.data.armatures}
    poses={o.name:digest([(b.name,[properties(c) for c in b.constraints]) for b in o.pose.bones]) for o in bpy.data.objects if o.type=='ARMATURE'}
    cameras={c.name:digest(properties(c)) for c in bpy.data.cameras}
    hand_images={i.name:hashlib.sha256(i.packed_file.data).hexdigest() for i in bpy.data.images if i.packed_file and not i.name.startswith('gun-')}
    return {'meshes':meshes,'objects':objects,'actions':actions,'rigs':rigs,'poseConstraints':poses,'cameras':cameras,'handImages':hand_images}

def extract():
    source=Path(bpy.data.filepath)
    baseline=subprocess.check_output(['git','show','d76440e:tools/blender/revolver-rebuild/source/assembled/revolver-rebuild.blend'])
    if hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(baseline).digest():
        (OUT/'before/fingerprints.json').write_text(json.dumps(fingerprints(),indent=2)+'\n')
    bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
    inv=bpy.data.objects['WeaponMotion'].matrix_world.inverted()
    objects=[];seen=set()
    for o in bpy.context.scene.objects:
        if o.type!='MESH' or o.name=='Speedloader' or not any(m and m.name.startswith('Gun |') for m in o.data.materials) or o.data.name in seen:continue
        seen.add(o.data.name);me=o.data;me.calc_loop_triangles();mat=inv@o.matrix_world
        objects.append({'name':o.name,'vertices':[list(mat@v.co) for v in me.vertices],
          'materials':[m.name for m in me.materials], 'uv':[list(x.uv) for x in me.uv_layers.active.data],
          'triangles':[{'v':list(t.vertices),'l':list(t.loops),'m':t.material_index,'n':list(mat.to_3x3()@me.polygons[t.polygon_index].normal)} for t in me.loop_triangles]})
    (OUT/'mesh-paint-input.json').write_text(json.dumps(objects,separators=(',',':')))
    print('TEXTURE extracted',len(objects),'meshes',flush=True)

def update():
    before=fingerprints()
    mats=[m for m in bpy.data.materials if m.name.startswith('Gun |')]
    gun.attach_baked_texture_nodes(mats,ROOT/'source-assets/gun')
    assert before==fingerprints(),'Protected source semantics changed'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/assembled/revolver-rebuild.blend'))
    print('TEXTURE packed source saved; protected fingerprints equal',flush=True)

def render(stage,only):
    scene=bpy.context.scene;root=bpy.data.objects['RevolverRebuildRig'];vm=root['viewModel']
    for o in scene.objects:
        if o.type=='LIGHT':o.hide_render=True
    engine_types=scene.render.bl_rna.properties['engine'].enum_items.keys()
    scene.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engine_types else 'BLENDER_EEVEE';scene.render.threads_mode='FIXED';scene.render.threads=2
    scene.render.resolution_x=960;scene.render.resolution_y=640;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
    scene.render.film_transparent=False
    scene.world=bpy.data.worlds.new('TextureReviewWorld');scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes.get('Background');bg.inputs['Color'].default_value=(.12,.15,.19,1);bg.inputs['Strength'].default_value=.45
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    camera=bpy.data.objects.new('TextureReviewCamera',bpy.data.cameras.new('TextureReviewCamera'));scene.collection.objects.link(camera);scene.camera=camera
    camera.data.clip_start=.001;camera.data.clip_end=100
    lights=[]
    for name,offset,energy,size in [('key',(-.22,-.25,.42),5,.32),('fill',(.27,.03,.12),3,.4),('rim',(-.1,.35,.3),6,.28)]:
        data=bpy.data.lights.new('TextureReview-'+name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
        light=bpy.data.objects.new(data.name,data);scene.collection.objects.link(light);lights.append((light,Vector(offset)))
    views={'left':('Idle',0,(-.04,-.6,.06)), 'right':('Idle',0,(-.04,.6,.06)),
           'threequarter':('Idle',0,(-.36,-.48,.25)), 'player':('Idle',0,None), 'inspect':('Inspect',1.5,None)}
    report={}
    for name,(clip,seconds,offset) in views.items():
        if only and name not in only.split(','):continue
        for o in scene.objects:
            if not o.animation_data:continue
            o.animation_data.action=None
            for t in o.animation_data.nla_tracks:t.is_solo=False;t.mute=t.name!=clip
        frame=seconds*60;scene.frame_set(int(frame),subframe=frame%1)
        hip=vm['hip'];root.location=(hip[0],-hip[2],hip[1]);root.rotation_mode='QUATERNION';root.rotation_quaternion=Matrix.Rotation(vm['hipRotation'][1],4,'Z').to_quaternion()
        bpy.context.view_layer.update()
        motion=bpy.data.objects['WeaponMotion'].matrix_world
        target=motion@Vector((-.003,0,.004))
        for light,off in lights:
            light.location=target+off;light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
        bpy.data.objects['DJMaesenArms'].hide_render=offset is not None
        if offset:
            camera.location=motion@Vector(offset);camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=.405
        else:
            camera.location=(0,0,0);camera.rotation_euler=Vector((0,1,0)).to_track_quat('-Z','Y').to_euler();camera.data.type='PERSP';camera.data.sensor_fit='VERTICAL';camera.data.sensor_height=24;camera.data.lens=24/(2*math.tan(math.radians(54)/2))
        path=OUT/stage/(name+'.png');path.parent.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(path)
        bpy.ops.render.render(write_still=True)
        report[name]={'camera':[list(r) for r in camera.matrix_world],'type':camera.data.type,'orthoScale':camera.data.ortho_scale,'lens':camera.data.lens,'seconds':seconds,'clip':clip,'lights':[{ 'position':list(l.location),'energy':l.data.energy,'size':l.data.size} for l,_ in lights],'exposure':scene.view_settings.exposure}
        print('TEXTURE rendered',stage,name,flush=True)
    (OUT/stage/('capture-'+(only or 'all')+'.json')).write_text(json.dumps(report,indent=2))

p=argparse.ArgumentParser();p.add_argument('mode',choices=['extract','update','verify','render','diagnose']);p.add_argument('--stage',default='before');p.add_argument('--only',default='');a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
OUT.mkdir(parents=True,exist_ok=True)
if a.mode=='extract':extract()
elif a.mode=='update':update()
elif a.mode=='verify':
    actual=fingerprints();expected=json.loads((OUT/'before/fingerprints.json').read_text())
    changes={k:[n for n in actual[k] if actual[k][n]!=expected[k].get(n)] for k in actual}
    print('TEXTURE fingerprint differences',changes,flush=True)
    assert actual==expected,'Protected source changed after reopen'
    materials={}
    for m in bpy.data.materials:
        if not m.name.startswith('Gun |'):continue
        p=m.node_tree.nodes.get('Principled BSDF');nodes=m.node_tree.nodes;links=m.node_tree.links
        assert p.inputs['Metallic'].default_value==1 and p.inputs['Roughness'].default_value==1
        for name,kind in [('Gun finish basecolor','basecolor'),('Gun finish baked normal','normal'),('Gun finish ORM','orm')]:
            image=nodes[name].image
            assert image.colorspace_settings.name==('sRGB' if kind=='basecolor' else 'Non-Color')
            assert image.packed_file.data==(ROOT/f'source-assets/gun/gun-{kind}.png').read_bytes(),'Stale packed '+kind
        assert p.inputs['Base Color'].links[0].from_node==nodes['Gun finish basecolor']
        assert p.inputs['Normal'].links[0].from_node.type=='NORMAL_MAP'
        assert p.inputs['Roughness'].links[0].from_socket.name=='Green'
        assert p.inputs['Metallic'].links[0].from_socket.name=='Blue'
        materials[m.name]={'mapsPackedMatchDisk':True,'factors':[1,1],'ormNonColor':True}
    (OUT/'source-verification.json').write_text(json.dumps({'pass':True,'fingerprints':actual,'materials':materials},indent=2))
    print('TEXTURE fresh reopen fingerprints PASS')
elif a.mode=='diagnose':
    import numpy as np
    for m in bpy.data.materials:
        if not m.name.startswith('Gun |'):continue
        print('MATERIAL',m.name)
        for n in m.node_tree.nodes:
            if n.type in {'NORMAL_MAP','TEX_IMAGE','BSDF_PRINCIPLED','SEPARATE_COLOR'}:
                print(n.name,n.type,[(i.name,str(i.default_value)) for i in n.inputs if hasattr(i,'default_value')])
                if n.type=='TEX_IMAGE' and n.image:
                    print('IMAGE',n.image.name,n.image.filepath,n.image.colorspace_settings.name)
                    if m.name=='Gun | brushed graphite steel':
                        pixels=np.empty(len(n.image.pixels),np.float32);n.image.pixels.foreach_get(pixels);np.save(OUT/(a.stage+'-'+n.image.name+'.npy'),pixels)
        print('LINKS',[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name) for l in m.node_tree.links])
else:render(a.stage,a.only)
