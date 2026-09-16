"""Photograph-traced geometry, executed in the builder's mesh-helper namespace."""
traces=json.loads((ROOT/'tools/blender/revolver/profiles.json').read_text())
trace=traces['left']; sx=trace['metres_per_pixel']; shapes=trace['parts_metres']
def pt(x,y):return (.320-(x-8)*sx,.078-(y-289)*sx)
def traced(name,key,width,mat,part,bevel=.0006):return profile(name,shapes[key],width,mat,part,bevel=bevel)
def cut_profile(obj,key,width):
 cut=profile('Temporary traced cut',shapes[key],width,dark,'temporary',bevel=0)
 active(obj); mod=obj.modifiers.new('Traced open contour','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cut
 bpy.ops.object.modifier_apply(modifier=mod.name);parts['temporary'].remove(cut);bpy.data.objects.remove(cut,do_unlink=True)
 obj.vertex_groups[list(obj.vertex_groups.keys())[0]].add(list(range(len(obj.data.vertices))),1,'REPLACE')
exec(compile((ROOT/'tools/blender/revolver/engraving.py').read_text(), 'engraving.py', 'exec'))
engraved=material('Engraved silver frame',(.20,.23,.27),.38,1,650)
apply_engraving(engraved,*material_sources[engraved.name][:2])
apply_engraving(steel,*material_sources[steel.name][:2],depth=.00006)
exec(compile((ROOT/'tools/blender/revolver/wear.py').read_text(), 'wear.py', 'exec'))
# One continuous extruded frame replaces four unrelated box-like rails.
frame=traced('Traced closed frame','frame',.0188,engraved,'Frame',.0009)
cut_profile(frame,'window',.10)
# The strap is cut, not built as raised sight blocks.
notch=box('Notch cutter',(0,pt(1110,224)[1],pt(1110,224)[0]),(.0038,.006,.021),dark,'temporary',0)
active(frame);mod=frame.modifiers.new('Recessed rear sight','BOOLEAN');mod.operation='DIFFERENCE';mod.object=notch;bpy.ops.object.modifier_apply(modifier=mod.name)
parts['temporary'].remove(notch);bpy.data.objects.remove(notch,do_unlink=True)
# Revolved recoil shield with a rounded shoulder, measured in top and side photographs.
zcy,ycy=pt(984,345);cy_r=85*sx
bone('Cylinder',(0,ycy,zcy));bone('Ejection',(0,ycy,pt(1088,345)[0]));bone('SpentRounds',(0,ycy,zcy));bone('SpeedLoader',(0,ycy,pt(1170,345)[0]))
bone('OctagonalBarrel',(0,.078,pt(696,289)[0]));bone('Hammer',(0,pt(1150,350)[1],pt(1150,350)[0]))
bone('HammerContact',(0,pt(1214,243)[1],pt(1214,243)[0]),'Hammer')
bone('LoadingLever',(0,pt(708,345)[1],pt(708,345)[0]));bone('Trigger',(0,pt(1110,502)[1],pt(1110,502)[0]))
bone('SightFront',(0,pt(60,236)[1],pt(60,236)[0]),'OctagonalBarrel');bone('SightRear',(0,pt(1110,235)[1],pt(1110,235)[0]),'Frame')
# Barrel width comes from the top photograph, with an eight-sided cross section.
barrel_length=(696-8)*sx;barrel_radius=37*sx/cos(pi/8)
tube('Traced octagonal barrel',(0,.078,.320-barrel_length/2),barrel_radius,.0056,barrel_length,steel,'OctagonalBarrel',8,.00025)
tube('Machined muzzle crown',(0,.078,.320),barrel_radius-.00012,.0056,.0006,edge,'OctagonalBarrel',8,.00008)
tube('Dark bore',(0,.078,.313),.00565,.0053,.014,dark,'OctagonalBarrel',32,0)
traced('Rounded front sight','sight',.0028,edge,'SightFront',.0008)
# Add a stable rear-sight surface group, flush with the cut strap.
box('Rear notch floor',(0,pt(1110,245)[1],pt(1110,245)[0]),(.0034,.0005,.014),dark,'SightRear',.0001)
# Cylinder is a lathe, with short rear nipple pockets instead of long flutes.
N=64;vs=[];fs=[];lathe=traces['cylinder']['lathe_px']
for xp,rp in lathe:
 z=pt(xp,345)[0];r=rp*sx
 for i in range(N):
  a=i*2*pi/N;vs.append((sin(a)*r,ycy+cos(a)*r,z))
for j in range(len(lathe)-1):
 for i in range(N):a=j*N+i;b=j*N+(i+1)%N;fs.append((a,b,b+N,a+N))
fs += [tuple(range(N-1,-1,-1)),tuple((len(lathe)-1)*N+i for i in range(N))]
cyl=mesh('Lathed unfluted cylinder',vs,fs,steel,'Cylinder',0)
for i in range(6):
 a=i*pi/3;x=sin(a)*.0135;y=ycy+cos(a)*.0135
 bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.00555,depth=.06,location=P((x,y,zcy)))
 cut=bpy.context.object;cut.rotation_euler[0]=pi/2
 active(cyl);mod=cyl.modifiers.new('Chamber recess','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cut;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)
 # Rear pockets are short and visible through the recoil shield edge.
 bpy.ops.mesh.primitive_cube_add(size=1,location=P((sin(a)*.019,ycy+cos(a)*.019,pt(1078,345)[0])))
 cut=bpy.context.object;cut.dimensions=(.007,.010,.007);cut.rotation_euler[1]=a
 active(cut);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 active(cyl);mod=cyl.modifiers.new('Rear nipple scallop','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cut;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)
 tube('Chamber rim',(x,y,pt(879,345)[0]),.0060,.00555,.0007,edge,'Cylinder',24,.0001)
 cylinder('Nipple',(x,y,pt(1090,345)[0]),.0021,.0045,brass,'Cylinder',n=16,bevel=.0003)
 cylinder('Spent case',(x,y,zcy),.0047,.021,brass,'SpentRounds',n=16,bevel=.0002)
 cylinder('Loader cartridge',(x,y,pt(1170,345)[0]),.0047,.027,brass,'SpeedLoader',n=16,bevel=.0002)
 cylinder('Loader bullet',(x,y,pt(1100,345)[0]),.0046,.005,edge,'SpeedLoader',n=16,bevel=.0005)
active(cyl);mod=cyl.modifiers.new('Cylinder rounded machining','BEVEL');mod.width=.00028;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
active(cyl);mod=cyl.modifiers.new('Budgeted cylinder topology','DECIMATE');mod.ratio=.50;bpy.ops.object.modifier_apply(modifier=mod.name)
cyl.vertex_groups['Cylinder'].add(list(range(len(cyl.data.vertices))),1,'REPLACE')
for f in cyl.data.polygons:f.use_smooth=True
cylinder('Cylinder axle',(0,ycy,zcy),.003,.055,edge,'Cylinder',n=24)
bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=12,location=P((0,ycy,pt(1138,345)[0])))
shield=bpy.context.object;shield.scale=(.0165,.0100,.0205);finish(shield,'Rounded recoil shoulder',engraved,'Frame',0)
for f in shield.data.polygons:f.use_smooth=True
cylinder('Loader disk',(0,ycy,pt(1220,345)[0]),.019,.006,steel,'SpeedLoader',n=32)
cylinder('Loader handle',(0,ycy,pt(1260,345)[0]),.007,.014,pad,'SpeedLoader',n=20)
traced('Curved traced hammer','hammer',.0065,edge,'Hammer',.0008)
for j in range(6):
 z,y=pt(1213+j*1.6,240+j*2);box('Hammer serration',(0,y,z),(.007,.0005,.0006),dark,'Hammer',.0001)
traced('Curved trigger','trigger',.0033,edge,'Trigger',.00055)
bowpoints=[(978,495),(978,522),(980,549),(985,568),(998,583),(1020,593),(1054,599),(1085,598),(1110,590),(1127,575),(1138,553),(1144,532),(1148,516)]
path_tube('Swept traced brass bow',[(0,pt(x,y)[1],pt(x,y)[0])for x,y in bowpoints],.0010,brass,'TriggerGuard',12)
profile('Brass mounting tang',[pt(x,y)for x,y in [(912,466),(1174,498),(1172,516),(1148,516),(1110,500),(995,485),(972,495),(967,484)]],.008,brass,'TriggerGuard',bevel=.0009)
traced('Traced loading lever','lever',.0088,steel,'LoadingLever',.0007)
z,y=pt(440,343);cylinder('Loading rammer round shaft',(0,y,z),.0024,510*sx,steel,'LoadingLever',n=20,bevel=.0003)
z,y=pt(707,341);cylinder('Lever pivot',(0,y,z),.0034,.023,edge,'LoadingLever',axis=(1,0,0),n=24)
z,y=pt(194,335);box('Lever catch',(0,y,z),(.008,.004,.012),steel,'OctagonalBarrel',.0005)
# Lenticular grip panels use concentric traced rings, avoiding slab sides.
def grip_panel(sign):
 outline=shapes['grip'];center=Vector((sum(p[0]for p in outline)/len(outline),sum(p[1]for p in outline)/len(outline)))
 vs=[];fs=[];N=len(outline)
 for factor,xx in [(1,.0045),(.965,.0080),(.82,.0121),(.52,.0142)]:
  for z,y in outline:
   v=center+(Vector((z,y))-center)*factor;vs.append((sign*xx,v.y,v.x))
 for ring in range(3):
  for i in range(N):a=ring*N+i;b=ring*N+(i+1)%N;fs.append((a,b,b+N,a+N))
 fs += [tuple(range(N-1,-1,-1)),tuple(3*N+i for i in range(N))]
 o=mesh('Contoured traced walnut',vs,fs,wood,'Grip',0)
 for f in o.data.polygons:f.use_smooth=True
for sign in [-1,1]:grip_panel(sign)
traced('Grip metal core','grip',.009,steel,'Grip',.0005)
for part,pts in [('Frame',[(758,379),(1168,431),(1106,465)]),('Grip',[(1353,633)])]:
 for xpix,ypix in pts:
  z,y=pt(xpix,ypix)
  for sign in [-1,1]:
   x=sign*(.0163 if part=='Grip' else .0101)
   cylinder('Screw escutcheon',(x,y,z),.0036,.0009,brass if part=='Grip' else edge,part,axis=(1,0,0),n=32,bevel=.0002)
   cylinder('Recessed screw',(x+sign*.0005,y,z),.00275,.0006,edge,part,axis=(1,0,0),n=24,bevel=.00012)
   box('Screw slot',(x+sign*.00085,y,z),(.00025,.0006,.0048),dark,part,.0001)
parts.pop('temporary',None)

frame.vertex_groups['Frame'].add(list(range(len(frame.data.vertices))),1,'REPLACE')
active(frame);mod=frame.modifiers.new('Budgeted frame topology','DECIMATE');mod.ratio=.60;bpy.ops.object.modifier_apply(modifier=mod.name)

traced('Traced backstrap rim','backstrap',.011,engraved,'Frame',.00035)

exec(compile((ROOT/'tools/blender/revolver/sampled_finish.py').read_text(), 'sampled_finish.py', 'exec'))
