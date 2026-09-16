"""Fresh-process native-skin/source/baked-action proof. Run with saved .blend.
All Blender calls must use coordination/revolver-blender. No visual approval claim.
"""
import bpy,sys,json,hashlib,math
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import imported_hands as adapter
source=json.loads((adapter.SOURCE/'rig-report.json').read_text());ob=bpy.data.objects['DJMaesenArms'];arm=next(m.object for m in ob.modifiers if m.type=='ARMATURE');scene=bpy.context.scene
controls={b.name:b.constraints[0].target for b in arm.pose.bones};failures=[]
def check(value,message):
 if not value:failures.append(message)
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
weights=[[(ob.vertex_groups[g.group].name,g.weight) for g in v.groups] for v in ob.data.vertices]
uv={layer.name:[list(loop.uv) for loop in layer.data] for layer in ob.data.uv_layers}
fingerprints={'geometry_sha256':digest({'vertices':[list(v.co) for v in ob.data.vertices],'polygons':[list(p.vertices) for p in ob.data.polygons]}),'weights_sha256':digest(weights),'uv_sha256':digest(uv)}
original=source['inventory']['meshes'][0]
for key,value in fingerprints.items():check(value==original[key],'Source drift: '+key)
check(len(controls)==49,'Native 49-joint control rig missing')
check(len(ob.data.vertices)==4246,'Artist vertex count drift')
check(sum(len(p.vertices)-2 for p in ob.data.polygons)==7240,'Artist triangle count drift')
check(not any(o.name in ('HandMeshLeft','HandMeshRight','HandsRig') for o in scene.objects),'Retired handmade skin present')
for b in arm.pose.bones:
 c=b.constraints[0];check(c.type=='COPY_TRANSFORMS' and c.owner_space==c.target_space=='WORLD' and c.target and not c.mute,'Source driver not live: '+b.name)
for m in ob.modifiers:
 if m.type=='ARMATURE':check(not m.use_deform_preserve_volume,'Manual LBS verifier requires original linear skinning')

def activate(name,frame):
 for obj in scene.objects:
  if obj.animation_data:
   obj.animation_data.action=None
   for track in obj.animation_data.nla_tracks:track.mute=track.name!=name
 scene.frame_set(int(frame),subframe=frame%1);bpy.context.view_layer.update()

def skin_error():
 deps=bpy.context.evaluated_depsgraph_get();ev=ob.evaluated_get(deps);mesh=ev.to_mesh();mx=arm.matrix_world;bind=mx.inverted()@ob.matrix_world
 matrices={b.name:mx@b.matrix@b.bone.matrix_local.inverted()@bind for b in arm.pose.bones};maximum=0
 for v in ob.data.vertices:
  p=sum((matrices[name]@v.co*w for name,w in weights[v.index]),Vector())
  maximum=max(maximum,(p-ev.matrix_world@mesh.vertices[v.index].co).length)
 ev.to_mesh_clear();return maximum

hands={'armature':arm,'meshes':[ob],'controls':controls,'mapping':source['control_mapping']}
gun=[o for o in bpy.data.collections['Rebuild'].objects if o.type=='MESH' and o!=ob and not o.name.startswith(('Fresh','Case','Speedloader'))]
from animations import DURATIONS
samples={}
for clip,duration in DURATIONS.items():
 fractions=[0,.10,.20,.24,.34,.48,.59,.67,.78,.84,.92,1] if clip=='Reload' else [0,.15625,.35,1] if clip=='Fire' else [0,.5,1]
 rows=[]
 for fraction in fractions:
  activate(clip,duration*60*fraction);error=skin_error();check(error<.00002,f'Native evaluated skin mismatch {clip}@{fraction}: {error}')
  row={'fraction':fraction,'manualSkinMaxErrorM':error}
  if clip in ('Idle','Fire','Reload'):
   row['gunContacts']=adapter.contact_report(hands,gun);row['bilateral']=adapter.bilateral_report(hands)
  rows.append(row)
 samples[clip]=rows
activate('Idle',0)
report={'fingerprints':fingerprints,'sourceVertices':4246,'sourceTriangles':7240,'sourceBones':49,'samples':samples,'failures':failures,'limits':['Ray parity on open gun components and sleeve cuffs is diagnostic.','Finite sampled instants do not certify all-time triangle collision or visual quality.','Browser proof belongs to QA after frozen manifest.']}
output=Path(sys.argv[sys.argv.index('--')+1]);output.write_text(json.dumps(report,indent=2));print('IMPORTED_REOPEN',output,'failures',failures)
if failures:raise RuntimeError('; '.join(failures))
