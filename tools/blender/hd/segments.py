"""Audit complete circular sections in original and refined geometry, without rendering."""
import bpy,sys,json,math
from pathlib import Path
from collections import defaultdict
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(Path(__file__).parent))
from build import flatten
ROUND=int(sys.argv[sys.argv.index('--')+1])
report={}
for weapon,slug in [('shotgun','3dmodels-cc0'),('revolver','loafbrr-cc0')]:
    stages={}
    for stage in ['original','hd']:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        if stage=='original':
            bpy.ops.import_scene.gltf(filepath=str(ROOT/f'assets/models/weapons-candidates/{weapon}/{slug}/{slug}.gltf'))
            for o in bpy.context.scene.objects:
                if o.type=='MESH':flatten(o)
        else:bpy.ops.wm.open_mainfile(filepath=str(ROOT/f'.kite3d/hd/round-{ROUND}/{weapon}/geometry-source.blend'))
        parts=[]
        for o in bpy.context.scene.objects:
            if o.type!='MESH':continue
            lo=[min(v.co[i] for v in o.data.vertices) for i in range(3)]
            hi=[max(v.co[i] for v in o.data.vertices) for i in range(3)]
            centers=[((lo[1]+hi[1])/2,(lo[2]+hi[2])/2)]
            if weapon=='shotgun':centers += [(0,.09643965),(0,.1260905),(0,.0950215),(0,.098392),(0,.090905)]
            else:centers += [(0,.12742235),(0,.144415)]
            complete=[]
            for cy,cz in centers:
                rings=defaultdict(set)
                for v in o.data.vertices:
                    x,y,z=v.co;r=math.hypot(y-cy,z-cz)
                    rings[(round(x,5),round(r,5))].add(round(math.atan2(z-cz,y),5))
                for (x,r),angles in rings.items():
                    if len(angles)<8 or r<.001:continue
                    angles=sorted(angles)
                    gaps=[b-a for a,b in zip(angles,angles[1:])]+[angles[0]+2*math.pi-angles[-1]]
                    if max(gaps)>2*math.pi/len(angles)*1.25:continue
                    complete.append({'x':x,'radius':r,'segments':len(angles),'maxAngularGapDegrees':math.degrees(max(gaps))})
            if complete:
                unique={tuple(sorted(d.items())):d for d in complete}
                complete=list(unique.values())
                parts.append({'name':o.name,'completeRingSegmentCounts':sorted(set(r['segments'] for r in complete)),
                              'sections':complete})
        stages[stage]=parts
    report[weapon]=stages
path=ROOT/f'tools/blender/hd/rounds/segments-{ROUND}.json'
path.write_text(json.dumps(report,indent=2)+'\n')
print(path)
