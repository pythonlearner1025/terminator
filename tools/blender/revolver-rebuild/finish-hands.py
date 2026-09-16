"""Bounded real 1024px hand atlas bakes + Eevee/checker review. Required wrapper only.
Normals are selected high subdivision surface -> exact game surface; AO traces geometry.
"""
import bpy
import json
import time
import importlib.util
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
OUT=HERE/'generated/hands'
spec=importlib.util.spec_from_file_location('hands',HERE/'hands.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
bpy.ops.wm.open_mainfile(filepath=str(OUT/'hands.blend'))
scene=bpy.context.scene;rig=bpy.data.objects['HandsRig'];meta=json.loads(rig['handsMetadata'])
objects=[bpy.data.objects[n+s] for s in ('Right','Left') for n in ('HandMesh','Sleeve')]
result={'armature':rig,'meshes':objects,'bones':meta['bones'],'metadata':meta}
h.apply_pose(result,'neutral')
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=8
scene.render.bake.margin=5
report={'resolution':1024,'samples':8,'normalSource':'one additional Catmull-Clark subdivision of the new skin, nail and sleeve surfaces',
        'aoSource':'Cycles geometry ray bake in neutral pose; hands isolated spatially to avoid imprinting the other hand',
        'baseSource':'emission extraction of actual Base Color socket and vertex tint; no lighting', 'roughnessSource':'per-material roughness emission bake',
        'uvLayout':'four deterministic non-overlapping quadrants; packed islands have padded gutters','uvSignature':h.uv_signature(objects),'timings':{}}
# Keep editable authored meshes/rig and gun untouched. Bake temporary evaluated copies only.
bpy.ops.object.select_all(action='DESELECT');copies=[]
for obj in objects:
    copy=obj.copy();copy.data=obj.data.copy();scene.collection.objects.link(copy)
    copy.parent=None;copy.matrix_world=obj.matrix_world.copy()
    bpy.context.view_layer.objects.active=copy;copy.select_set(True)
    for mod in list(copy.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    if 'Left' in obj.name:copy.location.y-=.4
    copy.select_set(False);copies.append(copy)
for obj in copies:obj.select_set(True)
bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();low=bpy.context.object;low.name='TEMP hand atlas target'
materials=list(low.data.materials)
previous_hide={obj:obj.hide_render for obj in list(scene.objects) if obj not in [low]}
for obj in previous_hide:
    if obj.type=='MESH':obj.hide_render=True
high=low.copy();high.data=low.data.copy();scene.collection.objects.link(high);high.name='TEMP smooth high hand source'
bpy.context.view_layer.objects.active=high
mod=high.modifiers.new('Actual high source surface','SUBSURF');mod.levels=1;mod.render_levels=1
bpy.ops.object.modifier_apply(modifier=mod.name)
# True high-source geometry count, recorded for reproducibility.
report['lowTriangles']=sum(len(p.vertices)-2 for p in low.data.polygons)
report['highTriangles']=sum(len(p.vertices)-2 for p in high.data.polygons)

def image_target(label,color):
    image=bpy.data.images.new('Hands '+label,width=1024,height=1024,alpha=False)
    image.generated_color=(*color,1);image.colorspace_settings.name='sRGB' if label=='basecolor' else 'Non-Color'
    for mat in materials:
        node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.name='Temporary bake '+label;node.image=image
        mat.node_tree.nodes.active=node
    return image

def bake(label,kind,color):
    image=image_target(label,color);t=time.monotonic();bpy.ops.object.bake(type=kind)
    report['timings'][label]=time.monotonic()-t
    image.filepath_raw=str(OUT/('hands-'+label+'.png'));image.file_format='PNG';image.save();image.pack()
    return image

bpy.ops.object.select_all(action='DESELECT');low.select_set(True);high.select_set(True);bpy.context.view_layer.objects.active=low
scene.render.bake.use_selected_to_active=True;scene.render.bake.cage_extrusion=.0008;scene.render.bake.max_ray_distance=.003
normal=bake('normal','NORMAL',(.5,.5,1))
bpy.data.objects.remove(high,do_unlink=True);scene.render.bake.use_selected_to_active=False
ambient=bake('ao','AO',(1,1,1))
scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False;scene.render.bake.use_pass_color=True
base_outputs=[]
for mat in materials:
    tree=mat.node_tree;output=tree.nodes.get('Material Output');old=output.inputs['Surface'].links[0].from_socket
    emission=tree.nodes.new('ShaderNodeEmission');color=tree.nodes.get('Principled BSDF').inputs['Base Color']
    if color.is_linked:tree.links.new(color.links[0].from_socket,emission.inputs[0])
    else:emission.inputs[0].default_value=color.default_value
    tree.links.new(emission.outputs[0],output.inputs['Surface']);base_outputs.append((tree,output,old,emission))
base=bake('basecolor','EMIT',(.2,.12,.08))
for tree,output,old,emission in base_outputs:tree.links.new(old,output.inputs['Surface']);tree.nodes.remove(emission)
# Bake material roughness to emission with original shader nodes preserved for restoration.
outputs=[]
for mat in materials:
    tree=mat.node_tree;output=tree.nodes.get('Material Output');old=output.inputs['Surface'].links[0].from_socket
    emission=tree.nodes.new('ShaderNodeEmission');value=tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value
    emission.inputs[0].default_value=(value,value,value,1);tree.links.new(emission.outputs[0],output.inputs['Surface'])
    outputs.append((tree,output,old,emission))
rough=bake('roughness','EMIT',(.7,.7,.7))
for tree,output,old,emission in outputs:tree.links.new(old,output.inputs['Surface']);tree.nodes.remove(emission)
# glTF ORM: R=real AO, G=real material roughness bake, B=zero metallic.
import numpy as np
base_pixels=np.empty(1024*1024*4,dtype=np.float32);base.pixels.foreach_get(base_pixels);base_pixels=base_pixels.reshape((1024,1024,4))
coverage={}
for obj in objects:
    obj.data.calc_loop_triangles();uvs=obj.data.uv_layers.active.data;black=[]
    for tri in obj.data.loop_triangles:
        uv=sum((uvs[i].uv for i in tri.loops),Vector((0,0)))/3
        x=max(0,min(1023,int(uv.x*1024)));y=max(0,min(1023,int(uv.y*1024)))
        if float(base_pixels[y,x,:3].max())<.003:black.append(tri.index)
    coverage[obj.name]={'triangleCenters':len(obj.data.loop_triangles),'blackBasecolorSamples':black}
report['basecolorCoverage']=coverage
del base_pixels
ap=np.empty(1024*1024*4,dtype=np.float32);rp=np.empty_like(ap);ambient.pixels.foreach_get(ap);rough.pixels.foreach_get(rp)
pixels=np.ones((1024*1024,4),dtype=np.float32);pixels[:,0]=ap.reshape((-1,4))[:,0];pixels[:,1]=rp.reshape((-1,4))[:,0];pixels[:,2]=0
orm=bpy.data.images.new('Hands ORM',width=1024,height=1024,alpha=False);orm.colorspace_settings.name='Non-Color';orm.pixels.foreach_set(pixels.ravel())
orm.filepath_raw=str(OUT/'hands-orm.png');orm.file_format='PNG';orm.save();orm.pack()
report['textureRange']={'normal':None,'ao':[float(ap.min()),float(ap.max())],'roughness':[float(rp.min()),float(rp.max())]}
npix=np.empty_like(ap);normal.pixels.foreach_get(npix);report['textureRange']['normal']=[float(npix.min()),float(npix.max())]
del ap,rp,pixels,npix
bpy.data.objects.remove(low,do_unlink=True)
for obj,hidden in previous_hide.items():obj.hide_render=hidden
(OUT/'bake-report.json').write_text(json.dumps(report,indent=2)+'\n')
assert h.apply_baked_materials(objects,OUT), 'Fresh bake UV signature must match source'
meta['materials']=['ResistanceHandsAtlas'];meta['textures']='Real 1024px basecolor, selected-high normal and geometry AO/roughness ORM; see bake-report.json'
rig['handsMetadata']=json.dumps(meta)
(OUT/'bake-report.json').write_text(json.dumps(report,indent=2)+'\n')
h.apply_pose(result,'grip')
# Modest real material renders, no Cycles beauty rendering.
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=720;scene.render.resolution_y=640;scene.render.resolution_percentage=100
if hasattr(scene,'eevee') and hasattr(scene.eevee,'taa_render_samples'):scene.eevee.taa_render_samples=16
scene.world.use_nodes=True;bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.065,.075,.085,1);bg.inputs[1].default_value=.2
for name,pos,energy,size in [('Hands soft key',(.0,.28,.32),1.8,.3),('Hands fill',(.2,-.35,.14),1.2,.3),('Hands rim',(.38,.1,.3),1.5,.2)]:
    d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((.12,0,-.025))-o.location).to_track_quat('-Z','Y').to_euler()
