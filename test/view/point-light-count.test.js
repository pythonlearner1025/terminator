import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {CachesView} = await import('../../lib/view/caches.js')
const {ExtractionView} = await import('../../lib/view/extraction.js')
const {ProjectileView} = await import('../../lib/view/projectiles.js')

// three writes the number of visible point lights into every program cache key
// (`WebGLPrograms.getProgramCacheKey` pushes `parameters.numPointLights`). Change
// that number and every material in the scene needs a program it has never
// linked. three links it on first use, inside `WebGLProgram.getUniforms`, which
// calls `gl.getProgramInfoLog` and blocks the main thread until the driver
// finishes. On an M3 Max that costs 50 to 400 ms, in the middle of a wave.
//
// So the rule these tests hold: a runtime point light is created once and stays
// visible for the life of the view. Intensity zero is off.
function harness() {
  const manager = new E.Object3DManager()
  const scene = new E.Group()
  scene.name = 'RootScene'
  manager.setRoot(scene)
  return {
    scene,
    viewer: {scene, setDirty() {}, addEventListener() {}, removeEventListener() {}},
  }
}

function shown(object) {
  for (let node = object; node; node = node.parent) if (node.visible === false) return false
  return true
}

function litPointLights(root) {
  let count = 0
  root.traverse(object => { if (object.isPointLight && shown(object)) count += 1 })
  return count
}

test('the supply cache view keeps its point-light count fixed through spawn, pickup and expiry', () => {
  const {viewer} = harness()
  const view = new CachesView(viewer)
  const world = {tick: 60, eventLog: [], pickups: {active: []}, player: {pos: {x: 0, y: 0, z: 0}}}
  view.start(world)
  const resident = litPointLights(view.root)
  assert.equal(resident, 2, 'one shared glow and one collection flash')
  assert.equal(view.glow.intensity, 0, 'no crate means no glow')

  world.pickups.active = [{id: 'c1', kind: 'weapon', pos: {x: 3, y: 0, z: 1}}]
  view.sync(world)
  assert.equal(litPointLights(view.root), resident, 'a spawned crate must not add a light')
  assert.ok(view.glow.intensity > 0, 'a live crate lights the glow')

  world.eventLog.push({type: 'cache_taken', pos: {x: 3, y: 0, z: 1}})
  world.pickups.active = []
  world.tick = 90
  view.sync(world)
  assert.equal(litPointLights(view.root), resident, 'a collection flash must not add a light')
  assert.equal(view.bursts.length, 1)
  assert.ok(view.burstLight.intensity > 0, 'the flash uses the resident light')
  assert.equal(view.glow.intensity, 0, 'the last crate is gone, so the glow is off')

  world.tick = 90 + 31
  view.sync(world)
  assert.equal(litPointLights(view.root), resident, 'an expired flash must not remove a light')
  assert.equal(view.bursts.length, 0)
  assert.equal(view.burstLight.intensity, 0, 'the flash fades to nothing')
  view.stop()
})

test('a second pickup inside the flash takes the light over and the older burst still expires', () => {
  const {viewer} = harness()
  const view = new CachesView(viewer)
  const world = {tick: 60, eventLog: [], pickups: {active: []}, player: {pos: {x: 0, y: 0, z: 0}}}
  view.start(world)
  const resident = litPointLights(view.root)
  world.eventLog.push({type: 'cache_taken', pos: {x: 1, y: 0, z: 0}})
  view.sync(world)
  world.tick = 75
  world.eventLog.push({type: 'cache_taken', pos: {x: 9, y: 0, z: 0}})
  view.sync(world)
  assert.equal(view.bursts.length, 2)
  assert.equal(litPointLights(view.root), resident)
  assert.equal(view.burstLight.userData.burst, view.bursts[1], 'the newer burst owns the light')
  assert.equal(view.burstLight.position.x, 9)

  // The older burst reaches age 1 first. It must not switch off a light the
  // newer burst is still using.
  world.tick = 91
  view.sync(world)
  assert.equal(view.bursts.length, 1)
  assert.ok(view.burstLight.intensity > 0, 'the newer burst keeps the light lit')
  world.tick = 106
  view.sync(world)
  assert.equal(view.bursts.length, 0)
  assert.equal(view.burstLight.intensity, 0)
  assert.equal(litPointLights(view.root), resident)
  view.stop()
})

test('the extraction beacon hides its meshes but keeps its light in the scene', () => {
  const {viewer} = harness()
  const view = new ExtractionView(viewer)
  const world = {tick: 60, map: {extraction: {pos: {x: 0, y: 0, z: 0}}}, extraction: {phase: 'idle'}}
  view.start(world)
  const resident = litPointLights(view.root)
  assert.equal(resident, 1)
  assert.equal(view.column.visible, false, 'an idle beacon shows nothing')
  assert.equal(view.light.intensity, 0)

  world.extraction.phase = 'announced'
  view.sync(world)
  assert.equal(litPointLights(view.root), resident, 'opening extraction must not add a light')
  assert.equal(view.column.visible, true)
  assert.equal(view.ring.visible, true)
  assert.ok(view.light.intensity > 0)

  world.extraction.phase = 'done'
  view.sync(world)
  assert.equal(litPointLights(view.root), resident, 'closing extraction must not remove a light')
  assert.equal(view.column.visible, false)
  assert.equal(view.ring.visible, false)
  assert.equal(view.light.intensity, 0)
  view.stop()
})

test('tracer lights stay in the scene whether or not a bolt is in flight', () => {
  const {scene} = harness()
  // Real materials, so no texture loader runs after the test ends.
  const view = new ProjectileView(scene, 32, {material: new E.PhysicalMaterial(), shellMaterial: new E.PhysicalMaterial()})
  const resident = litPointLights(view.root)
  assert.equal(resident, 2)

  view.sync({tick: 1, projectiles: []}, null)
  assert.equal(litPointLights(view.root), resident, 'an empty sky keeps both lights')
  assert.deepEqual(view.lights.map(light => light.intensity), [0, 0])

  view.sync({tick: 2, projectiles: [{id: 'b1', type: 'bolt', owner: 'player', pos: {x: 0, y: 1, z: 2}, vel: {x: 0, y: 0, z: 40}}]}, null)
  assert.equal(litPointLights(view.root), resident, 'a bolt must not add a light')
  assert.ok(view.lights[0].intensity > 0, 'the bolt lights the first tracer light')
  assert.equal(view.lights[1].intensity, 0)

  view.sync({tick: 3, projectiles: []}, null)
  assert.equal(litPointLights(view.root), resident, 'a spent bolt must not remove a light')
  assert.deepEqual(view.lights.map(light => light.intensity), [0, 0])

  view.reset()
  assert.equal(litPointLights(view.root), resident, 'reset must not remove a light')
  assert.deepEqual(view.lights.map(light => light.intensity), [0, 0])
})
