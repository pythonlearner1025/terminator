"""Two static views through actual viewModel camera; no animation bake."""
import sys,argparse
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import assemble,imported_hands
p=argparse.ArgumentParser();p.add_argument('--gun',required=True);p.add_argument('--output',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
rig=assemble.assemble(assemble.module(a.gun,'gun'),imported_hands)
for name in ('Idle','AimIdle'):assemble.render_sample(rig,name,0,out/(name+'.png'),material=True)
