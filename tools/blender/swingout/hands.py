"""Rig the neutral CC0 scan. Do not inherit the old revolver's baked finger folds."""
with bpy.data.libraries.load(str(ROOT/'tools/blender/swingout/neutral-hand.blend'),link=False) as (src,dst):dst.objects=['Neutral anatomical hand']
source_hand=dst.objects[0];source_hand.parent=None
source_points={f:[Vector(p) for p in chain] for f,chain in json.loads(source_hand['joints']).items()}
for side in ['Right','Left']:
 old=next(o for o in hands if o.name.startswith(side));old_name=old.name;wrist=arm.data.bones['Hand'+side].head_local.copy()
 # Same palm registration as the prior rig. Rebuild skin and joints together.
 across=(arm.data.bones[side+'Index1'].head_local-arm.data.bones[side+'Little1'].head_local).normalized()
 back=P((-.30,-.75,-.45) if side=='Right' else (.50,-.70,-.45));back=(back-across*back.dot(across)).normalized()
 normal=back.cross(across).normalized()*(1 if side=='Right' else -1)
 basis=Matrix((across,normal,back)).transposed()*.70
 o=source_hand.copy();o.data=source_hand.data.copy();scene.collection.objects.link(o);o.name=side+'_Hand_and_Sleeve';o.vertex_groups.clear();o.data.materials.clear();o.data.materials.append(hand_material)
 for name in [side+'Palm']+[side+f+str(j) for f in source_points for j in [1,2,3]]:o.vertex_groups.new(name=name)
 for v in o.data.vertices:
  co=v.co.copy();candidates=[]
  for finger,points in source_points.items():
   for j in range(3):
    a,b=points[j:j+2];axis=b-a;t=max(0,min(1,(co-a).dot(axis)/axis.length_squared));near=a+axis*t;candidates.append(((co-near).length,finger,j,t))
  _,finger,j,t=min(candidates);sp=source_points[finger]
  along=(co-sp[0]).dot((sp[1]-sp[0]).normalized());blend=max(0,min(1,(along+.006)/.022))
  if finger=='Thumb':blend=max(0,min(1,(co.x-.020)/.030))
  blend=blend*blend*(3-2*blend);u=j+t;weights=[max(0,1-abs(u-(k+.5))) for k in range(3)];total=sum(weights)
  if not total:weights[j]=1;total=1
  o.vertex_groups[side+'Palm'].add([v.index],1-blend,'REPLACE')
  for k,w in enumerate(weights):
   if w:o.vertex_groups[side+finger+str(k+1)].add([v.index],w/total*blend,'REPLACE')
  v.co=wrist+basis@co
 active(arm);bpy.ops.object.mode_set(mode='EDIT')
 for finger,chain in source_points.items():
  for j in range(4):
   b=arm.data.edit_bones[side+finger+(str(j+1) if j<3 else 'Tip')];b.head=wrist+basis@chain[j];b.tail=b.head+P((0,.012,0))
 bpy.ops.object.mode_set(mode='OBJECT')
 # Stable atlas patch for neutral skin; avoid the old posed hand's incompatible UV seams.
 uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
 for item in uv.data:item.uv=(.995,.985)
 active(o);dec=o.modifiers.new('Hand runtime budget','DECIMATE');dec.ratio=min(1,3000/len(o.data.polygons));bpy.ops.object.modifier_apply(modifier=dec.name)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
 mod=o.modifiers.new('Anatomical skin','ARMATURE');mod.object=arm;o.parent=arm
 hands[hands.index(old)]=o;bpy.data.objects.remove(old,do_unlink=True);o.name=old_name
bpy.data.objects.remove(source_hand,do_unlink=True)
