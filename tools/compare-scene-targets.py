#!/usr/bin/env python3
"""Masked image error for fixed player POVs. Requires Pillow (python3 -m pip install Pillow)."""
import argparse, json, math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageStat, ImageFilter
ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/scene-targets'

def mask_for(size):
    w,h=size
    mask=Image.new('L',size,255); draw=ImageDraw.Draw(mask)
    # Conservative fixed screen-space exclusions: HUD and first-person weapon/arms.
    for box in [(0,.015,.145,.09),(.41,.02,.59,.14),(.84,.02,.99,.13),(0,.84,.15,1),(.85,.82,1,1),(.465,.94,.525,1)]:
        draw.rectangle(tuple(round(v*(w if i%2==0 else h)) for i,v in enumerate(box)),fill=0)
    draw.polygon([(int(x*w),int(y*h)) for x,y in [(.465,1),(.50,.84),(.545,.75),(.535,.56),(.61,.545),(.657,.68),(.655,.80),(.735,.85),(.81,1)]],fill=0)
    return mask

def compare(candidate,reference,mask):
    if abs(candidate.width/candidate.height-reference.width/reference.height)>.01:
        raise ValueError('Reference aspect ratio differs from capture; refusing an implicit crop')
    reference=reference.resize(candidate.size,Image.Resampling.LANCZOS)
    values=[]
    for scale in (1,4,16):
        size=(candidate.width//scale,candidate.height//scale)
        a=candidate.resize(size,Image.Resampling.BOX);b=reference.resize(size,Image.Resampling.BOX)
        m=mask.resize(size,Image.Resampling.NEAREST)
        values.append(sum(ImageStat.Stat(ImageChops.difference(a,b),m).mean)/3/255*100)
    return {'mae_percent':values[0],'mae_4x_percent':values[1],'mae_16x_percent':values[2],
            'loss':sum(a*b for a,b in zip(values,(.2,.3,.5)))},reference

def validate(candidate):
    expected=json.loads((BASE/'before/capture.json').read_text())
    actual=json.loads((candidate/'capture.json').read_text())
    for key in ['config','deviceScaleFactor','platform','browser']:
        if actual[key]!=expected[key]:raise ValueError(f'Capture {key} changed; re-establish the repeatability floor before scoring')
    baseline={v['id']:v for v in expected['views']}
    for view in actual['views']:
        original=baseline[view['id']]
        for key in ['camera','feet','tick','mapState','weapon','renderer']:
            if view[key]!=original[key]:raise ValueError(f"Capture mismatch: {view['id']} {key}")
    if set(v['id'] for v in actual['views'])!=set(baseline):raise ValueError('Missing or duplicate POVs')
    return expected,actual

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('candidate',type=Path)
    p.add_argument('--reference',type=Path,default=BASE/json.loads((BASE/'active-reference.json').read_text())['targets'])
    p.add_argument('--out',type=Path,required=True)
    args=p.parse_args()
    expected,actual=validate(args.candidate)
    args.out.mkdir(parents=True,exist_ok=True)
    report={'candidate':str(args.candidate),'reference':str(args.reference),'candidate_git':actual['git'],
        'formula':'0.2 * MAE + 0.3 * MAE at 1/4 size + 0.5 * MAE at 1/16 size; masked RGB, percent of 255; lower is better',
        'reference_resize':'Lanczos to capture size, no crop or registration', 'views':[]}
    for view in expected['views']:
        name=view['id']
        with Image.open(args.candidate/(name+'.png')) as im:a=im.convert('RGB')
        with Image.open(args.reference/(name+'.png')) as im:b=im.convert('RGB')
        if a.size!=(expected['config']['viewport']['width'],expected['config']['viewport']['height']):raise ValueError('Unexpected capture dimensions')
        mask=mask_for(a.size)
        scores,b=compare(a,b,mask)
        with Image.open(BASE/'before'/(name+'.png')) as im:baseline,_=compare(im.convert('RGB'),b,mask)
        scores.update(id=name,baseline_loss=baseline['loss'],improvement=baseline['loss']-scores['loss'])
        report['views'].append(scores)
        diff=ImageChops.difference(a,b).convert('L')
        heat=Image.merge('RGB',(diff.point(lambda x:min(255,x*4)),diff.point(lambda x:min(255,x)),Image.new('L',a.size,0)))
        heat=Image.composite(heat,Image.new('RGB',a.size,'#1c2632'),mask)
        heat.save(args.out/(name+'-heatmap.png'))
        print(f"{name}: loss {scores['loss']:.4f}; improvement {scores['improvement']:+.4f}")
    mask.save(args.out/'score-mask.png')
    report['mean_loss']=sum(v['loss'] for v in report['views'])/len(report['views'])
    (args.out/'scores.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()
