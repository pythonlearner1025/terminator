import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../lib/core/world.js'

test('the starter revolver has exact catalog values and reloads exactly six rounds', () => {
  const world = new World()
  const revolver = world.weaponCatalog.weapons.pistol
  assert.deepEqual(revolver, {
    id: 'pistol',
    slot: 1,
    name: '1858 Revolver',
    damage: 50,
    rate: 2.5,
    mag: 6,
    reserveMax: 66,
    spreadDeg: 1.2,
    price: 0,
    ammoPrice: 6,
    reloadSeconds: 2.6,
    pellets: 1,
  })

  world.player.ammo.pistol.mag = 0
  assert.equal(world.startReload(), true)
  assert.equal(world.player.reloadTimer, 2.6)
  while (world.player.reloadTimer > 0) world.step({})
  assert.equal(world.player.ammo.pistol.mag, 6)
  assert.equal(world.player.ammo.pistol.reserve, 60)
})

test('hitscan doubles head damage and halves frontal Heavy plate damage', () => {
  const headWorld = new World({seed: 7})
  const headTarget = headWorld.spawnUnit('heavy', {x: 10, y: 0, z: 0}, {yaw: 0})
  const head = headWorld.hitscan({
    origin: {x: 10, y: 2.05, z: 5},
    direction: {x: 0, y: 0, z: -1},
    damage: 100,
  })
  assert.equal(head.kind, 'unit')
  assert.equal(head.headshot, true)
  assert.equal(head.damage, 200)
  assert.equal(headTarget.hp, 700)

  const plateWorld = new World({seed: 7})
  const plateTarget = plateWorld.spawnUnit('heavy', {x: 10, y: 0, z: 0}, {yaw: 0})
  const plate = plateWorld.hitscan({
    origin: {x: 10, y: 1.7, z: 5},
    direction: {x: 0, y: 0, z: -1},
    damage: 100,
  })
  assert.equal(plate.kind, 'unit')
  assert.equal(plate.plate, true)
  assert.equal(plate.damage, 50)
  assert.equal(plateTarget.hp, 850)
})
