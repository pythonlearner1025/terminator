"""One 1920 x 1080 contact sheet per weapon, including exact fourfold source-pixel crops."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,sys
ROOT=Path(__file__).resolve().parents[3];round_id=sys.argv[1];RAW=ROOT/f'.kite3d/external-rounds/{round_id}';OUT=RAW/'sheets';OUT.mkdir(exist_ok=True)
FONT='/System/Library/Fonts/Supplemental/Arial.ttf';font=ImageFont.truetype(FONT,18);small=ImageFont.truetype(FONT,15)
configs=json.loads((ROOT/'tools/blender/external/candidates.json').read_text())+[dict(id='current-built',weapon='revolver',shippable=False,detailPixels=[535,170])]
ref=Image.open(ROOT/'docs/reference/weapons/pistol/kf2-04.jpg').convert('RGB');photo=Image.open(ROOT/'docs/reference/weapons/pistol/arsenal-03.jpg').convert('RGB')
def paste(board,im,box):
 im=im.convert('RGBA');im.thumbnail((box[2],box[3]),Image.Resampling.LANCZOS);x=box[0]+(box[2]-im.width)//2;y=box[1]+(box[3]-im.height)//2;board.paste(im,(x,y),im)
for weapon in dict.fromkeys(c['weapon']for c in configs):
 rows=[c for c in configs if c['weapon']==weapon and(RAW/f'{weapon}-{c["id"]}-left.png').exists()]
 if not rows:continue
 board=Image.new('RGB',(1920,1080),'#202833');draw=ImageDraw.Draw(board);draw.text((16,12),f'{weapon.upper()} | round {round_id} | source geometry, no decimation | left profile / three quarter / 4x detail / KF2 reference',fill='white',font=font)
 if len(rows)==1:
  c=rows[0];name=f'{weapon}-{c["id"]}';left=Image.open(RAW/f'{name}-left.png');quarter=Image.open(RAW/f'{name}-quarter.png')
  draw.text((18,48),c['id']+(' | licensed candidate'if c.get('shippable')else' | reference only'),fill='#d0e8ff',font=font)
  cx,cy=c.get('detailPixels',[570,225]);crop=left.crop((cx-112,cy-54,cx+112,cy+54)).resize((896,432),Image.Resampling.NEAREST)
  for im,box,label in [(left,(24,104,920,420),'LEFT PROFILE'),(quarter,(984,104,912,420),'THREE QUARTER'),(crop,(24,606,920,432),'4X RECEIVER / SURFACE'),(ref,(984,606,912,432),'KF2 1858 FRAME / FINISH REFERENCE')]:
   draw.text((box[0],box[1]-24),label,fill='white',font=small);paste(board,im,box)
 else:
  height=990//len(rows)
  for i,c in enumerate(rows):
   y=60+i*height;name=f'{weapon}-{c["id"]}';left=Image.open(RAW/f'{name}-left.png');quarter=Image.open(RAW/f'{name}-quarter.png');draw.text((16,y),c['id']+(' | '+c.get('license','reference')if c.get('shippable')else' | reference'),fill='#d0e8ff',font=small)
   cellh=height-26
   paste(board,left,(8,y+24,480,cellh));paste(board,quarter,(488,y+24,480,cellh))
   cx,cy=c.get('detailPixels',[570,225]);crop=left.crop((cx-60,cy-cellh//8,cx+60,cy+cellh//8)).resize((480,4*(2*(cellh//8))),Image.Resampling.NEAREST);paste(board,crop,(970,y+24,480,cellh))
   paste(board,ref,(1452,y+24,460,cellh))
 board.save(OUT/(weapon+'.jpg'),quality=93)
 print(OUT/(weapon+'.jpg'))
