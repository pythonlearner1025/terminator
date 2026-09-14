#!/usr/bin/env python3
"""Auditable fixed-POV image diagnostics. Requires Pillow; no semantic pass is inferred."""
import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/scene-targets'
ORIGINAL_LINUX_QUATERNION_EPSILON = 1e-12
WARNING = ('Lower MAE alone is not semantic success. Darkening, blur, opaque fog and missing '
           'geometry can reduce RGB error. Inspect every unmasked view and gameplay evidence; '
           'regional scores are fixed screen-space proxies, not semantic segmentation.')
HUD_BOXES = [(0,.015,.145,.09),(.41,.02,.59,.14),(.84,.02,.99,.13),
             (0,.84,.15,1),(.85,.82,1,1),(.465,.94,.525,1)]
WEAPON = [(.465,1),(.50,.84),(.545,.75),(.535,.56),(.61,.545),
          (.657,.68),(.655,.80),(.735,.85),(.81,1)]


def box_pixels(box, size):
    return tuple(round(v * size[i % 2]) for i, v in enumerate(box))


def mask_for(size):
    mask = Image.new('L', size, 255)
    draw = ImageDraw.Draw(mask)
    for box in HUD_BOXES:
        draw.rectangle(box_pixels(box, size), fill=0)
    draw.polygon([(int(x*size[0]), int(y*size[1])) for x, y in WEAPON], fill=0)
    return mask


def region_masks(size, view_id):
    """Fixed before candidate inspection; full scored image is partitioned exactly once."""
    scene = mask_for(size)
    atmosphere = Image.new('L', size, 0)
    draw = ImageDraw.Draw(atmosphere)
    if view_id in ('03-barracks', '04-service'):
        boxes = ([(.08,.34,.27,.58),(.46,.44,.54,.60),(.75,.39,.95,.60)]
                 if view_id == '03-barracks' else [(.46,.44,.54,.60)])
        ground_start = .62
    else:
        boxes = [(0,0,1,.40 if view_id == '05-rooftop' else .38)]
        ground_start = .66 if view_id == '05-rooftop' else .62
    for box in boxes:
        draw.rectangle(box_pixels(box, size), fill=255)
    atmosphere = ImageChops.multiply(atmosphere, scene)
    ground = Image.new('L', size, 0)
    ImageDraw.Draw(ground).rectangle(box_pixels((0,ground_start,1,1),size), fill=255)
    ground = ImageChops.multiply(ground, scene)
    architecture = ImageChops.subtract(scene, ImageChops.lighter(atmosphere, ground))
    return {'atmosphere': atmosphere, 'architecture': architecture, 'ground': ground}


def pixel_count(mask):
    return sum(mask.histogram()[1:])


