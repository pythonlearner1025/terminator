"""Fresh, continuous hand/forearm topology and reusable pose API. Blender Python.
All geometry is authored here; no mesh imports. Units metres; gun forward -X.
"""
import bpy
import bmesh
import math
import json
import hashlib
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

DIGITS = ('Thumb', 'Index', 'Middle', 'Ring', 'Little')
FINGER_LENGTHS = {'Index': (.034, .024, .020), 'Middle': (.039, .025, .021),
                  'Ring': (.036, .024, .020), 'Little': (.028, .020, .017),
                  'Thumb': (.031, .024, .022)}
DEFAULT_ANCHORS = {'GripCenter': [.126, 0, -.036], 'GripBackstrap': [.155, 0, -.035],
                   'TriggerContact': [.049, -.0035, .002], 'SupportContact': [.111, .014, -.032]}


def _material(name, color, roughness):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1)
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    if name == 'ResistanceSkin':
        p.inputs['Subsurface Weight'].default_value = .055
        p.inputs['Subsurface Radius'].default_value = (.8, .35, .18)
    return m


def _materials():
    skin = _material('ResistanceSkin', (.34, .185, .12), .52)
    fabric = _material('ResistanceSleeve', (.028, .037, .042), .86)
    nodes=fabric.node_tree.nodes;links=fabric.node_tree.links
    if not nodes.get('Fabric weave variation'):
        tex=nodes.new('ShaderNodeTexNoise');tex.name='Fabric weave variation';tex.inputs['Scale'].default_value=180;tex.inputs['Detail'].default_value=2
        uv=nodes.new('ShaderNodeTexCoord');links.new(uv.outputs['UV'],tex.inputs['Vector'])
        ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.018,.026,.030,1);ramp.color_ramp.elements[1].color=(.038,.048,.054,1)
        links.new(tex.outputs['Fac'],ramp.inputs['Fac']);links.new(ramp.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    return skin, fabric


class Surface:
    def __init__(self):
        self.verts, self.faces, self.weights, self.pads = [], [], [], {}
        self.nails = []
        self.seams = set()
    def v(self, co, weights):
        i = len(self.verts)
        self.verts.append(tuple(co)); self.weights.append(weights)
        return i
    def f(self, ids): self.faces.append(tuple(ids))
    def bridge(self, a, b):
        for i in range(len(a)):
            self.f((a[i], a[(i+1)%len(a)], b[(i+1)%len(b)], b[i]))
    def seam(self, a, b): self.seams.add(tuple(sorted((a,b))))


def _blend_weights(a, b, t):
    t = min(1., max(0., t))
    return {k:v for k,v in {a:1-t,b:t}.items() if v > 1e-7}


def _bone_weights(side, digit, distance, lengths):
    # Smooth transition across both sides of each anatomical joint.
    j1, j2 = lengths[0], sum(lengths[:2])
    names = [side+digit+str(i) for i in (1,2,3)]
    w = .0045 if digit != 'Little' else .0038
    if distance < .004:
        return _blend_weights('Hand'+side, names[0], .4+.6*distance/.004)
    if distance < j1-w: return {names[0]:1.}
    if distance < j1+w: return _blend_weights(names[0], names[1], (distance-j1+w)/(2*w))
    if distance < j2-w: return {names[1]:1.}
    if distance < j2+w: return _blend_weights(names[1], names[2], (distance-j2+w)/(2*w))
    return {names[2]:1.}


def _palm(side):
    s = Surface()
    # Top/bottom lattices share the full perimeter. Thumb branches through a side socket.
    rows = [(-.245,.036,.029),(-.225,.035,.028),(-.16,.031,.025),(-.10,.027,.021),
            (-.045,.023,.017),(-.014,.023,.015),(0,.026,.014),(.017,.033,.014),
            (.032,.038,.015),(.049,.039,.014),(.064,.038,.0125),(.078,.037,.012)]
    top, bot, mid = [], [], []
    # Wider middle metacarpals; paired samples form four sockets.
    fractions = [-1,-.74,-.48,-.22,.04,.30,.56,.78,1]
    for j,(y,half,thick) in enumerate(rows):
        tr, br = [], []
        forearm_t = max(0.,min(1.,(-y+.004)/.047))
        weights = _blend_weights('Hand'+side, side+'Forearm', forearm_t)
        for i,fx in enumerate(fractions):
            x=fx*half
            yy=y
            if j==len(rows)-1:
                yy += [-.005,.001,-.003,.003,-.002,0,-.008,-.006,-.015][i]
            arch=math.sqrt(max(.05, 1-.72*fx*fx))
            dorsal=thick*arch
            palmar=-thick*arch
            if y>0:
                # Metacarpal ridges, thenar and hypothenar eminences are shaped in the lattice.
                dorsal += .0011*math.cos((fx+1)*math.pi*4)*math.exp(-((y-.054)/.027)**2)
                dorsal += sum(.0018*math.exp(-((fx-k)/.15)**2-((y-.066)/.019)**2) for k in (-.74,-.22,.30,.78))
                palmar -= .004*math.exp(-((fx+.60)/.34)**2-((y-.027)/.024)**2)
                palmar -= .002*math.exp(-((fx-.70)/.30)**2-((y-.033)/.031)**2)
            tr.append(s.v((x,yy,dorsal),weights)); br.append(s.v((x,yy,palmar),weights))
        top.append(tr); bot.append(br)
        mid.append((s.v((-half,y,0),weights),s.v((half,yy,0),weights)))
    for j in range(len(rows)-1):
        for i in range(8):
            s.f((top[j][i],top[j+1][i],top[j+1][i+1],top[j][i+1]))
            s.f((bot[j][i+1],bot[j+1][i+1],bot[j+1][i],bot[j][i]))
        # Two side strips; leave thumb socket through rows 7–9 on radial side.
        if j not in (7,8):
            s.f((top[j][0],mid[j][0],mid[j+1][0],top[j+1][0]))
            s.f((mid[j][0],bot[j][0],bot[j+1][0],mid[j+1][0]))
        s.f((top[j+1][-1],mid[j+1][1],mid[j][1],top[j][-1]))
        s.f((mid[j+1][1],bot[j+1][-1],bot[j][-1],mid[j][1]))
        # Hidden inner forearm seam, carried to ulnar palm edge.
        s.seam(bot[j][-1],bot[j+1][-1])
    cap = top[0] + [mid[0][1]] + list(reversed(bot[0])) + [mid[0][0]]
    s.f(tuple(reversed(cap)))
    for i in range(len(cap)): s.seam(cap[i],cap[(i+1)%len(cap)])
    sockets={}
    # Crotch edges are genuinely shared, no floating fingers, no overlapping closed tubes.
    middles=[mid[-1][0]]+[s.v((s.verts[top[-1][i]][0],s.verts[top[-1][i]][1],0),{'Hand'+side:1}) for i in (2,4,6)]+[mid[-1][1]]
    for fi,digit in enumerate(DIGITS[1:]):
        i=fi*2
        sockets[digit]=[top[-1][i],top[-1][i+1],top[-1][i+2],middles[fi+1],bot[-1][i+2],bot[-1][i+1],bot[-1][i],middles[fi]]
    sockets['Thumb']=[top[7][0],top[8][0],top[9][0],mid[9][0],bot[9][0],bot[8][0],bot[7][0],mid[7][0]]
    return s,sockets


def _digit(s, side, digit, socket):
    points=[Vector(s.verts[i]) for i in socket]
    center=sum(points,Vector())/8
    lengths=FINGER_LENGTHS[digit]
    if digit=='Thumb':
        # Radial metacarpal leaves the thenar socket in a genuinely opposed, palmar direction.
        direction=Vector((-.82,.52,-.23)).normalized()
        width_axis=Vector((.52,.82,0)).normalized()
        normal=width_axis.cross(direction).normalized()
        if normal.z<0: normal.negate()
        radius=.0103
    else:
        fi=DIGITS.index(digit)-1
        direction=Vector(([-.025,0,.02,.075][fi],1,-.035)).normalized()
        width_axis=Vector((1,0,0)); normal=Vector((0,0,1))
        radius=[.0094,.0101,.0096,.0081][fi]
    # Ring ordering matches dorsal-left, dorsal-mid, dorsal-right, side, ventral triplet.
    section=[(-.78,.70),(0,1),(.78,.70),(1,0),(.78,-.72),(0,-1),(-.78,-.72),(-1,0)]
    total=sum(lengths)
    j1,j2=lengths[0],sum(lengths[:2])
    distances=[.006,.013,j1-.005,j1,j1+.005,j2-.004,j2,j2+.004,total-.007,total-.003,total]
    previous=socket
    pad=[]
    for ri,distance in enumerate(distances):
        t=distance/total
        # Flatten pad depth, taper phalanges, and keep support loops around knuckles.
        taper=1-.28*t
        bulge=1+.08*math.exp(-((distance-j1)/.006)**2)+.04*math.exp(-((distance-j2)/.005)**2)
        if distance>total-.007: taper *= max(.18,math.sqrt(max(0,1-((distance-(total-.007))/.009)**2)))
        c=center+direction*distance
        if digit!='Thumb': c.z-=.0025*t*t
        ring=[]
        weights=_bone_weights(side,digit,distance,lengths)
        for vi,(sx,sz) in enumerate(section):
            co=c+width_axis*(sx*radius*taper*bulge)+normal*(sz*radius*.86*taper)
            ring.append(s.v(co,weights))
            if distance>=j2+.004 and vi in (4,5,6): pad.append(ring[-1])
        s.bridge(previous,ring)
        s.seam(previous[5],ring[5])
        previous=ring
    tip=s.v(center+direction*(total+.001)-Vector((0,0,.001)),{side+digit+'3':1})
    for i in range(8): s.f((previous[i],previous[(i+1)%8],tip))
    s.pads[digit]=pad
    # Base opening seam keeps finger islands predictable while preserving shared topology.
    for i in range(8): s.seam(socket[i],socket[(i+1)%8])
    # Nails: a thin shaped dorsal patch, part of the hand object with the same skin material.
    nail_indices=[]
    for row,t in enumerate((.71,.74,.86,.94)):
        width=radius*(.50 if row in (0,3) else .61)
        for k in range(5):
            q=(k-2)/2
            c=center+direction*(total*t)
            if digit!='Thumb': c.z-=.0025*t*t
            co=c+width_axis*(q*width)+normal*(radius*.86*(1-.28*t)*math.sqrt(1-.28*q*q)+.00045)
            nail_indices.append(s.v(co,{side+digit+'3':1}))
    for j in range(3):
        for i in range(4):
            a=j*5+i
            s.f((nail_indices[a],nail_indices[a+1],nail_indices[a+6],nail_indices[a+5]))
    # Seam the nail boundary (intended attached plate, not part of watertight skin).
    for i in range(4):
        s.seam(nail_indices[i],nail_indices[i+1]); s.seam(nail_indices[15+i],nail_indices[16+i])
    for j in range(3):
        s.seam(nail_indices[j*5],nail_indices[(j+1)*5]); s.seam(nail_indices[j*5+4],nail_indices[(j+1)*5+4])
    s.nails.extend(nail_indices)
    return {'head':center,'direction':direction,'lengths':lengths,'normal':normal,'nails':nail_indices}


def _world_frame(anchors, side):
    grip=Vector(anchors['GripCenter'])
    if side=='Right':
        # +X across canonical palm becomes -Z; +Y toward fingers becomes -X.
        m=Matrix(((0,-1,0,grip.x+.070),(0,0,1,.028),(-1,0,0,grip.z-.006),(0,0,0,1)))
    else:
        # Left is mirrored in canonical X below, then rotated to cup the firing hand.
        m=Matrix(((0,-1,0,grip.x+.066),(0,0,-1,-.045),(1,0,0,grip.z-.012),(0,0,0,1)))
    return m


def _mesh_object(name,s,coll,material,frame,mirror=False):
    mesh=bpy.data.meshes.new(name+'Topology')
    # Reflection is baked into positions and face winding, never negative object scale.
    coords=[frame@Vector((-v[0] if mirror else v[0],v[1],v[2])) for v in s.verts]
    mesh.from_pydata(coords,[],[tuple(reversed(f)) if mirror else f for f in s.faces]); mesh.update()
    obj=bpy.data.objects.new(name,mesh); coll.objects.link(obj); mesh.materials.append(material)
    for i,weights in enumerate(s.weights):
        for bone,w in weights.items():
            vg=obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
            vg.add([i],w,'REPLACE')
    for digit,indices in s.pads.items():
        vg=obj.vertex_groups.new(name='Pad.'+digit); vg.add(indices,1,'REPLACE')
    if s.nails:
        vg=obj.vertex_groups.new(name='NailMask');vg.add(s.nails,1,'REPLACE')
    for e in mesh.edges: e.use_seam=tuple(sorted(e.vertices)) in s.seams
    # Recalculate consistently, preserving the quad cage and shared web vertices.
    bm=bmesh.new(); bm.from_mesh(mesh)
    loose=[v for v in bm.verts if not v.link_faces]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
    for p in mesh.polygons:p.use_smooth=True
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active=obj
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='ANGLE_BASED',margin=.012)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True,margin=.015)
    bpy.ops.object.mode_set(mode='OBJECT')
    sub=obj.modifiers.new('Deformation support surface','SUBSURF'); sub.levels=1; sub.render_levels=1
    bpy.ops.object.modifier_apply(modifier=sub.name)
    # Subdivision can round a unit weight to 1.0000001, which Blender/glTF rejects.
    # Clamp every group and renormalize actual deform groups after subdivision.
    for vertex in obj.data.vertices:
        memberships=[(g.group,g.weight) for g in vertex.groups]
        deform=[(i,w) for i,w in memberships if not obj.vertex_groups[i].name.startswith('Pad.') and obj.vertex_groups[i].name!='NailMask']
        total=sum(w for i,w in deform)
        for group,weight in memberships:
            is_deform=any(i==group for i,w in deform)
            value=weight/total if is_deform and total else weight
            obj.vertex_groups[group].add([vertex.index],max(0.,min(1.,value)),'REPLACE')
    if s.nails:
        # Applied subdivision replaces mesh datablock; query the resulting object data.
        attr=obj.data.color_attributes.get('SkinTint') or obj.data.color_attributes.new(name='SkinTint',type='FLOAT_COLOR',domain='CORNER')
        ng=obj.vertex_groups['NailMask'].index
        for loop in obj.data.loops:
            nail=any(g.group==ng and g.weight>.5 for g in obj.data.vertices[loop.vertex_index].groups)
            attr.data[loop.index].color=(.40,.265,.20,1) if nail else (.34,.185,.12,1)
        n=material.node_tree.nodes;l=material.node_tree.links
        tint=n.get('Skin tint') or n.new('ShaderNodeVertexColor');tint.name='Skin tint';tint.layer_name='SkinTint'
        l.new(tint.outputs['Color'],n.get('Principled BSDF').inputs['Base Color'])
    obj['freshTopology']=True
    return obj


