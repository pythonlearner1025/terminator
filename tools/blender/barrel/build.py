"""Headless, deterministic Barrel 03 adaptation. Blender 5.2.1, no Python packages.
Run: blender -b --factory-startup -P tools/blender/barrel/build.py
The cache is downloaded with pinned hashes. Output is a single indexed glTF mesh.
"""
import bpy, bmesh, numpy as np, math, json, struct, zlib, hashlib, subprocess, sys
from pathlib import Path
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[3]
CACHE = ROOT / 'tools/blender/cache/barrel_03'
SLUG = 'barrel-0p8x1p3x0p8-103qszk'
OUT = ROOT / 'assets/models/map' / SLUG
ROUND = int(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else 4
FILES = {
 'barrel_03_2k.gltf': ('gltf/2k/barrel_03/barrel_03_2k.gltf', '3c6310f987fe74bc5e7ee3034bb78202'),
 'barrel_03.bin': ('gltf/4k/barrel_03/barrel_03.bin','6993587e3ef8e0603334e615ab292288'),
 'textures/barrel_03_diff_2k.jpg': ('jpg/2k/barrel_03/barrel_03_diff_2k.jpg','104d275bb47c4a7b7611542e0b7fa19f'),
 'textures/barrel_03_nor_gl_2k.jpg': ('jpg/2k/barrel_03/barrel_03_nor_gl_2k.jpg','6bbcfb8aab6d545bc47f50a548ea89b7'),
 'textures/barrel_03_arm_2k.jpg': ('jpg/2k/barrel_03/barrel_03_arm_2k.jpg','f3084746caec40afbdf0ba1e25e0c0d5'),
}
for name,(url,digest) in FILES.items():
 p=CACHE/name; p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists(): subprocess.run(['curl','-L','--fail','--silent','--show-error','https://dl.polyhaven.org/file/ph-assets/Models/'+url,'-o',str(p)],check=True)
 if hashlib.md5(p.read_bytes()).hexdigest()!=digest: raise RuntimeError('Source hash mismatch: '+name)
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(CACHE/'barrel_03_2k.gltf'))
source=next(o for o in bpy.context.scene.objects if o.type=='MESH')

# Rasterize the scan's cylindrical surface to one atlas. This preserves photo paint and wear.
S=1024
u,v=np.meshgrid((np.arange(S)+.5)/S,(np.arange(S)+.5)/S)
theta=u*2*math.pi
h=np.clip((v-.255)/.735,0,1)
source_uv=np.zeros((S,S,2),np.float32)
covered=np.zeros((S,S),bool)
mesh=source.data; uv=mesh.uv_layers.active.data
for face in mesh.polygons:
 pts=np.array([mesh.vertices[i].co[:] for i in face.vertices])
 if len(pts)!=3 or np.min(np.linalg.norm(pts[:,:2],axis=1))<.285: continue
 tt=np.arctan2(pts[:,1],pts[:,0])/(2*np.pi)%1
 if tt.max()-tt.min()>.5: tt[tt<.5]+=1
 hh=pts[:,2]/.9304735
 tri=np.stack([tt,hh],axis=1); tex=np.array([uv[i].uv[:] for i in face.loop_indices])
 for shift in (0,-1):
  a,b,c=tri+np.array([shift,0]); det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
  if abs(det)<1e-8: continue
  x0=max(0,int(min(a[0],b[0],c[0])*S)-1);x1=min(S,int(max(a[0],b[0],c[0])*S)+2)
  y0=max(0,int((min(a[1],b[1],c[1])*.735+.255)*S)-1);y1=min(S,int((max(a[1],b[1],c[1])*.735+.255)*S)+2)
  if x1<=x0 or y1<=y0:continue
  x=u[y0:y1,x0:x1];y=h[y0:y1,x0:x1]
  w0=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det
  w1=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det
  w2=1-w0-w1;mask=(w0>=-1e-4)&(w1>=-1e-4)&(w2>=-1e-4)
  target=source_uv[y0:y1,x0:x1];target[mask]=(w0[:,:,None]*tex[0]+w1[:,:,None]*tex[1]+w2[:,:,None]*tex[2])[mask]
  covered[y0:y1,x0:x1]|=mask
