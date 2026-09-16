"""Compose actual headless captures and attributed reference frames. No image synthesis."""
from pathlib import Path
from urllib.parse import urlparse,unquote
from PIL import Image,ImageDraw,ImageFont
import json
ROOT=Path(__file__).resolve().parents[1]
RAW=Path('/Users/minjunes/games/terminator-evidence/docs/evidence/gun-models/raw')
OUT=Path('/Users/minjunes/games/terminator-evidence/docs/evidence/gun-models');OUT.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype(str(ROOT/'assets/fonts/BarlowCondensed-SemiBold.ttf'),24)
small=ImageFont.truetype(str(ROOT/'assets/fonts/BarlowCondensed-SemiBold.ttf'),20)
report=json.loads((ROOT/'assets/models/weapons/manifest.json').read_text())
captures=json.loads((RAW/'capture.json').read_text())
assert not captures['errors']
def label(im,at,text,width=960):
 d=ImageDraw.Draw(im);x,y=at;d.rectangle((x,y,x+width,y+38),fill=(12,19,25));d.text((x+14,y+6),text,font=font,fill=(224,232,234))
for c in captures['captures']:
 id=c['weapon'];game=Image.open(RAW/(id+'.png')).convert('RGB')
 path=Path(unquote(urlparse(c['reference']).path));reference=Image.open(path).convert('RGB')
 im=Image.new('RGB',(1920,1080),(12,19,25))
 im.paste(game.resize((960,540),Image.Resampling.LANCZOS),(0,0))
 im.paste(reference.resize((960,540),Image.Resampling.LANCZOS),(960,0))
 gamebox=(800,450,1920,1080);refbox=(reference.width*.375,reference.height*.375,reference.width,reference.height)
 if id=='grenade':gamebox=(400,150,1840,960);refbox=(0,0,reference.width,reference.height)
 im.paste(game.crop(gamebox).resize((960,540),Image.Resampling.LANCZOS),(0,540))
 im.paste(reference.crop(refbox).resize((960,540),Image.Resampling.LANCZOS),(960,540))
 label(im,(0,0),f'BUNKER 7 / {id.upper()} / ACTUAL 1920 x 1080 CAPTURE')
 label(im,(960,0),f'KF2 / {path.parent.name}/{path.name} / STUDY ONLY')
 label(im,(0,540),f'DETAIL CROP / {report[id]["triangles"]:,} WEAPON TRIANGLES / 2K PBR')
 label(im,(960,540),'REFERENCE DETAIL / '+('GRENADE OCCLUDED BY ARM' if id=='grenade' else 'SAME SOURCE FRAME'))
 d=ImageDraw.Draw(im);d.line((959,0,959,1080),fill=(146,173,184),width=2)
 im.save(OUT/(id+'.png'),optimize=True)
im=Image.new('RGB',(1920,1080),(12,19,25))
for i,clip in enumerate(['idle','aim','reload']):
 game=Image.open(RAW/('hands-'+clip+'.png')).convert('RGB');x=i*640
 im.paste(game.resize((640,360),Image.Resampling.LANCZOS),(x,42))
 crop=game.crop((560,220,1400,1060)).resize((640,640),Image.Resampling.LANCZOS);im.paste(crop,(x,440))
 label(im,(x,0),f'{clip.upper()} / SAME RIG / INSPECT CAMERA',640)
 label(im,(x,402),'HAND DETAIL CROP / 4,680 TRIANGLES TOTAL',640)
im.save(OUT/'hands.png',optimize=True)
print('Wrote nine 1920 by 1080 composites.')
