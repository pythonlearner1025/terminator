"""Extract the CC0 neutral hand. Run headless once after the documented bundle download."""
import bpy,bmesh,json
from pathlib import Path
from mathutils import Vector,Matrix
import numpy as np
ROOT=Path(__file__).resolve().parents[3]
bpy.ops.wm.read_factory_settings(use_empty=True)
with bpy.data.libraries.load(str(ROOT/'tools/blender/cache/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend'),link=False) as (src,dst):dst.objects=['Hand  - Realistic']
o=dst.objects[0];o.parent=None;o.animation_data_clear();o.constraints.clear();o.matrix_world=Matrix.Identity(4);o.delta_location=(0,0,0);o.delta_rotation_euler=(0,0,0);o.delta_scale=(1,1,1);bpy.context.scene.collection.objects.link(o);o.select_set(True);bpy.context.view_layer.objects.active=o
for mod in list(o.modifiers):
 if mod.type=='MULTIRES':mod.levels=1;mod.sculpt_levels=1;mod.render_levels=1;bpy.ops.object.modifier_apply(modifier=mod.name)
 else:o.modifiers.remove(mod)
bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=(0,0,.012),plane_no=(0,0,1),clear_outer=True,clear_inner=False);bmesh.ops.holes_fill(bm,edges=[e for e in bm.edges if e.is_boundary],sides=0);bm.to_mesh(o.data);bm.free()
sp={'Index':[(.030,0,-.105),(.040,0,-.140),(.049,0,-.168),(.050,0,-.186)],'Middle':[(.005,0,-.110),(.011,0,-.153),(.015,0,-.181),(.016,0,-.200)],'Ring':[(-.020,0,-.108),(-.019,0,-.146),(-.017,0,-.174),(-.016,0,-.189)],'Little':[(-.038,0,-.101),(-.049,0,-.130),(-.052,0,-.149),(-.052,0,-.162)],'Thumb':[(.024,0,-.036),(.052,0,-.064),(.072,0,-.091),(.088,0,-.106)]}
vs=np.array([v.co for v in o.data.vertices])
for f,chain in sp.items():
 for i,p in enumerate(chain):
  distances=(vs[:,0]-p[0])**2+(vs[:,2]-p[2])**2;sample=vs[np.argsort(distances)[:18],1];chain[i]=(p[0],float((np.percentile(sample,10)+np.percentile(sample,90))*.5),p[2])
o['joints']=json.dumps(sp);o['sourceLicense']='CC0-1.0';o['sourceAuthor']='Dan Ulrich';o.name='Neutral anatomical hand'
o.data.materials.clear()
tri=o.modifiers.new('Triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
dec=o.modifiers.new('Hand budget','DECIMATE');dec.ratio=min(1,3500/len(o.data.polygons));bpy.ops.object.modifier_apply(modifier=dec.name)
for p in o.data.polygons:p.use_smooth=True
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'tools/blender/swingout/neutral-hand.blend'),compress=True)
