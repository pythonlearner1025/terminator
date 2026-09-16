"""Absolute sampled poses. Reload can be evaluated in either direction without events."""
def ease(t):t=max(0,min(1,t));return t*t*(3-2*t)
def ramp(t,a,b):return ease((t-a)/(b-a))
def blendkeys(t,keys):
 for (a,x),(b,y) in zip(keys,keys[1:]):
  if t<=b:
   u=ramp(t,a,b)
   return Vector(x).lerp(Vector(y),u) if isinstance(x,(tuple,list,Vector)) else x+(y-x)*u
 return Vector(keys[-1][1]) if isinstance(keys[-1][1],(tuple,list,Vector)) else keys[-1][1]
def pose(name,loc=(0,0,0),rot=(0,0,0)):
 b=arm.pose.bones[name];basis=b.bone.matrix_local.to_3x3();b.location=basis.inverted()@P(loc);b.rotation_mode='QUATERNION';q=Quaternion()
 for axis,angle in zip([(1,0,0),(0,1,0),(0,0,1)],rot):q=q@Quaternion(basis.inverted()@P(axis),angle)
 b.rotation_quaternion=q;b.scale=(1,1,1)
def world_hand(name,matrix):arm.pose.bones[name].matrix=matrix
rest={b.name:b.bone.matrix_local.copy() for b in arm.pose.bones}
exec(compile((ROOT/'tools/blender/swingout/contact.py').read_text(),'contact.py','exec'))
def delta(name):return arm.pose.bones[name].matrix@rest[name].inverted()
def ccd(side,finger,target,weight=1):
 return constrained_contact(side,finger,target,weight)
clips={'Idle':2.,'Draw':.65,'Fire':.4,'Reload':2.6,'AimIn':.2,'AimOut':.2,'AimIdle':2.,'Sprint':.8,'Inspect':3.2}
arm.animation_data_create()
animated=[b.name for b in arm.pose.bones if b.name not in ['Frame']]
# A constant wrist correction fits the narrower modern grip.
right_shift=(.020,.006,.022);left_shift=(-.014,.002,.014)
# Rest cuff derives from the sleeve ring nearest the hand wrist.
hand_cuffs={}
for side in ['Left','Right']:
 o=next(o for o in hands if o.name.startswith(side));vg=o.vertex_groups[side+'Forearm'].index;wrist=rest['Hand'+side].translation
 points=[v.co for v in o.data.vertices if any(g.group==vg and g.weight>.05 for g in v.groups)]
 hand_cuffs[side]=wrist-(rest[side+'Forearm'].translation-wrist).normalized()*.0105
from mathutils.bvhtree import BVHTree
# Fit grip tips to the static wood surface. The radius keeps the skin outside the wood.
for b in arm.pose.bones:pose(b.name)
bpy.context.view_layer.update();grip_tree=BVHTree.FromObject(weapon,bpy.context.evaluated_depsgraph_get());grip_targets={}
for finger in ['Thumb','Middle','Ring','Little']:
 tip=P({'Thumb':(.014,.033,.021),'Middle':(.013,.015,.034),'Ring':(.013,-.005,.027),'Little':(.009,-.025,.018)}[finger])+P(right_shift);co,normal,_,distance=grip_tree.find_nearest(tip)
 grip_targets[finger]=co+normal*.007
