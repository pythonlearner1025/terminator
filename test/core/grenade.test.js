import assert from 'node:assert/strict'
import test from 'node:test'
import {TICK_RATE, World} from '../../lib/core/world.js'

const idleBrain = {tick() {}}
const brains = {scout: idleBrain, endo: idleBrain, heavy: idleBrain}

test('a thrown grenade follows an arc and lands a plausible distance ahead', () => {
  const world = new World({seed: 31, brains})
  const start = {...world.player.pos}

  assert.equal(world.throwGrenade(), true)
  assert.equal(world.projectiles.length, 1)
  assert.equal(world.eventLog.at(-1).type, 'grenade_thrown')

  let groundBounce = null
  for (let tick = 0; tick < TICK_RATE * 2 && !groundBounce; tick += 1) {
    world.step()
    groundBounce = world.eventLog.find((event) => event.type === 'grenade_bounce' && event.colliderId === 'ground')
  }

  assert.ok(groundBounce, 'grenade never landed on the ground')
  const range = Math.hypot(groundBounce.pos.x - start.x, groundBounce.pos.z - start.z)
  assert.ok(range >= 6 && range <= 11, `first landing range was ${range}`)
  assert.ok(Math.abs(groundBounce.pos.y - 0.09) < 1e-6)
})

test('a thrown grenade bounces off a wall instead of passing through it', () => {
  const world = new World({seed: 32, brains})
  Object.assign(world.player.pos, {x: 4, y: 0, z: 9})
  world.player.yaw = 0
  world.throwGrenade()

  let bounce = null
  for (let tick = 0; tick < TICK_RATE * 2 && !bounce; tick += 1) {
    world.step()
    bounce = world.eventLog.find((event) => event.type === 'grenade_bounce' && event.colliderId === 'building_front_e')
  }

  assert.ok(bounce, 'grenade did not collide with the building wall')
  assert.ok(bounce.pos.z <= 16.61 + 1e-6)
  assert.ok(world.projectiles[0].vel.z < 0, 'grenade did not reflect away from the wall')
})

test('a grenade detonates exactly 2.5 seconds after it is thrown', () => {
  const world = new World({seed: 33, brains})
  world.step({grenade: true})
  const thrown = world.eventLog.find((event) => event.type === 'grenade_thrown')

  for (let tick = 1; tick < 2.5 * TICK_RATE; tick += 1) world.step()
  assert.equal(world.eventLog.some((event) => event.type === 'explosion'), false)
  assert.equal(world.projectiles.length, 1)

  world.step()
  const explosion = world.eventLog.find((event) => event.type === 'explosion')
  assert.ok(explosion)
  assert.equal(explosion.tick - thrown.tick, 2.5 * TICK_RATE)
  assert.equal(explosion.t - thrown.t, 2.5)
  assert.equal(explosion.radius, world.weaponCatalog.weapons.grenade.radius)
  assert.equal(world.projectiles.length, 0)
})

test('grenade damage falls off linearly to zero at its configured radius', () => {
  const world = new World({seed: 34, brains})
  const near = world.spawnUnit('heavy', {x: 2, y: 0, z: 0})
  const outside = world.spawnUnit('heavy', {x: 4.01, y: 0, z: 0})
  stageImmediateExplosion(world, {x: 0, y: 0, z: 0})

  world.step()

  assert.equal(near.hp, near.maxHp - 125)
  assert.equal(outside.hp, outside.maxHp)
  const explosion = world.eventLog.find((event) => event.type === 'explosion')
  assert.deepEqual(explosion.hits.filter((hit) => hit.kind === 'unit'), [
    {kind: 'unit', id: near.id, damage: 125, killed: false},
  ])
})

test('grenade splash damages the thrower and nearby teammates', () => {
  const world = new World({seed: 35, brains})
  const teammate = world.addPlayer({id: 'guest-1', name: 'Sarah'})
  world.player.hp = 300
  teammate.hp = 300
  Object.assign(world.player.pos, {x: 0, y: 0, z: 0})
  Object.assign(teammate.pos, {x: 2, y: 0, z: 0})
  stageImmediateExplosion(world, {x: 0, y: 0, z: 0})

  world.step()

  assert.equal(world.player.hp, 50)
  assert.equal(teammate.hp, 175)
  const playerHits = world.eventLog.find((event) => event.type === 'explosion').hits.filter((hit) => hit.kind === 'player')
  assert.deepEqual(playerHits.map((hit) => hit.id), ['player', 'guest-1'])
})

test('a grenade projectile survives a JSON snapshot round trip', () => {
  const original = new World({seed: 36, brains})
  original.throwGrenade()
  for (let tick = 0; tick < 30; tick += 1) original.step()

  const restored = new World({seed: 1, brains}).applySnapshot(JSON.parse(JSON.stringify(original.snapshot())))
  assert.deepEqual(restored.projectiles, original.projectiles)

  for (let tick = 0; tick < 150; tick += 1) {
    original.step()
    restored.step()
  }
  assert.deepEqual(restored.projectiles, original.projectiles)
  assert.deepEqual(restored.eventLog, original.eventLog)
})

test('60 seconds of grenade simulation is deterministic', {timeout: 30000}, () => {
  assert.deepEqual(runGrenadeScenario(2029), runGrenadeScenario(2029))
})

function stageImmediateExplosion(world, pos) {
  world.projectiles.push({
    id: 'grenade-player-test',
    type: 'grenade',
    playerId: world.player.id,
    pos: {...pos},
    vel: {x: 0, y: 0, z: 0},
    radius: 0.09,
    restitution: 0.35,
    friction: 0.28,
    spawnTick: world.tick - 150,
    detonateTick: world.tick,
    grounded: true,
  })
}

function runGrenadeScenario(seed) {
  const world = new World({seed, brains})
  world.player.grenades = 30
  world.player.hp = 100000
  for (let tick = 0; tick < 60 * TICK_RATE; tick += 1) {
    world.step({
      move: {x: Math.sin(tick / 75) * 0.12, z: Math.cos(tick / 90) * 0.08},
      yaw: Math.sin(tick / 240) * 1.1,
      pitch: Math.cos(tick / 180) * 0.08,
      grenade: tick % 180 === 0,
    })
  }
  return {
    projectiles: world.projectiles,
    events: world.eventLog,
    player: world.player,
    telemetry: world.telemetry,
  }
}
