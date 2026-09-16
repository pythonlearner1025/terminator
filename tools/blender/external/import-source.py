import bpy,sys
from pathlib import Path
root=Path.cwd();cache=root/'tools/blender/cache/external'
sys.path.insert(0,str(cache/'importer'))
import SourceIO
SourceIO.register()
path=cache/'kf2-revolver/[TFA] KF2 1858 Revolver/models/weapons/tfa_l4d2/c_1858.mdl'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.sourceio.mdl(filepath=str(path),files=[{'name':path.name}],directory=str(path.parent))
bpy.ops.wm.save_as_mainfile(filepath=str(cache/'kf2-import.blend'))
print('IMPORTED',[(o.name,o.type) for o in bpy.context.scene.objects])
