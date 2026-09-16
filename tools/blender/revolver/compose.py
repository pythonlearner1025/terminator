"""Compose actual round renders and compute independently thresholded silhouette metrics."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import argparse,json,numpy as np,cv2
ROOT=Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser();parser.add_argument('round',type=int);args=parser.parse_args();number=args.round
RAW=ROOT/f'.kite3d/revolver-rounds/round-{number}';REF=ROOT/'docs/reference/weapons/pistol';OUT=ROOT/'docs/evidence/blender-revolver/rounds';OUT.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',20)
def read(p,box=None):
 im=Image.open(p).convert('RGBA')
 if box:im=im.crop(box)
 bg=Image.new('RGBA',im.size,'#eceeec');bg.alpha_composite(im);return bg.convert('RGB')
def fit(im,w,h):
 im=im.copy();im.thumbnail((w,h),Image.Resampling.LANCZOS);return im
def pair(board,index,left,right,label):
 x=(index%2)*960;y=(index//2)*360;draw=ImageDraw.Draw(board)
 for j,im in enumerate([left,right]):
  im=fit(im,474,324);board.paste(im,(x+j*480+(480-im.width)//2,y+32+(324-im.height)//2))
 draw.text((x+12,y+6),label,font=font,fill='white')
def mask(file,box=None,photo=False):
 a=np.array(Image.open(file).convert('RGBA'))
 m=(a[:,:,:3].min(2)<210)if photo else (a[:,:,3]>127)
 if box:
  x,y,w,h=box;roi=np.zeros(m.shape,bool);roi[y:y+h,x:x+w]=True;m &=roi
 # Remove isolated image noise. Preserve the trigger opening.
 if photo:
  n,holes,stats,_=cv2.connectedComponentsWithStats((~m).astype('uint8'),8)
  for i in range(1,n):
   if stats[i,cv2.CC_STAT_AREA]<(1000 if number>=3 else 0):m[holes==i]=True
 n,labels,stats,_=cv2.connectedComponentsWithStats(m.astype('uint8'),8)
 return np.isin(labels,[i for i in range(1,n)if stats[i,cv2.CC_STAT_AREA]>24])
leftp=mask(REF/'arsenal-03.jpg',[0,200,1500,600],True);leftr=mask(RAW/'left.png')
topp=mask(REF/'arsenal-01.jpg',[0,280,1400,200],True);topr=mask(RAW/'top.png')
def iou(a,b):return float((a&b).sum()/(a|b).sum())
def overlay(a,b):
 out=np.zeros((*a.shape,3),'uint8');out[a]=[255,45,45];out[b]=[40,110,255];out[a&b]=[255,255,255];return Image.fromarray(out)
ov=Image.new('RGB',(1920,1080),'#111923');d=ImageDraw.Draw(ov)
for idx,(a,b,title)in enumerate([(leftp,leftr,'LEFT'),(topp,topr,'TOP')]):
 im=overlay(a,b);im=fit(im,1880,490);ov.paste(im,((1920-im.width)//2,idx*540+40));d.text((24,idx*540+12),title+' / red photo / blue render / white overlap',font=font,fill='white')
ov.save(OUT/f'round-{number}-overlay.png')
a=np.array(Image.open(RAW/'gun-mask.png').convert('RGBA'));g=(a[:,:,:3].min(2)>150)&(a[:,:,3]>127)
n,labels,stats,_=cv2.connectedComponentsWithStats(g.astype('uint8'),8);g=np.isin(labels,[i for i in range(1,n)if stats[i,cv2.CC_STAT_AREA]>12])
y,x=np.where(g);bbox=[int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)]
ref=[602,298,722,399];error=[round(abs(v-t)/dim*100,3)for v,t,dim in zip(bbox,ref,[960,540,960,540])]
metrics={'round':number,'leftIoU':round(iou(leftp,leftr),6),'topIoU':round(iou(topp,topr),6),'bbox':bbox,'referenceBbox':ref,'bboxEdgeErrorPercent':error,'bboxMaxErrorPercent':max(error),'photoThreshold':210,'highlightHoleFillBelowPixels':1000 if number>=3 else 0,'renderAlphaThreshold':127,'alignment':'Fixed barrel muzzle, axis and 203 mm scale. No shape fitting or nonuniform image scaling.'}
(OUT/f'round-{number}.json').write_text(json.dumps(metrics,indent=2)+'\n')
board=Image.new('RGB',(1920,1080),'#16212a')
pair(board,0,read(RAW/'left.png',(0,200,1500,800)),read(REF/'arsenal-03.jpg',(0,200,1500,800)),'LEFT / traced model | source photograph')
pair(board,1,read(RAW/'top.png',(0,250,1500,500)),read(REF/'arsenal-01.jpg',(0,250,1500,500)),'TOP / model | source photograph')
pair(board,2,read(RAW/'quarter.png'),read(REF/'arsenal-13.jpg',(0,310,1500,910)),'THREE QUARTER / model | photograph')
pair(board,3,read(RAW/'first-person.png'),read(REF/'kf2-04.jpg'),'FIRST PERSON / model | KF2 frame 04')
pair(board,4,read(RAW/'left.png',(850,250,970,330)).resize((480,320)),read(REF/'arsenal-03.jpg',(850,250,970,330)).resize((480,320)),'4X CYLINDER / model | photograph')
pair(board,5,read(RAW/'first-person.png',(380,350,880,540)),read(REF/'kf2-04.jpg',(380,350,880,540)),'HANDS / model | KF2 frame 04')
board.save(OUT/f'round-{number}.png')
board=Image.new('RGB',(1920,1080),'#16212a')
for i,(clip,refs)in enumerate([('fire',[1,7,4]),('reload',[3,10,11])]):
 for j,kf in enumerate(refs):pair(board,i*3+j,read(RAW/f'{clip}-{j+1}.png'),read(REF/f'kf2-{kf:02}.jpg'),f'{clip.upper()} {j+1} / model | KF2 {kf:02}')
board.save(OUT/f'round-{number}-motion.png')
board=Image.new('RGB',(1920,1080),'#16212a')
samples=json.loads((REF/'pass3-samples.json').read_text())['arsenal-03.jpg']
def lab_stats(array):
 lab=cv2.cvtColor(array.astype(np.float32).reshape(-1,1,3)/255,cv2.COLOR_RGB2LAB).reshape(-1,3)
 return lab.mean(0),lab.std(0)
material_metrics={}
for i,(label,sample)in enumerate(samples.items()):
 crop=sample['box'];photo=np.array(Image.open(REF/'arsenal-03.jpg').convert('RGB').crop(crop));rendered=np.array(Image.open(RAW/'left.png').convert('RGBA').crop(crop))
 pm=photo.min(2)<225;rm=rendered[:,:,3]>240
 if label=='brass':
  pm &= photo[:,:,0].astype(float)-photo[:,:,2]>12
  rm &= rendered[:,:,0].astype(float)-rendered[:,:,2]>12
 rmean,rstd=lab_stats(rendered[:,:,:3][rm]);pmean,pstd=lab_stats(photo[pm]);delta=float(np.linalg.norm(rmean-pmean))
 material_metrics[label]={'deltaE76':round(delta,3),'renderLab':[round(float(v),3)for v in rmean],'photoLab':[round(float(v),3)for v in pmean],'renderSpread':[round(float(v),3)for v in rstd],'photoSpread':[round(float(v),3)for v in pstd],'renderPixels':int(rm.sum()),'photoPixels':int(pm.sum()),'crop':crop}
 pair(board,i,read(RAW/'left.png',crop).resize((474,300)),read(REF/'arsenal-03.jpg',crop).resize((474,300)),label.upper()+f' / render | photo / Delta E76 {delta:.2f}')
pair(board,5,read(RAW/'first-person.png',(380,350,880,540)),read(REF/'kf2-04.jpg',(380,350,880,540)),'HANDS / anatomical model | KF2 frame 04')
board.save(OUT/f'round-{number}-materials.png')
metrics['materials']=material_metrics
metrics['materialGate']=all(m['deltaE76']<8 for m in material_metrics.values())
(OUT/f'round-{number}.json').write_text(json.dumps(metrics,indent=2)+'\n')
print(json.dumps(metrics))
