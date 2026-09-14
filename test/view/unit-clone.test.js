import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {cloneSkinnedFigure} = await import('../../lib/view/unit-assets.js')

function fixture() {
  const root = new E.Group()
  root.name = 'Loader renamed figure'
  const first = new E.Bone(), second = new E.Bone()
  first.name = 'Pelvis 1'; first.userData.name = 'Pelvis'
  second.name = 'Pelvis 2'; second.userData.name = 'Pelvis'
  first.position.x = 2; second.position.y = 3
  root.add(first, second)
  const mesh = new E.SkinnedMesh(new E.BufferGeometry(), new E.MeshBasicMaterial())
  root.add(mesh); root.updateMatrixWorld(true)
  mesh.bind(new E.Skeleton([second, first]))
  return {root, first, second, mesh}
}

test('suffixed and duplicate authored bone names bind by object correspondence in original skin order', () => {
  const {root, first, second, mesh} = fixture()
  const cloned = cloneSkinnedFigure(root), [a, b, skin] = cloned.children
  assert.equal(a.name, 'Pelvis'); assert.equal(b.name, 'Pelvis')
  assert.deepEqual(skin.skeleton.bones, [b, a])
  assert.notEqual(skin.skeleton, mesh.skeleton)
  for (let i = 0; i < 2; i++) {
    assert.notEqual(skin.skeleton.boneInverses[i], mesh.skeleton.boneInverses[i])
    assert.deepEqual(skin.skeleton.boneInverses[i].elements, mesh.skeleton.boneInverses[i].elements)
  }
  assert.deepEqual(skin.bindMatrix.elements, mesh.bindMatrix.elements)
  a.position.x = 9; cloned.updateMatrixWorld(true)
  assert.equal(first.position.x, 2); assert.equal(second.position.y, 3)
  assert.equal(first.name, 'Pelvis 1'); assert.equal(second.name, 'Pelvis 2')
  assert.deepEqual(mesh.skeleton.bones, [second, first])
  const again = cloneSkinnedFigure(cloned)
  assert.deepEqual(again.children[2].skeleton.bones, [again.children[1], again.children[0]])
})

test('a skeleton bone outside the cloned hierarchy still fails instead of silently omitting a joint', () => {
  const {root, mesh} = fixture()
  const outside = new E.Bone(); outside.name = 'External joint'
  mesh.skeleton.bones[0] = outside
  assert.throws(() => cloneSkinnedFigure(root), /missing cloned bone External joint/)
})

test('nested-import skeleton references resolve by a unique persistent bone identity', () => {
  const {root, first, second, mesh} = fixture()
  first.userData.gltfUUID = 'first-joint'; second.userData.gltfUUID = 'second-joint'
  const externalFirst = first.clone(), externalSecond = second.clone()
  mesh.skeleton.bones = [externalSecond, externalFirst]
  const clone = cloneSkinnedFigure(root)
  assert.deepEqual(clone.children[2].skeleton.bones, [clone.children[1], clone.children[0]])
  assert.deepEqual(mesh.skeleton.bones, [externalSecond, externalFirst])
})

test('nested-import bones without persistent IDs require an unambiguous authored name', () => {
  const {root, first, second, mesh} = fixture()
  first.userData.name = 'Pelvis'; second.userData.name = 'Chest'
  mesh.skeleton.bones = [second.clone(), first.clone()]
  const clone = cloneSkinnedFigure(root)
  assert.deepEqual(clone.children[2].skeleton.bones, [clone.children[1], clone.children[0]])
  second.userData.name = 'Pelvis'
  mesh.skeleton.bones = [second.clone(), first.clone()]
  assert.throws(() => cloneSkinnedFigure(root), /missing cloned bone/)
})

test('duplicate persistent bone IDs are rejected even when names could disambiguate them', () => {
  const {root, first, second, mesh} = fixture()
  first.userData.name = 'Pelvis'; second.userData.name = 'Chest'
  first.userData.gltfUUID = second.userData.gltfUUID = 'duplicate'
  mesh.skeleton.bones = [second.clone(), first.clone()]
  assert.throws(() => cloneSkinnedFigure(root), /missing cloned bone/)
})