scene.view_settings.view_transform='AgX'
evidence=HERE/'generated/review/hands'
for view in ('player','palm'):
    scene.camera=bpy.data.objects['HandsReview.'+view.capitalize()]
    scene.render.filepath=str(evidence/('grip-'+view+'-material.png'));bpy.ops.render.render(write_still=True)
checker=bpy.data.materials.new('Hands UV diagnostic');checker.use_nodes=True
im=bpy.data.images.new('Hands UV checker 1024',width=1024,height=1024);im.generated_type='COLOR_GRID';im.pack()
t=checker.node_tree.nodes.new('ShaderNodeTexImage');t.image=im
checker.node_tree.links.new(t.outputs['Color'],checker.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
original={o:list(o.data.materials) for o in objects}
for o in objects:o.data.materials.clear();o.data.materials.append(checker)
h.apply_pose(result,'neutral')
for o in scene.objects:
    if o.type=='MESH' and o not in objects:o.hide_render=True
for o in objects:o.hide_render='Left' in o.name
scene.camera=bpy.data.objects['HandsReview.Back'];scene.render.filepath=str(evidence/'neutral-back-uv-checker.png');bpy.ops.render.render(write_still=True)
for o,mats in original.items():
    o.data.materials.clear()
    for m in mats:o.data.materials.append(m)
    o.hide_render=False
for o,hidden in previous_hide.items():o.hide_render=hidden
# Additional fixed isolated views make palm contact and hand thickness reviewable.
scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.color_type='SINGLE';scene.display.shading.single_color=(.48,.52,.55)
side=bpy.data.objects.get('HandsReview.Side')
if side is None:
    side=bpy.data.objects.new('HandsReview.Side',bpy.data.cameras.new('HandsReview.Side'));scene.collection.objects.link(side)
side.location=(.195,0,.65);side.rotation_euler=(Vector((.195,0,-.045))-side.location).to_track_quat('-Z','Y').to_euler();side.data.type='ORTHO';side.data.ortho_scale=.48
h.apply_pose(result,'neutral')
for obj in scene.objects:
    if obj.type=='MESH':obj.hide_render=obj.name not in ('HandMeshRight','SleeveRight')
scene.camera=side;scene.render.filepath=str(evidence/'neutral-side-clay.png');bpy.ops.render.render(write_still=True)
h.apply_pose(result,'grip')
for obj,hidden in previous_hide.items():obj.hide_render=hidden
for obj in objects:obj.hide_render='Left' in obj.name
scene.camera=bpy.data.objects['HandsReview.Palm'];scene.render.filepath=str(evidence/'grip-right-palm-clay.png');bpy.ops.render.render(write_still=True)
for obj in objects:obj.hide_render=False
scene.render.engine='BLENDER_EEVEE';scene.display.shading.color_type='MATERIAL'
h.apply_pose(result,'grip');scene.camera=bpy.data.objects['HandsReview.Player']
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'hands.blend'))
# Keep same contract metadata and append actual bake provenance.
contract=json.loads((OUT/'hands-contract.json').read_text());contract['materials']=meta['materials'];contract['textures']=meta['textures'];contract['bake']=report
(OUT/'hands-contract.json').write_text(json.dumps(contract,indent=2)+'\n')
Path('/home/minjune/games/terminator-v2/coordination/revolver-hands-contract.json').write_text(json.dumps(contract,indent=2)+'\n')
print('HAND FINISH COMPLETE',json.dumps(report))
