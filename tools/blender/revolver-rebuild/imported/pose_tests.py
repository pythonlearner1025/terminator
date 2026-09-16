"""Inspect recovered controls, test every deforming finger joint, save two poses.

No mesh/UV/weight edits, keyframes, constraint deletion or animation retargeting.
All offsets are post-multiplied onto the original source control local matrix.
"""
import json
import math
import re
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inspect_rig import evaluated_vertices, inventory, meshes, structural_signature

output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
output.mkdir(parents=True, exist_ok=True)
source = output / 'source'
report_path = output / 'rig-report.json'
report = {'status': 'running', 'source': json.loads((source / 'attribution.json').read_text())}
report_path.write_text(json.dumps(report, indent=2))
status = json.loads((source / 'status.json').read_text())
assert status['status'] == 'passed'
assert (output / 'import-cli.exitcode').read_text().strip() == '0'
assert status['reopened']['reopened']
report['importer'] = {'status': 'passed', 'cli_exit_code': 0, 'sha256': status['importer_sha256'], 'independent_reopen': status['reopened']}
before = inventory()
assert len(before['armatures']) == 1
assert len(before['armatures'][0]['bones']) == 49
assert sum(m['triangles'] for m in before['meshes']) == 7240
assert all(m['weighted_vertices'] == m['vertices'] and m['uv_finite'] for m in before['meshes'])
assert all(im['packed'] for im in before['images'])
signature = structural_signature(before)
rig = bpy.data.objects[before['armatures'][0]['name']]
controls = {}
for pb in rig.pose.bones:
    assert len(pb.constraints) == 1
    constraint = pb.constraints[0]
    assert constraint.type == 'COPY_TRANSFORMS' and constraint.target
    assert constraint.influence == 1 and not constraint.mute
    assert constraint.owner_space == constraint.target_space == 'WORLD'
    controls[pb.name] = constraint.target
rest = {name: control.matrix_basis.copy() for name, control in controls.items()}


def reset():
    for name, control in controls.items():
        control.matrix_basis = rest[name].copy()
    bpy.context.view_layer.update()


def rotate(name, degrees, axis='X'):
    controls[name].matrix_basis = rest[name] @ Matrix.Rotation(math.radians(degrees), 4, axis)


def delta_summary(reference, current):
    values = np.concatenate([np.linalg.norm(current[name] - vertices, axis=1) for name, vertices in reference.items()])
    return {'moved_vertices': int((values > 1e-6).sum()), 'max_displacement_m': float(values.max()), 'rms_displacement_m': float(np.sqrt(np.mean(values * values)))}


baseline = evaluated_vertices()
# Preserve the extra AO resource too; the importer approximates materials and
# wires color/roughness/normal only. Do not change the recovered shader here.
texture_manifest = json.loads((source / 'texture-files.json').read_text())
for texture in texture_manifest.values():
    existing = [im for im in bpy.data.images if im.name == texture['name'] or im.name.startswith(texture['name'] + ' [')]
    if not existing:
        im = bpy.data.images.load(texture['path'], check_existing=True)
        im.name = texture['name']
        im.use_fake_user = True
        im.pack()

mapping = {}
for side in ('L', 'R'):
    mapping[side] = {}
    for label, stem in [('thumb', 'thumb'), ('index', 'point'), ('middle', 'middle'), ('ring', 'ring'), ('little', 'pink')]:
        names = sorted((name for name in controls if re.match(rf'^{side}_{stem}[1-4]_', name)), key=lambda n: int(n.split('_')[1][-1]))
        assert len(names) == 4, (side, label, names)
        assert all(names[3] not in mesh['groups'] for mesh in before['meshes']), 'Expected unweighted fingertip endpoint'
        mapping[side][label] = {'joints': names[:3], 'terminal_unweighted': names[3], 'controls': [controls[n].name for n in names]}
    for label, stem in [('wrist', 'wrist'), ('forearm', 'elbow'), ('upper_arm', 'arm'), ('palm', 'palm')]:
        name, = [name for name in controls if name.startswith(f'{side}_{stem}_')]
        mapping[side][label] = {'joint': name, 'control': controls[name].name}
report['control_mapping'] = mapping
tests = []
for side in ('L', 'R'):
    joint_list = [n for label in ('thumb', 'index', 'middle', 'ring', 'little') for n in mapping[side][label]['joints']]
    joint_list += [mapping[side][label]['joint'] for label in ('wrist', 'forearm', 'palm', 'upper_arm')]
    other = 'R' if side == 'L' else 'L'
    for name in joint_list:
        reset()
        rotate(name, -20)
        current = evaluated_vertices()
        stats = delta_summary(baseline, current)
        assert stats['moved_vertices'] > 20 and stats['max_displacement_m'] > 1e-4, (name, stats)
        # Check all vertices exclusively weighted to the opposite arm, not a
        # position heuristic: no accidental global transform can pass this.
        opposite_max = 0.0
        own_weighted_moved = 0
        for ob in meshes():
            lengths = np.linalg.norm(current[ob.name] - baseline[ob.name], axis=1)
            for v in ob.data.vertices:
                names = [ob.vertex_groups[g.group].name for g in v.groups if g.weight > 1e-8]
                if names and all(n.startswith(other + '_') for n in names):
                    opposite_max = max(opposite_max, float(lengths[v.index]))
                if name in names and lengths[v.index] > 1e-6:
                    own_weighted_moved += 1
        assert opposite_max < 1e-6, (name, opposite_max)
        assert own_weighted_moved > 0, name
        tests.append({'bone': name, 'control': controls[name].name, 'local_axis': 'X', 'degrees': -20,
                      'own_weighted_vertices_moved': own_weighted_moved, 'opposite_arm_max_displacement_m': opposite_max,
                      **stats, 'status': 'passed'})
