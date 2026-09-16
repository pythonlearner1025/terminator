"""Supporting fixed-camera silhouette comparison; no quality score is inferred."""
from PIL import Image,ImageDraw
from pathlib import Path
import json
OUT=Path(__file__).resolve().parent/'generated/gun';views=['left','top','front','rear','threequarter_left'];metrics={}
board=Image.new('RGB',(1280,5*510),(24,27,33));d=ImageDraw.Draw(board)
for row,v in enumerate(views):
 masks=[]
 for subj in ['reference','rebuild']:
  im=Image.open(OUT/'silhouette'/f'{v}-silhouette-{subj}.png').convert('RGB');masks.append([max(p)<55 for p in im.getdata()])
 intersection=sum(a and b for a,b in zip(*masks));union=sum(a or b for a,b in zip(*masks));metrics[v]={'intersectionOverUnion':intersection/union,'intersectionPixels':intersection,'unionPixels':union,'threshold':'max RGB <55, identical fixed camera'}
 for col,subj in enumerate(['reference','rebuild']):
  im=Image.open(OUT/'blockout'/f'{v}-clay-{subj}.png');board.paste(im,(col*640,row*510+30));d.text((col*640+15,row*510+8),v+' / '+subj,fill='white')
board.save(OUT/'fixed-camera-comparison.jpg',quality=90)
(OUT/'silhouette-metrics.json').write_text(json.dumps(metrics,indent=2));print(json.dumps(metrics,indent=2))
