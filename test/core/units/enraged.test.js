import assert from 'node:assert/strict'
import test from 'node:test'
import * as enragedBrain from '../../../lib/core/brains/enraged.js'
import {World} from '../../../lib/core/world.js'

const idle = {tick() {}}
const brains = Object.fromEntries(['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank'].map((type) => [type, idle]))

function distanceToPlayer(world, unit) {
  return Math.hypot(unit.pos.x - world.player.pos.x, unit.pos.z - world.player.pos.z)
}

test('an enraged unit reaches a silent player it cannot see', () => {
  const world = new World({seed: 41})
  const unit = world.spawnUnit('scout', {x: 40, y: 0, z: 0}, {enraged: true})
  assert.equal(unit.enraged, true)
  assert.ok(distanceToPlayer(world, unit) > world.unitCatalog.types.scout.visionRange)

  let contactTick = null
  for (let tick = 0; tick < 20 * 60; tick += 1) {
    world.step({})
    if (contactTick === null && distanceToPlayer(world, unit) <= 2) contactTick = tick
  }
  assert.notEqual(contactTick, null, 'the enraged unit never reached the player')
  assert.ok(world.player.hp < 100, 'the enraged unit never attacked the player')
})

test('a default-brain unit at the same spot never finds the silent player', () => {
  const world = new World({seed: 41})
  const unit = world.spawnUnit('scout', {x: 40, y: 0, z: 0})
  let closest = Infinity
  for (let tick = 0; tick < 20 * 60; tick += 1) {
    world.step({})
    closest = Math.min(closest, distanceToPlayer(world, unit))
  }
  assert.ok(closest > 10, `default brain closed to ${closest.toFixed(2)} m without a stimulus`)
})

test('tickBrain refreshes lastKnownPlayer for an enraged unit that lost sight', () => {
  const world = new World({seed: 12})
  const unit = world.spawnUnit('scout', {x: 40, y: 0, z: 0}, {enraged: true})
  unit.lastKnownPlayer = null
  world.tickBrain(unit)
  assert.equal(unit.lastKnownPlayer?.id, world.player.id)
  assert.deepEqual(unit.lastKnownPlayer.pos, {x: 0, y: 0, z: 9})

  world.player.pos = {x: 4, y: 0, z: 9}
  world.tickBrain(unit)
  assert.equal(unit.lastKnownPlayer.pos.x, 4)
})

test('enrageUnit switches a living unit to the enraged brain and points it at the nearest player', () => {
  const world = new World({seed: 13, brains})
  const unit = world.spawnUnit('scout', {x: 20, y: 0, z: 9})
  assert.equal(unit.enraged, false)
  assert.equal(world.enrageUnit(unit.id), true)
  assert.equal(unit.enraged, true)
  assert.equal(unit.brain, enragedBrain)
  assert.equal(unit.lastKnownPlayer.id, world.player.id)
  assert.equal(world.enrageUnit(unit.id), false, 'enraging twice is a no-op')
  assert.equal(world.enrageUnit('missing'), false)
})

test('alerted spawn sets lastKnownPlayer and wanderer spawn starts sight tracking', () => {
  const world = new World({seed: 14, brains})
  const alerted = world.spawnUnit('scout', {x: 40, y: 0, z: 0}, {alerted: true})
  assert.equal(alerted.lastKnownPlayer.id, world.player.id)
  assert.deepEqual(alerted.lastKnownPlayer.pos, {x: 0, y: 0, z: 9})
  assert.equal(alerted.enraged, false)

  const wanderer = world.spawnUnit('scout', {x: -40, y: 0, z: 0}, {wanderer: true})
  assert.equal(wanderer.wanderer, true)
  assert.equal(wanderer.lastSeenByPlayerTick, world.tick)
  assert.equal(wanderer.lastKnownPlayer, null)

  const plain = world.spawnUnit('scout', {x: 0, y: 0, z: 28})
  assert.equal(plain.wanderer, false)
  assert.equal(plain.lastSeenByPlayerTick, null)
  assert.equal(plain.lastKnownPlayer, null)
})

// Regression: a mob spawned on the barracks roof has to come down the stairs.
// Five commons were once found parked at y 1.0 in that yard while the wave
// waited for them. Look-ahead steering already stops at every height change;
// this pins the descent so it stays that way.
test('an enraged common walks off barracks_upper and reaches the player spawn', () => {
  const world = new World({seed: 17})
  world.phase = 'wave'
  const spot = world.map.spawnSpots.find(({id}) => id === 'barracks_upper')
  assert.ok(spot, 'the map still has the barracks_upper spawn spot')
  const unit = world.spawnUnit('scout', {...spot.pos}, {yaw: spot.yaw || 0, enraged: true})
  world.player.hp = 100000

  let arrivedTick = null
  for (let tick = 0; tick < 60 * 60 && arrivedTick === null; tick += 1) {
    world.step({})
    if (distanceToPlayer(world, unit) <= 3) arrivedTick = tick
  }
  assert.notEqual(arrivedTick, null, `stuck at ${JSON.stringify(unit.pos)} after 60 s`)
  assert.ok(arrivedTick < 30 * 60, `the descent took ${(arrivedTick / 60).toFixed(1)} s`)
})
