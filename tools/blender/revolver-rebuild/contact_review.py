"""Two fixed diagnostic contact views; use only via approved Blender wrapper."""
import argparse,sys,json
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import assemble
p=argparse.ArgumentParser();p.add_argument('--gun',default=str(HERE/'gun.py'));p.add_argument('--hands',default=str(HERE/'imported_hands.py'));p.add_argument('--output',default=str(HERE/'generated/review/contacts'))
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
rig=assemble.assemble(assemble.module(a.gun,'rebuild_gun'),assemble.module(a.hands,'rebuild_hands'))
for view in ('left-contact','top-contact'):
    for t in (.1666666667,.67,.84,.96):assemble.render_sample(rig,'Reload',t,out/(view+'-'+str(round(t,3))+'.png'),view=view)
