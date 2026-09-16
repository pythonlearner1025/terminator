"""Restore immutable before inputs to ignored evidence storage from the base commit."""
import subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
OUT=HERE.parent/'generated/texture-paint/before';OUT.mkdir(parents=True,exist_ok=True)
BASE='d76440e427dbc87cdda469077017820429411804'
files={**{f'gun-{k}.png':f'tools/blender/revolver-rebuild/source-assets/gun/gun-{k}.png' for k in ['basecolor','normal','ao']},
       'source.blend':'tools/blender/revolver-rebuild/source/assembled/revolver-rebuild.blend',
       'revolver-rebuild.gltf':'assets/models/weapons/revolver-rebuild/revolver-rebuild.gltf'}
for name,path in files.items():
    data=subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT)
    dest=OUT/name
    if dest.exists():assert dest.read_bytes()==data,'Refusing to overwrite changed before evidence: '+name
    else:dest.write_bytes(data)
print('Before inputs verified against',BASE)
