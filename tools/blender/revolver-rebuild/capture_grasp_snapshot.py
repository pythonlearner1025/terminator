"""Capture approved source-control matrices from saved opposition R1."""
import bpy,json,sys,hashlib
from pathlib import Path
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');controls={b.name:b.constraints[0].target for b in rig.pose.bones if b.name.startswith('R_')}
result={'sourceBlendSha256':hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),'approval':'Parent opposition-r1 visual baseline; hidden intersections documented','rightControlBasis':{n:[list(row) for row in o.matrix_basis] for n,o in controls.items()}}
Path(sys.argv[sys.argv.index('--')+1]).write_text(json.dumps(result,indent=2));print('APPROVED_R1_SNAPSHOT',len(controls))
