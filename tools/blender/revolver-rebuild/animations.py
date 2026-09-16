"""Fresh deterministic action direction. All inputs are seconds, authoring meters.
No wall clock, imported action or previous-pose dependency. sample() is the review API.
"""
import math
import bpy
from mathutils import Vector, Quaternion
DURATIONS = dict(Idle=2., Draw=.7, Fire=.32, Reload=3.6, AimIn=.18, AimOut=.18, AimIdle=2., Sprint=.8, Inspect=3.)
CONTACTS = {'Reload': {'release': .10, 'open': .24, 'eject': .34, 'reach': .48, 'insert': .67, 'close': .84, 'return': .96}, 'Fire': {'strike': .05/.32, 'recovery': .8}}
FPS = 60

def smooth(v):
    v = max(0., min(1., v)); return v*v*(3.-2.*v)
def ramp(t,a,b): return smooth((t-a)/(b-a))
def window(t,a,b,c,d): return ramp(t,a,b)*(1-ramp(t,c,d))
def lerp(a,b,t): return Vector(a).lerp(Vector(b),t)

def sample(rig, name, seconds):
    if name not in DURATIONS: raise ValueError(name)
    t=max(0.,min(1.,seconds/DURATIONS[name])); p=rig['parts']; motion=rig['motion']
    for obj, loc, rot, scale in rig['rest']:
        obj.location=loc;obj.rotation_mode='QUATERNION';obj.rotation_quaternion=rot;obj.scale=scale
    arm=rig['hands']['armature']
    for bone in arm.pose.bones: bone.matrix_basis.identity()
    helper=rig.get('pose_helper')
    if helper: helper(rig['hands'], 'grip')
    # Micro motion carries both wrists and all gun contacts together.
    if name in ('Idle','AimIdle'):
        amplitude=.00035 if name=='AimIdle' else .0008
        motion.location.z+=amplitude*math.sin(t*2*math.pi)
        motion.rotation_quaternion=Quaternion((0,1,0),amplitude*1.4*math.sin(t*2*math.pi))
    elif name=='Draw':
        v=1-ramp(t,0,.85);motion.location+=Vector((.09*v,.045*v,-.22*v))
        motion.rotation_quaternion=Quaternion((0,1,0),-.65*v)@Quaternion((1,0,0),-.22*v)
    elif name=='Fire':
        strike=.05/DURATIONS[name]
        recoil=window(t,strike,strike+.09,.30,1)
        motion.location.x+=.012*recoil;motion.rotation_quaternion=Quaternion((0,1,0),.065*recoil)
        p['Hammer'].rotation_quaternion @= Quaternion((0,1,0),.42*window(t,0,.08,.12,strike))
        p['Trigger'].rotation_quaternion @= Quaternion((0,1,0),-.22*window(t,0,.12,.45,.9))
        if rig.get('hand_adapter'):rig['hand_adapter'].fire_contact(rig['hands'],p['Trigger'],window(t,0,.12,.45,.9))
        p['Cylinder'].rotation_quaternion @= Quaternion((0,1,0),math.pi/3*ramp(t,0,strike))
    elif name in ('AimIn','AimOut'):
        # Runtime owns sight alignment; authored settle does not double aim translation.
        settle=math.sin(t*math.pi)*.001
        motion.location.z+=settle
    elif name=='Sprint':
        motion.location+=Vector((.035,.015,-.09));motion.rotation_quaternion=Quaternion((1,0,0),-.12)@Quaternion((0,1,0),-.10)
        motion.location.z+=.004*math.sin(t*2*math.pi)
    elif name=='Inspect':
        w=window(t,.05,.25,.75,.97)
        motion.rotation_quaternion=Quaternion((1,0,0),.7*w)@Quaternion((0,0,1),.25*math.sin(t*2*math.pi)*w)
        motion.location+=Vector((.02*w,-.025*w,.035*w))
    elif name=='Reload':
        present=window(t,0,.18,.86,1)
        motion.location+=Vector((.035*present,.015*present,.025*present))
        motion.rotation_quaternion=Quaternion((1,0,0),-.45*present)@Quaternion((0,1,0),.25*present)
        opening=window(t,.13,.24,.77,.86)
        p['Crane'].rotation_quaternion @= Quaternion((1,0,0),1.32*opening)
        p['Latch'].location.x-=.003*window(t,.08,.13,.24,.3)
        eject=window(t,.30,.34,.37,.41)
        p['Ejector'].location.y-=.027*eject
        if rig.get('hand_adapter'):rig['hand_adapter'].press_latch(rig['hands'],p['Latch'],window(t,.025,.08,.17,.24))
        # Parent-space contact points follow the cylinder, never a fixed world guess.
        bpy.context.view_layer.update()
        cylinder=p['Cylinder']; origin=cylinder.matrix_world.translation
        release=window(t,.025,.10,.94,.985)
        # Hand goes outward before travelling to the open cylinder; return uses same safe corridor.
        support=Vector(rig['contract']['anchors']['SupportContact'])
        target=cylinder.matrix_world @ Vector((0,-.060,0))
        target=motion.matrix_world.inverted()@target
        clearance=support+Vector((.025,-.11,-.025))
        if t<.20: goal=lerp(support,clearance,ramp(t,.025,.12))
        elif t<.40: goal=lerp(clearance,target,ramp(t,.20,.27))
        elif t<.54: goal=lerp(target,clearance+Vector((.08,0,-.12)),ramp(t,.40,.48))
        elif t<.73: goal=lerp(clearance+Vector((.08,0,-.12)),target,ramp(t,.54,.64))
        elif t<.87: goal=lerp(target,clearance,ramp(t,.73,.79))
        else: goal=lerp(clearance,support,ramp(t,.87,.93))
        goal.y-=.012*window(t,.90,.93,.985,1.)
        loader=p['Speedloader']
        loader.scale=(1,1,1) if .55<t<.79 else (.001,)*3
        approach=1-ramp(t,.55,.69);discard=ramp(t,.71,.79)
        loader.location+=Vector((-.08*approach-.08*discard,-.12*approach-.03*discard,-.19*approach-.25*discard))
        bpy.context.view_layer.update()
        move_left=rig.get('move_left')
        if move_left:
            contact=None
            # Thumb pushes the exposed ejector head; then index/middle guide loading
            # at the rear face. Targets stay in the independently articulated part frame.
            if .075<t<.255:
                contact={'digit':'Middle','point':cylinder.matrix_world@Vector((-.0325,0,0)), 'weight':window(t,.075,.13,.20,.255),'gesture':'support'}
            elif .255<t<.43:
                contact={'digit':'Thumb','point':p['Ejector'].matrix_world@Vector((0,.1012,-.0025)), 'weight':window(t,.255,.30,.37,.43)}
            elif .56<t<.76:
                contact={'digit':'Index','point':loader.matrix_world@Vector((.006,0,.010)), 'weight':window(t,.56,.63,.70,.76),'gesture':'loading','pinchDirection':loader.matrix_world.to_3x3()@Vector((-1,0,0))}
            elif .76<t<.92:
                contact={'digit':'Middle','point':cylinder.matrix_world@Vector((-.0325,0,0)), 'weight':window(t,.76,.80,.87,.92),'gesture':'support'}
            move_left(rig['hands'],goal-support,release,contact)
        for i in range(6):
            p['Case'+str(i)].scale=(1,1,1) if t<.35 else (.001,)*3
            fresh=p['Fresh'+str(i)];fresh.scale=(1,1,1) if t>.55 else (.001,)*3
            fresh.location+=Vector((-.08*approach,-.12*approach,-.19*approach))
    bpy.context.view_layer.update()
    return {'clip':name,'seconds':seconds,'fraction':t,'phase':next((k for k,v in reversed(list(CONTACTS.get(name,{}).items())) if t>=v),None)}

