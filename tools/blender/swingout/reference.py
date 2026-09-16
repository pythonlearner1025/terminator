"""Download observation-only footage and cut review frames. Videos are not shipped."""
from pathlib import Path
import subprocess,json
ROOT=Path(__file__).resolve().parents[3];cache=ROOT/'tools/blender/cache/swingout-reference';cache.mkdir(parents=True,exist_ok=True)
out=ROOT/'docs/reference/weapons/swingout';out.mkdir(parents=True,exist_ok=True)
sources=[('real','sPbTWGEPi2o',[37.9,38.2,38.5,40.4]),('fps','dk5QmG1CDf0',[8.10,8.40,8.80,9.20,9.60,10.,10.5,11.1])]
frames=[]
for name,video,times in sources:
 subprocess.run(['python3','-m','yt_dlp','--no-playlist','--js-runtimes','node','-f','best[height<=720]/bestvideo[height<=720]','-o',str(cache/(name+'.%(ext)s')),'https://www.youtube.com/watch?v='+video],check=True)
 path=next(p for p in cache.glob(name+'.*') if p.suffix in ['.mp4','.webm','.mkv'])
 for t in times:
  n=len(frames)+1;dest=out/f'reference-{n:02}.jpg'
  subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(path),'-frames:v','1','-vf','scale=960:-1',str(dest)],check=True)
  frames.append({'file':dest.name,'source':'https://www.youtube.com/watch?v='+video,'seconds':t})
(out/'SOURCES.json').write_text(json.dumps({'use':'Observation only. Not game textures. Excluded from publish by docs/**.','frames':frames},indent=2)+'\n')
