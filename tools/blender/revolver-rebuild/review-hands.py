"""Bounded standalone build and fixed-camera evidence. Run ONLY via revolver-blender."""
import bpy
import bmesh
import sys
import json
import argparse
import importlib.util
from pathlib import Path
from mathutils import Vector

HERE=Path(__file__).resolve().parent
COORD=Path('/home/minjune/games/terminator-v2/coordination')
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

def camera(name,location,target,scale):
    obj=bpy.data.objects.new(name,bpy.data.cameras.new(name));bpy.context.scene.collection.objects.link(obj)
    obj.location=location;obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    obj.data.type='ORTHO';obj.data.ortho_scale=scale;obj.data.clip_start=.001;obj.data.clip_end=10
    return obj

def audit(result):
    out={}
    names=set(result['bones'])
    for obj in result['meshes']:
        bm=bmesh.new();bm.from_mesh(obj.data)
        comps=[];seen=set()
        for v in bm.verts:
            if v in seen:continue
            stack=[v];seen.add(v);n=0
            while stack:
                q=stack.pop();n+=1
                for e in q.link_edges:
                    other=e.other_vert(q)
                    if other not in seen:seen.add(other);stack.append(other)
            comps.append(n)
        weights=[]
        for v in obj.data.vertices:
            weights.append(sum(g.weight for g in v.groups if obj.vertex_groups[g.group].name in names))
        out[obj.name]={'vertices':len(obj.data.vertices),'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),
                      'connectedComponents':sorted(comps,reverse=True),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),
                      'boneWeightSumRange':[min(weights),max(weights)],'uvLayers':[uv.name for uv in obj.data.uv_layers]}
        bm.free()
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--gun');ap.add_argument('--quick',action='store_true');ap.add_argument('--no-render',action='store_true');ap.add_argument('--material',action='store_true');args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    hands=module('fresh_hands',HERE/'hands.py')
    contract=json.loads((COORD/'revolver-gun-contract.json').read_text()) if (COORD/'revolver-gun-contract.json').exists() else {}
    coll=bpy.data.collections.new('Rebuild');bpy.context.scene.collection.children.link(coll)
    gun=None
    if args.gun:
        gun=module('fresh_gun',args.gun).build_gun(collection=coll)
    result=hands.build_hands(contract,collection=coll,use_baked_materials=False)
    out=HERE/'generated'/'hands';out.mkdir(parents=True,exist_ok=True)
    evidence=HERE/'generated'/'review'/'hands';evidence.mkdir(parents=True,exist_ok=True)
    metadata=result['metadata'];metadata['audit']=audit(result);metadata['module']=str(HERE/'hands.py')
    metadata['artifact']=str(out/'hands.blend')
    metadata['api']={'build':'build_hands(gun_contract, collection=None)','pose':'apply_pose(result, gesture, side=None, amount=1.0)',
                     'transform':'set_hand_transform(result, side, world_delta_matrix)','contact':'contact_report(result, gun_objects)'}
    s=bpy.context.scene;s.render.engine='BLENDER_WORKBENCH';s.render.resolution_x=720;s.render.resolution_y=640;s.render.resolution_percentage=100
    s.render.image_settings.file_format='PNG';s.world.color=(.045,.045,.045)
    sh=s.display.shading;sh.light='STUDIO';sh.studio_light='paint.sl';sh.color_type='MATERIAL';sh.show_cavity=True;sh.cavity_type='BOTH';sh.curvature_ridge_factor=1.1;sh.curvature_valley_factor=1.0;sh.show_shadows=True
    sh.background_type='WORLD';s.display.render_aa='16'
    grip=Vector(metadata['anchors']['GripCenter'])
    target=(.195,0,-.045)
    views={'player':camera('HandsReview.Player',(.66,.34,.18),target,.50),
           'back':camera('HandsReview.Back',(.19,.65,-.043),target,.48),
           'palm':camera('HandsReview.Palm',(.19,-.65,-.043),target,.48)}
    records={}
    for gesture in (['neutral','grip'] if args.quick else ['neutral','grip','support','reload']):
        hands.apply_pose(result,gesture)
        records[gesture]={'contact':hands.contact_report(result,gun['objects']) if gun else None,'renders':[]}
        if not args.no_render:
            for view,cam in views.items():
                # Neutral palms shown one at a time; gripping views always show both hands and gun.
                for obj in result['meshes']:obj.hide_render=gesture=='neutral' and ('Left' in obj.name)
                if gun:
                    for obj in gun['objects'].values():obj.hide_render=gesture=='neutral'
                s.camera=cam;s.render.filepath=str(evidence/(gesture+'-'+view+'.png'));bpy.ops.render.render(write_still=True)
                records[gesture]['renders'].append({'path':s.render.filepath,'matrix':[list(r) for r in cam.matrix_world],'orthoScale':cam.data.ortho_scale})
    for obj in result['meshes']:obj.hide_render=False
    if gun:
        for obj in gun['objects'].values():obj.hide_render=False
    hands.apply_pose(result,'grip');s.camera=views['player']
    # Save source in grip with editable bone poses; neutral rest is one API call away.
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'hands.blend'))
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'hands.blend'))
    metadata['evidence']=records
    (out/'hands-contract.json').write_text(json.dumps(metadata,indent=2)+'\n')
    (COORD/'revolver-hands-contract.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps({'artifact':metadata['artifact'],'triangles':metadata['triangles'],'audit':metadata['audit']}))

if __name__=='__main__':main()
