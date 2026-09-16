"""Surgical glTF texture patch with an immutable base-commit contract.
No exporter invocation; BIN, nodes, skins, actions and every other glTF section
remain exact. Run --check to verify the shipping patch without changing it.
"""
import argparse, hashlib, json, re, shutil, subprocess
from pathlib import Path
import numpy as np
from PIL import Image
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
SOURCE=HERE.parent/'source-assets/gun'
ASSET=ROOT/'assets/models/weapons/revolver-rebuild'
OUT=HERE.parent/'generated/texture-paint'
BASE='d76440e427dbc87cdda469077017820429411804'
def sha(b):return hashlib.sha256(b).hexdigest()
def original(p):return subprocess.check_output(['git','show',BASE+':'+str(p.relative_to(ROOT))],cwd=ROOT)
p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
path=ASSET/'revolver-rebuild.gltf';base_text=original(path).decode();before=json.loads(base_text);expected=json.loads(base_text)
# Reuse the former shared AO image/texture slots: same texture count and sampler.
image=next(i for i in expected['images'] if i.get('uri')=='gun-ao.png')
image.update(name='gun-orm',uri='gun-orm.png')
for m in expected['materials']:
    if not m['name'].startswith('Gun |'):continue
    pbr=m['pbrMetallicRoughness']
    pbr['metallicRoughnessTexture']=dict(m['occlusionTexture'])
    pbr['metallicFactor']=1;pbr['roughnessFactor']=1
if not args.check:
    # Replace only the five PBR objects and the AO image name/URI. Preserve even
    # numeric spellings and whitespace everywhere in nodes/skins/animations.
    matches=list(re.finditer(r'"pbrMetallicRoughness"\s*:\s*\{',base_text))[:5]
    patched=base_text
    for i,match in reversed(list(enumerate(matches))):
        start=match.end()-1;end=start+1;depth=1
        while depth:
            depth+=(base_text[end]=='{')-(base_text[end]=='}');end+=1
        block=base_text[start:end]
        block=re.sub(r'"metallicFactor": [^,\n}]+','"metallicFactor": 1',block)
        block=re.sub(r'"roughnessFactor": [^,\n}]+','"roughnessFactor": 1',block)
        index=before['materials'][i]['occlusionTexture']['index']
        block=block.replace('"metallicFactor":',f'"metallicRoughnessTexture": {{\n          "index": {index}\n        }},\n        "metallicFactor":')
        patched=patched[:start]+block+patched[end:]
    patched=patched.replace('"name": "gun-ao"','"name": "gun-orm"').replace('"uri": "gun-ao.png"','"uri": "gun-orm.png"')
    path.write_text(patched)
    for kind in ['basecolor','orm']:shutil.copyfile(SOURCE/f'gun-{kind}.png',ASSET/f'gun-{kind}.png')
    registry_path=ROOT/'assets.json';registry_text=registry_path.read_text()
    entry='"gun-orm.png": "assets/models/weapons/revolver-rebuild/gun-orm.png"'
    if entry not in registry_text:
        old='"gun-ao.png": "assets/models/weapons/revolver-rebuild/gun-ao.png",'
        assert registry_text.count(old)==1
        registry_path.write_text(registry_text.replace(old,old+'\n        '+entry+','))
actual=json.loads(path.read_text());assert actual==expected,'glTF differs beyond the approved image + PBR fields'
def immutable_text(text):
    matches=list(re.finditer(r'"pbrMetallicRoughness"\s*:\s*\{',text))[:5]
    for match in reversed(matches):
        start=match.end()-1;end=start+1;depth=1
        while depth:depth+=(text[end]=='{')-(text[end]=='}');end+=1
        text=text[:start]+'<gun-pbr>'+text[end:]
    return text.replace('"name": "gun-orm"','"name": "gun-ao"').replace('"uri": "gun-orm.png"','"uri": "gun-ao.png"')
assert immutable_text(path.read_text())==immutable_text(base_text),'Protected glTF text bytes changed'
protected={}
for key in before:
    if key in ['images','materials']:continue
    assert actual[key]==before[key],f'Protected glTF section changed: {key}'
    protected[key]=sha(json.dumps(actual[key],sort_keys=True).encode())
