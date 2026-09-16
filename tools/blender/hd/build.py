"""Headless mesh refinement. Keep originals and their UV coordinates intact.

Run: blender -b -P tools/blender/hd/build.py -- 1
Working meshes remain private until the export command accepts them.
"""
import bpy, bmesh, math, json, sys
from pathlib import Path
from mathutils import Matrix, Vector
from collections import defaultdict

ROOT=Path(__file__).resolve().parents[3]
ROUND=int(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else 1
OUT=ROOT/f'.kite3d/hd/round-{ROUND}'
OUT.mkdir(parents=True,exist_ok=True)

def active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True);bpy.context.view_layer.objects.active=o

def tri_count(o):
    return sum(len(p.vertices)-2 for p in o.data.polygons)

def bound(o):
    return [min(v.co[i] for v in o.data.vertices) for i in range(3)], [max(v.co[i] for v in o.data.vertices) for i in range(3)]

def flatten(o):
    bpy.context.view_layer.update()
    matrix=o.matrix_world.copy();o.parent=None;o.matrix_world=Matrix.Identity(4)
    o.data.transform(matrix);o.data.update()

def weld(o):
    bm=bmesh.new();bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    bm.normal_update()
    # Merge only coplanar pairs with matching UVs. No flat-panel subdivision.
    bmesh.ops.join_triangles(bm,faces=list(bm.faces),cmp_uvs=True,
                            angle_face_threshold=.001,angle_shape_threshold=math.pi)
    bm.to_mesh(o.data);bm.free();o.data.update()

def round_rings(o, center, cuts=3, radius_scale=1, x_limit=None, radii=None):
    """Refine only circumferential edges. Project inserted vertices to existing ring radii."""
    if ROUND>=6:return refine_sections(o,center,radius_scale,x_limit,radii)
    bm=bmesh.new();bm.from_mesh(o.data)
    cy,cz=center
    original=[v.co.copy() for v in bm.verts]
    maxr=max(math.hypot(v.y-cy,v.z-cz) for v in original)
    circum=[]
    for e in bm.edges:
        a,b=[v.co for v in e.verts]
        ra,rb=math.hypot(a.y-cy,a.z-cz),math.hypot(b.y-cy,b.z-cz)
        eligible=min(ra,rb)>maxr*.55 if radii is None else any(abs(ra-r)<.00001 and abs(rb-r)<.00001 for r in radii)
        if x_limit is not None and max(a.x,b.x)>x_limit:continue
        if abs(a.x-b.x)<1e-6 and eligible and abs(ra-rb)<maxr*.025:
            circum.append(e)
    arcs=[(e.verts[0].co.copy(),e.verts[1].co.copy()) for e in circum]
    old=set(bm.verts)
    bmesh.ops.subdivide_edges(bm,edges=circum,cuts=cuts,use_grid_fill=True)
    inserted=0
    for v in bm.verts:
        if v in old:continue
        # Interior fill vertices must stay on their original surface.
        # Only vertices inserted directly on a selected circular arc can move.
        arc=None
        for a,b in arcs:
            edge=b-a;t=(v.co-a).dot(edge)/max(1e-20,edge.length_squared)
            if 0<t<1 and (a+edge*t-v.co).length<1e-7:
                arc=(a,b);break
        if arc is None:continue
        r=math.hypot(arc[0].y-cy,arc[0].z-cz)*radius_scale
        d=Vector((v.co.y-cy,v.co.z-cz))
        if d.length>maxr*.55:
            d.normalize();v.co.y=cy+d.x*r;v.co.z=cz+d.y*r;inserted+=1
    for v in old:
        if not v.is_valid:continue
        if any((v.co-a).length<1e-7 or (v.co-b).length<1e-7 for a,b in arcs):
            v.co.y=cy+(v.co.y-cy)*radius_scale;v.co.z=cz+(v.co.z-cz)*radius_scale
    bm.normal_update();bm.to_mesh(o.data);bm.free();o.data.update()
    return inserted

