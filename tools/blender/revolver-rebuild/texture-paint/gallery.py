"""Make local before/after evidence without altering rendered image pixels."""
import html, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
HERE=Path(__file__).resolve().parent;OUT=HERE.parent/'generated/texture-paint'
views=['left','right','threequarter','player','inspect']
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',22)
rows=[]
before=json.loads((OUT/'before/capture-all.json').read_text());after=json.loads((OUT/'after/capture-all.json').read_text())
assert before==after,'Comparison camera/light/exposure drift'
for name in views:
    images=[Image.open(OUT/stage/(name+'.png')).convert('RGB') for stage in ['before','after']]
    pair=Image.new('RGB',(1920,692),'#101720');d=ImageDraw.Draw(pair)
    for i,(im,label) in enumerate(zip(images,['BEFORE · procedural base / scalar roughness','AFTER · authored region masks / packed ORM'])):
        pair.paste(im,(i*960,52));d.text((i*960+20,15),label,font=font,fill='#e6ebf2')
    pair.save(OUT/(name+'-pair.png'))
    rows.append(f'<section><h2>{name.title()}</h2><a href="{name}-pair.png"><img class="pair" src="{name}-pair.png" alt="{name} before and after at identical camera/light/exposure"></a><p><a href="before/{name}.png">Before PNG</a> · <a href="after/{name}.png">After PNG</a></p></section>')
swatches=[]
paths=[('Original basecolor','before/gun-basecolor.png'),('Finished basecolor','../../source-assets/gun/gun-basecolor.png'),('Packed ORM','../../source-assets/gun/gun-orm.png'),('Original AO','../../source-assets/gun/gun-ao.png'),('Original normal','../../source-assets/gun/gun-normal.png')]
paths += [(p.stem,'../../source-assets/gun/paint-layers/'+p.name) for p in sorted((HERE.parent/'source-assets/gun/paint-layers').glob('*.png')) if p.stem!='original-basecolor']
for title,path in paths:swatches.append(f'<figure><a href="{path}"><img src="{path}" loading="lazy"></a><figcaption>{title}</figcaption></figure>')
(OUT/'index.html').write_text('''<!doctype html><meta charset="utf-8"><title>Revolver texture finish — fixed comparisons</title>
<style>body{margin:0;background:#0c1118;color:#e6ebf2;font:16px system-ui;line-height:1.55}main{max-width:1500px;margin:auto;padding:32px}h1{font-size:34px}h2{margin-top:36px}a{color:#adcdf7}.pair{width:100%}section{border-bottom:1px solid #39434f;padding-bottom:15px}.swatches{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}figure{margin:0}figure img{width:100%;background:#222}code{color:#b7d5b7}</style>
<main><h1>Graphite steel · texture finish</h1><p>Scripted mesh-aware UV painting: selected edge contacts, directional scuffs, handling oil, recess grime, walnut/rubber rubbing and fictional V-07 / 06-1842 markings. Actual Eevee materials on the complete assembled source; hands hidden only in the three gun closeups. No AI imagery, geometry changes or animation rebake.</p>
<p>Every pair uses identical camera, lights, exposure and animation time. <b>Left is before; right is after.</b> Player and Inspect use the approved 54° vertical player camera and saved NLA actions. These are Blender material previews, not gameplay screenshots.</p>
<p>Basecolor/ORM: 2048. Original normal/AO: 1024; ORM R exactly duplicates each AO texel 2×2. R=AO, G=roughness, B=metallic, Non-Color; absolute values, factors 1. Six materials and existing draw primitives retained. Estimated GPU delta: <b>32 MiB with mipmaps</b>. Normal and hand map bytes unchanged.</p>'''+''.join(rows)+'<h2>Texture swatches and editable masks</h2><p>Click for full-resolution PNGs. Composite mode reads editable wear masks without overwriting them; roughness/metallic and region maps below are derived diagnostics.</p><div class="swatches">'+''.join(swatches)+'</div></main>')
print(OUT/'index.html')
