"""Pose the CC0 Dan Ulrich scan topology. No voxel remeshing or primitive palms."""
import numpy as np
bundle=ROOT/'tools/blender/cache/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend'
if not bundle.exists():raise RuntimeError('Download the CC0 Human Base Meshes v1.4.1 bundle. See README.md.')
with bpy.data.libraries.load(str(bundle),link=False) as (src,dst):dst.objects=['Hand  - Realistic']
source=dst.objects[0];source.parent=None;source.animation_data_clear();source.constraints.clear();source.matrix_world=Matrix.Identity(4);source.delta_location=(0,0,0);source.delta_rotation_euler=(0,0,0);source.delta_scale=(1,1,1);scene.collection.objects.link(source);active(source)
for mod in list(source.modifiers):
 if mod.type=='MULTIRES':mod.levels=1;mod.sculpt_levels=1;mod.render_levels=1;bpy.ops.object.modifier_apply(modifier=mod.name)
 else:source.modifiers.remove(mod)
# Keep the hand and a short anatomical forearm. The cuff covers the closed cut.
bm=bmesh.new();bm.from_mesh(source.data)
bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=(0,0,.025),plane_no=(0,0,1),clear_outer=True,clear_inner=False)
bmesh.ops.holes_fill(bm,edges=[e for e in bm.edges if e.is_boundary],sides=0)
bm.to_mesh(source.data);bm.free()
source_points={
 'Index':[(.030,0,-.105),(.040,0,-.140),(.049,0,-.168),(.050,0,-.186)],
 'Middle':[(.005,0,-.110),(.011,0,-.153),(.015,0,-.181),(.016,0,-.200)],
 'Ring':[(-.020,0,-.108),(-.019,0,-.146),(-.017,0,-.174),(-.016,0,-.189)],
 'Little':[(-.038,0,-.101),(-.049,0,-.130),(-.052,0,-.149),(-.052,0,-.162)],
 'Thumb':[(.024,0,-.036),(.052,0,-.064),(.072,0,-.091),(.088,0,-.106)]}
source_points={k:[Vector(v)for v in vs]for k,vs in source_points.items()}
# The scan's curled fingers do not share a zero-depth plane. Fit each joint through its cross-section center.
source_array=np.array([list(v.co)for v in source.data.vertices])
def scan_center(v):
 distances=(source_array[:,0]-v.x)**2+(source_array[:,2]-v.z)**2
 sample=source_array[np.argsort(distances)[:18],1]
 result=v.copy();result.y=float((np.percentile(sample,10)+np.percentile(sample,90))*.5);return result
source_points={f:[scan_center(v)for v in points]for f,points in source_points.items()}

hand_chains={
 'Right':{
  'Index':[(.016,.035,.001),(-.020,.034,.048),(-.008,.039,.056),(.002,.046,.056)],
  'Middle':[(.016,.016,-.001),(-.027,.013,.040),(-.006,.013,.047),(.013,.015,.034)],
  'Ring':[(.016,-.003,-.012),(-.025,-.006,.032),(-.004,-.006,.041),(.013,-.005,.027)],
  'Little':[(.012,-.020,-.022),(-.023,-.024,.020),(-.004,-.024,.031),(.009,-.025,.018)],
  'Thumb':[(-.025,.025,-.032),(-.017,.046,-.019),(.004,.042,.000),(.014,.033,.021)]},
 'Left':{
  'Index':[(-.020,.013,.000),(.014,.011,.051),(-.011,.008,.048),(-.016,.007,.032)],
  'Middle':[(-.020,-.005,-.008),(.019,-.010,.044),(-.008,-.011,.044),(-.017,-.010,.027)],
  'Ring':[(-.020,-.024,-.020),(.018,-.030,.030),(-.006,-.029,.033),(-.016,-.023,.018)],
  'Little':[(-.020,-.038,-.033),(.014,-.042,.016),(-.005,-.040,.023),(-.010,-.031,.011)],
  'Thumb':[(.032,.015,-.026),(.023,.063,-.007),(.014,.056,.014),(.014,.034,.031)]}}
