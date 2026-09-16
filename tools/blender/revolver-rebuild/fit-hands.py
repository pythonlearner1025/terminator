"""Bounded evaluated-skin contact fitting. Diagnostic optimizer; renders remain acceptance.
Does not modify builder automatically. Writes suggested angles and visible captures.
"""
import bpy,json,math,importlib.util,sys
from pathlib import Path
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('hands',HERE/'hands.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
bpy.ops.wm.open_mainfile(filepath=str(HERE/'generated/hands/hands.blend'))
rig=bpy.data.objects['HandsRig'];meta=json.loads(rig['handsMetadata']);meshes=[bpy.data.objects[n+s] for s in ('Right','Left') for n in ('HandMesh','Sleeve')]
result={'armature':rig,'meshes':meshes,'bones':meta['bones'],'metadata':meta};h.apply_pose(result,'grip')
deps=bpy.context.evaluated_depsgraph_get()
def tree(objects):
    verts=[];faces=[]
    for obj in objects:
        ev=obj.evaluated_get(deps);me=ev.to_mesh();offset=len(verts);verts.extend(ev.matrix_world@v.co for v in me.vertices)
        faces.extend(tuple(i+offset for i in p.vertices) for p in me.polygons);ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts,faces)
gun=[o for o in bpy.data.collections['Rebuild'].objects if o.type=='MESH' and o not in meshes]
alltree=tree(gun);griptree=tree([o for o in gun if 'Grip' in o.name]);trigger=tree([o for o in gun if o.name=='Trigger'])
base={'Right':{'Thumb':[20,25,12,-55],'Index':[0,13,18,13],'Middle':[5,105,85,0],'Ring':[8,105,85,0],'Little':[8,90,60,0]},
      'Left':{'Thumb':[17,25,15,55],'Index':[13,78,55,0],'Middle':[10,95,80,0],'Ring':[15,100,82,0],'Little':[15,95,65,0]}}
support_only='--support' in sys.argv
if support_only:
    griptree=tree([bpy.data.objects['HandMeshRight']]);alltree=tree(gun+[bpy.data.objects['HandMeshRight']])
report={}
for side in (('Left',) if support_only else ('Right','Left')):
    obj=bpy.data.objects['HandMesh'+side];report[side]={}
    for digit in h.DIGITS:
        if support_only and digit=='Thumb':continue
        pad=meta['padVertexIndices'][side][digit][::3]
        bone_groups={g.index for g in obj.vertex_groups if g.name.startswith(side+digit)}
        surface=[v.index for v in obj.data.vertices if sum(g.weight for g in v.groups if g.group in bone_groups)>.6][::6]
        target=trigger if side=='Right' and digit=='Index' else griptree
        angles=base[side][digit][:]
        wrap=digit not in ('Thumb',) and not(side=='Right' and digit=='Index')
        if wrap:angles=[20,90,60,0] if support_only else [75,65,35,0]
        def set_angles(values):
            for i in range(3):
                p=rig.pose.bones[side+digit+str(i+1)];p.rotation_quaternion=Quaternion((1,0,0),-math.radians(values[i]))
                if i==0:p.rotation_quaternion=Quaternion((0,0,1),math.radians(values[3]))@p.rotation_quaternion
            bpy.context.view_layer.update()
        def score(values):
            set_angles(values);ev=obj.evaluated_get(deps);me=ev.to_mesh();dist=[];penetration=[]
            for i in pad:
                co=ev.matrix_world@me.vertices[i].co;loc,n,face,d=target.find_nearest(co)
                dist.append(d)
            for i in surface:
                co=ev.matrix_world@me.vertices[i].co;loc,n,face,d=alltree.find_nearest(co);signed=(co-loc).dot(n)
                penetration.append(max(0,-signed-.0006))
            ev.to_mesh_clear()
            # Broad pad contact, harsh whole-finger penetration cost, low preference for original gesture.
            return sum(d*d for d in dist)/len(dist)+8*sum(p*p for p in penetration)/len(penetration)+4*max(penetration)**2
        original=score(angles);best=original
        for step in (18,9,4,2):
            for repeat in range(2):
                improved=False
                for axis in range(4):
                    for delta in (-step,step):
                        test=angles[:];test[axis]+=delta
                        bounds=(((0,85),(15,125),(5,95),(-6,6)) if support_only else ((45,105),(15,110),(5,80),(-6,6))) if wrap else (((5,35),(0,50),(0,45),(-65,-45) if side=='Right' else (45,65)) if digit=='Thumb' else ((-15,35),(0,65),(0,65),(5,18)))
                        if not bounds[axis][0]<=test[axis]<=bounds[axis][1]:continue
                        value=score(test)
                        if value<best:angles,best=test,value;improved=True
                if not improved:break
        set_angles(angles);report[side][digit]={'angles':angles,'initialObjective':original,'finalObjective':best}
        print(side,digit,angles,best,flush=True)
report['contacts']=h.contact_report(result,gun)
out=HERE/'generated/review/hands';(out/'fitted-poses.json').write_text(json.dumps(report,indent=2)+'\n')
scene=bpy.context.scene;scene.render.engine='BLENDER_WORKBENCH'
for view in ('player','back','palm'):
    scene.camera=bpy.data.objects['HandsReview.'+view.capitalize()];scene.render.filepath=str(out/('fitted-'+view+'.png'));bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'generated/hands/hands-fitted.blend'))
