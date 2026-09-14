#!/usr/bin/env python3
"""Numerical and evidence-integrity fixtures; no browser or scene mutation."""
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import sys
import unittest
from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.dont_write_bytecode = True

SPEC = importlib.util.spec_from_file_location('compare',Path(__file__).resolve().parents[1]/'compare-scene-targets.py')
scorer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scorer)


class Scores(unittest.TestCase):
    def test_zero_and_known_difference_at_every_scale(self):
        a = Image.new('RGB',(320,192),(20,40,60))
        b = Image.new('RGB',a.size,(50,70,90))
        for mask in [scorer.mask_for(a.size),*scorer.region_masks(a.size,'03-barracks').values()]:
            same,_ = scorer.compare(a,a,mask)
            diff,_ = scorer.compare(a,b,mask)
            for key in ('mae_percent','mae_4x_percent','mae_16x_percent','loss'):
                self.assertEqual(same[key],0)
                self.assertAlmostEqual(diff[key],30/255*100)

    def test_excluded_hud_weapon_cannot_bleed_into_multiscale(self):
        a = Image.new('RGB',(320,192),'black')
        mask = scorer.mask_for(a.size)
        b = Image.composite(a,Image.new('RGB',a.size,'white'),mask)
        scores,_ = scorer.compare(a,b,mask)
        self.assertEqual(scores['loss'],0)

    def test_masks_cover_scene_exactly_once_and_preserve_majority(self):
        for view in ('01-courtyard','02-cargo','03-barracks','04-service','05-rooftop'):
            size=(1920,1080)
            scene = scorer.mask_for(size)
            masks=list(scorer.region_masks(size,view).values())
            self.assertGreater(scorer.pixel_count(scene)/(size[0]*size[1]),.75)
            self.assertEqual(sum(scorer.pixel_count(m) for m in masks),scorer.pixel_count(scene))
            self.assertIsNone(ImageChops.difference(ImageChops.lighter(ImageChops.lighter(*masks[:2]),masks[2]),scene).getbbox())
            for i in range(3):
                for j in range(i):
                    self.assertIsNone(ImageChops.multiply(masks[i],masks[j]).getbbox())

    def test_empty_mask_and_wrong_aspect_refused(self):
        a=Image.new('RGB',(320,192))
        with self.assertRaisesRegex(ValueError,'Empty'):
            scorer.compare(a,a,Image.new('L',a.size))
        with self.assertRaisesRegex(ValueError,'aspect ratio'):
            scorer.compare(a,Image.new('RGB',(192,320)),scorer.mask_for(a.size))

    def test_diagnostics_expose_darkening_and_blur(self):
        a=Image.new('RGB',(320,192),(70,90,110))
        draw=ImageDraw.Draw(a)
        for x in range(0,320,4):
            draw.rectangle((x,0,x+1,192),fill=(10,20,30))
        mask=scorer.mask_for(a.size)
        detail=scorer.diagnostics(a,mask)
        blurred=scorer.diagnostics(a.filter(ImageFilter.GaussianBlur(4)),mask)
        dark=scorer.diagnostics(Image.new('RGB',a.size),mask)
        self.assertGreater(detail['edge_energy_percent'],blurred['edge_energy_percent']*3)
        self.assertEqual(dark['near_black_percent'],100)
        self.assertLess(dark['mean_luma_percent'],detail['mean_luma_percent'])


