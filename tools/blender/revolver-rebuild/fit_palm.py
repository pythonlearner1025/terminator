"""Bounded placement diagnosis in the approved opposition frame; no mesh edits."""
import bpy,sys,json
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import imported_hands as h
from assemble import module
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
gun=module(sys.argv[sys.argv.index('--')+1],'gun').build_gun();hands=h.build_hands({'anchors':gun['anchors']})
control=hands['controls'][hands['mapping']['R']['upper_arm']['joint']];original=control.matrix_world.copy();rows=[]
for delta in (-.030,-.024,-.018,-.012,-.006,0,.006):
 matrix=original.copy();matrix.translation.y+=delta;control.matrix_world=matrix;bpy.context.view_layer.update()
 report=h.contact_report(hands,list(gun['objects'].values()))['digits'];row={'deltaY':delta,'wristY':.012+delta,'regions':{n:report['R:'+n] for n in ('wrist','palm','thumb','index')}};rows.append(row)
 print(json.dumps({'dy':delta,**{n:round(row['regions'][n]['worstSignedM']*1000,2) for n in row['regions']}}),flush=True)
(HERE/'generated/palm-translation.json').write_text(json.dumps(rows,indent=2))
