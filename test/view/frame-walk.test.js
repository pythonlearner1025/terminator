import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {holdStill, sleepSubtrees} = await import('../../lib/view/hidden-subtrees.js')
const {RagdollSystem, WRECK_BUDGET, WRECK_SECONDS} = await import('../../lib/view/ragdoll.js')
const {defaultMap: map} = await import('../../lib/core/map.js')

// Count the nodes three.js visits, exactly as Object3D.updateMatrixWorld does:
// a node is entered when its parent is dirty or when it asked to be updated.
function countWalk(root) {
  let visited = 0
  const walk = (object, force) => {
    visited += 1
    const dirty = Boolean(object.matrixAutoUpdate) || object.matrixWorldNeedsUpdate || force
    for (const child of object.children) {
      if (child.matrixWorldAutoUpdate === true || dirty) walk(child, dirty)
    }
  }
  walk(root, false)
  return visited
}

function fixture() {
  const scene = new E.Scene()
  const modelRoot = new E.Group(); modelRoot.name = 'Scene'; scene.add(modelRoot)
  const authored = new E.Group(); authored.name = 'Map'; modelRoot.add(authored)
  for (let piece = 0; piece < 6; piece += 1) {
    const placement = new E.Group(); placement.name = `piece ${piece}`; authored.add(placement)
    for (let part = 0; part < 4; part += 1) placement.add(new E.Object3D())
  }
  const runtime = new E.Group(); runtime.name = 'Map Runtime'; scene.add(runtime)
  const mover = new E.Object3D(); mover.name = 'gate'; runtime.add(mover)
  return {scene, modelRoot, authored, runtime, mover}
}

test('a hidden authored subtree stops costing a world-matrix walk, and wakes correct', () => {
  const {scene, modelRoot, authored, runtime, mover} = fixture()
  const before = countWalk(scene)
  assert.equal(before, 35, 'every node is walked while nothing is held still')

  const release = holdStill([scene, modelRoot, runtime])
  const wake = sleepSubtrees([authored])
  const after = countWalk(scene)
  assert.equal(after, before - 31, 'the authored map and its placements are skipped')
  assert.equal(countWalk(runtime), 2, 'the runtime root still reaches what moves')

  // The renderer's walk must still place the runtime content.
  runtime.position.set(3, 0, 0)
  runtime.updateMatrix()
  mover.position.set(0, 0, 4)
  scene.updateMatrixWorld()
  assert.deepEqual(mover.matrixWorld.elements.slice(12, 15), [3, 0, 4])

  // Stop hands every node back, and the next frame places the woken subtree.
  modelRoot.position.set(0, 5, 0)
  wake()
  release()
  assert.equal(countWalk(scene), before, 'stop hands every node back')
  scene.updateMatrixWorld()
  assert.deepEqual(authored.children[0].children[0].matrixWorld.elements.slice(12, 15), [0, 5, 0])
})

test('holding a node still leaves its world matrix settled, not dirty', () => {
  const parent = new E.Group(), child = new E.Object3D()
  parent.add(child)
  child.matrixWorldAutoUpdate = false
  parent.position.set(1, 2, 3)
  holdStill([parent])
  assert.deepEqual(parent.matrixWorld.elements.slice(12, 15), [1, 2, 3], 'the held node keeps its own transform')
  assert.equal(parent.matrixWorldNeedsUpdate, false, 'a node left dirty would force its subtree every frame')
  assert.equal(countWalk(parent), 1, 'the sleeping child stays out of the walk')
})

test('holdStill only releases what it took, and never fights an already still node', () => {
  const node = new E.Object3D()
  node.matrixAutoUpdate = false
  const release = holdStill([node, null, undefined])
  release()
  assert.equal(node.matrixAutoUpdate, false, 'a node that was already still stays still')
})

const fixtureRig = (pos = {x: 0, y: 0, z: 0}) => {
  const object = new E.Group()
  object.position.copy(pos)
  const joints = {}, contacts = []
  const bone = (name, parent, x, y, z, size) => {
    const b = new E.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); joints[name] = b
    const [w, h, d] = size
    contacts.push({bone: b, corners: Array.from({length: 8}, (_, i) => new E.Vector3((i & 1 ? 1 : -1) * w / 2, (i & 2 ? 0 : -h), (i & 4 ? 1 : -1) * d / 2))})
    return b
  }
  const pelvis = bone('Pelvis', object, 0, 1, 0, [.3, .15, .2]), chest = bone('Chest', pelvis, 0, .4, 0, [.5, .3, .24])
  bone('Head', chest, 0, .4, 0, [.25, .24, .24])
  const mesh = new E.Mesh(new E.BoxGeometry(), new E.MeshStandardMaterial())
  object.add(mesh); object.updateMatrixWorld(true)
  return {object, rig: {joints, contacts, mesh, actuators: [], severed: new Set(), states: new Set()}}
}

test('a settled wreck sleeps, still fades, and wakes when its rig is reused', () => {
  const system = new RagdollSystem(map)
  const visual = fixtureRig()
  const record = system.add(visual, {type: 'scout', pos: {x: 0, y: 0, z: 0}, vel: {x: 0, y: 0, z: 0}}, null, () => {})
  assert.equal(visual.object.matrixWorldAutoUpdate, true, 'an active ragdoll still moves every frame')
  system.freeze(record)
  assert.equal(visual.object.matrixWorldAutoUpdate, false, 'a settled wreck stops being walked')

  // The sink and fade still move it, because that path forces the update.
  const sunk = record.object.position.y
  system.clock = record.settledAt + WRECK_SECONDS + 1
  system.update(0)
  assert.ok(record.object.position.y < sunk, 'the wreck still sinks while it fades')
  assert.deepEqual(record.object.matrixWorld.elements[13], record.object.position.y)

  system.release(record)
  assert.equal(visual.object.matrixWorldAutoUpdate, true, 'release hands the rig back awake')
  system.dispose()
})

test('the wreck budget fades the oldest corpses instead of holding every one for three minutes', () => {
  const system = new RagdollSystem(map)
  const visuals = []
  for (let index = 0; index < WRECK_BUDGET + 5; index += 1) {
    const visual = fixtureRig({x: index * 2, y: 0, z: 0})
    visuals.push(visual)
    system.add(visual, {type: 'scout', pos: {x: index * 2, y: 0, z: 0}, vel: {x: 0, y: 0, z: 0}}, null, () => {})
    system.clock += 1
  }
  const fading = [...system.records].filter(record => system.expiring(record))
  assert.equal(fading.length, 5, 'exactly the overflow is retired, once each')
  assert.equal(system.records.size, WRECK_BUDGET + 5, 'nothing vanishes in the same frame')
  // The retired ones are the oldest, and their normal fade releases them.
  assert.equal(fading[0].object, visuals[0].object)
  system.update(1 / 60)
  system.clock += 3
  system.update(1 / 60)
  assert.equal(system.records.size, WRECK_BUDGET, 'the budget holds after the fade completes')
  system.dispose()
})