def compare(candidate, reference, mask):
    if mask.size != candidate.size or pixel_count(mask) == 0:
        raise ValueError('Empty or incorrectly sized score mask')
    if abs(candidate.width/candidate.height-reference.width/reference.height) > .01:
        raise ValueError('Reference aspect ratio differs from capture; refusing an implicit crop')
    reference = reference.resize(candidate.size, Image.Resampling.LANCZOS)
    values, counts = [], []
    for scale in (1,4,16):
        size = (max(1,candidate.width//scale), max(1,candidate.height//scale))
        # Score only fully included downsample footprints: excluded HUD cannot bleed in.
        m = mask.resize(size, Image.Resampling.BOX).point(lambda x: 255 if x == 255 else 0)
        count = pixel_count(m)
        if not count:
            raise ValueError(f'Empty score mask at scale {scale}')
        a = candidate.resize(size, Image.Resampling.BOX)
        b = reference.resize(size, Image.Resampling.BOX)
        values.append(sum(ImageStat.Stat(ImageChops.difference(a,b),m).mean)/3/255*100)
        counts.append(count)
    return {'mae_percent':values[0], 'mae_4x_percent':values[1], 'mae_16x_percent':values[2],
            'loss':sum(a*b for a,b in zip(values,(.2,.3,.5))),
            'scored_pixels_by_scale':dict(zip(('1','4','16'),counts))}, reference


def diagnostics(image, mask):
    """Unweighted guardrails: never converted into a score or used to normalize images."""
    gray = image.convert('L')
    hist = gray.histogram(mask=mask)
    count = sum(hist)
    stat = ImageStat.Stat(gray,mask)
    edge_mask = mask.filter(ImageFilter.MinFilter(3))
    # Exclude image border, too, so ImageChops.offset's wrap cannot contribute.
    draw = ImageDraw.Draw(edge_mask)
    draw.rectangle((0,0,image.width-1,image.height-1),outline=0,width=1)
    edges = [ImageChops.difference(gray, ImageChops.offset(gray,dx,dy)) for dx,dy in [(1,0),(0,1)]]
    return {'mean_luma_percent':stat.mean[0]/255*100,
            'luma_stddev_percent':stat.stddev[0]/255*100,
            'near_black_percent':sum(hist[:9])/count*100,
            'near_white_percent':sum(hist[247:])/count*100,
            'edge_energy_percent':sum(ImageStat.Stat(e,edge_mask).mean[0] for e in edges)/2/255*100}


def read_json(path):
    def reject(value):
        raise ValueError(f'Non-finite JSON number: {value}')
    return json.loads(path.read_text(), parse_constant=reject)


def indexed(manifest, label):
    views = manifest['views']
    ids = [v['id'] for v in views]
    if len(ids) != len(set(ids)):
        raise ValueError(f'{label}: duplicate POVs')
    return {v['id']:v for v in views}


def require_equal(a, b, keys, label):
    for key in keys:
        if key not in a or key not in b or a[key] != b[key]:
            raise ValueError(f'Capture mismatch: {label} {key}')


def require_original_camera(baseline, original, label, allow_linux_rounding=False):
    if not allow_linux_rounding:
        require_equal(baseline,original,['camera'],label)
        return
    a, b = baseline.get('camera'), original.get('camera')
    if not isinstance(a,dict) or not isinstance(b,dict) or set(a) != set(b):
        raise ValueError(f'Capture mismatch: {label} camera fields')
    # Only computed quaternion components can differ across the original Mac and
    # external Linux captures. Do not normalize quaternions or relax framing.
    require_equal(a,b,[key for key in b if key != 'quaternion'],label+' camera')
    qa, qb = a.get('quaternion'), b.get('quaternion')
    for quaternion in (qa,qb):
        if (not isinstance(quaternion,list) or len(quaternion) != 4 or
                not all(type(v) in (int,float) and math.isfinite(v) for v in quaternion)):
            raise ValueError(f'Capture mismatch: {label} camera quaternion must have four finite numbers')
    if any(abs(x-y) > ORIGINAL_LINUX_QUATERNION_EPSILON for x,y in zip(qa,qb)):
        raise ValueError(f'Capture mismatch: {label} camera quaternion exceeds 1e-12 absolute tolerance')


def verify_images(directory, manifest):
    size = tuple(manifest['config']['viewport'][k] for k in ('width','height'))
    for view in manifest['views']:
        path = directory / (view['id']+'.png')
        if hashlib.sha256(path.read_bytes()).hexdigest() != view['sha256']:
            raise ValueError(f'PNG sha256 mismatch: {view["id"]} in {directory}')
        with Image.open(path) as image:
            if image.size != size:
                raise ValueError(f'Unexpected capture dimensions: {path}')
        if view.get('errors') != []:
            raise ValueError(f'Capture errors or missing error evidence: {view["id"]}')


def validate(candidate, capture_baseline=None, original_dir=None):
    original_dir = Path(original_dir) if original_dir else BASE/'before'
    baseline_dir = Path(capture_baseline) if capture_baseline else original_dir
    original = read_json(original_dir/'capture.json')
    expected = read_json(baseline_dir/'capture.json')
    actual = read_json(Path(candidate)/'capture.json')
    original_views = indexed(original,'original')
    baseline_views = indexed(expected,'baseline')
    actual_views = indexed(actual,'candidate')
    if set(baseline_views) != set(original_views) or set(actual_views) != set(original_views):
        raise ValueError('Missing or unexpected POVs')
    core = ['config','deviceScaleFactor','mode']
    require_equal(expected,original,core,'baseline vs original')
    require_equal(actual,expected,core+['schema','platform','browser'],'candidate vs baseline')
    external = baseline_dir.resolve() != original_dir.resolve()
    if external:
        env = expected.get('captureEnvironment')
        if not isinstance(env,dict) or not isinstance(env.get('headless'),bool) or not isinstance(env.get('browserArgs'),list) or not all(isinstance(a,str) for a in env['browserArgs']):
            raise ValueError('External capture baseline requires captureEnvironment: headless, browserArgs')
        require_equal(actual,expected,['captureEnvironment'],'candidate vs baseline')
    for name, original_view in original_views.items():
        baseline, view = baseline_views[name], actual_views[name]
        fields = ['camera','feet','support','tick','mapState','weapon']
        require_equal(baseline,original_view,fields[1:],name+' baseline vs original')
        require_original_camera(baseline,original_view,name+' baseline vs original',
                                allow_linux_rounding=(external and original['platform'] == 'darwin'
                                                      and expected['platform'] == 'linux'))
        # Same-machine baseline-to-candidate equality remains exact, even at 1 ULP.
        require_equal(view,baseline,fields+['renderer'],name+' candidate vs baseline')
        if external or 'renderSettings' in baseline or 'renderSettings' in view:
            settings = baseline.get('renderSettings')
            if not isinstance(settings,dict) or not all(k in settings for k in ('drawingBuffer','pixelRatio','renderScale')):
                raise ValueError(f'{name}: external baseline requires measured renderSettings')
            buffer = settings['drawingBuffer']
            if not isinstance(buffer,list) or len(buffer)!=2 or not all(type(v) is int and v>0 for v in buffer):
                raise ValueError(f'{name}: invalid drawingBuffer')
            if not all(type(settings[k]) in (int,float) and math.isfinite(settings[k]) and settings[k]>0 for k in ('pixelRatio','renderScale')):
                raise ValueError(f'{name}: invalid render scale')
            require_equal(view,baseline,['renderSettings'],name)
    # Unknown future render metadata is also compared whenever emitted on either side.
    for key in ('renderSettings','captureEnvironment'):
        if key in expected or key in actual:
            require_equal(actual,expected,[key],'candidate vs baseline')
    for directory, manifest in [(original_dir,original),(baseline_dir,expected),(Path(candidate),actual)]:
        verify_images(directory,manifest)
    return expected,actual


def load_image(path):
    with Image.open(path) as image:
        return image.convert('RGB')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('candidate',type=Path)
    p.add_argument('--capture-baseline',type=Path,default=BASE/'before',
                   help='Independent unchanged-game capture directory (PNG files + capture.json); preserves original POVs')
    p.add_argument('--reference',type=Path,default=BASE/'targets-v2')
    p.add_argument('--out',type=Path,required=True)
    args = p.parse_args()
    try:
        expected,actual = validate(args.candidate,args.capture_baseline)
        # Never write report artifacts into any input directory, even by accident.
        for source in (args.candidate,args.capture_baseline,args.reference,BASE/'before'):
            if args.out.resolve() == source.resolve() or source.resolve() in args.out.resolve().parents:
                raise ValueError('Report output must be separate from capture/reference inputs')
        if args.out.exists() and any(args.out.iterdir()):
            raise ValueError('Report output is not empty; choose a new directory')
        prepared = []
        for view in expected['config']['views']:
            name = view['id']
            a = load_image(args.candidate/(name+'.png'))
            b = load_image(args.reference/(name+'.png'))
            mask = mask_for(a.size)
            score,b = compare(a,b,mask)
            baseline_image = load_image(args.capture_baseline/(name+'.png'))
            baseline,_ = compare(baseline_image,b,mask)
            original,_ = compare(load_image(BASE/'before'/(name+'.png')),b,mask)
            score.update(id=name,baseline=baseline,baseline_loss=baseline['loss'],
                         original_baseline=original,improvement=baseline['loss']-score['loss'],
                         mask_coverage_percent=pixel_count(mask)/(a.width*a.height)*100,regions={})
            regions = region_masks(a.size,name)
            for region, region_mask in regions.items():
                result,_ = compare(a,b,region_mask)
                base,_ = compare(baseline_image,b,region_mask)
                result.update(baseline=base,improvement=base['loss']-result['loss'],
                              coverage_percent=pixel_count(region_mask)/(a.width*a.height)*100,
                              candidate_diagnostics=diagnostics(a,region_mask),
                              baseline_diagnostics=diagnostics(baseline_image,region_mask),
                              target_diagnostics=diagnostics(b,region_mask))
                score['regions'][region] = result
            prepared.append((score,a,b,mask,regions))
        args.out.mkdir(parents=True,exist_ok=True)
        report = {'schema':2,'decision':'not_assessed','warning':WARNING,
                  'candidate':str(args.candidate),'reference':str(args.reference),
                  'capture_baseline':str(args.capture_baseline),'candidate_git':actual['git'],
                  'baseline_git':expected['git'],
                  'camera_validation':{'original_mac_to_external_linux_quaternion_absolute_tolerance':ORIGINAL_LINUX_QUATERNION_EPSILON,
                                       'all_other_original_framing':'exact',
                                       'baseline_to_candidate':'exact, including quaternion'},
                  'formula':'0.2 * MAE + 0.3 * MAE at 1/4 + 0.5 * MAE at 1/16; masked RGB percent of 255',
                  'reference_resize':'Lanczos to capture size; no crop, registration, color correction or candidate blur',
                  'mask_version':2,'multiscale_mask':'Only fully included BOX footprints are scored; excludes HUD bleed',
                  'regions':'Fixed proxies partition ALL unmasked pixels; atmosphere uses interior openings indoors',
                  'views':[entry[0] for entry in prepared]}
        lines = ['# V2 comparison diagnostics','',WARNING,'',
                 'Scene acceptance: **not assessed**. Performance: **not measured by this image tool**.','',
                 '| View | Raw MAE % | 4x | 16x | Loss | Baseline loss | Improvement | Atmosphere | Architecture | Ground |',
                 '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
        for score,a,b,mask,regions in prepared:
            name=score['id']
            values=[score[k] for k in ('mae_percent','mae_4x_percent','mae_16x_percent','loss','baseline_loss','improvement')]
            values += [score['regions'][r]['loss'] for r in ('atmosphere','architecture','ground')]
            lines.append('| '+name+' | '+' | '.join(f'{v:.4f}' for v in values)+' |')
            diff = ImageChops.difference(a,b).convert('L')
            heat = Image.merge('RGB',(diff.point(lambda x:min(255,x*4)),diff,Image.new('L',a.size,0)))
            Image.composite(heat,Image.new('RGB',a.size,'#1c2632'),mask).save(args.out/(name+'-heatmap.png'))
            overlay = a.copy()
            colors={'atmosphere':'#487acc','architecture':'#bc844b','ground':'#459267'}
            for region,m in regions.items():
                overlay = Image.composite(Image.blend(a,Image.new('RGB',a.size,colors[region]),.35),overlay,m)
                m.save(args.out/(name+'-'+region+'-mask.png'))
            overlay.save(args.out/(name+'-regions.png'))
            print(f"{name}: loss {score['loss']:.4f}; improvement {score['improvement']:+.4f}")
        prepared[0][3].save(args.out/'score-mask.png')
        report['mean_loss']=sum(v['loss'] for v in report['views'])/len(report['views'])
        report['worst_view']=max(report['views'],key=lambda v:v['loss'])['id']
        (args.out/'scores.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
        (args.out/'report.md').write_text('\n'.join(lines)+'\n\nSee scores.json for per-region raw/multiscale errors and unweighted luminance/detail diagnostics.\n')
        print(WARNING)
    except (ValueError,KeyError,OSError,TypeError) as error:
        p.exit(2,f'Comparison refused: {error}\n')


if __name__ == '__main__':
    main()
