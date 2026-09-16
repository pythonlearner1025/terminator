import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../../lib/core/world.js'

const idle = {tick() {}}
const brains = Object.fromEntries(['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank'].map((type) => [type, idle]))

// The Scout idle hit volumes sit low, so a close shot needs a downward pitch.
const pitchTo = (rangeMeters) => -Math.atan2(1.05, rangeMeters)

function armShotgun(world) {
  world.player.yaw = 0
  world.player.activeWeapon = 'shotgun'
  world.player.ammo.shotgun = {owned: true, mag: 8, reserve: 0}
}

test('a common flinches on a thirty damage hit and a special does not', () => {
  const world = new World({seed: 21, brains})
  const common = world.spawnUnit('scout', {x: 4, y: 0, z: 12})
  const special = world.spawnUnit('endo', {x: 8, y: 0, z: 12})

  world.damageUnit(common.id, 30, {source: 'player', weapon: 'pistol'})
  world.damageUnit(special.id, 30, {source: 'player', weapon: 'pistol'})
  assert.equal(common.staggerTicks, 15, 'a common staggers 0.25 s on any damage')
  assert.equal(special.staggerTicks, 0, 'a special keeps the 65 damage rule')

  world.damageUnit(special.id, 65, {source: 'player', weapon: 'pistol'})
  assert.equal(special.staggerTicks, 24, 'a special staggers 0.4 s on a heavy hit')
})

test('a knife hit on a common staggers it and pushes it clear of the player', () => {
  const world = new World({seed: 22, brains})
  world.player.yaw = 0
  const unit = world.spawnUnit('scout', {x: 0, y: 0, z: 10.2})
  const start = {...unit.pos}

  assert.equal(world.playerMelee(), true)
  assert.equal(unit.staggerTicks, 36, 'the knife stagger lasts 0.6 s')
  assert.deepEqual(unit.knockback, {x: 0, z: 2.5 / 18, ticksLeft: 18})

  for (let tick = 0; tick < 18; tick += 1) world.step({})
  assert.equal(unit.knockback, null, 'the push ends after 0.3 s')
  const moved = Math.hypot(unit.pos.x - start.x, unit.pos.z - start.z)
  assert.ok(Math.abs(moved - 2.5) < 0.01, `knife push moved ${moved.toFixed(3)} m`)
  assert.ok(unit.pos.z > start.z, 'the push is away from the player')
  assert.ok(unit.staggerTicks > 0, 'the stagger outlasts the push')
})

test('a knife hit on a special neither shoves nor flinches it', () => {
  const world = new World({seed: 23, brains})
  world.player.yaw = 0
  const unit = world.spawnUnit('endo', {x: 0, y: 0, z: 10.2})
  const start = {...unit.pos}

  assert.equal(world.playerMelee(), true)
  assert.equal(unit.knockback, null)
  assert.equal(unit.staggerTicks, 0)
  for (let tick = 0; tick < 18; tick += 1) world.step({})
  assert.equal(Math.hypot(unit.pos.x - start.x, unit.pos.z - start.z), 0)
})

test('a shotgun shot that lands four or more pellets on one common pushes it', () => {
  const world = new World({seed: 3, brains})
  armShotgun(world)
  world.player.pitch = pitchTo(2)
  const unit = world.spawnUnit('scout', {x: 0, y: 0, z: 11})
  unit.hp = 5000
  unit.maxHp = 5000
  const start = {...unit.pos}

  assert.equal(world.playerFire(), true)
  assert.equal((5000 - unit.hp) / world.weaponCatalog.weapons.shotgun.damage, 7, 'seven pellets landed')
  assert.deepEqual(unit.knockback, {x: 0, z: 1.5 / 18, ticksLeft: 18})

  for (let tick = 0; tick < 18; tick += 1) world.step({})
  const moved = Math.hypot(unit.pos.x - start.x, unit.pos.z - start.z)
  assert.ok(Math.abs(moved - 1.5) < 0.01, `shotgun push moved ${moved.toFixed(3)} m`)
})

test('a thin shotgun pattern and a single-pellet weapon leave a common in place', () => {
  const thin = new World({seed: 5, brains})
  armShotgun(thin)
  thin.player.pitch = pitchTo(7)
  const far = thin.spawnUnit('scout', {x: 0, y: 0, z: 16})
  far.hp = 5000
  far.maxHp = 5000
  assert.equal(thin.playerFire(), true)
  assert.equal((5000 - far.hp) / thin.weaponCatalog.weapons.shotgun.damage, 2, 'two pellets landed')
  assert.equal(far.knockback, null)

  const pistolWorld = new World({seed: 5, brains})
  pistolWorld.player.yaw = 0
  pistolWorld.player.pitch = pitchTo(2)
  const near = pistolWorld.spawnUnit('scout', {x: 0, y: 0, z: 11})
  near.hp = 5000
  near.maxHp = 5000
  assert.equal(pistolWorld.playerFire(), true)
  assert.ok(near.hp < 5000, 'the pistol round landed')
  assert.equal(near.knockback, null)
})

test('a shotgun shot that lands four or more pellets on a special leaves it in place', () => {
  const world = new World({seed: 3, brains})
  armShotgun(world)
  world.player.pitch = 0
  const unit = world.spawnUnit('endo', {x: 0, y: 0, z: 11})
  unit.hp = 5000
  unit.maxHp = 5000

  assert.equal(world.playerFire(), true)
  assert.ok((5000 - unit.hp) / world.weaponCatalog.weapons.shotgun.damage >= 4, 'four or more pellets landed')
  assert.equal(unit.knockback, null)
})

test('a push overrides the brain move intent and stops at a collider', () => {
  const chase = {tick(self, sense, act) { act.moveTo({x: 0, y: 0, z: 9}) }}
  const world = new World({seed: 24, brains: {...brains, scout: chase}})
  world.player.yaw = 0
  const unit = world.spawnUnit('scout', {x: 0, y: 0, z: 10.2})
  for (let tick = 0; tick < 12; tick += 1) world.step({})
  const beforeShove = {...unit.pos}

  assert.equal(world.playerMelee(), true)
  for (let tick = 0; tick < 18; tick += 1) world.step({})
  const moved = Math.hypot(unit.pos.x - beforeShove.x, unit.pos.z - beforeShove.z)
  assert.ok(moved > 2, `the push wins over the chase intent, moved ${moved.toFixed(3)} m`)
  const before = Math.hypot(beforeShove.x, beforeShove.z - 9)
  const after = Math.hypot(unit.pos.x, unit.pos.z - 9)
  assert.ok(after > before + 2, 'the chased unit ends farther from the player')

  // The courtyard divider stands at x near zero on the z = 0 row.
  const wall = new World({seed: 25, brains})
  wall.player.pos = {x: -4, y: 0, z: 0}
  wall.player.yaw = Math.PI / 2
  const pinned = wall.spawnUnit('scout', {x: -2.8, y: 0, z: 0})
  const pinnedStart = {...pinned.pos}
  assert.equal(wall.positionBlocked(pinnedStart, wall.unitCatalog.types.scout.radius, 1.85), false)

  assert.equal(wall.playerMelee(), true)
  for (let tick = 0; tick < 18; tick += 1) wall.step({})
  const pushed = Math.hypot(pinned.pos.x - pinnedStart.x, pinned.pos.z - pinnedStart.z)
  assert.ok(pushed > 0.5, 'the push started')
  assert.ok(pushed < 2.4, `the divider stopped the push at ${pushed.toFixed(3)} m`)
  assert.equal(wall.positionBlocked(pinned.pos, wall.unitCatalog.types.scout.radius, 1.85), false)
})
