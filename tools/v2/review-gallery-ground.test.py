"""CPU provenance/pairing regression fixtures; no capture files or GPU required."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('gallery', Path(__file__).with_name('review-gallery.py'))
gallery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery)


def module(owner, commit):
    names = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', commit, 'lib/view/v2', f'assets/v2/{owner}'], text=True).splitlines()
    names = [n for n in names if n.startswith(f'assets/v2/{owner}/') or n == f'lib/view/v2/{owner}.js' or n.startswith(f'lib/view/v2/{owner}-')]
    return {'owner': owner, 'commit': commit, 'sourceFiles': {n: hashlib.sha256(subprocess.check_output(['git', 'show', f'{commit}:{n}'])).hexdigest() for n in names}}


class GroundGalleryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = {'diagnosticOverrides': {'modules': [module('architecture', '3880a0957713d33e8c229c2c0008f0ebc5c7b377'), module('ground', '426ae9b3ceef37e1d9c044dde7efdf902ca541f2')]},
                       'views': [{'id': f'view-{i}', 'moduleStats': dict.fromkeys(gallery.GROUND_MOUNT_ORDER)} for i in range(5)]}
        for view in cls.fixture['views']:
            view['moduleStats']['ground'] = {'ready': True, 'disposed': False, 'patches': 8500, 'triangles': 102000, 'draws': 5}

    def test_exact_ground_pair_accepted(self):
        self.assertEqual(len(gallery.verify_overrides(copy.deepcopy(self.fixture))), 2)

    def test_r4_morphology_pair_is_diagnostic_compatible_without_scene_approval(self):
        m = copy.deepcopy(self.fixture)
        m['diagnosticOverrides']['modules'] = [
            module('architecture', '0cee1d6c647bf6bf13bd81c78e88ea7cb50c81d9'),
            module('ground', 'cfabfae786dbfaba17af4dde79ceb6b30ffb3dbf'),
        ]
        self.assertEqual(len(gallery.verify_overrides(m)), 2)
        # A changed morphology helper still needs its exact committed source hash.
        m['diagnosticOverrides']['modules'][0]['sourceFiles']['lib/view/v2/architecture-morphology.js'] = '0'*64
        with self.assertRaises(ValueError):
            gallery.verify_overrides(m)

    def test_unpaired_ground_rejected(self):
        m = copy.deepcopy(self.fixture); m['diagnosticOverrides']['modules'].pop(0)
        with self.assertRaisesRegex(ValueError, 'paired architecture'):
            gallery.verify_overrides(m)

    def test_unreviewed_and_rejected_geometry_can_be_displayed_with_exact_provenance(self):
        m = copy.deepcopy(self.fixture)
        m['diagnosticOverrides']['modules'][0] = module('architecture', '4f02096d3a386cd369d79025d77c1c86af97abc3')
        modules = gallery.verify_overrides(m)
        review = gallery.pairing_source_review(modules)
        self.assertFalse(review['recorded'])
        self.assertEqual(review['status'], 'unreviewed')
        self.assertIsNone(review['source_decision'])
        self.assertIsNone(review['report'])

    def test_source_review_annotation_is_exact_and_does_not_approve_scene(self):
        review = gallery.pairing_source_review(gallery.verify_overrides(copy.deepcopy(self.fixture)))
        self.assertTrue(review['recorded'])
        self.assertEqual(review['source_decision'], 'revise')
        self.assertIn('scene approval are not established', review['scope'])
        m = copy.deepcopy(self.fixture)
        # Same reviewed architecture with a different ground revision is not the
        # historical pair; a byte-similar source must not inherit that annotation.
        m['diagnosticOverrides']['modules'][1] = module('ground', 'cfabfae786dbfaba17af4dde79ceb6b30ffb3dbf')
        self.assertFalse(gallery.pairing_source_review(gallery.verify_overrides(m))['recorded'])

    def test_mount_order_and_active_ground_required(self):
        for field in ('order', 'missing', 'architecture', 'ready', 'disposed', 'draws'):
            with self.subTest(field=field):
                m = copy.deepcopy(self.fixture); v = m['views'][2]
                if field == 'order': v['moduleStats'] = {k: v['moduleStats'][k] for k in ['architecture', 'materials', 'ground', 'lighting', 'effects']}
                elif field == 'missing': del v['moduleStats']['ground']
                elif field == 'architecture': del v['moduleStats']['architecture']
                else: v['moduleStats']['ground'][field] = {'ready': False, 'disposed': True, 'draws': 0}[field]
                with self.assertRaises(ValueError): gallery.verify_overrides(m)

    def test_ground_hash_inventory_and_unknown_owner_still_strict(self):
        for field in ('hash', 'inventory', 'owner'):
            with self.subTest(field=field):
                m = copy.deepcopy(self.fixture); g = m['diagnosticOverrides']['modules'][1]
                if field == 'hash': g['sourceFiles']['lib/view/v2/ground.js'] = '0'*64
                elif field == 'inventory': del g['sourceFiles']['lib/view/v2/ground-layout.js']
                else: g['owner'] = 'main'
                with self.assertRaises(ValueError): gallery.verify_overrides(m)

if __name__ == '__main__': unittest.main()
