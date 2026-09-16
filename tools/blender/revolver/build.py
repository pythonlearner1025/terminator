"""Original 1858 presentation asset. Run only with Blender -b -P.
All dimensions below use game coordinates: X right, Y up, Z barrel forward.
The exporter converts Blender's Z-up authoring basis to glTF Y-up.
"""
import bpy, bmesh, math, json, os, sys
from pathlib import Path
from mathutils import Vector, Quaternion, Matrix
from math import sin, cos, pi
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'assets/models/weapons/pistol'; OUT.mkdir(parents=True,exist_ok=True)
EVID=Path(os.environ.get('REVOLVER_EVIDENCE',str(ROOT/'.kite3d/revolver-rounds'))); EVID.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for d in list(bpy.data.materials): bpy.data.materials.remove(d)
scene=bpy.context.scene; scene.unit_settings.system='METRIC'; scene.render.fps=30
scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=12; scene.cycles.seed=1858; scene.cycles.use_animated_seed=False
scene.render.threads_mode='FIXED'; scene.render.threads=6
scene.world.color=(.19,.19,.19)
def P(v): return Vector((v[0],-v[2],v[1]))
def active(o):
 bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
materials={}; material_sources={}
def material(name,color,rough,metal,scale):
 m=bpy.data.materials.new(name); m.use_nodes=True; n=m.node_tree.nodes; l=m.node_tree.links
 bs=n.get('Principled BSDF'); bs.inputs['Metallic'].default_value=metal
 tex=n.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=scale; tex.inputs['Detail'].default_value=3
 coord=n.new('ShaderNodeTexCoord'); mapping=n.new('ShaderNodeVectorMath'); mapping.operation='MULTIPLY'
 mapping.inputs[1].default_value=(85,55,1) if name=='Walnut' else (2,14,2) if name=='Blued steel' else (1,1,1)
 l.new(coord.outputs['Generated'],mapping.inputs[0]); l.new(mapping.outputs[0],tex.inputs['Vector'])
 ramp=n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position=.18; ramp.color_ramp.elements[1].position=.84
 for e,f in zip(ramp.color_ramp.elements,[.45,1.45]): e.color=(*[min(.95,c*f) for c in color],1)
 l.new(tex.outputs['Fac'],ramp.inputs[0]); l.new(ramp.outputs[0],bs.inputs['Base Color'])
 mul=n.new('ShaderNodeMath'); mul.operation='MULTIPLY_ADD'; mul.inputs[1].default_value=.18; mul.inputs[2].default_value=rough-.08
 l.new(tex.outputs['Fac'],mul.inputs[0]); l.new(mul.outputs[0],bs.inputs['Roughness'])
 bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.14; bump.inputs['Distance'].default_value=.00012
 if name in ['Olive glove','Sleeve cloth']:
  wave=n.new('ShaderNodeTexWave'); wave.wave_type='BANDS'; wave.bands_direction='X'; wave.inputs['Scale'].default_value=180
  l.new(coord.outputs['Generated'],wave.inputs['Vector']); l.new(wave.outputs['Color'],bump.inputs['Height'])
 else: l.new(tex.outputs['Fac'],bump.inputs['Height'])
 l.new(bump.outputs['Normal'],bs.inputs['Normal'])
 base=ramp.outputs[0]
 if metal==1:
  geo=n.new('ShaderNodeNewGeometry');bevel=n.new('ShaderNodeBevel');bevel.inputs['Radius'].default_value=.0005;bevel.samples=4
  dot=n.new('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT';l.new(geo.outputs['Normal'],dot.inputs[0]);l.new(bevel.outputs['Normal'],dot.inputs[1])
  inv=n.new('ShaderNodeMath');inv.operation='SUBTRACT';inv.inputs[0].default_value=1;l.new(dot.outputs['Value'],inv.inputs[1])
  amount=n.new('ShaderNodeMath');amount.operation='MULTIPLY';amount.inputs[1].default_value=35;amount.use_clamp=True;l.new(inv.outputs[0],amount.inputs[0])
  mix=n.new('ShaderNodeMixRGB');mix.inputs[2].default_value=(.38,.28,.12,1) if name=='Aged brass' else (.20,.21,.24,1)
  l.new(amount.outputs[0],mix.inputs[0]);l.new(base,mix.inputs[1]);l.new(mix.outputs[0],bs.inputs['Base Color']);base=mix.outputs[0]
 if name=='Walnut':
  grain=n.new('ShaderNodeTexWave');grain.wave_type='BANDS';grain.bands_direction='Y';grain.inputs['Scale'].default_value=55;grain.inputs['Distortion'].default_value=1.3;grain.inputs['Detail Scale'].default_value=.7
  grainmap=n.new('ShaderNodeVectorMath');grainmap.operation='MULTIPLY';grainmap.inputs[1].default_value=(1,12,1.5);l.new(coord.outputs['Object'],grainmap.inputs[0]);l.new(grainmap.outputs[0],grain.inputs['Vector']);grain.inputs['Scale'].default_value=210;grain.inputs['Distortion'].default_value=3
  gr=n.new('ShaderNodeValToRGB');gr.color_ramp.elements[0].position=.25;gr.color_ramp.elements[0].color=(.001,.0002,.00005,1);gr.color_ramp.elements[1].position=.8;gr.color_ramp.elements[1].color=(.07,.017,.0045,1)
  l.new(grain.outputs['Fac'],gr.inputs[0]);l.new(gr.outputs[0],bs.inputs['Base Color']);base=gr.outputs[0]
  l.new(grain.outputs['Fac'],bump.inputs['Height']);bump.inputs['Distance'].default_value=.00022
 if name in ['Olive glove','Sleeve cloth']:
  bs.inputs['Specular IOR Level'].default_value=.15
  coarse=n.new('ShaderNodeTexNoise');coarse.inputs['Scale'].default_value=10;coarse.inputs['Detail'].default_value=5;l.new(coord.outputs['Generated'],coarse.inputs['Vector'])
  cr=n.new('ShaderNodeValToRGB');cr.color_ramp.elements[0].position=.35;cr.color_ramp.elements[0].color=(.001,.0008,.0006,1);cr.color_ramp.elements[1].position=.66;cr.color_ramp.elements[1].color=(.015,.012,.010,1)
  l.new(coarse.outputs['Fac'],cr.inputs[0]);l.new(cr.outputs[0],bs.inputs['Base Color']);base=cr.outputs[0]
  l.new(coarse.outputs['Fac'],bump.inputs['Height']);bump.inputs['Distance'].default_value=.0007;bump.inputs['Strength'].default_value=.4
 materials[name]=m; material_sources[name]=(base,mul.outputs[0],metal)
 return m
steel=material('Blued steel',(.046,.042,.045),.24,1,110)
edge=material('Polished edge',(.24,.28,.32),.26,1,90)
brass=material('Aged brass',(.65,.45,.18),.16,1,160)
wood=material('Walnut',(.047,.010,.003),.34,0,15)
glove=material('Olive glove',(.008,.006,.005),.74,0,95)
skin=material('Skin',(.36,.21,.14),.54,0,120)
cloth=material('Sleeve cloth',(.005,.004,.003),.82,0,95)
pad=material('Glove seams',(.022,.017,.013),.65,0,95)
dark=material('Bore interior',(.005,.007,.011),.66,.6,40)
parts={}; bones={}
def bone(name,head=(0,0,0),parent='Body'):
 bones[name]=(head,parent); return name
bone('Body',parent=None)
for n,p in [('Frame',(0,.055,.029)),('OctagonalBarrel',(0,.108,.134)),('Grip',(0,0,0)),('TriggerGuard',(0,.027,.042)),('Hammer',(0,.092,.018)),('Cylinder',(0,.094,.085)),('LoadingLever',(0,.063,.13)),('Trigger',(0,.045,.042)),('Sights',(0,0,0)),('Pump',(0,0,0)),('Ejection',(0,.094,.058)),('SpeedLoader',(0,.094,.01)),('SpentRounds',(0,.094,.085))]: bone(n,p)
bone('SightFront',(0,.133,.322),'OctagonalBarrel'); bone('SightRear',(0,.128,.029),'Frame')
bone('HammerContact',(0,.134,-.011),'Hammer')
def finish(o,name,mat,part,bevel=.0007):
 o.name=name; active(o); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 if bevel:
  mod=o.modifiers.new('Soft machined edges','BEVEL'); mod.width=bevel; mod.segments=3 if mat==wood else 1
  bpy.ops.object.modifier_apply(modifier=mod.name)
 o.data.materials.clear(); o.data.materials.append(mat)
 vg=o.vertex_groups.new(name=part); vg.add(list(range(len(o.data.vertices))),1,'REPLACE')
 parts.setdefault(part,[]).append(o)
 return o

def box(name,center,size,mat,part,bevel=.0007):
 bpy.ops.mesh.primitive_cube_add(size=1,location=P(center)); o=bpy.context.object
 o.dimensions=(size[0],size[2],size[1]); return finish(o,name,mat,part,bevel)
def cylinder(name,center,radius,length,mat,part,axis=(0,0,1),n=24,bevel=.0005):
 bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=radius,depth=length,location=P(center)); o=bpy.context.object
 o.rotation_mode='QUATERNION'; o.rotation_quaternion=Vector((0,0,1)).rotation_difference(P(axis).normalized())
 return finish(o,name,mat,part,bevel)
