import json,urllib.request,urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
queries={'wall':'"concrete wall"','floor':'"concrete floor"','stair':'"stairs"','rubble':'rubble','truck':'"truck"','bunker':'"bunker"','container':'"shipping container"','ramp':'"ramp"','tunnel':'"tunnel"','column':'"concrete pillar"','supply':'"military crate"','generator':'"generator"','door':'"bunker door"','gate':'"gate"','hazard':'"hazard"','flank':'"damaged wall"','tube':'"fluorescent"','emergency':'"emergency light"','work':'"work light"','pipe':'"pipes"','cable':'"cable"','scout':'"T-600"','endo':'"T-800"','hkaerial':'"HK"','hktank':'"tank"','soldier':'"soldier"'}
def get(kv):
 k,q=kv;u='https://api.sketchfab.com/v3/search?'+urllib.parse.urlencode({'type':'models','q':q,'downloadable':'true','count':18,'sort_by':'-likeCount'})
 try:
  d=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'AssetResearch/1.0'}),timeout=35));Path('docs/asset-comparison/research/'+k+'-refined.json').write_text(json.dumps(d,indent=2));return k,[(i,r['name'],r.get('faceCount')) for i,r in enumerate(d['results'])]
 except Exception as e:return k,str(e)
for k,rows in ThreadPoolExecutor(max_workers=5).map(get,queries.items()):print(k,json.dumps(rows),flush=True)
