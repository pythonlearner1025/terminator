"""Native DJMaesen control adapter. Geometry, weights, UVs and constraints stay intact."""
import json, math
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
HERE=Path(__file__).resolve().parent
SOURCE=HERE/'source/imported-hands'

def frame(u,v):
    u=u.normalized();v=(v-u*u.dot(v)).normalized();return Matrix((u,v,u.cross(v))).transposed()

def build_hands(gun_contract,collection=None):
    collection=collection or bpy.context.collection
    with bpy.data.libraries.load(str(SOURCE/'neutral.blend'),link=False) as (src,dst):
        dst.objects=[n for n in src.objects if not n.startswith(('Camera','Light'))]
    objects=[o for o in dst.objects if o is not None and o.type not in ('LIGHT','CAMERA')]
    for obj in objects:collection.objects.link(obj)
    rig=next(o for o in objects if o.type=='ARMATURE')
    mesh=next(o for o in objects if o.type=='MESH');mesh.name='DJMaesenArms'
    root=bpy.data.objects.new('ImportedHandsSource',None);collection.objects.link(root)
    for obj in objects:
        if obj.parent is None:obj.parent=root
    root.scale=(.5,)*3
    controls={pb.name:pb.constraints[0].target for pb in rig.pose.bones}
    for control in controls.values():
        basis=control.matrix_basis.copy();control.rotation_mode='QUATERNION';control.matrix_basis=basis
    mapping=json.loads((SOURCE/'rig-report.json').read_text())['control_mapping']
    bpy.context.view_layer.update()
    rest={n:o.matrix_basis.copy() for n,o in controls.items()}
    result={'armature':rig,'meshes':[mesh],'source_root':root,'objects':objects+[root], 'controls':controls,'mapping':mapping,'rest':rest,'bones':{n:n for n in controls},'metadata':{'source':'DJMaesen First Person arms','license':'CC BY 4.0','imported':True,'uniformScale':.5,'nativeBones':49,'loadingPose':{'status':'native-control pinch retarget','fit':json.loads((SOURCE/'pinch-fit.json').read_text())['pads'],'limits':'12mm speedloader stem; evaluated pad centroids do not certify full skin clearance'}}}
    # Place the complete arm chain rigidly from its source palm frame; never move
    # the wrist alone and leave the sleeve behind.
    for side in ('R','L'):
        m=mapping[side]
        pos=lambda label:controls[m[label]['joints'][0] if 'joints' in m[label] else m[label]['joint']].matrix_world.translation.copy()
        wrist=pos('wrist');source=frame(pos('middle')-wrist,pos('index')-pos('little'))
        target=frame(Vector((-.93,.37,0) if side=='R' else (-1,.18,0)),Vector((0,0,1)))
        q=target@source.transposed()
        destination=Vector((.205,.012,-.025) if side=='R' else (.180,-.070,-.048))
        transform=Matrix.Translation(destination)@q.to_4x4()@Matrix.Translation(-wrist)
        fit=SOURCE/'palm-fit.json'
        if side=='R' and fit.exists() and not (SOURCE/'approved-r1-right-pose.json').exists():transform=Matrix(json.loads(fit.read_text())['best'][2]['transform'])@transform
        upper=controls[m['upper_arm']['joint']];upper.matrix_world=transform@upper.matrix_world
        bpy.context.view_layer.update()
    result['fit_rest']={n:o.matrix_basis.copy() for n,o in controls.items()}
    apply_pose(result,'grip')
    fit=SOURCE/'grasp-fit.json'
    result['pad_ids']={(side,digit):entry['ids'] for key,entry in json.loads(fit.read_text()).items() for side,digit in [key.split(':')]} if fit.exists() else {}
    return result

