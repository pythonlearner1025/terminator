import test from 'node:test'
import assert from 'node:assert/strict'
import {access, readFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {NodeIO} from '@gltf-transform/core'
import {createHash} from 'node:crypto'
globalThis.ImageData ??= class {}
const {Box3, Vector3, Matrix4} = await import('three')
const root = resolve(new URL('../..', import.meta.url).pathname)
const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'))

test('selected props resolve locally and fit the preserved authored collider extents', async () => {
  const [selected, {files}, registry] = await Promise.all([json('assets/sources/selected-assets.json'), json('assets.json'), json('lib/core/data/map-piece-registry.json')])
  let count = 0
  for (const asset of selected.assets.filter(a => a.integration === 'model')) {
    const receipt = await json(dirname(asset.preparedModel) + '/import.json')
    for (const [name, hash] of Object.entries(receipt.resources)) {
      assert.equal(createHash('sha256').update(await readFile(resolve(root, dirname(asset.preparedModel), name))).digest('hex'), hash)
    }
    for (const id of asset.targets) {
      count++
      const path = files[id].path
      const gltf = await json(path)
      const local = uri => uri.startsWith('/kite3d/') ? resolve(root, uri.slice('/kite3d/'.length)) : resolve(root, dirname(path), uri)
      for (const image of gltf.images || []) await access(local(image.uri))
      const source = gltf.nodes.find(node => node.extras?.selectedSource)
      assert.equal(source.extras.selectedSource.id, asset.id)
      assert.ok(gltf.nodes.some(node => node.name.startsWith(`Selected ${asset.family} `)))
      const resources = {}
      for (const buffer of gltf.buffers) resources[buffer.uri] = new Uint8Array(await readFile(local(buffer.uri)))
      delete gltf.extensions; delete gltf.extensionsUsed; delete gltf.extensionsRequired
      delete gltf.images; delete gltf.textures; delete gltf.materials
      for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) delete primitive.material
      const doc = await new NodeIO().readJSON({json: gltf, resources})
      const box = new Box3(), point = new Vector3()
      for (const node of doc.getRoot().listNodes()) {
        if (!node.getMesh()) continue
        const matrix = new Matrix4().fromArray(node.getWorldMatrix())
        for (const primitive of node.getMesh().listPrimitives()) {
          const positions = primitive.getAttribute('POSITION').getArray()
          for (let i = 0; i < positions.length; i += 3) box.expandByPoint(point.fromArray(positions, i).applyMatrix4(matrix))
        }
      }
      const size = box.getSize(new Vector3()), center = box.getCenter(new Vector3()), expected = registry.assets[id].size
      for (const axis of ['x', 'y', 'z']) {
        assert.ok(Math.abs(size[axis] - expected[axis]) < .001, `${id} ${axis}: ${size[axis]} vs ${expected[axis]}`)
        assert.ok(Math.abs(center[axis]) < .001, `${id} ${axis} center: ${center[axis]}`)
      }
    }
  }
  assert.equal(count, 13)
})
