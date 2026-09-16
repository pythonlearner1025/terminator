from pathlib import Path
from PIL import Image,ImageDraw
import sys
p=Path(__file__).resolve().parent/'rounds'/('round-'+(sys.argv[1] if len(sys.argv)>1 else '4'))
files=sorted(p.glob('*.png'))
w=480;h=292;out=Image.new('RGB',(w*4,h*((len(files)+3)//4)), '#141c24');draw=ImageDraw.Draw(out)
for i,f in enumerate(files):
 im=Image.open(f).convert('RGB');im.thumbnail((w,h-22));out.paste(im,(i%4*w,i//4*h));draw.text((i%4*w+8,i//4*h+h-18),f.stem,fill='white')
out.save(p/'contact.jpg',quality=90)
