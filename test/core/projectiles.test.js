import assert from 'node:assert/strict'
import test from 'node:test'
import {ENEMY_PROJECTILE_SPEEDS, PLAYER_RADIUS, World} from '../../lib/core/world.js'

const idle = {tick() {}}
const brains = Object.fromEntries(['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank'].map((type) => [type, idle]))

function aimedEndoWorld(seed = 5) {
  const world = new World({seed, brains})
  world.player.pos = {x: 15, y: 0, z: 10}
  world.player.yaw = 0
  const unit = world.spawnUnit('endo', {x: 15, y: 0, z: -10}, {yaw: 0})
  unit.targetPlayerId = world.player.id
  return {world, unit}
}

test('an Endo burst flies for 20 meters and full-speed strafing dodges every round', () => {
  const standing = aimedEndoWorld()
  const standingSpec = {...standing.world.unitCatalog.types.endo, spreadDeg: 0}
  for (let tick = 0; tick < 100; tick += 1) {
    if (tick === 0 || tick === 10 || tick === 20) standing.world.fireUnitWeapon(standing.unit, standingSpec)
    standing.world.step({yaw: 0})
  }
  assert.equal(standing.world.player.hp, 55)
  const hit = standing.world.eventLog.find((event) => event.type === 'projectile_hit' && event.targetId === standing.world.player.id)
  assert.ok(hit)
  assert.ok(hit.t >= 0.64 && hit.t <= 0.68)

  const strafing = aimedEndoWorld()
  const strafingSpec = {...strafing.world.unitCatalog.types.endo, spreadDeg: 0}
  for (let tick = 0; tick < 100; tick += 1) {
    if (tick === 0 || tick === 10 || tick === 20) strafing.world.fireUnitWeapon(strafing.unit, strafingSpec)
    strafing.world.step({move: {x: 1, z: 0}, yaw: 0, sprint: true})
  }
  assert.equal(strafing.world.player.hp, 100)
  assert.equal(strafing.world.eventLog.filter((event) => event.type === 'projectile_fired').length, 3)
  assert.equal(PLAYER_RADIUS / 7.5, 0.050666666666666665)
  assert.equal(ENEMY_PROJECTILE_SPEEDS.round, 30)
})

test('enemy projectile flight and impacts are deterministic for replayed inputs', () => {
  const run = () => {
    const {world, unit} = aimedEndoWorld(81)
    world.fireUnitWeapon(unit, world.unitCatalog.types.endo)
    for (let tick = 0; tick < 90; tick += 1) world.step({move: {x: Math.sin(tick / 20), z: 0}, yaw: 0})
    return {
      player: world.player,
      projectiles: world.projectiles,
      events: world.eventLog.filter((event) => event.type === 'projectile_fired' || event.type === 'projectile_hit'),
      replay: world.replay,
    }
  }
  assert.deepEqual(run(), run())
})

test('an active projectile survives a JSON snapshot round trip', () => {
  const {world, unit} = aimedEndoWorld(12)
  world.fireUnitWeapon(unit, {...world.unitCatalog.types.endo, spreadDeg: 0})
  for (let tick = 0; tick < 10; tick += 1) world.step({yaw: 0})
  const restored = new World({seed: 99, brains})
  restored.applySnapshot(JSON.parse(JSON.stringify(world.snapshot())))
  assert.deepEqual(restored.projectiles, world.projectiles)
  for (let tick = 0; tick < 45; tick += 1) {
    world.step({yaw: 0})
    restored.step({yaw: 0})
  }
  assert.deepEqual(restored.projectiles, world.projectiles)
  assert.equal(restored.player.hp, world.player.hp)
})

test('rounds stop at map colliders before reaching a player capsule', () => {
  const world = new World({brains})
  world.player.pos = {x: 0, y: 0, z: 8}
  world.spawnProjectile({type: 'round', owner: 'unit', ownerId: 'test-unit', pos: {x: 0, y: 1, z: -8}, vel: {x: 0, y: 0, z: 30}, damage: 15, weapon: 'burst', life: 2})
  for (let tick = 0; tick < 60; tick += 1) world.step({})
  assert.equal(world.player.hp, 100)
  const hit = world.eventLog.find((event) => event.type === 'projectile_hit')
  assert.ok(hit)
  assert.equal(hit.targetId, null)
})

test('rounds and bolts fly straight while shells use gravity and splash', () => {
  const world = new World({brains})
  const guest = world.addPlayer({id: 'guest', name: 'Guest'})
  world.player.pos = {x: 15, y: 0, z: 10}
  guest.pos = {x: 16, y: 0, z: 10}
  const round = world.spawnProjectile({type: 'round', owner: 'unit', ownerId: 'test', pos: {x: 2, y: 6, z: 2}, vel: {x: 30, y: 0, z: 0}, damage: 1, life: 2})
  const bolt = world.spawnProjectile({type: 'bolt', owner: 'unit', ownerId: 'test', pos: {x: 2, y: 7, z: 2}, vel: {x: 18, y: 0, z: 0}, damage: 1, life: 3})
  world.spawnProjectile({type: 'shell', owner: 'unit', ownerId: 'test', pos: {x: 15, y: 1, z: 5}, vel: {x: 0, y: 0, z: 22}, damage: 60, splash: 2.5, life: 4})
  world.step({})
  assert.equal(round.vel.y, 0)
  assert.equal(bolt.vel.y, 0)
  const shell = world.projectiles.find(({type}) => type === 'shell')
  assert.ok(!shell || shell.vel.y < 0)
  for (let tick = 0; tick < 30; tick += 1) world.step({})
  assert.ok(world.player.hp < 100)
  assert.ok(guest.hp < 100)
  assert.equal(world.eventLog.some((event) => event.type === 'explosion' && event.radius === 2.5), true)
})

test('projectile lifecycle events carry the stable payload fields', () => {
  const world = new World({brains})
  const projectile = world.spawnProjectile({type: 'bolt', owner: 'unit', ownerId: 'test', pos: {x: 0, y: 1, z: -8}, vel: {x: 0, y: 0, z: 18}, damage: 20, weapon: 'bolt', life: 3})
  const fired = world.eventLog.find((event) => event.type === 'projectile_fired')
  assert.deepEqual({id: fired.id, projectileType: fired.projectileType, ownerId: fired.ownerId, weapon: fired.weapon}, {id: projectile.id, projectileType: 'bolt', ownerId: 'test', weapon: 'bolt'})
  for (let tick = 0; tick < 90 && world.projectiles.length; tick += 1) world.step({})
  const hit = world.eventLog.find((event) => event.type === 'projectile_hit')
  for (const key of ['id', 'projectileType', 'pos', 'normal', 'targetId']) assert.ok(Object.hasOwn(hit, key), key)
})
