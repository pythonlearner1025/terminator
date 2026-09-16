"""CC0 procedural textures fitted to measured reference colors and frequency scales.
Only statistics enter these surfaces. The copyrighted reference images remain in docs.
"""
import numpy as np
size=2048;rng=np.random.default_rng(1858)
y,x=np.mgrid[0:size,0:size].astype(np.float32);x/=size;y/=size
# Directional irregular pores vary in width and length. Phase is seeded original data.
coarse=np.zeros((size,size),np.float32)
for frequency,amplitude in [(5,.32),(13,.21),(29,.14),(73,.07)]:
 angle=rng.uniform(0,2*pi);phase=rng.uniform(0,2*pi)
 coarse+=amplitude*np.sin((x*cos(angle)+y*sin(angle))*frequency*2*pi+phase)
noise=rng.normal(0,1,(size,size)).astype(np.float32)
# Seeded anisotropic noise has irregular pore widths, without periodic sine moire.
fy=np.fft.fftfreq(size)[:,None];fx=np.fft.rfftfreq(size)[None,:]
spectrum=np.fft.rfft2(noise)
def fibers(width,length):
 field=np.fft.irfft2(spectrum*np.exp(-2*pi*pi*(fx*fx*width*width+fy*fy*length*length)),s=(size,size))
 return field/max(.00001,float(field.std()))
fiber=fibers(1.3,32)*.65+fibers(3.5,90)*.30+fibers(9,160)*.15
pores=np.maximum(0,fiber-.15)
walnut_field=np.clip(.16*coarse+.12*noise-.47*pores,-.88,.60)
case_field=1.3*coarse+.16*noise+.18*np.sin(x*400+np.sin(y*400)*3)
brush=.12*np.sin(y*2500+np.sin(x*38))+.05*noise

def image_source(name,rgb):
 rgba=np.ones((size,size,4),np.float32);rgba[:,:,:3]=np.clip(rgb,.0001,.98)
 im=bpy.data.images.new(name,width=size,height=size,alpha=False);im.colorspace_settings.name='Non-Color';im.pixels.foreach_set(rgba.ravel());im.pack();return im

def projected(mat,image,axis='photo'):
 n=mat.node_tree.nodes;l=mat.node_tree.links;coord=n.new('ShaderNodeTexCoord')
 if axis=='photo':
  sep=n.new('ShaderNodeSeparateXYZ');l.new(coord.outputs['Object'],sep.inputs[0])
  u=n.new('ShaderNodeMath');u.operation='MULTIPLY_ADD';u.inputs[1].default_value=1/(sx*1500);u.inputs[2].default_value=(8+.320/sx)/1500;l.new(sep.outputs['Y'],u.inputs[0])
  v=n.new('ShaderNodeMath');v.operation='MULTIPLY_ADD';v.inputs[1].default_value=1/(sx*1000);v.inputs[2].default_value=1-(289+.078/sx)/1000;l.new(sep.outputs['Z'],v.inputs[0])
  comb=n.new('ShaderNodeCombineXYZ');l.new(u.outputs[0],comb.inputs[0]);l.new(v.outputs[0],comb.inputs[1]);vec=comb.outputs[0]
 else:vec=coord.outputs['Generated']
 tex=n.new('ShaderNodeTexImage');tex.image=image;l.new(vec,tex.inputs['Vector']);return tex.outputs[0]

settings={
 'Blued steel':{'color':[.079,.061,.090],'rough':.31,'field':brush},
 'Engraved silver frame':{'color':[.110,.087,.119],'rough':.36,'field':case_field},
 'Walnut':{'color':[.031,.0064,.0024],'rough':.39,'field':walnut_field},
 'Skin':{'color':[.30,.155,.115],'rough':.57,'field':.025*noise+.06*coarse},
 'Sleeve cloth':{'color':[.012,.0105,.009],'rough':.89,'field':.10*noise+.4*coarse},
 'Aged brass':{'color':[.98,.61,.295],'rough':.23,'field':.05*noise+.05*coarse}}
