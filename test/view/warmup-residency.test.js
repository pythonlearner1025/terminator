import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {CachesView} = await import('../../lib/view/caches.js')
const {keepRigsResident} = await import('../../lib/view/weapons.js')

// threepipe's Object3DManager unregisters a material as soon as the last object
// holding it leaves the scene graph, and unregistering disposes it
// (`autoDisposeMaterials`). Disposing releases every program three linked for
// it. So a material the match warmup compiled only stays compiled while some
// object still carries it. Take the object out and the next draw links the
// shaders again, inside the frame, for 9 to 154 ms.
//
// The rule these tests hold: what the warmup compiled stays in the scene. It
// hides; it does not leave.

test('the supply cache view keeps its warmed crate and burst in the scene, hidden', () => {
  const scene = new E.Group()
  const viewer = {scene, setDirty() {}, addEventListener() {}, removeEventListener() {}}
  const view = new CachesView(viewer)
  view.start({tick: 60, eventLog: [], pickups: {active: []}, player: {pos: {x: 0, y: 0, z: 0}}})

  const release = view.primeWarmup()
  assert.equal(typeof release, 'function')
  assert.equal(view.warmupCrate.parent, view.root, 'the warmup crate must be in the view')
  assert.equal(view.warmupCrate.visible, true, 'the warmup must be able to draw it')
  assert.equal(view.warmupBurst.visible, true)
  assert.equal(view.warmupBurst.material, view.burstMaterial, 'the same material a real burst clones')
  let crateMaterials = 0
  view.warmupCrate.traverse(object => { if (object.material === view.material) crateMaterials += 1 })
  assert.equal(crateMaterials, 2, 'body and lid carry the crate material')

  release()
  assert.equal(view.warmupCrate.parent, view.root, 'the crate stays after the warmup')
  assert.equal(view.warmupBurst.parent, view.root, 'the burst stays after the warmup')
  assert.equal(view.warmupCrate.visible, false, 'but the player never sees it')
  assert.equal(view.warmupBurst.visible, false)

  // A second call must not stack a second crate on the scene.
  assert.equal(view.primeWarmup(), null)
  view.stop()
})

test('a warmed crate is not a live crate: the view neither animates nor lights it', () => {
  const scene = new E.Group()
  const viewer = {scene, setDirty() {}, addEventListener() {}, removeEventListener() {}}
  const view = new CachesView(viewer)
  const world = {tick: 60, eventLog: [], pickups: {active: []}, player: {pos: {x: 0, y: 0, z: 0}}}
  view.start(world)
  view.primeWarmup()()
  world.tick = 300
  view.sync(world)
  assert.equal(view.crates.size, 0, 'the warmup crate is not a pickup')
  assert.equal(view.glow.intensity, 0, 'and it does not light the ground')
  assert.equal(view.warmupCrate.visible, false)
  view.stop()
})

test('every weapon rig stays in the view and only the shown one stays visible', () => {
  const feel = new E.Group()
  const rigs = Object.fromEntries(['pistol', 'm4', 'shotgun', 'knife'].map(id => {
    const root = new E.Group()
    root.name = `${id} viewmodel`
    feel.add(root)
    return [id, {id, root}]
  }))

  // WeaponAnimation shows the current rig. This call only keeps them all in the
  // view and hides the rest, so a shown rig's visibility is left alone.
  for (const rig of Object.values(rigs)) rig.root.visible = true
  keepRigsResident(rigs, feel, 'm4')
  for (const rig of Object.values(rigs)) {
    assert.equal(rig.root.parent, feel, `${rig.id} left the view`)
    assert.equal(rig.root.visible, rig.id === 'm4', `${rig.id} has the wrong visibility`)
  }

  // Switching weapons must not take the old rig out of the scene.
  rigs.pistol.root.visible = true
  keepRigsResident(rigs, feel, 'pistol')
  for (const rig of Object.values(rigs)) {
    assert.equal(rig.root.parent, feel, `${rig.id} left the view on a weapon switch`)
    assert.equal(rig.root.visible, rig.id === 'pistol', `${rig.id} has the wrong visibility`)
  }

  // A rig taken out elsewhere is put back.
  rigs.m4.root.removeFromParent()
  keepRigsResident(rigs, feel, 'pistol')
  assert.equal(rigs.m4.root.parent, feel)
})