for i,m in enumerate(before['materials']):
    if not m['name'].startswith('Gun |'):assert actual['materials'][i]==m
for image in before['images']:
    uri=image['uri']
    if uri=='gun-basecolor.png':continue
    assert (ASSET/uri).read_bytes()==original(ASSET/uri),f'Original image changed: {uri}'
    protected[uri]=sha((ASSET/uri).read_bytes())
for kind in ['normal','ao']:
    path=SOURCE/f'gun-{kind}.png';assert path.read_bytes()==original(path)
path=ASSET/'revolver-rebuild.bin';assert path.read_bytes()==original(path);protected[path.name]=sha(path.read_bytes())
assert (SOURCE/'gun-uv-layout.json').read_bytes()==original(SOURCE/'gun-uv-layout.json')
assert (SOURCE/'paint-layers/original-basecolor.png').read_bytes()==original(SOURCE/'gun-basecolor.png')
assert len(actual['animations'])==9
for i in actual['images']:assert (ASSET/i['uri']).is_file()
registry=json.loads((ROOT/'assets.json').read_text());base_registry=json.loads(original(ROOT/'assets.json'))
files=registry['files']['weapon-revolver-rebuild']['files']
for i in actual['images']:assert files[i['uri']]=='assets/models/weapons/revolver-rebuild/'+i['uri']
del files['gun-orm.png'];assert registry==base_registry,'Unrelated asset registration changed'
for kind in ['basecolor','orm']:assert (SOURCE/f'gun-{kind}.png').read_bytes()==(ASSET/f'gun-{kind}.png').read_bytes()
orm=np.array(Image.open(ASSET/'gun-orm.png'));ao=np.array(Image.open(SOURCE/'gun-ao.png'))
assert orm.shape==(2048,2048,3) and np.array_equal(orm[:,:,0],ao[:,:,0].repeat(2,axis=0).repeat(2,axis=1))
counts={f.stem:int((np.array(Image.open(f))>10).sum()) for f in (SOURCE/'paint-layers').glob('*.png') if f.stem not in ['original-basecolor','material-regions','object-regions']}
assert all(counts[k]>50 for k in ['contact-edge','handling-oil','recess-grime','directional-scratches','arsenal-markings','grip-rub'])
regions=np.array(Image.open(SOURCE/'paint-layers/material-regions.png'))
variation={n:{'p05':float(np.percentile(orm[:,:,1][regions==(i+1)*40]/255,5)), 'p95':float(np.percentile(orm[:,:,1][regions==(i+1)*40]/255,95)),'std':float((orm[:,:,1][regions==(i+1)*40]/255).std())} for i,n in enumerate(['steel','controls','rubber','walnut','brass'])}
assert variation['steel']['std']>.01 and variation['walnut']['std']>.01
# Two 1024 RGBA8 maps become 2048. The source normal and hand maps stay unchanged.
# Extra allocation including the complete mip chain is exactly 32 MiB.
report={'pass':True,'baseCommit':BASE,'protectedTextByteExact':True,'protectedDigests':protected,'animations':[a['name'] for a in actual['animations']],
        'materials':len(actual['materials']),'drawPrimitives':sum(len(m['primitives']) for m in actual['meshes']),
        'referencedImageCountBefore':len(before['images']),'referencedImageCountAfter':len(actual['images']),
        'gpuTextureMemoryDeltaBytes':33554432,'gpuAssumption':'RGBA8 basecolor and ORM: 1024 to 2048, full mip chain. 24 MiB extra base level, 32 MiB including mips. ORM replaces the referenced AO slot; source AO remains 1024 on disk.',
        'aoRedExact2x2Replication':True,'maskTexelsAbove10':counts,'roughnessByMaterial':variation,
        'shippingPngBytesDelta':sum((ASSET/i['uri']).stat().st_size for i in actual['images'])-sum(len(original(ASSET/i['uri'])) for i in before['images'])}
OUT.mkdir(parents=True,exist_ok=True);(OUT/'runtime-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
