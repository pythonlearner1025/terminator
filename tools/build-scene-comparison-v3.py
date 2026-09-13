#!/usr/bin/env python3
"""Build v3 without rewriting any v1/v2 images, prompts or galleries."""
from pathlib import Path
from html import escape
import json,re,hashlib
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'docs/scene-targets'
views=json.loads((p/'views.json').read_text())['views']
for v in views:
    if not (p/'targets-v3'/(v['id']+'.png')).is_file():raise SystemExit('Missing v3: '+v['id'])
record=json.loads((p/'prompts-v3/previous-versions-sha256.json').read_text())
for name,digest in record.items():
    assert hashlib.sha256((p/name).read_bytes()).hexdigest()==digest, 'Previous version changed: '+name
css=re.search(r'<style>(.*?)</style>',(p/'index-v2.html').read_text(),re.S).group(1)
css+='\n.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:24px 0;padding:14px;background:#142132}.controls label{font-weight:600}select{font:inherit;padding:8px 12px;background:#0b111d;color:#d5e4fa;border:1px solid #516687;border-radius:4px}.versions{display:flex;gap:18px;flex-wrap:wrap}.reference img{width:280px}.compare-state{color:#a4c8fa}'
rows=[]
for v in views:
    id=v['id']; title=escape(v['title']);prompt=escape((p/'prompts-v3'/(id+'.txt')).read_text())
    rows.append(f'''<section id="{id}"><div class="heading"><h2>{title}</h2><span>{id[:2]} / 05</span></div><p>{escape(v['description'])}</p><div class="pair"><figure><figcaption class="left-label">BEFORE · ACTUAL PLAYER CAPTURE</figcaption><a class="left-link" data-view="{id}" href="before/{id}.png" target="_blank"><img class="left-image" src="before/{id}.png" alt="Comparison source: {title}"></a></figure><figure><figcaption class="target">V3 · NATURAL DEBRIS / CLEANER SURFACES</figcaption><a href="targets-v3/{id}.png" target="_blank"><img src="targets-v3/{id}.png" alt="Version 3 target: {title}"></a></figure></div><details><summary>Exact v3 edit prompt + saved POV</summary><p>Feet: {v['feet']} · Look at: {v['lookAt']} · 72° FOV · 1.65 m standing eye height</p><p><a href="prompts-v3/{id}.txt">Prompt file</a> · Inputs: matching v2 target, real debris photograph, original gameplay capture.</p><pre>{prompt}</pre></details></section>''')
nav=''.join(f'<a href="#{v["id"]}">{v["id"][:2]} {escape(v["title"].split(" / ")[0])}</a>' for v in views)
page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bunker 7 — Version 3 comparisons</title><style>'''+css+'''</style></head><body><header><div class="eyebrow">BUNKER 7 / ART DIRECTION / VERSION 3</div><h1>The same atmosphere.<br>More believable surfaces.</h1><p>Version 3 keeps the James Cameron / <em>The Terminator</em> (1984) blue-black lighting and smoke from v2. The new pass focuses on gravity-settled debris, varied fragment sizes, calmer intact surfaces and less grain.</p><div class="versions"><a href="index-v1-rejected.html">V1 · archived</a><a href="index-v2.html">V2 · preserved</a><a href="index-v3.html" aria-current="page">V3 · current</a></div><div class="reference"><a href="references/real-debris-user-reference.png" target="_blank"><img src="references/real-debris-user-reference.png" alt="User-supplied real debris reference showing mixed slabs, masonry fragments, dust and collapsed walls"></a><p>Material reference: large overlapping slab faces, angular masonry, smaller infill and dust. Damage has a source and a direction; quieter surfaces separate the piles.<br><a href="prompts-v3/art-direction.txt">Full shared prompt</a> · <a href="references/terminator-1984-user-reference.png">Original film-look reference</a></p></div><div class="controls"><label for="compare">Compare v3 against</label><select id="compare"><option value="before">Original gameplay capture</option><option value="targets-v2">Version 2 target</option><option value="targets">Version 1 target</option></select><span class="compare-state">Left: original gameplay · Right: v3</span></div><p>Click an image for full size. Generated targets are visual references for the refactor; the game itself is unchanged.</p><nav>'''+nav+'''</nav></header><main>'''+''.join(rows)+'''<footer><a href="../../tools/capture-scene-targets.mjs">Saved capture script</a> · <a href="views.json">POV definitions</a> · <a href="targets-v3/generation.json">V3 generation record</a> · <a href="README.md">Repeat capture and comparison commands</a><br>Five original player captures · Five v3 targets · Built-in image generation · V1 and V2 retained.</footer></main><script>
const select=document.querySelector('#compare');
function update(){const folder=select.value;const label=folder==='before'?'BEFORE · ACTUAL PLAYER CAPTURE':folder==='targets-v2'?'V2 · PREVIOUS TARGET':'V1 · ARCHIVED TARGET';for(const link of document.querySelectorAll('.left-link')){const src=folder+'/'+link.dataset.view+'.png';link.href=src;link.querySelector('img').src=src}for(const node of document.querySelectorAll('.left-label'))node.textContent=label;document.querySelector('.compare-state').textContent='Left: '+select.selectedOptions[0].text+' · Right: v3'}
select.addEventListener('change',update);
</script></body></html>'''
(p/'index-v3.html').write_text(page)
(p/'index.html').write_text(page)
manifest={'version':3,'generator':'built-in image_gen','edit':'Preserve v2 composition and lighting; improve rubble formation, material variation and reduce grain','views':[]}
for v in views:
    id=v['id'];image='targets-v3/'+id+'.png';prompt='prompts-v3/'+id+'.txt'
    manifest['views'].append({'id':id,'image':image,'sha256':hashlib.sha256((p/image).read_bytes()).hexdigest(),'prompt':prompt,'prompt_sha256':hashlib.sha256((p/prompt).read_bytes()).hexdigest(),'inputs':['targets-v2/'+id+'.png','references/real-debris-user-reference.png','before/'+id+'.png']})
(p/'targets-v3/generation.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Built v3 and current galleries; every recorded v1/v2 file is unchanged.')
