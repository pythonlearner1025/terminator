"""Measure the opened reference pixels. Never treat photographed radiance as calibrated reflectance."""
from pathlib import Path
import cv2,numpy as np,json
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[3];REF=ROOT/'docs/reference/weapons/pistol'
regions={
 'pistol-photo-1.jpg':{'frame':[491,237,526,259],'barrel':[160,211,435,223],'cylinder':[586,244,657,266],'brass':[640,366,677,373],'walnut':[858,415,886,453]},
 'pistol-photo-2.jpg':{'frame':[437,70,506,91],'barrel':[80,80,410,95],'cylinder':[544,130,609,154],'brass':[610,249,651,261],'walnut':[804,293,857,333]},
 'pistol-photo-3.jpg':{'frame':[463,252,510,278],'barrel':[132,229,409,241],'cylinder':[563,264,631,276],'brass':[618,300,685,312],'walnut':[860,405,895,440]},
 'arsenal-03.jpg':{'frame':[719,287,819,349],'barrel':[95,269,650,300],'cylinder':[890,280,1050,420],'brass':[975,505,1153,611],'walnut':[1270,530,1410,606]},
 'kf2-04.jpg':{'skin':[651,426,676,450],'sleeve':[520,489,553,516]}}
def stats(a):
 lab=cv2.cvtColor(a.astype(np.float32)/255,cv2.COLOR_RGB2LAB).reshape(-1,3)
 return {'rgbMean':np.round(a.reshape(-1,3).mean(0),3).tolist(),'labMean':np.round(lab.mean(0),3).tolist(),'labStd':np.round(lab.std(0),3).tolist(),'pixels':len(lab)}
report={};board=Image.new('RGB',(1500,1000),'#202832');d=ImageDraw.Draw(board)
for row,(name,crops) in enumerate(regions.items()):
 report[name]={}
 for col,(mat,box)in enumerate(crops.items()):
  crop=Image.open(REF/name).convert('RGB').crop(box);a=np.array(crop);mask=a.min(2)<225
  if mat=='brass':mask &= (a[:,:,0].astype(float)-a[:,:,2]>12) if name!='pistol-photo-2.jpg' else a.min(2)<150
  value=stats(a[mask].reshape(-1,1,3));value['box']=box;report[name][mat]=value
  crop=crop.resize((280,140));x=col*300;y=row*200;board.paste(crop,(x,y+50));d.text((x+4,y+3),name+' '+mat,fill='white');d.text((x+4,y+20),'Lab '+str([round(v,1) for v in value['labMean']]),fill='white')
(REF/'pass3-samples.json').write_text(json.dumps(report,indent=2)+'\n');board.save(REF/'pass3-samples.png')
print(json.dumps(report['arsenal-03.jpg']));print(json.dumps(report['kf2-04.jpg']))
