"""Bake original 1K roster PBR maps. Deterministic, no reference image pixels."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

out = Path('assets/textures/roster')
out.mkdir(parents=True, exist_ok=True)
n = 1024
y, x = np.mgrid[:n, :n]
rng = np.random.default_rng(2029)
noise = rng.normal(0, 1, (n, n))
u, v = (x % 512) / 511, (y % 512) / 511
tile = x // 512 + (y // 512) * 2
# Each tile is a separate metal finish. Panel grooves, exposed edges, and pits bake into every map.
d = np.minimum.reduce([u, 1-u, v, 1-v])
seam = np.exp(-((d-.023)/.006)**2)
edge = np.exp(-((d-.039)/.008)**2)
recess = np.exp(-((u-.24)/.004)**2)*((v>.15)&(v<.85))
recess += np.exp(-((v-.76)/.006)**2)*((u>.25)&(u<.85))
scratches=Image.new('L',(n,n));draw=ImageDraw.Draw(scratches)
for i in range(750):
 sx=int(rng.integers(n));sy=int(rng.integers(n));length=int(rng.integers(3,70))
 draw.line((sx,sy,sx+length,sy+int(rng.integers(-8,9))),fill=int(rng.integers(30,170)),width=1)
scratch=np.asarray(scratches,dtype=float)/255
cloud=Image.fromarray(rng.integers(0,255,(32,32),dtype='uint8')).resize((n,n),Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(9))
stain=np.asarray(cloud,dtype=float)/255
height = -.16*scratch-.65*seam+.20*edge-.15*recess+noise*.006
track = tile == 3
cleat = np.maximum(0, np.cos(v*np.pi*48))**8
height[track] = (cleat*.5+noise*.008)[track]
base = np.array([[50,61,68],[129,139,145],[19,23,26],[45,49,52]])[tile]
wear = (edge*67 + scratch*85 + noise*1.7 - seam*32 - recess*21 - stain*18)[...,None]
albedo = np.clip(base+wear,0,255).astype('uint8')
albedo[track] = np.clip((base+cleat[...,None]*35+noise[...,None]*3)[track],0,255)
rough = np.array([.59,.30,.79,.55])[tile] + seam*.18-edge*.15-scratch*.18+stain*.11+noise*.013
metal = np.array([.78,1,.35,.86])[tile] - seam*.12
ao = np.clip(1-seam*.55-recess*.25,0,1)

def save(name, data): Image.fromarray(np.clip(data,0,255).astype('uint8')).save(out/name)
def normal(h, strength):
 dy,dx=np.gradient(h);z=np.ones_like(h);a=np.stack([-dx*strength,-dy*strength,z],axis=-1);a/=np.linalg.norm(a,axis=-1)[...,None];return (a*.5+.5)*255
save('hk-albedo.jpg',albedo)
save('hk-normal.png',normal(height,5))
save('hk-orm.png',np.stack([ao,rough,metal],axis=-1)*255)
flow = np.sin(x/n*np.pi*6+np.sin(y/n*np.pi*4)*.65)*.13+np.sin(y/n*np.pi*8+x/n*np.pi*2)*.035
save('liquid-albedo.jpg',np.repeat((206+noise*.8)[...,None],3,axis=-1))
save('liquid-normal.png',normal(flow,22))
save('liquid-orm.png',np.stack([np.ones_like(flow),.045+flow*.025,np.ones_like(flow)],axis=-1)*255)
