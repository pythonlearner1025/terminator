"""Prepare downloaded prop variants and resize their textures for local game assets.
Requires Pillow, as do the project's existing texture build tools.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CHOICES = {
    'rubble': None, 'truck': None, 'container': None, 'supply': None,
    'generator': None, 'spool': None,
    'barrel': ['Cylinder_Material.010_0'],
    'sandbags': ['model_lod0_Material #38_0'],
}


def texture_infos(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key.endswith('Texture') and isinstance(child, dict) and 'index' in child:
                yield child
            else:
                yield from texture_infos(child)
    elif isinstance(value, list):
        for child in value:
            yield from texture_infos(child)


def main():
    selection = json.loads((ROOT / 'assets/sources/selected-assets.json').read_text())
    for asset in selection['assets']:
        if asset['family'] not in CHOICES:
            continue
        cache = ROOT / '.kite3d/selected-downloads'
        archive = cache / (asset['id'] + '.zip')
        if not archive.exists():
            print('Pending download:', asset['name'])
            continue
        receipt = json.loads(archive.with_suffix('.json').read_text())
        data = archive.read_bytes()
        assert receipt['id'] == asset['id'] and receipt['bytes'] == len(data)
        assert receipt['sha256'] == hashlib.sha256(data).hexdigest(), 'Archive checksum mismatch'
        out = ROOT / 'assets/models/selected' / asset['id']
        out.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            g = json.loads(z.read('scene.gltf'))
            assert not g.get('skins'), 'Skinned models need a separate rig adapter'
            # These are static map props; omit source showcase/turntable clips.
            g.pop('animations', None)
            chosen = CHOICES[asset['family']]
            used_meshes = {n['mesh'] for n in g['nodes'] if 'mesh' in n and (chosen is None or n.get('name') in chosen)}
            assert used_meshes, 'Selected variant not found'
            if chosen:
                assert {n.get('name') for n in g['nodes'] if n.get('mesh') in used_meshes} == set(chosen)
            mesh_indices = {old: new for new, old in enumerate(sorted(used_meshes))}
            g['meshes'] = [g['meshes'][old] for old in sorted(used_meshes)]
            for n in g['nodes']:
                if 'mesh' in n:
                    if n['mesh'] in mesh_indices:
                        n['mesh'] = mesh_indices[n['mesh']]
                    else:
                        del n['mesh']
                n.pop('camera', None)
            g.pop('cameras', None)
            used_materials = sorted({p['material'] for m in g['meshes'] for p in m['primitives']})
            mat_indices = {old: new for new, old in enumerate(used_materials)}
            g['materials'] = [g['materials'][old] for old in used_materials]
            for m in g['meshes']:
                for p in m['primitives']:
                    p['material'] = mat_indices[p['material']]
            for i, m in enumerate(g['materials']):
                m['name'] = f"Selected {asset['family']} {i + 1}: {m.get('name', 'surface')}"
            infos = list(texture_infos(g['materials']))
            used_textures = sorted({info['index'] for info in infos})
            tex_indices = {old: new for new, old in enumerate(used_textures)}
            g['textures'] = [g['textures'][old] for old in used_textures]
            for info in infos:
                info['index'] = tex_indices[info['index']]
            used_images = sorted({t['source'] for t in g['textures']})
            image_indices = {old: new for new, old in enumerate(used_images)}
            g['images'] = [g['images'][old] for old in used_images]
            for t in g['textures']:
                t['source'] = image_indices[t['source']]
            resources = []
            for image in g['images']:
                original = image['uri']
                name = Path(original).name
                with Image.open(io.BytesIO(z.read(original))) as source:
                    source.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                    if name.lower().endswith(('.jpg', '.jpeg')):
                        source.convert('RGB').save(out / name, quality=92)
                    else:
                        source.save(out / name)
                image['uri'] = f"/kite3d/assets/models/selected/{asset['id']}/{name}"
                resources.append(name)
            for buffer in g['buffers']:
                name = Path(buffer['uri']).name
                (out / name).write_bytes(z.read(buffer['uri']))
                buffer['uri'] = f"/kite3d/assets/models/selected/{asset['id']}/{name}"
                resources.append(name)
            license_text = z.read('license.txt').decode('utf8')
            (out / 'LICENSE.txt').write_text(license_text)
            author = re.search(r'^\* author:\s*(.+)', license_text, re.M).group(1)
            source_url = re.search(r'^\* source:\s*(.+)', license_text, re.M).group(1)
            license_id = re.search(r'^\* license type:\s*(\S+)', license_text, re.M).group(1)
            assert license_id == 'CC-BY-4.0', 'Review other license terms before integration'
            asset['author'] = author
            asset['url'] = source_url
            asset['license'] = license_id
            asset['preparedModel'] = str((out / 'scene.gltf').relative_to(ROOT))
            asset['integration'] = 'prepared-model'
            g['asset']['copyright'] = f"{asset['name']} by {author}; {license_id}; {source_url}"
            (out / 'scene.gltf').write_text(json.dumps(g, indent=2) + '\n')
            evidence = {'id': asset['id'], 'archiveSha256': receipt['sha256'], 'chosenNodes': chosen,
                        'changes': 'Selected static variant; showcase animations omitted; textures resized to at most 1024 pixels. Scene instances fitted to existing prop bounds.',
                        'resources': {n: hashlib.sha256((out / n).read_bytes()).hexdigest() for n in resources}}
            (out / 'import.json').write_text(json.dumps(evidence, indent=2) + '\n')
            print('Prepared', asset['family'], '-', len(g['meshes']), 'meshes,', len(g['images']), 'textures')
    (ROOT / 'assets/sources/selected-assets.json').write_text(json.dumps(selection, indent=2) + '\n')


if __name__ == '__main__':
    main()
