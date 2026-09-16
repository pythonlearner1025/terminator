"""Read a saved Blend and sample its actual named NLA tracks. Never save the Blend."""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy

def curves(action):
    if hasattr(action, 'fcurves'):
        return list(action.fcurves)
    result=[]
    for layer in action.layers:
        for strip in layer.strips:
            for bag in getattr(strip, 'channelbags', []):
                result.extend(bag.fcurves)
    return result

def plain_matrix(matrix):
    return [[float(v) for v in row] for row in matrix]

def track_inventory(obj):
    tracks=[]
    if not obj.animation_data:
        return tracks
    for track in obj.animation_data.nla_tracks:
        strips=[]
        for strip in track.strips:
            action=strip.action
            frames=sorted(set(round(float(k.co.x),8) for fc in curves(action) for k in fc.keyframe_points))
            strips.append({'name':strip.name,'action':action.name,'stripRange':[strip.frame_start,strip.frame_end],
                'actionRange':[strip.action_frame_start,strip.action_frame_end], 'keyFrames':frames,
                'fcurveCount':len(curves(action)), 'scale':strip.scale,'repeat':strip.repeat,'influence':strip.influence})
        tracks.append({'name':track.name,'mutedAtLoad':track.mute,'strips':strips})
    return tracks

def select_clip(name):
    count=0
    for obj in bpy.context.scene.objects:
        ad=obj.animation_data
        if not ad:
            continue
        ad.action=None
        for track in ad.nla_tracks:
            track.is_solo=False
            track.mute=track.name!=name
            count+=track.name==name
    if not count:
        raise RuntimeError('No named NLA track '+name)
    return count

def sample(mesh_object, seconds, fps):
    frame=seconds*fps
    bpy.context.scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame))
    bpy.context.view_layer.update()
    evaluated=mesh_object.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh=evaluated.to_mesh()
    try:
        points=[]
        for vertex in mesh.vertices:
            p=evaluated.matrix_world@vertex.co
            points.append([float(p.x),float(p.z),float(-p.y)])
        return {'seconds':seconds,'frame':frame,'vertexCount':len(points),'worldGltfAxes':points,
            'evaluatedMeshMatrixWorldBlender':plain_matrix(evaluated.matrix_world)}
    finally:
        evaluated.to_mesh_clear()

args=argparse.ArgumentParser()
args.add_argument('--out',required=True)
args.add_argument('--mesh',default='DJMaesenArms')
args.add_argument('--samples',help='JSON file mapping clip names to sample seconds')
options=args.parse_args(sys.argv[sys.argv.index('--')+1:])
mesh_object=bpy.data.objects.get(options.mesh)
if not mesh_object or mesh_object.type!='MESH':
    raise RuntimeError('Combined source mesh not found: '+options.mesh)
armatures=[m.object for m in mesh_object.modifiers if m.type=='ARMATURE' and m.object]
if len(armatures)!=1:
    raise RuntimeError('Expected exactly one armature modifier')
armature=armatures[0]
requests=json.loads(Path(options.samples).read_text()) if options.samples else {'Idle':[0,1/60,2/60],'Fire':[0,.05,.1]}
fps=bpy.context.scene.render.fps/bpy.context.scene.render.fps_base
uvs=[{} for _ in mesh_object.data.vertices]
for layer in mesh_object.data.uv_layers:
    for loop in mesh_object.data.loops:
        uv=[float(x) for x in layer.data[loop.index].uv]
        values=uvs[loop.vertex_index].setdefault(layer.name,[])
        if uv not in values:
            values.append(uv)
vertices=[]
for vertex in mesh_object.data.vertices:
    weights={mesh_object.vertex_groups[g.group].name:float(g.weight) for g in vertex.groups if g.weight>0}
    vertices.append({'index':vertex.index,'localBlender':list(vertex.co),'localGltfAxes':[vertex.co.x,vertex.co.z,-vertex.co.y],
        'uvs':uvs[vertex.index],'weights':weights})
constraints=[c for bone in armature.pose.bones for c in bone.constraints]
constraints += [c for obj in bpy.context.scene.objects if obj.name in ['HandRight','HandLeft'] for c in obj.constraints]
constraint_state=[{'name':c.name,'type':c.type,'muted':c.mute,'target':c.target.name if hasattr(c,'target') and c.target else None} for c in constraints]
report={'sourceBlend':bpy.data.filepath,'sourceBlendSha256':hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
    'mesh':mesh_object.name,'vertexCount':len(vertices),'vertices':vertices,'uvLayers':[x.name for x in mesh_object.data.uv_layers],
    'armature':armature.name,'boneCount':len(armature.data.bones),'boneNames':[b.name for b in armature.data.bones],
    'fps':fps,'sourceMeshMatrixWorldBlender':plain_matrix(mesh_object.matrix_world),
    'parents':[obj.name for obj in [mesh_object.parent,armature.parent] if obj],
    'constraintsAtLoad':constraint_state,'nla':{o.name:track_inventory(o) for o in bpy.context.scene.objects if o.animation_data},
    'samples':{},'nativeBakeMutedConstraints':{},'coordinateConversion':'WORLD Blender [x,y,z] -> glTF [x,z,-y]; full evaluated mesh matrix_world applied'}
for clip,seconds in requests.items():
    selected=select_clip(clip)
    report['samples'][clip]={'selectedTracks':selected,'frames':[sample(mesh_object,float(t),fps) for t in seconds]}
# Diagnostic isolates native baked actions from the preserved live driver rig.
for c in constraints:
    c.mute=True
for clip,seconds in requests.items():
    select_clip(clip)
    report['nativeBakeMutedConstraints'][clip]={'frames':[sample(mesh_object,float(t),fps) for t in seconds]}
Path(options.out).parent.mkdir(parents=True,exist_ok=True)
Path(options.out).write_text(json.dumps(report,separators=(',',':'))+'\n')
print('QA_SKIN_SOURCE',json.dumps({'out':options.out,'vertices':len(vertices),'bones':len(armature.data.bones),'fps':fps,'clips':requests}))
