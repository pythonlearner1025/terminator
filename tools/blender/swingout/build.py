"""Rebuild the CC0 HD swing-out package. Blender 5.2: blender -b -t 6 -P this_file.
Source geometry and hand topology stay in the committed glTF dependencies.
Game coordinates: X across gun, Y up, +Z through bore. Blender conversion P.
"""
import bpy,bmesh,math,json,os,sys
from pathlib import Path
from mathutils import Vector,Matrix,Quaternion
from math import sin,cos,pi
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'assets/models/weapons/swingout';OUT.mkdir(parents=True,exist_ok=True)
EVID=ROOT/'tools/blender/swingout/rounds';EVID.mkdir(parents=True,exist_ok=True)
ROUND=os.environ.get('SWINGOUT_ROUND','1')
P=lambda v:Vector((v[0],-v[2],v[1]))
def active(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.fps=120
# Reuse the shipped CC0 anatomical hands. Discard its weapon and all old animation.
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/models/weapons/pistol/pistol.gltf'))
arm=next(o for o in scene.objects if o.type=='ARMATURE');arm.animation_data_clear();arm.name='SwingoutRig'
for b in arm.pose.bones:b.matrix_basis.identity()
hands=[o for o in scene.objects if o.type=='MESH' and 'Hand_and_Sleeve' in o.name]
for o in list(scene.objects):
 if o not in hands+[arm]:bpy.data.objects.remove(o,do_unlink=True)
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
active(arm);bpy.ops.object.mode_set(mode='EDIT')
for b in list(arm.data.edit_bones):
 if not b.name.startswith(('Left','Right','Hand')) and b.name!='Body':arm.data.edit_bones.remove(b)
bpy.ops.object.mode_set(mode='OBJECT')
hand_material=hands[0].data.materials[0]
exec(compile((ROOT/'tools/blender/swingout/hands.py').read_text(),'hands.py','exec'))
# Keep UV seams while splitting the welded presentation mesh into connected parts.
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/models/weapons-candidates/revolver/loafbrr-cc0-hd/loafbrr-cc0-hd.gltf'))
source=next(o for o in scene.objects if o.type=='MESH' and o not in hands);active(source)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='LOOSE');bpy.ops.object.mode_set(mode='OBJECT')
objects=[o for o in scene.objects if o.type=='MESH' and o not in hands]
objects.sort(key=lambda o:int(o.name.rsplit('.',1)[-1]) if o.name.rsplit('.',1)[-1].isdigit() else 0)
assert len(objects)==70,'Source topology changed: review part segmentation'
# All source parts retain UVs. Cylinder parts 9..19 include six open chamber walls.
parts={}
for i,o in enumerate(objects):
 if i in [2,3,4,5,6,7,8,27,34,57,58,59,60,61,62]:bpy.data.objects.remove(o,do_unlink=True);continue
 group='Hammer' if i<2 else 'Cylinder' if 9<=i<=19 else 'Trigger' if i in [37,38] else 'Latch' if i==63 else 'Frame'
 # source (-X forward, Z up) to game (+Z forward, Y up), proper rotation.
 mat=Matrix(((0,-1,0,0),(1,0,0,0),(0,0,1,-.05),(0,0,0,1)))@o.matrix_world
 o.parent=None;o.matrix_world=Matrix.Identity(4);o.data.transform(mat)
 if group=='Latch':
  # Socket geometry occupies the original face. Travel stays parallel to the frame.
  pass
 o.vertex_groups.clear();o.vertex_groups.new(name=group).add(list(range(len(o.data.vertices))),1,'REPLACE')
 for uv in o.data.uv_layers.active.data:uv.uv*=.75
 parts.setdefault(group,[]).append(o)
