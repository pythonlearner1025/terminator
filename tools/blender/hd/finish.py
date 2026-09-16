"""Paint the baked atlas at native 2048 resolution. No photograph pixels enter the maps."""
from pathlib import Path
import sys,json
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import gaussian_filter,maximum_filter
ROOT=Path(__file__).resolve().parents[3]
ROUND=int(sys.argv[1]);N=2048
for weapon in ['shotgun','revolver']:
    folder=ROOT/f'.kite3d/hd/round-{ROUND}/{weapon}'
    def read(name):return np.asarray(Image.open(folder/(name+'.png')).convert('RGB'),dtype=np.float32)/255
    colour,orm,normal,ao,curvature=[read(n) for n in ['transfer-albedo','transfer-orm','baked-normal','baked-ao','baked-curvature']]
    polygons=json.loads((folder/'uv-materials.json').read_text())
    woodImage=Image.new('L',(N,N));validImage=Image.new('L',(N,N));wd=ImageDraw.Draw(woodImage);vd=ImageDraw.Draw(validImage)
    for p in polygons:
        poly=[(u*(N-1),(1-v)*(N-1)) for u,v in p['uv']]
        vd.polygon(poly,fill=255)
        if p['wood']:wd.polygon(poly,fill=255)
    wood=np.asarray(woodImage,dtype=np.float32)/255;valid=np.asarray(validImage)>0
    wood=maximum_filter(wood,3)
    y,x=np.mgrid[:N,:N].astype(np.float32)
    worldx=np.zeros((N,N),dtype=np.float32);worldz=np.zeros_like(worldx)
    for p in polygons:
        if not p['wood'] or 'positions' not in p:continue
        uv=np.array([(u*(N-1),(1-v)*(N-1)) for u,v in p['uv']]);positions=np.array(p['positions'])
        for j in range(1,len(uv)-1):
            ids=[0,j,j+1];tri=uv[ids];pos=positions[ids]
            x0,y0=np.maximum(0,np.floor(tri.min(axis=0)).astype(int));x1,y1=np.minimum(N-1,np.ceil(tri.max(axis=0)).astype(int))
            if x1<x0 or y1<y0:continue
            xx=x[y0:y1+1,x0:x1+1];yy=y[y0:y1+1,x0:x1+1]
            a,b,c=tri;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-8:continue
            w0=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
            w1=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;w2=1-w0-w1
            inside=(w0>=-.001)&(w1>=-.001)&(w2>=-.001)
            for target,k in [(worldx,0),(worldz,2)]:
                tile=target[y0:y1+1,x0:x1+1];tile[inside]=(w0*pos[0,k]+w1*pos[1,k]+w2*pos[2,k])[inside]
    rng=np.random.default_rng(7301)
    noise=rng.normal(0,1,(N,N)).astype(np.float32)
    fine=gaussian_filter(noise,.65)
    cloud=gaussian_filter(noise,13);cloud/=max(1e-6,float(cloud.std()))
    cavity=np.clip(ao[:,:,0],0,1)
    # Pointiness separates narrow edge wear from cavity dirt.
    edge=np.clip((curvature[:,:,0]-.5)*12,0,1)
    lum=colour.mean(axis=2)
    local=lum-gaussian_filter(lum,6)
    steel=np.empty_like(colour)
    for c,base in enumerate([.205,.229,.259]):
        steel[:,:,c]=base+local*.17+cloud*.003+fine*.004+edge*.10
    # Existing wood detail transfers into the new layout before this colour adjustment.
    along,cross=(worldx,worldz) if weapon=='shotgun' else (worldz,worldx)
    grain=(np.sin(cross*3100+np.sin(along*45)*2.4)*.009
           +np.sin(cross*280+np.sin(along*12)*4)*.022+local*.2)
    if ROUND>=4:
        grain=(np.sin(cross*6200+np.sin(along*75)*2.4)*.008
               +np.sin(cross*530+np.sin(along*16)*4)*.004+local*.8)
    woodColour=np.stack([.275+grain,.142+grain*.65,.069+grain*.38],axis=2)
    if ROUND>=5:
        if weapon=='shotgun':
            woodColour=colour*np.array([.88,.80,.71],dtype=np.float32)+edge[:,:,None]*.015
        else:
            # Sample the CC0 shotgun's native wood patch. No reference photograph pixels enter this atlas.
            source=np.asarray(Image.open(ROOT/'assets/models/weapons-candidates/shotgun/3dmodels-cc0/main-albedo.png').convert('RGB'),dtype=np.float32)/255
            if ROUND>=6:
                px=np.clip((.04+(.5+worldx*5)*.23)*2047,0,2047).astype(int)
                py=np.clip((.30+(.5+(worldz-.05)*5)*.32)*2047,0,2047).astype(int)
            else:
                px=np.clip((.03+(.5+(worldz-.045)*5)*.26)*2047,0,2047).astype(int)
                py=np.clip((.31+(.5+worldx*7)*.30)*2047,0,2047).astype(int)
            woodColour=source[py,px]*np.array([.9,.80,.71],dtype=np.float32)
    result=steel*(1-wood[:,:,None])+woodColour*wood[:,:,None]
    result*=((.72+.28*cavity)[:,:,None])
    rough=np.clip(.29+cloud*.009+fine*.012+(.08*(1-cavity))-.045*edge,.17,.48)
    rough=rough*(1-wood)+(.40+local*.15+fine*.015)*wood
    metal=.94*(1-wood)
    packed=np.stack([cavity,np.clip(rough,0,1),metal],axis=2)
    # The original selected-to-active bake includes geometric relief and retains tangent-space orientation.
    if (folder/'baked-rest-normal.png').exists():
        # Remove macro shading changes caused by high-source tessellation.
        # Preserve only the normal delta from the actual geometric relief.
        rest=read('baked-rest-normal');transfer=read('transfer-normal')
        vector=(transfer*2-1)+(normal-rest)*2
        if ROUND>=5 and weapon=='shotgun':
            vector=(transfer*2-1)+(normal-rest)*(10 if ROUND>=6 else 5)
        if ROUND>=6 and weapon=='revolver':
            vector=(transfer*2-1)*(1-wood[:,:,None])+np.array([0,0,1])*wood[:,:,None]+(normal-rest)*2
        vector/=np.maximum(np.linalg.norm(vector,axis=2,keepdims=True),1e-6)
        normal=vector*.5+.5
    normal=np.clip(normal,0,1)
    for role,arr in [('albedo',result),('normal',normal),('orm',packed)]:
        Image.fromarray(np.uint8(np.clip(arr,0,1)*255)).save(folder/f'main-{role}.png',optimize=True)
    (folder/'finish.json').write_text(json.dumps({'resolution':N,'seed':7301,
        'albedo':'Transferred source detail, dark blue steel and warm walnut palette, pointiness-based edge wear',
        'normal':'Transferred tangent normal plus the baked geometric relief delta; high-source base shading is subtracted',
        'orm':'R: baked AO. G: oil sheen, wood roughness and cavity dirt. B: steel metalness, zero on wood.',
        'curvature':'Offline high-source pointiness bake. Controls wear. Not loaded by the game.',
        'validUvPixels':int(valid.sum()),'woodPixels':int((wood>.5).sum())},indent=2)+'\n')
    print('PAINTED',weapon,flush=True)
