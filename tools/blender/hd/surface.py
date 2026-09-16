"""Build visible hardware and a separate relief source, then bake a single 2K atlas.

All geometry here is a nonfunctional game prop. It has no mechanical internals.
"""
import bpy, bmesh, math, json, sys, shutil
import numpy as np
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(Path(__file__).parent))
from build import active,flatten,tri_count,bevel
ROUND=int(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else 2

def mesh(name,vertices,faces,material):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(o)
    data.materials.append(material)
    return o

def cylinder(name,position,radius,length,material,axis='Y',segments=64):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments,radius=radius,depth=length,location=position)
    o=bpy.context.object;o.name=name
    if axis=='Y':o.rotation_euler.x=math.pi/2
    if axis=='X':o.rotation_euler.y=math.pi/2
    flatten(o);o.data.materials.clear();o.data.materials.append(material)
    bevel(o,min(radius*.1,.00015),2)
    o['segments']=segments;o['added']=True
    return o

def bar(name,position,size,material):
    bpy.ops.mesh.primitive_cube_add(size=1,location=position)
    o=bpy.context.object;o.name=name;o.scale=size;flatten(o)
    o.data.materials.append(material);bevel(o,min(size)*.17,3);o['added']=True
    return o

def hardware(weapon,material):
    result=[]
    if weapon=='shotgun':
        for i,x in enumerate([-.185,-.055]):
            for side in [-1,1]:
                result.append(cylinder(f'Receiver pin {i+1} side {side}',(x,side*.0147,.087),.0017,.00055,material))
        result.append(bar('Shell lifter visual',(-.154,0,.079),(.064,.017,.0009),material))
        # A flattened sling eye stays close to the stock and cap silhouette.
        for name,pos in [('Front sling eye',(-.62,0,.079)),('Stock sling eye',(.23,0,-.030))]:
            bpy.ops.mesh.primitive_torus_add(major_segments=64,minor_segments=8,location=pos,
                major_radius=.0033,minor_radius=.0006)
            o=bpy.context.object;o.name=name;o.scale=(1,.45,1);flatten(o)
            o.data.materials.append(material);o['added']=True;o['segments']=64;result.append(o)
    else:
        for i,(x,z,r) in enumerate([(-.061,.107,.0022),(-.033,.077,.0018),(-.054,.144,.0014)]):
            for side in [-1,1]:
                y=side*(.009 if i!=1 else .014)
                result.append(cylinder(f'Frame screw {i+1} side {side}',(x,y,z),r,.00055,material))
        result.append(cylinder('Ejector rod',(-.204,0,.123),.0018,.080,material,axis='X'))
        result.append(cylinder('Ejector collar',(-.238,0,.123),.00235,.006,material,axis='X'))
        result.append(bar('Cylinder release',(-.057,-.010,.113),(.009,.0014,.008),material))
        for side in [-1,1]:
            result.append(cylinder(f'Grip escutcheon side {side}',(-.008,side*.0135,.040),.0026,.00055,material))
    return result

def plain_material(name,colour,roughness=.3,metal=1):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    p=mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*colour,1);p.inputs['Roughness'].default_value=roughness;p.inputs['Metallic'].default_value=metal
    return mat