# Atlas sources become three maps total. Reserve the right quarter for both hands.
import numpy as np
swatches=[('steel',(65,73,83),(225,74,255)),('brass',(160,114,47),(245,67,255)),('dark',(10,12,15),(230,170,150)),('primer',(137,140,145),(235,100,255)),('copper',(174,102,61),(240,90,255)),('rubber',(23,27,31),(240,175,0))]
# Pillow is used by the committed launcher before Blender. Here load its exact atlas output.
mat=bpy.data.materials.new('Swingout shared steel walnut hands and brass');mat.use_nodes=True;n=mat.node_tree.nodes;l=mat.node_tree.links;bs=n.get('Principled BSDF')
for kind in ['albedo','normal','orm']:
 tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(OUT/f'swingout-{kind}.png'),check_existing=True);tex.image.colorspace_settings.name='sRGB' if kind=='albedo' else 'Non-Color'
 if kind=='albedo':l.new(tex.outputs['Color'],bs.inputs['Base Color'])
 elif kind=='normal':
  normal=n.new('ShaderNodeNormalMap');l.new(tex.outputs['Color'],normal.inputs['Color']);l.new(normal.outputs['Normal'],bs.inputs['Normal'])
 else:
  sep=n.new('ShaderNodeSeparateColor');l.new(tex.outputs['Color'],sep.inputs[0]);l.new(sep.outputs[1],bs.inputs['Roughness']);l.new(sep.outputs[2],bs.inputs['Metallic'])
  ng=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');ng.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat');gn=n.new('ShaderNodeGroup');gn.node_tree=ng;l.new(sep.outputs[0],gn.inputs['Occlusion'])
for o in hands:
 for uv in o.data.uv_layers.active.data:uv.uv.x=.75+(uv.uv.x-.70)/.30*.25
 o.data.materials.clear();o.data.materials.append(mat)
# Replace inherited sleeve tubes with clean rings. Hand and finger topology stays unchanged.
for side in ['Left','Right']:
 o=next(o for o in hands if o.name.startswith(side));ids={g.index for g in o.vertex_groups if g.name in [side+'Forearm','Hand'+side]}
 bm=bmesh.new();bm.from_mesh(o.data);bm.verts.ensure_lookup_table()
 remove=[bm.verts[v.index] for v in o.data.vertices if any(g.group in ids and g.weight>.0001 for g in v.groups)]
 bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(o.data);bm.free()
 wrist=arm.data.bones['Hand'+side].head_local.copy();elbow=arm.data.bones[side+'Forearm'].head_local.copy();axis=(elbow-wrist).normalized();cuff=wrist-axis*.0105
 q=Vector((0,0,1)).rotation_difference(axis);verts=[];faces=[];rings=11;segments=20
 for j in range(rings):
  t=j/(rings-1);c=cuff.lerp(elbow,t);r=.028+.015*t
  for k in range(segments):
   a=k*2*pi/segments;verts.append(c+q@Vector((cos(a)*r,sin(a)*r,0)))
 for j in range(rings-1):
  for k in range(segments):a=j*segments+k;b=j*segments+(k+1)%segments;faces.append((a,b,b+segments,a+segments))
 d=bpy.data.meshes.new(side+' sleeve');d.from_pydata(verts,[],faces);d.update();sleeve=bpy.data.objects.new(side+' sleeve',d);scene.collection.objects.link(sleeve);sleeve.data.materials.append(mat)
 uv=d.uv_layers.new(name='UVMap')
 for poly in d.polygons:
  poly.use_smooth=True
  for li in poly.loop_indices:
   vi=d.loops[li].vertex_index;uv.data[li].uv=((5+(vi%segments)/(segments-1)*.9+.05)/8,.76+.22*(vi//segments)/(rings-1))
 a=sleeve.vertex_groups.new(name=side+'Forearm');h=sleeve.vertex_groups.new(name='Hand'+side)
 for j in range(rings):
  w=min(1,j/2);a.add(list(range(j*segments,(j+1)*segments)),w,'REPLACE');h.add(list(range(j*segments,(j+1)*segments)),1-w,'REPLACE')
 active(o);sleeve.select_set(True);bpy.ops.object.join()
# Add the physical mechanism with measured centers from the source geometry.
CY=.07742234; CZ=.10964;REAR=.08282;FRONT=.13646;RING=.016993
bone_defs={'Frame':((0,0,0),'Body'),'Crane':((0,.043,.148),'Body'),'Cylinder':((0,CY,CZ),'Crane'),'Ejector':((0,CY,REAR),'Cylinder'),'Hammer':((0,.057,.061),'Body'),'Trigger':((0,.046,.083),'Body'),'Latch':((.010,.063,.057),'Body'),'Loader':((0,CY,REAR-.012),'Body'),'LoaderButton':((0,CY,REAR-.026),'Loader')}
for i in range(6):
 a=i*pi/3;x=sin(a)*RING;y=CY+cos(a)*RING
 bone_defs[f'Case{i}']=((x,y,REAR),'Cylinder');bone_defs[f'Fresh{i}']=((x,y,REAR),'Cylinder');bone_defs[f'Bullet{i}']=((x,y,REAR+.037),'Cylinder')
active(arm);bpy.ops.object.mode_set(mode='EDIT')
for name,(head,parent) in bone_defs.items():
 b=arm.data.edit_bones.new(name);b.head=P(head);b.tail=P(Vector(head)+Vector((0,.012,0)));b.parent=arm.data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
def finish(o,name,part,tile=0):
 active(o);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.name=name;o.data.materials.clear();o.data.materials.append(mat)
 uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
 for x in uv.data:x.uv=((tile+.5)/8,.88)
 vg=o.vertex_groups.new(name=part);vg.add(list(range(len(o.data.vertices))),1,'REPLACE');parts.setdefault(part,[]).append(o);return o
def cyl(name,center,radius,length,part,tile=0,n=24,axis=(0,0,1)):
 bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=radius,depth=length,location=P(center));o=bpy.context.object;o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(P(axis));return finish(o,name,part,tile)
def box(name,c,size,part,tile=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=P(c));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);active(o);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);m=o.modifiers.new('Machined edges','BEVEL');m.width=.0006;m.segments=2;bpy.ops.object.modifier_apply(modifier=m.name);return finish(o,name,part,tile)
def tube(name,c,ro,ri,length,part,tile=1,n=20):
 x,y,z=c;vs=[];fs=[]
 for r,zz in [(ro,z-length/2),(ro,z+length/2),(ri,z-length/2),(ri,z+length/2)]:
  vs.extend([P((x+r*sin(j*2*pi/n),y+r*cos(j*2*pi/n),zz)) for j in range(n)])
 for j in range(n):
  k=(j+1)%n;fs.extend([(j,k,n+k,n+j),(2*n+j,3*n+j,3*n+k,2*n+k),(j,2*n+j,2*n+k,k),(n+j,n+k,3*n+k,3*n+j)])
 d=bpy.data.meshes.new(name);d.from_pydata(vs,[],fs);d.update();o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);return finish(o,name,part,tile)
