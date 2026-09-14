#!/usr/bin/env python3
"""Prepare the single CC0 Rubble substrate; no synthesized relief or AI textures.
python3 tools/v2/build-materials.substrate.py --source-dir .kite3d/materials-r4-source [--download]
"""
import argparse, hashlib, json, pathlib, subprocess
import numpy as np
from PIL import Image

SOURCES = {
 'Diffuse': ('diff', '3311b4fa4d234c1ad0f834ba2c8dfd0270bfe3c3be63b9f95121a863cc5e27c8'),
 'nor_gl': ('nor_gl', '37919108373da79d2e7a2a9d2f495878f2f8ea2521373deb877d0e0a792911e7'),
 'arm': ('arm', '9d2b5de25e9c2b50ae2861d7293e5af3f7e7f77abb618571b07e65a02eb1e24b'),
}

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--source-dir',type=pathlib.Path,required=True)
 parser.add_argument('--download',action='store_true')
 args=parser.parse_args(); args.source_dir.mkdir(parents=True,exist_ok=True)
 out=pathlib.Path(__file__).resolve().parents[2]/'assets/v2/materials'
 receipt={'asset':'Rubble','author':'Amal Kumar','source':'https://polyhaven.com/a/rubble',
  'license':'CC0-1.0','license_url':'https://polyhaven.com/license',
  'license_deed':'https://creativecommons.org/publicdomain/zero/1.0/',
  'source_dimensions_metres':[2,2], 'prepared_size':[1024,1024], 'sources':[], 'outputs':[],
  'preparation':'2048 to 1024 Lanczos; diffuse neutralized 75% toward luminance in linear light, no baked lighting/AO; GL normals resized as vectors and renormalized; original ARM channels retained. Alpha was opaque. No height or displacement.',
  'runtime':'Two fixed orthogonal rotations/offsets at native 2 m scan width, blended by broad world-space noise; inverse-rotated tangent normals. Upward floor/roof only; no geometry/UV edits.',
 }
 for key,(suffix,sha) in SOURCES.items():
  url=f'https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/rubble/rubble_{suffix}_2k.png'
  path=args.source_dir/(key+'.png')
  if args.download and not path.exists(): subprocess.run(['curl','-fsSL',url,'-o',str(path)],check=True)
  raw=path.read_bytes(); actual=hashlib.sha256(raw).hexdigest()
  if actual!=sha: raise ValueError(f'{key}: source SHA256 mismatch {actual}')
  im=Image.open(path).convert('RGB'); assert im.size==(2048,2048)
  receipt['sources'].append({'channel':key,'url':url,'bytes':len(raw),'sha256':sha})
  a=np.asarray(im,dtype=np.float32)/255
  if key=='Diffuse':
   lin=np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
   lum=np.sum(lin*np.array([.2126,.7152,.0722]),axis=2,keepdims=True)
   lin=lin*.25+lum*.75
   a=np.where(lin<=.0031308,lin*12.92,1.055*lin**(1/2.4)-.055)
   result=Image.fromarray(np.clip(np.round(a*255),0,255).astype('uint8')).resize((1024,1024),Image.Resampling.LANCZOS)
   name='substrate-rubble-albedo.jpg';result.save(out/name,quality=95,subsampling=0,optimize=False)
  elif key=='nor_gl':
   n=a*2-1
   n=np.stack([np.asarray(Image.fromarray(n[:,:,i],mode='F').resize((1024,1024),Image.Resampling.LANCZOS)) for i in range(3)],axis=2)
   n/=np.maximum(np.linalg.norm(n,axis=2,keepdims=True),1e-8)
   name='substrate-rubble-normal.png';Image.fromarray(np.clip(np.round((n*.5+.5)*255),0,255).astype('uint8')).save(out/name,compress_level=9)
  else:
   name='substrate-rubble-orm.png';im.resize((1024,1024),Image.Resampling.LANCZOS).save(out/name,compress_level=9)
  data=(out/name).read_bytes();receipt['outputs'].append({'file':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
 receipt['additional_gpu_mib_rgba8_with_mips']=16
 (out/'substrate-rubble-provenance.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps(receipt,indent=2))
if __name__=='__main__': main()