# Extend edge pixels for mip padding and scan's rim gaps.
for _ in range(28):
 for axis,d in ((0,1),(0,-1),(1,1),(1,-1)):
  use=(~covered)&np.roll(covered,d,axis);source_uv[use]=np.roll(source_uv,d,axis)[use];covered[use]=True

def read_pixels(path):
 im=bpy.data.images.load(str(path),check_existing=False);im.colorspace_settings.name='Non-Color'
 a=np.empty(im.size[0]*im.size[1]*4,np.float32);im.pixels.foreach_get(a)
 return a.reshape(im.size[1],im.size[0],4)[:,:,:3]
def sample(a,coords):
 y=np.clip((coords[:,:,1]*a.shape[0]).astype(int),0,a.shape[0]-1)
 x=np.clip((coords[:,:,0]*a.shape[1]).astype(int),0,a.shape[1]-1)
 return a[y,x]
paint=sample(read_pixels(CACHE/'textures/barrel_03_diff_2k.jpg'),source_uv)
scan_normal=sample(read_pixels(CACHE/'textures/barrel_03_nor_gl_2k.jpg'),source_uv)
scan_orm=sample(read_pixels(CACHE/'textures/barrel_03_arm_2k.jpg'),source_uv)
rust=read_pixels(ROOT/'assets/textures/map/rusty_metal_02_diff_1k.jpg')
# Match measured rust-wall median sRGB [69,34,23], preserving the CC0 material's spatial detail.
rust=sample(rust,np.stack([u,(h*.65)%1],axis=2))
rust*=np.array([69,34,23])/255/np.maximum(np.median(rust.reshape(-1,3),axis=0),.01)
seed=np.random.default_rng(20290912)
def noise(scale):
 # Smooth periodic value noise, stable across builds and circumference seams.
 a=seed.random((scale,scale)).astype(np.float32)
 x=u*scale;y=v*scale;ix=x.astype(int);iy=y.astype(int);fx=x-ix;fy=y-iy
 fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
 return (a[iy%scale,ix%scale]*(1-fx)+a[iy%scale,(ix+1)%scale]*fx)*(1-fy)+(a[(iy+1)%scale,ix%scale]*(1-fx)+a[(iy+1)%scale,(ix+1)%scale]*fx)*fy
macro=noise(11)*.35+noise(39)*.35+noise(117)*.3
fine=noise(270)
rustmask=np.clip((macro-.37)*8,.35,1)
soot=np.clip(.25+(h-.45)*1.15+(macro-.5)*1.5,0,.92)
paint=paint*.20+np.mean(paint,axis=2)[:,:,None]*.24
albedo=paint*(1-rustmask[:,:,None])+rust*rustmask[:,:,None]
albedo=albedo*(1-soot[:,:,None])+np.array([34,33,39])/255*soot[:,:,None]*(.5+fine[:,:,None]*.5)
rough=np.clip(scan_orm[:,:,1]*.5+.35+rustmask*.25+soot*.12,.36,.98)
metal=(1-rustmask)*(1-soot)*.20
occlusion=np.clip(scan_orm[:,:,0],.62,1)
# Baked edge abrasion, weld, pits, and narrow vertical runoff.
edge=sum(np.exp(-((h-a)/b)**2) for a,b in [(0.02,.004),(.347,.004),(.669,.004),(.985,.005)])
wear=np.clip(edge*(fine>.50)*(.45+macro),0,.85)
albedo=albedo*(1-wear[:,:,None])+np.array([.37,.36,.34])*wear[:,:,None]
metal=np.maximum(metal,wear*.95);rough=rough*(1-wear)+.39*wear
seam=np.exp(-((u-.83)/.0018)**2)*(h>.025)*(h<.98)
albedo*=1-seam[:,:,None]*.26
height=(fine-.5)*.00014+rustmask*.00045+seam*.0007*(.7+.3*np.sin(h*930))
# Bare metal scuffs around the two geometric impacts, with chipped rather than uniform edges.
for angle,hh,rad in [(5.3,.48,.015),(4.9,.80,.021)]:
 du=(u-angle/math.tau+.5)%1-.5
 distance=np.sqrt((du*2.30)**2+((h-hh)*1.262)**2)
 chip=np.clip((rad*1.9-distance)/(rad*.65),0,1)*(distance>rad*.95)*(fine>.31)
 albedo=albedo*(1-chip[:,:,None]*.55)+np.array([.24,.215,.18])*chip[:,:,None]*.55
 metal=np.maximum(metal,chip*.8);rough=rough*(1-chip*.5)+chip*.2
 height+=chip*.0006
