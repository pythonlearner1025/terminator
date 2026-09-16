"""Convert downloaded display candidates with original mesh names and no decimation."""
import bpy,sys,json,math,bmesh
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parents[3];CACHE=ROOT/'tools/blender/cache/external'
args=sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else []
configs=json.loads((ROOT/'tools/blender/external/candidates.json').read_text())
def bounds(objects):
 pts=[o.matrix_world@Vector(v)for o in objects for v in o.bound_box]
 return Vector([min(v[i]for v in pts)for i in range(3)]),Vector([max(v[i]for v in pts)for i in range(3)])
def convert(c):
 bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;path=CACHE/c['file']
 if path.suffix=='.blend':
  with bpy.data.libraries.load(str(path),link=False)as(src,dst):dst.objects=src.objects
  for o in dst.objects:
   if o:scene.collection.objects.link(o)
 elif path.suffix.lower()=='.fbx':bpy.ops.import_scene.fbx(filepath=str(path))
 else:bpy.ops.import_scene.gltf(filepath=str(path))
 scene.frame_set(1)
 if c.get('restPose'):
  for o in scene.objects:
   if o.type=='ARMATURE':o.data.pose_position='REST'
 bpy.context.view_layer.update()
 source=[o for o in scene.objects if o.type=='MESH' and ('keep'not in c or o.name in c['keep'])]
 # Freeze the supplied bind pose. Preserve each source mesh name and material slot assignment.
 deps=bpy.context.evaluated_depsgraph_get();meshes=[]
 for o in source:
  evaluated=o.evaluated_get(deps);data=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=deps)
  name=o.name;o.name=name+'__source';n=bpy.data.objects.new(name,data);scene.collection.objects.link(n);n.matrix_world=o.matrix_world.copy();meshes.append(n)
 for o in meshes:
  offset=c.get('partOffsets',{}).get(o.name)
  if offset:o.matrix_world.translation+=Vector(offset)
  if 'removeSpareBelowSourceX' in c:
   bm=bmesh.new();bm.from_mesh(o.data)
   unused=[v for v in bm.verts if (o.matrix_world@v.co).x<c['removeSpareBelowSourceX']]
   bmesh.ops.delete(bm,geom=unused,context='VERTS');bm.to_mesh(o.data);bm.free();o.data.update()
 for o in list(scene.objects):
  if o not in meshes:bpy.data.objects.remove(o,do_unlink=True)
 lo,hi=bounds(meshes);extent=hi-lo
 rotation=Matrix.Identity(4)
 if not c.get('vertical'):
  axis=max(range(3),key=lambda i:extent[i])
  if axis==1:rotation=Matrix.Rotation(math.pi/2,4,'Z')
  elif axis==2:rotation=Matrix.Rotation(-math.pi/2,4,'Y')
 for o in meshes:o.matrix_world=rotation@o.matrix_world
 bpy.context.view_layer.update();lo,hi=bounds(meshes)
 lower=[o.matrix_world@v.co for o in meshes for v in o.data.vertices if (o.matrix_world@v.co).z<lo.z+(hi.z-lo.z)*.24]
 grip=sum(lower,Vector())/len(lower)if lower else(lo+hi)/2
 if not c.get('vertical') and grip.x<(lo.x+hi.x)/2:
  rotation=Matrix.Rotation(math.pi,4,'Z')
  for o in meshes:o.matrix_world=rotation@o.matrix_world
  grip=rotation@grip
 bpy.context.view_layer.update();lo,hi=bounds(meshes)
 if c.get('roll'):
  r=Matrix.Rotation(math.radians(c['roll']),4,'X')
  for o in meshes:o.matrix_world=r@o.matrix_world
  grip=r@grip
 if c.get('reverse'):
  r=Matrix.Rotation(math.pi,4,'Z')
  for o in meshes:o.matrix_world=r@o.matrix_world
  grip=r@grip
 bpy.context.view_layer.update();lo,hi=bounds(meshes)
 scale=c['length']/max(hi-lo)
 # Grip estimates are display pivots, not animation pivots. Per-source overrides are normalized bounds coordinates.
 f=c.get('gripFraction')
 if f:grip=lo+Vector([(hi[i]-lo[i])*f[i]for i in range(3)])
 if c.get('vertical'):grip=(lo+hi)/2
 transform=Matrix.Scale(scale,4)@Matrix.Translation(-grip)
 for o in meshes:
  o.data.transform(transform@o.matrix_world);o.matrix_world=Matrix.Identity(4)
  o.data.update()
 output=ROOT/('assets/models/weapons-candidates'if c['shippable']else'assets/reference/weapons')/c['weapon']/c['id'];output.mkdir(parents=True,exist_ok=True)
 cache={}
 def material(name):
  prefix=name.lower().replace(' ','-')if name in c.get('materials',{})else'main'
  if prefix in cache:return cache[prefix]
  m=bpy.data.materials.new('Candidate '+c['weapon']+' '+c['id']+' '+prefix);m.use_nodes=True;nodes=m.node_tree.nodes;nodes.clear();links=m.node_tree.links
  out=nodes.new('ShaderNodeOutputMaterial');p=nodes.new('ShaderNodeBsdfPrincipled');links.new(p.outputs['BSDF'],out.inputs['Surface'])
  for role in ['albedo','normal','orm']:
   tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(output/f'{prefix}-{role}.png'),check_existing=True)
   tex.image.colorspace_settings.name='sRGB'if role=='albedo'else'Non-Color'
   if role=='albedo':links.new(tex.outputs['Color'],p.inputs['Base Color'])
   elif role=='normal':
    normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=c.get('normalStrength',1);links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],p.inputs['Normal'])
   else:
    sep=nodes.new('ShaderNodeSeparateColor');links.new(tex.outputs['Color'],sep.inputs['Color']);links.new(sep.outputs['Green'],p.inputs['Roughness']);links.new(sep.outputs['Blue'],p.inputs['Metallic'])
  cache[prefix]=m;return m
 for o in meshes:
  names=[m.name if m else''for m in o.data.materials]
  if names:
   for i,n in enumerate(names):o.data.materials[i]=material(n)
  else:o.data.materials.append(material('main'))
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  mod=o.modifiers.new('Triangulate source faces','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=mod.name)
  o.select_set(False)
 display=bpy.data.objects.new(c['id']+' display',None);scene.collection.objects.link(display)
 for o in meshes:o.parent=display
 bpy.ops.object.select_all(action='SELECT')
 gltf=output/(c['id']+'.gltf')
 bpy.ops.export_scene.gltf(filepath=str(gltf),export_format='GLTF_SEPARATE',export_yup=True,export_animations=False,export_apply=True,export_extras=True,export_image_format='AUTO',export_materials='EXPORT',use_selection=True)
 # Explicitly bind AO to the same ORM image. The Blender exporter only wires metallic and roughness above.
 doc=json.loads(gltf.read_text())
 for mat in doc.get('materials',[]):
  orm=mat.get('pbrMetallicRoughness',{}).get('metallicRoughnessTexture')
  if orm:mat['occlusionTexture']={**orm,'strength':1}
 gltf.write_text(json.dumps(doc,indent=2)+'\n')
 report=json.loads((output/'conversion.json').read_text());lo,hi=bounds(meshes)
 report.update(triangles=sum(len(o.data.polygons)for o in meshes),sourceMeshNames=[o.name for o in meshes],boundsMetres=[list(lo),list(hi)],lengthMetres=c['length'],pivot='Estimated grip center; static display candidate',decimation=False,removedDetachedSpareProp='removeSpareBelowSourceX'in c,partOffsets=c.get('partOffsets',{}))
 (output/'conversion.json').write_text(json.dumps(report,indent=2)+'\n')
 print('CONVERTED',c['weapon'],c['id'],report['triangles'],flush=True)
for c in configs:
 if not args or c['id']in args:convert(c)