def join(objects,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
    o=bpy.context.object;o.name=name;return o

def reserve_hardware_uv(originals,added):
    """Preserve source UVs. Put each small hardware part in an unused atlas tile."""
    n=512;occupied=np.zeros((n,n),dtype=bool)
    for o in originals:
        uv=o.data.uv_layers.active.data
        for p in o.data.polygons:
            points=np.array([list(uv[i].uv) for i in p.loop_indices])*n
            for j in range(1,len(points)-1):
                a,b,c=points[[0,j,j+1]]
                lo=np.maximum(0,np.floor(np.minimum(np.minimum(a,b),c)).astype(int))
                hi=np.minimum(n-1,np.ceil(np.maximum(np.maximum(a,b),c)).astype(int))
                if np.any(lo>hi):continue
                xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
                den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
                if abs(den)<1e-9:continue
                u=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
                v=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den
                occupied[lo[1]:hi[1]+1,lo[0]:hi[0]+1]|=(u>=-.05)&(v>=-.05)&(u+v<=1.05)
    tiles=[];size=10
    for o in added:
        tile=None
        for y in range(1,n-size-1):
            for x in range(1,n-size-1):
                if not occupied[y-1:y+size+1,x-1:x+size+1].any():tile=(x,y);break
            if tile:break
        if tile is None:raise RuntimeError('No free UV tile for '+o.name)
        x,y=tile;occupied[y-1:y+size+1,x-1:x+size+1]=True
        for loop in o.data.uv_layers.active.data:
            loop.uv.x=(x+1+loop.uv.x*(size-2))/n
            loop.uv.y=(y+1+loop.uv.y*(size-2))/n
        tiles.append({'name':o.name,'pixels':[x*4,y*4,size*4,size*4]})
    return tiles

def bake_setup():
    s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=32
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='OPTIX'
    s.cycles.device='GPU';s.render.bake.use_selected_to_active=True
    s.render.bake.cage_extrusion=.0001;s.render.bake.max_ray_distance=.0005
    s.render.bake.margin=8;s.render.bake.use_clear=True
    return s

def image_target(low,name,colour=False):
    im=bpy.data.images.new(name,width=2048,height=2048,alpha=False)
    im.colorspace_settings.name='sRGB' if colour else 'Non-Color'
    for mat in low.data.materials:
        node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=im
        mat.node_tree.nodes.active=node
    return im

def emit_sources(objects,role):
    restores=[]
    for mat in {m for o in objects for m in o.data.materials if m}:
        nodes,links=mat.node_tree.nodes,mat.node_tree.links
        out=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
        old=out.inputs['Surface'].links[0].from_socket
        emission=nodes.new('ShaderNodeEmission')
        if role=='curvature':
            geometry=nodes.new('ShaderNodeNewGeometry');links.new(geometry.outputs['Pointiness'],emission.inputs['Color'])
        else:
            tex=next((n for n in nodes if n.type=='TEX_IMAGE' and role in n.image.name.lower()),None)
            if tex:links.new(tex.outputs['Color'],emission.inputs['Color'])
            else:
                p=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
                emission.inputs['Color'].default_value=p.inputs['Base Color'].default_value if role=='albedo' else (1,p.inputs['Roughness'].default_value,p.inputs['Metallic'].default_value,1)
        links.new(emission.outputs[0],out.inputs['Surface'])
        restores.append((mat,out,old,emission))
    return restores

def bake(low,sources,name,kind,folder):
    im=image_target(low,name,colour='albedo' in name)
    bpy.ops.object.select_all(action='DESELECT')
    for o in sources:o.hide_render=False;o.select_set(True)
    low.hide_render=False;low.select_set(True);bpy.context.view_layer.objects.active=low
    bpy.ops.object.bake(type=kind)
    im.filepath_raw=str(folder/(name+'.png'));im.file_format='PNG';im.save()
    for o in sources:o.hide_render=True
    return im

def restore_emit(records):
    for mat,out,old,node in records:
        mat.node_tree.links.new(old,out.inputs['Surface']);mat.node_tree.nodes.remove(node)

def atlas_material(folder,prefix):
    m=plain_material('HD single PBR atlas',(.06,.07,.08));n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
    for role in ['albedo','normal','orm']:
        t=n.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(folder/f'{prefix}-{role}.png'),check_existing=True)
        t.image.colorspace_settings.name='sRGB' if role=='albedo' else 'Non-Color'
        if role=='albedo':l.new(t.outputs['Color'],p.inputs['Base Color'])
        elif role=='normal':
            normal=n.new('ShaderNodeNormalMap');l.new(t.outputs['Color'],normal.inputs['Color']);l.new(normal.outputs[0],p.inputs['Normal'])
        else:
            sep=n.new('ShaderNodeSeparateColor');l.new(t.outputs['Color'],sep.inputs[0]);l.new(sep.outputs['Green'],p.inputs['Roughness']);l.new(sep.outputs['Blue'],p.inputs['Metallic'])
    return m

