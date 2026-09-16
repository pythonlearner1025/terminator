"""Download a public zero-price upload through itch.io's documented page flow."""
import sys,requests
from bs4 import BeautifulSoup
from pathlib import Path
url,upload,out=sys.argv[1:]
s=requests.Session();r=s.get(url,timeout=30);r.raise_for_status()
csrf=BeautifulSoup(r.text,'html.parser').select_one('meta[name=csrf_token]')['value']
r=s.post(url+'/download_url',data={'csrf_token':csrf},headers={'Referer':url},timeout=30);r.raise_for_status()
r=s.get(r.json()['url'],timeout=30);r.raise_for_status()
csrf=BeautifulSoup(r.text,'html.parser').select_one('meta[name=csrf_token]')['value']
r=s.post(url+'/file/'+upload,data={'csrf_token':csrf},headers={'Referer':url},timeout=30);r.raise_for_status()
data=r.json()
if not data.get('url'):raise RuntimeError(str(data.get('errors','Download URL missing')))
r=s.get(data['url'],timeout=90);r.raise_for_status();Path(out).write_bytes(r.content)
print(Path(out).name,len(r.content))
