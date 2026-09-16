"""Render four fixed studio angles in background Blender. Use sheet.py afterwards."""
import bpy, math, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
SLUG='barrel-0p8x1p3x0p8-103qszk'
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['1']
ROUND=int(args[0]);OUT=ROOT/'tools/blender/cache'/f'round-{ROUND}';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/models/map'/SLUG/(SLUG+'.gltf')))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=64 if ROUND==4 else 24;scene.cycles.use_denoising=True;scene.cycles.seed=2029
scene.render.resolution_x=1200 if ROUND==4 else 600;scene.render.resolution_y=1440 if ROUND==4 else 720;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
scene.world.color=(.18,.18,.18)
# Neutral studio illumination for honest material inspection.
def area(name,pos,energy,color,size,target=(0,0,.02)):
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.color=color;d.shape='DISK';d.size=size
 o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
area('large warm key',(2,-3,4),310,(1,.86,.72),3)
area('cool fill',(-3,-1,2),190,(.68,.80,1),2.5)
area('edge softbox',(0,3,3),250,(1,.94,.84),2)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.621))
floor=bpy.context.object;mat=bpy.data.materials.new('Studio floor');mat.diffuse_color=(.055,.065,.075,1);floor.data.materials.append(mat)
cam=bpy.data.cameras.new('Studio camera');o=bpy.data.objects.new('Studio camera',cam);scene.collection.objects.link(o);scene.camera=o;cam.type='ORTHO';cam.ortho_scale=1.65
for name,pos,target,scale in [('three-quarter',(2.1,-3.0,1.8),(0,0,.00),1.65),('side',(0,-4,.05),(0,0,.00),1.53),('top',(1,-1.4,3.7),(0,0,.10),1.48)]:
 o.location=pos;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();cam.ortho_scale=scale
 scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
