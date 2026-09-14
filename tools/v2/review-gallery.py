#!/usr/bin/env python3
"""Build portable Before | New target | Latest progress milestone galleries (CPU only)."""
import argparse
from datetime import datetime, timezone
import hashlib
import html
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from types import FunctionType
from gallery_narrative import COPY, decorate
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('scorer', Path(__file__).resolve().parents[1] / 'compare-scene-targets.py')
scorer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scorer)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def utc(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec='seconds')


def validate_capture(directory, baseline_directory, diagnostic=False):
    """Reuse every scorer invariant; only classify the explicit diagnostic mode in memory."""
    actual = scorer.read_json(directory / 'capture.json')
    if not diagnostic:
        if actual.get('diagnosticOverrides') is not None or actual.get('transparencyDiagnostic') is not None:
            raise ValueError('Diagnostic overrides require explicit --diagnostic')
        return scorer.validate(directory, baseline_directory)
    baseline = scorer.read_json(baseline_directory / 'capture.json')
    prefix = 'Diagnostic compositor override; ' if actual.get('transparencyDiagnostic') is not None else ''
    if actual.get('mode') != prefix + 'Diagnostic browser module overrides; ' + baseline['mode']:
        raise ValueError('Expected exact diagnostic mode classification')
    if not actual.get('diagnosticOverrides', {}).get('modules'):
        raise ValueError('Diagnostic capture requires committed override provenance')
    read_json = scorer.read_json
    def classified_read(path):
        result = read_json(path)
        if Path(path).resolve() == (directory / 'capture.json').resolve():
            result = dict(result, mode=baseline['mode'])
        return result
    # A private globals dictionary avoids changing the normal comparator or its module.
    validate = FunctionType(scorer.validate.__code__,
                            dict(scorer.validate.__globals__, read_json=classified_read),
                            argdefs=scorer.validate.__defaults__)
    expected, _ = validate(directory, baseline_directory)
    return expected, actual  # Preserve the original mode in the output provenance.


def verify_hashes(commit, files):
    for name, recorded_digest in files.items():
        recorded = subprocess.check_output(['git', 'show', f'{commit}:{name}'], cwd=scorer.ROOT)
        if hashlib.sha256(recorded).hexdigest() != recorded_digest:
            raise ValueError(f'Source hash differs from declared commit {commit}: {name}')


def verify_transparency(candidate):
    diagnostic = candidate.get('transparencyDiagnostic')
    if diagnostic is None:
        return None
    expected = {'purpose': 'Unapproved temporary per-viewer compositor correction',
                'equation': 'a.rgb*(1.-b.a)+b.rgb'}
    if diagnostic != expected:
        raise ValueError('Unsupported temporary compositor diagnostic declaration')
    path = 'tools/v2/capture-transparency-diagnostic.mjs'
    hashes = candidate.get('harnessSources', {})
    if path not in hashes:
        raise ValueError('Missing temporary compositor shader provenance')
    verify_hashes(candidate['git'], {path: hashes[path]})
    source = subprocess.check_output(['git', 'show', f"{candidate['git']}:{path}"], cwd=scorer.ROOT, text=True)
    if source.count("const stock='c = vec4(a.rgb * (1. - b.a) + b.rgb * b.a, 1.);'") != 1 or source.count("const corrected='c = vec4(a.rgb * (1. - b.a) + b.rgb, 1.);'") != 1:
        raise ValueError('Temporary compositor shader differs from declared equation')
    return dict(diagnostic, source=path, sha256=hashes[path])


def verify_overrides(candidate):
    modules = candidate['diagnosticOverrides']['modules']
    owners = set()
    for module in modules:
        owner, commit, files = module['owner'], module['commit'], module['sourceFiles']
        if owner not in ('architecture', 'materials', 'lighting', 'effects', 'ground', 'smoke') or owner in owners:
            raise ValueError('Invalid or duplicate diagnostic owner')
        owners.add(owner)
        if not re.fullmatch('[0-9a-f]{40}', commit):
            raise ValueError('Diagnostic owner revision must be an exact commit SHA')
        resolved = subprocess.check_output(['git', 'rev-parse', '--verify', commit + '^{commit}'], cwd=scorer.ROOT, text=True).strip()
        if resolved != commit:
            raise ValueError('Diagnostic owner revision is not a commit')
        tree = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', commit, 'lib/view/v2', f'assets/v2/{owner}'], cwd=scorer.ROOT, text=True).splitlines()
        routed = {name for name in tree if name.startswith(f'assets/v2/{owner}/') or name == f'lib/view/v2/{owner}.js' or name.startswith(f'lib/view/v2/{owner}-')}
        if owner == 'smoke':
            routed = {'lib/view/v2/lighting-volume.js', 'lib/view/v2/lighting-noise.js'}
            if 'lighting' not in owners or modules[-1] is not module:
                raise ValueError('Smoke helpers require a preceding lighting caller and final override position')
        if set(files) != routed or (owner != 'smoke' and f'lib/view/v2/{owner}.js' not in routed):
            raise ValueError(f'Diagnostic routing inventory differs from committed owner tree: {owner}')
        verify_hashes(commit, files)
    if 'ground' in owners:
        verify_ground_pairing(candidate, modules)
    return modules


