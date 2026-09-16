"""Compose unretouched captures. Labels and explicitly marked crops sit outside the effects."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import json, math, subprocess, re

scratch=Path('.kite3d/tracers2')
out=Path('/Users/minjunes/games/terminator-evidence/docs/evidence/tracers2')
out.mkdir(parents=True,exist_ok=True)
subprocess.run(['ffmpeg','-v','error','-framerate','20','-i',str(scratch/'burst/%03d.png'),
    '-filter_complex','[0:v]scale=640:360:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    '-t','2','-loop','0','-y',str(out/'m4-burst.gif')],check=True)
assert (out/'m4-burst.gif').stat().st_size<3000000
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf',30)
small=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',27)

def label(im,text,xy=(26,122),face=font):
    d=ImageDraw.Draw(im);box=d.textbbox(xy,text,font=face)
    d.rectangle((box[0]-12,box[1]-8,box[2]+12,box[3]+8),fill=(9,17,22))
    d.text(xy,text,font=face,fill=(231,238,242))

def shot(name,title):
    im=Image.open(scratch/name).convert('RGB')
    assert im.size==(1920,1080)
    label(im,title)
    return im

def compare(filename,rows):
    im=Image.new('RGB',(3840,2160))
    for y,(name,title) in enumerate(rows):
        for x,variant in enumerate(['before','after']):
            im.paste(shot(f'{variant}-{name}.png',f'{title} | {"CURRENT MASTER" if x==0 else "TRACERS 2"}'),(x*1920,y*1080))
    ImageDraw.Draw(im).line((1920,0,1920,2160),fill=(176,189,195),width=3)
    im.save(out/filename,optimize=True)

compare('01-m4-comparison.png',[('m4-20','M4 / 20 m target'),('m4-40','M4 / 40 m target')])
compare('02-sniper-volley-comparison.png',[('sniper-40','SNIPER / 40 m target'),('volley-20','INCOMING VOLLEY / 20 m / balcony height')])

im=Image.new('RGB',(3840,2160),(6,12,18))
ref=Image.open('docs/reference/tracers/night-01.jpg').convert('RGB').resize((1920,1080),Image.Resampling.NEAREST)
label(ref,'M240 NIGHT FOOTAGE | range unreported | source 640 x 360')
im.paste(ref,(0,0))
im.paste(shot('after-m4-20.png','M4 / 20 m | same rear viewing angle; range is not calibrated'),(1920,0))
photo=Image.open('docs/reference/tracers/photo-1.jpg').convert('RGB')
photo=ImageOps.pad(photo,(1920,1080),method=Image.Resampling.LANCZOS,color=(6,12,18))
label(photo,'M240 LONG EXPOSURE | streak length is an upper bound')
im.paste(photo,(0,1080))
label(im,'40 m CORE DETAIL | 8x nearest-neighbour crops, no retouching',(1950,1110))
for i,(name,title) in enumerate([
    ('after-m4-40.png','HIGH / BLOOM'),
    ('after-high-no-bloom.png','HIGH / NO BLOOM'),
    ('after-low-no-bloom.png','LOW / NO BLOOM'),
]):
    detail=Image.open(scratch/name).crop((930,512,990,572)).resize((480,480),Image.Resampling.NEAREST)
    x=1990+i*610
    im.paste(detail,(x,1350))
    label(im,title,(x,1290),small)
label(im,'Core uses 1.5 px minimum coverage. HDR bloom supplies the surrounding light.',(1990,1910),small)
label(im,'The 16 px end-on dash floor preserves visibility. World exposure length stays 3.6 m.',(1990,1970),small)
ImageDraw.Draw(im).line((1920,0,1920,2160),fill=(176,189,195),width=3)
im.save(out/'03-reference-bloom-comparison.png',optimize=True)

# Small isolated ROI excludes the separate muzzle smoke and cases.
def core_pixels(name):
    im=Image.open(scratch/name).convert('RGB')
    pixels=[]
    for y in range(526,555):
        for x in range(948,979):
            r,g,b=im.getpixel((x,y))
            if r>180 and g>100:pixels.append((x,y))
    if not pixels:return {'brightPixels':0}
    mx=sum(x for x,y in pixels)/len(pixels);my=sum(y for x,y in pixels)/len(pixels)
    xx=sum((x-mx)**2 for x,y in pixels);yy=sum((y-my)**2 for x,y in pixels)
    xy=sum((x-mx)*(y-my) for x,y in pixels)
    angle=.5*math.atan2(2*xy,xx-yy)
    across=[-(x-mx)*math.sin(angle)+(y-my)*math.cos(angle) for x,y in pixels]
    along=[(x-mx)*math.cos(angle)+(y-my)*math.sin(angle) for x,y in pixels]
    return {'brightPixels':len(pixels),'lengthPx':round(max(along)-min(along)+1,2),
            'widthPx':round(max(across)-min(across)+1,2)}

runs=[]
for name in ['before-benchmark','after-benchmark','paired-before','paired-after','final-before','final-after','refined-before','refined-after']:
    if not (scratch/f'{name}.json').exists():continue
    r=json.loads((scratch/f'{name}.json').read_text())
    runs.append({'run':name,'capturedAt':r['capturedAt'],'frame':r['frame'],'gpu':r['gpu']['frameMs'],
        'browser':r['browser'],'units':r['scene']['aliveEnemies'],'weaponBurst':r['weaponBurst'],
        'tracers':r['systems']['tracers'],'projectiles':r['systems']['projectiles'],'warnings':r['warnings']})
summary={'runs':runs,'corePixels':{name:core_pixels(name) for name in ['after-m4-20.png','after-m4-40.png','after-high-no-bloom.png','after-low-no-bloom.png']},
    'captures':{name:json.loads((scratch/f'{name}-capture.json').read_text()) for name in ['before','after']},
    'referenceBytes':sum(p.stat().st_size for p in Path('docs/reference/tracers').glob('*.jpg')),
    'gifBytes':(out/'m4-burst.gif').stat().st_size}
summary['testRuns']=[]
for name in ['npm-test.log','npm-test-final.log','npm-test-retry.log']:
    path=scratch/name
    if not path.exists():continue
    log=path.read_text()
    passed=re.search(r'ℹ pass (\d+)',log);failed=re.search(r'ℹ fail (\d+)',log)
    if passed and failed:summary['testRuns'].append({'run':name,'passed':int(passed[1]),'failed':int(failed[1])})
if summary['testRuns']:summary['tests']={'command':'npm test',**summary['testRuns'][-1]}
(out/'metrics.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary['corePixels'],indent=2))
