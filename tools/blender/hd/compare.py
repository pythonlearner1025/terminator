"""Render and measure the literal owner gates. Missing evidence fails closed.

python3 tools/blender/hd/compare.py N
Raw renders stay in .kite3d. Gate JSON and compact sheets stay beside this tool.
"""
import sys, json, math, subprocess, hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
SPECS=[('shotgun','3dmodels-cc0'),('revolver','loafbrr-cc0')]
ANGLES=list(range(0,360,45))

def blender_render(n):
    import bpy,bmesh
    from bpy_extras.object_utils import world_to_camera_view
    sys.path.insert(0,str(Path(__file__).parent))
    from asset_inspect import studio
    from mathutils import Vector
    for weapon,slug in SPECS:
        folder=ROOT/f'.kite3d/hd/round-{n}/{weapon}'
        path=folder/('baseline.blend' if n==0 else 'low.blend')
        bpy.ops.wm.open_mainfile(filepath=str(path))
        meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
        for o in list(bpy.context.scene.objects):
            if o.type in ['CAMERA','LIGHT']:bpy.data.objects.remove(o,do_unlink=True)
        studio(meshes)
        scene=bpy.context.scene
        spec=json.loads((ROOT/f'.kite3d/hd/round-0/{weapon}/camera.json').read_text())
        center=Vector(spec['center']);length=spec['length'];cam=scene.camera
        cam.data.ortho_scale=spec['orthographicScale']
        # Lock lighting to the baseline bounds too. Added hardware cannot move studio lights.
        for name,pos,power,size in [('Key',(-.3,-.7,1.1),60,.9),('Fill',(.6,-.2,.3),25,.6),('Rim',(.2,.6,.8),90,.65)]:
            light=bpy.data.objects[name];light.data.energy=power*length**2;light.data.size=size*length
            light.location=center+Vector(pos)*length
            light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler()
        scene.cycles.samples=128
        geometry=[]
        for o in meshes:
            bm=bmesh.new();bm.from_mesh(o.data)
            bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
            bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.normal_update()
            edges=[e for e in bm.edges if len(e.link_faces)==2]
            coplanar=sum(e.calc_face_angle()<math.radians(1) for e in edges)
            geometry.append({'name':o.name,'triangles':len(bm.faces),'sharedEdges':len(edges),
                             'coplanarEdges':coplanar,'coplanarFraction':coplanar/max(1,len(edges))})
            bm.free()
        (folder/'geometry.json').write_text(json.dumps(geometry,indent=2)+'\n')
        part_path=folder/'parts.json'
        parts=json.loads(part_path.read_text()) if part_path.exists() else []
        added={p['name'] for p in parts if p.get('added')}
        projections={}
        materials={m for o in meshes for m in o.data.materials if m}
        original_images={}
        # All current drafts preserve source UVs. Transfer layouts must supply explicit proof images here.
        for mat in materials:
            for node in mat.node_tree.nodes:
                if node.type=='TEX_IMAGE' and node.image:
                    original_images[node]=node.image
        for mode in ['original-maps','final']:
            if mode=='original-maps':
                for node,im in original_images.items():
                    role=next((role for role in ['albedo','normal','orm'] if role in im.name.lower()),None)
                    if role:
                        p=folder/f'transfer-{role}.png'
                        if not p.exists():p=ROOT/f'assets/models/weapons-candidates/{weapon}/{slug}/main-{role}.png'
                        image=bpy.data.images.load(str(p),check_existing=True)
                        image.colorspace_settings.name='sRGB' if role=='albedo' else 'Non-Color'
                        node.image=image
            else:
                for node,im in original_images.items():node.image=im
            views=[(str(a),(math.sin(math.radians(a))*math.cos(math.radians(15)),
                            -math.cos(math.radians(a))*math.cos(math.radians(15)),math.sin(math.radians(15)))) for a in ANGLES]
            views += [('left',(0,-1,0)),('quarter',(-.6,-1,.3))]
            for name,direction in views:
                cam.location=center+Vector(direction)*length*2
                cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
                scene.render.filepath=str(folder/f'{mode}-{name}.png')
                bpy.ops.render.render(write_still=True)
                if mode=='original-maps' and name.isdigit() and added:
                    angle_parts={}
                    for o in meshes:
                        groups={g.index:g.name for g in o.vertex_groups}
                        vertices={v.index:world_to_camera_view(scene,cam,o.matrix_world@v.co) for v in o.data.vertices}
                        for p in o.data.polygons:
                            names={groups.get(g.group) for vi in p.vertices for g in o.data.vertices[vi].groups if g.weight>.5}&added
                            for part in names:
                                angle_parts.setdefault(part,[]).append([[vertices[i].x*1024,(1-vertices[i].y)*512] for i in p.vertices])
                    projections[name]=angle_parts
        if added:(folder/'added-projections.json').write_text(json.dumps(projections,separators=(',',':')))
        print('COMPARED RENDERS',n,weapon,flush=True)

