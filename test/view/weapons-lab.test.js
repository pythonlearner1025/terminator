import {weaponFixture} from './weapon-assets-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {labSceneDocument} = await import('../../tools/build-lab-scene.mjs')
const {bootLabWorld, WeaponsLab} = await import('../../scripts/WeaponsLab.script.js')
const {WeaponAnimation} = await import('../../lib/view/weapons-animation.js')
const {createWeaponRigs} = await import('../../lib/view/weapons.js')

test('lab scene uses placed fixture, plate, target, unit, weapon, light, and camera nodes', () => {
  const scene = labSceneDocument()
  const get = name => scene.nodes.find(n => n.name === name)
  assert.equal(scene.nodes.some(node => Object.values(node.extras?.EntityComponentPlugin || {}).some(component => component.type === 'Generator')), false)
  assert.equal(scene.nodes.filter(node => /^\d+m .* Target$/.test(node.name)).length, 18)
  assert.equal(scene.nodes.filter(node => /^Plate \d$/.test(node.name)).length, 6)
  assert.equal(scene.nodes.filter(node => node.extras?.weaponAsset).length, 10)
  assert.equal(get('Rebuilt Revolver Template').extras.weaponAsset, 'revolver-rebuild')
  assert.equal(get('Rebuilt Revolver Template').extras.rootPath, '/kite3d/@weapon-revolver-rebuild/revolver-rebuild.gltf')
  assert.deepEqual(get('Firing_Line').translation, [-18,0,-13])
  assert.deepEqual(get('Turntable').translation, [-16,0,-13])
  for (const row of [10,20,40]) assert.equal(get(`Targets_${row}m`).translation[0] - get('Firing_Line').translation[0], row)
  assert.equal(get('Plates').translation[0] - get('Firing_Line').translation[0], 15)
  assert.equal(get('Range').extras.rootPath, '/kite3d/@lab-range-shell/f.gltf')
  assert.equal(get('Plate 1').extras.rootPath, '/kite3d/@range-steel-target/f.gltf')
  assert.equal(get('10m Scout Target').extras.rootPath, '/kite3d/@unit-scout/scout.gltf')
  assert.equal(get('Unit T-600 Scout').extras.rootPath, '/kite3d/@unit-scout/scout.gltf')
  assert.equal(scene.extensions.KHR_lights_punctual.lights.length, 3)
  assert.equal(Object.values(get('Lab_Manager').extras.EntityComponentPlugin)[0].type, 'WeaponsLab')
  get('Turntable').extras.customHumanData = 'keep'
  assert.deepEqual(labSceneDocument(scene), scene, 'Regeneration keeps stable ids and unknown extras')
})

test('lab boot creates a 60 by 20 range, static dummies, sandbox ammunition and no active director', () => {
  const {world, director, range} = bootLabWorld()
  assert.equal(WeaponsLab.prototype instanceof E.Object3DComponent, true)
  assert.equal(Object.getPrototypeOf(WeaponsLab.prototype), E.Object3DComponent.prototype)
  assert.deepEqual(world.map.size, {x:60,z:20})
  assert.equal(world.aliveUnits.length, 18); assert.equal(director.sandboxPaused, true)
  assert.equal(world.sandbox.infiniteAmmo, true); assert.equal(world.sandbox.invulnerable, true)
  const positions = world.units.map(u => ({...u.pos}))
  for (let i = 0; i < 180; i++) {director.step({}); range.afterStep()}
  assert.deepEqual(world.units.map(u => u.pos), positions)
  for (const slot of range.layout) assert.equal(slot.pos.x - (-18), slot.row)
  assert.equal(world.waveBudget, 0)
  world.destroy()
})

test('clip fractions map to frames, sample the real reload pose, and leave live animation and world intact', () => {
  const {world} = bootLabWorld(), rigs = createWeaponRigs(new E.Group(), new E.PhysicalMaterial(),weaponFixture)
  const fx = {count:0,update(){},eject(){this.count++},fire(){this.count++}}
  const a = new WeaponAnimation(rigs, fx); a.sync(world)
  const snapshot = () => JSON.stringify({player:world.player,events:world.eventLog,tick:world.tick,projectiles:world.projectiles})
  const before = snapshot(), live = {...a.state}, stats = {...a.stats}, calls = fx.count
  const sample = a.setClipTime('reload', .5, world)
  assert.equal(sample.frame, 78); assert.equal(sample.frames, 156); assert.equal(sample.seconds, 1.3)
  assert.equal(rigs.pistol.clipPlayer.name, 'Reload'); assert.ok(rigs.pistol.magazine.position.x > .06)
  assert.deepEqual(a.state, live); assert.deepEqual(a.stats, stats); assert.equal(fx.count, calls)
  assert.equal(snapshot(), before)
  a.setClipTime('reload', .25); const pose = rigs.pistol.body.quaternion.toArray()
  a.setClipTime('reload', .9); a.setClipTime('reload', .25)
  assert.deepEqual(rigs.pistol.body.quaternion.toArray(), pose)
  a.setClipTime(null); assert.equal(a.clipPreview, null); assert.ok(Math.abs(rigs.pistol.magazine.position.x)<1e-7)
  for (const [clip,fraction] of [['fire',.5],['aim',.5],['switch',.5],['idle',.5]]) {
    const frame = a.setClipTime(clip, fraction); assert.equal(frame.frame, Math.round(frame.frames * fraction))
  }
  world.destroy()
})
