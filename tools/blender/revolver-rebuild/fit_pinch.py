"""Fit one native pinch gesture after static grasp review; never bakes clips."""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Matrix,Vector
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import imported_hands as adapter
from assemble import module
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
gun=module(sys.argv[sys.argv.index('--')+1],'gun').build_gun();hands=adapter.build_hands({'anchors':gun['anchors']})
mapping=hands['mapping']['L'];controls=hands['controls'];rest=hands['fit_rest']
for digit in ('middle','ring','little'):
 for n,angle in zip(mapping[digit]['joints'],(50,60,25)):controls[n].matrix_basis=rest[n]@Matrix.Rotation(math.radians(-angle),4,'X')
bpy.context.view_layer.update();wrist=controls[mapping['wrist']['joint']].matrix_world.translation.copy();center=wrist+Vector((-.12,.040,.018))
# Keep a natural index crook; bring the thumb pad to the opposite side of the
# loader stem. This avoids forcing the index back into the palm for a guessed target.
for n,angle in zip(mapping['index']['joints'],(35,55,20)):controls[n].matrix_basis=rest[n]@Matrix.Rotation(math.radians(-angle),4,'X')
index=adapter.pad_center(hands,hands['pad_ids'][('L','index')]);target=index+Vector((0,-.012,0));digit='thumb';ids=hands['pad_ids'][('L','thumb')];names=mapping['thumb']['joints'];preferred=[25,45,15,0,0];limits=[(-30,65),(-20,90),(-20,60),(-25,25),(-25,25)]
def score(p):
 for i,n in enumerate(names):
  matrix=rest[n]@Matrix.Rotation(math.radians(-p[i]),4,'X')
  if i==0:matrix=matrix@Matrix.Rotation(math.radians(p[3]),4,'Y')@Matrix.Rotation(math.radians(p[4]),4,'Z')
  controls[n].matrix_basis=matrix
 point=adapter.pad_center(hands,ids);return (point-target).length_squared+sum((v-preferred[i])**2 for i,v in enumerate(p))*1e-10
best=None
for seed in [preferred,[0,20,20,15,-15],[40,30,0,-15,15]]:
 params=seed.copy()
 for step in (20,10,5,2,1,.5):
  for _ in range(5):
   changed=False
   for i in range(5):
    cost=score(params);value=params[i]
    for delta in (-step,step):
     test=params.copy();test[i]=max(limits[i][0],min(limits[i][1],value+delta));candidate=score(test)
     if candidate<cost:params=test;cost=candidate;changed=True
   if not changed:break
 cost=score(params)
 if best is None or cost<best[0]:best=(cost,params.copy())
score(best[1]);thumb=adapter.pad_center(hands,ids)
results={'index':{'parameters':[35,55,20,0,0],'pad':list(index)},'thumb':{'parameters':best[1],'pad':list(thumb)},'separationM':(thumb-index).length,'thumbTargetErrorM':(thumb-target).length}
keys=[n for digit in ('thumb','index','middle','ring','little') for n in mapping[digit]['joints']]
result={'controls':{n:[list(row) for row in controls[n].matrix_basis] for n in keys},'pads':results,'limits':'Numerical fit only; requires loader contact renders and shell checks.'}
(HERE/'generated/pinch-fit.json').write_text(json.dumps(result,indent=2));print(json.dumps(results))
