import json,html,base64,io
from pathlib import Path
from PIL import Image
R=Path('docs/asset-comparison');C=json.loads((R/'alternatives.json').read_text());I=json.loads((R/'inventory.json').read_text())
# 0 retains the original; 1–3 reference the existing comparison columns.
S={
'wall':(1,'Use the same stained concrete treatment throughout. Fit wall sections to the existing footprints; carry this concrete tone onto retained bunker modules.'),
'floor':(1,'Use one scuffed gray concrete material across slabs. Add local grime and impact decals for variation, with consistent texture scale.'),
'stair':(0,'Keep the individual steel treads and existing climb geometry. Match their finish to the selected dark industrial grates; the alternatives are whole stair assemblies.'),
'rubble':(1,'The gray concrete debris belongs to the same damaged bunker. Reduce mesh cost for repeated piles and vary rotation rather than mixing different rubble styles.'),
 'truck':(1,'The damaged military-green pickup fits the scavenged battlefield and has a manageable mesh count. Desaturate paint and match the environment dust.'),
'barrel':(3,'Choose muted olive and gray variants from this single pack; reserve its red variant for explosive barrels so color communicates gameplay.'),
'bunker':(0,'Keep the modular bunker shell and its layout. Match its surface to the selected stained wall concrete; none of the complete-building alternatives replaces this module cleanly.'),
'container':(2,'Use the same rusted freight model for all three containers. Preserve the red, blue and gray identities with equally faded paint and the same rust treatment.'),
'ramp':(0,'Keep the full-width walking slope. The alternatives are narrow vehicle rails or folding ramps; finish the current mesh in the same worn steel as the stairs.'),
 'tunnel':(0,'Keep the rectangular concrete service passage and unify its material with the bunker. Subway tubes and bridge girders would change the architecture.'),
'column':(0,'Keep the square structural supports, using the same stained concrete as the walls. The alternatives add decorative bases, round damage or complete support assemblies.'),
'supply':(3,'The olive cargo case reads as practical military storage. Reuse this one case family with small stencil variations; keep hardware dull and dust consistent.'),
'sandbags':(1,'This stacked, weathered bag model matches the human defenses. Reuse its bag scale and faded canvas tone at every barricade.'),
'generator':(3,'The olive PE-77-D has the right utilitarian military design. Match its worn paint to supply crates; retain dark steel fittings.'),
'spool':(1,'A simple wooden cable drum fits the same grounded industrial setting and stays light enough for repeated props.'),
'bunk':(1,'The worn military cot fits an improvised bunker barracks. Keep faded canvas close to the sandbag palette and retain the low cover height.'),
'trader':(2,'The abandoned control console feels assembled from real industrial equipment. Use a restrained amber or green screen and faded military paint.'),
'door':(2,'The plain heavy steel door fits concrete service rooms and carries convincing wear. Resize to each opening and use one dark, desaturated metal finish.'),
'gate':(1,'This simple gray shutter suits the existing vertical motion and matches the plain industrial doors. Keep the existing red warning strip. Its listing is CC BY-SA; retain that attribution/license information.'),
'hazard':(1,'Use one grate set for every hazard slot, in the same dark steel as stairs. Keep steam and electricity as runtime effects and use red only for active warnings.'),
'flank':(2,'A worn concrete panel keeps the breakable route in the same material family as the walls. Divide it into the existing fracture pieces during integration.'),
'tube':(3,'Use the lightweight version of this weathered fluorescent housing for all tube fixtures, with one cool-white emission color.'),
'emergency':(1,'The caged factory warning lamps fit the same aged electrical hardware. Use restrained red emission only while the alarm is active.'),
'work':(3,'This practical twin-head construction light suits the bunker work areas. Retint the stand to faded olive and use the same cool-white bulbs as the tube fixtures.'),
'pipe':(2,'Use one modular pipe family for consistent pipe diameters, fittings and wear. Bring the brass-looking finish toward oxidized steel with localized brown rust.'),
'cable':(1,'Use this single cable system in matte charcoal. Follow the existing cable routes and keep connectors at a consistent scale.'),
'scout':(1,'The actual T-600 preserves the older, heavier machine identity. Bring its metal into the same worn gunmetal palette as the T-800. This is a source for optimization: the listed 698k-triangle mesh needs LODs and rigging before use.'),
'endo':(1,'This damaged T-800 is the shared body choice for Endo and Heavy. Its listed 8,244 triangles suit waves better than the much denser alternatives. Use dark worn steel, polished edges and small red eyes; validate the supplied rig and provenance.'),
'heavy':(0,'Reuse the selected damaged T-800 body from the Endo row, then add the existing Heavy weapon and armor. Sharing the skull, limbs and materials makes this read as the same machine series. The noncommercial T-800 listing and unrelated combat robots are weaker production choices.'),
't1000':(1,'Choose the complete, relatively light T2 humanoid. Give it a continuous smooth chrome surface with far less grime than the mechanical units: its liquid-alloy identity should remain distinct.'),
'hkaerial':(1,'Use the aerial from this shared HK set, with the same gunmetal, vents and red optics as its tank companion. Separate the two vehicles before integration.'),
'hktank':(2,'Use the tank from the same HK set as the aerial. The shared proportions and detailing make a more coherent Skynet fleet than mixing creators and vehicle styles.'),
'soldier':(2,'This comparatively light tactical soldier has the right silhouette. Use faded olive and charcoal cloth, remove faction markings and bright visor emission, and add restrained Resistance markings.')}
def family(id):
 if id.startswith('unit-'):return id[5:]
 n=id[4:]
 return n[14:] if n.startswith('light-fixture-') else n.split('-')[0]
