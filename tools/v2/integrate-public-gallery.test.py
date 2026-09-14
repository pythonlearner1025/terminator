"""Bounded CPU regression tests for the public export and immutable narrative."""
import base64
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.dont_write_bytecode = True
from gallery_narrative import COPY, STYLE, decorate, refresh
spec = importlib.util.spec_from_file_location('exporter', Path(__file__).with_name('export-public-gallery.py'))
exporter = importlib.util.module_from_spec(spec); spec.loader.exec_module(exporter)


class PublicGalleryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / 'gallery'; self.snapshot = self.source / 'snapshots/test'
        self.snapshot.mkdir(parents=True)
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
        (self.snapshot / 'fixture.png').write_bytes(png)
        images = [{'view': str(v), 'group': g, 'path': 'fixture.png', 'sha256': exporter.digest(self.snapshot / 'fixture.png')} for v in range(5) for g in ('original', 'target', 'candidate', 'linux')]
        meta = dict(milestone='test', images=images, views=list(map(str, range(5))), capture_dates=dict(first='2026', last='2026', basis='fixture'), diagnostic_overrides=[])
        (self.snapshot / 'gallery.json').write_text(json.dumps(meta))
        history = dict(schema='v2-review-gallery-1', latest='test', milestones=[dict(id='test', label='Test', path='snapshots/test/index.html')])
        (self.source / 'history.json').write_text(json.dumps(history))
        body = '<!doctype html><html><head></head><body><div class="comparison">' + '<img src="fixture.png" alt="test">' * 15 + '</div><a href="gallery.json">Evidence</a><a href="../../index.html">Latest</a></body></html>'
        (self.snapshot / 'index.html').write_text(body)
        (self.source / 'index.html').write_text(body.replace('fixture.png', 'snapshots/test/fixture.png').replace('href="gallery.json"', 'href="snapshots/test/gallery.json"').replace('../../index.html', 'index.html'))
        refresh(self.source)

    def test_repeatable_export_dedup_exact_images_and_immutable_source(self):
        before = {p: p.read_bytes() for p in self.source.rglob('*') if p.is_file()}
        result = exporter.export(self.source, self.base / 'public1')
        exporter.export(self.source, self.base / 'public2')
        self.assertEqual(result['unique_pngs'], 1)
        self.assertEqual(result['verbatim_quotes'], 7)
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        left = {p.relative_to(self.base / 'public1'): p.read_bytes() for p in (self.base / 'public1').rglob('*') if p.is_file()}
        right = {p.relative_to(self.base / 'public2'): p.read_bytes() for p in (self.base / 'public2').rglob('*') if p.is_file()}
        self.assertEqual(left, right)
        self.assertEqual(next(p for p in (self.base / 'public1').rglob('*.png')).read_bytes(), (self.snapshot / 'fixture.png').read_bytes())
        for page in (self.base / 'public1').rglob('*.html'):
            self.assertIn(STYLE, page.read_text())
            self.assertEqual(page.read_text().count('<style>'), 1)

    def test_refresh_is_idempotent_and_does_not_touch_history_or_archives(self):
        before = (self.snapshot / 'index.html').read_bytes()
        current = (self.source / 'index.html').read_bytes()
        history = (self.source / 'history.json').read_bytes()
        refresh(self.source)
        self.assertEqual(before, (self.snapshot / 'index.html').read_bytes())
        self.assertEqual(current, (self.source / 'index.html').read_bytes())
        self.assertEqual(history, (self.source / 'history.json').read_bytes())
        self.assertEqual(decorate(current.decode()), current.decode())
        copy = json.loads(COPY.read_text())
        self.assertEqual(len(copy['recap']), 4)
        self.assertLessEqual(len(' '.join(copy['recap']).split()), 110)
        recap = current.decode().split('<ul class="recap">')[1].split('</ul>')[0]
        self.assertEqual(recap.count('<li>'), 4)

    def test_reject_private_paths_and_escaping_links_without_partial_export(self):
        for bad in ('<p>/home/private/file</p>', '<a href="../../../secret.json">bad</a>', '<script>alert(1)</script>'):
            with self.subTest(bad=bad):
                path = self.source / 'index.html'; old = path.read_text(); path.write_text(old.replace('</body>', bad + '</body>'))
                with self.assertRaises(ValueError):
                    exporter.export(self.source, self.base / 'bad')
                self.assertFalse((self.base / 'bad').exists())
                self.assertFalse(list(self.base.glob('.bad-*')))
                path.write_text(old)

    def test_platform_discovery_is_the_only_absolute_link_exception(self):
        result = exporter.export(self.source, self.base / 'platform')
        self.assertIn('/agents.md reserved platform endpoint', result['links'])
        for page in (self.base / 'platform').rglob('*.html'):
            self.assertEqual(page.read_text().count('href="/agents.md"'), 1)
        path = self.source / 'index.html'
        path.write_text(path.read_text().replace('href="/agents.md"', 'href="/private.md"'))
        with self.assertRaises(ValueError):
            exporter.export(self.source, self.base / 'bad')

    def test_reject_modified_image_and_existing_output(self):
        exporter.export(self.source, self.base / 'existing')
        with self.assertRaises(ValueError):
            exporter.export(self.source, self.base / 'existing')
        with (self.snapshot / 'fixture.png').open('ab') as stream:
            stream.write(b'changed')
        with self.assertRaisesRegex(ValueError, 'Image hash'):
            exporter.export(self.source, self.base / 'bad')

    def test_future_snapshot_owns_its_copy(self):
        old = (self.snapshot / 'index.html').read_text()
        (self.snapshot / 'index.html').write_text(decorate(old))
        (self.snapshot / 'public-copy.json').write_bytes(COPY.read_bytes())
        exporter.export(self.source, self.base / 'future')
        self.assertEqual(json.loads((self.base / 'future/snapshots/test/public-copy.json').read_text()), json.loads(COPY.read_text()))


if __name__ == '__main__':
    unittest.main()
