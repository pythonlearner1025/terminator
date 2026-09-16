"""Require fresh reopen evidence and useful fixed-camera renders before passing."""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

output = Path(sys.argv[1]).resolve()
path = output / 'rig-report.json'
report = json.loads(path.read_text())
assert report['status'] == 'pending_independent_reopen'
reopens = {}
for label in ('neutral', 'test-grip'):
    result = json.loads((output / f'{label}-reopen.json').read_text())
    assert result['status'] == 'passed' and result['vertices_checked'] == 4246
    assert result['structural_signature'] == report['structural_signature']
    assert (output / f'{label}-reopen.exitcode').read_text().strip() == '0'
    assert (output / f'{label}-reopen.json').stat().st_mtime > (output / f'{label}.blend').stat().st_mtime
    reopens[label] = result
render_checks = {}
for suffix in ('', '-detail'):
    frames = []
    for label in ('neutral', 'test-grip'):
        filename = f'{label}{suffix}.png'
        with Image.open(output / filename) as image:
            assert image.size == (640, 360)
            rgb = np.array(image.convert('RGB'), dtype=float)
        assert rgb.std() > 8, (filename, 'Empty or flat render')
        render_checks[filename] = {'width': 640, 'height': 360, 'rgb_stddev': float(rgb.std())}
        frames.append(rgb)
    changed = int((np.abs(frames[0] - frames[1]).max(axis=2) > 12).sum())
    assert changed > 500, 'Neutral and grip do not visibly differ'
    render_checks['changed_pixels' + suffix] = changed
report['independent_reopens'] = reopens
report['render_checks'] = render_checks
artifacts = ['source/model.blend', 'source/status.json', 'source/reopen-validation.json', 'neutral.blend', 'test-grip.blend', 'neutral.png', 'test-grip.png', 'neutral-detail.png', 'test-grip-detail.png']
report['artifacts'] = {name: {'path': str(output / name), 'bytes': (output / name).stat().st_size,
                             'sha256': hashlib.sha256((output / name).read_bytes()).hexdigest()} for name in artifacts}
report['limitations'] = [
    'Recovered public viewer representation; original authoring rig, IK and authored constraints are unavailable.',
    'Pose retained source transform objects; WORLD COPY_TRANSFORMS overrides direct pose-bone edits.',
    'Ten fourth finger joints are unweighted endpoints. Chest is also unweighted; 38 bones carry weights.',
    'Four 2048x2048 maps retained and packed in inspection blends; AO is reference-only, not connected in recovered shader.',
    'Importer presentation root normalizes the asset maximum dimension to 2m; game-unit scale remains to be established.',
    'Static grip is a deformation test, not fitted to any weapon; no collision/contact or runtime animation validation.',
    'No source animation clips are present.',
]
report['status'] = 'passed'
report['rig_usable'] = True
path.write_text(json.dumps(report, indent=2))
print(json.dumps({'status': report['status'], 'rig_usable': True, 'isolated_joint_tests': len(report['isolated_deformation_tests']), 'independent_reopens': 2, 'report': str(path)}, indent=2))