def mesh(name,vertices,faces,mat,part,bevel=.0005):
 d=bpy.data.meshes.new(name); d.from_pydata([P(v) for v in vertices],[],faces); d.update()
 o=bpy.data.objects.new(name,d); scene.collection.objects.link(o); return finish(o,name,mat,part,bevel)
def profile(name,zy,width,mat,part,x=0,bevel=.001):
 vs=[(x+s*width/2,y,z) for s in [-1,1] for z,y in zy]; N=len(zy)
 fs=[tuple(range(N-1,-1,-1)),tuple(range(N,2*N))]+[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)]
 return mesh(name,vs,fs,mat,part,bevel)
def tube(name,center,rout,rin,length,mat,part,n=32,bevel=.00035):
 x,y,z=center; vs=[]
 for r,zz in [(rout,z-length/2),(rout,z+length/2),(rin,z-length/2),(rin,z+length/2)]:
  vs += [(x+r*sin(i*2*pi/n+pi/n),y+r*cos(i*2*pi/n+pi/n),zz) for i in range(n)]
 fs=[]
 for i in range(n):
  j=(i+1)%n; fs += [(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),(i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)]
 return mesh(name,vs,fs,mat,part,bevel)
def path_tube(name,points,radii,mat,part,n=8):
 vs=[]; fs=[]
 for i,pt in enumerate(points):
  t=Vector(points[min(len(points)-1,i+1)])-Vector(points[max(0,i-1)])
  q=Vector((0,1,0)).rotation_difference(t.normalized()); r=radii[i] if isinstance(radii,list) else radii
  for j in range(n): vs.append(Vector(pt)+q@Vector((cos(j*2*pi/n)*r,0,sin(j*2*pi/n)*r)))
 for i in range(len(points)-1):
  for j in range(n): a=i*n+j; b=i*n+(j+1)%n; fs.append((a,b,b+n,a+n))
 fs += [tuple(range(n-1,-1,-1)),tuple((len(points)-1)*n+j for j in range(n))]
 o=mesh(name,vs,fs,mat,part,0)
 for f in o.data.polygons: f.use_smooth=True
 return o