reset()
reset_error = delta_summary(baseline, evaluated_vertices())['max_displacement_m']
assert reset_error < 1e-6
report['isolated_deformation_tests'] = tests
report['reset_max_error_m'] = reset_error
report['structural_signature'] = signature
report['inventory'] = inventory()
assert structural_signature(report['inventory']) == signature

# Fixed imported camera for both full-arm frames. Additional fixed close camera
# includes both hands for easier finger inspection, with source controls retained.
scene = bpy.context.scene
full_camera = scene.camera
detail_camera = full_camera.copy()
detail_camera.data = full_camera.data.copy()
detail_camera.name = 'Hands inspection camera'
scene.collection.objects.link(detail_camera)
hand_points = [Vector(b['control_world_position']) for b in before['armatures'][0]['bones'] if re.match(r'^[LR]_(wrist|thumb|point|middle|ring|pink)', b['name'])]
center = sum(hand_points, Vector()) / len(hand_points)
detail_camera.location = center + full_camera.rotation_euler.to_quaternion() @ Vector((0, 0, 2.8))
detail_camera.rotation_euler = full_camera.rotation_euler.copy()
detail_camera.data.type = 'ORTHO'
detail_camera.data.sensor_fit = 'HORIZONTAL'
detail_camera.data.ortho_scale = 1.35
bpy.context.view_layer.update()
report['fixed_cameras'] = {camera.name: {'matrix_world': [list(row) for row in camera.matrix_world], 'type': camera.data.type, 'ortho_scale': camera.data.ortho_scale} for camera in (full_camera, detail_camera)}
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
scene.render.resolution_x = 640
scene.render.resolution_y = 360
scene.render.resolution_percentage = 100
scene.render.film_transparent = False

# Make the retained transform controls convenient to select in Blender. These
# display settings do not change their matrices or the skinning constraints.
for control in controls.values():
    control.show_in_front = True
    scale = max(abs(x) for x in control.matrix_world.to_scale())
    control.empty_display_type = 'PLAIN_AXES'
    control.empty_display_size = 0.012 / max(scale, 1e-8)
    control['inspection_hint'] = 'Pose this source control in Object Mode. Native armature follows via WORLD COPY_TRANSFORMS. See HAND RIG INSPECTION text.'
rig.show_in_front = True
rig.data.display_type = 'STICK'
readme = bpy.data.texts.new('HAND RIG INSPECTION')
readme.write('DJMaesen — First Person arms — CC BY 4.0\n' + report['source']['source'] + '\n\n'
             'Recovered viewer skinning, not the original authoring/IK rig.\n'
             'Use Object Mode to rotate retained source empties with matching bone names.\n'
             'Leave WORLD COPY_TRANSFORMS constraints intact. Direct pose-bone rotations are overridden.\n'
             'Local negative X curls the finger joints in this inspection. Finger joint 4 is an unweighted endpoint.\n'
             'point=index; pink=little; elbow=forearm. Ring/little descend through palm.\n'
             'All original geometry, weights and UVs are unchanged. AO is packed for reference but not connected.\n'
             'Scene normalized by importer to 2m maximum extent; establish final game scale later.\n'
             'Grip is a static deformation demonstration, not fitted to a gun. No animation added.\n\n' + json.dumps(mapping, indent=2))
bpy.ops.object.select_all(action='DESELECT')
active = controls[mapping['R']['index']['joints'][0]]
active.select_set(True)
bpy.context.view_layer.objects.active = active
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.shading.type = 'SOLID'
            area.spaces.active.shading.color_type = 'MATERIAL'
            area.spaces.active.overlay.show_overlays = True


def save_pose(label):
    current = evaluated_vertices()
    np.savez_compressed(output / f'{label}-vertices.npz', **current)
    scene.camera = full_camera
    scene.render.filepath = str(output / f'{label}.png')
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / f'{label}.blend'), compress=True)
    bpy.ops.render.render(write_still=True)
    scene.camera = detail_camera
    scene.render.filepath = str(output / f'{label}-detail.png')
    bpy.ops.render.render(write_still=True)
    scene.camera = full_camera
    return delta_summary(baseline, current)


report['neutral'] = save_pose('neutral')
grip = []
for side in ('L', 'R'):
    for label in ('thumb', 'index', 'middle', 'ring', 'little'):
        angles = [-10, -25, -25] if label == 'thumb' else [-35, -45, -30]
        for name, degrees in zip(mapping[side][label]['joints'], angles):
            rotate(name, degrees)
            grip.append({'control': controls[name].name, 'bone': name, 'local_axis': 'X', 'degrees': degrees})
    wrist = mapping[side]['wrist']['joint']
    rotate(wrist, -8)
    grip.append({'control': controls[wrist].name, 'bone': wrist, 'local_axis': 'X', 'degrees': -8})
report['grip_offsets'] = grip
report['grip'] = save_pose('test-grip')
assert structural_signature(inventory()) == signature
report['status'] = 'pending_independent_reopen'
report_path.write_text(json.dumps(report, indent=2))
print('POSE_TESTS_PASSED', len(tests), json.dumps(report['grip']), flush=True)