for name,cfg in settings.items():
 mat=materials[name];n=mat.node_tree.nodes;l=mat.node_tree.links;bs=n.get('Principled BSDF');color=np.array(cfg['color']);field=cfg['field']
 rgb=color[None,None,:]*(1+field[:,:,None])
 if name=='Engraved silver frame':
  # Blue, straw, and oxide variations stay low contrast, as measured in the frame crop.
  rgb[:,:,0]+=.055*np.maximum(0,coarse);rgb[:,:,2]+=.023*np.maximum(0,-coarse);rgb[:,:,1]+=.018*np.maximum(0,coarse)
 if name=='Engraved silver frame':
  seam=np.exp(-(((1-y)*1000-331)/1.2)**2)*((x*1500>711)&(x*1500<834));rgb+=seam[:,:,None]*np.array([.29,.28,.25])
 im=image_source(name+' measured original finish',rgb);base=projected(mat,im,'photo' if name not in ['Skin','Sleeve cloth'] else 'generated')
 l.new(base,bs.inputs['Base Color']);rough=n.new('ShaderNodeValue');rough.outputs[0].default_value=cfg['rough'];l.new(rough.outputs[0],bs.inputs['Roughness'])
 material_sources[name]=(base,rough.outputs[0],material_sources[name][2])
 if name=='Skin':bs.inputs['Subsurface Weight'].default_value=.065;bs.inputs['Subsurface Radius'].default_value=(1,.45,.25)
 if name in ['Walnut','Engraved silver frame']:
  bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00019 if name=='Walnut' else .00004;bump.inputs['Strength'].default_value=.30;l.new(base,bump.inputs['Height']);l.new(bump.outputs[0],bs.inputs['Normal'])
 if name in ['Blued steel','Engraved silver frame']:
  bs.inputs['Anisotropic'].default_value=.35
# Original engraving follows the newly dark materials. Its extent is unchanged geometrically.
for mat in [steel,engraved]:apply_engraving(mat,*material_sources[mat.name][:2],depth=.000055)

exec(compile((ROOT/'tools/blender/revolver/wear.py').read_text(), 'wear.py', 'exec'))

# CC0 Poly Haven black walnut. The photograph supplies color statistics, never pixels.
mat=wood;n=mat.node_tree.nodes;l=mat.node_tree.links;bs=n.get('Principled BSDF')
coord=n.new('ShaderNodeTexCoord');sep=n.new('ShaderNodeSeparateXYZ');l.new(coord.outputs['Object'],sep.inputs[0])
uv=n.new('ShaderNodeCombineXYZ')
for channel,axis in [(0,'Z'),(1,'Y')]:
 scale=n.new('ShaderNodeMath');scale.operation='MULTIPLY_ADD';scale.inputs[1].default_value=1.3;scale.inputs[2].default_value=.35;l.new(sep.outputs[axis],scale.inputs[0]);l.new(scale.outputs[0],uv.inputs[channel])
def walnut_texture(suffix,color_space):
 path=ROOT/'tools/blender/cache'/('black_walnut_veneer_01_'+suffix+'_2k.jpg')
 if not path.exists():raise RuntimeError('Download the CC0 walnut maps. See README.md.')
 image=bpy.data.images.load(str(path),check_existing=True);image.colorspace_settings.name=color_space
 tex=n.new('ShaderNodeTexImage');tex.image=image;l.new(uv.outputs[0],tex.inputs['Vector']);return tex.outputs[0]
base=walnut_texture('diff','sRGB');raw_rough=walnut_texture('rough','Non-Color')
contrast=n.new('ShaderNodeVectorMath');contrast.operation='MULTIPLY_ADD';contrast.inputs[1].default_value=(3,3,3);contrast.inputs[2].default_value=(-.80,-.58,-.42);l.new(base,contrast.inputs[0])
stain=n.new('ShaderNodeMixRGB');stain.blend_type='MULTIPLY';stain.inputs[0].default_value=1;stain.inputs[2].default_value=(.065,.0185,.010,1);l.new(contrast.outputs[0],stain.inputs[1]);l.new(stain.outputs[0],bs.inputs['Base Color'])
rough=n.new('ShaderNodeMath');rough.operation='MULTIPLY_ADD';rough.inputs[1].default_value=.30;rough.inputs[2].default_value=.20;l.new(raw_rough,rough.inputs[0]);l.new(rough.outputs[0],bs.inputs['Roughness'])
# Project the scan's pore height into the baked tangent normal atlas.
bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00035;bump.inputs['Strength'].default_value=.8;l.new(base,bump.inputs['Height']);l.new(bump.outputs[0],bs.inputs['Normal'])
material_sources[wood.name]=(stain.outputs[0],rough.outputs[0],0)