# Historical source-review annotations, never a display allowlist. Exact owner
# pairs only: ancestry or a matching entry file cannot imply a reviewed helper.
GROUND_SOURCE_REVIEWS = {
    ('3880a0957713d33e8c229c2c0008f0ebc5c7b377', '426ae9b3ceef37e1d9c044dde7efdf902ca541f2'): ('revise', 'review.r3-source-audit-followup.json'),
    ('0cee1d6c647bf6bf13bd81c78e88ea7cb50c81d9', 'cfabfae786dbfaba17af4dde79ceb6b30ffb3dbf'): ('revise', 'review.r4-source-audit.json'),
    ('b22d9b08ede62fb6e3d64de1bcb15d4564851729', 'cfabfae786dbfaba17af4dde79ceb6b30ffb3dbf'): ('pass', 'review.r4-source-audit.json'),
}
GROUND_MOUNT_ORDER = ['architecture', 'ground', 'materials', 'lighting', 'effects']


def pairing_source_review(modules):
    by_owner = {module['owner']: module for module in modules}
    if not {'architecture', 'ground'}.issubset(by_owner):
        return None
    pair = tuple(by_owner[owner]['commit'] for owner in ('architecture', 'ground'))
    record = GROUND_SOURCE_REVIEWS.get(pair)
    return {'recorded': record is not None, 'status': 'reviewed' if record else 'unreviewed',
            'source_decision': record[0] if record else None, 'report': record[1] if record else None,
            'scope': 'Historical bounded source review only; compatibility and scene approval are not established by gallery validation.'}


def verify_ground_pairing(candidate, modules):
    by_owner = {module['owner']: module for module in modules}
    architecture = by_owner.get('architecture')
    if not architecture:
        raise ValueError('Ground diagnostic requires a paired architecture override')
    # The committed capture harness emits moduleStats from v2ModuleNames/handles
    # in actual mount order. Request-map order alone does not establish execution.
    for view in candidate['views']:
        stats = view.get('moduleStats', {})
        if list(stats) != GROUND_MOUNT_ORDER:
            raise ValueError(f'{view["id"]}: ground requires recorded architecture/ground/materials/lighting/effects mount order')
        ground = stats['ground']
        if ground.get('ready') is not True or ground.get('disposed') is not False:
            raise ValueError(f'{view["id"]}: ground is not recorded ready and active')
        if not all(type(ground.get(key)) is int and ground[key] > 0 for key in ('patches', 'triangles', 'draws')):
            raise ValueError(f'{view["id"]}: missing actual ground geometry statistics')


def page(evidence, history, prefix='', archive=False):
    esc = html.escape
    home = '../../' if archive else ''
    nav = ' · '.join(f'<a href="{home}{item["path"]}">{esc(item["label"])}</a>' for item in history['milestones'])
    document = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>V2 scene milestone gallery</title>
