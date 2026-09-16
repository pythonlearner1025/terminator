"""Bounded static review; does not bake animation or alter source geometry."""
import bpy,sys,json,math,argparse
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import imported_hands
from assemble import module
p=argparse.ArgumentParser();p.add_argument('--right-only',action='store_true');p.add_argument('--labels',action='store_true');p.add_argument('--material',action='store_true');p.add_argument('--gun',required=True);p.add_argument('--output',default=str(HERE/'generated/retarget-static'));a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
c=bpy.data.collections.new('Rebuild');bpy.context.scene.collection.children.link(c)
gun=module(a.gun,'approved_gun').build_gun(collection=c)
h=imported_hands.build_hands({'anchors':gun['anchors']},c)
(out/'contacts.json').write_text(json.dumps(imported_hands.contact_report(h,list(gun['objects'].values())),indent=2))
(out/'bilateral.json').write_text(json.dumps(imported_hands.bilateral_report(h),indent=2))
if a.right_only:
 control=h['controls'][h['mapping']['L']['upper_arm']['joint']];m=control.matrix_world.copy();m.translation.y-=1;control.matrix_world=m
original_mesh=h['meshes'][0].data
if a.labels:
 ob=h['meshes'][0];ob.data=original_mesh.copy();ob.data.materials.clear()
 colors=[('Right hand',(.6,.6,.6,1)),('Right index',(.12,.40,.85,1)),('Right thumb',(.95,.35,.08,1)),('Left support',(.28,.45,.38,1)),('Left thumb',(.2,.85,.28,1))]
 for name,color in colors:
  mat=bpy.data.materials.new(name);mat.diffuse_color=color;ob.data.materials.append(mat)
 for face in ob.data.polygons:
  weights={}
  for i in face.vertices:
   for g in ob.data.vertices[i].groups:
    name=ob.vertex_groups[g.group].name;weights[name]=weights.get(name,0)+g.weight
  name=max(weights,key=weights.get);face.material_index=1 if name.startswith('R_point') else 2 if name.startswith('R_thumb') else 4 if name.startswith('L_thumb') else 3 if name.startswith('L_') else 0
scene=bpy.context.scene;scene.render.engine='BLENDER_WORKBENCH';scene.render.resolution_x=640;scene.render.resolution_y=480;scene.render.resolution_percentage=100
scene.display.shading.light='STUDIO';scene.display.shading.color_type='SINGLE';scene.display.shading.single_color=(.60,.60,.60)
if a.material:scene.display.shading.color_type='TEXTURE'
if a.labels:scene.display.shading.color_type='MATERIAL';scene.display.shading.show_shadows=False;scene.display.shading.show_cavity=True
scene.display.shading.background_type='WORLD';scene.world.color=(.16,.16,.16)
for label,loc,target in [('right',(.30,.42,.16),(.065,0,-.025)),('trigger-close',(.235,.245,.065),(.105,0,-.01)),('backstrap-close',(.36,-.20,.08),(.13,0,-.015)),('left',(.26,-.42,.16),(.065,0,-.025)),('top',(.09,0,.55),(.065,0,-.025)),('hip',(.47,-.11,.13),(.0,-.11,.13))]:
 cam=bpy.data.objects.new('Review.'+label,bpy.data.cameras.new('Review.'+label));scene.collection.objects.link(cam);cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=38;cam.data.clip_start=.01;scene.camera=cam
 if label=='hip':cam.data.sensor_fit='VERTICAL';cam.data.sensor_height=24;cam.data.lens=24/(2*math.tan(math.radians(54)/2))
 scene.render.filepath=str(out/(label+'.png'));bpy.ops.render.render(write_still=True)
 from bpy_extras.object_utils import world_to_camera_view
 annotations={}
 for side,digit in [('R','index'),('R','thumb'),('L','thumb')]:
  name=h['mapping'][side][digit]['joints'][2];pt=world_to_camera_view(scene,cam,h['controls'][name].matrix_world.translation);annotations[side+' '+digit]=[pt.x*640,(1-pt.y)*480]
 (out/(label+'-labels.json')).write_text(json.dumps(annotations))
# Record actual evaluated skin bounds/control positions for reproducible review.
bpy.context.view_layer.update();ev=h['meshes'][0].evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();v=[ev.matrix_world@x.co for x in me.vertices]
report={'scale':.5,'vertices':len(v),'skinBounds':[[min(p[i] for p in v) for i in range(3)],[max(p[i] for p in v) for i in range(3)]],'controls':{n:list(o.matrix_world.translation) for n,o in h['controls'].items()},'status':'static fit awaiting visual review; no collision certification'};ev.to_mesh_clear();(out/'static-report.json').write_text(json.dumps(report,indent=2))
h['meshes'][0].data=original_mesh
bpy.ops.wm.save_as_mainfile(filepath=str(out/'grip.blend'));print('STATIC_REVIEW',out)