# Source wrist to knuckle axes. Opposite handedness mirrors the original right hand.
hand_cuffs={}
for side in ['Right','Left']:
 right=side=='Right';hand='Hand'+side
 chains={k:[Vector(p)for p in vs]for k,vs in hand_chains[side].items()}
 # Preserve the scan's orthogonal anatomical axes instead of shearing its palm into arbitrary spans.
 across=(chains['Index'][0]-chains['Little'][0]).normalized()
 back=Vector((-.30,-.75,-.45) if right else (.50,-.70,-.45));back=(back-across*back.dot(across)).normalized()
 normal=back.cross(across).normalized()*(1 if right else -1)
 basis=Matrix((across,normal,back)).transposed()*.70
 src_center=sum((source_points[f][0]for f in ['Index','Middle','Ring','Little']),Vector())/4
 dst_center=sum((chains[f][0]for f in ['Index','Middle','Ring','Little']),Vector())/4
 wrist=dst_center-basis@src_center
 bone(hand,wrist);bone(side+'Hand',wrist,hand);bone(side+'Palm',wrist,side+'Hand')
 # FABRIK preserves each scan phalanx length. The target only determines the grip contact.
 transforms={}
 for finger,sp in source_points.items():
  rest=[wrist+basis@v for v in sp];points=[v.copy()for v in chains[finger]];anchor=rest[0];target=points[-1].copy()
  lengths=[(rest[j+1]-rest[j]).length for j in range(3)]
  for iteration in range(36):
   points[-1]=target.copy()
   for j in [2,1,0]:points[j]=points[j+1]+(points[j]-points[j+1]).normalized()*lengths[j]
   points[0]=anchor.copy()
   for j in range(3):points[j+1]=points[j]+(points[j+1]-points[j]).normalized()*lengths[j]
  chains[finger]=points
  transforms[finger]=[(points[j],(rest[j+1]-rest[j]).rotation_difference(points[j+1]-points[j]))for j in range(3)]
  for j in range(3):bone(side+finger+str(j+1),points[j],side+'Palm' if j==0 else side+finger+str(j))
  bone(side+finger+'Tip',points[-1],side+finger+'3')
 o=source.copy();o.data=source.data.copy();scene.collection.objects.link(o);o.name=side+' CC0 anatomical hand and forearm';o.modifiers.clear();o.data.materials.clear();o.data.materials.append(skin);o.vertex_groups.clear();o['sourceLicense']='CC0-1.0';o['sourceAuthor']='Dan Ulrich';o['sourceAsset']='Hand  - Realistic, Human Base Meshes 1.4.1'
 for name in [side+'Palm']+[side+f+str(j)for f in chains for j in [1,2,3]]:o.vertex_groups.new(name=name)
 for vertex,original in zip(o.data.vertices,source.data.vertices):
  v=original.co.copy();candidates=[]
  for finger,points in source_points.items():
   for j in range(3):
    a,b=points[j:j+2];axis=b-a;t=max(0,min(1,(v-a).dot(axis)/axis.length_squared));near=a+axis*t
    distance=(v-near).length;candidates.append((distance,finger,j,t))
  _,finger,j,t=min(candidates);sp=source_points[finger]
  along=(v-sp[0]).dot((sp[1]-sp[0]).normalized());blend=max(0,min(1,(along+.010)/.025))
  if finger=='Thumb':blend=max(0,min(1,(v.x-.020)/.030))
  blend=blend*blend*(3-2*blend)
  u=j+t;weights=[max(0,1-abs(u-(k+.5)))for k in range(3)];total=sum(weights)
  if not total:weights[j]=1;total=1
  result=(wrist+basis@v)*(1-blend)
  o.vertex_groups[side+'Palm'].add([vertex.index],1-blend,'REPLACE')
  for k,w in enumerate(weights):
   if w:
    location,rotation=transforms[finger][k];result+=(location+rotation@(basis@(v-sp[k])))*w/total*blend
    o.vertex_groups[side+finger+str(k+1)].add([vertex.index],w/total*blend,'REPLACE')
  vertex.co=P(result)
 active(o);bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 smooth=o.modifiers.new('Relax posed scan webs','SMOOTH');smooth.factor=.35;smooth.iterations=2;bpy.ops.object.modifier_apply(modifier=smooth.name)
 tri=o.modifiers.new('Deterministic anatomical triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
 dec=o.modifiers.new('Anatomy budget','DECIMATE');dec.ratio=min(1,3100/len(o.data.polygons));bpy.ops.object.modifier_apply(modifier=dec.name)
 for face in o.data.polygons:face.use_smooth=True
 parts[side+'Palm']=[o]
 # Dark tailored fabric covers the forearm cut. No stitched polygons cross exposed skin.
 elbow=wrist+back*.40;d=elbow-wrist
 bone(side+'Forearm',elbow,'Body')
 cuff=wrist+basis@Vector((0,0,-.015));hand_cuffs[side]=P(cuff)
 points=[cuff+(elbow-cuff)*(i/10)for i in range(11)]
 radii=[.027,.030,.031,.033,.035,.037,.039,.041,.043,.045,.048]
 sleeve=path_tube(side+' tailored sleeve',points,radii,cloth,side+'Forearm',20)
 for v in sleeve.data.vertices:
  v.co.x+=.0010*sin(v.co.z*145+v.co.y*33);v.co.z+=.0012*cos(v.co.y*103+v.co.x*41)
 path_tube(side+' folded cuff',[cuff,cuff+(elbow-cuff)*.025,cuff+(elbow-cuff)*.055],[.027,.030,.029],cloth,side+'Forearm',24)
 for surface in parts[side+'Forearm']:
  surface.vertex_groups.clear();anchor=surface.vertex_groups.new(name=side+'Forearm');moving=surface.vertex_groups.new(name=hand)
  for vertex in surface.data.vertices:
   local=Vector((vertex.co.x,vertex.co.z,-vertex.co.y));t=max(0,min(1,(local-cuff).dot(elbow-cuff)/(elbow-cuff).length_squared));weight=min(1,t/.10)
   anchor.add([vertex.index],weight,'REPLACE');moving.add([vertex.index],1-weight,'REPLACE')
bpy.data.objects.remove(source,do_unlink=True)