</head><body>'''
    document += f'<h1>{esc(evidence["label"])} · {esc(evidence["revision"])}</h1><p class="status"><strong>{esc(evidence["status_label"])}. No scene approval.</strong></p>'
    source_label = "Diagnostic base SHA (plus routed owner revisions below)" if evidence["diagnostic"] else "Actual progress source SHA"
    document += f'<p>Capture date range (UTC): {esc(evidence["capture_dates"]["first"])} — {esc(evidence["capture_dates"]["last"])}<br><small>{esc(evidence["capture_dates"]["basis"])}</small><br>{source_label}: <code>{evidence["base_commit"]}</code><br>Capture source: <code>{esc(evidence["candidate_source"])}</code><br>Gallery built: {evidence["generated_at"]}</p>'
    if evidence['diagnostic']:
        document += '<p class="status"><strong>DIAGNOSTIC / Needs revision. Browser-routed module overrides; this is not a clean integrated scene commit. Independent review pending.</strong></p>'
        if evidence.get('transparency_diagnostic'):
            document += '<p class="status"><strong>Temporary compositor diagnostic: alpha-associated transparent RGB is composited once. This per-viewer shader override is unapproved; exact shader helper bytes and hashes are recorded below.</strong></p>'
        review = evidence.get('pairing_source_review')
        if review:
            status = 'Prior bounded source review recorded' if review['recorded'] else 'Pairing source review: UNREVIEWED'
            document += f'<p class="status">{status}. Verified capture provenance does not establish compatibility, collision correctness or scene approval.</p>'
        document += '<details><summary>Expand exact base + owner commits and routed file hashes</summary>'
        document += '<pre style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(json.dumps({'base_commit': evidence['base_commit'], 'mode': evidence['capture_mode'], 'owners': evidence['diagnostic_overrides'], 'temporary_compositor': evidence.get('transparency_diagnostic'), 'pairing_source_review': review, 'base_source_files': evidence['verified_source_files'], 'harness_sources': evidence['harness_sources']}, indent=2)) + '</pre></details>'
    document += '<p>Before is the original real Mac capture. New target is the immutable selected V2 <strong>generated reference</strong>. Latest progress is an <strong>actual Linux game capture</strong>. All five original player POVs; images copied byte-for-byte without edits. Strict camera/config/device/render and source-hash checks passed. Lower RGB MAE alone is not semantic success.</p>'
    document += f'<nav aria-label="Milestone history">Milestones: {nav} · <a href="{home}index.html">Latest page</a> · <a href="{home}history.json">History manifest</a></nav>'
    document += '<div class="comparison"><div class="columns"><span>Before</span><span>V2 target</span><span>Latest progress</span></div>'
    titles = {'original': 'Original real before · Mac', 'target': 'Selected V2 · generated target', 'candidate': 'Actual latest progress · Linux'}
    if evidence['diagnostic']:
        titles['candidate'] += ' · DIAGNOSTIC / Needs revision'
    for view in evidence['views']:
        document += f'<section><h2>{esc(view)}</h2><div class="views">'
        for group in ('original', 'target', 'candidate'):
            record = next(item for item in evidence['images'] if item['view'] == view and item['group'] == group)
            link = prefix + record['path']
            document += f'<figure data-group="{group}"><a href="{link}" target="_blank"><img loading="lazy" src="{link}" alt="{esc(titles[group] + ": " + view)}"></a><figcaption>{esc(titles[group])} · click for original resolution</figcaption></figure>'
        document += '</div></section>'
    document += f'</div><p><a href="{prefix}gallery.json">Image hashes and source provenance</a>. Matched unchanged Linux baseline is retained as supporting evidence:</p><ul>'
    for record in evidence['images']:
        if record['group'] == 'linux':
            document += f'<li><a href="{prefix}{record["path"]}">{esc(record["view"])}</a></li>'
    return decorate(document + '</ul></body></html>\n', copy_href='public-copy.json')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--capture-baseline', type=Path, required=True)
    parser.add_argument('--reviewed-commit', required=True)
    parser.add_argument('--out', type=Path, required=True, help='Portable gallery directory; later milestones append here')
    parser.add_argument('--milestone', required=True, help='Unique immutable snapshot id, e.g. r2')
    parser.add_argument('--label', required=True, help='Human-readable milestone label')
    parser.add_argument('--revision', required=True, help='Revision label, e.g. R2')
    parser.add_argument('--review-status', choices=('needs-revision', 'unreviewed'), default='unreviewed')
    parser.add_argument('--diagnostic', action='store_true', help='Explicit committed browser overrides; always DIAGNOSTIC / Needs revision, never acceptance')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,79}', args.milestone):
        raise ValueError('Milestone must be a simple lowercase slug')
    baseline, candidate = validate_capture(args.candidate, args.capture_baseline, args.diagnostic)
    commit = subprocess.check_output(['git', 'rev-parse', args.reviewed_commit], cwd=scorer.ROOT, text=True).strip()
    if candidate.get('git') != commit or candidate.get('sourceCommit') != commit or candidate.get('worktreeStatus') != '':
        raise ValueError('Candidate needs matching reviewed HEAD/sourceCommit and a recorded clean worktree')
    files = candidate.get('sourceFiles', {})
    if not {'lib/view/map.js', 'main.js', 'package.json', 'assets/main.scene.gltf'}.issubset(files):
        raise ValueError('Missing required declared source hash paths')
    verify_hashes(commit, files)
    overrides = verify_overrides(candidate) if args.diagnostic else []
    transparency = verify_transparency(candidate) if args.diagnostic else None
    harness_sources = candidate.get('harnessSources', {})
    if args.diagnostic and not {'tools/capture-scene-targets.mjs', 'tools/v2/capture-browser.mjs', 'tools/v2/capture-gpu-timing.mjs', 'tools/v2/capture-pilot-overrides.mjs'}.issubset(harness_sources):
        raise ValueError('Missing diagnostic routing harness provenance')
    verify_hashes(commit, harness_sources)
    harness = subprocess.check_output(['git', 'show', f'{commit}:tools/capture-scene-targets.mjs'], cwd=scorer.ROOT)
    if hashlib.sha256(harness).hexdigest() != candidate.get('harnessSha256'):
        raise ValueError('Capture harness hash differs from reviewed commit')
    groups = {'original': scorer.BASE / 'before', 'target': scorer.BASE / 'targets-v2', 'candidate': args.candidate, 'linux': args.capture_baseline}
    views = [view['id'] for view in baseline['config']['views']]
    # Targets are references, not captures: verify their immutable repository bytes too.
    for name in views:
        target = groups['target'] / (name + '.png')
        recorded = subprocess.check_output(['git', 'show', f'{commit}:{target.relative_to(scorer.ROOT)}'], cwd=scorer.ROOT)
        if hashlib.sha256(recorded).hexdigest() != digest(target):
            raise ValueError(f'Selected V2 target changed: {name}')
    for source in groups.values():
        if args.out.resolve() == source.resolve() or source.resolve() in args.out.resolve().parents:
            raise ValueError('Gallery output must be separate from inputs')
    history_path = args.out / 'history.json'
    history = {'schema': 'v2-review-gallery-1', 'milestones': []}
    if args.out.exists() and any(args.out.iterdir()):
        if not history_path.is_file():
            raise ValueError('Nonempty output is not a managed milestone gallery')
        history = json.loads(history_path.read_text())
        if history.get('schema') != 'v2-review-gallery-1':
            raise ValueError('Unrecognized gallery history schema')
    snapshot = args.out / 'snapshots' / args.milestone
    if snapshot.exists() or any(item['id'] == args.milestone for item in history['milestones']):
        raise ValueError('Milestone already exists; snapshots cannot be overwritten')
    dates = [utc((args.candidate / (name + '.png')).stat().st_mtime) for name in views]
    if args.diagnostic:
        args.review_status = 'needs-revision'
    evidence = {'schema': 'v2-review-gallery-1', 'milestone': args.milestone, 'label': args.label, 'revision': args.revision,
                'review_status': args.review_status, 'status_label': 'DIAGNOSTIC / Needs revision' if args.diagnostic else 'Needs revision' if args.review_status == 'needs-revision' else 'Unreviewed',
                'reviewed_commit': None if args.diagnostic else commit, 'base_commit': commit, 'capture_mode': candidate['mode'], 'diagnostic_overrides': overrides, 'transparency_diagnostic': transparency, 'harness_sources': harness_sources, 'scene_approved': False, 'diagnostic': args.diagnostic, 'generated_at': utc(datetime.now().timestamp()),
                'pairing_source_review': pairing_source_review(overrides) if args.diagnostic else None,
                'capture_dates': {'first': min(dates), 'last': max(dates), 'basis': 'Source PNG file modification times; capture manifest does not record acquisition timestamps.'},
                'candidate_source': args.candidate.name, 'baseline_source': args.capture_baseline.name,
                'candidate_manifest_sha256': digest(args.candidate / 'capture.json'), 'baseline_manifest_sha256': digest(args.capture_baseline / 'capture.json'),
                'verified_source_files': files, 'harness_sha256': candidate['harnessSha256'], 'views': views, 'images': [], 'manifests': []}
    (snapshot / 'images').mkdir(parents=True)
    for group, directory in groups.items():
        manifest = directory / 'capture.json'
        if manifest.is_file():
            destination = snapshot / (group + '-capture.json')
            shutil.copyfile(manifest, destination)
            evidence['manifests'].append({'group': group, 'path': destination.name, 'sha256': digest(destination)})
        for name in views:
            source = directory / (name + '.png')
            destination = snapshot / 'images' / (group + '-' + name + '.png')
            shutil.copyfile(source, destination)
            evidence['images'].append({'view': name, 'group': group, 'path': destination.relative_to(snapshot).as_posix(),
                                       'source': directory.name + '/' + source.name, 'sha256': digest(destination)})
    history['milestones'].append({'id': args.milestone, 'label': args.label, 'revision': args.revision, 'review_status': args.review_status,
                                  'source_commit': None if args.diagnostic else commit, 'base_commit': commit, 'diagnostic': args.diagnostic, 'path': f'snapshots/{args.milestone}/index.html', 'generated_at': evidence['generated_at']})
    history['latest'] = args.milestone
    (snapshot / 'gallery.json').write_text(json.dumps(evidence, indent=2) + '\n')
    (snapshot / 'index.html').write_text(page(evidence, history, archive=True))
    (snapshot / 'public-copy.json').write_bytes(COPY.read_bytes())
    # Existing snapshot bytes are immutable; only the latest page/history are replaced.
    history_path.write_text(json.dumps(history, indent=2) + '\n')
    (args.out / 'index.html').write_text(page(evidence, history, prefix=f'snapshots/{args.milestone}/'))
    (args.out / 'public-copy.json').write_bytes(COPY.read_bytes())
    print(args.out / 'index.html')


if __name__ == '__main__':
    main()
