"""Label raw headless captures. Insets only enlarge existing pixels."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont
src=Path('/Users/minjunes/games/terminator-evidence/docs/evidence/bullets/raw')
out=Path('/Users/minjunes/games/terminator-evidence/docs/evidence/bullets');out.mkdir(parents=True,exist_ok=True)
data=json.loads((src/'results.json').read_text())
font_path='/System/Library/Fonts/Supplemental/Arial.ttf'
font=lambda n:ImageFont.truetype(font_path,n)
labels={'m4':('M4 / 20 m / 0.1x','Three core shots. Three bodies in flight. No hit effects yet.'),
 'shotgun':('SHOTGUN / 20 m / 0.1x','Eight authoritative pellets. Each body follows its recorded path.'),
 'sniper':('SNIPER / 40 m / 0.1x','One longer, brighter round. Target effects await arrival.')}
for index,weapon in enumerate(labels,1):
 im=Image.open(src/f'{weapon}.png').convert('RGB');d=ImageDraw.Draw(im)
 d.rounded_rectangle((28,82,780,300),16,fill='#101b24',outline='#88acb8',width=1)
 d.text((50,102),labels[weapon][0],font=font(27),fill='#ffffff')
 d.text((50,147),labels[weapon][1],font=font(20),fill='#c1d3dd')
 d.text((50,181),'Copper body + hot base. Short, faint heat wake.',font=font(20),fill='#c1d3dd')
 d.text((50,229),'INSET: same frozen round, close inspection camera.' if weapon=='sniper' else 'INSET: native pixels enlarged 4x. No added flight marks.',font=font(18),fill='#81b2b8')
 raw=Image.open(src/f'{weapon}.png')
 pixels=[b['pixel'] for b in data[weapon]['bullets']]
 left=int(min(p[0] for p in pixels))-25;top=int(min(p[1] for p in pixels))-25
 right=int(max(p[0] for p in pixels))+26;bottom=int(max(p[1] for p in pixels))+26
 crop=raw.crop((left,top,right,bottom)).resize(((right-left)*4,(bottom-top)*4),Image.Resampling.NEAREST)
 if weapon=='sniper':
  crop=Image.open(src/'sniper-profile.png').crop((600,320,1320,760))
 im.paste(crop,(1918-crop.width-28,82))
 d.rectangle((1918-crop.width-29,81,1890,82+crop.height),outline='#81b2b8',width=1)
 d.text((1918-crop.width-28,92+crop.height),'Inspection camera / same round' if weapon=='sniper' else '4x / flight bodies',font=font(18),fill='#10222d')
 im.save(out/f'0{index}-{weapon}.png',optimize=True)
# A comparison panel contains the source frame and unmodified game capture.
im=Image.new('RGB',(1920,1080),'#101820');d=ImageDraw.Draw(im)
d.text((40,28),'BULLET BODY STUDY / KF2 TO WEAPONS LAB',font=font(32),fill='white')
d.text((40,90),'KF2 / source frame 066 / 03:14.167 / 854 x 480',font=font(23),fill='#bccfd5')
d.text((1000,90),'WEAPONS LAB / M4 / 20 m / 0.1x',font=font(23),fill='#bccfd5')
ref=Image.open('docs/reference/bullets/frames/frame-066.jpg').convert('RGB')
game=Image.open(src/'m4.png').convert('RGB')
im.paste(ref.resize((880,495)),(40,140));im.paste(game.resize((880,495)),(1000,140))
# Same 6x magnification of native-resolution crops.
refcrop=ref.crop((402,218,460,267)).resize((348,294),Image.Resampling.NEAREST)
b=data['m4']['bullets'][-1]['pixel'];x,y=map(round,b)
gamecrop=game.crop((x-29,y-24,x+29,y+25)).resize((348,294),Image.Resampling.NEAREST)
im.paste(refcrop,(40,669));im.paste(gamecrop,(1000,669))
for x,texts in [(410,['Source crop / 6x native pixels','Compact warm body.','Bright edge. Darker center.','No long light streak.']), (1370,['Game crop / 6x native pixels','Lit copper jacket.','Emissive rear cap.','Flight speed: 60 m/s.'])]:
 for i,line in enumerate(texts):d.text((x,685+i*45),line,font=font(21),fill='#d4e2e5')
d.text((40,1004),'Speed is a visual calibration. The video does not calibrate metres, field of view, or time dilation.',font=font(23),fill='#e8c784')
im.save(out/'04-reference-comparison.png',optimize=True)
# The thirty captured frames represent two wall-clock seconds at 0.25x.
import subprocess
subprocess.run(['ffmpeg','-y','-v','error','-framerate','15','-i',str(src/'gif-%03d.png'),
 '-vf','fps=15,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
 '-loop','0',str(out/'m4-025x.gif')],check=True)
assert (out/'m4-025x.gif').stat().st_size < 3_000_000