def _sleeve(side,coll,material,frame,mirror):
    s=Surface(); previous=None
    rows=[(-.25,.037,.030),(-.241,.038,.031),(-.20,.036,.029),(-.15,.033,.027),
          (-.10,.029,.023),(-.064,.027,.021),(-.059,.0275,.0215),(-.055,.026,.020),(-.052,.0255,.0195)]
    for j,(y,rx,rz) in enumerate(rows):
        ring=[]
        for i in range(16):
            a=2*math.pi*i/16
            fold=1+.026*math.sin(a*3+j*1.4)
            ring.append(s.v((math.cos(a)*rx*fold*1.12,y,math.sin(a)*rz*fold*1.12),{side+'Forearm':1}))
        if previous is not None:
            s.bridge(previous,ring);s.seam(previous[12],ring[12])
        previous=ring
    # Open proximal sleeve is outside the first-person frustum; cuff folds inward onto wrist.
    return _mesh_object('Sleeve'+side,s,coll,material,frame,mirror)


def build_hands(gun_contract, collection=None, use_baked_materials=True):
    """Construct two new anatomical hands + forearms, two sleeves, one armature.
    Neutral rest pose; call apply_pose(result, 'grip') to place both grasp gestures.
    """
    anchors=gun_contract.get('anchors',gun_contract) if gun_contract else DEFAULT_ANCHORS
    anchors={**DEFAULT_ANCHORS,**anchors}
    coll=collection or bpy.data.collections.get('Rebuild')
    if coll is None:
        coll=bpy.data.collections.new('Rebuild');bpy.context.scene.collection.children.link(coll)
    skin,fabric=_materials()
    frames={side:_world_frame(anchors,side) for side in ('Right','Left')}
    specs={}; meshes=[]; pads={}; nail_ids={}
    for side in ('Right','Left'):
        s,sockets=_palm(side)
        specs[side]={digit:_digit(s,side,digit,sockets[digit]) for digit in DIGITS}
        nail_ids[side]=[i for d in specs[side].values() for i in d['nails']]
        obj=_mesh_object('HandMesh'+side,s,coll,skin,frames[side],side=='Left')
        meshes.append(obj);meshes.append(_sleeve(side,coll,fabric,frames[side],side=='Left'))
        pads[side]={d:[v.index for v in obj.data.vertices if any(g.group==obj.vertex_groups['Pad.'+d].index and g.weight>.30 for g in v.groups)] for d in DIGITS}
    for index,obj in enumerate(meshes):
        offset=Vector(((index%2)*.5,(index//2)*.5))
        for loop in obj.data.uv_layers.active.data:loop.uv=loop.uv*.48+offset+Vector((.01,.01))
    data=bpy.data.armatures.new('ResistanceHandsSkeleton');rig=bpy.data.objects.new('HandsRig',data);coll.objects.link(rig)
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
    bone_map={}
    for side in ('Right','Left'):
        frame=frames[side]
        def point(v):
            v=Vector(v)
            if side=='Left':v.x=-v.x
            return frame@v
        def bone(name,head,tail,parent=None):
            b=data.edit_bones.new(name);b.head=point(head);b.tail=point(tail)
            b.align_roll(frame.to_3x3()@Vector((0,0,1)))
            if parent:b.parent=data.edit_bones[parent]
            bone_map[name]={'head':list(b.head),'tail':list(b.tail),'parent':parent}
            return b
        bone(side+'Forearm',(0,-.245,0),(0,0,0))
        bone('Hand'+side,(0,0,0),(0,.064,0),side+'Forearm')
        for digit,spec in specs[side].items():
            p=spec['head'];parent='Hand'+side
            for i,length in enumerate(spec['lengths']):
                name=side+digit+str(i+1);q=p+spec['direction']*length
                bone(name,p,q,parent);p=q;parent=name
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in meshes:
        obj.parent=rig
        mod=obj.modifiers.new('Normalized joint skin','ARMATURE');mod.object=rig;mod.use_deform_preserve_volume=False
    for p in rig.pose.bones:p.rotation_mode='QUATERNION'
    rig.show_in_front=True
    rig['EmbeddedHands']=True
    rig['handFrames']=json.dumps({s:[list(r) for r in m] for s,m in frames.items()})
    metadata={'version':1,'frame':'metres; -X gun forward, Z up','freshGeometry':True,
              'poses':['neutral','open','grip','support','reload'],'frames':{s:[list(r) for r in m] for s,m in frames.items()},
              'padVertexIndices':pads,'bones':bone_map,'anchors':anchors,
              'materials':['ResistanceSkin','ResistanceSleeve'],
              'topology':'shared quad palm/web/thumb/forearm; nail plates are intentional attached surface islands',
              'textures':'UV unwrapped with hidden seams and 0.015 normalized island padding; no bake claimed',
              'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)}
    if use_baked_materials and apply_baked_materials(meshes):
        metadata['materials']=['ResistanceHandsAtlas']
        metadata['textures']='Real baked 1024px basecolor/normal/ORM; generated/hands/bake-report.json documents provenance'
    rig['handsMetadata']=json.dumps(metadata)
    return {'armature':rig,'meshes':meshes,'bones':bone_map,'metadata':metadata}


def _rig(result):return result['armature'] if isinstance(result,dict) else result


def pose_hand(result,side,gesture='grip',amount=1.):
    """Set local finger articulation, leaving root transforms untouched. Amount 0..1.
    Negative bone-local X flexes both; dorsal roll is consistently aligned.
    Thumb uses additional CMC opposition; no IK or constraints needed for export.
    """
    rig=_rig(result)
    presets={
      'neutral':{'Index':(0,0,0),'Middle':(0,0,0),'Ring':(0,0,0),'Little':(0,0,0),'Thumb':(0,0,0)},
      'open':{'Index':(3,8,4),'Middle':(5,10,5),'Ring':(9,12,7),'Little':(13,15,9),'Thumb':(3,8,7)},
      'reload':{'Index':(10,22,12),'Middle':(18,32,17),'Ring':(25,40,25),'Little':(35,45,30),'Thumb':(15,20,15)},
      'grip':{'Index':(0,13,22),'Middle':(66,74,43),'Ring':(75,65,38),'Little':(57,65,23),'Thumb':(16,49,45)},
      'support':{'Index':(20,108,42),'Middle':(26,68,56),'Ring':(27,110,60),'Little':(38,84,28),'Thumb':(8,16,24)}}
    if gesture not in presets:raise ValueError('Unknown hand gesture '+gesture)
    sign=-1
    for digit in DIGITS:
        for i,degrees in enumerate(presets[gesture][digit],1):
            p=rig.pose.bones[side+digit+str(i)]
            p.location=(0,0,0)
            p.rotation_quaternion=Quaternion((1,0,0),math.radians(degrees)*sign*amount)
            if i==1 and gesture in ('grip','support') and digit!='Thumb':
                spread=({'Index':11,'Middle':-6,'Ring':-6,'Little':-6} if gesture=='grip' else {'Index':6,'Middle':-6,'Ring':-6,'Little':2})[digit]
                p.rotation_quaternion=Quaternion((0,0,1),math.radians(spread)*amount)@p.rotation_quaternion
            if digit=='Little' and i==1 and gesture=='support':p.location.y=.002*amount
            if side=='Left' and gesture=='support' and i==1 and digit in ('Middle','Little'):
                # Small metacarpal spread from evaluated contact normals keeps the support pads outside the firing fingers.
                delta={'Middle':(-.0025,.001,-.0007),'Little':(-.0053,-.0044,-.0046)}[digit]
                p.location+=p.bone.matrix_local.to_3x3().inverted()@Vector(delta)*amount
            if digit=='Index' and i==1 and gesture=='grip':
                p.location.y=.004*amount
            if digit=='Thumb' and i==1:
                # CMC opposition rotates toward finger pads rather than merely folding a straight thumb.
                opposed=0 if gesture=='neutral' else ((-64 if gesture=='grip' else -60) if gesture in ('grip','support') else 8)
                p.rotation_quaternion=Quaternion((0,0,1),math.radians(opposed)*(1 if side=='Right' else -1)*amount)@p.rotation_quaternion
    bpy.context.view_layer.update()
    if gesture in ('grip','support'):_opposed_thumb(rig,side,amount)
    return rig


def _opposed_thumb(rig,side,amount):
    # CMC opposition is a 3D saddle-joint movement, not just hinge flexion.
    # Route the right metacarpal around the backstrap, then phalanges along its far side.
    directions=([(-.003,-.030,.009),(-.020,-.013,.004),(-.021,.001,-.005)] if side=='Right' else
                [(-.020,.014,.019),(-.023,.006,.003),(-.021,.006,-.005)])
    hand=rig.pose.bones['Hand'+side]
    delta=hand.matrix.to_3x3()@hand.bone.matrix_local.to_3x3().inverted()
    targets=[]
    for index,direction in enumerate(directions,1):
        p=rig.pose.bones[side+'Thumb'+str(index)]
        rest=p.bone.matrix_local.to_quaternion();rest_y=rest@Vector((0,1,0))
        desired=(delta@Vector(direction)).normalized()
        q=rest_y.rotation_difference(desired)@rest
        p.matrix=Matrix.Translation(p.head)@q.to_matrix().to_4x4()
        bpy.context.view_layer.update();targets.append(p.rotation_quaternion.copy())
    for index,q in enumerate(targets,1):
        p=rig.pose.bones[side+'Thumb'+str(index)];p.rotation_quaternion=Quaternion().slerp(q,amount)
    bpy.context.view_layer.update()


def apply_pose(result,gesture='grip',side=None,amount=1.):
    """Animation-worker API. grip applies Right grip + Left support."""
    for s in ([side] if side else ['Right','Left']):
        pose_hand(result,s,'support' if gesture=='grip' and s=='Left' else gesture,amount)
    return _rig(result)


def set_hand_transform(result,side,matrix):
    """Set full authoring-world delta on the Forearm root, affecting hand and sleeve.
    matrix is a world DELTA (identity = bind pose), not an absolute wrist transform.
    """
    rig=_rig(result);p=rig.pose.bones[side+'Forearm']
    p.matrix=rig.matrix_world.inverted()@Matrix(matrix)@rig.matrix_world@p.bone.matrix_local
    bpy.context.view_layer.update()


def contact_report(result,gun_objects):
    """Measure actual evaluated distal palmar pads against evaluated gun triangle surfaces.
    Signed nearest-surface gaps are diagnostic, not a guarantee against all intersections.
    """
    from mathutils.bvhtree import BVHTree
    deps=bpy.context.evaluated_depsgraph_get()
    targets=[]
    for obj in (gun_objects.values() if isinstance(gun_objects,dict) else gun_objects):
        if obj.type!='MESH':continue
        ev=obj.evaluated_get(deps);me=ev.to_mesh()
        vv=[ev.matrix_world@v.co for v in me.vertices];ff=[p.vertices[:] for p in me.polygons]
        targets.append((obj.name,BVHTree.FromPolygons(vv,ff)))
        ev.to_mesh_clear()
    meta=result['metadata'];report={}
    for side in ('Right','Left'):
        obj=next(o for o in result['meshes'] if o.name=='HandMesh'+side);ev=obj.evaluated_get(deps);me=ev.to_mesh()
        report[side]={}
        for digit,indices in meta['padVertexIndices'][side].items():
            samples=[]
            for i in indices:
                co=ev.matrix_world@me.vertices[i].co
                closest=None
                for name,tree in targets:
                    loc,normal,face,dist=tree.find_nearest(co)
                    if closest is None or dist<closest['distance']:
                        closest={'target':name,'distance':dist,'signedGap':(co-loc).dot(normal),'point':list(co)}
                if closest:samples.append(closest)
            report[side][digit]={'samples':len(samples),'minDistance':min((x['distance'] for x in samples),default=None),
                                 'minSignedGap':min((x['signedGap'] for x in samples),default=None),
                                 'centroid':list(sum((Vector(x['point']) for x in samples),Vector())/len(samples)) if samples else None}
        ev.to_mesh_clear()
    return report


def uv_signature(meshes):
    payload=[(o.name,len(o.data.vertices),[(round(p.uv.x,6),round(p.uv.y,6)) for p in o.data.uv_layers.active.data]) for o in sorted(meshes,key=lambda o:o.name)]
    return hashlib.sha256(json.dumps(payload,separators=(',',':')).encode()).hexdigest()


def apply_baked_materials(meshes,directory=None):
    """Attach the real atlas, consolidating skin and fabric into one game material.
    Returns False when bake artifacts are absent; never invents or labels a dummy bake.
    """
    directory=Path(directory) if directory else Path(__file__).resolve().parent/'generated/hands'
    files={kind:directory/('hands-'+kind+'.png') for kind in ('basecolor','normal','orm')}
    if not all(path.exists() for path in files.values()):return False
    report_path=directory/'bake-report.json'
    if not report_path.exists():return False
    baked=json.loads(report_path.read_text())
    if baked.get('uvSignature')!=uv_signature(meshes):
        print('Hands atlas is stale: UV signature differs; rebuild with review-hands.py then finish-hands.py')
        return False
    mat=bpy.data.materials.get('ResistanceHandsAtlas') or bpy.data.materials.new('ResistanceHandsAtlas')
    mat.use_nodes=True;mat.diffuse_color=(.34,.185,.12,1)
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;nodes.clear()
    out=nodes.new('ShaderNodeOutputMaterial');p=nodes.new('ShaderNodeBsdfPrincipled');links.new(p.outputs['BSDF'],out.inputs['Surface'])
    images={}
    for kind,path in files.items():
        im=bpy.data.images.load(str(path),check_existing=True);im.colorspace_settings.name='sRGB' if kind=='basecolor' else 'Non-Color';im.pack()
        t=nodes.new('ShaderNodeTexImage');t.image=im;t.name='Baked hands '+kind;images[kind]=t
    links.new(images['basecolor'].outputs['Color'],p.inputs['Base Color'])
    normal=nodes.new('ShaderNodeNormalMap');links.new(images['normal'].outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],p.inputs['Normal'])
    separate=nodes.new('ShaderNodeSeparateColor');separate.mode='RGB';links.new(images['orm'].outputs['Color'],separate.inputs['Color'])
    links.new(separate.outputs['Green'],p.inputs['Roughness']);links.new(separate.outputs['Blue'],p.inputs['Metallic'])
    group=bpy.data.node_groups.get('glTF Material Output')
    if group is None:
        group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
    g=nodes.new('ShaderNodeGroup');g.node_tree=group;links.new(separate.outputs['Red'],g.inputs['Occlusion'])
    for obj in meshes:
        obj.data.materials.clear();obj.data.materials.append(mat)
        tint=obj.data.color_attributes.get('SkinTint')
        if tint:obj.data.color_attributes.remove(tint)  # already baked; avoid a second glTF vertex-color multiplication
        for poly in obj.data.polygons:poly.material_index=0
    return True
