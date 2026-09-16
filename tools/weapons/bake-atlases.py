"""Original 2K weapon atlases. All pixels are generated here from fixed seeds."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter
import numpy as np
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/models/weapons';N=512
y,x=np.mgrid[:N,:N];u=x/N;v=y/N
names=['steel','edge','dark','polymer','wood','glove','cloth','brass','red','olive','white','cell','mark','knuckle','rubber','glass']
base=[(79,89,99),(149,154,155),(34,41,47),(48,49,42),(99,55,29),(70,73,63),(76,84,57),(181,133,65),(139,44,23),(62,74,41),(191,181,111),(56,172,204),(79,89,99),(33,38,30),(28,30,26),(29,58,62)]
metals=[.98,.99,.85,.01,0,0,0,.96,.02,.06,.05,.15,.97,.01,0,.83]
rough=[.38,.26,.53,.68,.39,.76,.94,.28,.59,.65,.56,.22,.38,.59,.86,.12]
font=str(ROOT/'assets/fonts/BarlowCondensed-SemiBold.ttf');small=ImageFont.truetype(font,24);tiny=ImageFont.truetype(font,15)
labels={'pistol':['E. REMINGTON & SONS','NEW ARMY / B7','1858   No. 0718'], 'm4':['RESISTANCE ARMORY','CAL. 5.56 / B7-M4','SAFE  SEMI  AUTO'], 'shotgun':['BUNKER 7 ARMORY','12 GA / 76 mm','M4 FIELD CONVERSION'], 'plasma':['WESTINGHOUSE','PHASED PLASMA / M27','CAUTION / HIGH ENERGY'], 'sniper':['M14 EBR / 7.62','BUNKER 7 ARMORY','SERIAL 029-0718'], 'launcher':['M79 / 40 mm','RESISTANCE ORDNANCE','B7  2029'], 'knife':['B7 / FIELD KNIFE','RESISTANCE','CARBON STEEL'], 'grenade':['HE / B7','LOT 0718','2029'], 'hands':['B7','RESISTANCE','ISSUED 2029']}
license=[]
for wi,(weapon,label) in enumerate(labels.items()):
 rng=np.random.default_rng(1858+wi*7919);directory=OUT/weapon;directory.mkdir(exist_ok=True)
 images={k:Image.new('RGB',(2048,2048)) for k in ['albedo','normal','orm']+(['emissive'] if weapon=='plasma' else [])}
 for i,name in enumerate(names):
  def noise(n):return np.asarray(Image.fromarray(np.uint8(rng.uniform(0,255,(n,n)))).resize((N,N),Image.Resampling.BICUBIC),dtype=float)/255-.5
  coarse=noise(12);mid=noise(48);fine=rng.normal(0,1,(N,N));color=np.array(base[i],dtype=float)
  if weapon=='pistol' and name in ['steel','mark']:color=np.array([62,74,87])
  if weapon=='m4' and name in ['steel','mark']:color=np.array([67,73,72])
  if weapon=='m4' and name=='polymer':color=np.array([108,99,73])
  if weapon=='shotgun' and name in ['steel','mark']:color=np.array([60,65,70])
  if weapon=='plasma' and name in ['steel','mark']:color=np.array([104,114,116])
  grain=np.sin(x*.15+noise(8)*5+y*.002)+.45*np.sin(x*.37+noise(5)*11)
  h=fine*.00035+mid*.0007;albedo=color[None,None,:]*(1+coarse[:,:,None]*.07+mid[:,:,None]*.025)
  edge=np.minimum.reduce([x,y,N-1-x,N-1-y]);wear=np.clip(1-edge/(9+18*(coarse+.5)),0,1)*(fine>-.8)
  scratches=Image.new('L',(N,N));d=ImageDraw.Draw(scratches)
  for j in range(120 if metals[i]>.5 else 35):
   sx,sy=rng.integers(3,N-3,2);length=rng.integers(2,48);d.line((int(sx),int(sy),int(sx+length),int(sy+rng.integers(-5,5))),fill=int(rng.integers(10,110)),width=1)
  scratch=np.asarray(scratches)/255
  if metals[i]>.5:
   exposed=wear*.52+scratch*.22
   albedo=albedo*(1-exposed[:,:,None])+np.array([175,177,173])*exposed[:,:,None]
   h-=scratch*.006
   albedo*=1+np.sin(y*2.1)[:,:,None]*.009
  if name=='wood':
   if weapon=='launcher':grain=np.sin(y*.15+noise(8)*5+x*.002)+.45*np.sin(y*.37+noise(5)*11)
   knots=np.sin(x*.075+7*np.sin(y*.006)+noise(5)*6);dark=(grain*.065+knots*.035+coarse*.08)
   albedo=color[None,None,:]*(1+dark[:,:,None]);h+=grain*.003+knots*.002
   albedo+=wear[:,:,None]*np.array([24,20,14])
  if name in ['glove','cloth','knuckle','polymer','rubber']:
   weave=np.sin(x*2.1)*np.cos(y*2.1)
   if name=='cloth':weave=np.sin((x+y)*1.1)*.7+np.cos(y*2.1)*.3
   h+=weave*(.007 if name=='cloth' else .003)+noise(96)*.006
   albedo*=1+weave[:,:,None]*.065
   albedo+=wear[:,:,None]*9
  if name in ['glove','cloth','knuckle']:
   seam=Image.new('L',(N,N));d=ImageDraw.Draw(seam)
   d.rounded_rectangle((30,30,482,482),radius=60,outline=150,width=4)
   for j in range(55,460,11):
    for line in [43,469]:d.line((j,line,j+5,line+1),fill=245,width=2);d.line((line,j,line+1,j+5),fill=245,width=2)
   if name=='cloth':d.line((120,0,145,511),fill=100,width=3)
   st=np.asarray(seam)/255;h+=st*.012;albedo=albedo*(1-st[:,:,None]*.18)+st[:,:,None]*35
  engr=np.zeros((N,N))
  if name=='mark':
   stamp=Image.new('L',(N,N));d=ImageDraw.Draw(stamp)
   for j,line in enumerate(label):d.text((28,182+j*42),line,font=small if j==0 else tiny,fill=230)
   engr=np.asarray(stamp)/255;albedo=albedo*(1-engr[:,:,None]*.75);h-=engr*.025
  if name=='glass':
   albedo=color[None,None,:]*(1+coarse[:,:,None]*.05);h=fine*.0001
  gy,gx=np.gradient(h*12);normal=np.stack([-gx,-gy,np.ones_like(gx)],-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
  ao=np.clip(1-engr*.28-scratch*.12-coarse*.05,.4,1)
  r=np.clip(rough[i]+coarse*.06+mid*.025-wear*.15-scratch*.13,.10,.98)
  maps={'albedo':albedo,'normal':(normal*.5+.5)*255,'orm':np.stack([ao,r,np.full_like(ao,metals[i])],-1)*255}
  if 'emissive' in images:maps['emissive']=np.broadcast_to(color,(N,N,3))*(.95 if name=='cell' else 0)
  for kind,a in maps.items():
   if kind=='normal':a=np.round(a/2)*2
   images[kind].paste(Image.fromarray(np.uint8(np.clip(a,0,255))),((i%4)*N,(i//4)*N))
 for kind,im in images.items():
  ext='jpg' if kind=='albedo' else 'png';file=directory/f'{weapon}-{kind}.{ext}'
  if ext=='jpg':im.save(file,quality=92,subsampling=0,optimize=True)
  else:im.save(file,optimize=True)
  license.append(f'| `models/weapons/{weapon}/{file.name}` | Original procedural bake, tools/weapons/bake-atlases.py | CC0-1.0 |')
 for ext in ['gltf','bin']:
  license.append(f'| `models/weapons/{weapon}/{weapon}.{ext}` | Original geometry, tools/build-weapon-assets.mjs | CC0-1.0 |')
 print(weapon,flush=True)
licensefile=ROOT/'assets/LICENSES.md';prior=licensefile.read_text();marker='\n## Weapon model atlases\n';prior=prior.split(marker)[0]
licensefile.write_text(prior+marker+'\nAll maps are 2048 by 2048 pixels. ORM packs AO, roughness, and metalness. No reference pixels are used.\n\n| File | Source | License |\n| --- | --- | --- |\n'+'\n'.join(license)+'\n')
