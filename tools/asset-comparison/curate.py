import json, urllib.request, time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

ROOT=Path('docs/asset-comparison')
def pick(file,index,why,fit='Model replacement'):
    r=json.loads((ROOT/'research'/f'{file}.json').read_text())['results'][index]
    imgs=r['thumbnails']['images'];img=min(imgs,key=lambda x:abs(x['width']-720))
    return dict(id=r['uid'],name=r['name'],url=r['viewerUrl'],image_url=img['url'],image=f"images/{r['uid']}.jpg",author=r['user']['displayName'],license=r.get('license',{}).get('label','Not specified'),license_url=r.get('license',{}).get('url',''),triangles=r['faceCount'],downloadable=r['isDownloadable'],animations=r['animationCount'],why=why,fit=fit,source='Sketchfab',api=r['uri'])
def ph(id,why):
    r=json.loads((ROOT/'research'/f'{id}.json').read_text())
    return dict(id=id,name=r['name'],url='https://polyhaven.com/a/'+id,image=f'images/ph-{id}.png',author=', '.join(r['authors']),license='CC0',license_url='https://polyhaven.com/license',triangles=None,downloadable=True,animations=0,why=why,fit='PBR material • keep slab mesh',source='Poly Haven')

# Explicit selections: indices refer to preserved provider search responses.
C={
'wall':[pick('wall-refined',12,'Leak stains and eroded concrete add age to bunker walls.'),pick('wall-refined',8,'Reinforced panels offer stronger industrial structure; resize the segments.'),pick('wall',3,'A darker horror-industrial wall treatment for the interior.')],
'floor':[ph('hangar_concrete_floor','Scuffed hangar concrete suits bunker circulation areas.'),ph('damaged_concrete_floor_03','Chipped patches suit exposed combat spaces.'),ph('concrete_floor_02','Weathered, moss-stained concrete suits neglected exterior slabs.')],
'stair':[pick('stair-more',0,'Steel stair detailing gives the circulation a fabricated industrial look.','Full stair assembly • adapt layout'),pick('stair-more',23,'A compact metal stair mesh with a modest triangle budget.','Full stair assembly • adapt layout'),pick('stair-more',16,'Industrial walkway stairs provide rails and a clearer silhouette.','Full stair assembly • adapt layout')],
'rubble':[pick('rubble-refined',9,'An optimized photoscan gives broken masonry convincing irregularity.'),pick('rubble-refined',5,'Construction debris adds varied fragments and natural surface wear.'),pick('rubble-refined',16,'Separate concrete chunks can be arranged to match each rubble bank.','Chunk set • arrange to footprint')],
'truck':[pick('truck-more',4,'A crashed truck with authored damage and a small game-oriented mesh.'),pick('truck-more',12,'A low-poly wreck with a recognizable vehicle silhouette.'),pick('truck-more',10,'An armored wreck makes stronger battlefield cover; fit the existing collider.')],
'barrel':[pick('barrel',1,'Worn red paint and a low mesh count suit repeated explosive props.'),pick('barrel',5,'A rusty oil drum with more developed surface detail.'),pick('barrel',2,'A barrel set introduces wear and color variation across four placements.','Model set • choose a barrel')],
'bunker':[pick('bunker-refined',1,'A coherent sci-fi bunker kit can guide richer paneling.','Whole bunker • extract/rebuild modules'),pick('bunker-refined',10,'Military architecture offers doors and structural details.','Whole building • extract/rebuild modules'),pick('bunker-refined',13,'An underground bunker offers an alternate interior treatment.','Whole bunker • extract/rebuild modules')],
'container':[pick('container-refined',1,'A game-ready container with detailed corrugation and fittings.'),pick('container-refined',6,'Rusted freight steel fits the abandoned yard.'),pick('container-refined',11,'A light post-apocalyptic container option; retint for each scene color.')],
'ramp':[pick('ramp-final',4,'Metal vehicle-ramp detailing suits the loading area.','Reshape/resize to dock footprint'),pick('ramp-final',13,'A service ramp adds industrial structure beneath the slope.','Reshape/resize to dock footprint'),pick('ramp-final',3,'A folding ramp adds hinges and practical loading detail.','Reshape/resize to dock footprint')],
'tunnel':[pick('tunnel-refined',2,'A tube tunnel provides continuous structure and a stronger enclosed profile.','Tunnel assembly • adapt section'),pick('tunnel-refined',14,'A subway section brings industrial tunnel detail.','Tunnel assembly • adapt section'),pick('tunnel',11,'Simple concrete girder sections suit a modular service passage.','Modular set • adapt section')],
'column':[pick('column-refined',12,'A relatively light concrete column for repeated structural supports.'),pick('column-refined',3,'Scanned concrete surface detail adds realism to close supports.'),pick('column-refined',11,'Broken concrete and exposed damage fit battle-worn sections.')],
'supply':[pick('supply-refined',3,'A low-poly rifle box makes the supply function immediately recognizable.'),pick('supply-refined',12,'A military crate offers worn fittings and a practical storage silhouette.'),pick('supply-refined',5,'A cargo crate provides an alternative reinforced chest shape.')],
'sandbags':[pick('sandbags',8,'A compact sandbag pile provides softer, more believable cover.'),pick('sandbags',5,'A very light military barrier suits repeated barricades.'),pick('sandbags',6,'Individual bags allow a custom wall following the current cover outline.','Individual bag • build a stack')],
'generator':[pick('generator-refined',0,'A detailed generator with a manageable mesh budget.'),pick('generator-refined',10,'Diesel machinery better communicates the bunker power supply.'),pick('generator-refined',11,'A military generator gives the prop a distinct equipment identity.')],
'spool':[pick('spool',2,'A compact cable spool with a clear industrial silhouette.'),pick('spool',0,'A more detailed reel for close-up cover props.'),pick('spool-more',0,'Scanned wooden cable reels give the area more varied industrial clutter.','Reel set • isolate and optimize a reel')],
'bunk':[pick('bunk',11,'A military cot closely matches the current field-bed role.'),pick('bed-more',0,'A worn camp bed preserves the low field-cot silhouette.'),pick('bunk',9,'A lightweight bunkbed option for repeated dormitory props.','Bunk bed • changes cover height')],
'trader':[pick('trader',0,'A retro terminal makes the trader interaction visually explicit.','Terminal • preserve interaction anchor'),pick('trader',1,'An abandoned control console fits the damaged bunker.'),pick('trader',6,'An industrial terminal adds practical controls and a stronger focal point.')],
'door':[pick('door-refined',4,'A worn metal bunker door with clear hinges and surface wear.'),pick('door-refined',7,'A comparatively light metal bunker door for repeated entrances.'),pick('door-refined',11,'A larger door fits wide service openings.','Resize and split moving door parts')],
'gate':[pick('shutter',1,'A very light roller shutter suits the existing vertical opening behavior.','Shutter • wire existing animation'),pick('shutter',2,'An animated roller shutter offers a useful motion reference.','Shutter • adapt supplied animation'),pick('shutter',5,'Facility shutters add more convincing industrial framing.','Door set • choose and resize')],
'hazard':[pick('grate',0,'A floor grate set provides richer openings over the hazard emitter.','Grate • keep runtime hazard effects'),pick('grate',6,'A floor panel with integrated grate can replace the flat fixture.','Grate • keep runtime hazard effects'),pick('grate',7,'Another grated floor treatment with a small mesh budget.','Grate • keep runtime hazard effects')],
'flank':[pick('flank-refined',0,'Existing wall damage makes the destructible route easier to read.','Split for existing break behavior'),pick('flank-refined',14,'Worn concrete offers a lightweight base for a destructible panel.','Split for existing break behavior'),pick('column-refined',7,'Destroyed brick sections offer a more visibly fragile alternate route.','Wall set • changes material and silhouette')],
'tube':[pick('tube-refined',1,'A weathered fluorescent fixture suits the bunker ceiling.'),pick('tube-refined',5,'Low-poly fluorescent variants prevent identical repeated fixtures.','Fixture pack • choose a lamp'),pick('tube-refined',8,'A lighter weathered fluorescent lamp for repeated use.')],
'emergency':[pick('emergency',3,'An abandoned-factory warning light matches the alarm role.'),pick('emergency-refined',4,'A rusty twin-spot fixture adds emergency utility detail.'),pick('emergency-refined',12,'A compact emergency-light option with a distinct housing.')],
'work':[pick('work-refined',6,'An industrial work light fits the service spaces.'),pick('work-more',5,'A compact floodlight offers a different practical lamp housing.'),pick('work-more',18,'A small game-ready floodlight works for repeated illumination.')],
'pipe':[pick('pipe-refined',5,'Rusted pipe modules provide fittings and bends.'),pick('pipe-refined',10,'A lighter modular pipe set suits long service runs.'),pick('pipe-refined',17,'Sci-fi industrial pipe modules give the bunker a more mechanical treatment.')],
'cable':[pick('cable-refined',6,'Meter-long modules let you rebuild the existing cable route.'),pick('cable-refined',4,'A wire set adds more natural cable shapes and variation.'),pick('cable-refined',14,'A detailed electric cable offers an alternate hanging line.')],
'scout':[pick('scout',0,'A recognizable T-600 body is the closest identity match.','T-600 • optimize and rig'),pick('scout-more',7,'A military robot alternative with a more armored mechanical body.','Alternate robot design • rig'),pick('endo-refined',17,'A lighter Terminator body can be weathered into a scout variant.','T-800 substitute • restyle and rig')],
'endo':[pick('endo-refined',2,'A damaged T-800 endoskeleton with a compact triangle budget.','Fan model • rig compatibility unverified'),pick('endo',1,'A T2 endoskeleton offers a recognizable mechanical silhouette.','Fan model • rig compatibility unverified'),pick('endo-refined',3,'A detailed T-800 gives a richer close-up machine body.','SFM-origin model • inspect provenance/rig')],
'heavy':[pick('endo-refined',6,'A full-body T-800 base to equip with the heavy weapon.','Noncommercial listing • add heavy loadout'),pick('heavy',0,'A combat droid offers a bulkier alternate heavy-enemy silhouette.','Alternate robot design • rig'),pick('heavy',11,'An armored enforcer offers another heavy machine direction.','Alternate robot design • rig')],
't1000':[pick('t1000',3,'A T2 character model offers a recognizable infiltrator identity.','Fan model • implement liquid behavior'),pick('liquid-more',1,'A detailed chrome T-1000 likeness; confirm full-body coverage before choosing it.','Body coverage unverified • optimize and rig'),pick('police',13,'A complete police character can support the disguised infiltrator form.','Different likeness • add liquid transformation')],
'hkaerial':[pick('hkaerial',0,'An HK set includes the recognizable aerial vehicle.','Combined set • isolate aerial'),pick('hkaerial',1,'A highly detailed aerial machine offers a heavier visual direction.','Crossover design • major optimization'),pick('aerial-more',1,'A compact drone provides an alternate flying-enemy silhouette.','Alternate drone design')],
'hktank':[pick('hktank',1,'A T2 hunter-killer tank gives the closest role and silhouette match.'),pick('hktank',0,'An HK vehicle set provides a second tank interpretation.','Combined set • isolate tank'),pick('tank-more',13,'A tracked sci-fi tank offers a light alternate combat vehicle.','Alternate tank design')],
'soldier':[pick('soldier-more',0,'Detailed tactical equipment improves the human ally silhouette.','Adapt rig and resistance uniform'),pick('soldier-more',5,'A sci-fi soldier gives the resistance a more futuristic identity.','Alternate armor design • adapt rig'),pick('soldier-more',9,'A modern soldier offers another realistic human base.','Adapt rig and resistance uniform')],
}
for group,choices in C.items():
    assert len(choices)==3 and len({x['id'] for x in choices})==3,group
    assert all(x['downloadable'] for x in choices),group
(ROOT/'alternatives.json').write_text(json.dumps(C,indent=2))
unique={x['id']:x for choices in C.values() for x in choices}
def download(x):
    path=ROOT/x['image']
    if path.exists(): return
    for attempt in range(3):
        try:
            req=urllib.request.Request(x['image_url'],headers={'User-Agent':'Mozilla/5.0'})
            path.write_bytes(urllib.request.urlopen(req,timeout=30).read());return
        except Exception:
            if attempt==2:raise
            time.sleep(1)
with ThreadPoolExecutor(max_workers=5) as pool:list(pool.map(download,unique.values()))
print(f'{len(C)} families, {len(unique)} distinct alternatives; thumbnails downloaded.')
