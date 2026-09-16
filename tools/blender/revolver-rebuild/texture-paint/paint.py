"""Deterministic mesh-aware UV painting. NumPy/Pillow/SciPy CPU only.
No noise overlay. All wear is defined in the gun's meter-space by named regions.
Editable 8-bit masks are saved independently from the composite.
"""
import argparse, json, os
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt, map_coordinates
HERE=Path(__file__).resolve().parent;ROOT=HERE.parent
OUT=ROOT/'generated/texture-paint';SOURCE=ROOT/'source-assets/gun'
LAYERS=SOURCE/'paint-layers';LAYERS.mkdir(exist_ok=True)
p=argparse.ArgumentParser();mode=p.add_mutually_exclusive_group(required=True)
mode.add_argument('--generate-masks',action='store_true',help='Replace editable masks from physical-region definitions, then composite')
mode.add_argument('--composite',action='store_true',help='Use saved editable masks without rewriting them')
args=p.parse_args()
N=2048
objects=json.loads((OUT/'mesh-paint-input.json').read_text())
position=np.zeros((N,N,3),np.float32);normal=np.zeros_like(position)
ids=np.full((N,N),-1,np.int16);material=np.full((N,N),-1,np.int16)
names=['steel','controls','rubber','walnut','brass']
def matid(s):
    return next(i for i,n in enumerate(names) if n in s)
for oi,o in enumerate(objects):
    vertices=np.array(o['vertices'],np.float32);uv=np.array(o['uv'],np.float32)*[N,-N]+[0,N]
    for t in o['triangles']:
        a,b,c=uv[t['l']];lo=np.maximum(np.floor(np.minimum(np.minimum(a,b),c)).astype(int),0);hi=np.minimum(np.ceil(np.maximum(np.maximum(a,b),c)).astype(int),N-1)
        if np.any(hi<lo):continue
        xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
        det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(det)<1e-10:continue
        wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/det
        wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/det;wc=1-wa-wb
        ok=(wa>=-1e-5)&(wb>=-1e-5)&(wc>=-1e-5)
        sy,sx=np.nonzero(ok);py=sy+lo[1];px=sx+lo[0]
        position[py,px]=wa[ok,None]*vertices[t['v'][0]]+wb[ok,None]*vertices[t['v'][1]]+wc[ok,None]*vertices[t['v'][2]]
        normal[py,px]=t['n'];ids[py,px]=oi;material[py,px]=matid(o['materials'][t['m']])

valid=ids>=0;x,y,z=np.moveaxis(position,-1,0)
def obj(*labels):return np.isin(ids,[i for i,o in enumerate(objects) if o['name'] in labels])
def spot(cx,cy,cz,sx,sy,sz):return np.exp(-((x-cx)/sx)**2-((y-cy)/sy)**2-((z-cz)/sz)**2)
def band(v,center,width):return np.exp(-((v-center)/width)**2)
def smooth(a,b,v):
    t=np.clip((v-a)/(b-a),0,1);return t*t*(3-2*t)
steel=material==0;controls=material==1;rubber=material==2;wood=material==3;brass=material==4
barrel=obj('Barrel');cylinder=obj('CylinderGeometry');body=obj('BodyGeometry');frame=obj('Frame')

# Selective contact burnishing. Tapered edge patches, never a blanket curvature mask.
edge=np.zeros((N,N),np.float32)
edge+=barrel*band(x,-.1744,.0019)*(band(z,.072,.007)*smooth(.001,.012,-y)+.3*band(z,.049,.002))
edge+=barrel*band(z,.0484,.0013)*band(abs(y),.012,.0018)*(band(x,-.139,.013)*.9+band(x,-.063,.008)*.38)
edge+=barrel*band(z,.0841,.0011)*band(abs(y),.0064,.0016)*(band(x,-.148,.011)*.9+band(x,-.032,.009)*.38)
edge+=frame*band(z,.0842,.0007)*band(abs(y),.0104,.001)*band(x,.055,.012)*.38
angle=np.arctan2(y,z-.05234)
edge+=cylinder*band(x,.0589,.0011)*(band(angle,-1.05,.24)*.65+band(angle,1.6,.2)*.35)
edge+=obj('TriggerGuard')*spot(.039,-.0047,-.021,.014,.001,.002)*.45
edge+=obj('HammerGeometry')*spot(.106,-.0028,.07,.009,.001,.003)*.65
edge+=obj('LatchGeometry')*spot(.078,-.017,.049,.007,.001,.004)*.38
edge=np.clip(edge,0,1)

# Handling polish uses broad low-frequency, asymmetric contact ellipses.
oil=np.zeros_like(edge)
oil+=body*(spot(.087,-.013,.037,.012,.006,.014)*.8+spot(.095,.013,.017,.012,.004,.017)*.45)
oil+=cylinder*spot(.044,-.023,.056,.017,.005,.012)*.52
oil+=obj('LatchGeometry','TriggerGeometry','HammerGeometry')*.48
oil+=wood*(spot(.137,-.014,-.032,.021,.004,.026)*.72+spot(.131,.014,-.017,.013,.004,.020)*.5)
oil+=rubber*spot(.153,.002,-.041,.02,.014,.028)*.6
oil=np.clip(oil,0,1)

