import bpy,json
ob=bpy.data.objects['DJMaesenArms'];bpy.context.view_layer.update();ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh()
for i in [1448,44,1453,1467,1518]:
 v=ob.data.vertices[i];print('SKIN_VERTEX',i,list(ev.matrix_world@mesh.vertices[i].co),[(ob.vertex_groups[g.group].name,round(g.weight,4)) for g in v.groups])
ev.to_mesh_clear()
