"""Isolate texture/normal faults at fixed camera without editing source builders."""
import sys,json,argparse
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import bpy,assemble
p=argparse.ArgumentParser();p.add_argument('--gun',required=True);p.add_argument('--hands',required=True);p.add_argument('--output',required=True);p.add_argument('--contract',default=None)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
rig=assemble.assemble(assemble.module(a.gun,'rebuild_gun'),assemble.module(a.hands,'rebuild_hands'),json.loads(Path(a.contract).read_text()) if a.contract else None)
assemble.render_sample(rig,'Idle',0,out/'all-maps.png',material=True)
materials=set(m for obj in rig['hands']['meshes'] for m in obj.data.materials)
for mat in materials:
    for node in mat.node_tree.nodes:
        if node.type=='BSDF_PRINCIPLED':
            for link in list(node.inputs['Normal'].links):mat.node_tree.links.remove(link)
assemble.render_sample(rig,'Idle',0,out/'no-normal-map.png',material=True)
for mat in materials:
    for node in mat.node_tree.nodes:
        if node.type=='BSDF_PRINCIPLED':
            for link in list(node.inputs['Base Color'].links):mat.node_tree.links.remove(link)
            node.inputs['Base Color'].default_value=(.18,.09,.055,1)
assemble.render_sample(rig,'Idle',0,out/'uniform-base-no-normal.png',material=True)
