import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {batchPlacedMap} = await import('../../lib/view/map-batching.js')
const {BulletBatch} = await import('../../lib/view/bullet-batch.js')
const {FxPool} = await import('../../lib/view/fx-pool.js')
const {CachesView} = await import('../../lib/view/caches.js')
const {ExtractionView} = await import('../../lib/view/extraction.js')
const {mountV2Ground} = await import('../../lib/view/v2/ground.js')
const {defaultMap} = await import('../../lib/core/map.js')
const {releaseSubtree} = await import('../../lib/view/mesh-release.js')

// threepipe subscribes a mesh to its own geometry: `iObjectCommons.setGeometry`
// stores `mesh._onGeometryUpdate` in `geometry._listeners.geometryUpdate`, and
// removes it only when that same mesh is later given a different geometry. A
// view that just removes its meshes leaves every one of them reachable from the
// geometries that outlive it — shared authored geometry, pooled geometry, or
// geometry another live mesh still draws. `removeFromParent()` does not help:
// it clears the Object3DManager bookkeeping and nothing else.
//
// Each test below drives a real view teardown and then asserts, for every mesh
// the view dropped, that its own listener is gone from every geometry in the
// scene and that no geometry still lists it in `appliedMeshes`.
function harness() {
  const manager = new E.Object3DManager()
  const scene = new E.Group()
  scene.name = 'RootScene'
  manager.setRoot(scene)
  const viewer = {
    scene,
    setDirty() {},
    addEventListener() {},
    removeEventListener() {},
    import: () => Promise.resolve(null),
  }
  return {
    manager, scene, viewer,
    // The viewer registers every object under its root; do the same, and keep
    // the meshes and geometries so they can be checked after the view drops them.
    snapshot(owned) {
      const geometries = new Set()
      scene.traverse(object => {
        manager.registerObject(object)
        if (object.geometry) geometries.add(object.geometry)
      })
      const dropped = []
      owned.traverse(object => {
        if (object.geometry) dropped.push(object)
      })
      assert.ok(geometries.size > 0, 'harness saw no geometry')
      assert.ok(dropped.length > 0, 'harness saw no owned mesh')
      for (const mesh of dropped) {
        assert.equal(typeof mesh._onGeometryUpdate, 'function', `${mesh.name}: threepipe did not subscribe this mesh`)
        assert.ok(mesh.geometry._listeners.geometryUpdate.includes(mesh._onGeometryUpdate), `${mesh.name}: not subscribed before teardown`)
      }
      return {geometries, dropped}
    },
  }
}

function assertReleased({geometries, dropped}, label) {
  for (const mesh of dropped) {
    for (const geometry of geometries) {
      const listeners = geometry._listeners?.geometryUpdate || []
      assert.ok(!listeners.includes(mesh._onGeometryUpdate),
        `${label}: dropped mesh "${mesh.name}" still listens to a ${geometry.type}`)
      assert.ok(!geometry.appliedMeshes?.has(mesh),
        `${label}: dropped mesh "${mesh.name}" is still in appliedMeshes of a ${geometry.type}`)
    }
  }
}

test('static map batches and dynamic clones leave no geometry subscriptions behind', () => {
  const {scene, snapshot} = harness()
  const source = new E.Group()
  source.name = 'Map'
  const runtime = new E.Group()
  runtime.name = 'Map Runtime'
  scene.add(source, runtime)
  const material = new E.PhysicalMaterial({name: 'slab', color: 0x334455})
  for (let index = 0; index < 4; index++) {
    const placement = new E.Group()
    placement.name = `placement ${index}`
    placement.position.set(index * 3, 0, 0)
    placement.userData.mapPiece = {id: `piece-${index}`, assetId: 'box', role: index === 3 ? 'door' : 'collider'}
    const mesh = new E.Mesh2(new E.BoxGeometry(1, 2, 3), material)
    mesh.name = `placement mesh ${index}`
    placement.add(mesh)
    source.add(placement)
  }
  const batching = batchPlacedMap(E, source, runtime)
  assert.ok(batching.batches.length > 0 && batching.dynamic.length > 0)
  const taken = snapshot(runtime)
  // lib/view/map.js stop(): dispose the batching, release the runtime subtree,
  // then drop the runtime root.
  batching.dispose()
  for (const mesh of batching.batches) {
    assert.ok(!mesh.geometry, `batching.dispose left geometry on "${mesh.name}"`)
  }
  releaseSubtree(runtime)
  runtime.removeFromParent()
  assertReleased(taken, 'map batching')
  // The authored placements keep their own geometry, so they stay subscribed.
  const authored = source.children[0].children[0]
  assert.ok(authored.geometry._listeners.geometryUpdate.includes(authored._onGeometryUpdate))
  material.dispose()
})

test('bullet batch teardown leaves no geometry subscriptions behind', () => {
  const {scene, snapshot} = harness()
  const root = new E.Group()
  root.name = 'Bullets Runtime'
  scene.add(root)
  const batch = new BulletBatch(root, 8, {material: new E.PhysicalMaterial({name: 'jacket'})})
  const taken = snapshot(root)
  batch.dispose()
  root.removeFromParent()
  assertReleased(taken, 'bullet batch')
})

test('effect pool teardown leaves no geometry subscriptions behind', () => {
  const {scene, snapshot} = harness()
  const root = new E.Group()
  root.name = 'Fx Runtime'
  scene.add(root)
  const pools = [
    new FxPool(root, 'sparks', new E.BoxGeometry(1, 1, 1), new E.MeshBasicMaterial(), 16, {gravity: 6}),
    new FxPool(root, 'plasma', new E.SphereGeometry(1, 6, 4), new E.MeshBasicMaterial(), 8, {}),
  ]
  const taken = snapshot(root)
  for (const pool of pools) pool.dispose()
  root.removeFromParent()
  assertReleased(taken, 'fx pool')
})

test('cache and extraction views leave no geometry subscriptions behind', () => {
  for (const [label, View, world] of [
    ['caches', CachesView, {tick: 60, eventLog: [], pickups: {active: [{id: 'c1', pos: {x: 1, y: 0, z: 2}}]}, player: {pos: {x: 0, y: 0, z: 0}}}],
    ['extraction', ExtractionView, {tick: 60, map: {extraction: {pos: {x: 0, y: 0, z: 0}}}, extraction: {phase: 'announced'}}],
  ]) {
    const {viewer, snapshot} = harness()
    const view = new View(viewer)
    view.start(world)
    const taken = snapshot(view.root)
    view.stop()
    assertReleased(taken, label)
  }
})

test('v2 ground teardown leaves no geometry subscriptions behind', async () => {
  const {scene, viewer, snapshot} = harness()
  const root = new E.Group()
  root.name = 'Map Runtime'
  scene.add(root)
  const handle = mountV2Ground({viewer, root, map: structuredClone(defaultMap)})
  await handle.ready
  const taken = snapshot(handle.root)
  handle.dispose()
  root.removeFromParent()
  assertReleased(taken, 'v2 ground')
})
