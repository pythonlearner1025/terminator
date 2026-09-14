#!/usr/bin/env python3
"""Copy three verified CC0 study crops into self-contained runtime ownership.
No resampling, fabricated relief, new downloads or height amplification.
"""
import hashlib,json,pathlib,subprocess
COMMIT='3e479643ef6b1ddcbd99f522e09d9d93ed514ee5'
BASE='assets/v2/wall-relief-study/'
OUT=pathlib.Path(__file__).resolve().parents[2]/'assets/v2/materials'
def blob(name):return subprocess.check_output(['git','show',COMMIT+':'+BASE+name])
def main():
 source=json.loads(blob('provenance.json')); outputs=[]
 for src,dst in [('basecolor.png','albedo.png'),('normal-gl.png','normal.png'),('arm.png','orm.png')]:
  data=blob(src); expected=next(x for x in source['outputs'] if x['file']==src)
  sha=hashlib.sha256(data).hexdigest();assert sha==expected['sha256'] and len(data)==expected['bytes']
  name='photo-spall-'+dst;(OUT/name).write_bytes(data)
  outputs.append({'file':name,'study_file':src,'sha256':sha,'bytes':len(data)})
 receipt={k:source[k] for k in ['source','author','license','licenseUrl','sourceUvBounds','sourceBlend','sourceMaterialSettings','patch']}
 receipt.update(study_commit=COMMIT,sourceFiles=[x for x in source['sourceFiles'] if x['asset']=='concrete_layers_02'],outputs=outputs,
  preparation='Exact bytes of verified 512-square study crop [1472,160,1984,672], no map transformation; UV0..1 corresponds to 0.5 x 0.5 metres. Original 2K crop recipe preserved in study commit tools/v2/study-wall-relief.py. No height texture/mesh is loaded by materials.',
  runtime='Sparse jittered, quarter-rotated 0.5m patches over eligible world-metric UVs; inverse normal rotation plus derivative tangent basis. Source normal strength <=1. No geometry displacement.',additional_gpu_mib_rgba8_with_mips=4)
 (OUT/'photo-spall-provenance.json').write_text(json.dumps(receipt,indent=2)+'\n')
 (OUT/'photo-spall-LICENSE.txt').write_text('Concrete Layers 02 — Rob Tuytel / Poly Haven\nhttps://polyhaven.com/a/concrete_layers_02\nCC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/\nPublisher license: https://polyhaven.com/license\n\nExact 512x512 source crop, 0.5x0.5 metres. Three channel bytes copied from\nverified study commit '+COMMIT+'.\nSource URLs/hashes, original UV crop and author normal/displacement calibration\nare recorded in photo-spall-provenance.json. No height amplification.\n')
 print(json.dumps(outputs,indent=2))
if __name__=='__main__':main()
