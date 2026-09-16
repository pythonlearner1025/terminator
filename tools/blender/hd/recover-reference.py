"""Recover the two ignored KF2 references. Never use these files in derivatives."""
import bpy, sys, json, runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
CACHE=ROOT/'tools/blender/cache/external'
sys.path.insert(0,str(CACHE/'importer-old'))
from SourceIO.library.source1.vtf import load_texture
from SourceIO.library.utils import FileBuffer
folder=CACHE/'kf2-import-images'
folder.mkdir(exist_ok=True)
source=CACHE/'kf2-revolver/[TFA] KF2 1858 Revolver/materials/weapons/1858_pistol'
for role in ['d','n','g']:
    data,height,width=load_texture(FileBuffer(source/f'1858_{role}.vtf'))
    im=bpy.data.images.new('1858_'+role,width=width,height=height,alpha=True)
    im.pixels.foreach_set(data.ravel())
    im.filepath_raw=str(folder/f'1858_{role if role != "g" else "G"}.png')
    im.file_format='PNG';im.save()
configs=json.loads((ROOT/'tools/blender/external/candidates.json').read_text())
selected=[c for c in configs if c['id'] in ['kf2-aa12','kf2-1858-reference']]
# Reuse the existing conversion, restricted to the requested references.
# The map tool imports Pillow outside Blender, so write its selected input separately.
(ROOT/'.kite3d/hd-reference/configs.json').write_text(json.dumps(selected))
