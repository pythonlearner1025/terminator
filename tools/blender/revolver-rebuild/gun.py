"""Fresh, parameterized revolver geometry in authoring meters (front=-X, up=Z).
No source meshes are read by this builder. Run gun_review.py for reference comparison.
"""
import bpy, bmesh, math, json, hashlib
from mathutils import Vector, Matrix
from pathlib import Path
TAU=math.tau
ANCHORS={'GripCenter':[.126,0,-.036],'GripBackstrap':[.155,0,-.035],'TriggerContact':[.049,-.0035,.002],'SupportContact':[.111,.014,-.032],'CylinderCenter':[.0322,0,.05234],'Muzzle':[-.175,0,.0655],'Sight':[-.158,0,.087],'CranePivot':[0,-.003,.027],'HammerPivot':[.078,0,.050],'TriggerPivot':[.057,0,.022],'LatchPivot':[.078,-.018,.045]}

def material(name,color,metal,rough):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough; m.diffuse_color=(*color,1)
 return m

def build_gun(collection=None, use_baked_materials=True):
 coll=collection or bpy.data.collections.get('Rebuild')
 if coll is None: coll=bpy.data.collections.new('Rebuild'); bpy.context.scene.collection.children.link(coll)
 steel=material('Gun | brushed graphite steel',(.21,.24,.27),.88,.28)
 dark=material('Gun | dark controls',(.048,.06,.071),.82,.34)
 rubber=material('Gun | molded black rubber',(.012,.014,.016),0,.78)
 rubber.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.22
 wood=material('Gun | oiled walnut',(.024,.008,.003),0,.55)
 wood.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.25
 brass=material('Gun | case brass',(.42,.27,.085),.75,.3)
 # Subtle directional wood coloration, explicitly procedural (not called a bake).
 n=wood.node_tree.nodes; l=wood.node_tree.links; p=n.get('Principled BSDF')
 if not n.get('Walnut grain'):
  tex=n.new('ShaderNodeTexNoise'); tex.name='Walnut grain'; tex.inputs['Scale'].default_value=7; tex.inputs['Detail'].default_value=2
  coord=n.new('ShaderNodeTexCoord'); mapping=n.new('ShaderNodeVectorMath'); mapping.operation='MULTIPLY'; mapping.inputs[1].default_value=(35,2,2)
  ramp=n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color=(.008,.0025,.0012,1); ramp.color_ramp.elements[1].color=(.035,.013,.005,1)
  l.new(coord.outputs['Generated'],mapping.inputs[0]); l.new(mapping.outputs[0],tex.inputs['Vector']); l.new(tex.outputs['Fac'],ramp.inputs[0]); l.new(ramp.outputs[0],p.inputs['Base Color'])
 objects={}
 # Reserve API names without touching source geometry; rename reference-only objects.
 for old in list(bpy.data.collections.get('Reference').all_objects) if bpy.data.collections.get('Reference') else []:
  if not old.name.startswith('Reference::'):old.name='Reference::'+old.name
 def mesh(name,verts,faces,mat=steel,bevel=.0007,origin=(0,0,0)):
  bm=bmesh.new(); vs=[bm.verts.new(Vector(v)-Vector(origin)) for v in verts]; bm.verts.ensure_lookup_table()
  for f in faces:
   try: bm.faces.new([vs[i] for i in f])
   except ValueError: pass
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); me=bpy.data.meshes.new(name+' topology'); bm.to_mesh(me); bm.free()
  o=bpy.data.objects.new(name,me); coll.objects.link(o); o.location=origin; o.data.materials.append(mat); objects[name]=o
  o['new_geometry']=True; o['authoring_frame']='front -X, up Z, meters'
  if bevel:
   mod=o.modifiers.new('Controlled edge bevel','BEVEL'); mod.width=bevel; mod.segments=3; mod.limit_method='ANGLE'; mod.harden_normals=True
   bpy.context.view_layer.objects.active=o; o.select_set(True); bpy.ops.object.modifier_apply(modifier=mod.name); o.select_set(False)
  for p in me.polygons:p.use_smooth=len(p.vertices)<=4
  return o
 def profile(name,poly,y0,y1,mat=steel,bevel=.0007,origin=(0,0,0)):
  N=len(poly); vs=[(x,y,z) for y in [y0,y1] for x,z in poly]; fs=[tuple(range(N-1,-1,-1)),tuple(range(N,2*N))]+[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)]
  return mesh(name,vs,fs,mat,bevel,origin)
 def axial(name,x0,x1,y,z,r,mat=steel,N=48,inner=0,origin=(0,0,0),fluted=False):
  vs=[]; fs=[]
  def radius(a):
   # Six shallow scalloped channels between strong cylinder ribs.
   return r-.0019*max(0,math.cos(6*a))**4 if fluted else r
  rings=[(x0,r*.98),(x0+.0012,r),(x1-.0012,r),(x1,r*.98)]
  for x,rr in rings:
   for i in range(N):
    a=TAU*i/N; rad=radius(a)*rr/r; vs.append((x,y+rad*math.sin(a),z+rad*math.cos(a)))
  for j in range(3):
   for i in range(N): fs.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
  if inner:
   for x in [x0,x1]:
    for i in range(N):a=TAU*i/N;vs.append((x,y+inner*math.sin(a),z+inner*math.cos(a)))
   for i in range(N):
    k=(i+1)%N;fs.extend([(i,4*N+i,4*N+k,k),(3*N+i,3*N+k,5*N+k,5*N+i),(4*N+i,5*N+i,5*N+k,4*N+k)])
  else:fs.extend([tuple(range(N-1,-1,-1)),tuple(range(3*N,4*N))])
  return mesh(name,vs,fs,mat,0,origin)
 def join_into(base,parts):
  bpy.ops.object.select_all(action='DESELECT');base.select_set(True)
  for p in parts:p.select_set(True);objects.pop(p.name,None)
  bpy.context.view_layer.objects.active=base;bpy.ops.object.join();bpy.ops.object.select_all(action='DESELECT')
  return base
 def smooth_loop(poly, steps=6):
  result=[]
  for j,p1 in enumerate(poly):
   p0=Vector(poly[j-1]);p1=Vector(p1);p2=Vector(poly[(j+1)%len(poly)]);p3=Vector(poly[(j+2)%len(poly)])
   for k in range(steps):
    t=k/steps;v=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t);result.append(tuple(v))
  return result
 def rounded(poly,r=.002,steps=5):
  result=[]
  for i,p in enumerate(poly):
   p=Vector(p);prev=Vector(poly[i-1]);nxt=Vector(poly[(i+1)%len(poly)])
   a=p+(prev-p).normalized()*min(r,(prev-p).length*.3);b=p+(nxt-p).normalized()*min(r,(nxt-p).length*.3)
   for j in range(steps):
    t=j/(steps-1);result.append(tuple((1-t)**2*a+2*(1-t)*t*p+t*t*b))
  return result
 # Silhouette frame behind cylinder; top and lower bridges retain a true opening.
 body=profile('Body',rounded([(.060,.080),(.073,.083),(.086,.064),(.100,.056),(.127,.046),(.130,.027),(.139,.009),(.119,-.016),(.087,-.014),(.070,-.022),(.057,-.018),(.061,.020),(.073,.030),(.073,.065)],.004),-.0118,.0118,bevel=.0012)
 frame=profile('Frame',[(-.015,.0845),(.074,.0845),(.087,.066),(.079,.060),(.070,.077),(-.015,.077)],-.0107,.0107)
 lower=profile('FrameLower',rounded([(-.015,.033),(.004,.026),(.060,.026),(.076,.032),(.083,.014),(.071,.010),(.060,.015),(.035,.017),(.018,.012),(-.015,.012)],.002),-.0115,.0115,bevel=.0008)
 join_into(frame,[lower])
 # Rounded rear shield loft fades into the rear frame instead of a cylindrical slab.
 vs=[];N=48
 for x,r in [(.0605,.0216),(.062,.023),(.069,.0225),(.075,.019),(.080,.012)]:
  for i in range(N):a=i*TAU/N;vs.append((x,r*math.sin(a),.05234+r*math.cos(a)))
 fs=[tuple(range(N-1,-1,-1)),tuple(range(4*N,5*N))]+[(j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i) for j in range(4) for i in range(N)]
 shield=mesh('RecoilShield',vs,fs,steel,0);join_into(body,[shield])
 # Long shrouded barrel, open bore and crown.
 barrel=axial('Barrel',-.175,.004,0,.0655,.0155,N=48,inner=.0053)
 lug=profile('Underlug',[(-.175,.0595),(-.174,.0478),(-.016,.0478),(-.014,.030),(.003,.030),(.003,.0595)],-.0125,.0125,bevel=.0012)
 rib=profile('BarrelRib',[(-.175,.079),(-.175,.0845),(-.012,.0845),(-.005,.079)],-.0068,.0068,bevel=.00045)
 join_into(barrel,[lug,rib])
 profile('FrontSight',[(-.174,.0845),(-.174,.0897),(-.166,.0897),(-.156,.0845)],-.0025,.0025,dark,.0002)
 rear=profile('RearSight',[(.055,.0845),(.074,.0845),(.074,.089),(.061,.089)],-.006,.006,dark,.0003)
 # Rear notch is cut through with a small boolean, readable from first person.
 def cut(obj,cutter):
  bpy.context.view_layer.objects.active=obj;mod=obj.modifiers.new('Machined opening','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);objects.pop(cutter.name,None);bpy.data.objects.remove(cutter,do_unlink=True)
 cut(rear,profile('NotchCut',[(.060,.086),(.076,.086),(.076,.095),(.060,.095)],-.0017,.0017,bevel=0))
 cyl=axial('Cylinder',.0044,.060,0,.05234,.02582,N=96,origin=ANCHORS['CylinderCenter'],fluted=True)
 for i in range(6):
  a=i*TAU/6;y=.0142*math.sin(a);z=.05234+.0142*math.cos(a)
  cut(cyl,axial('ChamberCut',.002,.063,y,z,.0058,N=24))
  cart=axial('Cartridge%02d'%(i+1),.020,.0588,y,z,.0052,brass,N=20,origin=(.039,y,z));cart['role']='visual-cartridge';cart['suggested_parent']='Cylinder'
  rim=axial('CaseRim%02d'%i,.0583,.0601,y,z,.0056,brass,N=20)
  join_into(cart,[rim])
  # Dark primer accent (same dark controls material).
  primer=axial('Primer%02d'%i,.0601,.0603,y,z,.002,dark,N=12);join_into(cart,[primer])
 crane=profile('Crane',[(-.013,.020),(.005,.020),(.014,.038),(.018,.050),(.010,.054),(-.002,.040)],-.010,.003,steel,.0006,ANCHORS['CranePivot'])
 ejector=axial('Ejector',-.069,.0607,0,.05234,.0024,dark,N=20,origin=ANCHORS['CylinderCenter'])
 # Guard ribbon: outer and inner profiles form an actual aperture.
 outer=smooth_loop([(.010,.024),(.017,.008),(.023,-.010),(.031,-.019),(.046,-.0235),(.062,-.022),(.075,-.015),(.080,-.003),(.074,.015),(.063,.024)],8)
 inner=[]
 for i,p in enumerate(outer):
  tangent=(Vector(outer[(i+1)%len(outer)])-Vector(outer[i-1])).normalized();inner.append((p[0]-tangent.y*.0037,p[1]+tangent.x*.0037))
 vs=[(x,y,z) for y in [-.005,.005] for loop in [outer,inner] for x,z in loop];N=len(outer);fs=[]
 for i in range(N):
  k=(i+1)%N;fs.extend([(i,k,N+k,N+i),(2*N+i,3*N+i,3*N+k,2*N+k),(i,2*N+i,2*N+k,k),(N+i,N+k,3*N+k,3*N+i)])
 guard=mesh('TriggerGuard',vs,fs,steel,.00055)
 # Broad side strips are planar, only the edge fillets shade smoothly.
 for p in guard.data.polygons:
  if abs(p.normal.y)>.999:p.use_smooth=False
 trigger=smooth_loop([(.056,.023),(.061,.021),(.058,.009),(.056,.002),(.055,-.006),(.050,-.014),(.046,-.017),(.048,-.010),(.050,-.003),(.046,.005),(.043,.014)],5)
 profile('Trigger',trigger,-.0034,.0034,dark,.0005,ANCHORS['TriggerPivot'])
 profile('Hammer',[(.074,.046),(.080,.049),(.086,.062),(.098,.068),(.111,.074),(.112,.070),(.099,.062),(.089,.055),(.084,.045)],-.0035,.0035,dark,.0006,ANCHORS['HammerPivot'])
 profile('Latch',[(.071,.043),(.073,.052),(.086,.055),(.087,.047),(.079,.041)],-.017,-.012,dark,.00065,ANCHORS['LatchPivot'])
 # Ergonomic grip is a loft of oval sectional loops, with modest finger scallops.
 sections=[(.040,.109,.020,.009),(.025,.112,.023,.012),(.005,.120,.023,.0135),(-.013,.131,.026,.014),(-.026,.136,.025,.014),(-.033,.139,.023,.014),(-.042,.142,.025,.014),(-.048,.145,.023,.014),(-.059,.148,.026,.014),(-.077,.151,.026,.013),(-.083,.150,.026,.012),(-.086,.150,.0233,.0107),(-.088,.150,.0173,.008),(-.0892,.150,.0099,.0046),(-.0897,.150,.001,.0005)]
 # C1-continuous sampled loft; preserve measured anchor frame and main section bounds.
 def grip_section(z):
  j=next((i for i in range(len(sections)-1) if sections[i][0]>=z>=sections[i+1][0]),len(sections)-2)
  z=max(sections[-1][0],min(sections[0][0],z));t=(sections[j][0]-z)/(sections[j][0]-sections[j+1][0]);vals=[]
  for k in [1,2,3]:
   p0=sections[max(0,j-1)][k];p1=sections[j][k];p2=sections[j+1][k];p3=sections[min(len(sections)-1,j+2)][k]
   vals.append(.5*(2*p1+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
  return vals
 def grip_surface(z,a,offset=0):
  cx,rx,ry=grip_section(z);return (cx+(rx+offset)*math.cos(a),(ry+offset)*math.sin(a),z)
 zs=[]
 for j in range(len(sections)-1):
  for k in range(4):zs.append(sections[j][0]+(sections[j+1][0]-sections[j][0])*k/4)
 zs.append(sections[-1][0]);vs=[];N=48
 for z in zs:
  for i in range(N):vs.append(grip_surface(z,TAU*i/N))
 fs=[tuple(range(N-1,-1,-1)),tuple(range((len(zs)-1)*N,len(zs)*N))]
 for j in range(len(zs)-1):
  for i in range(N):fs.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
 grip=mesh('GripCore',vs,fs,rubber,0)
 # Conformal oval wood inlays with a raised center and shallow rolled perimeter.
 # Parameterized on the SAME surface used by GripCore; radial clearance is 0.18–0.65mm.
 for side,name in [(-1,'GripLeft'),(1,'GripRight')]:
  N=64;vs=[];fs=[];rings=[(.04,.00065),(.25,.00065),(.5,.00065),(.75,.00065),(.94,.00065),(.985,.00045),(1,.00018)]
  for r,offset in rings:
   for i in range(N):
    t=TAU*i/N;z=-.028+.047*r*math.cos(t);a=side*math.pi/2+.83*r*math.sin(t);vs.append(grip_surface(z,a,offset))
  fs.append(tuple(range(N-1,-1,-1)))
  for j in range(len(rings)-1):
   for i in range(N):fs.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
  # Return lip is seated above the rubber surface; the open hidden underside avoids overlap.
  panel=mesh(name,vs,fs,wood,0);panel['surface_fit']='same grip loft; radial offset 0.18–0.65mm';panel['perimeter_sections']=N
 # Visible sideplate seam and fasteners. Screw heads get physical slots.
 for j,(x,z) in enumerate([(.084,.028),(.101,.009),(.124,-.023)]):
  for side in [-1,1]:

   if j==2:
    cx,rx,ry=grip_section(z);y=side*(ry*math.sqrt(max(0,1-((x-cx)/rx)**2))+.00085)
   else:y=side*.0124
   # Cylinder primitive created by bmesh, orient local Z to Y.
   bm=bmesh.new();bmesh.ops.create_cone(bm,cap_ends=True,segments=16,radius1=.0025,radius2=.0025,depth=.0009,matrix=Matrix.Translation((x,y,z))@Matrix.Rotation(math.pi/2,4,'X'))
   me=bpy.data.meshes.new('Screw mesh');bm.to_mesh(me);bm.free();o=bpy.data.objects.new('Screw%d%s'%(j,'L' if side<0 else 'R'),me);coll.objects.link(o);o.data.materials.append(dark);objects[o.name]=o
   slot=profile('SlotCut',[(x-.0026,z-.00035),(x+.0026,z-.00035),(x+.0026,z+.00035),(x-.0026,z+.00035)],y-.0008,y+.0008,bevel=0);cut(o,slot)
 # Mark meaningful movable component axes for assembly without parenting yet.
 for name in ['Crane','Cylinder','Ejector','Hammer','Trigger','Latch']:
  objects[name]['articulation_axis']='Y' if name in ['Hammer','Trigger'] else 'X'
  objects[name]['pivot_authoring']=list(objects[name].location)
 cleanup_bevel_slivers(list(objects.values()))
 prepare_uvs(list(objects.values()))
 if use_baked_materials: apply_baked_materials(list(objects.values()))
 return {'objects':objects,'anchors':dict(ANCHORS),'metadata':{'author':'fresh sectional/bmesh construction','frame':'meters X front negative, Z up','reference_geometry_reused':False,'materials':5,'uv':'angle seam unwrap, globally packed fixed 0.01 UV margin','cartridges':6}}

def cleanup_bevel_slivers(objects):
 """Remove sub-float32 bevel residues before UVs; never touch the frozen grip loft.
 0.1 micrometer weld radius is < one millionth of the 350mm asset length.
 Keep existing coordinates and origins; this removes coincident corner slivers.
 """
 for o in objects:
  if o.name in {'GripCore','GripLeft','GripRight'}:continue
  bm=bmesh.new();bm.from_mesh(o.data)
  bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
  bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=1e-8)
  bm.normal_update();bm.to_mesh(o.data);bm.free();o.data.update()

def prepare_uvs(objects):
 """Angle seams plus axial cuts, angle-based unwrap and globally padded atlas."""
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:
  o.select_set(True);bpy.context.view_layer.objects.active=o
  bm=bmesh.new();bm.from_mesh(o.data)
  for e in bm.edges:
   angle=e.calc_face_angle(0);e.seam=not e.is_manifold or angle>math.radians(40) or (abs(e.verts[0].co.y)<1e-5 and abs(e.verts[1].co.y)<1e-5);e.smooth=angle<math.radians(40)
  bm.to_mesh(o.data);bm.free()
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.unwrap(method='ANGLE_BASED',margin=.008);bpy.ops.uv.average_islands_scale();bpy.ops.uv.pack_islands(rotate=True,margin_method='FRACTION',margin=.01);bpy.ops.object.mode_set(mode='OBJECT')
 repair_collapsed_uv_faces(objects)

def repair_collapsed_uv_faces(objects):
 """Project only failed charts, preserving geometry and float32-safe UV area.
 The export gate is |2*UV area| >=1e-12. Repair uses a tenfold guard band.
 """
 for attempt in range(4):
  bad=[]
  for o in objects:
   o.data.calc_loop_triangles();uv=o.data.uv_layers.active.data;faces=set()
   for t in o.data.loop_triangles:
    a,b,c=[Vector((uv[i].uv.x,1-uv[i].uv.y)) for i in t.loops]
    if abs((b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y))<1e-11:faces.add(t.polygon_index)
   for pi in sorted(faces):bad.append((o,pi))
  if not bad:return
  for o,pi in bad:
   p=o.data.polygons[pi];uv=o.data.uv_layers.active.data
   # Dominant-axis projection gives the largest planar area and cannot flatten
   # a planar face that has nonzero 3D area, unlike a failed chart solve.
   drop=max(range(3),key=lambda k:abs(p.normal[k]));axes=[k for k in range(3) if k!=drop]
   for li in p.loop_indices:
    co=o.data.vertices[o.data.loops[li].vertex_index].co;uv[li].uv=(co[axes[0]],co[axes[1]])
    o.data.edges[o.data.loops[li].edge_index].use_seam=True
   o['uv_repaired_faces']=int(o.get('uv_repaired_faces',0))+1
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.average_islands_scale();bpy.ops.uv.pack_islands(rotate=True,margin_method='FRACTION',margin=.01);bpy.ops.object.mode_set(mode='OBJECT')
 raise RuntimeError('UV repair did not converge; refusing invalid atlas')

def geometry_signature(o):
 data=([list(v.co) for v in o.data.vertices],[list(p.vertices) for p in o.data.polygons])
 return hashlib.sha256(json.dumps(data,separators=(',',':')).encode()).hexdigest()

def write_baked_uv_layout(objects,directory):
 """Persist exact baked charts: Blender island packing can differ between scenes."""
 data={o.name:{'geometry':geometry_signature(o),'uv':[list(v.uv) for v in o.data.uv_layers.active.data]} for o in objects}
 (Path(directory)/'gun-uv-layout.json').write_text(json.dumps(data,separators=(',',':'))+'\n')

def apply_baked_materials(objects, directory=None):
 """Attach final real baked atlas, if provided by the artifact packaging stage."""
 path=Path(directory) if directory else Path(__file__).resolve().parent/'source-assets/gun'
 if not all((path/f'gun-{kind}.png').exists() for kind in ['basecolor','normal','ao']):return False
 layout_path=path/'gun-uv-layout.json'
 if not layout_path.exists():return False
 layout=json.loads(layout_path.read_text())
 for o in objects:
  saved=layout.get(o.name)
  if not saved or saved['geometry']!=geometry_signature(o):raise RuntimeError('Baked UV topology mismatch for '+o.name)
 for o in objects:
  for loop,co in zip(o.data.uv_layers.active.data,layout[o.name]['uv']):loop.uv=co
  o['baked_uv_layout_restored']=True

 attach_baked_texture_nodes({m for o in objects for m in o.data.materials},path)
 return True

def attach_baked_texture_nodes(materials,directory):
 """Attach texture finish without touching geometry, UVs, rig or animation.
 ORM stores absolute AO/roughness/metallic, so no scalar roughness multiplier.
 Original geometry AO remains an independent, unchanged source file.
 """
 path=Path(directory)
 packed=(path/'gun-orm.png').exists()
 kinds=['basecolor','normal','orm' if packed else 'ao']
 # A packed image can already have this filepath while retaining yesterday's pixels.
 # Load fresh datablocks so source texture revisions cannot silently use stale packs.
 images={kind:bpy.data.images.load(str(path/f'gun-{kind}.png'),check_existing=False) for kind in kinds}
 for kind,img in images.items():img.colorspace_settings.name='sRGB' if kind=='basecolor' else 'Non-Color';img.pack()
 group=bpy.data.node_groups.get('glTF Material Output')
 if not group:
  group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
 for m in materials:
  n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
  for old in list(n):
   if old.type in {'TEX_IMAGE','NORMAL_MAP','SEPRGB'} or old.name.startswith('Gun finish') or (old.type=='GROUP' and old.node_tree==group):n.remove(old)
  tex=n.new('ShaderNodeTexImage');tex.name='Gun finish basecolor';tex.image=images['basecolor'];tex.location=(-650,300);l.new(tex.outputs['Color'],p.inputs['Base Color'])
  tex=n.new('ShaderNodeTexImage');tex.name='Gun finish baked normal';tex.image=images['normal'];tex.location=(-650,-200);normal=n.new('ShaderNodeNormalMap');normal.location=(-340,-180);l.new(tex.outputs['Color'],normal.inputs['Color']);l.new(normal.outputs['Normal'],p.inputs['Normal'])
  tex=n.new('ShaderNodeTexImage');tex.name='Gun finish ORM' if packed else 'Gun finish AO';tex.image=images['orm' if packed else 'ao'];tex.location=(-650,30)
  g=n.new('ShaderNodeGroup');g.node_tree=group;g.location=(-50,-250)
  if packed:
   separate=n.new('ShaderNodeSeparateColor');separate.name='Gun finish ORM channels';separate.mode='RGB';separate.location=(-330,30);l.new(tex.outputs['Color'],separate.inputs['Color'])
   l.new(separate.outputs['Red'],g.inputs['Occlusion']);l.new(separate.outputs['Green'],p.inputs['Roughness']);l.new(separate.outputs['Blue'],p.inputs['Metallic'])
   p.inputs['Roughness'].default_value=1;p.inputs['Metallic'].default_value=1
  else:l.new(tex.outputs['Color'],g.inputs['Occlusion'])
 return True