exec(compile((ROOT/'tools/blender/revolver/model.py').read_text(), 'model.py', 'exec'))
exec(compile((ROOT/'tools/blender/revolver/hands.py').read_text(), 'hands.py', 'exec'))
# Create the single armature. Common bone axes simplify deterministic animation.
armdata=bpy.data.armatures.new('Revolver and both arms'); arm=bpy.data.objects.new('RevolverRig',armdata); scene.collection.objects.link(arm)
active(arm); bpy.ops.object.mode_set(mode='EDIT')
for name,(head,parent) in bones.items():
 b=armdata.edit_bones.new(name); b.head=P(head); b.tail=P(Vector(head)+Vector((0,.02,0)))
 if name in ['RightForearm','LeftForearm']:b.tail=hand_cuffs[name.removesuffix('Forearm')]
 if parent: b.parent=armdata.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
arm['weaponAsset']='pistol'; arm['gltfUUID']='weapon-pistol-root'
arm['viewModel']={'id':'pistol','embeddedHands':True,'forwardAxis':'+Z','hip':[.109,-.118,-.500],'hipRotation':[0,-.02,0],'fov':32,'sight':{'height':.092,'distance':.33,'front':.308,'rear':.063},'grip':{'position':[0,0,0],'radius':[.019,.046,.027]},'support':{'position':[0,-.052,0],'radius':[.025,.011,.026]}}
for name in bones: armdata.bones[name]['gltfUUID']='weapon-pistol-'+name
# Merge by mechanism and hand. Preserve all vertex groups for independently bending fingers.
meshes=[]
for key in ['Frame','OctagonalBarrel','Grip','TriggerGuard','Hammer','Cylinder','LoadingLever','Trigger','SightFront','SightRear','SpeedLoader','SpentRounds','Right','Left']:
 obs=[o for k,ls in parts.items() for o in ls if (k.startswith(key) if key in ['Right','Left'] else k==key)]
 if not obs: continue
 active(obs[0])
 for o in obs:o.select_set(True)
 bpy.ops.object.join(); o=bpy.context.object
 o.name=key+'_Hand_and_Sleeve' if key in ['Right','Left'] else key+'_Surface'
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 target={'Cylinder':3000,'Frame':2500,'SpeedLoader':1400,'Grip':1400}.get(key)
 if target:
  tri=o.modifiers.new('Stable triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
  count=len(o.data.polygons)
  if count>target:
   dec=o.modifiers.new('Joined mesh budget','DECIMATE');dec.ratio=target/count;bpy.ops.object.modifier_apply(modifier=dec.name)
 meshes.append(o)
# Reuse the authored atlas layout. Blender's packer showed subpixel run-to-run drift.
# A topology hash rejects stale layouts instead of silently assigning wrong seams.
import hashlib
layout_path=ROOT/'tools/blender/revolver/uv-layout.json'
layouts=json.loads(layout_path.read_text())['objects']
write_layout=os.environ.get('REVOLVER_WRITE_UV')=='1'
if write_layout:
 groups=[([o for o in meshes if 'Hand_and_Sleeve' not in o.name],(0,0,.70,1)),([o for o in meshes if o.name.startswith('Left_')],(.71,0,.29,.49)),([o for o in meshes if o.name.startswith('Right_')],(.71,.51,.29,.49))]
 for objects,(ux,uy,uw,uh) in groups:
  active(objects[0])
  for o in objects:o.select_set(True)
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
  bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.004,area_weight=.3)
  bpy.ops.object.mode_set(mode='OBJECT')
  for o in objects:
   for loop in o.data.uv_layers.active.data:loop.uv=(ux+loop.uv.x*uw,uy+loop.uv.y*uh)
