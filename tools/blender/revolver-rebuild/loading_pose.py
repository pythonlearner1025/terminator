"""Build a bounded thumb/index/middle pinch from the new hand's evaluated pads.
No scale or bone translation. Optimization only adjusts anatomical flexion and
thumb CMC opposition; resulting pose is cached per assembly, never per frame.
"""
import math,bpy
from mathutils import Vector,Quaternion

def build(result):
    arm=result['armature'];mesh=next(m for m in result['meshes'] if m.name=='HandMeshLeft')
    saved={b.name:b.matrix_basis.copy() for b in arm.pose.bones}
    presets={'Index':(58,82,35),'Middle':(62,85,38),'Ring':(78,90,45),'Little':(85,90,45),'Thumb':(40,45,25)}
    for digit,angles in presets.items():
        for i,a in enumerate(angles,1):arm.pose.bones['Left'+digit+str(i)].rotation_quaternion=Quaternion((1,0,0),-math.radians(a))
    arm.pose.bones['LeftThumb1'].rotation_quaternion=Quaternion((0,0,1),math.radians(58))@arm.pose.bones['LeftThumb1'].rotation_quaternion
    def pads():
        bpy.context.view_layer.update();ev=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();out={}
        for digit in ('Thumb','Index','Middle'):
            ids=result['metadata']['padVertexIndices']['Left'][digit]
            out[digit]=sum((ev.matrix_world@me.vertices[i].co for i in ids),Vector())/len(ids)
        ev.to_mesh_clear();return out
    start=pads();direction=(start['Thumb']-start['Index']).normalized();target=start['Index']+direction*.013
    initial={b.name:b.rotation_quaternion.copy() for b in arm.pose.bones if b.name.startswith('Left')}
    controls=[('LeftThumb1',(0,0,1),65),('LeftThumb1',(1,0,0),45),('LeftThumb2',(1,0,0),40),('LeftThumb3',(1,0,0),30)]
    # Coordinate search bounded around the authored pinch pose. No unconstrained CCD.
    offsets=[0.]*len(controls)
    def apply():
        for name,q in initial.items():arm.pose.bones[name].rotation_quaternion=q
        for (name,axis,_),angle in zip(controls,offsets):arm.pose.bones[name].rotation_quaternion @= Quaternion(axis,math.radians(angle))
    for step in (15,7,3):
        for i,(_,_,limit) in enumerate(controls):
            best=offsets[i];score=(pads()['Thumb']-target).length_squared
            for change in (-step,step):
                candidate=max(-limit,min(limit,best+change));offsets[i]=candidate;apply();error=(pads()['Thumb']-target).length_squared
                if error<score:score=error;best=candidate
            offsets[i]=best;apply()
    end=pads();pose={b.name:b.rotation_quaternion.copy() for b in arm.pose.bones if b.name.startswith('Left') and b.name!='LeftForearm'}
    metrics={'thumbIndexPadDistanceMeters':(end['Thumb']-end['Index']).length,'thumbTargetResidualMeters':(end['Thumb']-target).length,'middleIndexPadDistanceMeters':(end['Middle']-end['Index']).length,'optimization':'bounded thumb CMC/hinge flexion; no scale or translation'}
    for name,matrix in saved.items():arm.pose.bones[name].matrix_basis=matrix
    bpy.context.view_layer.update();return pose,metrics
