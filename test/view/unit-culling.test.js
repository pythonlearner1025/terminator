import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.ImageData ??= class {}
globalThis.window ??= {}
const {Mesh, Sphere, Vector3} = await import('threepipe')
const {setUnitCullBounds} = await import('../../lib/view/units.js')

test('unit culling replaces copied placed-source bounds with conservative local bounds', () => {
  const mesh = new Mesh()
  mesh.boundingSphere = new Sphere(new Vector3(22, 1, 22), 1.1)
  mesh.frustumCulled = false

  const bounds = setUnitCullBounds(mesh, 'endo')

  assert.equal(mesh.boundingSphere, bounds)
  assert.deepEqual(bounds.center.toArray(), [0, 2, 0])
  assert.equal(bounds.radius, 2.5)
  assert.equal(mesh.frustumCulled, true)
})

test('large unit culling bounds cover aerial and tank figures', () => {
  const aerial = setUnitCullBounds(new Mesh(), 'hkaerial')
  const tank = setUnitCullBounds(new Mesh(), 'hktank')
  assert.deepEqual({center: aerial.center.toArray(), radius: aerial.radius}, {center: [0, 2, 0], radius: 4})
  assert.deepEqual({center: tank.center.toArray(), radius: tank.radius}, {center: [0, 1.5, 0], radius: 6})
})
