"""Pack committed maps. No texture synthesis, source mesh edits, or external downloads."""
from PIL import Image,ImageDraw
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'assets/models/weapons/swingout';OUT.mkdir(parents=True,exist_ok=True)
colors=[(65,73,83),(160,114,47),(10,12,15),(137,140,145),(174,102,61),(23,27,31)]
orm=[(225,74,255),(245,67,255),(230,170,150),(235,100,255),(240,90,255),(240,175,0)]
for kind in ['albedo','normal','orm']:
 src=Image.open(ROOT/f'assets/models/weapons-candidates/revolver/loafbrr-cc0-hd/main-{kind}.png').convert('RGB')
 hand=Image.open(ROOT/f'assets/models/weapons/pistol/pistol-{kind}.png').convert('RGB')
 out=Image.new('RGB',(2048,2048),(128,128,255) if kind=='normal' else (40,40,40))
 out.paste(src.resize((1536,1536),Image.Resampling.LANCZOS),(0,512))
 out.paste(hand.crop((int(.70*2048),0,2048,2048)).resize((512,2048),Image.Resampling.LANCZOS),(1536,0))
 d=ImageDraw.Draw(out)
 for i in range(6):d.rectangle((i*256,0,(i+1)*256-1,511),fill=colors[i] if kind=='albedo' else orm[i] if kind=='orm' else (128,128,255))
 d.rectangle((1984,0,2047,63),fill=(151,110,91) if kind=='albedo' else (255,170,0) if kind=='orm' else (128,128,255))
 out.save(OUT/f'swingout-{kind}.png',compress_level=9)
