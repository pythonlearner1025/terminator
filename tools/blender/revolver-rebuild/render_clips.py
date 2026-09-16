"""Bounded sequential 640x480 review captures; no browser or contact approval.
Wrapper -b -P render_clips.py -- --gun /.../gun.py --hands /.../hands.py --output /...
"""
import argparse,sys,json
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import assemble,animations
parser=argparse.ArgumentParser();parser.add_argument('--gun',required=True);parser.add_argument('--hands',default=str(HERE/'imported_hands.py'));parser.add_argument('--output',required=True);parser.add_argument('--contract',default=None);parser.add_argument('--material',action='store_true');parser.add_argument('--key-poses',action='store_true');parser.add_argument('--only',default='');parser.add_argument('--view',default='runtime')
a=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True)
rig=assemble.assemble(assemble.module(a.gun,'rebuild_gun'),assemble.module(a.hands,'rebuild_hands'),json.loads(Path(a.contract).read_text()) if a.contract else None)
manifest={'notes':'Runtime-equivalent hip/aim placement and 54 degree vertical FOV, 640x480 Workbench, no per-pose fitting. Diagnostic sequence; contact and deformation are under review.','actions':[]}
for clip,duration in animations.DURATIONS.items():
    if a.only and clip not in a.only.split(','):continue
    fractions=[0,.25,.5,.75,1] if clip not in animations.CONTACTS else sorted(set([0,1,*animations.CONTACTS[clip].values()]))
    if a.key_poses:fractions=sorted(set([0,*animations.CONTACTS.get(clip,{}).values(),1])) if clip=='Reload' else [.2 if clip=='Fire' else .5 if clip not in ('Idle','AimIdle') else 0]
    for index,fraction in enumerate(fractions):
        name=f'{clip}-{index:02d}.png';assemble.render_sample(rig,clip,fraction,out/name,view=a.view,material=a.material)
        phase=next((name for name,value in animations.CONTACTS.get(clip,{}).items() if value==fraction),'')
        manifest['actions'].append({'clip':clip,'seconds':round(fraction*duration,4),'phase':phase,'image':name,'note':'Unreviewed sequential capture'})
(out/'captures.json').write_text(json.dumps(manifest,indent=2))
print('CAPTURE_MANIFEST',out/'captures.json')
