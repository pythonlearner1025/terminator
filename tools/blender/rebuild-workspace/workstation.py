"""Reference workstation, never a firearm builder. Safe to load with importlib.
CLI: blender -b -t 2 --python workstation.py -- --setup --output /new/output.blend --proof
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
from urllib.parse import unquote

import bpy
import bmesh
from mathutils import Matrix, Vector, Quaternion
from bpy_extras.object_utils import world_to_camera_view

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def relative(path):
    try:
        return str(Path(path).resolve().relative_to(REPO))
    except ValueError:
        return str(Path(path).resolve())


def matrix(m):
    return [list(row) for row in m]


def config():
    saved = bpy.context.scene.get('workspace_config')
    return json.loads(saved) if saved else read_json(HERE / 'config.json')


def points(objects):
    return [o.matrix_world @ v.co for o in objects if o.type == 'MESH' for v in o.data.vertices]


def bounds(objects):
    p = points(objects)
    if not p:
        raise ValueError('No mesh vertices')
    return [[min(v[i] for v in p) for i in range(3)],
            [max(v[i] for v in p) for i in range(3)]]


def mesh_digest(objects):
    # Topology and local coordinates, before/after alignment (no source mesh edits).
    data = [(o.name, [list(v.co) for v in o.data.vertices],
             [list(f.vertices) for f in o.data.polygons])
            for o in sorted(objects, key=lambda o: o.name) if o.type == 'MESH']
    return hashlib.sha256(json.dumps(data).encode()).hexdigest()


def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def object_in(name, data, coll):
    o = bpy.data.objects.new(name, data)
    coll.objects.link(o)
    return o


def camera_record(cam=None):
    cam = cam or bpy.context.scene.camera
    s = bpy.context.scene
    return {'name': cam.name, 'matrix_world': matrix(cam.matrix_world),
            'scale': list(cam.scale), 'projection': cam.data.type,
            'ortho_scale': cam.data.ortho_scale, 'lens_mm': cam.data.lens,
            'fov_radians': cam.data.angle, 'sensor_width': cam.data.sensor_width,
            'sensor_height': cam.data.sensor_height, 'sensor_fit': cam.data.sensor_fit,
            'shift': [cam.data.shift_x, cam.data.shift_y],
            'clip': [cam.data.clip_start, cam.data.clip_end],
            'resolution': [s.render.resolution_x, s.render.resolution_y],
            'resolution_percentage': s.render.resolution_percentage,
            'pixel_aspect': [s.render.pixel_aspect_x, s.render.pixel_aspect_y],
            'use_border': s.render.use_border,
            'parameters': json.loads(cam.get('parameters', '{}'))}


def set_view(name='threequarter_left', *, azimuth=None, elevation=None, roll=None,
             projection=None, fov=None, ortho_scale=None, target=None, distance=None):
    """Degrees, Blender world Z up; azimuth 0 = +X (rear), 180 = -X (front).
    Scale/distance are explicit scene units, never fitted to active geometry.
    """
    c = config()
    p = dict(c['camera'])
    p.update(c['presets'].get(name, {}))
    for k, v in locals().copy().items():
        if k in p or k in ('azimuth', 'elevation'):
            if v is not None:
                p[k] = v
    a, e = math.radians(p.get('azimuth', -90)), math.radians(p.get('elevation', 0))
    t = Vector(p['target'])
    direction = Vector((math.cos(e)*math.cos(a), math.cos(e)*math.sin(a), math.sin(e)))
    cam = bpy.data.objects.get('Camera.' + name)
    if cam is None:
        cam = object_in('Camera.' + name, bpy.data.cameras.new('Camera.' + name), bpy.data.collections['Cameras'])
    cam.location = t + direction * p['distance']
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (-direction).to_track_quat('-Z', 'Y') @ Quaternion((0, 0, 1), math.radians(p['roll']))
    cam.scale = (1, 1, 1)
    cam.data.type = p['projection'].upper()
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.angle = math.radians(p['fov'])
    cam.data.ortho_scale = p['ortho_scale']
    cam.data.clip_start, cam.data.clip_end = 0.001, 100
    cam['parameters'] = json.dumps(p)
    bpy.context.scene.camera = cam
    bpy.context.view_layer.update()
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D' and area.spaces.active.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.region_3d.view_camera_zoom = 0
                area.spaces.active.region_3d.view_location = t
                area.spaces.active.region_3d.view_distance = p['distance']
    return camera_record(cam)


def shading(mode='clay'):
    if mode not in ('clay', 'material', 'silhouette'):
        raise ValueError('mode must be clay, material or silhouette')
    c = config()['render']
    spaces = [bpy.context.scene.display.shading]
    spaces += [a.spaces.active.shading for s in bpy.data.screens for a in s.areas if a.type == 'VIEW_3D' and a.spaces.active.type == 'VIEW_3D']
    for sh in spaces:
        sh.type = 'SOLID'
        sh.light = 'FLAT' if mode == 'silhouette' else 'STUDIO'
        sh.studio_light = c['studio_light']
        sh.color_type = 'MATERIAL' if mode == 'material' else 'SINGLE'
        sh.single_color = (0.02, 0.02, 0.02) if mode == 'silhouette' else (0.58, 0.62, 0.67)
        sh.background_type = 'WORLD'
        sh.show_shadows = False
        sh.show_cavity = False
        sh.show_specular_highlight = mode != 'silhouette'
    bpy.context.scene.world.color = c['background']
    bpy.context.scene['capture_mode'] = mode


def capture_pair(directory, view='left', mode='clay', **camera_options):
    """Two PNGs with one camera; Reference vs Rebuild. Practice always excluded.
    Empty Rebuild deliberately produces a blank image. No geometry autofit.
    """
    out = Path(directory).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    record = set_view(view, **camera_options)
    shading(mode)
    s = bpy.context.scene
    cols = {n: bpy.data.collections[n] for n in ('Reference', 'Rebuild', 'Practice')}
    old = {n: (c.hide_render, c.hide_viewport) for n, c in cols.items()}
    previous_path = s.render.filepath
    results = {}
    try:
        for subject in ('Reference', 'Rebuild'):
            for n, c in cols.items():
                c.hide_render = c.hide_viewport = n != subject
            bpy.context.view_layer.update()
            assert camera_record() == record, 'Camera drift during collection toggle'
            path = out / f'{view}-{mode}-{subject.lower()}.png'
            s.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            results[subject] = {'file': path.name, 'sha256': digest(path)}
    finally:
        for n, c in cols.items():
            c.hide_render, c.hide_viewport = old[n]
        s.render.filepath = previous_path
    result = {'camera': record, 'mode': mode, 'render': config()['render'],
              'engine': s.render.engine, 'files': results,
              'rebuild_mesh_count': sum(o.type == 'MESH' for o in cols['Rebuild'].all_objects)}
    write_json(out / f'{view}-{mode}-camera.json', result)
    return result


def setup(output, reference=None, reference_path=None, conversion_path=None, config_path=None):
    """Create a NEW workspace. Refuses existing output and a populated GUI scene."""
    out = Path(output).expanduser().resolve()
    if out.suffix != '.blend' or out.exists():
        raise ValueError('Provide a new explicit .blend output path')
    if not bpy.app.background and (bpy.data.filepath or any(o.name not in ('Cube', 'Camera', 'Light') for o in bpy.data.objects)):
        raise RuntimeError('Setup requires a fresh unsaved Blender window; open existing workspaces directly')
    c = read_json(config_path or HERE / 'config.json')
    name = reference or c['default_reference']
    entry = c['references'].get(name, {})
    src = Path(reference_path) if reference_path else REPO / entry['path']
    if not src.is_absolute():
        src = REPO / src
    src = src.resolve()
    if src.suffix.lower() not in ('.gltf', '.glb') or not src.is_file():
        raise FileNotFoundError(f'glTF reference missing: {src}; use --reference-path')
    meta_path = Path(conversion_path) if conversion_path else (src.parent / 'conversion.json')
    if not meta_path.is_absolute():
        meta_path = REPO / meta_path
    meta = read_json(meta_path) if meta_path.exists() else {}
    files = [src]
    if src.suffix == '.gltf':
        doc = read_json(src)
        for item in doc.get('buffers', []) + doc.get('images', []):
            uri = item.get('uri', '')
            if uri and not uri.startswith('data:'):
                files.append(src.parent / unquote(uri))
    if meta_path.exists():
        files.append(meta_path)
    hashes = {relative(p): digest(p) for p in files}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s['workspace_config'] = json.dumps(c)
    s.render.engine = 'BLENDER_WORKBENCH'
    s.render.threads_mode = 'FIXED'
    s.render.threads = 2
    s.render.resolution_x, s.render.resolution_y = c['render']['resolution']
    s.render.resolution_percentage = 100
    s.render.image_settings.file_format = 'PNG'
    s.render.film_transparent = False
    s.render.use_border = False
    s.world = bpy.data.worlds.new('Workspace World')
    s.view_settings.view_transform = 'Standard'
    s.view_settings.look = 'None'
    s.view_settings.exposure = 0
    s.view_settings.gamma = 1
    ref, rebuild, practice = collection('Reference'), collection('Rebuild'), collection('Practice')
    source = collection('SOURCE', ref)
    collection('Cameras')
    bpy.ops.import_scene.gltf(filepath=str(src))
    imported = list(bpy.context.scene.objects)
    for o in imported:
        for old in list(o.users_collection):
            old.objects.unlink(o)
        source.objects.link(o)
    bpy.context.view_layer.update()
    original = bounds(imported)
    topology = mesh_digest(imported)
    center = (Vector(original[0]) + Vector(original[1])) / 2
    length = meta.get('lengthMetres')
    extent = original[1][0] - original[0][0]
    scale = float(length) / extent if length else 1.0
    if extent <= 0 or scale <= 0:
        raise ValueError('Reference must have nonzero X length')
    datum = object_in('SOURCE alignment (bbox center)', None, source)
    for o in imported:
        if o.parent is None:
            o.parent = datum
    datum.matrix_world = Matrix.Diagonal((scale, scale, scale, 1)) @ Matrix.Translation(-center)
    for o in source.all_objects:
        o.hide_select = True
        o['workspace_role'] = 'reference-only'
    ref.hide_select = source.hide_select = True
    practice.hide_render = practice.hide_viewport = True
    bpy.context.view_layer.update()
    aligned = bounds(imported)
    assert topology == mesh_digest(imported)
    assert max(abs(aligned[0][i]+aligned[1][i]) for i in range(3)) < 1e-6
    if length:
        assert abs(aligned[1][0]-aligned[0][0]-length) < 1e-6
    candidates = read_json(REPO / 'tools/blender/external/candidates.json')
    candidate = next((x for x in candidates if x['id'] == name and x['weapon'] == 'revolver'), None)
    evidence = {'reference': name, 'path': relative(src), 'conversion': meta,
                'candidate': candidate, 'source_hashes': hashes,
                'raw_bounds': original, 'aligned_bounds': aligned,
                'alignment_matrix': matrix(datum.matrix_world), 'uniform_scale': scale,
                'datum': 'imported geometry bounding-box center',
                'length_basis': 'declared scaled reference; NOT a physical specification' if length else 'native imported units; no declared length',
                'mesh_sha256': topology, 'mesh_count': sum(o.type == 'MESH' for o in imported)}
    s['reference_manifest'] = json.dumps(evidence)
    for preset in c['presets']:
        set_view(preset)
    set_view()
    shading()
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = None
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children['Rebuild']
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D' and area.spaces.active.type == 'VIEW_3D':
                area.spaces.active.shading.type = 'SOLID'
                area.spaces.active.overlay.show_floor = False
    for image in bpy.data.images:
        if image.source == 'FILE' and not image.packed_file:
            image.pack()
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    return evidence


def practice_coupon():
    """Generic modeling exercise only. Separate scene units; no firearm parts."""
    coll = bpy.data.collections['Practice']
    if coll.all_objects:
        raise ValueError('Practice already exists')
    coll.hide_viewport = False
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=0.08)
    bm.normal_update()
    top = max(bm.faces, key=lambda f: f.calc_center_median().z)
    cap = bmesh.ops.inset_region(bm, faces=[top], thickness=0.009, depth=0)['faces']
    # Extrude the inset central face, not the surrounding returned rim.
    bm.normal_update()
    face = max((f for f in bm.faces if f.normal.z > 0.9), key=lambda f: f.calc_area())
    extruded = bmesh.ops.extrude_face_region(bm, geom=[face])
    verts = [v for v in extruded['geom'] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=verts, vec=Vector((0, 0, 0.02)))
    bmesh.ops.delete(bm, geom=[face], context='FACES_ONLY')
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.002, segments=2, affect='EDGES')
    mesh = bpy.data.meshes.new('Generic inset extrude bevel coupon')
    bm.to_mesh(mesh)
    bm.free()
    base = object_in('Practice.Coupon', mesh, coll)
    base['workspace_role'] = 'practice-only'
    bm = bmesh.new()
    circle = bmesh.ops.create_circle(bm, cap_ends=True, radius=0.018, segments=24)
    ex = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
    bmesh.ops.translate(bm, verts=[v for v in ex['geom'] if isinstance(v, bmesh.types.BMVert)], vec=Vector((0, 0, 0.012)))
    # Circle/extrusion exercise plus independent cylinder primitive.
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.009, radius2=0.009, depth=0.02, matrix=Matrix.Translation((0.04, 0, 0)))
    bm.normal_update()
    m = bpy.data.meshes.new('Generic circle and cylinder child')
    bm.to_mesh(m)
    bm.free()
    child = object_in('Practice.HingedChild', m, coll)
    child.parent = base
    child.location = (0.05, 0, 0)
    child['workspace_role'] = 'practice-only'
    child['pivot_note'] = 'Local mesh circle center at child origin; Z hinge axis'
    bpy.context.view_layer.update()
    base_before = matrix(base.matrix_world)
    v_before = child.matrix_world @ child.data.vertices[0].co
    pivot_before = child.matrix_world.translation.copy()
    child.rotation_euler.z = 0
    child.keyframe_insert('rotation_euler', frame=1)
    child.rotation_euler.z = math.radians(65)
    child.keyframe_insert('rotation_euler', frame=20)
    bpy.context.scene.frame_set(20)
    bpy.context.view_layer.update()
    assert matrix(base.matrix_world) == base_before
    assert (child.matrix_world.translation-pivot_before).length < 1e-7
    assert (child.matrix_world @ child.data.vertices[0].co-v_before).length > 0.001
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    assert (child.matrix_world @ child.data.vertices[0].co-v_before).length < 1e-7
    coll.hide_viewport = True
    return {'operators': ['create_cube', 'inset_region', 'extrude_face_region', 'translate', 'bevel', 'create_circle', 'create_cone'],
            'hinge_child_only': True, 'hinge_pivot_fixed': True, 'keyframes': [1, 20], 'reverted_frame': 1}


def export_practice(path):
    """Only selected Practice objects; no general/game/Rebuild exporter provided."""
    coll = bpy.data.collections['Practice']
    old = coll.hide_viewport
    coll.hide_viewport = False
    bpy.ops.object.select_all(action='DESELECT')
    try:
        for o in coll.all_objects:
            assert o.get('workspace_role') == 'practice-only'
            assert len(o.users_collection) == 1 and o.users_collection[0] == coll
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(Path(path).resolve()), export_format='GLB', use_selection=True, export_animations=False, export_extras=True)
    finally:
        bpy.ops.object.select_all(action='DESELECT')
        coll.hide_viewport = old


def run_proof(output):
    out = Path(output).resolve()
    root = out.parent
    report = {'blender': bpy.app.version_string, 'checks': {}, 'captures': {}}
    report['practice'] = practice_coupon()
    check = report['checks']
    before = bounds(bpy.data.collections['Practice'].all_objects)
    glb = root / 'practice-only.glb'
    export_practice(glb)
    old_objects = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    new_objects = set(bpy.data.objects)-old_objects
    after = bounds(new_objects)
    assert all(o.get('workspace_role') == 'practice-only' for o in new_objects)
    assert sum(o.type == 'MESH' for o in new_objects) == 2
    error = max(abs(before[i][j]-after[i][j]) for i in range(2) for j in range(3))
    assert error < 1e-6
    check['practice_roundtrip_bounds_max_error'] = error
    check['practice_roundtrip_only_two_practice_meshes'] = True
    # Compare projected coordinates of roundtripped coupon bbox with identical camera.
    projected_error = max((world_to_camera_view(bpy.context.scene, bpy.context.scene.camera, Vector(before[i]))-world_to_camera_view(bpy.context.scene, bpy.context.scene.camera, Vector(after[i]))).length for i in range(2))
    assert projected_error < 1e-6
    check['practice_roundtrip_projection_max_error'] = projected_error
    for o in new_objects:
        bpy.data.objects.remove(o, do_unlink=True)
    for view in ('left', 'threequarter_left', 'rear'):
        report['captures'][view] = capture_pair(root / 'renders', view)
        camera = bpy.context.scene.camera
        corners = [world_to_camera_view(bpy.context.scene, camera, p) for p in points(bpy.data.collections['SOURCE'].all_objects)]
        assert all(0 < p.x < 1 and 0 < p.y < 1 and p.z > 0 for p in corners)
    first = report['captures']['left']
    repeated = capture_pair(root / 'repeat', 'left')
    assert repeated['camera'] == first['camera']
    a = bpy.data.images.load(str(root/'renders'/first['files']['Reference']['file']), check_existing=False)
    b = bpy.data.images.load(str(root/'repeat'/repeated['files']['Reference']['file']), check_existing=False)
    changed = sum(x != y for x, y in zip(a.pixels[:], b.pixels[:]))
    assert changed == 0 and a.size[:] == b.size[:]
    check['repeat_camera_exact'] = True
    check['repeat_pixel_channels_changed_same_environment'] = changed
    bpy.data.images.remove(a)
    bpy.data.images.remove(b)
    check['reference_inside_all_three_capture_frames'] = True
    set_view()
    bpy.context.scene.render.filepath = '//renders/'
    s = bpy.context.scene
    cams = {o.name: camera_record(o) for o in bpy.data.collections['Cameras'].objects}
    reference = json.loads(s['reference_manifest'])
    write_json(root / 'cameras.json', cams)
    write_json(root / 'reference.json', reference)
    bpy.ops.wm.save_as_mainfile(filepath=str(out))
    bpy.ops.wm.open_mainfile(filepath=str(out))
    assert cams == {o.name: camera_record(o) for o in bpy.data.collections['Cameras'].objects}
    check['save_reopen_all_camera_invariants'] = True
    assert len(bpy.data.collections['Rebuild'].all_objects) == 0
    check['rebuild_empty'] = True
    assert mesh_digest(bpy.data.collections['SOURCE'].all_objects) == reference['mesh_sha256']
    check['imported_mesh_topology_unchanged'] = True
    for p, h in reference['source_hashes'].items():
        assert digest(REPO / p) == h
    check['source_files_hash_unchanged'] = True
    assert all(o.hide_select for o in bpy.data.collections['SOURCE'].all_objects)
    check['source_selection_locked'] = True
    images = [i for i in bpy.data.images if i.source == 'FILE']
    assert all(i.packed_file for i in images)
    check['all_reference_images_packed'] = len(images)
    assert bpy.data.collections['Practice'].hide_render and bpy.data.collections['Practice'].hide_viewport
    check['practice_hidden_after_reopen'] = True
    report['reference'] = reference
    report['artifacts'] = {'blend': out.name, 'practice': glb.name, 'cameras': 'cameras.json', 'renders': 'renders/', 'repeat': 'repeat/'}
    write_json(root / 'manifest.json', report)
    print('WORKSPACE_PROOF_PASS ' + str(root / 'manifest.json'))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--setup', action='store_true', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--reference')
    parser.add_argument('--reference-path')
    parser.add_argument('--conversion-path')
    parser.add_argument('--config')
    parser.add_argument('--proof', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    setup(args.output, args.reference, args.reference_path, args.conversion_path, args.config)
    if args.proof:
        run_proof(args.output)


if __name__ == '__main__':
    main()
