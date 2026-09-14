#!/usr/bin/env python3
"""Make the existing licensed quiet concrete crop periodic without blurring grain."""
import hashlib,json,pathlib
import numpy as np
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[2]/'assets/v2/materials'

def periodic(a):
 # Periodic-plus-smooth decomposition. Remove only the smooth boundary mismatch;
 # retain the photographic high-frequency residual (no Gaussian texture blur).
 h,w=a.shape[:2]; boundary=np.zeros_like(a,dtype=np.float64)
 boundary[0]=a[-1]-a[0];boundary[-1]=-boundary[0]
 delta=a[:,-1]-a[:,0];boundary[:,0]+=delta;boundary[:,-1]-=delta
 denominator=2*np.cos(2*np.pi*np.arange(h)/h)[:,None]+2*np.cos(2*np.pi*np.arange(w)/w)[None,:]-4
 denominator[0,0]=1
 smooth=np.fft.fft2(boundary,axes=(0,1))/denominator[:,:,None];smooth[0,0]=0
 return a-np.fft.ifft2(smooth,axes=(0,1)).real

EXPECTED=['a7d583a3b1c5608fc04cf7d425ff6abeb6d82de8d62ccb1446af5f95ccfc86f1','8de9fa5fa13f7520367129c796c55181c17ccd7e2d7f4bbdb30a8fba6482e392','cf82a4dbd211d6b67967d43760a6cde27bd8eb74aa877de4b8fb96653a411894']

def main():
 receipt={'source':'Worn concrete wall / Sousinho, CC-BY-4.0; photo-provenance.json / photo-worn-LICENSE.txt',
 'crop_source_pixels':[15,316,361,531],'metres':[2.51,1.55],'pixels':[512,320],
 'preparation':'Quiet lower-left original UV crop. Periodic-plus-smooth boundary correction in linear albedo/vector-normal/linear ARM; Lanczos resize; normals renormalized. No universal noise, invented relief or whole-map blur.',
 'inputs':[],'outputs':[],'additional_gpu_mib_rgba8_with_mips':2.5}
 for suffix,sha in zip(['albedo.jpg','normal.png','orm.png'],EXPECTED):
  src=ROOT/('photo-worn-'+suffix);raw=src.read_bytes();receipt['inputs'].append({'file':src.name,'sha256':hashlib.sha256(raw).hexdigest()})
  assert hashlib.sha256(raw).hexdigest()==sha, 'Source photo SHA256 mismatch'
  a=np.asarray(Image.open(src).convert('RGB').crop((15,316,361,531)),dtype=np.float64)/255
  if suffix=='albedo.jpg': a=np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
  if suffix=='normal.png': a=a*2-1
  corrected=periodic(a)
  corrected=np.stack([np.asarray(Image.fromarray(corrected[:,:,i].astype('float32'),mode='F').resize((512,320),Image.Resampling.LANCZOS)) for i in range(3)],axis=2)
  if suffix=='normal.png':
   corrected/=np.maximum(np.linalg.norm(corrected,axis=2,keepdims=True),1e-8);corrected=corrected*.5+.5
  if suffix=='albedo.jpg': corrected=np.where(corrected<=.0031308,corrected*12.92,1.055*np.maximum(0,corrected)**(1/2.4)-.055)
  im=Image.fromarray(np.clip(np.round(corrected*255),0,255).astype('uint8'));out=ROOT/('photo-soffit-'+suffix)
  im.save(out,**({'quality':95,'subsampling':0,'optimize':False} if suffix.endswith('jpg') else {'compress_level':9}))
  raw=out.read_bytes();receipt['outputs'].append({'file':out.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 (ROOT/'photo-soffit-provenance.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps(receipt,indent=2))
if __name__=='__main__':main()