for o in meshes:
 geometry={'vertices':[[round(float(x),9) for x in v.co] for v in o.data.vertices],'faces':[list(p.vertices) for p in o.data.polygons]}
 digest=hashlib.sha256(json.dumps(geometry,separators=(',',':')).encode()).hexdigest()
 if write_layout:layouts[o.name]={'topologySha256':digest,'uv':[[float(v)for v in d.uv]for d in o.data.uv_layers.active.data]}
 layout=layouts[o.name]
 if digest!=layout['topologySha256']:raise RuntimeError('Authored UV layout is stale: '+o.name)
 uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
 if len(uv.data)!=len(layout['uv']):raise RuntimeError('UV loop count changed: '+o.name)
 for loop,coords in zip(uv.data,layout['uv']):loop.uv=coords
if write_layout:layout_path.write_text(json.dumps({'objects':layouts},separators=(',',':'))+'\n')
# CPU baking avoids observed one-byte Metal bake drift. Rendering stays headless.
scene.cycles.device='CPU'
scene.render.bake.margin=8; scene.render.bake.use_clear=True
images={}
for kind in ['albedo','normal','orm']:
 image=bpy.data.images.new('pistol-'+kind,width=2048,height=2048,alpha=False)
 image.colorspace_settings.name='sRGB' if kind=='albedo' else 'Non-Color'; images[kind]=image
 for name,m in materials.items():
  n=m.node_tree.nodes; l=m.node_tree.links; bs=n.get('Principled BSDF'); out=n.get('Material Output')
  tex=n.new('ShaderNodeTexImage'); tex.image=image; n.active=tex
  if kind=='albedo':
   emission=n.new('ShaderNodeEmission'); l.new(material_sources[name][0],emission.inputs[0]); l.new(emission.outputs[0],out.inputs['Surface'])
  elif kind=='orm':
   comb=n.new('ShaderNodeCombineColor'); comb.mode='RGB'; ao=n.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value=.03
   l.new(ao.outputs['AO'],comb.inputs[0]); l.new(material_sources[name][1],comb.inputs[1]); comb.inputs[2].default_value=material_sources[name][2]
   emission=n.new('ShaderNodeEmission'); l.new(comb.outputs[0],emission.inputs[0]); l.new(emission.outputs[0],out.inputs['Surface'])
  else: l.new(bs.outputs[0],out.inputs['Surface'])
 active(meshes[0])
 for o in meshes:o.select_set(True)
 print('BAKING',kind,flush=True)
 if kind=='albedo': bpy.ops.object.bake(type='EMIT')
 elif kind=='normal': bpy.ops.object.bake(type='NORMAL')
 else: bpy.ops.object.bake(type='EMIT')
 image.filepath_raw=str(OUT/('pistol-'+kind+'.png')); image.file_format='PNG'; image.save()