class Evidence(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.original=self.root/'original'
        self.baseline=self.root/'baseline'
        self.candidate=self.root/'candidate'
        self.manifest=json.loads((scorer.BASE/'before/capture.json').read_text())
        self.manifest['config']['viewport']={'width':320,'height':180}
        for directory in (self.original,self.baseline,self.candidate):
            directory.mkdir()
            for view in self.manifest['views']:
                path=directory/(view['id']+'.png')
                Image.new('RGB',(320,180),(10,20,30)).save(path)
                view['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        self.write(self.original,self.manifest)
        self.linux=copy.deepcopy(self.manifest)
        self.linux.update(platform='linux',browser='fixture-chrome',captureEnvironment={'headless':True,'browserArgs':['--fixture']})
        for view in self.linux['views']:
            view.update(renderer='fixture-nvidia',renderSettings={'drawingBuffer':[320,180],'pixelRatio':1,'renderScale':1,'antialias':True})
        self.write(self.baseline,self.linux)
        self.write(self.candidate,self.linux)

    def tearDown(self):
        self.temp.cleanup()

    def write(self,directory,data):
        (directory/'capture.json').write_text(json.dumps(data))

    def validate(self):
        return scorer.validate(self.candidate,self.baseline,self.original)

    def test_independent_linux_baseline_accepted(self):
        expected,actual=self.validate()
        self.assertEqual(expected['platform'],'linux')
        self.assertEqual(len(actual['views']),5)

    def test_original_default_compatibility(self):
        self.write(self.candidate,self.manifest)
        scorer.validate(self.candidate,original_dir=self.original)

    def test_candidate_mismatches_fail(self):
        mutations=[('camera',lambda m:m['views'][0]['camera'].update(fov=73)),
                   ('camera',lambda m:m['views'][0]['camera']['position'].__setitem__(0,-11.99)),
                   ('camera',lambda m:m['views'][0]['camera']['quaternion'].__setitem__(0,.1)),
                   ('deviceScaleFactor',lambda m:m.update(deviceScaleFactor=2)),
                   ('config',lambda m:m['config']['settings'].update(quality='low')),
                   ('platform',lambda m:m.update(platform='darwin')),
                   ('browser',lambda m:m.update(browser='other')),
                   ('renderer',lambda m:m['views'][0].update(renderer='software')),
                   ('renderSettings',lambda m:m['views'][0]['renderSettings'].update(renderScale=.5)),
                   ('renderSettings',lambda m:m['views'][0]['renderSettings'].update(drawingBuffer=[640,360])),
                   ('captureEnvironment',lambda m:m['captureEnvironment'].update(headless=False)),
                   ('support',lambda m:m['views'][0]['support'].update(y=1)),
                   ('mapState',lambda m:m['views'][0]['mapState'].update(fog=1))]
        for field,mutate in mutations:
            with self.subTest(field=field):
                changed=copy.deepcopy(self.linux);mutate(changed);self.write(self.candidate,changed)
                with self.assertRaisesRegex(ValueError,field):self.validate()

    def test_baseline_cannot_redefine_original_camera_or_config(self):
        for field in ('camera','config'):
            changed=copy.deepcopy(self.linux)
            if field=='camera':changed['views'][0]['camera']['fov']=73
            else:changed['config']['seed']=99
            self.write(self.baseline,changed);self.write(self.candidate,changed)
            with self.assertRaisesRegex(ValueError,field):self.validate()

    def test_external_linux_quaternion_rounding_and_inclusive_boundary_accepted(self):
        for delta in (1e-17,-1e-17,1e-12,-1e-12):
            with self.subTest(delta=delta):
                changed=copy.deepcopy(self.linux)
                # Barracks x is exactly zero, so boundary checks have no subtraction rounding.
                changed['views'][2]['camera']['quaternion'][0]=delta
                self.write(self.baseline,changed);self.write(self.candidate,changed)
                expected,actual=self.validate()
                self.assertEqual(expected['views'][2]['camera']['quaternion'][0],delta)
                self.assertEqual(actual['views'][2]['camera']['quaternion'][0],delta)
                self.assertEqual(json.loads((self.original/'capture.json').read_text())['views'][2]['camera']['quaternion'][0],0)

    def test_external_linux_quaternion_beyond_boundary_and_sign_flip_rejected(self):
        for value in (math.nextafter(1e-12,math.inf),-math.nextafter(1e-12,math.inf),1e-8):
            changed=copy.deepcopy(self.linux)
            changed['views'][2]['camera']['quaternion'][0]=value
            self.write(self.baseline,changed);self.write(self.candidate,changed)
            with self.assertRaisesRegex(ValueError,'quaternion exceeds'):self.validate()
        # A value near one must not acquire a looser relative-error allowance.
        changed=copy.deepcopy(self.linux)
        changed['views'][2]['camera']['quaternion'][1]=1+5e-12
        self.write(self.baseline,changed);self.write(self.candidate,changed)
        with self.assertRaisesRegex(ValueError,'quaternion exceeds'):self.validate()
        changed=copy.deepcopy(self.linux)
        changed['views'][0]['camera']['quaternion']=[-v for v in changed['views'][0]['camera']['quaternion']]
        self.write(self.baseline,changed);self.write(self.candidate,changed)
        with self.assertRaisesRegex(ValueError,'quaternion exceeds'):self.validate()

    def test_linux_baseline_to_candidate_rejects_one_ulp_quaternion_change(self):
        changed=copy.deepcopy(self.linux)
        q=changed['views'][4]['camera']['quaternion']
        q[2]=math.nextafter(q[2],math.inf)
        self.assertLess(abs(q[2]-self.linux['views'][4]['camera']['quaternion'][2]),1e-12)
        self.write(self.candidate,changed)
        with self.assertRaisesRegex(ValueError,'candidate vs baseline camera'):self.validate()

    def test_tiny_changes_to_other_original_framing_still_rejected(self):
        for field in ('position','fov','near','far'):
            with self.subTest(field=field):
                changed=copy.deepcopy(self.linux)
                camera=changed['views'][0]['camera']
                if field=='position':camera[field][0]=math.nextafter(camera[field][0],math.inf)
                else:camera[field]=math.nextafter(camera[field],math.inf)
                self.write(self.baseline,changed);self.write(self.candidate,changed)
                with self.assertRaisesRegex(ValueError,'camera '+field):self.validate()
        changed=copy.deepcopy(self.linux)
        changed['config']['settings']['fov']=math.nextafter(72.,math.inf)
        self.write(self.baseline,changed);self.write(self.candidate,changed)
        with self.assertRaisesRegex(ValueError,'config'):self.validate()

    def test_quaternion_tolerance_not_applied_to_other_platform_pairs(self):
        for platform in ('darwin','win32'):
            changed=copy.deepcopy(self.linux)
            changed['platform']=platform
            changed['views'][2]['camera']['quaternion'][0]=1e-17
            self.write(self.baseline,changed);self.write(self.candidate,changed)
            with self.assertRaisesRegex(ValueError,'baseline vs original camera'):self.validate()
        original=copy.deepcopy(self.manifest);original['platform']='linux'
        self.write(self.original,original)
        changed=copy.deepcopy(self.linux)
        changed['views'][2]['camera']['quaternion'][0]=1e-17
        self.write(self.baseline,changed);self.write(self.candidate,changed)
        with self.assertRaisesRegex(ValueError,'baseline vs original camera'):self.validate()

    def test_malformed_quaternions_and_changed_camera_fields_rejected(self):
        for quaternion in (None,[],[0,1,0],[0,1,0,0,0],[0,True,0,0],[0,'1',0,0],
                           [0,float('nan'),0,0],[0,float('inf'),0,0]):
            changed=copy.deepcopy(self.linux)
            changed['views'][2]['camera']['quaternion']=quaternion
            self.write(self.baseline,changed);self.write(self.candidate,changed)
            with self.assertRaises(ValueError):self.validate()
        for field in ('quaternion','near'):
            changed=copy.deepcopy(self.linux);del changed['views'][0]['camera'][field]
            self.write(self.baseline,changed);self.write(self.candidate,changed)
            with self.assertRaisesRegex(ValueError,'camera fields'):self.validate()
        changed=copy.deepcopy(self.linux);changed['views'][0]['camera']['zoom']=2
        self.write(self.baseline,changed);self.write(self.candidate,changed)
        with self.assertRaisesRegex(ValueError,'camera fields'):self.validate()

    def test_missing_duplicate_unknown_views_rejected(self):
        variants=[self.linux['views'][:-1],self.linux['views']+[self.linux['views'][0]]]
        unknown=copy.deepcopy(self.linux['views']);unknown[0]['id']='unknown'
        variants.append(unknown)
        for views in variants:
            changed=copy.deepcopy(self.linux);changed['views']=views;self.write(self.candidate,changed)
            with self.assertRaisesRegex(ValueError,'POVs'):self.validate()

    def test_missing_measurements_rejected(self):
        for field in ('captureEnvironment','renderSettings'):
            changed=copy.deepcopy(self.linux)
            if field=='renderSettings':del changed['views'][0][field]
            else:del changed[field]
            self.write(self.baseline,changed);self.write(self.candidate,changed)
            with self.assertRaisesRegex(ValueError,field):self.validate()

    def test_errors_and_missing_errors_rejected(self):
        for value in (None,['WebGL error']):
            changed=copy.deepcopy(self.linux)
            changed['views'][0]['errors']=value
            self.write(self.candidate,changed)
            with self.assertRaisesRegex(ValueError,'Capture errors'):self.validate()

    def test_tampered_png_and_wrong_size_rejected(self):
        view=self.linux['views'][0]
        Image.new('RGB',(32,18)).save(self.candidate/(view['id']+'.png'))
        with self.assertRaisesRegex(ValueError,'sha256'):self.validate()
        changed=copy.deepcopy(self.linux)
        changed['views'][0]['sha256']=hashlib.sha256((self.candidate/(view['id']+'.png')).read_bytes()).hexdigest()
        self.write(self.candidate,changed)
        with self.assertRaisesRegex(ValueError,'dimensions'):self.validate()


if __name__=='__main__':
    unittest.main(verbosity=2)
