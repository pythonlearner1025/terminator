"""Check a new builder import without reference objects, as assembly uses it."""
import bpy,importlib.util
from pathlib import Path
P=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('gun',P/'gun.py');gun=importlib.util.module_from_spec(s);s.loader.exec_module(gun)
bpy.ops.wm.read_factory_settings(use_empty=True);result=gun.build_gun()
bpy.ops.object.select_all(action='DESELECT')
for o in result['objects'].values():o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(P/'generated/gun/round3/rebuild-verification.glb'),export_format='GLB',use_selection=True,export_yup=False,export_extras=True,export_animations=False)
