import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'

const root = new URL('../../', import.meta.url)
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'))

test('every selected floor resolves to verified local PBR maps at two-meter scale', async () => {
  const [{files}, selection, receipt, registry, scene] = await Promise.all([
    json('assets.json'), json('assets/sources/selected-assets.json'), json('assets/sources/hangar-concrete-floor.json'),
    json('lib/core/data/map-piece-registry.json'), json('assets/main.scene.gltf'),
  ])
  const selected = selection.assets.find(asset => asset.family === 'floor')
  assert.equal(selected.id, 'hangar_concrete_floor')
  assert.equal(selected.targets.length, 14)
  for (const resource of receipt.resources) {
    const bytes = await readFile(new URL(resource.path, root))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.sha256)
    assert.equal(createHash('md5').update(bytes).digest('hex'), resource.md5)
  }
  const paths = new Set(receipt.resources.map(resource => '/kite3d/' + resource.path))
  for (const id of selected.targets) {
    assert.ok(scene.nodes.some(node => node.extras?.rootPath === `/kite3d/@${id}/f.gltf`), `${id} remains authored`)
    const gltf = await json(files[id].path), size = registry.assets[id].size
    assert.ok(gltf.extensionsUsed.includes('KHR_texture_transform'))
    for (const material of gltf.materials) {
      const pbr = material.pbrMetallicRoughness
      assert.equal(pbr.metallicFactor, 0)
      for (const info of [pbr.baseColorTexture, pbr.metallicRoughnessTexture, material.normalTexture, material.occlusionTexture]) {
        assert.ok(paths.has(gltf.images[gltf.textures[info.index].source].uri))
        assert.deepEqual(info.extensions.KHR_texture_transform.scale, [size.x / 2, size.z / 2])
      }
    }
  }
})
