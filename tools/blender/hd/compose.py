"""Four-column, three-angle sheets. Originals and drafts use the same camera."""
import sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageOps
ROOT=Path(__file__).resolve().parents[3]
n=int(sys.argv[1]);out=ROOT/'tools/blender/hd/rounds'
refs=ROOT/'docs/reference/weapons/hd'
sheet=Image.new('RGB',(1920,1080),(24,27,33));draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
for col,title in enumerate(['CC0 ORIGINAL',f'HD DRAFT | ROUND {n}','KF2 REFERENCE ONLY','REAL PHOTO REFERENCE']):
    draw.text((col*480+14,14),title,font=font,fill=(230,234,240))

def crop4(im,center):
    w,h=im.size;cw,ch=w//4,h//4;x,y=center
    return im.crop((int(x-cw/2),int(y-ch/2),int(x+cw/2),int(y+ch/2)))

for wi,(weapon,kf,photo) in enumerate([('shotgun','kf2-aa12','870'),('revolver','kf2-1858-reference','sw')]):
    for vi,angle in enumerate(['left','quarter','crop']):
        row=wi*3+vi;y=42+row*173
        for col in range(4):
            a='left' if angle=='crop' else angle
            if col<2:
                r=0 if col==0 else n
                path=ROOT/f'.kite3d/hd/round-{r}/{weapon}/final-{a}.png'
            elif col==2:path=refs/f'{kf}-{a}.png'
            else:path=refs/(f'{photo}-shotgun.jpg' if photo=='870' and a=='quarter' else f'{photo}-{a}.jpg')
            im=Image.open(path).convert('RGBA')
            if angle=='crop':
                if col<2:center=(620,207) if weapon=='shotgun' else (590,140)
                elif col==2:center=(470,230) if weapon=='shotgun' else (615,169)
                else:center=(1000,100) if weapon=='shotgun' else (630,415)
                im=crop4(im,center)
            im.thumbnail((462,146),Image.Resampling.LANCZOS)
            x=col*480+(480-im.width)//2
            sheet.paste(im,(x,y+24+(146-im.height)//2),im.getchannel('A'))
            draw.text((col*480+12,y+4),weapon.upper()+' / '+('receiver 4x' if weapon=='shotgun' and angle=='crop' else 'cylinder 4x' if angle=='crop' else angle),font=small,fill=(162,176,195))
        draw.line((0,y+172,1920,y+172),fill=(58,64,75))
sheet.save(out/f'round-{n}-contact.jpg',quality=94)
print(out/f'round-{n}-contact.jpg')
