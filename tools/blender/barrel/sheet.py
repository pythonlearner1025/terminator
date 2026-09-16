"""Combine actual Blender views, source images, and an actual runtime capture.
Requires the existing system Pillow package. No generated game image is retouched.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[3];r=int(sys.argv[1]);cache=ROOT/f'tools/blender/cache/round-{r}'
OUT=Path('/Users/minjunes/games/terminator-evidence/docs/evidence/barrel');OUT.mkdir(parents=True,exist_ok=True)
im=Image.new('RGB',(1920,1080),'#141b23');d=ImageDraw.Draw(im)
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)
small=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',15)
def label(x,y,s):d.text((x,y),s,font=font,fill='#dce5ee')
def fit(path,box):
 a=Image.open(path).convert('RGB');a.thumbnail((box[2],box[3]));im.paste(a,(box[0]+(box[2]-a.width)//2,box[1]+(box[3]-a.height)//2))
label(24,12,f'BURN BARREL / ROUND {r} / actual asset / neutral studio + Bunker 7 fire')
for i,(name,title) in enumerate([('three-quarter','THREE QUARTER'),('side','SIDE'),('top','TOP')]):
 fit(cache/(name+'.png'),(20+i*370,70,350,450));label(25+i*370,45,title)
# Pixel crops enlarge exactly 4x with nearest sampling to expose texture resolution.
a=Image.open(cache/'three-quarter.png').convert('RGB')
for x,box,title in [(20,(210,145,290,225),'RIM / 4X PIXELS'),(360,(245,360,325,440),'RUST / 4X PIXELS')]:
 if r==4: box=(420,350,500,430) if x==20 else (360,830,440,910)
 im.paste(a.crop(box).resize((320,320),Image.Resampling.NEAREST),(x,578));label(x,546,title)
fit(cache/'scene-1.png',(700,576,610,344));label(700,546,'BUNKER 7 / ACTUAL FIRE')
ref=ROOT/'docs/reference/props/barrel'
for x,y,w,h,name,title in [(1150,75,240,445,'rusted-fire.png','REAL BURN DRUM'),(1410,75,240,445,'polyhaven-barrel03.png','CC0 BARREL 03'),(1670,75,235,445,'open-head.jpg','CUT OPEN TOP'),(1330,578,280,320,'rust-yard.jpg','RUST + THIN LIP'),(1630,578,270,320,'kf2-drums.jpg','KF2 STEEL / CLOSED')]:
 fit(ref/name,(x,y,w,h));label(x,y-29,title)
label(24,936,'One material. One 1024 atlas set. Two rolling hoops. Sooty open mouth. Real impact holes.')
label(24,968,'Source photos stay outside game assets. KF2 source shows closed drums, not a verified burning prop.')
label(24,1002,'Compare source proportions in LOOK.md. Track measured differences and fixes in ROUNDS.md.')
im.save(OUT/f'round-{r}.png')
if r==4:
 final=Image.new('RGB',(1920,1080));fd=ImageDraw.Draw(final)
 for i in range(4):
  a=Image.open(cache/f'scene-{i+1}.png').convert('RGB').resize((960,540),Image.Resampling.LANCZOS)
  x=(i%2)*960;y=(i//2)*540;final.paste(a,(x,y));fd.rectangle((x+14,y+14,x+280,y+45),fill='#101822');fd.text((x+23,y+21),f'Bunker 7 / original placement {i+1}',font=small,fill='white')
 final.save(OUT/'four-barrels-fire.png')
