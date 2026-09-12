import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../lib/core/world.js'

const idle = {tick() {}}
const brains = Object.fromEntries(['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank'].map((type) => [type, idle]))

test('sniper penetrates two units with sixty-percent damage per step', () => {
  const world = new World({brains})
  const units = [13, 16, 19].map((z) => world.spawnUnit('endo', {x: 15, y: 0, z}))
  const result = world.hitscan({origin: {x: 15.14, y: 0.8, z: 10}, direction: {x: 0, y: 0, z: 1}, weaponId: 'sniper'})
  assert.equal(result.hits.length, 3)
  assert.deepEqual(result.hits.map(({damage}) => damage), [220, 132, 79.2])
  assert.deepEqual(units.map(({hp}) => hp), [80, 168, 220.8])
})

test('launcher shells ignore contact before 2.5 meters and then disappear', () => {
  const world = new World({brains})
  const target = world.spawnUnit('scout', {x: 15, y: 0, z: 11})
  world.spawnProjectile({type: 'shell', owner: 'player', ownerId: world.player.id, pos: {x: 15, y: 0.8, z: 10}, vel: {x: 0, y: 0, z: 32}, damage: 260, splash: 3.5, weapon: 'launcher', life: 5, armingDistance: 2.5, radius: 0.09})
  for (let tick = 0; tick < 5; tick += 1) world.step({})
  assert.equal(target.hp, target.maxHp)
  assert.equal(world.projectiles.length, 0)
  assert.equal(world.eventLog.some((event) => event.type === 'explosion'), false)
})

test('an armed launcher shell detonates on unit contact for full direct damage', () => {
  const world = new World({seed: 9, brains})
  world.player.pos = {x: 10, y: 0, z: 0}
  world.player.yaw = 0
  world.player.activeWeapon = 'launcher'
  world.player.ammo.launcher = {owned: true, mag: 1, reserve: 0}
  const target = world.spawnUnit('heavy', {x: 10, y: 0, z: 8})
  assert.equal(world.playerFire(), true)
  for (let tick = 0; tick < 30; tick += 1) world.step({yaw: 0})
  assert.equal(target.hp, target.maxHp - 260)
  assert.equal(world.eventLog.some((event) => event.type === 'projectile_hit' && event.targetId === target.id), true)
  assert.equal(world.eventLog.some((event) => event.type === 'explosion' && event.radius === 3.5), true)
})

test('an armed launcher shell detonates on map contact', () => {
  const world = new World({brains})
  world.spawnProjectile({type: 'shell', owner: 'player', ownerId: world.player.id, pos: {x: 0, y: 1, z: -10}, vel: {x: 0, y: 0, z: 32}, damage: 260, splash: 3.5, weapon: 'launcher', life: 5, armingDistance: 2.5, radius: 0.09})
  for (let tick = 0; tick < 20 && world.projectiles.length; tick += 1) world.step({})
  const hit = world.eventLog.find((event) => event.type === 'projectile_hit')
  assert.equal(hit.targetId, null)
  assert.equal(world.eventLog.some((event) => event.type === 'explosion' && event.projectileId === hit.id), true)
})

test('the catalog exposes exact sniper and launcher trader values', () => {
  const world = new World({brains})
  const {sniper, launcher} = world.weaponCatalog.weapons
  assert.deepEqual([sniper.damage, sniper.rate, sniper.mag, sniper.reserveMax, sniper.spreadDeg, sniper.price, sniper.ammoPrice, sniper.reloadSeconds, sniper.pellets, sniper.penetration, sniper.aimFov], [220, 1.2, 10, 60, 0.2, 1100, 60, 2.6, 1, 2, 30])
  assert.deepEqual([launcher.damage, launcher.rate, launcher.mag, launcher.reserveMax, launcher.spreadDeg, launcher.price, launcher.ammoPrice, launcher.reloadSeconds, launcher.projectile, launcher.projectileSpeed, launcher.armingDistance, launcher.radius], [260, 1, 1, 20, 0.5, 1400, 60, 2.2, 'shell', 32, 2.5, 3.5])
  world.phase = 'intermission'
  world.player.scrap = 3000
  assert.deepEqual(world.purchase('sniper'), {ok: true, item: 'sniper', name: 'M14 Marksman', price: 1100})
  assert.deepEqual(world.purchase('launcher'), {ok: true, item: 'launcher', name: 'M79 Launcher', price: 1400})
})

test('weapon cycling skips unowned slots and reaches slots five and six', () => {
  const world = new World({brains})
  world.player.ammo.sniper.owned = true
  world.player.ammo.launcher.owned = true
  assert.equal(world.switchWeapon('next'), true)
  assert.equal(world.player.activeWeapon, 'sniper')
  assert.equal(world.switchWeapon(6), true)
  assert.equal(world.player.activeWeapon, 'launcher')
  assert.equal(world.switchWeapon('previous'), true)
  assert.equal(world.player.activeWeapon, 'sniper')
})

test('damage and kill events always include the gore contract fields', () => {
  const world = new World({brains})
  const unit = world.spawnUnit('scout', {x: 12, y: 0, z: 10})
  world.damageUnit(unit.id, 500, {source: 'player', playerId: world.player.id, weapon: 'sniper', part: 'Head', point: {x: 12, y: 1.6, z: 10}, normal: {x: 0, y: 0, z: -1}, direction: {x: 0, y: 0, z: 1}})
  const damage = world.eventLog.find((event) => event.type === 'unit_damage')
  const kill = world.eventLog.find((event) => event.type === 'kill')
  for (const key of ['unitId', 'unitType', 'part', 'amount', 'weapon', 'headshot', 'pos', 'normal', 'direction']) assert.ok(Object.hasOwn(damage, key), key)
  for (const key of ['unitId', 'unitType', 'weapon', 'headshot', 'part', 'pos', 'direction']) assert.ok(Object.hasOwn(kill, key), key)
})
