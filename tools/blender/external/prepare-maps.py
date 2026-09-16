"""Keep supplied texture detail. Normalize maps to 2048 and record all derived channels."""
from pathlib import Path
from PIL import Image
import numpy as np,json
ROOT=Path(__file__).resolve().parents[3];CACHE=ROOT/'tools/blender/cache/external'
def image(path,mode='RGB'):
 return Image.open(CACHE/path).convert(mode).resize((2048,2048),Image.Resampling.LANCZOS)
def grey(path):return np.asarray(image(path,'L'))
for c in json.loads((ROOT/'tools/blender/external/candidates.json').read_text()):
 base=ROOT/('assets/models/weapons-candidates' if c['shippable'] else 'assets/reference/weapons')/c['weapon']/c['id'];base.mkdir(parents=True,exist_ok=True)
 sets={'main':c['maps'],**c.get('materials',{})}
 notes=[]
 for name,overrides in sets.items():
  maps={**c['maps'],**overrides};prefix=name.lower().replace(' ','-');neutral=np.full((2048,2048),255,dtype=np.uint8)
  color=image(maps['albedo']);normal=np.array(image(maps['normal']))
  if c.get('normalDX'):normal[:,:,1]=255-normal[:,:,1]
  rough=grey(maps['roughness']) if 'roughness'in maps else np.full_like(neutral,140)
  metal=grey(maps['metallic']) if 'metallic'in maps else np.full_like(neutral,210)
  ao=grey(maps['ao']) if 'ao'in maps else neutral
  if 'specular'in maps:
   spec=grey(maps['specular']);rough=np.clip(210-spec.astype(float)*.55,50,235).astype('uint8');metal=np.clip(spec.astype(float)*1.25,0,240).astype('uint8');notes.append('Specular converted approximately to roughness and metalness; source has no PBR pair.')
  if 'metalSmooth'in maps:
   met=np.array(image(maps['metalSmooth'],'RGBA'));metal=met[:,:,0];rough=255-met[:,:,3]
  if 'rmao'in maps:
   arr=np.array(image(maps['rmao']));rough,metal,ao=arr[:,:,0],arr[:,:,1],arr[:,:,2]
  if 'ao'not in maps and 'rmao'not in maps:notes.append('AO is a neutral white channel; no invented occlusion detail.')
  for role,im in [('albedo',color),('normal',Image.fromarray(normal)),('roughness',Image.fromarray(rough)),('metallic',Image.fromarray(metal)),('ao',Image.fromarray(ao)),('orm',Image.fromarray(np.stack([ao,rough,metal],2)))]:im.save(base/f'{prefix}-{role}.png',optimize=True)
 (base/'conversion.json').write_text(json.dumps({'source':c['source'],'author':c['author'],'license':c['license'],'shippable':c['shippable'],'textureResolution':2048,'sourceTextureSizes':{k:list(Image.open(CACHE/v).size)for k,v in c['maps'].items()},'notes':sorted(set(notes))},indent=2)+'\n')
 print(c['weapon'],c['id'])
