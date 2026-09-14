#!/usr/bin/env python3
"""Build the v2 gallery from immutable gameplay captures, revised prompts and generated targets."""
from pathlib import Path
from html import escape
import json,re
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'docs/scene-targets'
views=json.loads((p/'views.json').read_text())['views']
for view in views:
    for folder in ('before','targets-v2'):
        if not (p/folder/(view['id']+'.png')).is_file():
            raise SystemExit(f'Missing {folder}/{view["id"]}.png')
previous=(p/'index.html').read_text()
if not (p/'index-v1-rejected.html').exists():
    (p/'index-v1-rejected.html').write_text(previous)
css=re.search(r'<style>(.*?)</style>',previous,re.S).group(1)
css=css.replace('#c79b67','#96baff').replace('#e7bb80','#bfd8ff').replace('#2a241c','#16263c').replace('#4b3e2c','#345079')
css+='\n.reference{display:flex;align-items:center;gap:20px;background:#111c2c;padding:16px;margin:24px 0}.reference img{width:240px;aspect-ratio:auto;object-fit:contain}.reference p{margin:0}.pair img{cursor:zoom-in}@media(max-width:600px){.reference{display:block}.reference img{width:100%;max-width:340px;margin-bottom:12px}}'
nav=''.join(f'<a href="#{v["id"]}">{v["id"][:2]} {escape(v["title"].split(" / ")[0])}</a>' for v in views)
rows=[]
for v in views:
    id=v['id'];title=escape(v['title']);prompt=escape((p/'prompts'/(id+'.txt')).read_text())
    if id=='04-service':
        prompt+='\n\nCORRECTION PASS\n'+escape((p/'prompts/04-service-correction.txt').read_text())
    rows.append(f'''<section id="{id}"><div class="heading"><h2>{title}</h2><span>{id[:2]} / 05</span></div><p>{escape(v['description'])}</p><div class="pair"><figure><figcaption>BEFORE · ACTUAL PLAYER CAPTURE</figcaption><a href="before/{id}.png" target="_blank"><img src="before/{id}.png" alt="Current player view: {title}"></a></figure><figure><figcaption class="target">NEW TARGET · THE TERMINATOR (1984) DIRECTION</figcaption><a href="targets-v2/{id}.png" target="_blank"><img src="targets-v2/{id}.png" alt="New generated target: {title}"></a></figure></div><details><summary>Prompt used + repeatable player POV</summary><p>Feet: {v['feet']} · Look at: {v['lookAt']} · FOV 72° · Standing eye height 1.65 m</p><p><a href="prompts/{id}.txt">Full prompt file</a></p><pre>{prompt}</pre></details></section>''')
page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bunker 7 — New Terminator (1984) comparisons</title><style>'''+css+'''</style></head><body><header><div class="eyebrow">BUNKER 7 / ART DIRECTION / SECOND PASS</div><h1>Current gameplay → new film-inspired targets</h1><p>Five saved player POVs, regenerated with explicit direction from James Cameron’s original <em>The Terminator</em> (1984). Every generation uses its original gameplay capture for structure and your supplied film still for atmosphere, color and lighting.</p><div class="reference"><a href="references/terminator-1984-user-reference.png" target="_blank"><img src="references/terminator-1984-user-reference.png" alt="Supplied film style reference: blue smoke and dark ruined silhouettes"></a><p>Blue-black ruins, layered smoke, hard cold backlight and sparse white highlights.<br><a href="https://sites.pitt.edu/~goscilo/Sci-Fi/FilmStills/TheTerminator.html">Film stills reference</a> · <a href="prompts/index.html">Revised prompts</a> · <a href="index-v1-rejected.html">Rejected first pass</a></p></div><p>Click either image for full size. Left: real game rendering. Right: generated target artwork for the future refactor; fine geometry may differ.</p><nav>'''+nav+'''</nav></header><main>'''+''.join(rows)+'''<footer><a href="../../tools/capture-scene-targets.mjs">Saved capture script</a> · <a href="views.json">Five POV definitions</a> · <a href="before/capture.json">Capture manifest</a> · <a href="prompts/art-direction.txt">Shared art direction</a><br>Original captures: 1920 × 1080 · High quality · 72° FOV · Targets generated with the built-in image tool.</footer></main></body></html>'''
(p/'index-v2.html').write_text(page)
(p/'index.html').write_text(page)
pp=p/'prompts/index.html'
text=pp.read_text().replace('These are the revised prompts for the next generation pass. The previous amber-lit images are rejected.','These prompts were used for the second generation pass. <a href="../index-v2.html">See the new capture / generated comparisons.</a>')
text=text.replace('href="../index.html">Previous capture/concept pairs','href="../index-v1-rejected.html">Rejected first-pass pairs')
pp.write_text(text)
print('Built index-v2.html and updated index.html with all five new comparisons.')