cyl('Crane frame journal',(0,.043,.150),.0045,.022,'Crane')
box('Crane web',(0,.061,.143),(.007,.036,.008),'Crane')
cyl('Cylinder axle bearing',(0,CY,.1378),.0062,.005,'Crane')
cyl('Axle sleeve',(0,CY,CZ),.003,.058,'Crane')
cyl('Ejector rod',(0,CY,.148),.0018,.132,'Ejector')
cyl('Ejector thumb pad',(0,CY,.209),.0036,.007,'Ejector',0,32)
cyl('Extractor star hub',(0,CY,REAR-.0008),.0074,.0016,'Ejector',0,24)
for i in range(6):
 a=i*pi/3;x=sin(a)*RING;y=CY+cos(a)*RING
 o=box(f'Extractor arm {i}',(0,CY+.010,REAR-.0008),(.003,.013,.0016),'Ejector')
 # Rotate local geometry around the coaxial center.
 pivot=P((0,CY,REAR-.0008));o.data.transform(Matrix.Translation(pivot)@Matrix.Rotation(-a,4,'Y')@Matrix.Translation(-pivot))
 for fresh in [False,True]:
  part=f'Fresh{i}' if fresh else f'Case{i}'
  tube(part+' open case',(x,y,REAR+.018),.0055,.00465,.036,part,1)
  cyl(part+' rim',(x,y,REAR-.0003),.0060,.0014,part,1)
  cyl(part+' head',(x,y,REAR+.0003),.00545,.0015,part,1)
  cyl(part+' primer',(x,y,REAR-.0011),.0021,.0003,part,3,16)
  if not fresh:cyl(part+' primer strike',(x,y,REAR-.00128),.00065,.00008,part,2,12)
  cyl(part+' black interior',(x,y,REAR+.0013),.00465,.0002,part,2)
  if fresh:
   cyl(part+' projectile',(x,y,REAR+.04),.00535,.008,part,4)
 # Existing chamber walls are .00615 radius; cartridges have .65 mm radial clearance.
 cyl(f'Live projectile {i}',(x,y,REAR+.04),.00535,.008,f'Bullet{i}',4)
