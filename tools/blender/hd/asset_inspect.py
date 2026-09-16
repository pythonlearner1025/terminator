"""Inspect untouched input topology and render reproducible baseline views headlessly."""
import bpy, bmesh, json, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.kite3d/hd/round-0'
OUT.mkdir(parents=True, exist_ok=True)
SPECS = [('shotgun', '3dmodels-cc0'), ('revolver', 'loafbrr-cc0')]

def bounds(objects):
    pts = [o.matrix_world @ v.co for o in objects for v in o.data.vertices]
    return [min(v[i] for v in pts) for i in range(3)], [max(v[i] for v in pts) for i in range(3)]

def studio(meshes):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'OPTIX'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = 32
    scene.cycles.seed = 1234
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'AgX'
    lo, hi = map(Vector, bounds(meshes))
    center = (lo + hi) / 2
    length = max(hi - lo)
    world = bpy.data.worlds.new('Studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.35, .39, .45, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .6
    scene.world = world
    for name, pos, power, size in [('Key', (-.3,-.7,1.1),60,.9), ('Fill',(.6,-.2,.3),25,.6), ('Rim',(.2,.6,.8),90,.65)]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.size = power * length**2, size * length
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = center + Vector(pos) * length
        obj.rotation_euler = (center - obj.location).to_track_quat('-Z','Y').to_euler()
    data = bpy.data.cameras.new('Fixed Camera')
    cam = bpy.data.objects.new('Fixed Camera', data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    data.type, data.ortho_scale = 'ORTHO', length * 1.18
    return center, length

def render_views(meshes, folder):
    center, length = studio(meshes)
    scene = bpy.context.scene
    cam = scene.camera
    views = [(str(yaw), (math.sin(math.radians(yaw)) * math.cos(math.radians(15)),
                         -math.cos(math.radians(yaw)) * math.cos(math.radians(15)), math.sin(math.radians(15))))
             for yaw in range(0,360,45)]
    views += [('left',(0,-1,0)), ('quarter',(-.6,-1,.3))]
    for name, direction in views:
        cam.location = center + Vector(direction) * length * 2
        cam.rotation_euler = (center - cam.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath = str(folder / (name + '.png'))
        bpy.ops.render.render(write_still=True)
    return {'center':list(center), 'length':length, 'orthographicScale':cam.data.ortho_scale,
            'resolution':[1024,512], 'pitchDegrees':15, 'yawDegrees':list(range(0,360,45)), 'seed':1234}

def inspect(weapon, slug):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = ROOT / f'assets/models/weapons-candidates/{weapon}/{slug}/{slug}.gltf'
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    report = []
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-7)
        bm.normal_update()
        seen = set()
        parts = []
        for v in bm.verts:
            if v in seen: continue
            todo, vs = [v], set()
            while todo:
                p = todo.pop()
                if p in seen: continue
                seen.add(p); vs.add(p)
                todo.extend(e.other_vert(p) for e in p.link_edges)
            fs = set(f for v in vs for f in v.link_faces)
            pts = [o.matrix_world @ v.co for v in vs]
            parts.append({'vertices':len(vs), 'triangles':sum(len(f.verts)-2 for f in fs),
                          'bounds':[[min(v[i] for v in pts) for i in range(3)], [max(v[i] for v in pts) for i in range(3)]]})
        edges = [e for e in bm.edges if len(e.link_faces) == 2]
        coplanar = sum(e.calc_face_angle() < math.radians(1) for e in edges)
        report.append({'name':o.name, 'triangles':sum(len(f.verts)-2 for f in bm.faces),
                       'sharedEdges':len(edges),'coplanarEdges':coplanar,'coplanarFraction':coplanar/max(1,len(edges)),
                       'bounds':bounds([o]), 'connectedParts':parts})
        bm.free()
    folder = OUT / weapon
    folder.mkdir(exist_ok=True)
    (folder / 'topology.json').write_text(json.dumps(report, indent=2)+'\n')
    camera = render_views(meshes, folder)
    (folder / 'camera.json').write_text(json.dumps(camera,indent=2)+'\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/'baseline.blend'))

if __name__ == '__main__':
    for weapon, slug in SPECS: inspect(weapon, slug)
