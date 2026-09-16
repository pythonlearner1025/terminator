"""Read-only inventory. Run with the required coordination/revolver-blender."""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def meshes():
    return sorted((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: o.name)


def evaluated_vertices():
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    result = {}
    for ob in meshes():
        ev = ob.evaluated_get(graph)
        mesh = ev.to_mesh()
        try:
            result[ob.name] = np.array([tuple(ev.matrix_world @ v.co) for v in mesh.vertices])
            assert np.isfinite(result[ob.name]).all(), ob.name
        finally:
            ev.to_mesh_clear()
    return result


def inventory():
    result = {'blender': bpy.app.version_string, 'meshes': [], 'armatures': [], 'images': []}
    for ob in meshes():
        weights = [[(ob.vertex_groups[g.group].name, g.weight) for g in v.groups] for v in ob.data.vertices]
        totals = [sum(w for _, w in vertex) for vertex in weights]
        uv = {layer.name: [list(loop.uv) for loop in layer.data] for layer in ob.data.uv_layers}
        groups = {g.name: sum(any(name == g.name and w > 1e-8 for name, w in vertex) for vertex in weights) for g in ob.vertex_groups}
        material_images = sorted({node.image.name for mat in ob.data.materials if mat and mat.use_nodes for node in mat.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image})
        result['meshes'].append({
            'name': ob.name, 'vertices': len(ob.data.vertices),
            'triangles': sum(len(p.vertices) - 2 for p in ob.data.polygons),
            'weighted_vertices': sum(t > 1e-8 for t in totals),
            'weight_sum_range': [min(totals), max(totals)],
            'groups': groups, 'uv_layers': {k: len(v) for k, v in uv.items()},
            'uv_finite': all(math.isfinite(x) for data in uv.values() for pair in data for x in pair),
            'geometry_sha256': digest({'vertices': [list(v.co) for v in ob.data.vertices], 'polygons': [list(p.vertices) for p in ob.data.polygons]}),
            'weights_sha256': digest(weights), 'uv_sha256': digest(uv),
            'materials': [mat.name for mat in ob.data.materials], 'material_images': material_images,
            'armature_modifiers': [{'name': m.name, 'object': m.object.name, 'enabled': m.show_viewport and m.show_render} for m in ob.modifiers if m.type == 'ARMATURE'],
        })
    for rig in sorted((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), key=lambda o: o.name):
        bones = []
        for bone in rig.data.bones:
            pb = rig.pose.bones[bone.name]
            constraints = [{'type': c.type, 'target': c.target.name if c.target else None, 'influence': c.influence, 'muted': c.mute, 'owner_space': c.owner_space, 'target_space': c.target_space} for c in pb.constraints]
            control = pb.constraints[0].target if pb.constraints else None
            bones.append({'name': bone.name, 'parent': bone.parent.name if bone.parent else None,
                          'use_deform': bone.use_deform, 'constraints': constraints,
                          'inverse_bind': list(bone.get('source_inv_bind', [])),
                          'control_parent': control.parent.name if control and control.parent else None,
                          'control_world_position': list(control.matrix_world.translation) if control else None,
                          'control_world_axes': [list(control.matrix_world.to_quaternion() @ Vector(axis)) for axis in ((1, 0, 0), (0, 1, 0), (0, 0, 1))] if control else None})
        result['armatures'].append({'name': rig.name, 'bones': bones})
    for im in bpy.data.images:
        if im.source != 'FILE':
            continue
        result['images'].append({'name': im.name, 'size': list(im.size), 'packed': bool(im.packed_file),
                                 'packed_sha256': hashlib.sha256(im.packed_file.data).hexdigest() if im.packed_file else None})
    return result


def structural_signature(report):
    """Exclude posed transforms, include every source bone, constraint and skin weight."""
    return digest({'meshes': report['meshes'], 'armatures': [
        {'name': rig['name'], 'bones': [{k: v for k, v in b.items() if not k.startswith('control_world_')} for b in rig['bones']]}
        for rig in report['armatures']]})


if __name__ == '__main__':
    output = Path(sys.argv[sys.argv.index('--') + 1])
    result = inventory()
    output.write_text(json.dumps(result, indent=2))
    print(json.dumps({'output': str(output), 'meshes': len(result['meshes']), 'bones': sum(len(r['bones']) for r in result['armatures'])}))
