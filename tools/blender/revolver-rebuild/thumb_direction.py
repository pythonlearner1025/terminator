"""Place native thumb flexion frame along frame side, preserving source scale."""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Matrix,Vector
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import imported_hands as h
from assemble import module
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
gun=module(sys.argv[sys.argv.index('--')+1],'gun').build_gun();hands=h.build_hands({'anchors':gun['anchors']})
names=hands['mapping']['R']['thumb']['joints'];ctrl=hands['controls'][names[0]]
for n in names:hands['controls'][n].matrix_basis=hands['fit_rest'][n]
bpy.context.view_layer.update();loc,q,scale=ctrl.matrix_world.decompose()
# Shortest swing of the native frame retains its recovered axial twist.
direction=hands['controls'][names[1]].matrix_world.translation-loc
q=direction.rotation_difference(Vector((.171,-.008,.024))-loc)
ctrl.matrix_world=Matrix.Translation(loc)@q.to_matrix().to_4x4()@Matrix.Translation(-loc)@ctrl.matrix_world
bpy.context.view_layer.update()
fit=json.loads((h.SOURCE/'grasp-fit.json').read_text());fit['R:thumb']['rootMatrix']=[list(row) for row in ctrl.matrix_basis];fit['R:thumb']['params']=[0,30,25,0,0]
(HERE/'generated/thumb-direction.json').write_text(json.dumps(fit,indent=2));print('thumb',list(ctrl.matrix_world.translation))
