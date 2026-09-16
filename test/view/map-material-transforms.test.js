import test from 'node:test'
import assert from 'node:assert/strict'
import {batchPlacedMap} from '../../lib/view/map-batching.js'

globalThis.ImageData ??= class {}
const THREE = await import('three')
const {mergeGeometries} = await import('three/addons/utils/BufferGeometryUtils.js')
const api = {...THREE, Mesh2: THREE.Mesh, mergeGeometries}

function fixture(repeats) {
  const scene = new THREE.Scene(), source = new THREE.Group(), runtime = new THREE.Group()
  scene.add(source, runtime)
  for (const [index, repeat] of repeats.entries()) {
    const texture = new THREE.Texture()
    texture.name = 'hangar_concrete_floor_diff_1k.jpg'
    texture.repeat.set(...repeat)
    const material = new THREE.MeshStandardMaterial({map: texture})
    material.name = 'Map concrete'
    const placement = new THREE.Group()
    placement.name = `Floor ${index}`
    placement.userData.mapPiece = {assetId: `floor-${index}`, role: 'collider'}
    placement.add(new THREE.Mesh(new THREE.BoxGeometry(1, .2, 1), material))
    source.add(placement)
  }
  return {source, runtime}
}

test('floor materials retain distinct texture repeats when entering Play', () => {
  const {source, runtime} = fixture([[5, 10], [30, 30]])
  const batching = batchPlacedMap(api, source, runtime)
  assert.equal(batching.batches.length, 2)
  assert.deepEqual(batching.batches.map(mesh => mesh.material.map.repeat.toArray()), [[5, 10], [30, 30]])
  assert.equal(batching.sharedMaterials.disposedMaterials, 0)
  batching.restore()
  assert.ok(source.children.every(node => node.visible))
})

test('floor materials with matching transforms still share one static batch', () => {
  const {source, runtime} = fixture([[5, 10], [5, 10]])
  const authored = source.children.map(placement => placement.children[0].material)
  const batching = batchPlacedMap(api, source, runtime)
  assert.equal(batching.batches.length, 1)
  assert.equal(batching.sharedMaterials.disposedMaterials, 0)
  assert.deepEqual(source.children.map(placement => placement.children[0].material), authored)
})

test('imported vertex colors and additional UV channels survive static batching', () => {
  const {source, runtime} = fixture([[1, 1], [1, 1]])
  for (const placement of source.children) {
    const mesh = placement.children[0], count = mesh.geometry.attributes.position.count
    mesh.material.vertexColors = true
    mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({length: count}, () => [.25, .5, .75]).flat(), 3))
    mesh.geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(new Float32Array(count * 2).fill(.3), 2))
    mesh.geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(new Float32Array(count * 2).fill(.7), 2))
  }
  const {batches} = batchPlacedMap(api, source, runtime)
  assert.equal(batches.length, 1)
  const geometry = batches[0].geometry
  assert.deepEqual([...geometry.attributes.color.array.slice(0, 4)], [.25, .5, .75, 1])
  assert.ok(Math.abs(geometry.attributes.uv1.getX(0) - .3) < .00001)
  assert.ok(Math.abs(geometry.attributes.uv2.getX(0) - .7) < .00001)
})