# Painted soot inner wall uses a separate lower atlas strip. One material covers all surfaces.
inner=(u<.745)&(v<.245)
albedo[inner]=(np.array([34,33,39])/255*(.38+.40*macro[inner,None]))
rough[inner]=.98;metal[inner]=0;occlusion[inner]=.65
# Square planar coal island. Voronoi seams follow irregular coal fragments.
floor=(u>=.745)&(v<.245)
fx=(u-.75)/.25+.016*np.sin(v*620+u*39);fy=v/.245+.012*np.sin(u*713+v*73)
nearest=np.full_like(u,100.);second=np.full_like(u,100.)
for cx,cy in seed.random((110,2)):
 dist=(fx-cx)**2+(fy-cy)**2
 second=np.minimum(second,np.maximum(nearest,dist));nearest=np.minimum(nearest,dist)
crack=(second-nearest<.00025+fine*.00018)
coal=np.array([.09,.08,.075])*(.45+macro[:,:,None]+fine[:,:,None]*.3)
albedo[floor]=coal[floor];rough[floor]=.97;metal[floor]=0;occlusion[floor]=.72
emissive=np.zeros_like(albedo)
pocket=np.exp(-((fx-.42)**2+(fy-.6)**2)*8)
emissive[floor]=np.array([.18,.013,.0015])*pocket[floor,None]*(.35+fine[floor,None])
emissive[floor&crack]=np.array([1,.09,.008])*(.3+macro[floor&crack,None]*.7)*np.exp(-((fx[floor&crack,None]-.42)**2+(fy[floor&crack,None]-.6)**2)*6)
# OpenGL tangent normals from metric relief plus scan microstructure.
dy,dx=np.gradient(height);nx=-dx*S/2.3;ny=-dy*S/.93
normal=np.stack([nx,ny,np.ones_like(nx)],axis=2)
rust_normal=sample(read_pixels(ROOT/'assets/textures/map/rusty_metal_02_nor_gl_1k.jpg'),np.stack([u,(h*.65)%1],axis=2))
normal[:,:,:2]+=(scan_normal[:,:,:2]-.5)*.55*(1-rustmask[:,:,None])+(rust_normal[:,:,:2]-.5)*1.3*rustmask[:,:,None]
normal[inner]=np.array([0.,0.,1.])
normal[floor]=np.stack([(fine[floor]-.5)*.7,(macro[floor]-.5)*.8,np.ones(np.sum(floor))],axis=1)
normal/=np.linalg.norm(normal,axis=2)[:,:,None]
normal=normal*.5+.5
orm=np.stack([occlusion,rough,metal],axis=2)

def png(path,data):
 a=np.uint8(np.round(np.clip(data,0,1)*255));a=np.flipud(a)
 def chunk(tag,b):return struct.pack('>I',len(b))+tag+b+struct.pack('>I',zlib.crc32(tag+b)&0xffffffff)
 raw=b''.join(b'\0'+row.tobytes() for row in a)
 path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',S,S,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))
for name,a in [('albedo',albedo),('normal',normal),('orm',orm),('emissive',emissive)]:png(OUT/f'barrel-{name}.png',a)
bpy.data.objects.remove(source,do_unlink=True)

# Trace scan hoop positions but add smooth silhouette samples within the exact collider.
N=48
profile=[(.000,.380),(.006,.390),(.014,.394),(.023,.390),(.031,.371),(.10,.369),
 (.317,.368),(.331,.377),(.340,.388),(.347,.393),(.354,.388),(.364,.376),(.378,.368),
 (.57,.368),(.639,.368),(.651,.377),(.661,.388),(.669,.393),(.677,.388),(.689,.376),(.701,.368),
 (.91,.369),(.968,.370),(.979,.382),(.987,.393),(.994,.393),(.999,.390),(1.0,.386),(.996,.383),(.986,.382),
 (.97,.365),(.70,.361),(.35,.362),(.035,.363),(.025,.35),(.025,0)]