cyl('Loader round carrier',(0,CY,REAR-.012),.024,.012,'Loader',5,36)
cyl('Loader push button',(0,CY,REAR-.026),.008,.017,'LoaderButton',0,24)
cyl('Hammer pivot boss',(0,.057,.061),.004,.006,'Hammer',0,20,(1,0,0))
box('Hammer buried tang',(0,.066,.064),(.006,.02,.009),'Hammer')
# Visible pin heads define the rotation centers.
for name,c in [('Hammer pin',(0,.057,.061)),('Trigger pin',(0,.046,.083))]:cyl(name,c,.002,.021,'Frame',3,16,(1,0,0))
# Consolidate by physical part, then bound expensive source detail without altering UV coordinates.
meshes=hands[:]
for key,obs in parts.items():
 active(obs[0])
 for o in obs:o.select_set(True)
 bpy.ops.object.join();o=bpy.context.object;o.name=key+'_Surface';active(o)
 normal_source=o.copy();normal_source.data=o.data.copy();scene.collection.objects.link(normal_source)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000004);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 tri=o.modifiers.new('Triangulate','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
 limit={'Frame':4800,'Cylinder':3200,'Hammer':700,'Trigger':400}.get(key,1200)
 if len(o.data.polygons)>limit:
  dec=o.modifiers.new('Runtime budget','DECIMATE');dec.ratio=limit/len(o.data.polygons);bpy.ops.object.modifier_apply(modifier=dec.name)
 if key in ['Frame','Cylinder','Hammer','Trigger','Latch']:
  transfer=o.modifiers.new('Preserve HD corner normals','DATA_TRANSFER');transfer.object=normal_source;transfer.use_loop_data=True;transfer.data_types_loops={'CUSTOM_NORMAL'};transfer.loop_mapping='POLYINTERP_NEAREST';bpy.ops.object.modifier_apply(modifier=transfer.name)
 bpy.data.objects.remove(normal_source,do_unlink=True)
 o.data.materials.clear();o.data.materials.append(mat)
 for p in o.data.polygons:p.material_index=0
 mod=o.modifiers.new('Swingout skeleton','ARMATURE');mod.object=arm;o.parent=arm;meshes.append(o)
# Keep the full named mechanical skeleton with one skinned weapon draw.
weapon_meshes=[o for o in meshes if o not in hands]
active(weapon_meshes[0])
for o in weapon_meshes:o.select_set(True)
bpy.ops.object.join();weapon=bpy.context.object;weapon.name='Swingout_Mechanism';meshes=hands+[weapon]
# Trim the remaining high-cost material switches: each independently moving part retains its name.
for o in list(scene.objects):
 if o not in meshes+[arm]:bpy.data.objects.remove(o,do_unlink=True)
arm['weaponAsset']='swingout';arm['gltfUUID']='weapon-swingout-root'
arm['viewModel']={'id':'swingout','gameplayWeapon':'pistol','mechanism':'swingout','embeddedHands':True,'forwardAxis':'+Z','hip':[.075,-.13,-.57],'hipRotation':[0,.12,0],'fov':38,'sight':{'height':.10935,'pitch':-.0176,'distance':.36,'front':.309,'rear':.062},'grip':{'position':[0,0,0],'radius':[.014,.05,.03]},'support':{'position':[0,-.025,.01],'radius':[.026,.025,.03]},'reload':{'release':.94/2.6,'eject':1.18/2.6,'seat':1.82/2.6},'fire':{'strike':.05,'discharge':7/120,'index':60,'axis':'+Z'}}
# Bone-parented markers use full matrix compensation and export identity orientation.
markers=[]
for name,position,parent in [('Muzzle',(0,.094415,.31684),'Frame'),('CylinderGapLeft',(.018,.094415,.1375),'Frame'),('CylinderGapRight',(-.018,.094415,.1375),'Frame'),('Ejection',(0,CY,REAR),'Ejector')]:
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.parent=arm;o.parent_type='BONE';o.parent_bone=parent;bpy.context.view_layer.update();o.matrix_world=Matrix.Translation(P(position))@Matrix.Rotation(pi/2,4,'X');markers.append(o)
for b in arm.data.bones:b['gltfUUID']='weapon-swingout-'+b.name
exec(compile((ROOT/'tools/blender/swingout/animate.py').read_text(),'animate.py','exec'))
for b in arm.pose.bones:b.matrix_basis.identity()
arm.animation_data.action=None
active(arm)
for o in meshes+markers:o.select_set(True)
STAGE=ROOT/'.kite3d/swingout-export';STAGE.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(STAGE/'swingout.gltf'),export_format='GLTF_SEPARATE',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_anim_slide_to_zero=True,export_extras=True,export_skins=True,export_def_bones=False,export_morph=False,export_materials='EXPORT',export_image_format='AUTO')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'.kite3d/swingout.blend'))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'tools/blender/swingout/swingout.blend'),compress=True)
exec(compile((ROOT/'tools/blender/swingout/render.py').read_text(),'render.py','exec'))