def bake(rig):
    targets=[rig['motion'],*[rig['parts'][n] for n in ('Crane','Cylinder','Ejector','Hammer','Trigger','Latch','Speedloader')],*[rig['parts'][prefix+str(i)] for prefix in ('Case','Fresh') for i in range(6)],rig['hands']['armature']]
    targets+=list(rig['hands']['controls'].values())+rig['hands'].get('attachments',[])
    targets=list(dict.fromkeys(targets))
    for obj in targets: obj.animation_data_clear()
    scene=bpy.context.scene;scene.render.fps=FPS
    for name,duration in DURATIONS.items():
        end=round(duration*FPS)
        for frame in range(end+1):
            scene.frame_set(frame);sample(rig,name,frame/FPS)
            arm=rig['hands']['armature']
            evaluated={b.name:b.matrix.copy() for b in arm.pose.bones}
            for bone in arm.pose.bones:
                kwargs={'parent_matrix':evaluated[bone.parent.name],'parent_matrix_local':bone.parent.bone.matrix_local} if bone.parent else {}
                bone.rotation_mode='QUATERNION'
                bone.matrix_basis=bone.bone.convert_local_to_pose(evaluated[bone.name],bone.bone.matrix_local,invert=True,**kwargs)
            for attachment in rig['hands'].get('attachments',[]):
                attachment.matrix_basis=attachment.parent.matrix_world.inverted()@attachment.matrix_world
            for obj in targets:
                for path in ('location','rotation_quaternion','scale'):obj.keyframe_insert(path,frame=frame,group=obj.name)
            for bone in rig['hands']['armature'].pose.bones:
                for path in ('location','rotation_quaternion','scale'):bone.keyframe_insert(path,frame=frame,group=bone.name)
        for obj in targets:
            action=obj.animation_data.action
            if not action:continue
            action.name=name+'__'+obj.name
            # LINEAR interpolation preserves bounded sampled trajectories at subframes.
            curves=list(action.fcurves) if hasattr(action,'fcurves') else [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
            for fc in curves:
                for key in fc.keyframe_points:key.interpolation='LINEAR'
            track=obj.animation_data.nla_tracks.new();track.name=name
            strip=track.strips.new(name,0,action);strip.action_frame_start=0;strip.action_frame_end=end
            strip.extrapolation='NOTHING';obj.animation_data.action=None;track.mute=True
    sample(rig,'Idle',0)
    for obj in targets:
        for track in obj.animation_data.nla_tracks:track.mute=False
    scene.frame_start=0;scene.frame_end=round(max(DURATIONS.values())*FPS)
