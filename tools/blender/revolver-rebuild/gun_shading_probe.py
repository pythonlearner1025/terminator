import bpy,importlib.util
from pathlib import Path
P=Path(__file__).resolve().parent;O=P/'generated/gun';bpy.ops.wm.open_mainfile(filepath=str(O/'gun.blend'))
s=importlib.util.spec_from_file_location('workstation',P.parent/'rebuild-workspace/workstation.py');w=importlib.util.module_from_spec(s);s.loader.exec_module(w)
for m in {m for o in bpy.data.collections['Rebuild'].all_objects if o.type=='MESH' for m in o.data.materials}:
 p=m.node_tree.nodes.get('Principled BSDF')
 for link in list(p.inputs['Normal'].links):m.node_tree.links.remove(link)
w.set_view('left');bpy.context.scene.render.filepath=str(O/'round2/normal-disabled.png');bpy.ops.render.render(write_still=True)