profile=profile[:30]+[(hh,r-.007) for hh,r in reversed(profile[:23]) if hh>=.031]+[(.025,.350),(.025,0)]
FLOOR_ROW=len(profile)-2
verts=[];faces=[];uvs=[]
def dent(t,h):
 d=0
 for t0,h0,width,depth in [(1.10,.52,.28,.023),(3.7,.80,.22,.017),(5.55,.55,.26,.024)]:
  a=(t-t0+math.pi)%(2*math.pi)-math.pi
  d+=depth*math.exp(-(a/width)**2-((h-h0)/.15)**2)
 return d
for j,(hh,r) in enumerate(profile):
 for i in range(N+1):
  t=i/N*math.tau
  rr=max(0,r-dent(t,hh)) if r else 0
  if hh>.968: rr-=.0075*math.exp(-(((t-5.75+math.pi)%math.tau-math.pi)/.22)**2)
  wobble=(.0015*math.sin(t*7)+.0009*math.sin(t*13))*(hh>.968)
  verts.append((rr*math.cos(t),rr*math.sin(t),min(.642,-.620+hh*1.262+wobble*(1 if hh<.999 else .2))))
for j in range(len(profile)-1):
 for i in range(N):
  a=j*(N+1)+i;b=a+1;c=b+N+1;d=a+N+1
  faces.append((a,b,c,d))
  def coord(row,col):
   hh=profile[row][0]
   return (col/N,.255+hh*.735) if row<30 else (col/N*.73,.015+hh*.215)
  if j>=FLOOR_ROW: uvs.append([(.875+verts[q][0]*.30,.125+verts[q][1]*.30) for q in (a,b,c,d)])
  else:uvs.append([coord(j,i),coord(j,i+1),coord(j+1,i+1),coord(j+1,i)])
faces.append(tuple(range(N-1,-1,-1)))
uvs.append([(.875+verts[i][0]*.30,.125+verts[i][1]*.30) for i in range(N-1,-1,-1)])
me=bpy.data.meshes.new('Burn barrel detailed steel');me.from_pydata(verts,[],faces);me.update()
obj=bpy.data.objects.new('Burn barrel open steel drum',me);bpy.context.collection.objects.link(obj)
layer=me.uv_layers.new(name='UVMap')
for face,coords in zip(me.polygons,uvs):
 face.use_smooth=True
 for li,uvcoord in zip(face.loop_indices,coords):layer.data[li].uv=uvcoord
bm=bmesh.new();bm.from_mesh(me);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges); bm.to_mesh(me);bm.free();me.update()
bpy.context.view_layer.objects.active=obj;obj.select_set(True)
# Two real drilled/impact openings. Boolean keeps the interior visible through the wall.
for angle,hh,radius in [(5.3,.48,.015),(4.9,.80,.021)]:
 direction=Vector((math.cos(angle),math.sin(angle),0))
 bpy.ops.mesh.primitive_cylinder_add(vertices=9,radius=radius,depth=.18,location=direction*.365+Vector((0,0,-.620+hh*1.262)))
 cutter=bpy.context.object;cutter.rotation_mode='QUATERNION';cutter.rotation_quaternion=direction.to_track_quat('Z','Y')
 bpy.context.view_layer.update()
 bpy.context.view_layer.objects.active=obj
 mod=obj.modifiers.new('Cut impact hole','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='MANIFOLD';mod.object=cutter
 bpy.ops.object.modifier_apply(modifier=mod.name);assert len(obj.data.polygons)>2000; bpy.data.objects.remove(cutter,do_unlink=True)
# Small irregular coal fragments use the same atlas and material.
coal_objects=[]
for k in range(14):
 t=k*2.39996;r=.24*math.sqrt((k+.5)/14)
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(math.cos(t)*r,math.sin(t)*r,-.558+(k%3)*.009))
 o=bpy.context.object;o.scale=(.045+(k%3)*.012,.035+(k%4)*.009,.020+(k%2)*.013);o.rotation_euler=(k*.34,k*.73,k*.51)
 uv=o.data.uv_layers.new() if not o.data.uv_layers else o.data.uv_layers.active
 for i,l in enumerate(uv.data):l.uv=(.78+((i*.063+k*.091)%1)*.20,.025+(i%4)*.05)
 coal_objects.append(o)
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
for o in coal_objects:o.select_set(True)
bpy.context.view_layer.objects.active=obj;bpy.ops.object.join()