def refine_sections(o,center,radius_scale,x_limit,radii):
    """Fit complete source sections. Subdivide their perimeter edges, never cap diagonals."""
    bm=bmesh.new();bm.from_mesh(o.data)
    sections=defaultdict(list)
    for v in bm.verts:sections[round(v.co.x,6)].append(v)
    batches=defaultdict(set);arcs=[];audit=[]
    for x,verts in sections.items():
        if x_limit is not None and x>x_limit:continue
        cy,cz=center if radii else ((min(v.co.y for v in verts)+max(v.co.y for v in verts))/2,
                                   (min(v.co.z for v in verts)+max(v.co.z for v in verts))/2)
        rings=defaultdict(list)
        for v in verts:
            r=math.hypot(v.co.y-cy,v.co.z-cz)
            if radii and not any(abs(r-rr)<.00002 for rr in radii):continue
            rings[round(r,5)].append(v)
        for _,ring in rings.items():
            angles=sorted(set(round(math.atan2(v.co.z-cz,v.co.y-cy),5) for v in ring))
            count=len(angles)
            if count<8:continue
            gaps=[b-a for a,b in zip(angles,angles[1:])]+[angles[0]+2*math.pi-angles[-1]]
            if max(gaps)>2*math.pi/count*1.3:continue
            r=sum(math.hypot(v.co.y-cy,v.co.z-cz) for v in ring)/len(ring)
            if r<.001:continue
            cuts=max(0,math.ceil(64/count)-1)
            rv=set(ring);edges={e for v in ring for e in v.link_edges if all(vv in rv for vv in e.verts)}
            perimeter=[]
            for e in edges:
                a,b=[v.co.copy() for v in e.verts]
                delta=abs((math.atan2(a.z-cz,a.y-cy)-math.atan2(b.z-cz,b.y-cy)+math.pi)%(2*math.pi)-math.pi)
                if delta>max(gaps)*1.1 or delta<.00001:continue
                perimeter.append(e);arcs.append((a,b,cy,cz,r*radius_scale))
            if len(perimeter)<count:continue
            if cuts:batches[cuts].update(perimeter)
            audit.append({'x':x,'center':[cy,cz],'radius':r*radius_scale,'beforeSegments':count,
                          'targetSegments':count*(cuts+1)})
    for cuts,edges in batches.items():
        bmesh.ops.subdivide_edges(bm,edges=[e for e in edges if e.is_valid],cuts=cuts,use_grid_fill=True)
    moved=0
    for v in bm.verts:
        for a,b,cy,cz,r in arcs:
            edge=b-a;t=(v.co-a).dot(edge)/max(1e-20,edge.length_squared)
            if -1e-6<=t<=1+1e-6 and (a+edge*t-v.co).length<2e-7:
                theta=math.atan2(v.co.z-cz,v.co.y-cy)
                v.co.y=cy+math.cos(theta)*r;v.co.z=cz+math.sin(theta)*r;moved+=1;break
    for section in audit:
        cy,cz=section['center'];r=section['radius'];x=section['x']
        angles={round(math.atan2(v.co.z-cz,v.co.y-cy),5) for v in bm.verts
                if abs(v.co.x-x)<1e-6 and abs(math.hypot(v.co.y-cy,v.co.z-cz)-r)<1e-6}
        section['measuredSegments']=len(angles)
    bm.normal_update();bm.to_mesh(o.data);bm.free();o.data.update()
    o['sectionAudit']=json.dumps(audit)
    return moved

def bevel(o,width,segments):
    active(o)
    mod=o.modifiers.new('Machined edge radius','BEVEL')
    mod.width=width;mod.segments=segments;mod.limit_method='ANGLE'
    mod.angle_limit=math.radians(12);mod.use_clamp_overlap=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # Preserve broad planes while giving bevel strips continuous normals.
    for p in o.data.polygons:p.use_smooth=True

