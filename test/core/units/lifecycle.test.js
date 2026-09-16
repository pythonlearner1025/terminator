import assert from 'node:assert/strict'
import test from 'node:test'
import * as enragedBrain from '../../../lib/core/brains/enraged.js'
import {World} from '../../../lib/core/world.js'

const idle = {tick() {}}
const brains = Object.fromEntries(['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank'].map((type) => [type, idle]))

test('the scout is the cheap common and every other type carries its role', () => {
  const {types, maxAlive} = new World({brains}).unitCatalog
  assert.equal(maxAlive, 32)
  assert.equal(types.scout.role, 'common')
  assert.equal(types.scout.cost, 12)
  assert.equal(types.scout.hp, 60)
  assert.equal(types.scout.damage, 3)
  assert.equal(types.scout.cooldown, 1)
  assert.equal(types.scout.scrap, 12)
  assert.deepEqual(['endo', 'heavy', 't1000', 'hkaerial'].map((id) => types[id].role), ['special', 'special', 'special', 'special'])
  assert.equal(types.hktank.role, 'boss')
})

test('despawnUnit removes a unit silently and pays no scrap', () => {
  const world = new World({seed: 51, brains})
  const unit = world.spawnUnit('scout', {x: 6, y: 0, z: 14})
  const scrap = world.player.scrap
  const events = world.eventLog.length

  assert.equal(world.despawnUnit(unit.id), true)
  assert.equal(world.eventLog.length, events, 'despawn emits nothing')
  assert.equal(world.player.scrap, scrap, 'despawn pays no scrap')
  assert.equal(world.units.includes(unit), false)
  assert.equal(world.aliveUnits.length, 0)
  assert.equal(world.unitById.has(unit.id), false)
  assert.equal(world.telemetry.units[unit.id].causeOfDeath, 'despawned')
  assert.equal(world.telemetry.unitTypes.scout.killed, 0)
  assert.equal(world.telemetry.kills.length, 0)
  assert.equal(world.despawnUnit(unit.id), false)
})

test('a killed unit still emits its death event and pays scrap', () => {
  const world = new World({seed: 52, brains})
  const unit = world.spawnUnit('scout', {x: 6, y: 0, z: 14})
  const scrap = world.player.scrap
  world.damageUnit(unit.id, unit.hp, {source: 'player', playerId: world.player.id, weapon: 'pistol'})

  assert.equal(world.eventLog.some((event) => event.type === 'unit_death' && event.unitId === unit.id), true)
  assert.equal(world.player.scrap, scrap + 12)
})

test('unitSeenByAnyPlayer needs line of sight inside a hundred degree cone', () => {
  const world = new World({seed: 53, brains})
  world.player.yaw = 0
  const front = world.spawnUnit('scout', {x: 0, y: 0, z: 14})
  assert.equal(world.unitSeenByAnyPlayer(front), true)

  world.player.yaw = Math.PI
  assert.equal(world.unitSeenByAnyPlayer(front), false, 'a unit behind the player is unseen')

  // Just outside half of the hundred degree cone.
  world.player.yaw = 0
  const side = world.spawnUnit('scout', {x: 5, y: 0, z: 12.5})
  assert.equal(Math.abs(Math.atan2(5, 3.5)) > 50 * Math.PI / 180, true)
  assert.equal(world.unitSeenByAnyPlayer(side), false)

  world.player.alive = false
  assert.equal(world.unitSeenByAnyPlayer(front), false, 'a dead player sees nothing')
})

test('a wanderer records the tick a player last saw it, at 2 Hz', () => {
  const world = new World({seed: 54, brains})
  world.player.yaw = Math.PI
  const unit = world.spawnUnit('scout', {x: 0, y: 0, z: 14}, {wanderer: true})
  const spawnTick = unit.lastSeenByPlayerTick
  assert.equal(spawnTick, 0)

  for (let tick = 0; tick < 60; tick += 1) world.step({yaw: Math.PI})
  assert.equal(unit.lastSeenByPlayerTick, spawnTick, 'an unseen wanderer keeps its old sighting')

  for (let tick = 0; tick < 60; tick += 1) world.step({yaw: 0})
  assert.ok(unit.lastSeenByPlayerTick > 60, 'a seen wanderer refreshes its sighting')
  assert.equal(unit.lastSeenByPlayerTick % 30, 0, 'the sight check runs at 2 Hz')

  const plain = world.spawnUnit('scout', {x: 1, y: 0, z: 14})
  for (let tick = 0; tick < 60; tick += 1) world.step({yaw: 0})
  assert.equal(plain.lastSeenByPlayerTick, null, 'only wanderers are tracked')
})

test('enraged, wanderer, knockback and lastSeenByPlayerTick round trip through a snapshot', () => {
  const world = new World({seed: 55, brains})
  world.player.yaw = 0
  const enraged = world.spawnUnit('scout', {x: 0, y: 0, z: 10.2}, {id: 'mob-1', enraged: true})
  const wanderer = world.spawnUnit('scout', {x: -8, y: 0, z: 14}, {id: 'wander-1', wanderer: true})
  for (let tick = 0; tick < 30; tick += 1) world.step({})
  assert.equal(world.playerMelee(), true)
  assert.ok(enraged.knockback.ticksLeft > 0)

  const json = JSON.stringify(world.snapshot())
  const restored = new World({seed: 1, brains}).applySnapshot(JSON.parse(json))
  const restoredEnraged = restored.unitById.get('mob-1')
  const restoredWanderer = restored.unitById.get('wander-1')

  assert.equal(restoredEnraged.enraged, true)
  assert.equal(restoredEnraged.brain, enragedBrain, 'the enraged brain survives the snapshot')
  assert.deepEqual(restoredEnraged.knockback, enraged.knockback)
  assert.equal(restoredWanderer.wanderer, true)
  assert.equal(restoredWanderer.lastSeenByPlayerTick, wanderer.lastSeenByPlayerTick)

  for (let tick = 0; tick < 60; tick += 1) {
    world.step({})
    restored.step({})
  }
  assert.deepEqual(restored.snapshot(), world.snapshot())
})