# Deterministic glTF writer avoids exporter timestamps and random object identifiers.
me=obj.data;me.calc_loop_triangles();uv=me.uv_layers.active.data
pos=[];norm=[];tex=[];indices=[];lookup={}
for tri in me.loop_triangles:
 for li in tri.loops:
  co=me.vertices[me.loops[li].vertex_index].co;n=me.corner_normals[li].vector;uvco=uv[li].uv
  key=tuple(round(float(x),8) for x in (*co,*n,*uvco))
  if key not in lookup:
   lookup[key]=len(pos);pos.append([co.x,co.z,-co.y]);norm.append([n.x,n.z,-n.y]);tex.append([uvco.x,1-uvco.y])
  indices.append(lookup[key])
arrays=[np.array(pos,dtype='<f4'),np.array(norm,dtype='<f4'),np.array(tex,dtype='<f4'),np.array(indices,dtype='<u2')]
blob=bytearray();views=[];accessors=[]
for i,a in enumerate(arrays):
 while len(blob)%4:blob.append(0)
 views.append({'buffer':0,'byteOffset':len(blob),'byteLength':a.nbytes});blob.extend(a.tobytes())
 acc={'bufferView':i,'componentType':5123 if i==3 else 5126,'count':len(a),'type':['VEC3','VEC3','VEC2','SCALAR'][i]}
 if i==0:acc.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
 accessors.append(acc)
material={'name':'Barrel worn steel soot and embers','pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicRoughnessTexture':{'index':2},'metallicFactor':1,'roughnessFactor':1},'normalTexture':{'index':1},'occlusionTexture':{'index':2},'emissiveTexture':{'index':3},'emissiveFactor':[1,1,1]}
gltf={'asset':{'version':'2.0','generator':'Terminator deterministic barrel build, Blender 5.2.1'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':obj.name,'mesh':0}],'meshes':[{'name':'Open drum with two rolling hoops, chimes, dents, holes and coal','primitives':[{'attributes':{'POSITION':0,'NORMAL':1,'TEXCOORD_0':2},'indices':3,'material':0}]}],'materials':[material],'textures':[{'source':i,'sampler':0} for i in range(4)],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':33071}],'images':[{'uri':f'barrel-{n}.png'} for n in ['albedo','normal','orm','emissive']],'accessors':accessors,'bufferViews':views,'buffers':[{'uri':SLUG+'.bin','byteLength':len(blob)}]}
assert 4000<=len(indices)//3<=6000, len(indices)//3
bounds=arrays[0];assert np.max(np.linalg.norm(bounds[:,[0,2]],axis=1))<=.39501
assert bounds[:,1].min()>=-.62001 and bounds[:,1].max()<=.64201
(OUT/(SLUG+'.bin')).write_bytes(blob)
(OUT/(SLUG+'.gltf')).write_text(json.dumps(gltf,indent=2)+'\n')
manifest=json.loads((ROOT/'assets.json').read_text());folder=OUT.relative_to(ROOT).as_posix()
manifest['files']['map-'+SLUG]={'path':folder+'/'+SLUG+'.gltf','files':{'f.gltf':folder+'/'+SLUG+'.gltf',SLUG+'.bin':folder+'/'+SLUG+'.bin',**{f'barrel-{n}.png':folder+f'/barrel-{n}.png' for n in ['albedo','normal','orm','emissive']}}}
(ROOT/'assets.json').write_text(json.dumps(manifest,indent=2)+'\n')
report={'triangles':len(indices)//3,'vertices':len(pos),'bounds':accessors[0],'materials':1,'textureSize':[1024,1024],'round':ROUND}
(ROOT/'tools/blender/cache/barrel-build.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
