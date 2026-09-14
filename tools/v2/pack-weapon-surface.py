"""Lossless ORM packing: preserve precisely the channels sampled by PhysicalMaterial."""
from pathlib import Path
from PIL import Image
import hashlib,json,sys
source=Path('assets/textures/weapons');target=Path('assets/v2/performance')
target.mkdir(parents=True,exist_ok=True)
files={'R':('weapon-ao.png','R'),'G':('weapon-roughness.png','G'),'B':('weapon-metalness.png','B')}
channels=[];manifest={}
for output,(filename,channel) in files.items():
    image=Image.open(source/filename).convert('RGB').getchannel(channel)
    channels.append(image)
    manifest[output]={'source':filename,'channel':channel,'decodedSha256':hashlib.sha256(image.tobytes()).hexdigest()}
assert len({i.size for i in channels})==1
packed=Image.merge('RGB',tuple(channels))
if '--check' not in sys.argv:packed.save(target/'weapon-orm.png',optimize=True)
verify=Image.open(target/'weapon-orm.png')
for channel in files:assert hashlib.sha256(verify.getchannel(channel).tobytes()).hexdigest()==manifest[channel]['decodedSha256']
if '--check' not in sys.argv:(target/'weapon-orm.json').write_text(json.dumps({'size':packed.size,'channels':manifest,'removedRgba8UploadBytes':packed.width*packed.height*4*2,'note':'All channel pixels exact; no resize, quantization or color conversion of samples'},indent=2)+'\n')
print(json.dumps({'bytes':(target/'weapon-orm.png').stat().st_size,'size':packed.size}))
