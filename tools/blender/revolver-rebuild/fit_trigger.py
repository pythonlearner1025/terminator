"""Bounded native-control fitting against evaluated fingertip skin; no mesh edits."""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Matrix,Vector
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import imported_hands as h
from assemble import module
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
gun=module(sys.argv[sys.argv.index('--')+1],'gun').build_gun();hands=h.build_hands({'anchors':gun['anchors']})
ids=h.pad_indices(hands,'R','index');names=hands['mapping']['R']['index']['joints'];base=[hands['fit_rest'][n].copy() for n in names]
target=Vector(gun['anchors']['TriggerContact'])+Vector((.004,.002,0))
params=[5.,35.,20.,0.,0.];limits=[(-65,90),(0,115),(0,110),(-55,55),(-55,55)]
def score(p):
 for i,n in enumerate(names):
  mat=base[i]@Matrix.Rotation(math.radians(-p[i]),4,'X')
  if i==0:mat=mat@Matrix.Rotation(math.radians(p[3]),4,'Y')@Matrix.Rotation(math.radians(p[4]),4,'Z')
  hands['controls'][n].matrix_basis=mat
 center=h.pad_center(hands,ids);return (center-target).length_squared+sum((x/90)**2 for x in p)*.00000002
for step in (25,12,6,3,1,.5):
 for _ in range(5):
  changed=False
  for i in range(5):
   best=score(params);value=params[i]
   for delta in (-step,step):
    test=params.copy();test[i]=max(limits[i][0],min(limits[i][1],value+delta));cost=score(test)
    if cost<best:best=cost;params[i]=test[i];changed=True
  if not changed:break
score(params);out={'params':params,'ids':ids,'target':list(target),'pad':list(h.pad_center(hands,ids)),'distance':(h.pad_center(hands,ids)-target).length}
(HERE/'generated/trigger-fit.json').write_text(json.dumps(out,indent=2));print(json.dumps(out))
