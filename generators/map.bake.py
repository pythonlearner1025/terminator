"""Reproducible 1K PBR derivatives and 2K decal atlas. Requires Pillow and numpy."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
P=Path('assets/textures/map'); N=1024
rng=np.random.default_rng(712029)
y,x=np.mgrid[:N,:N]
def noise(scale):
 a=Image.fromarray(rng.integers(0,256,(scale,scale),dtype=np.uint8))
 return np.array(a.resize((N,N),Image.Resampling.BICUBIC),dtype=float)/255
fine=noise(512); broad=noise(32); grain=noise(128)
def save(name,a):
 Image.fromarray(np.clip(a,0,255).astype('uint8')).save(P/name,quality=92)
def normals(height,strength=2):
 dx=(np.roll(height,-1,1)-np.roll(height,1,1))*strength
 dy=(np.roll(height,-1,0)-np.roll(height,1,0))*strength
 v=np.stack([-dx,dy,np.ones_like(dx)],axis=-1)
 v/=np.linalg.norm(v,axis=-1)[...,None]
 return (v*.5+.5)*255
src=np.array(Image.open(P/'rusty_metal_02_diff_1k.jpg').resize((N,N)),dtype=float)
base=np.mean(src,axis=2)/255
rust=(src[:,:,0]>src[:,:,2]*1.8)&(base<.7)&(broad+grain*.12>.73)
scratches=Image.new('L',(N,N)); d=ImageDraw.Draw(scratches)
for i in range(220):
 px,py=rng.integers(0,N,2); length=int(rng.integers(2,100))
 d.line((int(px),int(py),int(px+length),int(py+length*.1)),fill=int(rng.integers(60,255)),width=int(rng.integers(1,3)))
scratch=np.array(scratches)/255
for name,color in [('paint',[89,108,104]),('corrugated',[129,139,142])]:
 corr=np.sin(x/N*np.pi*32) if name=='corrugated' else np.zeros_like(x)
 worn=np.maximum(rust*.72,scratch*.5)
 albedo=np.array(color)[None,None,:]*(.83+.16*base[:,:,None])
 albedo=albedo*(1-worn[:,:,None])+(src*np.array([.60,.40,.25]))*worn[:,:,None]
 albedo+=scratch[:,:,None]*35
 height=fine*.10+grain*.17-rust*.12-scratch*.07+corr*2.4
 arm=np.stack([.72+.28*base,.58+rust*.25+grain*.10,.08+scratch*.7],axis=-1)*255
 save(name+'_albedo.jpg',albedo); save(name+'_normal.jpg',normals(height,2.2)); save(name+'_arm.jpg',arm)
# Woven sandbag material with seams, dirt and frayed fibers.
weave=(np.sin(x*.75)*np.cos(y*.75))*.07
seam=np.exp(-((y%512-12)/4)**2)*.5
h=weave+grain*.22+fine*.08-seam
save('canvas_albedo.jpg',np.array([123,119,91])[None,None,:]*(.65+grain[:,:,None]*.5-seam[:,:,None]*.5))
save('canvas_normal.jpg',normals(h,2.2));save('canvas_arm.jpg',np.stack([.75+fine*.25,np.ones_like(x)*.95,np.zeros_like(x)],-1)*255)
# Cracked soot-coated glass, without expensive transmission/refraction.
glass=Image.new('L',(N,N));d=ImageDraw.Draw(glass)
for i in range(24):
 px,py=560,430
 for j in range(9):
  nx=px+(int(rng.integers(-65,65)) if j else int(rng.integers(-150,150)));ny=py+int(rng.integers(-85,85))
  d.line((px,py,nx,ny),fill=180,width=1);px,py=nx,ny
crack=np.array(glass)/255
save('glass_albedo.jpg',np.stack([18+crack*95+grain*5,27+crack*95+grain*6,30+crack*95+grain*8],-1))
save('glass_normal.jpg',normals(crack*.18+fine*.004));save('glass_arm.jpg',np.stack([np.ones_like(x),.1+grain*.12+crack*.4,np.ones_like(x)*.05],-1)*255)
# Four by four atlas; each tile has a 32 px transparent gutter.
S=512;A=Image.new('RGBA',(S*4,S*4)); heights=np.zeros((S*4,S*4));rough=np.ones_like(heights)*.88;metal=np.zeros_like(heights)
for tile in range(16):
 t=Image.new('RGBA',(S,S));d=ImageDraw.Draw(t)
 if tile<4: # oily/grimy drips
  for i in range(160):
   px=int(rng.integers(45,467));py=int(rng.integers(38,140));length=int(rng.integers(40,330))
   d.line((px,py,px+int(rng.integers(-15,15)),min(475,py+length)),fill=(19,21,17,int(rng.integers(10,90))),width=int(rng.integers(1,14)))
  t=t.filter(ImageFilter.GaussianBlur(2))
 elif tile<8: # stains, oil and scorch
  for i in range(220):
   px,py=rng.normal(256,65,2);r=int(rng.integers(8,62))
   d.ellipse((px-r,py-r*.6,px+r,py+r*.6),fill=(11,13,12,int(rng.integers(10,80))))
  t=t.filter(ImageFilter.GaussianBlur(7))
 elif tile<10: # bullet crater clusters
  for i in range(8):
   px,py=rng.integers(85,420,2);r=int(rng.integers(8,19))
   d.ellipse((px-r*1.8,py-r*1.8,px+r*1.8,py+r*1.8),fill=(82,81,74,90))
   d.ellipse((px-r,py-r,px+r,py+r),fill=(147,145,132,220))
   d.ellipse((px-r*.72,py-r*.6,px+r*.72,py+r*.65),fill=(4,7,9,240))
 elif tile<12: # chipped caution paint
  d.rectangle((32,32,480,480),fill=(170,146,69,225))
  for px in range(-512,1024,100): d.polygon([(px,32),(px+45,32),(px+490,480),(px+445,480)],fill=(13,20,23,230))
  for i in range(2600):
   px,py=rng.integers(32,480,2);d.rectangle((px,py,px+int(rng.integers(1,8)),py+2),fill=(0,0,0,0))
 else: # irregular shallow puddles
  yy,xx=np.mgrid[:S,:S];angle=np.arctan2(yy-256,xx-256);r=np.sqrt(((xx-256)/215)**2+((yy-256)/165)**2)
  edge=1+np.sin(angle*7+tile)*.10+np.cos(angle*11)*.06
  alpha=np.clip((edge-r)*14,0,1)*(.86+.08*np.sin(xx*.15)*np.sin(yy*.12))
  rgba=np.zeros((S,S,4),dtype=np.uint8);rgba[:,:,:3]=[38,46,49];rgba[:,:,3]=alpha*210;t=Image.fromarray(rgba)
 ox=(tile%4)*S;oy=(tile//4)*S;A.paste(t,(ox,oy))
 h=np.array(t)[:,:,3]/255
 heights[oy:oy+S,ox:ox+S]=h*(.14 if tile<12 else .002)
 if tile>=12: rough[oy:oy+S,ox:ox+S]=.07;metal[oy:oy+S,ox:ox+S]=.12
A.save(P/'decals_albedo.png',optimize=True)
save('decals_normal.jpg',normals(heights));save('decals_arm.jpg',np.stack([1-heights*.3,rough,metal],-1)*255)
# Per-file provenance for source images and derived assets.
sources=json.loads((P/'sources.json').read_text())
rows=['# Asset licenses','', '## Bunker 7 map, materials and atmosphere','', 'Poly Haven assets are CC0 1.0: https://polyhaven.com/license. Downloaded 2026-09-11.', '', '| File | Source and license |', '| --- | --- |']
for j in sources: rows.append(f"| `{j['file']}` | [Poly Haven asset]({j['source']}), CC0 1.0. Original [download]({j['url']}). |")
for f in sorted(P.iterdir()):
 if f.suffix not in ['.jpg','.png'] or any(str(f)==j['file'] for j in sources):continue
 deriv='Derived from Poly Haven Rusty Metal 02, CC0 1.0, using generators/map.bake.py.' if f.name.startswith(('paint_','corrugated_')) else 'Original procedural bake, generators/map.bake.py. No third party source; project asset.'
 rows.append(f'| `{f}` | {deriv} |')
rows+=['','ARM channels are ambient occlusion (red), roughness (green), metalness (blue). Normal maps are OpenGL tangent space. Source maps are 1K, moon HDRI is 2K, decal atlas is 2K.','']
Path('assets/LICENSES.md').write_text('\n'.join(rows))
print('Baked map textures and per-file licenses')
