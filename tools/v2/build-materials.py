#!/usr/bin/env python3
"""Deterministic, seamless V2 surface bakes; only writes assets/v2/materials.
Requires Python 3, Pillow and numpy. Existing CC0 PBR images are read-only inputs.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/v2/materials'
SRC = ROOT / 'assets/textures/map'
N = 1024
SEED = 19842029
rng = np.random.default_rng(SEED)

def prepare_selected(directory):
    """Verify supplied receipts, then rectify UV islands into planar photo strips."""
    import io, sys, zipfile
    directory = Path(directory)
    manifests = []
    for uid, family, dims in [
        ('51c6567b2d524f179254667176f60a3a', 'worn', (1536, 560)),
        ('893893fc88104dd8a3bd66333411acd2', 'leaking', (2048, 256)),
    ]:
        receipt = json.loads((directory / (uid+'.json')).read_text())
        payload = (directory / (uid+'.zip')).read_bytes()
        archive_hash = hashlib.sha256(payload).hexdigest()
        if archive_hash != receipt['sha256'] or len(payload) != receipt['bytes']:
            raise ValueError('Selected archive receipt mismatch: '+uid)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            if family == 'leaking':
                # Inspect/credit this verified scan, but do not manufacture coverage
                # across its disconnected front/back atlas sections.
                license_text=archive.read('license.txt').decode()
                (OUT/'photo-leaking-LICENSE.txt').write_text(license_text)
                manifests.append({'id':uid,'family':family,'archive_sha256':archive_hash,
                    'archive_bytes':len(payload),'license':'CC-BY-4.0','attribution':license_text,
                    'excluded_reason':'Disconnected scanned wall panels and color-only unlit material; not used for generic PBR projection. Worn source provides complete aligned albedo/normal/roughness.', 'outputs':{}})
                continue
            gltf = json.loads(archive.read('scene.gltf'))
            buffers = [archive.read(b['uri']) for b in gltf['buffers']]
            def accessor(index):
                a = gltf['accessors'][index]; v = gltf['bufferViews'][a['bufferView']]
                dtype = np.dtype({5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']])
                width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
                return np.ndarray((a['count'],width), dtype=dtype, buffer=buffers[v['buffer']],
                    offset=v.get('byteOffset',0)+a.get('byteOffset',0),
                    strides=(v.get('byteStride',dtype.itemsize*width),dtype.itemsize))
            # Worn source is a planar Y/Z strip split into rotated UV islands.
            # Leaking mesh 0 is the scanned X/Z front, mesh 1 the reverse surface.
            prim = gltf['meshes'][0]['primitives'][0]
            pos = accessor(prim['attributes']['POSITION'])
            uv = accessor(prim['attributes']['TEXCOORD_0'])
            normals = accessor(prim['attributes']['NORMAL'])
            triangles = accessor(prim['indices']).reshape(-1,3)
            horizontal = -pos[:,1] if family=='worn' else pos[:,0]
            vertical = pos[:,2]
            bounds = [float(horizontal.min()),float(horizontal.max()),float(vertical.min()),float(vertical.max())]
            width,height = dims
            xy = np.stack([(horizontal-bounds[0])/(bounds[1]-bounds[0])*(width-1),
                (bounds[3]-vertical)/(bounds[3]-bounds[2])*(height-1)],axis=1)
            specs = [('albedo', 'baseColor.jpeg')]
            if family=='worn': specs += [('normal','normal.png'),('orm','metallicRoughness.png')]
            sources={}
            for key,suffix in specs:
                member=next(n for n in archive.namelist() if n.startswith('textures/') and n.endswith(suffix))
                sources[key]=(member,np.asarray(Image.open(io.BytesIO(archive.read(member))).convert('RGB')))
            output={key:np.zeros((height,width,3),dtype=np.float32) for key in sources}
            coverage=np.zeros((height,width),dtype=bool)
            for indices in triangles:
                pts=xy[indices]; a,b,c=pts
                determinant=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
                if abs(determinant)<1e-7: continue
                xmin=max(0,int(np.floor(pts[:,0].min()))); xmax=min(width-1,int(np.ceil(pts[:,0].max())))
                ymin=max(0,int(np.floor(pts[:,1].min()))); ymax=min(height-1,int(np.ceil(pts[:,1].max())))
                yy,xx=np.mgrid[ymin:ymax+1,xmin:xmax+1]
                wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/determinant
                wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/determinant
                wc=1-wa-wb; mask=(wa>=-1e-5)&(wb>=-1e-5)&(wc>=-1e-5)
                if not mask.any(): continue
                weights=np.stack([wa[mask],wb[mask],wc[mask]],axis=1)
                coords=weights@uv[indices]; ys=yy[mask]; xs=xx[mask]
                for key,(member,texture) in sources.items():
                    sx=np.clip(coords[:,0]%1,0,1)*(texture.shape[1]-1)
                    sy=np.clip(coords[:,1]%1,0,1)*(texture.shape[0]-1)
                    ix=sx.astype(int);iy=sy.astype(int);fx=(sx-ix)[:,None];fy=(sy-iy)[:,None]
                    jx=np.minimum(ix+1,texture.shape[1]-1);jy=np.minimum(iy+1,texture.shape[0]-1)
                    values=(texture[iy,ix]*(1-fx)+texture[iy,jx]*fx)*(1-fy)+(texture[jy,ix]*(1-fx)+texture[jy,jx]*fx)*fy
                    if key=='normal':
                        # glTF tangent/handedness reconstructs each atlas island's
                        # local normal; project into strip U=-Y, V=+Z, N=-X.
                        tangents=accessor(prim['attributes']['TANGENT'])[indices]
                        t=weights@tangents[:,:3]; n=weights@normals[indices]
                        sign=(weights@tangents[:,3])[:,None]; bt=np.cross(n,t)*sign
                        v=values/127.5-1
                        local=t*v[:,0,None]+bt*v[:,1,None]+n*v[:,2,None]
                        canonical=np.stack([-local[:,1],local[:,2],-local[:,0]],axis=1)
                        canonical/=np.maximum(np.linalg.norm(canonical,axis=1,keepdims=True),1e-8)
                        values=(canonical*.5+.5)*255
                    output[key][ys,xs]=values
                coverage[ys,xs]=True
            # Trim scan edge/background rather than filling irregular topology holes.
            crop=(16,12,width-16,height-12) if family=='worn' else (20,28,width-20,height-24)
            used=coverage[crop[1]:crop[3],crop[0]:crop[2]]
            if not used.all():
                # Fill only isolated raster cracks from nearest horizontal covered pixel.
                for y in range(height):
                    good=np.flatnonzero(coverage[y]);bad=np.flatnonzero(~coverage[y])
                    if not len(good): continue
                    nearest=np.clip(np.searchsorted(good,bad),0,len(good)-1)
                    for values in output.values(): values[y,bad]=values[y,good[nearest]]
            files={}
            for key,values in output.items():
                im=Image.fromarray(np.uint8(np.clip(values,0,255))).crop(crop)
                path=OUT/f'photo-{family}-{key}.{"jpg" if key=="albedo" else "png"}'
                if key=='albedo': im.save(path,quality=93,subsampling=0,optimize=True)
                else: im.save(path,optimize=True)
                files[path.name]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'size':list(im.size),'bytes':path.stat().st_size}
            license_text=archive.read('license.txt').decode()
            (OUT/f'photo-{family}-LICENSE.txt').write_text(license_text)
            manifests.append({'id':uid,'family':family,'archive_sha256':archive_hash,'archive_bytes':len(payload),
                'license':'CC-BY-4.0','attribution':license_text,'source_members':{k:{'path':v[0],'sha256':hashlib.sha256(archive.read(v[0])).hexdigest()} for k,v in sources.items()},
                'source_position_bounds':bounds,'source_uv_min':uv.min(0).tolist(),'source_uv_max':uv.max(0).tolist(),
                'raster_size':list(dims),'trim_pixels':list(crop),'covered_before_hole_fill':float(used.mean()),
                'preparation':'Barycentric glTF POSITION/TEXCOORD_0 planar rectification, bilinear photo resampling; worn normals rotated by original TANGENT/NORMAL frame; edge trim; scan microholes filled along scanline. No synthetic cracks, color lighting, or invented photographic detail.',
                'outputs':files})
    (OUT/'photo-provenance.json').write_text(json.dumps({'schema':1,'command':'python3 tools/v2/build-materials.py --selected <receipt-directory>',
        'normal_convention':'OpenGL tangent-space; no normal/roughness invented for color-only leaking scan',
        'projection_meters':{'worn':[10.92,3.87],'leaking':[8.1,.81]},'sources':manifests},indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'verified_archives':len(manifests),'outputs':sum(len(m['outputs']) for m in manifests)}))

if __name__ == '__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='--selected':
        OUT.mkdir(parents=True,exist_ok=True)
        prepare_selected(sys.argv[2])
        raise SystemExit(0)



def noise(cells):
    # Wrap a random lattice before resizing and crop the central repeat.
    grid = rng.random((cells, cells)).astype('float32')
    tiled = np.tile(grid, (3, 3))
    resized = Image.fromarray(tiled, mode='F').resize((N*3, N*3), Image.Resampling.BICUBIC)
    return np.clip(np.asarray(resized)[N:2*N, N:2*N], 0, 1)

def source(name):
    return np.asarray(Image.open(SRC / name).convert('RGB').resize((N,N)), dtype=np.float32)/255

def save(name, data):
    im = Image.fromarray(np.uint8(np.clip(data,0,1)*255+.5))
    if name.endswith('.jpg'): im.save(OUT/name, quality=94, subsampling=0, optimize=True)
    else: im.save(OUT/name, optimize=True)

def cracks(count):
    img = Image.new('L',(N,N))
    draw = ImageDraw.Draw(img)
    for _ in range(count):
        x,y = rng.uniform(0,N,2)
        angle = rng.uniform(0, np.pi*2)
        points=[(x,y)]
        for _ in range(int(rng.integers(8,28))):
            angle += rng.uniform(-.65,.65)
            x += np.cos(angle)*rng.uniform(6,25)
            y += np.sin(angle)*rng.uniform(6,25)
            points.append((x,y))
        for ox in [-N,0,N]:
            for oy in [-N,0,N]:
                draw.line([(a+ox,b+oy) for a,b in points], fill=int(rng.integers(130,255)), width=int(rng.integers(1,4)))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(.5)), dtype=np.float32)/255

OUT.mkdir(parents=True,exist_ok=True)
for family in ['ground','concrete']:
    broad = noise(7)
    medium = noise(30)
    fine = noise(160)
    grain = rng.random((N,N))
    split = cracks(27 if family=='ground' else 16)
    # Actual source color/aggregate survives; soot/dust add irregular, achromatic variation.
    original = source('hangar_concrete_floor_diff_1k.jpg' if family=='ground' else 'concrete_wall_007_diff_1k.jpg')
    aggregate = source('asphalt_02_diff_1k.jpg')
    base = original*.62+aggregate*.38 if family=='ground' else original
    luminance = base @ np.array([.2126,.7152,.0722])
    soot = np.clip((.48-broad)*3.0,0,.8)
    chips = np.clip((fine-.58)*4.7,0,1)*(medium>.40)
    brightness = .62 + broad*.30 + medium*.18 + (grain-.5)*.09 - split*.52 - soot*.26
    rgb = (base*.35+luminance[:,:,None]*.65)*brightness[:,:,None]
    rgb += chips[:,:,None]*np.array([.085,.081,.075])
    height = .40 + (medium-.5)*.22+(fine-.5)*.20+chips*.22-split*.26+(grain-.5)*.055
    roughness = np.clip(.87 + (medium-.5)*.18 + soot*.08 - chips*.22, .57,.99)
    cavity = np.clip(1-split*.7-soot*.28, .23,1)
    save(f'{family}-albedo.jpg',rgb)
    save(f'{family}-surface.png',np.dstack([height,roughness,cavity]))

inputs=['hangar_concrete_floor_diff_1k.jpg','concrete_wall_007_diff_1k.jpg','asphalt_02_diff_1k.jpg']
manifest={
 'schema':1,'seed':SEED,'resolution':[N,N],
 'generator':'tools/v2/build-materials.py',
 'license':'Derived from existing Poly Haven CC0 1.0 maps, with original deterministic procedural fracture, soot, dust and aggregate layers. No downloads or paid assets.',
 'license_url':'https://polyhaven.com/license',
 'sources':[{'file':'assets/textures/map/'+f,'sha256':hashlib.sha256((SRC/f).read_bytes()).hexdigest(),'source':'https://polyhaven.com/a/'+f.removesuffix('_diff_1k.jpg')} for f in inputs],
 'maps':{'*-albedo.jpg':'sRGB base color','*-surface.png':'linear R height, G roughness, B cavity'},
 'physical_scale_meters':{'ground':2,'concrete':2.8},
 'outputs':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(OUT.iterdir()) if p.suffix in ['.jpg','.png']}
}
(OUT/'provenance.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'outputs':len(manifest['outputs']),'bytes':sum((OUT/f).stat().st_size for f in manifest['outputs']),'seed':SEED}))
