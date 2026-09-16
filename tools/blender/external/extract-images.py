import bpy,json
from pathlib import Path
root=Path.cwd()/'tools/blender/cache/external'
for name in ['plasma','detective']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 with bpy.data.libraries.load(str(root/(name+'.blend')),link=False) as (src,dst):dst.images=src.images
 folder=root/(name+'-images');folder.mkdir(exist_ok=True)
 for im in dst.images:
  if im and im.size[0] and im.packed_file:
   im.filepath_raw=str(folder/(Path(im.name).stem+'.png'));im.file_format='PNG';im.save();print(name,im.name,list(im.size))
name='kf2-import'
bpy.ops.wm.read_factory_settings(use_empty=True)
with bpy.data.libraries.load(str(root/(name+'.blend')),link=False) as (src,dst):dst.images=src.images
folder=root/(name+'-images');folder.mkdir(exist_ok=True)
for im in dst.images:
 if im and im.size[0]:
  im.filepath_raw=str(folder/(Path(im.name).name+'.png'));im.file_format='PNG';im.save();print(name,im.name,list(im.size))
