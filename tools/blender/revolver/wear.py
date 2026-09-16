"""Original contour wear and machining scratches, baked into the existing atlases."""
px=gx*1500;py=(1-gy)*1000
minimum=np.full((size,size),10000,dtype=np.float32)
for key in ['frame','window','barrel','lever']:
 points=trace['parts_px'][key]
 for i,(ax,ay) in enumerate(points):
  bx,by=points[(i+1)%len(points)];dx=bx-ax;dy=by-ay
  t=np.clip(((px-ax)*dx+(py-ay)*dy)/max(1,dx*dx+dy*dy),0,1)
  minimum=np.minimum(minimum,np.sqrt((px-ax-t*dx)**2+(py-ay-t*dy)**2))
edge_mask=np.clip(1-minimum/6,0,1)
cloud=.5+.24*np.sin(px*.071+np.sin(py*.019)*4)+.2*np.sin(px*.013+py*.05)+.06*np.sin(px*.53+py*.43)
ink=np.zeros((size,size),np.float32);rng=np.random.default_rng(1858)
for i in range(340):
 x=rng.uniform(20,1230);y=rng.uniform(242,485);length=rng.uniform(2,28);angle=rng.normal(0,.18)
 stroke([(x+j*cos(angle),y+j*sin(angle))for j in np.arange(0,length,.6)],rng.uniform(.35,.9))
value=np.clip(edge_mask*np.clip(cloud,.05,1)*.65+ink*.32,0,.8)
rgba=np.ones((size,size,4),np.float32);rgba[:,:,:3]=value[:,:,None]
wear=bpy.data.images.new('Original traced contour wear',width=size,height=size,alpha=False)
wear.colorspace_settings.name='Non-Color';wear.pixels.foreach_set(rgba.ravel());wear.pack()
for mat in [steel,engraved,brass,edge]:
 n=mat.node_tree.nodes;l=mat.node_tree.links;bs=n.get('Principled BSDF');coord=n.new('ShaderNodeTexCoord');sep=n.new('ShaderNodeSeparateXYZ');l.new(coord.outputs['Object'],sep.inputs[0])
 u=n.new('ShaderNodeMath');u.operation='MULTIPLY_ADD';u.inputs[1].default_value=1/(sx*1500);u.inputs[2].default_value=(8+.320/sx)/1500;l.new(sep.outputs['Y'],u.inputs[0])
 v=n.new('ShaderNodeMath');v.operation='MULTIPLY_ADD';v.inputs[1].default_value=1/(sx*1000);v.inputs[2].default_value=1-(289+.078/sx)/1000;l.new(sep.outputs['Z'],v.inputs[0])
 combine=n.new('ShaderNodeCombineXYZ');l.new(u.outputs[0],combine.inputs[0]);l.new(v.outputs[0],combine.inputs[1])
 tex=n.new('ShaderNodeTexImage');tex.image=wear;tex.extension='CLIP';l.new(combine.outputs[0],tex.inputs['Vector'])
 base,rough,metal=material_sources[mat.name]
 mix=n.new('ShaderNodeMixRGB');l.new(tex.outputs[0],mix.inputs[0]);l.new(base,mix.inputs[1]);mix.inputs[2].default_value=(.38,.28,.10,1) if mat==brass else (.27,.29,.31,1);l.new(mix.outputs[0],bs.inputs['Base Color'])
 rm=n.new('ShaderNodeMixRGB');l.new(tex.outputs[0],rm.inputs[0]);l.new(rough,rm.inputs[1]);rm.inputs[2].default_value=(.18,.18,.18,1);l.new(rm.outputs[0],bs.inputs['Roughness'])
 bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00006;bump.inputs['Strength'].default_value=.2;l.new(tex.outputs[0],bump.inputs['Height'])
 if bs.inputs['Normal'].links:l.new(bs.inputs['Normal'].links[0].from_socket,bump.inputs['Normal'])
 l.new(bump.outputs[0],bs.inputs['Normal']);material_sources[mat.name]=(mix.outputs[0],rm.outputs[0],metal)