# One export material for the three atlases. glTF uses G roughness and B metallic.
m=bpy.data.materials.new('1858 blued steel case colors walnut skin cloth'); m.use_nodes=True; n=m.node_tree.nodes; l=m.node_tree.links; bs=n.get('Principled BSDF');bs.inputs['Specular IOR Level'].default_value=.25
for kind,img in images.items():
 t=n.new('ShaderNodeTexImage'); t.image=img
 if kind=='albedo':l.new(t.outputs['Color'],bs.inputs['Base Color'])
 elif kind=='normal':
  normal=n.new('ShaderNodeNormalMap'); l.new(t.outputs['Color'],normal.inputs['Color']); l.new(normal.outputs[0],bs.inputs['Normal'])
 else:
  sep=n.new('ShaderNodeSeparateColor'); l.new(t.outputs[0],sep.inputs[0]); l.new(sep.outputs[1],bs.inputs['Roughness']); l.new(sep.outputs[2],bs.inputs['Metallic'])
  group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree'); group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
  gn=n.new('ShaderNodeGroup'); gn.node_tree=group; l.new(sep.outputs[0],gn.inputs['Occlusion'])
for o in meshes:
 o.data.materials.clear(); o.data.materials.append(m)
 for p in o.data.polygons:p.material_index=0
 mod=o.modifiers.new('One package armature','ARMATURE'); mod.object=arm; o.parent=arm
# Muzzle is parented directly to the barrel bone, with identity +Z game forward.
muzzle=bpy.data.objects.new('Muzzle',None); scene.collection.objects.link(muzzle); muzzle.parent=arm; muzzle.parent_type='BONE'; muzzle.parent_bone='OctagonalBarrel'
bpy.context.view_layer.update(); muzzle.matrix_world.translation=P((0,.078,.320)); muzzle.matrix_world=__import__('mathutils').Matrix.Translation(P((0,.078,.320))) @ __import__('mathutils').Euler((pi/2,0,0)).to_matrix().to_4x4()
muzzle['gltfUUID']='weapon-pistol-Muzzle'
# Pose translations and rotations use game coordinates relative to the rest pose.
def pose(name,loc=(0,0,0),rot=(0,0,0),scale=1):
 b=arm.pose.bones[name]; basis=b.bone.matrix_local.to_3x3(); b.location=basis.inverted()@P(loc)
 b.rotation_mode='QUATERNION'; q=Quaternion()
 for ax,angle in zip([(1,0,0),(0,1,0),(0,0,1)],rot): q=q@Quaternion(basis.inverted()@P(ax),angle)
 b.rotation_quaternion=q; b.scale=(scale,)*3

