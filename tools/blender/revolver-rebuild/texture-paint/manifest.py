"""Record this texture revision separately from archived animation-video hashes."""
import hashlib, json, subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
OUT=HERE.parent/'generated/texture-paint';ASSET=ROOT/'assets/models/weapons/revolver-rebuild'
BASE='d76440e427dbc87cdda469077017820429411804'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
runtime=json.loads((OUT/'runtime-verification.json').read_text())
source=json.loads((OUT/'source-verification.json').read_text())
export=json.loads((OUT/'export-verification.json').read_text())
assert runtime['pass'] and source['pass'] and not export['failures']
tests=(OUT/'weapon-tests.log').read_text();assert '# pass 47' in tests and '# fail 0' in tests
check=json.loads((OUT/'kite3d-check.json').read_text())
recompose=json.loads((OUT/'recomposition-verification.json').read_text());assert recompose['pass']
blend=HERE.parent/'source/assembled/revolver-rebuild.blend'
base_blend=subprocess.check_output(['git','show',BASE+':'+str(blend.relative_to(ROOT))],cwd=ROOT)
files=[blend,HERE.parent/'gun.py',HERE.parent/'assemble.py',*(HERE.glob('*.py')),HERE/'run.sh',
       *((HERE.parent/'source-assets/gun').glob('*.png')),*((HERE.parent/'source-assets/gun/paint-layers').glob('*.png')),
       ASSET/'revolver-rebuild.gltf',ASSET/'revolver-rebuild.bin',*(ASSET.glob('*.png'))]
captures={str(p.relative_to(OUT)):sha(p) for stage in ['before','after'] for p in (OUT/stage).glob('*.png')}
manifest={'schema':'revolver-texture-finish/v1','baseCommit':BASE,
 'technique':'Deterministic mesh-aware UV paint with editable masks; not manual brush painting.',
 'sourceBlend':str(blend.relative_to(ROOT)),'sourceBlendSha256':sha(blend),'baseSourceBlendSha256':hashlib.sha256(base_blend).hexdigest(),
 'maps':{'basecolor':{'resolution':[2048,2048],'colorSpace':'sRGB'},'orm':{'resolution':[2048,2048],'colorSpace':'Non-Color','channels':{'R':'Original 1024 AO, exact nearest 2x2 replication','G':'Absolute roughness','B':'Absolute metallic'}},'normal':{'resolution':[1024,1024],'unchanged':True}},
 'runtimeValidation':runtime,'sourceValidation':{'pass':True,'protectedFingerprintSha256':hashlib.sha256(json.dumps(source['fingerprints'],sort_keys=True).encode()).hexdigest(),'meshDatablocks':len(source['fingerprints']['meshes']),'actionDatablocks':len(source['fingerprints']['actions']),'materialPackedPixelsAndLinks':source['materials']},
 'tests':{'weaponRegressionPassed':47,'weaponRegressionFailed':0,'exportFailures':export['failures'],'exportWarnings':export['warnings'],'triangles':export['triangles'],'materials':export['materials'],'weightedVertices':export['weightedVertices'],'deterministicRecomposition':recompose,'kite3dCheck':check,'doctorLimit':'Remote runtime registry HTTP 404; all local doctor rows passed.'},
 'fileSha256':{str(p.relative_to(ROOT)):sha(p) for p in sorted(set(files))},
 'evidence':{'gallery':'tools/blender/revolver-rebuild/generated/texture-paint/index.html','captureSha256':captures,'lightingCameraExposureEqual':json.loads((OUT/'before/capture-all.json').read_text())==json.loads((OUT/'after/capture-all.json').read_text()),'renderer':'Blender Eevee; full assembled source, hands hidden only in gun closeups','archivedAnimationVideos':'unchanged; depict previous source finish'},
 'limits':['Fine lettering and wear resolve in closeups; normal player framing emphasizes the overall finish.','Inherited uneven UV density and original normal bake retained. No scratch/marking normal relief added.','Eevee evidence is not gameplay capture. Parent performs final integration review.']}
(ASSET/'texture-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Texture manifest:',ASSET/'texture-manifest.json')
