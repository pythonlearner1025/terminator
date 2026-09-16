import bpy, importlib.util, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
s=importlib.util.spec_from_file_location('workstation',ROOT/'tools/blender/rebuild-workspace/workstation.py'); w=importlib.util.module_from_spec(s); s.loader.exec_module(w)
out=Path(__file__).resolve().parent/'generated/gun'
w.setup(out/'reference.blend')
parts={o.name: w.bounds([o]) for o in bpy.data.collections['Reference'].all_objects if o.type=='MESH'}
(out/'reference-parts.json').write_text(json.dumps(parts,indent=2))
for view in ['left','top','front','rear','threequarter_left']:
 w.capture_pair(out/'reference',view,'clay')
