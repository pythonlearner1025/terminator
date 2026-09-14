#!/usr/bin/env python3
"""Prepare the complete CC0 cast-aggregate photograph at its native 2.1 m scale."""
import argparse,hashlib,json,pathlib,urllib.request
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[2]
FILES=[('albedo.jpg','jpg','diff','33b2e975dee169d7c8e994415d3957d6c311698f72106ac664880d9e0b5021bf'),('normal.png','png','nor_gl','6a8854bd3c11d03cbb41ca539b3774eeae609b7e42d81e8c2513ce751cdeae81'),('orm.png','png','arm','da8b7cf90d5995712f16f6eab5181b3c0fceb5fceb1a2924eea47b2a3fbc4464')]
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--source-dir',type=pathlib.Path,default=ROOT/'.kite3d/materials-r8-source');ap.add_argument('--download',action='store_true');a=ap.parse_args();a.source_dir.mkdir(parents=True,exist_ok=True)
 out=ROOT/'assets/v2/materials';inputs=[];outputs=[]
 for name,fmt,channel,expected in FILES:
  url=f'https://dl.polyhaven.org/file/ph-assets/Textures/{fmt}/1k/gravel_concrete_02/gravel_concrete_02_{channel}_1k.{fmt}'
  src=a.source_dir/name
  if a.download and not src.exists():src.write_bytes(urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=60).read())
  data=src.read_bytes();assert hashlib.sha256(data).hexdigest()==expected,name
  im=Image.open(src);assert im.size==(1024,1024)
  dst=out/('wall-aggregate-'+name)
  if fmt=='jpg':dst.write_bytes(data)
  else:im.convert('RGB').save(dst,optimize=True)
  inputs.append(dict(url=url,sha256=expected,bytes=len(data),size=list(im.size)))
  outputs.append(dict(file=dst.name,sha256=hashlib.sha256(dst.read_bytes()).hexdigest(),bytes=dst.stat().st_size))
 receipt=dict(source='https://polyhaven.com/a/gravel_concrete_02',authors={'photography':'Charlotte Baglioni','processing':'Dario Barresi'},license='CC0-1.0',licenseUrl='https://polyhaven.com/license',metres=[2.1,2.1],sourceFiles=inputs,outputs=outputs,preparation='Complete 1K source image, no crop/rescale/relief amplification. Original JPEG exact; source PNG decoded to 8-bit RGB and losslessly re-encoded. GL normal unrotated, ARM channels R AO / G roughness / B metalness. No baked lighting or synthetic grain.',context='Provider context_01.jpg inspected locally: aggregate embedded in cast pavement, not loose rubble or coursed masonry. Used as exposed cast-concrete mineral substrate on walls; suitability judged by actual game pair.',contextUrl='https://cdn.polyhaven.com/asset_img/renders/gravel_concrete_02/context_01.jpg',runtime='Two continuous inverse-rotated native-scale samples. World-consistent smooth-cast retention, vertical near-wall scope only. Source normal strength <=1; no displacement.',additional_gpu_mib_rgba8_with_mips=16)
 (out/'wall-aggregate-provenance.json').write_text(json.dumps(receipt,indent=2)+'\n')
 (out/'wall-aggregate-LICENSE.txt').write_text('Gravel Concrete 02 — Poly Haven\nPhotography: Charlotte Baglioni; processing: Dario Barresi\nhttps://polyhaven.com/a/gravel_concrete_02\nCC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/\nPublisher license: https://polyhaven.com/license\nFull 2.1 x 2.1 metre 1K image, no crop or height amplification.\nOriginal public download hashes and reproducible preparation: wall-aggregate-provenance.json, tools/v2/build-materials.wall.py.\n')
 print(json.dumps(outputs,indent=2))
if __name__=='__main__':main()
