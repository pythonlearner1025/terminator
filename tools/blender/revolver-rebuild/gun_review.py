import bpy,bmesh,importlib.util,json,math,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2];OUT=HERE/'generated/gun'
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
w=load('workstation',ROOT/'tools/blender/rebuild-workspace/workstation.py');gun=load('gun',HERE/'gun.py')
bpy.ops.wm.open_mainfile(filepath=str(OUT/'reference.blend'))
r=gun.build_gun(bpy.data.collections['Rebuild'],use_baked_materials=False);obs=list(r['objects'].values())
metrics={'parts':{},'totalTriangles':0,'anchors':r['anchors'],'metadata':r['metadata']}
for o in obs:
 o.data.calc_loop_triangles();n=len(o.data.loop_triangles);metrics['totalTriangles']+=n;metrics['parts'][o.name]={'triangles':n,'uvLayers':len(o.data.uv_layers),'seams':sum(e.use_seam for e in o.data.edges),'bounds':w.bounds([o]),'origin':list(o.location)}
(OUT/'gun-metrics.json').write_text(json.dumps(metrics,indent=2))
for view in ['left','top','front','rear','threequarter_left']:
 w.capture_pair(OUT/'blockout',view,'clay')
 w.capture_pair(OUT/'silhouette',view,'silhouette')
bpy.data.collections['Reference'].hide_render=True;bpy.data.collections['Reference'].hide_viewport=True
w.set_view('threequarter_left');w.shading('material')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'gun.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in obs:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'gun.glb'),export_format='GLB',use_selection=True,export_yup=False,export_extras=True,export_animations=False)
print('GUN_METRICS',metrics['totalTriangles'])