# Grime is concentrated at real occluded recesses, screw seats and manufacturing joints.
ao=np.array(Image.open(SOURCE/'gun-ao.png').convert('RGB').resize((N,N),Image.Resampling.NEAREST),np.uint8)
occlusion=1-ao[:,:,0].astype(np.float32)/255
grime=np.zeros_like(edge)
for cx,cz in [(.084,.028),(.101,.009),(.124,-.023)]:
    radius=np.sqrt((x-cx)**2+(z-cz)**2)
    grime+=band(radius,.00265,.00075)*band(abs(y),.0127,.003)*.6
grime+=barrel*band(z,.0595,.0015)*band(abs(y),.0123,.0015)*smooth(-.13,-.04,x)*.28
grime+=cylinder*(band(x,.006,.0016)+band(x,.059,.0012))*.26
grime+=frame*band(z,.032,.002)*band(x,.008,.02)*.28
grime+=rubber*band(z,-.084,.004)*.28
grime+=wood*band(((x-.136)/.028)**2+((z+.028)/.047)**2,.95,.14)*.26
grime=np.clip(grime*(.8+occlusion*.4),0,.85)

# Sparse directional scuffs: line segments in physical XZ coordinates, localized to
# a single side or curved cylinder band. Each packet has deliberately different angle.
scratch=np.zeros_like(edge)
rng=np.random.default_rng(73019)
packets=[('Barrel',-.164,-.0145,.070,5,.013,.0013,.00052),
         ('Barrel',-.037,-.0145,.064,4,.012,-.0008,.00038),
         ('Barrel',-.046,.0145,.066,4,.009,-.001,.0004),
         ('BodyGeometry',.097,-.012,.028,5,.009,-.003,.0004),
         ('CylinderGeometry',.027,-.025,.050,5,.013,-.006,.0004),
         ('GripLeft',.144,-.014,-.054,4,.008,-.006,.0005)]
strokes=[]
for packet,(name,cx,cy,cz,count,length,slope,width) in enumerate(packets):
    for i in range(count):
        px=cx+rng.uniform(-.006,.006);pz=cz+rng.uniform(-.004,.004)
        dx=length*rng.uniform(.18,1.15);dz=slope*rng.uniform(.25,1.3)+rng.uniform(-.002,.002)
        t=np.clip(((x-px)*dx+(z-pz)*dz)/(dx*dx+dz*dz),0,1)
        dist=np.sqrt((x-(px+t*dx))**2+(z-(pz+t*dz))**2)
        # Pixel footprint softening prevents aliased dash patterns.
        taper=np.sin(np.pi*t)**.45
        interruption=1-.92*np.exp(-((t-.44)/.10)**2) if (i+packet)%3==1 else 1
        stroke=np.exp(-(dist/(width*rng.uniform(.55,1.2)+.00012))**2)*band(y,cy,.004)*obj(name)*(.2+.65*rng.random()**1.5)*taper*interruption
        scratch=np.maximum(scratch,stroke)
        strokes.append({'object':name,'start':[px,cy,pz],'end':[px+dx,cy,pz+dz],'width':width})

# A few explicitly placed accents give the muzzle and cylinder distinct wear
# histories: one long interrupted scrape versus a steeper glancing scuff.
for name,px,cy,pz,dx,dz,width,opacity,gap in [
    ('Barrel',-.171,-.0145,.0705,.015,.0023,.00045,.65,.36),
    ('Barrel',-.159,-.0145,.068,.006,-.0012,.00028,.42,.65),
    ('CylinderGeometry',.020,-.025,.053,.017,-.006,.0005,.66,.62),
    ('CylinderGeometry',.031,-.025,.047,.004,.001,.0003,.45,.4)]:
    t=np.clip(((x-px)*dx+(z-pz)*dz)/(dx*dx+dz*dz),0,1)
    dist=np.sqrt((x-(px+t*dx))**2+(z-(pz+t*dz))**2)
    stroke=np.exp(-(dist/(width+.00012))**2)*band(y,cy,.004)*obj(name)*opacity*np.sin(np.pi*t)**.25*(1-.92*np.exp(-((t-gap)/.09)**2))
    scratch=np.maximum(scratch,stroke)
    strokes.append({'object':name,'start':[px,cy,pz],'end':[px+dx,cy,pz+dz],'width':width,'explicitAccent':True})

# Small fictional rollmark on the broad underlug: text runs muzzle to breech on the
# left and reverses physical X on the right so both read normally from outside.
mark=np.zeros_like(edge)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',64)
def label(text,name,x0,x1,z0,z1,side):
    im=Image.new('L',(1400,140),0);d=ImageDraw.Draw(im);d.text((8,4),text,font=font,fill=255,stroke_width=0)
    box=im.getbbox();im=im.crop(box);a=np.array(im,np.float32)/255
    u=(x-x0)/(x1-x0);u=u if side<0 else 1-u;v=(z1-z)/(z1-z0)
    sampled=map_coordinates(a,[v*(a.shape[0]-1),u*(a.shape[1]-1)],order=1,mode='constant',cval=0)
    return sampled*obj(name)*(y*side>.008)*(abs(normal[:,:,1])>.85)