def apply_pose(hands,gesture='grip'):
    for n,o in hands['controls'].items():o.matrix_basis=hands['fit_rest'][n]
    for side in ('R','L'):
        for digit in ('thumb','index','middle','ring','little'):
            angles=(15,20,15) if digit=='thumb' else (5,35,20) if side=='R' and digit=='index' else (55,40,15)
            for name,angle in zip(hands['mapping'][side][digit]['joints'],angles):
                hands['controls'][name].matrix_basis=hands['fit_rest'][name]@Matrix.Rotation(math.radians(-angle),4,'X')
    fit=SOURCE/'grasp-fit.json'
    if fit.exists():
        for key,entry in json.loads(fit.read_text()).items():
            side,digit=key.split(':');p=entry['params']
            for i,n in enumerate(hands['mapping'][side][digit]['joints']):
                mat=hands['fit_rest'][n]@Matrix.Rotation(math.radians(-p[i]),4,'X')
                if i==0:mat=mat@Matrix.Rotation(math.radians(p[3]),4,'Y')@Matrix.Rotation(math.radians(p[4]),4,'Z')
                hands['controls'][n].matrix_basis=Matrix(entry['rootMatrix']) if i==0 and 'rootMatrix' in entry else mat
    approved=SOURCE/'approved-r1-right-pose.json'
    if approved.exists():
        for n,matrix in json.loads(approved.read_text())['rightControlBasis'].items():hands['controls'][n].matrix_basis=Matrix(matrix)
    offsets=SOURCE/'visible-contact-offsets.json'
    if offsets.exists():
        for n,matrix in json.loads(offsets.read_text())['controls'].items():hands['controls'][n].matrix_basis=Matrix(matrix)
    bpy.context.view_layer.update()

def contact_report(hands,gun_objects):
    """All evaluated hand vertices against gun surfaces; signed normals are diagnostic.
    Small overlaps between gun component meshes and concavity limit signed-distance
    reliability. Never treat this as a substitute for multi-angle review.
    """
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
    trees=[]
    for obj in gun_objects:
        if obj.type!='MESH':continue
        ev=obj.evaluated_get(dg);mesh=ev.to_mesh()
        points=[ev.matrix_world@v.co for v in mesh.vertices]
        bounds=([min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)])
        trees.append((obj.name,BVHTree.FromPolygons(points,[list(p.vertices) for p in mesh.polygons]),bounds))
        ev.to_mesh_clear()
    obj=hands['meshes'][0];ev=obj.evaluated_get(dg);mesh=ev.to_mesh();report={}
    for side in ('R','L'):
        for digit in ('thumb','index','middle','ring','little','wrist','palm'):
            entry=hands['mapping'][side][digit];names=entry.get('joints',[entry.get('joint')]);groups={g.index for g in obj.vertex_groups if g.name in names}
            ids=[v.index for v in obj.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.5]
            worst=0;near=float('inf');hits=[]
            for idx in ids:
                pt=ev.matrix_world@mesh.vertices[idx].co
                for name,tree,bounds in trees:
                    q,n,face,d=tree.find_nearest(pt)
                    inside=all(bounds[0][i]<pt[i]<bounds[1][i] for i in range(3))
                    if inside:
                        votes=0
                        for direction in (Vector((1,.137,.073)).normalized(),Vector((.173,1,.097)).normalized(),Vector((.091,.163,1)).normalized()):
                            cursor=pt.copy();count=0
                            for _ in range(64):
                                hit,_,_,_=tree.ray_cast(cursor,direction)
                                if hit is None:break
                                count+=1;cursor=hit+direction*.000001
                            votes+=count%2
                        inside=votes==3
                    signed=-d if inside else d
                    near=min(near,d)
                    if signed<worst:worst=signed;worst_info={'vertex':idx,'part':name,'point':list(pt)}
                    if signed<-.001:hits.append((idx,name,signed))
            report[side+':'+digit]={'vertices':len(ids),'nearestSurfaceM':near,'worstSignedM':worst,'worst':worst_info if worst else None,'penetratingVertexPartPairs':len(hits)}
    ev.to_mesh_clear();return {'method':'evaluated vertices / 3-direction unanimous ray parity inside component bounds; depth is nearest surface. Open meshes remain uncertain','digits':report}

