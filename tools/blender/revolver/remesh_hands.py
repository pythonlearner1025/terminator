"""Unify finger roots and palm volume; preserve the original rig and material boundaries."""
from mathutils.bvhtree import BVHTree
for side in ['Right','Left']:
 keys=[key for key in parts if key.startswith(side) and key!=side+'Forearm']
 obs=[o for key in keys for o in parts[key]]
 active(obs[0])
 for o in obs:o.select_set(True)
 bpy.ops.object.join();o=bpy.context.object;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 source=o.copy();source.data=o.data.copy();scene.collection.objects.link(source);source.hide_render=True
 vertices=[v.co.copy() for v in source.data.vertices];faces=[list(p.vertices) for p in source.data.polygons]
 tree=BVHTree.FromPolygons(vertices,faces);material_ids=[p.material_index for p in source.data.polygons]
 active(o);mod=o.modifiers.new('Unified anatomical volume','REMESH');mod.mode='VOXEL';mod.voxel_size=.0018;mod.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=mod.name)
 mod=o.modifiers.new('Soft finger roots','SMOOTH');mod.factor=.7;mod.iterations=5;bpy.ops.object.modifier_apply(modifier=mod.name)
 mod=o.modifiers.new('Stable anatomical triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=mod.name)
 if len(o.data.polygons)>2850:
  mod=o.modifiers.new('Hand surface budget','DECIMATE');mod.ratio=2850/len(o.data.polygons);bpy.ops.object.modifier_apply(modifier=mod.name)
 for polygon in o.data.polygons:
  hit=tree.find_nearest(polygon.center)
  if hit[2] is not None:polygon.material_index=material_ids[hit[2]]
  polygon.use_smooth=True
 for group in source.vertex_groups:
  if group.name not in o.vertex_groups:o.vertex_groups.new(name=group.name)
 # Explicit nearest-surface interpolation prevents unweighted remesh vertices.
 for vertex in o.data.vertices:
  face_index=tree.find_nearest(vertex.co)[2];weights={};total=0
  for index in faces[face_index]:
   original=source.data.vertices[index];factor=1/max(.000001,(original.co-vertex.co).length_squared)
   for group in original.groups:
    key=source.vertex_groups[group.group].name;weights[key]=weights.get(key,0)+factor*group.weight;total+=factor*group.weight
  if not total:weights={side+'Palm':1};total=1
  for key,value in weights.items():o.vertex_groups[key].add([vertex.index],value/total,'REPLACE')
 bpy.data.objects.remove(source,do_unlink=True)
 for key in keys:parts.pop(key)
 parts[side+'Palm']=[o]
