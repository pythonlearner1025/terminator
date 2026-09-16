"""Bounded 1024px CPU bakes and modest Eevee review; always invoke via shared wrapper."""
import bpy,bmesh,importlib.util,json,math,time
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent;OUT=HERE/'generated/gun';ROOT=HERE.parents[2]
s=importlib.util.spec_from_file_location('workstation',ROOT/'tools/blender/rebuild-workspace/workstation.py');w=importlib.util.module_from_spec(s);s.loader.exec_module(w)
bpy.ops.wm.open_mainfile(filepath=str(OUT/'gun.blend'))
scene=bpy.context.scene;coll=bpy.data.collections['Rebuild'];obs=[o for o in coll.all_objects if o.type=='MESH'];mats=list({m for o in obs for m in o.data.materials})
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=8;scene.render.bake.margin=4
# One aggregate bake target shares the exact packed UVs, while authored components remain separate.
bpy.ops.object.select_all(action='DESELECT');copies=[]
for o in obs:
 c=o.copy();c.data=o.data.copy();scene.collection.objects.link(c);c.select_set(True);copies.append(c)
bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();low=bpy.context.object;low.name='BAKE low target'
for o in obs:o.hide_render=True
# Explode disconnected construction pieces for the normal bake only. This prevents
# rays hitting adjoining frame/barrel surfaces; translation preserves tangent space.
original_low_positions=[v.co.copy() for v in low.data.vertices]
bm=bmesh.new();bm.from_mesh(low.data);remaining=set(bm.verts);islands=[]
while remaining:
 seed=remaining.pop();group={seed};front=[seed]
 while front:
  v=front.pop()
  for e in v.link_edges:
   other=e.other_vert(v)
   if other in remaining:remaining.remove(other);group.add(other);front.append(other)
 islands.append(group)
for i,group in enumerate(islands):bmesh.ops.translate(bm,verts=list(group),vec=Vector((i*.5,0,0)))
bm.to_mesh(low.data);bm.free()
high=low.copy();high.data=low.data.copy();scene.collection.objects.link(high);high.name='BAKE high microbevel'
bev=high.modifiers.new('High source micro edge rounding','BEVEL');bev.width=.0002;bev.segments=4;bev.limit_method='ANGLE';bev.angle_limit=math.radians(60)
# High source carries actual denser bevel geometry, not a constant texture.
bpy.context.view_layer.objects.active=high;bpy.ops.object.modifier_apply(modifier=bev.name)
report={'resolution':1024,'cyclesSamples':8,'normalSource':'exploded disconnected pieces, selected high microbevel to original low','normalBakeIslands':len(islands),'images':{}}
def target(name,color):
 img=bpy.data.images.new(name,width=1024,height=1024,alpha=False);img.generated_color=color;img.colorspace_settings.name='sRGB' if name=='Gun BaseColor' else 'Non-Color'
 for m in mats:
  n=m.node_tree.nodes.new('ShaderNodeTexImage');n.name='Bake Target '+name;n.image=img;m.node_tree.nodes.active=n
 return img
def save(img,name):
 img.filepath_raw=str(OUT/name);img.file_format='PNG';img.save();img.pack();report['images'][name]={'baked':True}
normal=target('Gun Normal',(0.5,0.5,1,1));bpy.ops.object.select_all(action='DESELECT');high.select_set(True);low.select_set(True);bpy.context.view_layer.objects.active=low
scene.render.bake.use_selected_to_active=True;scene.render.bake.cage_extrusion=.0007;scene.render.bake.max_ray_distance=.002
start=time.monotonic();bpy.ops.object.bake(type='NORMAL');save(normal,'gun-normal.png');report['normalSeconds']=time.monotonic()-start
bpy.data.objects.remove(high,do_unlink=True)
for v,co in zip(low.data.vertices,original_low_positions):v.co=co
low.data.update();scene.render.bake.use_selected_to_active=False
start=time.monotonic();ao=target('Gun AO',(1,1,1,1));bpy.ops.object.bake(type='AO');save(ao,'gun-ao.png');report['aoSeconds']=time.monotonic()-start
base=target('Gun BaseColor',(.1,.1,.1,1));scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False;scene.render.bake.use_pass_color=True
saved_surfaces=[]
for m in mats:
 n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');out=next(x for x in n if x.type=='OUTPUT_MATERIAL');old=out.inputs['Surface'].links[0].from_socket
 emission=n.new('ShaderNodeEmission');emission.inputs['Color'].default_value=p.inputs['Base Color'].default_value
 if p.inputs['Base Color'].is_linked:l.new(p.inputs['Base Color'].links[0].from_socket,emission.inputs['Color'])
 l.new(emission.outputs[0],out.inputs['Surface']);saved_surfaces.append((m,out,old,emission))