def pad_indices(hands,side,digit):
    obj=hands['meshes'][0];name=hands['mapping'][side][digit]['joints'][2];group=obj.vertex_groups.get(name)
    # Source topology selection: distal-weighted vertices toward the native fingertip.
    # Lowest local Y faces the flexion/palm side (native negative-X curl).
    ev=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();inverse=hands['controls'][name].matrix_world.inverted()
    candidates=[(v.index,inverse@(ev.matrix_world@mesh.vertices[v.index].co)) for v in obj.data.vertices if any(g.group==group.index and g.weight>.75 for g in v.groups)]
    ev.to_mesh_clear();zs=sorted(p.z for _,p in candidates);ys=sorted(p.y for _,p in candidates)
    return [i for i,p in candidates if p.z<zs[len(zs)//2] and p.y<ys[len(ys)//3]]

def pad_center(hands,ids):
    bpy.context.view_layer.update();ev=hands['meshes'][0].evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh()
    center=sum((ev.matrix_world@mesh.vertices[i].co for i in ids),Vector())/len(ids);ev.to_mesh_clear();return center

def bilateral_report(hands):
    """Evaluated left/right triangle shells; open sleeve cuffs limit inside tests."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update();ob=hands['meshes'][0];ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();points=[ev.matrix_world@v.co for v in mesh.vertices]
    sides={v.index:('L' if sum(g.weight for g in v.groups if ob.vertex_groups[g.group].name.startswith('L_'))>.5 else 'R') for v in ob.data.vertices}
    trees={s:BVHTree.FromPolygons(points,[list(p.vertices) for p in mesh.polygons if all(sides[i]==s for i in p.vertices)]) for s in ('R','L')}
    report={}
    for side in ('R','L'):
        tree=trees['L' if side=='R' else 'R']
        for digit in ('thumb','index','middle','ring','little','wrist','palm'):
            entry=hands['mapping'][side][digit];names=entry.get('joints',[entry.get('joint')]);groups={g.index for g in ob.vertex_groups if g.name in names}
            ids=[v.index for v in ob.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.5]
            worst=0;near=10;count=0
            for idx in ids:
                pt=points[idx];q,n,_,d=tree.find_nearest(pt);near=min(near,d)
                if d>.025 or (pt-q).dot(n)>=0:continue
                votes=0
                for direction in (Vector((1,.137,.073)).normalized(),Vector((.173,1,.097)).normalized(),Vector((.091,.163,1)).normalized()):
                    cursor=pt.copy();hits=0
                    for _ in range(64):
                        hit,_,_,_=tree.ray_cast(cursor,direction)
                        if hit is None:break
                        hits+=1;cursor=hit+direction*.000001
                    votes+=hits%2
                if votes==3:worst=min(worst,-d);count+=1
            report[side+':'+digit]={'nearestOtherHandM':near,'worstInsideOtherHandM':worst,'insideVertices':count}
    ev.to_mesh_clear();return report

def mix_matrix(a,b,t):
    al,aq,asc=a.decompose();bl,bq,bsc=b.decompose()
    return Matrix.LocRotScale(al.lerp(bl,t),aq.slerp(bq,t),asc.lerp(bsc,t))

def move_support(hands,motion,delta,release,contact=None):
    """Part-local hand contacts with native arm routing and digit gestures.
    Called after deterministic approved grip restoration.
    """
    controls=hands['controls'];mapping=hands['mapping']['L']
    for digit in ('thumb','index','middle','ring','little'):
        for name in mapping[digit]['joints']:
            controls[name].matrix_basis=mix_matrix(controls[name].matrix_basis,hands['fit_rest'][name],release)
    upper=controls[mapping['upper_arm']['joint']]
    bpy.context.view_layer.update();world=upper.matrix_world.copy();world.translation+=motion.matrix_world.to_3x3()@delta;upper.matrix_world=world
    if contact and contact['weight']>0:
        digit=contact['digit'].lower();digit='index' if digit=='index' else digit
        if contact.get('gesture')=='loading':
            pinch=SOURCE/'pinch-fit.json'
            if not pinch.exists():raise RuntimeError('Imported loading gesture has not been fitted/reviewed')
            for name,matrix in json.loads(pinch.read_text())['controls'].items():
                controls[name].matrix_basis=mix_matrix(controls[name].matrix_basis,Matrix(matrix),contact['weight'])
        bpy.context.view_layer.update()
        ids=hands.setdefault('pad_ids',{}).get(('L',digit))
        if ids is None:
            ids=pad_indices(hands,'L',digit);hands['pad_ids'][('L',digit)]=ids
        center=pad_center(hands,ids)
        if contact.get('pinchDirection') is not None:
            thumb_ids=hands.setdefault('pad_ids',{}).get(('L','thumb')) or pad_indices(hands,'L','thumb')
            direction=pad_center(hands,thumb_ids)-center
            rotation=direction.rotation_difference(contact['pinchDirection'])
            from mathutils import Quaternion
            rotation=Quaternion().slerp(rotation,contact['weight'])
            upper.matrix_world=Matrix.Translation(center)@rotation.to_matrix().to_4x4()@Matrix.Translation(-center)@upper.matrix_world
            bpy.context.view_layer.update();center=pad_center(hands,ids)
        world=upper.matrix_world.copy();world.translation+=(contact['point']-center)*contact['weight'];upper.matrix_world=world
    bpy.context.view_layer.update()
    # Preserve the contacting hand frame while routing the native arm chain below
    # the view. Rotation about the wrist retains both segment lengths and all
    # source weights; the wrist compensates naturally instead of dragging a sleeve
    # rigidly through the camera when a fingertip acquires a target.
    wrist=controls[mapping['wrist']['joint']]
    elbow=controls[mapping['forearm']['joint']]
    wrist_world=wrist.matrix_world.copy();pivot=wrist_world.translation
    current=elbow.matrix_world.translation-pivot
    desired=motion.matrix_world.to_3x3()@Vector((.08,-.20,-.32))
    from mathutils import Quaternion
    rotation=Quaternion().slerp(current.rotation_difference(desired),release)
    transform=Matrix.Translation(pivot)@rotation.to_matrix().to_4x4()@Matrix.Translation(-pivot)
    upper.matrix_world=transform@upper.matrix_world
    bpy.context.view_layer.update()
    wrist.matrix_world=wrist_world
    bpy.context.view_layer.update()

def bind_trigger_contact(hands,trigger):
    bpy.context.view_layer.update()
    hands['triggerContactLocal']=trigger.matrix_world.inverted()@pad_center(hands,hands['pad_ids'][('R','index')])

def fire_contact(hands,trigger,weight):
    """Small evaluated-skin correction follows the articulated trigger surface.
    Baked offline; no IK cost in the game. Each call starts from approved grip.
    """
    import numpy as np
    bpy.context.view_layer.update()
    target=trigger.matrix_world@hands['triggerContactLocal']
    names=hands['mapping']['R']['index']['joints'];bases=[hands['controls'][n].matrix_basis.copy() for n in names];ids=hands['pad_ids'][('R','index')];angles=[0.,0.,0.]
    def point(values):
        for n,basis,angle in zip(names,bases,values):hands['controls'][n].matrix_basis=basis@Matrix.Rotation(angle,4,'X')
        return pad_center(hands,ids)
    for _ in range(4):
        current=point(angles);error=target-current
        if error.length<.00003:break
        columns=[]
        for i in range(3):
            test=angles.copy();test[i]+=.001;columns.append((point(test)-current)/.001)
        jacobian=np.array(columns).T
        delta=np.linalg.solve(jacobian.T@jacobian+np.eye(3)*1e-7,jacobian.T@np.array(error))
        angles=[max(-.12,min(.12,a+max(-.05,min(.05,float(d))))) for a,d in zip(angles,delta)]
    point(angles)

def press_latch(hands,latch,amount):
    """Raise the opposed firing thumb to the latch, then restore the grasp."""
    if amount<=0:return
    import numpy as np
    bpy.context.view_layer.update();ids=hands['pad_ids'][('R','thumb')];start=pad_center(hands,ids);target=start.lerp(latch.matrix_world@Vector((0,-.001,.003)),amount)
    names=hands['mapping']['R']['thumb']['joints'];bases=[hands['controls'][n].matrix_basis.copy() for n in names];angles=[0.,0.,0.]
    def point(values):
        for n,basis,angle in zip(names,bases,values):hands['controls'][n].matrix_basis=basis@Matrix.Rotation(angle,4,'X')
        return pad_center(hands,ids)
    for _ in range(5):
        current=point(angles);error=target-current
        if error.length<.0001:break
        columns=[]
        for i in range(3):
            test=angles.copy();test[i]+=.002;columns.append((point(test)-current)/.002)
        jac=np.array(columns).T;delta=np.linalg.solve(jac.T@jac+np.eye(3)*2e-6,jac.T@np.array(error))
        angles=[max(-.45,min(.45,a+max(-.08,min(.08,float(d))))) for a,d in zip(angles,delta)]
    point(angles)
