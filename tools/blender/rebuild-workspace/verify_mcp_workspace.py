"""Setup-only practice verification; execute via official Blender MCP."""
import bpy, importlib.util, json
from pathlib import Path
assert bpy.data.filepath, 'Open the generated workspace first'
root=Path(bpy.data.filepath).resolve().parent.parent
assert (root/'workstation.py').is_file(), 'Not a rebuild workspace'
spec=importlib.util.spec_from_file_location('workstation',root/'workstation.py')
w=importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
s=bpy.context.scene
assert not bpy.data.collections['Rebuild'].all_objects
before=w.mesh_digest(bpy.data.collections['SOURCE'].all_objects)
bpy.data.collections['Practice'].hide_viewport=False
base=bpy.data.objects['Practice.Coupon']; child=bpy.data.objects['Practice.HingedChild']
s.frame_set(1); bpy.context.view_layer.update()
pivot=child.matrix_world.translation.copy(); base_matrix=base.matrix_world.copy(); rest=child.matrix_world.copy()
s.frame_set(20); bpy.context.view_layer.update()
assert (child.matrix_world.translation-pivot).length < 1e-7 and base.matrix_world == base_matrix and child.matrix_world != rest
s.frame_set(1); bpy.context.view_layer.update()
assert child.matrix_world == rest
bpy.data.collections['Practice'].hide_viewport=True
pair=w.capture_pair(root/'generated/mac-mcp', 'threequarter_left')
custom=w.set_view('inspection',azimuth=-120,elevation=25,fov=45)
assert custom == w.set_view('inspection',azimuth=-120,elevation=25,fov=45)
w.set_view('threequarter_left')
assert before == w.mesh_digest(bpy.data.collections['SOURCE'].all_objects)
w.set_view('threequarter_left'); w.shading()
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type == 'VIEW_3D' and area.spaces.active.type == 'VIEW_3D':
   area.spaces.active.overlay.show_overlays=False
   area.spaces.active.region_3d.view_camera_zoom=22
bpy.ops.wm.save_as_mainfile(filepath=str(root/'generated/output.blend'))
result={'transport':'official Blender MCP stdio','blender':bpy.app.version_string,'reference_mesh_unchanged':True,'rebuild_empty':True,'hinge_test':'pass','custom_camera_repeat':'pass','capture':pair,'file':bpy.data.filepath}
(root/'generated/mac-mcp/proof.json').write_text(json.dumps(result,indent=2))