bpy.ops.object.bake(type='EMIT');save(base,'gun-basecolor.png')
for m,out,old,emission in saved_surfaces:
 m.node_tree.links.new(old,out.inputs['Surface']);m.node_tree.nodes.remove(emission)
bpy.data.objects.remove(low,do_unlink=True)
for o in obs:o.hide_render=False
for m in mats:
 n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
 norm=n.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=1;tex=n.new('ShaderNodeTexImage');tex.image=normal;l.new(tex.outputs['Color'],norm.inputs['Color']);l.new(norm.outputs['Normal'],p.inputs['Normal'])
 tex=n.new('ShaderNodeTexImage');tex.image=base;l.new(tex.outputs['Color'],p.inputs['Base Color'])
 # Blender glTF exporter recognizes this optional occlusion socket group.
 group=bpy.data.node_groups.get('glTF Material Output')
 if not group:
  group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
 g=n.new('ShaderNodeGroup');g.node_tree=group;tex=n.new('ShaderNodeTexImage');tex.image=ao;l.new(tex.outputs['Color'],g.inputs['Occlusion'])
report['lowTriangles']=sum(len(o.data.loop_triangles) for o in obs)
(OUT/'bake-report.json').write_text(json.dumps(report,indent=2))
s=importlib.util.spec_from_file_location('gun',HERE/'gun.py');gun=importlib.util.module_from_spec(s);s.loader.exec_module(gun);gun.write_baked_uv_layout(obs,OUT)
# Small material review, fixed workstation cameras and world.
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=False
scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.035,.045,.060,1);scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.35
for name,pos,energy,size in [('Key',(-.25,-.4,.5),30,.35),('Fill',(.3,-.15,.25),15,.25),('Rim',(.1,.4,.3),40,.3)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
scene.view_settings.view_transform='AgX';scene.render.resolution_x=800;scene.render.resolution_y=600
scene.render.engine='BLENDER_EEVEE'
# Small headless Eevee material review, bounded to fixed 800x600 views.
for view in ['threequarter_left','left','rear','front']:
 w.set_view(view);scene.render.filepath=str(OUT/(view+'-material.png'));bpy.ops.render.render(write_still=True)
# Checker records actual packed UV deformation and texel density.
checker=bpy.data.materials.new('Review UV checker');checker.use_nodes=True;n=checker.node_tree.nodes;l=checker.node_tree.links;p=n.get('Principled BSDF');im=bpy.data.images.new('UV Checker',width=1024,height=1024);im.generated_type='COLOR_GRID';im.pack();t=n.new('ShaderNodeTexImage');t.image=im;l.new(t.outputs['Color'],p.inputs['Base Color']);p.inputs['Roughness'].default_value=.65
original={o.name:list(o.data.materials) for o in obs}
for o in obs:
 for i in range(len(o.data.materials)):o.data.materials[i]=checker
w.set_view('threequarter_left');scene.render.filepath=str(OUT/'uv-checker.png');bpy.ops.render.render(write_still=True)
for o in obs:
 for i,m in enumerate(original[o.name]):o.data.materials[i]=m
w.set_view('threequarter_left');bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gun.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in obs:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'gun.glb'),export_format='GLB',use_selection=True,export_yup=False,export_extras=True,export_animations=False)
print('FINISH COMPLETE',report)
