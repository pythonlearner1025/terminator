#!/usr/bin/env python3
"""Export only gallery HTML, original PNG bytes and allowlisted public metadata.

Source snapshots are never modified. Exported HTML is adapted for portable links
and sanitized metadata; its bytes necessarily differ from the private original.
Output must not exist. All work is sequential and image hashing is streamed.
"""
import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import sys
sys.dont_write_bytecode = True
from urllib.parse import unquote, urlsplit
from gallery_narrative import platform_footer, restyle

PITT = 'https://sites.pitt.edu/~goscilo/Sci-Fi/FilmStills/TheTerminator.html'
PRIVATE = re.compile(r'/home/|/Users/|/var/folders/|\.kite3d|rollout-.*?\.jsonl|source_file|X-Kite3D-Token|[?&](?:t|token|auth)=|(?:api[_-]?key|authorization|access[_-]?token|session[_-]?token)\s*[=:]', re.I)
HISTORY_KEYS = ('id', 'label', 'revision', 'review_status', 'source_commit', 'base_commit', 'diagnostic', 'path', 'generated_at')
EVIDENCE_KEYS = ('milestone', 'label', 'revision', 'review_status', 'status_label', 'reviewed_commit', 'base_commit', 'scene_approved', 'diagnostic', 'generated_at', 'views')


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def within(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError('Missing or escaping gallery input: ' + str(relative))
    return path


def safe_text(value):
    if PRIVATE.search(html.unescape(value)):
        raise ValueError('Private path or credential-like field in public content')
    return value


def write_json(path, data):
    text = safe_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


class Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.ids, self.images = [], set(), 0
        self.quotes, self.quote = {}, None
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.add(attrs['id'])
        for key in ('src', 'href'):
            if key in attrs:
                self.links.append(attrs[key])
        self.images += tag == 'img'
        if tag == 'blockquote' and 'data-excerpt' in attrs:
            self.quote = attrs['data-excerpt']
            self.quotes[self.quote] = ''
    def handle_endtag(self, tag):
        if tag == 'blockquote':
            self.quote = None
    def handle_data(self, data):
        if self.quote:
            self.quotes[self.quote] += data


def validate_export(out):
    history = json.loads((out / 'history.json').read_text())
    copy = json.loads((out / 'public-copy.json').read_text())
    pages = {}
    for path in out.rglob('*.html'):
        text = safe_text(path.read_text())
        if re.search(r'<(?:script|iframe|object)\b|\son\w+\s*=', text, re.I):
            raise ValueError('Unexpected active content')
        parser = Links(); parser.feed(text); pages[path.resolve()] = parser
        if parser.images != 15:
            raise ValueError('Each comparison needs exactly 15 images')
    if len(pages) != len(history['milestones']) + 1:
        raise ValueError('History/page count mismatch')
    for path, parser in pages.items():
        for link in parser.links:
            if link == '/agents.md':
                continue  # Reserved Teeny platform endpoint; deliberately no local file.
            url = urlsplit(link)
            if url.scheme or url.netloc:
                if link != PITT:
                    raise ValueError('Unexpected external URL: ' + link)
                continue
            if url.query or url.path.startswith('/'):
                raise ValueError('Nonportable link')
            target = within(out, (path.parent / unquote(url.path)).relative_to(out)) if url.path else path
            if url.fragment and url.fragment not in pages.get(target, parser if target == path else Links()).ids:
                raise ValueError('Missing anchor: ' + link)
    root = pages[(out / 'index.html').resolve()]
    if root.quotes != {x['id']: x['text'] for x in copy['excerpts']}:
        raise ValueError('Rendered quotes differ from public source of copy')
    for path in out.rglob('*'):
        if path.is_file() and path.suffix != '.png':
            safe_text(path.read_text())
    return {'comparison_pages': len(pages), 'historical_pages': len(history['milestones']), 'images_per_page': 15,
            'verbatim_quotes': len(root.quotes), 'links': 'all file links and anchors resolve; /agents.md reserved platform endpoint; Pitt is the sole external link',
            'privacy': 'allowlisted output; no private paths, session metadata, raw logs or active scripts'}


def export(gallery, destination):
    gallery, destination = gallery.resolve(), destination.resolve()
    if destination.exists() or destination.is_relative_to(gallery) or gallery.is_relative_to(destination):
        raise ValueError('Use a new output directory separate from the source gallery')
    history = json.loads(within(gallery, 'history.json').read_text())
    if history.get('schema') != 'v2-review-gallery-1':
        raise ValueError('Unexpected history schema')
    milestones = history['milestones']
    if len({x['id'] for x in milestones}) != len(milestones):
        raise ValueError('Duplicate milestone')
    safe_history = {'schema': 'v2-public-gallery-1', 'latest': history['latest'],
                    'milestones': [{k: m[k] for k in HISTORY_KEYS if k in m} for m in milestones]}
    if history['latest'] not in {m['id'] for m in milestones}:
        raise ValueError('Latest absent from history')
    mapping, evidence, inputs = {}, {}, {}
    def record(path):
        inputs[path.relative_to(gallery).as_posix()] = digest(path)
    record(gallery / 'history.json')
    # Resolve the entire allowlist before copying any files.
    for m in milestones:
        if not re.fullmatch('[a-z0-9][a-z0-9_-]{0,79}', m['id']) or m['path'] != f'snapshots/{m["id"]}/index.html':
            raise ValueError('Unexpected milestone path')
        page = within(gallery, m['path']); record(page)
        meta = within(gallery, page.parent.relative_to(gallery) / 'gallery.json'); record(meta)
        data = json.loads(meta.read_text())
        if data['milestone'] != m['id'] or len(data['images']) != 20:
            raise ValueError('Invalid milestone image inventory')
        safe = {'schema': 'v2-public-evidence-1', **{k: data[k] for k in EVIDENCE_KEYS if k in data},
                'capture_dates': {k: data['capture_dates'][k] for k in ('first', 'last', 'basis')},
                'note': 'Public summary only. Private capture manifests and source-file inventories are omitted. Diagnostic labels are retained; no scene approval is implied.',
                'owners': [{'owner': x['owner'], 'commit': x['commit']} for x in data.get('diagnostic_overrides', [])], 'images': []}
        seen = set()
        for img in data['images']:
            identity = (img['view'], img['group'])
            if identity in seen or img['group'] not in ('original', 'target', 'candidate', 'linux') or img['view'] not in data['views']:
                raise ValueError('Unexpected image identity')
            seen.add(identity)
            source = within(gallery, page.parent.relative_to(gallery) / img['path'])
            if source.suffix != '.png' or digest(source) != img['sha256']:
                raise ValueError('Image hash or format differs from recorded evidence')
            with source.open('rb') as stream:
                if stream.read(8) != b'\x89PNG\r\n\x1a\n':
                    raise ValueError('Invalid PNG signature')
            record(source)
            asset = f'static/assets/{img["sha256"]}.png'
            mapping[source] = asset
            safe['images'].append({'view': img['view'], 'group': img['group'], 'path': '../../' + asset, 'sha256': img['sha256']})
        evidence[meta.relative_to(gallery)] = safe
        mapping[page] = page.relative_to(gallery).as_posix()
        mapping[meta] = meta.relative_to(gallery).as_posix()
        local_copy = page.parent / 'public-copy.json'
        if local_copy.is_file():
            record(local_copy); mapping[local_copy] = local_copy.relative_to(gallery).as_posix()
    for name in ('index.html', 'history.json', 'public-copy.json'):
        path = within(gallery, name); record(path); mapping[path] = name
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.' + destination.name + '-', dir=destination.parent))
    try:
        for source, relative in mapping.items():
            if source.suffix == '.png':
                target = staging / relative
                if not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, target)
                    if digest(target) != Path(relative).stem:
                        raise ValueError('Copied image checksum failed')
            elif source.suffix == '.html':
                text = source.read_text()
                # Preserve historical labels and body; replace private diagnostic
                # file inventories with the allowlisted adjacent evidence summary.
                text = re.sub(r'<details><summary>Expand exact base \+ owner commits and routed file hashes</summary>.*?</details>',
                              '<p>Exact revision identifiers are retained in the public image hashes and source provenance summary below. Private file inventories are omitted.</p>', text, flags=re.S)
                def rewrite(match):
                    link = html.unescape(match.group(2)); url = urlsplit(link)
                    if link == '/agents.md' or url.scheme or url.netloc or not url.path:
                        return match.group(0)
                    if url.query or url.path.startswith('/'):
                        raise ValueError('Unexpected nonportable input link')
                    original = within(gallery, (source.parent / unquote(url.path)).relative_to(gallery))
                    if original not in mapping:
                        raise ValueError('Link is not in export allowlist: ' + url.path)
                    new = os.path.relpath(staging / mapping[original], (staging / relative).parent)
                    if url.fragment:
                        new += '#' + url.fragment
                    return match.group(1) + html.escape(new, quote=True) + match.group(3)
                text = re.sub(r'((?:href|src)=")([^"]*)(")', rewrite, text)
                target = staging / relative; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(safe_text(platform_footer(restyle(text))))
        write_json(staging / 'history.json', safe_history)
        for relative, data in evidence.items():
            write_json(staging / relative, data)
        # Explicit field allowlist; no private transcript input is consumed here.
        for source, relative in mapping.items():
            if source.name != 'public-copy.json':
                continue
            copy = json.loads(source.read_text())
            copy = {k: copy[k] for k in ('schema', 'as_of_milestone', 'recap_title', 'recap', 'source_note', 'excerpts')}
            copy['excerpts'] = [{k: x[k] for k in ('id', 'label', 'text', 'timestamp', 'line', 'record_type', 'omission') if k in x} for x in copy['excerpts']]
            write_json(staging / relative, copy)
        checks = validate_export(staging)
        # Input receipts contain gallery-relative paths only, never machine paths.
        manifest = {'schema': 'v2-public-export-1', 'latest': history['latest'], 'checks': checks,
                    'image_policy': 'Original PNG bytes; SHA256 content-addressed deduplication; no resampling.',
                    'html_policy': 'Source archives unchanged. Export copies apply shared report CSS, adapt links and omit private provenance inventories.',
                    'source_gallery_sha256': inputs,
                    'files': {p.relative_to(staging).as_posix(): {'sha256': digest(p), 'bytes': p.stat().st_size} for p in sorted(staging.rglob('*')) if p.is_file()}}
        write_json(staging / 'export.json', manifest)
        # Verify input immutability, including bytes used to construct the output.
        if any(digest(gallery / p) != h for p, h in inputs.items()):
            raise ValueError('Source gallery changed during export')
        staging.rename(destination)
    except BaseException:
        shutil.rmtree(staging)
        raise
    files = [p for p in destination.rglob('*') if p.is_file()]
    return {**checks, 'files': len(files), 'unique_pngs': len(list(destination.rglob('*.png'))),
            'bytes': sum(p.stat().st_size for p in files), 'export_manifest_sha256': digest(destination / 'export.json')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('gallery', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    print(json.dumps(export(args.gallery, args.destination), indent=2))