def run(weapon,slug):
    folder=ROOT/f'.kite3d/hd/round-{ROUND}/{weapon}';folder.mkdir(parents=True,exist_ok=True)
    geometry=folder/'geometry-source.blend'
    if not geometry.exists():
        if ROUND==2:geometry=ROOT/f'.kite3d/hd/round-1/{weapon}/low.blend'
        else:raise RuntimeError('Build geometry-source.blend before baking this round')
    bpy.ops.wm.open_mainfile(filepath=str(geometry))
    lows=[o for o in bpy.context.scene.objects if o.type=='MESH']
    mat=plain_material('New hardware blued steel',(.04,.046,.055),.27)
    added=hardware(weapon,mat)
    tiles=reserve_hardware_uv(lows,added) if ROUND>=4 else []
    lows+=added
    part_data=[{'name':o.name,'triangles':tri_count(o),'segments':o.get('segments'),
                'circularSections':json.loads(o.get('sectionAudit','[]')),
                'added':o.get('added',False),'reason':'Visible hardware' if o in added else 'Curved source geometry and bevels'} for o in lows]
    # Tag vertex groups before joining so the bake source can target real materials.
    for o in lows:
        group=o.vertex_groups.new(name=o.name)
        group.add(list(range(len(o.data.vertices))),1,'REPLACE')
    low=join(lows,weapon+' HD')
    dims=[max(v.co[i] for v in low.data.vertices)-min(v.co[i] for v in low.data.vertices) for i in range(3)]
    expected=1.05 if weapon=='shotgun' else .35
    if max(dims)>expected*1.03 or dims[1]>.065:
        raise RuntimeError(f'Unexpected hardware bounds: {weapon} {dims}')
    # Keep a separate bake source with source UVs and source corner normals.
    source=low.copy();source.data=low.data.copy();source.name='Source UV transfer'
    bpy.context.scene.collection.objects.link(source)
    source.data.materials.clear()
    for m in low.data.materials:source.data.materials.append(m.copy())
    active(low)
    if ROUND<4:
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(76),island_margin=.002,area_weight=.9,correct_aspect=True,scale_to_bounds=True)
        bpy.ops.object.mode_set(mode='OBJECT')
    # The receiver panels keep their geometry. Only UV coordinates change.
    bake_setup()
    if ROUND>=4:
        for role,fill in [('albedo',(.20,.22,.25,1)),('normal',(.5,.5,1,1)),('orm',(1,.3,.94,1))]:
            if ROUND>=5 and weapon=='revolver' and role=='albedo':fill=(.608,.604,.604,1)
            if ROUND>=5 and weapon=='revolver' and role=='orm':fill=(.922,.624,1,1)
            path=folder/f'transfer-{role}.png'
            shutil.copyfile(ROOT/f'assets/models/weapons-candidates/{weapon}/{slug}/main-{role}.png',path)
            im=bpy.data.images.load(str(path),check_existing=False);im.colorspace_settings.name='Non-Color'
            pixels=np.empty(2048*2048*4,dtype=np.float32);im.pixels.foreach_get(pixels)
            pixels=pixels.reshape(2048,2048,4)
            for tile in tiles:
                x,y,w,h=tile['pixels'];pixels[y:y+h,x:x+w]=fill
            im.pixels.foreach_set(pixels.ravel());im.save();bpy.data.images.remove(im)
        (folder/'preserved-uv.json').write_text(json.dumps({'sourceUvRetained':True,'newHardwareTiles':tiles},indent=2)+'\n')
        if ROUND>=6 and weapon=='shotgun':
            # Circular refinement changes tangent frames. Transfer the untouched source's
            # world-space shading onto those frames, instead of reusing incompatible tangent normals.
            existing=set(bpy.context.scene.objects)
            bpy.ops.import_scene.gltf(filepath=str(ROOT/f'assets/models/weapons-candidates/{weapon}/{slug}/{slug}.gltf'))
            imported=[o for o in bpy.context.scene.objects if o not in existing]
            originals=[o for o in imported if o.type=='MESH']
            for o in originals:flatten(o)
            bpy.context.scene.render.bake.cage_extrusion=.0008
            bpy.context.scene.render.bake.max_ray_distance=.004
            im=bake(low,originals,'transfer-normal','NORMAL',folder)
            pixels=np.empty(2048*2048*4,dtype=np.float32);im.pixels.foreach_get(pixels)
            pixels=pixels.reshape(2048,2048,4)
            for tile in tiles:
                x,y,w,h=tile['pixels'];pixels[y:y+h,x:x+w]=(.5,.5,1,1)
            im.pixels.foreach_set(pixels.ravel());im.save()
            for o in imported:bpy.data.objects.remove(o,do_unlink=True)
    else:
        for role in ['albedo','orm']:
            records=emit_sources([source],role)
            bake(low,[source],'transfer-'+role,'EMIT',folder);restore_emit(records)
        bake(low,[source],'transfer-normal','NORMAL',folder)
    low.data.materials.clear();low.data.materials.append(atlas_material(folder,'transfer'))
    for p in low.data.polygons:p.material_index=0
    source.hide_render=True
    # Split targeted high-poly patches from low. Each receives physical relief.
    high=low.copy();high.data=low.data.copy();high.name='High relief source'
    bpy.context.scene.collection.objects.link(high)
    high.data.materials.clear();high.data.materials.append(low.data.materials[0].copy())
    group_names={g.index:g.name for g in high.vertex_groups}
    # Add sampling vertices only on surfaces that receive real geometric relief.
    # Broad receiver panels and all other plain surfaces retain their topology.
    bm=bmesh.new();bm.from_mesh(high.data);deform=bm.verts.layers.deform.active
    selected=[]
    for face in bm.faces:
        tags={group_names.get(i,'') for v in face.verts for i,w in v[deform].items() if w>.5}
        x=face.calc_center_median().x
        detail=('REV_Handle' in tags or 'Hammer' in tags
                or ('Receiver and stock' in tags and x>.04)
                or (('Fore_Stock' in tags or 'REV_Cylinder' in tags) and abs(face.normal.x)<.3))
        if detail:selected.extend(face.edges)
    bmesh.ops.subdivide_edges(bm,edges=list(set(selected)),cuts=7,use_grid_fill=True)
    bm.normal_update();bm.to_mesh(high.data);bm.free()
    rest=high.copy();rest.data=high.data.copy();rest.name='High source before relief'
    bpy.context.scene.collection.objects.link(rest);rest.hide_render=True
    rest.data.materials.clear();rest.data.materials.append(high.data.materials[0].copy())
    relief_vertices=0
    high.data.update()
    cached_normals=np.empty(len(high.data.vertices)*3,dtype=np.float32)
    high.data.vertices.foreach_get('normal',cached_normals)
    cached_normals=cached_normals.reshape(-1,3)
    coordinates=np.empty(len(high.data.vertices)*3,dtype=np.float32)
    high.data.vertices.foreach_get('co',coordinates)
    coordinates=coordinates.reshape(-1,3)
    for v in high.data.vertices:
        tags=[group_names.get(g.group,'') for g in v.groups if g.weight>.5]
        x,y,z=v.co;amount=0
        if ('REV_Handle' in tags) or ('Receiver and stock' in tags and x>.04):
            # Fine longitudinal grain, plus checkering restricted to the grip patch.
            cross,along=(x,z) if weapon=='revolver' else (z,x)
            amount=.000018*(math.sin(cross*7400+math.sin(along*80)*2)+.4*math.sin(cross*15000+along*400))
            if weapon=='revolver' and .007<z<.087:
                amount+=.00011*(math.sin((x+z)*2400)*math.sin((x-z)*2400))
        elif 'Fore_Stock' in tags:
            amount=-.00028*(max(0,math.cos((x+.5)/.158*math.pi*32))**8)
        elif 'REV_Cylinder' in tags:
            theta=math.atan2(z-.12742235,y)
            end=max(0,math.sin(math.pi*min(1,max(0,(x+.1374365)/.0555934))))**.5
            amount=-(.0018 if ROUND>=5 else .0008)*max(0,math.cos(theta*6))**6*end
        elif 'Hammer' in tags:
            amount=.0001*math.sin(x*4800)*math.sin(y*4800)
        elif any('screw' in t or 'pin' in t or 'escutcheon' in t for t in tags):
            amount=-.00012*max(0,1-abs(z*1000-round(z*1000)))
        if amount:
            coordinates[v.index]+=cached_normals[v.index]*amount;relief_vertices+=1
    high.data.vertices.foreach_set('co',coordinates.ravel())
    high.data.update()
    if ROUND>=4:
        # Recompute the high source normals after physical relief displacement.
        # Clearing both sources makes the final subtraction remove only base shading.
        for o in [high,rest]:
            o.data.normals_split_custom_set([(0.0,0.0,0.0)]*len(o.data.loops))
            o.data.update()
    print('RELIEF SOURCE',weapon,len(high.data.vertices),relief_vertices,flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/'bake-source.blend'))
    bpy.context.scene.render.bake.cage_extrusion=.0015
    bpy.context.scene.render.bake.max_ray_distance=.004
    bake(low,[rest],'baked-rest-normal','NORMAL',folder)
    bake(low,[high],'baked-normal','NORMAL',folder)
    bake(low,[high],'baked-ao','AO',folder)
    records=emit_sources([high],'curvature');bake(low,[high],'baked-curvature','EMIT',folder);restore_emit(records)
    # UV masks let the colour finish follow object identity instead of arbitrary image rectangles.
    uv=low.data.uv_layers.active.data
    masks=[]
    group_names={g.index:g.name for g in low.vertex_groups}
    for p in low.data.polygons:
        tags=set(t for vi in p.vertices for g in low.data.vertices[vi].groups if g.weight>.5 for t in [group_names.get(g.group,'')])
        wood=('REV_Handle' in tags) or ('Fore_Stock' in tags) or ('Receiver and stock' in tags and p.center.x>.04)
        masks.append({'wood':wood,'uv':[list(uv[i].uv) for i in p.loop_indices],
                      'positions':[list(low.data.vertices[low.data.loops[i].vertex_index].co) for i in p.loop_indices]})
    (folder/'uv-materials.json').write_text(json.dumps(masks,separators=(',',':')))
    (folder/'parts.json').write_text(json.dumps(part_data,indent=2)+'\n')
    (folder/'bake.json').write_text(json.dumps({'distinctHighDetail':relief_vertices>0,
        'sourceTriangles':tri_count(high),'lowTriangles':tri_count(low),'reliefVertices':relief_vertices,
        'detail':'Geometric wood grain, grip diamonds, pump grooves, six cylinder relief bands, hammer texture',
        'maps':{'normal':'Tangent-space Cycles selected-to-active, includes high geometric relief',
                'ao':'Cycles ambient occlusion from separate relief source','curvature':'Cycles pointiness emitted from the high source'},
        'device':'OPTIX','resolution':2048,'samples':32},indent=2)+'\n')
    bpy.data.objects.remove(source,do_unlink=True);bpy.data.objects.remove(high,do_unlink=True);bpy.data.objects.remove(rest,do_unlink=True)
    active(low);bpy.ops.wm.save_as_mainfile(filepath=str(folder/'low.blend'))
    print('BAKED',weapon,tri_count(low),flush=True)

if __name__=='__main__':
    for weapon,slug in [('shotgun','3dmodels-cc0'),('revolver','loafbrr-cc0')]:run(weapon,slug)
