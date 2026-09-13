import json,urllib.request,datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path('docs/asset-comparison')
choices=json.loads((root/'alternatives.json').read_text())
unique={a['id']:a for v in choices.values() for a in v}
def verify(a):
    url=a.get('api','https://api.polyhaven.com/info/'+a['id'])
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(req,timeout=35) as response:
        data=json.load(response)
        assert data['name']==a['name'],a['id']
        if a['source']=='Sketchfab':assert data['isDownloadable'],a['id']
        return dict(id=a['id'],url=a['url'],metadata_url=url,status=response.status,name=data['name'],downloadable=data.get('isDownloadable',True),license=a['license'])
with ThreadPoolExecutor(max_workers=5) as pool:results=list(pool.map(verify,unique.values()))
report=dict(checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sources=results)
(root/'source-verification.json').write_text(json.dumps(report,indent=2))
print(f'All {len(results)} source metadata endpoints responded; names and download availability verified.')
