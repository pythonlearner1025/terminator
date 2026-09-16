import test from 'node:test'
import assert from 'node:assert/strict'
import {loadWeaponFixture} from './weapon-assets-fixture.mjs'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
globalThis.WebGLRenderingContext ??= class {}
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0)
globalThis.cancelAnimationFrame = clearTimeout
const E = await import('threepipe')
const {CachesView} = await import('../../lib/view/caches.js')
const {keepRigsResident, WeaponView} = await import('../../lib/view/weapons.js')
const {instantiateWeaponRigs} = await import('../../lib/view/weapon-assets.js')
const {warmupMatch} = await import('../../lib/view/match-warmup.js')

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

  // Rigs are born hidden, and the warmup hides them again on release. So the
  // call has to show the held one, not only hide the rest.
  for (const rig of Object.values(rigs)) rig.root.visible = false
  keepRigsResident(rigs, feel, 'm4')
  for (const rig of Object.values(rigs)) {
    assert.equal(rig.root.parent, feel, `${rig.id} left the view`)
    assert.equal(rig.root.visible, rig.id === 'm4', `${rig.id} has the wrong visibility`)
  }

  // Switching weapons must not take the old rig out of the scene, and the new
  // rig must show even though it was hidden a moment ago.
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

// The player sees the weapon on the frame the match starts. The warmup shows
// every rig to compile it, then hides them again on release. If the release
// hides all of them the player holds nothing until the next weapon switch.
function rigFixture(shown = 'pistol') {
  const feel = new E.Group()
  const rigs = Object.fromEntries(['pistol', 'm4', 'shotgun', 'knife'].map(id => {
    const root = new E.Group()
    root.name = `${id} viewmodel`
    root.visible = false // instantiateWeaponRigs leaves every rig hidden
    feel.add(root)
    return [id, {id, root}]
  }))
  return {
    feel, rigs, animation: {shown},
    bullets: {primeWarmup: () => () => {}},
    projectiles: {primeWarmup: () => () => {}},
  }
}

test('a warmup prime shows every rig, and its release leaves the held one visible', () => {
  const view = rigFixture('pistol')
  const release = WeaponView.prototype.primeWarmup.call(view, {})
  assert.equal(view.warming, true)
  for (const rig of Object.values(view.rigs)) {
    assert.equal(rig.root.visible, true, `${rig.id} cannot compile while hidden`)
  }

  release()
  assert.equal(view.warming, false)
  assert.equal(view.rigs.pistol.root.visible, true, 'the player holds the pistol and must see it')
  for (const rig of Object.values(view.rigs)) {
    assert.equal(rig.root.parent, view.feel, `${rig.id} left the view`)
    assert.equal(rig.root.visible, rig.id === 'pistol', `${rig.id} has the wrong visibility`)
  }
})

test('the warmup ends with the held rig visible and every other rig hidden', async () => {
  const view = rigFixture('m4')
  const object = {material: {isMaterial: true}, isMesh: true, visible: false, frustumCulled: true}
  const scene = {isObject3D: true, mainCamera: {}, traverse(fn) { fn(object) }}
  const renderer = {shadowMap: {}, info: {programs: []}, compile() {}, async compileAsync() {},
    getContext() { return {finish() {}} }}
  const manager = {ctx: {viewer: {scene, renderManager: {webglRenderer: renderer, passes: []}, setDirty() {}}},
    viewsStarted: true,
    playerView: {weapons: {
      rigs: view.rigs, worldFx: {pools: {}},
      adoptEnvironment() {},
      primeWarmup: camera => WeaponView.prototype.primeWarmup.call(view, camera),
    }}}

  const report = await warmupMatch(manager, {weaponReady: Promise.resolve()})
  assert.equal(report.cancelled, undefined)
  for (const rig of Object.values(view.rigs)) {
    assert.equal(rig.root.parent, view.feel, `${rig.id} left the view after the warmup`)
    assert.equal(rig.root.visible, rig.id === 'm4', `${rig.id} has the wrong visibility after the warmup`)
  }
})

// Play hides every authored weapon source so the template never shows in the
// world. The scene template carries `weaponAsset`, and so does the asset root
// loaded inside it. A rig is a clone of that template, so the clone used to
// carry the hidden asset root, and three stops its walk at a hidden node: no
// mesh under it ever reached the renderer. Hands, gun, the whole viewmodel.
test('a rig cloned from a hidden authored source still draws', async () => {
  const assets = await loadWeaponFixture()
  // Shape the fixture like the runtime scene: a template node per weapon with
  // the loaded asset root inside it, both carrying the weaponAsset marker.
  const modelRoot = new E.Group()
  for (const scene of [...assets.children]) {
    let asset = null
    scene.traverse(n => { if (!asset && n.userData?.weaponAsset) asset = n })
    const template = new E.Group()
    template.name = `Weapon Template ${asset.userData.weaponAsset}`
    template.userData = {weaponAsset: asset.userData.weaponAsset}
    template.add(asset)
    modelRoot.add(template)
  }
  // Exactly what scripts/Environment.plugin.js does on import during Play.
  modelRoot.traverse(n => { if (n.userData?.weaponAsset) n.visible = false })

  const rigs = instantiateWeaponRigs(new E.Group(), modelRoot)
  for (const rig of Object.values(rigs)) {
    let meshes = 0
    rig.root.traverse(node => {
      if (!node.isMesh || !node.visible) return
      meshes += 1
      for (let n = node.parent; n && n !== rig.root; n = n.parent) {
        assert.ok(n.visible, `${rig.id}: ${node.name} is hidden by its ancestor ${n.name}`)
      }
    })
    assert.ok(meshes > 0, `${rig.id} has no visible mesh`)
    assert.equal(rig.root.visible, false, `${rig.id} is drawn by WeaponAnimation, not at birth`)
  }
})
