"""Deterministic authored PBR atlas. Python 3, Pillow and NumPy; no downloaded inputs.
Run: python3 assets/textures/weapons/generate.py
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT=Path(__file__).parent
N=512
rng=np.random.default_rng(2029)
y,x=np.mgrid[0:N,0:N]
surfaces=[('steel',(69,77,81),.86,.43),('edge',(142,149,150),.94,.30),('dark',(31,35,38),.78,.53),('rubber',(27,29,27),.01,.82),('glove',(82,81,66),.01,.78),('pad',(34,36,32),.01,.67),('cloth',(68,74,61),.01,.92),('brass',(166,123,59),.88,.29),('red',(106,35,24),.04,.58),('olive',(67,76,47),.12,.71),('white',(192,196,166),.05,.48),('blue',(48,156,182),.25,.28),('pistolMark',(69,77,81),.86,.43),('rifleMark',(45,50,52),.83,.44),('plasmaMark',(64,70,67),.8,.46),('armoryMark',(67,76,47),.12,.71)]
images={k:Image.new('RGB',(2048,2048)) for k in ['albedo','normal','roughness','metalness','ao','emissive']}
font_path=str(OUT.parents[1]/'fonts/BarlowCondensed-SemiBold.ttf')
font=ImageFont.truetype(font_path,33)
small=ImageFont.truetype(font_path,19)
for idx,(name,base,metal,rough) in enumerate(surfaces):
 noise=rng.normal(0,1,(N,N))
 def coarse(scale):
  a=Image.fromarray(np.uint8(rng.uniform(0,255,(scale,scale)))).resize((N,N),Image.Resampling.BICUBIC)
  return np.asarray(a)/255-.5
 mottled=coarse(16)*.7+coarse(55)*.2
 height=noise*.0015
 scratches=Image.new('L',(N,N));d=ImageDraw.Draw(scratches)
 for i in range(200 if metal>.5 else 36):
  px,py=rng.integers(8,N-8,2);length=rng.integers(3,65)
  d.line((int(px),int(py),int(px+length),int(py+rng.integers(-8,9))),fill=int(rng.integers(45,160)),width=1)
 scratch=np.asarray(scratches)/255
 edge=np.minimum.reduce([x,y,N-1-x,N-1-y])
 worn=np.clip(1-edge/(6+8*(mottled+.5)),0,1)*(noise>-.5)
 albedo=np.array(base)[None,None,:]*(1+mottled[:,:,None]*.28+noise[:,:,None]*.013)
 if metal>.5:
  albedo=albedo*(1-(scratch*.26+worn*.4)[:,:,None])+np.array([171,177,174])*(scratch*.26+worn*.4)[:,:,None]
  height-=scratch*.025
 else:
  # Molded rubber stipple or woven glove/sleeve. Baked relief, not vertex paint.
  weave=(np.sin(x*np.pi/3)*np.cos(y*np.pi/3)) if name in ['cloth','glove'] else np.sin(x*1.5)*np.sin(y*1.5)
  height+=weave*.016
  albedo*=1+weave[:,:,None]*.065
  albedo+=worn[:,:,None]*13
 engraving=np.zeros((N,N))
 if idx>=12:
  label=Image.new('L',(N,N));ld=ImageDraw.Draw(label)
  lines={12:['B7 / MODEL 09','9 x 19 mm','SER. 029 - 0718'],13:['RESISTANCE','M4A1  /  5.56','SAFE    SEMI    AUTO'],14:['WESTINGHOUSE','M-27 PHASED PLASMA','40 WATT RANGE'],15:['BUNKER 7','ORDNANCE / 2029','LOT 0718 - R']}[idx]
  for i,line in enumerate(lines):ld.text((30,185+i*52),line,font=font if i==0 else small,fill=210)
  engraving=np.asarray(label)/255
  albedo=albedo*(1-engraving[:,:,None]*.90)+np.array([148,153,136])*engraving[:,:,None]*.06
  height-=engraving*.06
 height+=mottled*.008
 gy,gx=np.gradient(height*10)
 normal=np.stack([-gx,-gy,np.ones_like(gx)],-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
 ao=np.clip(1-scratch*.13-engraving*.25-mottled*.07,.5,1)
 maps={'albedo':albedo,'normal':(normal*.5+.5)*255,'roughness':np.clip(rough+mottled*.17+noise*.007-scratch*.16-worn*.18, .15,.98)*255,'metalness':np.full((N,N),metal*255),'ao':ao*255,'emissive':np.array(base)[None,None,:]*np.ones((N,N,1))*(.9 if name=='blue' else 0)}
 for key,a in maps.items():
  if a.ndim==2:a=np.repeat(a[:,:,None],3,axis=2)
  images[key].paste(Image.fromarray(np.uint8(np.clip(a,0,255))),((idx%4)*N,(idx//4)*N))
for name,img in images.items():
 if name in ['albedo','normal','roughness']:
  img=Image.fromarray(np.uint8(np.clip(np.round(np.asarray(img,dtype=float)/3)*3,0,255)))
 img.save(OUT/f'weapon-{name}.png',optimize=True)
# Bounded VFX use authored alpha maps and the same PBR atlas for solid fragments.
N=256;y,x=np.mgrid[-1:1:complex(N),-1:1:complex(N)];r=np.hypot(x,y);a=np.arctan2(y,x)
cloud=np.ones((N,N))
for size,amount in [(5,.5),(13,.25),(41,.15)]:
 cloud+=((np.asarray(Image.fromarray(np.uint8(rng.uniform(0,255,(size,size)))).resize((N,N),Image.Resampling.BICUBIC))/255)-.5)*amount
for name in ['smoke','muzzle','blast','hole','scorch','shockwave']:
 if name=='smoke':alpha=np.clip(1-r,0,1)**1.6*cloud;rgb=np.full((N,N,3),200)
 elif name=='muzzle':
  rays=np.maximum(0,np.cos(a*7+.6))**12
  alpha=np.clip(1-r/(.28+rays*.65),0,1)**1.4;rgb=np.zeros((N,N,3))+[255,185,67];rgb+=np.clip(1-r/.22,0,1)[:,:,None]*[0,70,188]
 elif name=='blast':
  alpha=np.clip((.95-r)*4,0,1)*cloud
  hot=np.clip(1-r*1.4,0,1)*cloud
  rgb=np.stack([np.full_like(r,255),100+hot*155,22+hot**2*233],-1)
 elif name=='hole':
  jagged=r+np.sin(a*13)*.025+np.sin(a*23)*.013
  alpha=np.clip((.66-jagged)*12,0,1);rgb=np.ones((N,N,3))*(17+np.clip((r-.22)*4,0,1)[:,:,None]*67)
 elif name=='scorch':alpha=np.clip(1-r,0,1)**.7*cloud;rgb=np.zeros((N,N,3))+[21,17,12]
 else:alpha=np.exp(-((r-.77)*30)**2)*.5;rgb=np.zeros((N,N,3))+[219,196,156]
 Image.fromarray(np.uint8(np.clip(np.dstack([rgb,alpha*255]),0,255))).save(OUT/f'fx-{name}.png',optimize=True)
print('Baked six 2048px PBR maps and six 256px effect textures.')