def metrics(n):
    import numpy as np
    from PIL import Image,ImageDraw,ImageFont
    from skimage.color import rgb2lab
    from skimage.metrics import structural_similarity
    output=ROOT/'tools/blender/hd/rounds';output.mkdir(exist_ok=True)
    def read(path):return np.asarray(Image.open(path).convert('RGBA')).astype(np.float64)/255
    def gradient(path):
        a=read(path)[:,:,:3]*2-1
        gy,gx=np.gradient(a,axis=(0,1))
        return float(np.sqrt((gx*gx+gy*gy).sum(axis=2)).mean())
    gate={'round':n,'thresholds':{'G1_IoU':.985,'G1_addedArea':.02,'G2_meanLab':2.0,'G2_SSIM':.95,
          'G3_normalGradientRatio':1.3,'G4_coplanarFraction':.08,'G5_frameDeltaMs':.5},
          'method':{'colour':'Mean CIE76 in shared alpha >= 0.5 mask','ssim':'RGB SSIM, 7px window, averaged in shared mask',
                    'topology':'Weld positions at 1e-7m, triangulate, count all manifold edges below one degree',
                    'renderer':'Cycles OPTIX, 128 samples, fixed seed, 1024 x 512, orthographic'},'weapons':{}}
    for weapon,slug in SPECS:
        base=ROOT/f'.kite3d/hd/round-0/{weapon}';folder=ROOT/f'.kite3d/hd/round-{n}/{weapon}'
        g1=[];g2=[];added_measurements={}
        projection_path=folder/'added-projections.json'
        projections=json.loads(projection_path.read_text()) if projection_path.exists() else {}
        sheets=[]
        for a in ANGLES:
            ap=base/f'original-maps-{a}.png';bp=folder/f'original-maps-{a}.png'
            aa,bb=read(ap),read(bp);am=aa[:,:,3]>=.5;bm=bb[:,:,3]>=.5
            shared=am&bm;union=am|bm
            iou=float(shared.sum()/max(1,union.sum()))
            area=float((bm&~am).sum()/max(1,am.sum()))
            lab=float(np.linalg.norm(rgb2lab(aa[:,:,:3])-rgb2lab(bb[:,:,:3]),axis=2)[shared].mean())
            _,ssim=structural_similarity(aa[:,:,:3],bb[:,:,:3],channel_axis=2,data_range=1,full=True)
            ssim=float(ssim[shared].mean())
            g1.append({'yaw':a,'IoU':iou,'addedMaskAreaFraction':area,'pass':iou>=.985 and area<.02})
            for part,polygons in projections.get(str(a),{}).items():
                mask=Image.new('1',(1024,512));draw=ImageDraw.Draw(mask)
                for poly in polygons:draw.polygon([tuple(p) for p in poly],fill=1)
                mask=np.asarray(mask,dtype=bool)
                added_measurements.setdefault(part,[]).append({'yaw':a,
                    'projectedAreaPixels':int(mask.sum()),
                    'exteriorAreaPixels':int((mask&bm&~am).sum()),
                    'exteriorAreaFraction':float((mask&bm&~am).sum()/max(1,am.sum()))})
            g2.append({'yaw':a,'meanLab':lab,'SSIM':ssim,'pass':lab<=2 and ssim>=.95})
            heat=np.zeros_like(aa);heat[:,:,3]=1
            d=np.clip(np.abs(aa[:,:,:3]-bb[:,:,:3]).mean(axis=2)*6,0,1)
            heat[:,:,0]=d;heat[:,:,1]=np.clip(d-.35,0,1)*.7;heat[:,:,2]=np.clip(d-.7,0,1)
            heat[am&~bm,:3]=[0,.5,1];heat[bm&~am,:3]=[0,1,.3]
            row=Image.new('RGB',(1536,280),(24,27,33));draw=ImageDraw.Draw(row)
            for i,arr in enumerate([aa,bb,heat]):
                im=Image.fromarray((arr*255).astype('uint8')).resize((512,256))
                row.paste(im,(i*512,24),im.getchannel('A'))
                draw.text((i*512+8,6),f'{a} deg '+['A original','B original maps','difference x6'][i],fill='white')
            sheets.append(row)
        comparison=Image.new('RGB',(1536,280*8),(24,27,33))
        for i,row in enumerate(sheets):comparison.paste(row,(0,i*280))
        comparison.save(output/f'gate-{n}-{weapon}-difference.jpg',quality=92)
        aa=read(base/'final-left.png');bb=read(folder/'final-left.png')
        heat=np.zeros_like(aa);heat[:,:,3]=1
        difference=np.clip(np.abs(aa[:,:,:3]-bb[:,:,:3]).mean(axis=2)*4,0,1)
        heat[:,:,0]=difference;heat[:,:,1]=np.clip(difference-.4,0,1)
        final_comparison=Image.new('RGB',(1536,280),(24,27,33));draw=ImageDraw.Draw(final_comparison)
        for i,arr in enumerate([aa,bb,heat]):
            im=Image.fromarray((arr*255).astype('uint8')).resize((512,256))
            final_comparison.paste(im,(i*512,24),im.getchannel('A'))
            draw.text((i*512+8,6),['A original','B final surface','final difference x4'][i],fill='white')
        final_comparison.save(output/f'gate-{n}-{weapon}-final-difference.jpg',quality=94)
        src=ROOT/f'assets/models/weapons-candidates/{weapon}/{slug}'
        normal=folder/'main-normal.png';normal=normal if normal.exists() else src/'main-normal.png'
        orm=folder/'main-orm.png';orm=orm if orm.exists() else src/'main-orm.png'
        ratio=gradient(normal)/max(1e-12,gradient(src/'main-normal.png'))
        ao=read(orm)[:,:,0]
        uv_file=folder/'uv-materials.json'
        ao_values=ao.ravel()
        if uv_file.exists():
            mask=Image.new('1',(2048,2048));draw=ImageDraw.Draw(mask)
            for p in json.loads(uv_file.read_text()):draw.polygon([(u*2047,(1-v)*2047) for u,v in p['uv']],fill=1)
            ao_values=ao[np.asarray(mask,dtype=bool)]
        contrast=float(np.percentile(ao_values,95)-np.percentile(ao_values,5))
        bake=folder/'bake.json';bake=json.loads(bake.read_text()) if bake.exists() else {}
        geometry=json.loads((folder/'geometry.json').read_text())
        coplanar=sum(p['coplanarEdges'] for p in geometry)/max(1,sum(p['sharedEdges'] for p in geometry))
        counts=sum(p['triangles'] for p in geometry)
        performance=output/f'performance-{n}.json'
        perf=json.loads(performance.read_text()) if performance.exists() else {}
        visible=output/f'performance-visible-hd-{n}.json'
        if visible.exists():perf=json.loads(visible.read_text())
        baseline_path=output/'performance-visible-original-0.json'
        baseline=json.loads((baseline_path if visible.exists() else output/'performance-0.json').read_text())
        delta=perf.get('frameIntervalMs',{}).get('mean',float('inf'))-baseline['frameIntervalMs']['mean']
        manifest=folder/'export.json';manifest=json.loads(manifest.read_text()) if manifest.exists() else {}
        g3={'gradientRatio':ratio,'aoP95MinusP5':contrast,'aoMeasurement':'Occupied UV pixels only',
            'aoMean':float(ao_values.mean()),'bake':bake,
            'pass':ratio>=1.3 and contrast>.05 and bake.get('distinctHighDetail',False)}
        part_file=folder/'parts.json'
        parts=json.loads(part_file.read_text()) if part_file.exists() else geometry
        exported=manifest.get('triangles',counts)
        g4={'triangles':exported,'weldedTriangles':counts,'parts':parts,'topology':geometry,
            'coplanarFraction':coplanar,'pass':coplanar<.08 and 25000<=exported<=35000}
        g5={'frameTimeDeltaMs':delta if math.isfinite(delta) else None,'drawCalls':manifest.get('drawCalls'),
            'textureMaps':manifest.get('textureMaps'),'pass':delta<=.5 and manifest.get('drawCalls')==1
            and manifest.get('textureMaps')==[2048,2048,2048]}
        g6={'sameCamera':True,'differenceImage':f'gate-{n}-{weapon}-final-difference.jpg',
            'opened':False,'review':'Pending image inspection','pass':False}
        review_file=output/f'review-{n}.json'
        if review_file.exists():
            review=json.loads(review_file.read_text()).get(weapon,{})
            digest=hashlib.sha256((output/g6['differenceImage']).read_bytes()).hexdigest()
            if review.get('imageSha256')==digest:g6.update(review)
        gate['weapons'][weapon]={'G1':{'angles':g1,'addedParts':[
            {'name':name,'angles':angles} for name,angles in added_measurements.items()],
            'addedAreaMethod':'Projected part polygons intersect the rendered new exterior mask. Overlaps are not summed.',
            'pass':all(x['pass'] for x in g1) and (n<2 or bool(added_measurements))},
          'G2':{'angles':g2,'pass':all(x['pass'] for x in g2)},'G3':g3,'G4':g4,'G5':g5,'G6':g6}
    gate['pass']=all(g['pass'] for w in gate['weapons'].values() for g in w.values())
    (output/f'gate-{n}.json').write_text(json.dumps(gate,indent=2,allow_nan=False)+'\n')
    print(json.dumps({w:{k:v['pass'] for k,v in d.items()} for w,d in gate['weapons'].items()}))

if __name__=='__main__':
    if '--blender' in sys.argv:
        blender_render(int(sys.argv[sys.argv.index('--blender')+1]))
    else:
        n=int(sys.argv[1])
        if '--measure-only' not in sys.argv:
            log=ROOT/f'.kite3d/hd-compare-{n}.log'
            with log.open('w') as f:
                subprocess.run(['/snap/bin/blender','-b','--python-exit-code','1','-P',str(Path(__file__).resolve()),'--','--blender',str(n)],stdout=f,stderr=subprocess.STDOUT,check=True)
        metrics(n)
