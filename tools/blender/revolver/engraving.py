"""Original scroll engraving stencil. No reference image pixels are sampled."""
import numpy as np
size=2048
ink=np.zeros((size,size),dtype=np.float32)
def stroke(points,width=1.4):
 for x,y in points:
  xx=x/1500*size;yy=(1-y/1000)*size;r=width/1500*size
  x0=max(0,int(xx-r-1));x1=min(size,int(xx+r+2));y0=max(0,int(yy-r-1));y1=min(size,int(yy+r+2))
  if x0>=x1 or y0>=y1:continue
  gy,gx=np.mgrid[y0:y1,x0:x1];v=np.clip(r+.5-np.sqrt((gx-xx)**2+(gy-yy)**2),0,1)
  ink[y0:y1,x0:x1]=np.maximum(ink[y0:y1,x0:x1],v)
for cx,cy,r in [(729,279,16),(776,287,24),(829,292,22),(754,377,14),(891,448,9),(931,457,10),(975,464,11),(1020,470,11),(1065,477,10),(1146,417,17),(1180,454,12),(1140,325,13),(1147,359,14)]:
 for mirror in [-1,1]:
  points=[]
  for i in range(220):
   t=i/219*3.7*pi;rr=r*(1-i/270);points.append((cx+cos(t)*rr,cy+mirror*sin(t)*rr*.66))
  stroke(points,1.2)
# Two acanthus-like vines replace the geometric rosette.
for cy,mirror in [(294,1),(400,-1)]:
 spine=[(886+t*.9,cy+mirror*(11*sin(t/24)+t*.05))for t in range(211)]
 stroke(spine,1.15)
 for j in range(7):
  cx=905+j*26;yy=cy+mirror*(11*sin((cx-886)/.9/24)+(cx-886)*.05)
  points=[]
  for k in range(120):
   t=k/119*2.8*pi;r=(10+4*sin(j*2.4))*(1-k/145);points.append((cx+cos(t)*r,yy+mirror*sin(t)*r*1.7))
  stroke(points,.9)
# Dense small scrolls follow the exposed frame plates.
for cx,cy in [(723,313),(756,311),(795,307),(831,304),(1125,397),(1154,406),(1184,419),(1100,474),(1064,470),(1020,464),(976,458),(934,451)]:
 stroke([(cx+cos(i/100*3*pi)*12*(1-i/125),cy+sin(i/100*3*pi)*9*(1-i/125))for i in range(101)],.8)
# Lightly broken border lines have deterministic tool marks.
for y,x0,x1 in [(241,822,1104),(446,893,1090),(267,711,833)]:
 stroke([(x,y+sin(x*.11)*.4)for x in range(x0,x1)if x%37<33],.8)
rgba=np.ones((size,size,4),dtype=np.float32);rgba[:,:,:3]=ink[:,:,None]
engraving=bpy.data.images.new('Original 1858 scroll engraving source',width=size,height=size,alpha=False)
engraving.colorspace_settings.name='Non-Color';engraving.pixels.foreach_set(rgba.ravel());engraving.pack()
def apply_engraving(mat,base,rough,depth=.00008):
 n=mat.node_tree.nodes;l=mat.node_tree.links;bs=n.get('Principled BSDF');coord=n.new('ShaderNodeTexCoord');sep=n.new('ShaderNodeSeparateXYZ');l.new(coord.outputs['Object'],sep.inputs[0])
 u=n.new('ShaderNodeMath');u.operation='MULTIPLY_ADD';u.inputs[1].default_value=1/(sx*1500);u.inputs[2].default_value=(8+.320/sx)/1500;l.new(sep.outputs['Y'],u.inputs[0])
 v=n.new('ShaderNodeMath');v.operation='MULTIPLY_ADD';v.inputs[1].default_value=1/(sx*1000);v.inputs[2].default_value=1-(289+.078/sx)/1000;l.new(sep.outputs['Z'],v.inputs[0])
 combine=n.new('ShaderNodeCombineXYZ');l.new(u.outputs[0],combine.inputs[0]);l.new(v.outputs[0],combine.inputs[1])
 tex=n.new('ShaderNodeTexImage');tex.image=engraving;tex.extension='CLIP';l.new(combine.outputs[0],tex.inputs['Vector'])
 mix=n.new('ShaderNodeMixRGB');mix.inputs[2].default_value=(.10,.105,.115,1) if mat.name=='Blued steel' else (.028,.030,.033,1);l.new(tex.outputs[0],mix.inputs[0]);l.new(base,mix.inputs[1]);l.new(mix.outputs[0],bs.inputs['Base Color'])
 bump=n.new('ShaderNodeBump');bump.invert=True;bump.inputs['Strength'].default_value=.7;bump.inputs['Distance'].default_value=depth;l.new(tex.outputs[0],bump.inputs['Height'])
 old=bs.inputs['Normal'].links
 if old:l.new(old[0].from_socket,bump.inputs['Normal'])
 l.new(bump.outputs[0],bs.inputs['Normal'])
 material_sources[mat.name]=(mix.outputs[0],rough,1)

# Directional walnut grain uses an original 2048-pixel image, not sampled photographs.
gy,gx=np.mgrid[0:size,0:size].astype(np.float32);gx/=size;gy/=size
phase=gx*1850+np.sin(gx*37)*8+np.sin(gx*181)*2+np.sin(gy*15+gx*4)*4+np.sin(gy*48+gx*8)*.6
grain=(np.sin(phase)*.5+.5)**.18
fine=(np.sin(gx*2823+np.sin(gy*55)*.3)*np.sin(gx*1703+gy*33)*.5+.5)
value=np.clip(.08+.48*grain+.36*fine+.08*np.sin(gx*180+gy*30)**2,0,1)
rgba=np.ones((size,size,4),np.float32)
for k,(low,high) in enumerate(zip([.003,.0005,.0001],[.066,.014,.0034])):rgba[:,:,k]=low+(high-low)*value
walnut=bpy.data.images.new('Original directional walnut source',width=size,height=size,alpha=False)
walnut.colorspace_settings.name='Non-Color';walnut.pixels.foreach_set(rgba.ravel());walnut.pack()
n=wood.node_tree.nodes;l=wood.node_tree.links;bs=n.get('Principled BSDF');coord=n.new('ShaderNodeTexCoord');sep=n.new('ShaderNodeSeparateXYZ');l.new(coord.outputs['Object'],sep.inputs[0])
u=n.new('ShaderNodeMath');u.operation='MULTIPLY_ADD';u.inputs[1].default_value=1/(sx*1500);u.inputs[2].default_value=(8+.320/sx)/1500;l.new(sep.outputs['Y'],u.inputs[0])
v=n.new('ShaderNodeMath');v.operation='MULTIPLY_ADD';v.inputs[1].default_value=1/(sx*1000);v.inputs[2].default_value=1-(289+.078/sx)/1000;l.new(sep.outputs['Z'],v.inputs[0])
combine=n.new('ShaderNodeCombineXYZ');l.new(u.outputs[0],combine.inputs[0]);l.new(v.outputs[0],combine.inputs[1])
tex=n.new('ShaderNodeTexImage');tex.image=walnut;l.new(combine.outputs[0],tex.inputs['Vector']);l.new(tex.outputs[0],bs.inputs['Base Color'])
bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.0004;bump.inputs['Strength'].default_value=.4;l.new(tex.outputs[0],bump.inputs['Height']);l.new(bump.outputs[0],bs.inputs['Normal'])
material_sources[wood.name]=(tex.outputs[0],material_sources[wood.name][1],0)