mark=np.maximum(mark,label('V-07','Barrel',-.128,-.097,.064,.069,-1)*.9)
mark=np.maximum(mark,label('06-1842','Barrel',-.137,-.085,.064,.069,1)*.8)

# Subtle rub-through on walnut/rubber; original walnut grain stays visible.
gripwear=(wood*(spot(.148,-.014,-.06,.012,.002,.013)+spot(.117,.014,.004,.009,.002,.009))*.48
          +rubber*spot(.16,-.006,-.079,.016,.009,.007)*.42)

mask_values={'contact-edge':edge,'handling-oil':oil,'recess-grime':grime,'directional-scratches':scratch,'arsenal-markings':mark,'grip-rub':gripwear}
for name,a in mask_values.items():
    file=LAYERS/(name+'.png')
    if args.generate_masks:Image.fromarray(np.clip(np.rint(a*255),0,255).astype(np.uint8)).save(file)
    # Both modes consume the exact same stored 8-bit values. Compositing never
    # overwrites these artist-editable masks.
    mask_values[name]=np.array(Image.open(file).convert('L'),np.float32)/255
edge,oil,grime,scratch,mark,gripwear=[mask_values[k] for k in mask_values]

base=np.array(Image.open(LAYERS/'original-basecolor.png').convert('RGB').resize((N,N),Image.Resampling.BILINEAR),np.float32)/255
# Existing procedural bake is an immutable input; this is a layer composite.
base[steel]*=np.array([.57,.60,.64])
base[controls]*=np.array([.84,.87,.92])
def mix(color,mask):
    global base
    base=base*(1-mask[:,:,None])+np.array(color,np.float32)*mask[:,:,None]
mix([.50,.52,.54],edge*.85)
rough_scuff=barrel*band(x,-.034,.024)*(y<0)
mix([.58,.60,.61],scratch*(steel|controls)*.9*(1-.90*rough_scuff))
mix([.095,.077,.058],grime*.48)
base*=1-oil[:,:,None]*.07
mix([.26,.16,.085],gripwear*wood)
mix([.29,.18,.095],scratch*wood*.6)
mix([.105,.11,.115],gripwear*rubber)
mix([.47,.48,.46],mark*.7)

rough=np.full((N,N),.5,np.float32);metal=np.zeros((N,N),np.float32)
for mi,r,m in [(0,.46,.88),(1,.48,.82),(2,.79,0),(3,.57,0),(4,.32,.78)]:rough[material==mi]=r;metal[material==mi]=m
rough+=grime*.27-oil*.16-edge*.13-scratch*.065
rough+=scratch*rough_scuff*.23
rough+=steel*(spot(-.102,.012,.07,.032,.005,.01)*.035-spot(-.055,-.012,.068,.019,.005,.009)*.025)
rough+=brass*band(x,.059,.001)*.09
rough-=gripwear*.12;rough-=mark*.035
metal=np.clip(metal-grime*.19+edge*.035,0,1)

# Eight-texel nearest dilation (four at the original 1024 density) keeps filtering
# away from black chart gutters. AO R remains exact nearest 2x2 source replication.
distance,nearest=distance_transform_edt(~valid,return_indices=True)
pad=(~valid)&(distance<=8)
def dilate(a):
    a=a.copy();a[pad]=a[nearest[0][pad],nearest[1][pad]];return a
base=dilate(base);rough=dilate(rough);metal=dilate(metal)
def byte(a):return np.clip(np.rint(a*255),0,255).astype(np.uint8)
Image.fromarray(byte(base)).save(SOURCE/'gun-basecolor.png')
Image.fromarray(np.stack([ao[:,:,0],byte(rough),byte(metal)],axis=-1)).save(SOURCE/'gun-orm.png')
layers={'roughness':rough,'metallic':metal}
for name,a in layers.items():Image.fromarray(byte(a)).save(LAYERS/(name+'.png'))
Image.fromarray(((material+1)*40).astype(np.uint8)).save(LAYERS/'material-regions.png')
Image.fromarray(((ids+1)*8).astype(np.uint8)).save(LAYERS/'object-regions.png')
stats={n:{'texels':int((material==i).sum()),'roughnessMean':float(rough[material==i].mean()),'roughnessStd':float(rough[material==i].std()),'roughnessP05P95':np.percentile(rough[material==i],[5,95]).tolist()} for i,n in enumerate(names)}
(OUT/'paint-statistics.json').write_text(json.dumps({'regions':stats,'aoRedExact2x2Replication':bool(np.array_equal(np.array(Image.open(SOURCE/'gun-orm.png'))[:,:,0],ao[:,:,0])),'resolution':[N,N],'strokes':strokes},indent=2))
print(json.dumps(stats,indent=2))