for name,duration in clips.items():
 action=bpy.data.actions.new(name);arm.animation_data.action=action;action.use_fake_user=True
 count=round(duration*120)
 for f in range(0,count+1,1 if name=='Fire' else 4):
  t=f/120;u=t/duration
  for b in arm.pose.bones:pose(b.name)
  pose('HandRight',right_shift);pose('HandLeft',left_shift)
  bpy.context.view_layer.update()
  fit_palm('Right')
  for finger,target in grip_targets.items():ccd('Right',finger,target)
  fit_palm('Left',True)
  for finger,target in {'Index':(-.025,.007,.036),'Middle':(-.027,-.010,.031),'Ring':(-.025,-.026,.022),'Little':(-.021,-.042,.011),'Thumb':(.020,.029,.028)}.items():ccd('Left',finger,P(target))
  # Reload props stay outside the frustum, at full size. No scale/visibility keys.
  pose('Loader',(.06,-.5,-.22))
  for i in range(6):pose(f'Fresh{i}',(.06,-.5,-.22))
  if name in ['Idle','AimIdle']:
   amp=.001 if name=='AimIdle' else .0018;pose('Body',(0,amp*sin(u*2*pi),0),(0,.003*sin(u*2*pi),.003*sin(u*2*pi)))
  elif name=='Draw':
   v=1-ramp(t,0,.51);settle=sin(max(0,t-.42)*20)*.008*(1-u)
   pose('Body',(.025*v,-.25*v,-.13*v),(.7*v+settle,-.15*v,-.25*v))
  elif name=='Fire':
   # Double-action take-up and one chamber index precede the hammer strike.
   cock=ramp(t,0,.035)*(1-ramp(t,.035,.05));kick=blendkeys(t,[(0,0),(.05,0),(.0667,1),(.095,.8),(.23,-.065),(.4,0)])
   pose('Hammer',rot=(-.62*cock,0,0));pose('Cylinder',rot=(0,0,-pi/3*ramp(t,0,.035)))
   pose('Trigger',rot=(.27*ramp(t,0,.04)*(1-ramp(t,.11,.25)),0,0))
   pose('Body',(0,.014*kick,-.036*kick),(-.26*kick,.013*kick,.025*kick))
   # No independent support-hand travel during the impulse.
   pose('RightIndex1',rot=(.07*ramp(t,0,.04)*(1-ramp(t,.11,.25)),0,0))
   pose('Bullet5',(0,0,.18*ramp(t,.05,.059)))
   arm.pose.bones['Bullet5'].scale=(1-ramp(t,.058,.06),)*3
  elif name=='Reload':
   swing=ramp(t,.38,.68)*(1-ramp(t,2.16,2.38));angle=-1.48*swing
   body_rot=blendkeys(t,[(0,(0,0,0)),(.38,(-.35,.20,-.15)),(.72,(-.78,.20,-.15)),(1.03,(-.78,.20,-.15)),(1.26,(.28,.92,-.34)),(2.12,(.28,.92,-.34)),(2.38,(.12,.30,-.10)),(2.6,(0,0,0))])
   body_loc=blendkeys(t,[(0,(0,0,0)),(.38,(.015,-.025,-.01)),(.72,(.025,-.012,-.045)),(1.03,(.025,-.012,-.045)),(1.26,(.035,.015,-.025)),(2.12,(.035,.015,-.025)),(2.38,(.012,-.015,-.01)),(2.6,(0,0,0))])
   pose('Body',body_loc,body_rot);pose('Crane',rot=(0,0,angle))
   latch=.003*ramp(t,.24,.33)*(1-ramp(t,.52,.65));pose('Latch',(0,0,latch))
   eject=.042*ramp(t,.80,.90)*(1-ramp(t,.99,1.11));pose('Ejector',(0,0,-eject))
   bpy.context.view_layer.update();body=delta('Body');crane=delta('Crane');cylinder=delta('Cylinder')
   # The left hand meets the closed cylinder before opening starts.
   contact=Matrix.Translation(P((-.006,.072,.103)))@rest['HandLeft']
   ready=body@Matrix.Translation(P(left_shift))@rest['HandLeft'];hold=crane@contact
   hand=ready.lerp(hold,ramp(t,.05,.32)*(1-ramp(t,2.23,2.49)))
   # During ejection the hand cups the open cylinder. Its thumb reaches the rod pad.
   eject_hand=crane@Matrix.Translation(P((-.012,.072,.169-eject)))@rest['HandLeft']
   hand=hand.lerp(eject_hand,ramp(t,.59,.76)*(1-ramp(t,1.02,1.14)))
   # A fresh loader comes from below, aligns at the rear, then leaves by the same free space.
   approach=blendkeys(t,[(0,(.06,-.50,-.22)),(1.05,(.06,-.50,-.22)),(1.39,(0,0,-.105)),(1.62,(0,0,-.036)),(1.82,(0,0,0)),(1.96,(0,0,-.02)),(2.12,(.12,-.24,-.1)),(2.6,(.12,-.50,-.22))])
   loader_matrix=cylinder@Matrix.Translation(P(approach))@rest['Loader'];arm.pose.bones['Loader'].matrix=loader_matrix
   loader_hand=loader_matrix@rest['Loader'].inverted()@Matrix.Translation(P((.006,.075,.068)))@rest['HandLeft']
   hand=hand.lerp(loader_hand,ramp(t,1.04,1.17)*(1-ramp(t,1.98,2.13)))
   world_hand('HandLeft',hand);bpy.context.view_layer.update();fit_palm('Left',True)
   thumb=ramp(t,.055,.18)*(1-ramp(t,.43,.57))
   ccd('Right','Thumb',body@P((.0195,.063,.057+latch)),thumb)
   cup_hold=ramp(t,.05,.32)*(1-ramp(t,1.02,1.14))+ramp(t,2.10,2.14)*(1-ramp(t,2.34,2.49))
   for finger,point in [('Index',(-.029,CY+.010,CZ+.012)),('Middle',(-.035,CY-.004,CZ+.003)),('Ring',(-.031,CY-.019,CZ-.008)),('Little',(-.017,CY-.032,CZ-.016))]:
    ccd('Left',finger,crane@P(point),min(1,cup_hold))
   pose('LoaderButton',(0,0,.003*ramp(t,1.78,1.82)*(1-ramp(t,1.88,1.96))))
   load_hold=ramp(t,1.17,1.34)*(1-ramp(t,1.98,2.12))
   for finger,offset in [('Index',(-.017,.016,-.026)),('Middle',(-.019,0,-.026)),('Ring',(-.017,-.017,-.029)),('Little',(-.013,-.032,-.029)),('Thumb',(.009,.010,-.039+.003*ramp(t,1.78,1.82)))]:
    ccd('Left',finger,loader_matrix@rest['Loader'].inverted()@P((offset[0],CY+offset[1],REAR+offset[2])),load_hold)
   ccd('Right','Thumb',body@P((.022,.026,.025)),ramp(t,1.06,1.23)*(1-ramp(t,2.06,2.20)))
   ccd('Left','Thumb',crane@P((0,CY,.2235-eject)),ramp(t,.61,.79)*(1-ramp(t,.98,1.13)))
   # Spent shells follow the extractor until release, then follow baked ballistic arcs.
   for i in range(6):
    if t<=.94:pose(f'Case{i}',(0,0,-eject))
    else:
     release=.94;age=t-release;a=i*2.399;speed=.40+.055*i
     # Repeat the exact release pose algebra; the shell path is independent of sample history.
     rel_rot=blendkeys(release,[(0,(0,0,0)),(.38,(-.35,.20,-.15)),(.72,(-.78,.20,-.15)),(1.03,(-.78,.20,-.15)),(1.26,(.28,.92,-.34)),(2.12,(.28,.92,-.34)),(2.38,(.12,.30,-.10)),(2.6,(0,0,0))])
     # Arm-space ballistic path. It does not inherit the gun's later rotation.
     rel_loc=blendkeys(release,[(0,(0,0,0)),(.38,(.015,-.025,-.01)),(.72,(.025,-.012,-.045)),(1.03,(.025,-.012,-.045)),(1.26,(.035,.015,-.025)),(2.12,(.035,.015,-.025)),(2.38,(.012,-.015,-.01)),(2.6,(0,0,0))])
     q=Quaternion()
     for axis,ang in zip([(1,0,0),(0,1,0),(0,0,1)],rel_rot):q=q@Quaternion(P(axis),ang)
     pivot=P((0,.043,.148));initial=Matrix.Translation(P(rel_loc))@q.to_matrix().to_4x4()@Matrix.Translation(pivot)@Quaternion(P((0,0,1)),-1.48).to_matrix().to_4x4()@Matrix.Translation(-pivot)@Matrix.Translation(P((0,0,-.042)))@rest[f'Case{i}']
     velocity=q@P((.1*sin(a),.02*cos(a),-speed))+P((.65,0,-.10))
     mat=initial.copy();mat.translation+=velocity*age+P((0,-4.905*age*age,0))
     spin=Quaternion(Vector((.7,.3,.4)).normalized(),age*(7+i));loc=mat.translation.copy();mat=spin.to_matrix().to_4x4()@mat;mat.translation=loc
     arm.pose.bones[f'Case{i}'].matrix=mat
    fresh=approach if t<=1.82 else (0,0,0)
    pose(f'Fresh{i}',fresh)
    # Initial bullets have left. Move behind the same empty cases, never expose a live tip.
    pose(f'Bullet{i}',(0,0,-.017))
    arm.pose.bones[f'Bullet{i}'].scale=(.001,)*3
  elif name in ['AimIn','AimOut']:
   v=1-ease(u) if name=='AimIn' else ease(u);pose('Body',(0,-.002*sin(pi*u),0),(.018*v,0,.01*v))
  elif name=='Sprint':pose('Body',(0,-.055+.006*sin(2*pi*u),-.01*(1-cos(2*pi*u))),(.20+.025*sin(2*pi*u),.18+.012*sin(2*pi*u),.32+.035*cos(2*pi*u)))
  elif name=='Inspect':
   loc=blendkeys(t,[(0,(0,0,0)),(.7,(.030,.025,-.06)),(1.35,(.045,.03,-.07)),(2.2,(.015,.025,-.08)),(3.2,(0,0,0))])
   rot=blendkeys(t,[(0,(0,0,0)),(.7,(-.1,-.78,.40)),(1.35,(-.12,-.88,.50)),(2.2,(.12,.65,-.28)),(3.2,(0,0,0))]);pose('Body',loc,rot)
  bpy.context.view_layer.update()
  ccd('Right','Index',delta('Body')@P((-.019,.043,.095) if name=='Reload' else (-.003,.027,.095)),1)
  # Fit each sleeve between a fixed screen-space elbow and the animated cuff.
  view_rotation=Quaternion(P((0,1,0)),pi+arm['viewModel']['hipRotation'][1])
  for side in ['Left','Right']:
   b=arm.pose.bones[side+'Forearm'];r=rest[b.name];h=arm.pose.bones['Hand'+side]
   target=view_rotation.inverted()@(P((.25,-.48,-.13) if side=='Right' else (-.25,-.48,-.13))-P(arm['viewModel']['hip']))
   cuff=(h.matrix@rest[h.name].inverted())@hand_cuffs[side]
   axis=hand_cuffs[side]-r.translation;dest=cuff-target;direction=axis.normalized();ratio=dest.length/axis.length
   stretch=Matrix.Identity(3)
   for row in range(3):
    for col in range(3):stretch[row][col]+=(ratio-1)*direction[row]*direction[col]
   mat=(axis.rotation_difference(dest).to_matrix()@stretch@r.to_3x3()).to_4x4();mat.translation=target;b.matrix=mat
  bpy.context.view_layer.update()
  for bn in animated:
   b=arm.pose.bones[bn]
   for prop in ['location','rotation_quaternion','scale']:b.keyframe_insert(data_path=prop,frame=f+1,group=bn)
 arm.animation_data.action=None;track=arm.animation_data.nla_tracks.new();track.name=name;strip=track.strips.new(name,1,action);strip.action_frame_start=1;strip.action_frame_end=count+1;track.mute=True