def transfer_normals(o,source):
    active(o)
    mod=o.modifiers.new('Preserve source corner normals','DATA_TRANSFER')
    mod.object=source;mod.use_loop_data=True;mod.data_types_loops={'CUSTOM_NORMAL'}
    mod.loop_mapping='POLYINTERP_NEAREST'
    bpy.ops.object.modifier_apply(modifier=mod.name)

def build(weapon,slug):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/f'assets/models/weapons-candidates/{weapon}/{slug}/{slug}.gltf'))
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    sources={}
    for o in objects:
        flatten(o)
        src=bpy.data.objects.new('Transfer source '+o.name,o.data.copy())
        bpy.context.scene.collection.objects.link(src);src.hide_render=True
        sources[o.name]=src
        weld(o)
    for o in list(bpy.context.scene.objects):
        if o not in objects and o not in sources.values():bpy.data.objects.remove(o,do_unlink=True)
    if weapon=='shotgun':
        o=bpy.data.objects['Shotgun'];active(o)
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='LOOSE');bpy.ops.object.mode_set(mode='OBJECT')
        for obj in [o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('Shotgun')]:
            lo,hi=bound(obj);dx=hi[0]-lo[0]
            if lo[0]<-.72:obj.name='Barrel'
            elif hi[0]>.32:obj.name='Receiver and stock'
            elif lo[0]<-.69:obj.name='Bead' if hi[2]>.144 else 'Bead base'
            elif lo[0]<-.63:obj.name='Magazine tube and cap'
            elif lo[2]<.05:obj.name='Trigger guard'
            else:obj.name='Bolt'
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o not in sources.values()]
    report=[]
    for o in objects:
        before=tri_count(o);lo,hi=bound(o)
        center=((lo[1]+hi[1])/2,(lo[2]+hi[2])/2)
        segments=None;inserted=0
        if o.name in ['Barrel','Fore_Stock','Magazine tube and cap']:
            # Supplied outer rings use sixteen facets. Each arc gets four spans.
            if o.name=='Magazine tube and cap':center=(0,.09643965)
            cuts=5 if ROUND>=6 and o.name in ['Barrel','Magazine tube and cap'] else 3
            inserted=round_rings(o,center,cuts=cuts,radius_scale=.98 if ROUND>=3 else .995);segments=72 if cuts==5 else 64
        if o.name=='REV_Cylinder':
            inserted=round_rings(o,center,cuts=3);segments=64
        if o.name=='REV_Frame' and ROUND>=3:
            inserted=round_rings(o,(0,.144415),cuts=3,x_limit=-.13791 if ROUND>=6 else -.16,radii=[.01338,.006147]);segments=64
        width=.00022 if weapon=='shotgun' else .00009
        if o.name in ['Barrel','Magazine tube and cap','REV_Cylinder']:width*=.6
        edge_segments=4 if weapon=='shotgun' else 3
        if ROUND>=4 and o.name in ['Bead','Bead base']:edge_segments=2
        bevel(o,width,edge_segments)
        transfer_normals(o,sources.get(o.name,sources.get('Shotgun')))
        report.append({'name':o.name,'beforeTriangles':before,'triangles':tri_count(o),
                       'nominalRadialSegments':segments,'insertedArcVertices':inserted,
                       'circularSections':json.loads(o.get('sectionAudit','[]')),
                       'reason':'Curved arc refinement and edge radius' if inserted else 'Edge radius; original panel interiors retained'})
        o['segments']=segments or 0
    for o in sources.values():bpy.data.objects.remove(o,do_unlink=True)
    folder=OUT/weapon;folder.mkdir(exist_ok=True)
    (folder/'parts.json').write_text(json.dumps(report,indent=2)+'\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/'low.blend'))
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/'geometry-source.blend'))
    print('BUILT',weapon,sum(r['triangles'] for r in report),flush=True)

if __name__=='__main__':
    for weapon,slug in [('shotgun','3dmodels-cc0'),('revolver','loafbrr-cc0')]:build(weapon,slug)
