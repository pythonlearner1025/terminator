"""Extract exact UV charts from an already baked blend without rebaking images."""
import bpy,importlib.util
from pathlib import Path
P=Path(__file__).resolve().parent;bpy.ops.wm.open_mainfile(filepath=str(P/'generated/gun/gun.blend'))
s=importlib.util.spec_from_file_location('gun',P/'gun.py');gun=importlib.util.module_from_spec(s);s.loader.exec_module(gun)
gun.write_baked_uv_layout([o for o in bpy.data.collections['Rebuild'].all_objects if o.type=='MESH'],P/'generated/gun')