def pulse(t,a,b):return sin(max(0,min(1,(t-a)/(b-a)))*pi)
def smooth(t):t=max(0,min(1,t)); return t*t*(3-2*t)
clips={'Idle':2.,'Draw':.6,'Fire':.4,'Reload':2.6,'AimIn':.2,'AimOut':.2,'AimIdle':2.,'Sprint':.8,'Inspect':3.}
animated=['Body','LeftForearm','RightForearm','Hammer','Cylinder','LoadingLever','Trigger','HandLeft','HandRight','SpeedLoader','SpentRounds','RightThumb1','RightThumb2','RightThumb3','RightIndex1','RightIndex2']+[f'Left{finger}{j}' for finger in ['Index','Middle','Ring','Little','Thumb'] for j in [1,2,3]]
arm.animation_data_create()
for name,duration in clips.items():
 action=bpy.data.actions.new(name); arm.animation_data.action=action; action.use_fake_user=True
 count=round(duration*30)
 for f in range(count+1):
  t=f/30; u=t/duration
  for bn in animated:pose(bn)
  pose('Hammer',rot=(-.55,0,0))
  pose('SpeedLoader',scale=.00001); pose('SpentRounds',scale=.00001)
  if name in ['Idle','AimIdle']:
   pose('Body',(0,sin(u*2*pi)*(.001 if name=='AimIdle' else .002),0),(0,0,sin(u*2*pi)*.004))
  elif name=='Draw':pose('Body',(0,-.23*(1-smooth(u)), -.10*(1-smooth(u))),(.7*(1-smooth(u)),0,-.3*(1-smooth(u))))
  elif name=='Fire':
   kick=pulse(t,0,.17)*math.exp(-t*4)
   pose('Body',(0,.017*kick,-.045*kick),(-.42*kick,0,.015*kick))
   pose('HandLeft',(.025*pulse(t,.04,.34),.005*pulse(t,.04,.34),-.03*pulse(t,.04,.34)),(0,.15*pulse(t,.04,.34),-.10*pulse(t,.04,.34)))
   pose('Hammer',rot=(-.55*(1-smooth(t/.034))-.55*smooth((t-.12)/.18),0,0)); pose('Cylinder',rot=(0,0,pi/3*smooth(t/.26)))
   pose('Trigger',rot=(.28*pulse(t,0,.16),0,0))
   cock=pulse(t,.07,.33)
   pose('HandRight',(0,.019*cock,.022*cock))
   # Solve the three thumb joints toward the moving hammer spur during recocking.
   bpy.context.view_layer.update()
   tip=arm.pose.bones['RightThumbTip'].head.copy()
   target=tip.lerp(arm.pose.bones['HammerContact'].head, smooth(cock*1.6))
   for iteration in range(12):
    for joint in ['RightThumb3','RightThumb2','RightThumb1']:
     b=arm.pose.bones[joint];h=b.head.copy();v=arm.pose.bones['RightThumbTip'].head-h;w=target-h
     if v.length>.000001 and w.length>.000001:
      q=v.normalized().rotation_difference(w.normalized())
      b.matrix=Matrix.Translation(h)@q.to_matrix().to_4x4()@Matrix.Translation(-h)@b.matrix
      bpy.context.view_layer.update()
   pose('RightIndex1',rot=(.20*pulse(t,0,.2),0,-.12*pulse(t,0,.2)))
  elif name=='Reload':
   tilt=smooth(t/.38)*(1-smooth((t-2.23)/.37)); swing=smooth((t-.2)/.38)*(1-smooth((t-1.94)/.36))
   present=pulse(t,.55,1.95)
   pose('Body',(.210*present,.075*tilt,.045*present),((-1.35+1.90*present)*tilt,.12*tilt-1.5*present,.20*tilt-.70*present))
   pose('Cylinder',(.073*swing,-.012*swing,0),(0,.28*swing,.32*swing))
   pose('LoadingLever',rot=(.91*swing,0,0)); pose('Hammer',rot=(-.30*swing,0,0))
   reach=pulse(t,.10,2.48); insert=smooth((t-1.0)/.50); withdraw=smooth((t-1.64)/.40)
   pose('HandLeft',(.06*reach,.115*reach, -.038*reach),(0,.28*reach,-.35*reach))
   for finger in ['Index','Middle','Ring','Little','Thumb']:
    for j in [1,2,3]:pose('Left'+finger+str(j),rot=(.28*pulse(t,.45,1.85)*(1 if finger=='Thumb' else -1),0,0))
   if .62<=t<=.98:pose('SpentRounds',(.073,-.012-(t-.62)*.6,-(t-.62)*.28),(0,.28,.32))
   if .95<=t<=1.98:pose('SpeedLoader',(.073,-.012,.052*insert-.12*withdraw),(0,.28,.32),scale=1)
   # Solve the support palm to the loader after all mechanism transforms.
   hold=smooth((t-.55)/.35)*(1-smooth((t-1.95)/.35))
   bpy.context.view_layer.update()
   delta=arm.pose.bones['SpeedLoader'].head-arm.pose.bones['LeftIndexTip'].head
   hand=arm.pose.bones['HandLeft'];mat=hand.matrix.copy();mat.translation+=delta*hold;hand.matrix=mat
   bpy.context.view_layer.update()
  elif name in ['AimIn','AimOut']:
   v=(1-smooth(u)) if name=='AimIn' else smooth(u)
   pose('Body',rot=(.028*v,0,.014*v))
  elif name=='Sprint':pose('Body',(0,sin(u*2*pi)*.008,0),(.06*sin(u*2*pi),.03*sin(u*2*pi),.025*cos(u*2*pi)))
  elif name=='Inspect':
   v=sin(u*pi)**2; pose('Body',(-.025*v,.04*v,-.07*v),(-.25*v,.8*sin(u*2*pi),.42*v)); pose('HandLeft',(.07*v,-.04*v,0))
  # Each forearm fits between a fixed elbow and the posed anatomical cuff.
  bpy.context.view_layer.update()
  for side in ['Left','Right']:
   b=arm.pose.bones[side+'Forearm'];rest=b.bone.matrix_local.copy();target=rest.translation.copy()
   view_rotation=Quaternion(P((1,0,0)),arm['viewModel']['hipRotation'][0])@Quaternion(P((0,1,0)),pi+arm['viewModel']['hipRotation'][1])
   screen_elbow=P((.30,-.55,-.10) if side=='Right' else (-.30,-.55,-.10))
   target=view_rotation.inverted()@(screen_elbow-P(arm['viewModel']['hip']))
   h=arm.pose.bones['Hand'+side];cuff=(h.matrix@h.bone.matrix_local.inverted())@hand_cuffs[side]
   axis=hand_cuffs[side]-rest.translation;dest=cuff-target;direction=axis.normalized()
   rotation=axis.rotation_difference(dest).to_matrix();ratio=dest.length/axis.length
   stretch=Matrix.Identity(3)
   for row in range(3):
    for col in range(3):stretch[row][col]+=(ratio-1)*direction[row]*direction[col]
   mat=(rotation@stretch@rest.to_3x3()).to_4x4();mat.translation=target;b.matrix=mat
  bpy.context.view_layer.update()
  for bn in animated:
   b=arm.pose.bones[bn]
   for prop in ['location','rotation_quaternion','scale']:b.keyframe_insert(data_path=prop,frame=f+1,group=bn)
 # NLA strips retain all clips and their exact name.
 arm.animation_data.action=None; track=arm.animation_data.nla_tracks.new(); track.name=name; strip=track.strips.new(name,1,action); strip.action_frame_start=1; strip.action_frame_end=count+1; track.mute=True
for b in arm.pose.bones:pose(b.name)
scene.frame_set(1)
# Select the complete self-contained package only.
active(arm)
for o in meshes+[muzzle]:o.select_set(True)
print('EXPORTING',flush=True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'pistol.gltf'),export_format='GLTF_SEPARATE',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_anim_slide_to_zero=True,export_extras=True,export_skins=True,export_def_bones=False,export_morph=False,export_materials='EXPORT',export_image_format='AUTO')
pose('SpeedLoader',scale=.00001);pose('SpentRounds',scale=.00001)
pose('Hammer',rot=(-.55,0,0))
# Store the full source node trees, rig, UVs and actions outside the shipped asset.
bpy.ops.wm.save_as_mainfile(filepath=str(EVID/'revolver.blend'))
exec(compile((ROOT/'tools/blender/revolver/render.py').read_text(), 'render.py', 'exec'))
print('DONE',flush=True)
