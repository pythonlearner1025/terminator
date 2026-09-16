"""Assemble real-time game captures at their recorded wall time, or fixed-step inspections."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,subprocess,sys
folder=Path('tools/blender/swingout/rounds')/((sys.argv[1] if len(sys.argv)>1 else '12')+'-game')
data=json.loads((folder/'telemetry.json').read_text())
for speed in [1,.25]:
 for clip in ['fire','reload']:
  name=f'{clip}-{speed}x';frames=folder/name;rows=[r for r in data['rows'] if r['clip']==clip and r['speed']==speed]
  if data.get('live',False):
   text=[]
   for a,b in zip(rows,rows[1:]):
    text.extend([f"file '{a['frame']:04}.jpg'",f"duration {(b['wallMs']-a['wallMs'])/1000:.6f}"])
   text.append(f"file '{rows[-1]['frame']:04}.jpg'");(frames/'frames.txt').write_text('\n'.join(text)+'\n')
   args=['-f','concat','-safe','0','-i',str(frames/'frames.txt'),'-vsync','vfr']
  else:args=['-framerate',str(60*speed),'-i',str(frames/'%04d.jpg')]
  subprocess.run(['ffmpeg','-y','-loglevel','error',*args,'-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2',str(folder/(name+'.mp4'))],check=True)
  times=[0,.025,.05,.067,.1,.2,.35,.5] if clip=='fire' else [0,.18,.3,.5,.7,.84,.96,1.1,1.3,1.5,1.8,2.,2.2,2.4,2.6,2.9]
  selected=[min(rows,key=lambda r:abs((r['clipTime'] if r['action'].lower()==clip else 0 if r['frame']==0 else 3)-t)) for t in times]
  sheet=Image.new('RGB',(1440,310*((len(selected)+3)//4)),'#18242b');draw=ImageDraw.Draw(sheet)
  for i,r in enumerate(selected):
   im=Image.open(frames/f"{r['frame']:04}.jpg");im.thumbnail((360,280));x=i%4*360;y=i//4*310;sheet.paste(im,(x,y))
   draw.text((x+8,y+285),f"{clip} {speed}x / {r['action']} {r['clipTime']:.3f}s",fill='white')
  sheet.save(folder/(name+'-contact.jpg'),quality=93)
print(folder)
