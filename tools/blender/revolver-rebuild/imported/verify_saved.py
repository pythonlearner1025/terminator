"""Fresh-process validation of neutral/test-grip files, including full skin equation."""
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inspect_rig import evaluated_vertices, inventory, meshes, structural_signature

output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
label = Path(bpy.data.filepath).stem
assert label in ('neutral', 'test-grip'), label
report = json.loads((output / 'rig-report.json').read_text())
actual = inventory()
assert structural_signature(actual) == report['structural_signature'], 'Geometry/UV/skin/constraint drift'
expected_images = {im['name']: im['packed_sha256'] for im in report['inventory']['images']}
assert len(expected_images) == 4
assert {im['name']: im['packed_sha256'] for im in actual['images']} == expected_images
assert all(im['packed'] and im['size'] == [2048, 2048] for im in actual['images'])
assert 'HAND RIG INSPECTION' in bpy.data.texts
assert not bpy.data.actions, 'Unexpected animation added'
current = evaluated_vertices()
with np.load(output / f'{label}-vertices.npz') as expected:
    assert set(expected.files) == set(current)
    reopen_error = max(float(np.abs(current[name] - expected[name]).max()) for name in current)
assert reopen_error < 2e-6, ('Saved pose drift', reopen_error)
scene = bpy.context.scene
assert scene.camera.name == 'Asset camera'
assert np.allclose(np.array(scene.camera.matrix_world), report['fixed_cameras']['Asset camera']['matrix_world'], atol=1e-7)

# Independently calculate the source inverse-bind equation for every weighted
# vertex, not just the importer's 16 samples. This tests Blender constraints and
# evaluated skinning against retained source matrices after each file reopens.
max_skin_error = 0.0
samples = 0
for ob in meshes():
    rig = next(m.object for m in ob.modifiers if m.type == 'ARMATURE')
    relative = rig.parent.matrix_world.inverted_safe() @ ob.matrix_world
    palette = {}
    for group in ob.vertex_groups:
        pb = rig.pose.bones[group.name]
        flat = pb.bone['source_inv_bind']
        inv_bind = Matrix([flat[i:i + 4] for i in range(0, 16, 4)]).transposed()
        palette[group.index] = pb.constraints[0].target.matrix_world @ inv_bind @ relative
    for vertex in ob.data.vertices:
        total = sum(g.weight for g in vertex.groups)
        assert total > 1e-8
        predicted = Vector((0, 0, 0))
        for group in vertex.groups:
            predicted += (palette[group.group] @ vertex.co) * (group.weight / total)
        error = float(np.linalg.norm(np.array(predicted) - current[ob.name][vertex.index]))
        max_skin_error = max(max_skin_error, error)
        samples += 1
assert max_skin_error < 1e-5, ('Source skin equation mismatch', max_skin_error)
result = {'status': 'passed', 'file': bpy.data.filepath, 'vertices_checked': samples,
          'max_source_skin_error_m': max_skin_error, 'max_reopen_coordinate_error_m': reopen_error,
          'structural_signature': structural_signature(actual), 'packed_images': len(actual['images']),
          'source_constraints_retained': sum(len(b['constraints']) for r in actual['armatures'] for b in r['bones']),
          'fixed_full_camera_verified': True}
(output / f'{label}-reopen.json').write_text(json.dumps(result, indent=2))
print('SAVED_RIG_VERIFIED', json.dumps(result), flush=True)