byfamily={}
for r in I:byfamily.setdefault(family(r['id']),[]).append(r)
F={}
for f,(option,reason) in S.items():
 src=C['endo'][0] if f=='heavy' else (C[f][option-1] if option else None)
 r=byfamily[f][0]
 F[f]={'family':f,'option':None if f=='heavy' else option,'selection':'shared' if f=='heavy' else ('alternative' if option else 'original'),'selectedId':src['id'] if src else r['id'],'name':('Shared T-800 body + Heavy loadout' if f=='heavy' else src['name'] if src else 'Keep original '+f),'image':src['image'] if src else r['image'],'url':src['url'] if src else '../../'+r['path'],'reason':reason,'license':src['license'] if src else 'Project original','triangles':src['triangles'] if src else r['render']['triangles'],'sourceFamily':'endo' if f=='heavy' else f,'assetCount':len(byfamily[f]),'placements':sum(len(x['names']) for x in byfamily[f])}
rows=[]
for r in I:
 f=family(r['id']);s=F[f];rows.append({'assetId':r['id'],**s,'selectedId':r['id'] if s['selection']=='original' else s['selectedId']})
report={'direction':'Worn military-industrial / Future War','optionsReviewed':'Original plus three alternatives per row. No fifth option is present in the current comparison.','status':'Selection only; scene assets have not been replaced.','families':F,'assets':rows}
(R/'selections.json').write_text(json.dumps(report,indent=2))
# A compact board shows all selected families together for consistency review.
esc=lambda s:html.escape(str(s),quote=True)
def image(path):
 with Image.open(R/path) as im:
  im=im.convert('RGB');im.thumbnail((600,350));buf=io.BytesIO();im.save(buf,format='JPEG',quality=86);return 'data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
order=['scout','endo','heavy','t1000','hkaerial','hktank','soldier']+[f for f in S if f not in ['scout','endo','heavy','t1000','hkaerial','hktank','soldier']]
cards=[]
for f in order:
 s=F[f];choice='Shared Endo selection' if s['selection']=='shared' else 'Keep original' if s['option']==0 else 'Alternative '+str(s['option'])
 cards.append(f'<article id="{f}"><img src="{image(s["image"])}" alt="{esc(s["name"])}" loading="lazy"><div class="body"><div class="label">{esc(f)} · {choice}</div><h2><a href="{esc(s["url"])}" target="_blank" rel="noopener noreferrer">{esc(s["name"])} ↗</a></h2><p>{esc(s["reason"])}</p><div class="meta">{s["assetCount"]} scene assets · {s["placements"]} placements · {esc(s["license"])}</div></div></article>')
page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terminator — selected asset set</title><style>body{margin:0;background:#0c1116;color:#e6eef4;font:16px/1.5 system-ui,sans-serif}*{box-sizing:border-box}header,main,footer{max-width:1650px;margin:auto;padding:26px 30px}h1{font-size:34px;line-height:1.2;margin:10px 0}header p{max-width:1070px;color:#afbeca}.label{color:#b9dfce;font-size:12px;text-transform:uppercase;letter-spacing:.1em}a{color:#c0dded}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;padding-top:8px}article{border:1px solid #35454f;border-radius:5px;overflow:hidden;background:#151e26}article img{width:100%;aspect-ratio:1.65;object-fit:contain;background:#151c23;display:block}.body{padding:17px}h2{font-size:18px;line-height:1.3;margin:10px 0}h2 a{text-decoration:none}p{font-size:15px}.meta,footer{font-size:12px;color:#a6b8c7}.palette{display:flex;gap:8px;flex-wrap:wrap}.palette span{border-left:12px solid var(--c);padding:4px 10px;background:#202a31;font-size:13px}footer{padding-top:0}a:focus-visible{outline:2px solid white;outline-offset:4px}@media(max-width:1100px){main{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:800px){main{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:500px){main{grid-template-columns:1fr}header,main,footer{padding:18px}h1{font-size:28px}}</style></head><body><header><div class="label">Terminator / chosen asset set</div><h1>One bunker. One visual language.</h1><p>My choices for all 76 scene assets, grouped into 33 families. The target is a worn military-industrial Future War setting: grounded equipment, consistent weathering and recognizable Skynet machines.</p><div class="palette"><span style="--c:#777b78">Gray concrete</span><span style="--c:#303a40">Gunmetal</span><span style="--c:#62694a">Faded olive</span><span style="--c:#795742">Localized rust</span><span style="--c:#ad392e">Red warnings / optics</span></div><p>Unify material roughness, texture scale, dust and lighting during integration. Keep both HK vehicles from one set and reuse the same T-800 body for Endo and Heavy. Previews below are source images; the proposed material changes are not applied yet.</p><p><a href="index.html">View all options with marked recommendations ↗</a> · Selections only; the scene is unchanged.</p></header><main>'''+''.join(cards)+'''</main><footer><p>The current comparison contains four options per row: the original and three alternatives. Heavy reuses an already-listed Endo option. Choices are editorial judgments based on appearance, role, mesh cost and listed terms; downloadable models still need rig, collider and runtime validation. Direct source links and creator credits are in the comparison page.</p></footer></body></html>'''
(R/'selected.html').write_text(page)
print(f'Selected {len(rows)} assets in {len(F)} families: '+str({t:sum(r['selection']==t for r in rows) for t in ['original','alternative','shared']}))
