import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../../lib/core/world.js'

const idle = {tick() {}}
const brains = Object.fromEntries(['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank'].map((type) => [type, idle]))

const gap = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)

test('separation keeps two commons from stacking', () => {
  const world = new World({seed: 31, brains})
  const left = world.spawnUnit('scout', {x: 0, y: 0, z: 14}, {id: 'left'})
  const right = world.spawnUnit('scout', {x: 0.2, y: 0, z: 14}, {id: 'right'})
  assert.ok(gap(left, right) < 0.25)

  for (let tick = 0; tick < 60; tick += 1) world.step({})
  assert.ok(gap(left, right) > 1, `commons stayed ${gap(left, right).toFixed(3)} m apart`)
})

test('separation splits two exactly stacked commons', () => {
  const world = new World({seed: 32, brains})
  const first = world.spawnUnit('scout', {x: 5, y: 0, z: 14}, {id: 'first'})
  const second = world.spawnUnit('scout', {x: 5, y: 0, z: 14}, {id: 'second'})
  assert.equal(gap(first, second), 0)

  for (let tick = 0; tick < 60; tick += 1) world.step({})
  assert.ok(gap(first, second) > 1, `stacked commons stayed ${gap(first, second).toFixed(3)} m apart`)
})

test('separation leaves specials alone', () => {
  const world = new World({seed: 33, brains})
  const left = world.spawnUnit('endo', {x: 0, y: 0, z: 14}, {id: 'left'})
  const right = world.spawnUnit('endo', {x: 0.5, y: 0, z: 14}, {id: 'right'})
  for (let tick = 0; tick < 60; tick += 1) world.step({})
  assert.equal(gap(left, right), 0.5)
})

test('a mob of twenty enraged commons spreads out instead of queueing', () => {
  const world = new World({seed: 34})
  const mob = []
  for (let index = 0; index < 20; index += 1) {
    mob.push(world.spawnUnit('scout', {x: -16 + (index % 4) * 0.3, y: 0, z: 28 - Math.floor(index / 4) * 0.3}, {enraged: true}))
  }
  assert.equal(world.aliveUnits.length, 20)
  for (let tick = 0; tick < 180; tick += 1) world.step({})

  const living = world.aliveUnits
  let tooClose = 0
  for (let a = 0; a < living.length; a += 1) {
    for (let b = a + 1; b < living.length; b += 1) if (gap(living[a], living[b]) < 0.5) tooClose += 1
  }
  assert.equal(tooClose, 0, 'no two commons overlap after three seconds')
  const spread = Math.max(...living.map((unit) => unit.pos.x)) - Math.min(...living.map((unit) => unit.pos.x))
  assert.ok(spread > 2, `the mob front is only ${spread.toFixed(2)} m wide`)
})

test('look-ahead steers past the next node without leaving the navigation grid', () => {
  let goal = {x: 0, y: 0, z: 9}
  const world = new World({seed: 35, brains: {...brains, scout: {tick(self, sense, act) { act.moveTo(goal) }}}})
  world.player.alive = false
  const unit = world.spawnUnit('scout', {x: -16, y: 0, z: 28})
  const path = world.findPath(unit.pos, goal)
  assert.ok(path.length > 4)

  const target = world.lookAheadPoint(unit, path, 0)
  const nextNode = path[0]
  assert.ok(Math.hypot(target.x - unit.pos.x, target.z - unit.pos.z)
    > Math.hypot(nextNode.x - unit.pos.x, nextNode.z - unit.pos.z), 'the steer point is beyond the next node')
  assert.ok(Math.hypot(target.x - unit.pos.x, target.z - unit.pos.z) <= 2.001, 'the steer point stays inside the look-ahead')

  const radius = world.unitCatalog.types.scout.radius
  for (let tick = 0; tick < 600; tick += 1) {
    world.step({})
    assert.equal(world.positionBlocked(unit.pos, radius, 1.85), false, `scout penetrates solid at ${JSON.stringify(unit.pos)}`)
  }
  assert.ok(Math.hypot(unit.pos.x - goal.x, unit.pos.z - goal.z) < 1.5, 'the unit still reaches its goal')
})

test('a mob of enraged commons replays identically from the same seed', () => {
  const run = () => {
    const world = new World({seed: 36})
    for (let index = 0; index < 12; index += 1) {
      const unit = world.spawnUnit('scout', {x: -1.5 + (index % 4) * 0.4, y: 0, z: 12 + Math.floor(index / 4) * 0.4}, {enraged: true})
      unit.hp = 5000
      unit.maxHp = 5000
    }
    world.player.yaw = 0
    world.player.pitch = -0.4
    world.player.activeWeapon = 'shotgun'
    world.player.ammo.shotgun = {owned: true, mag: 8, reserve: 64}
    let shovedTicks = 0
    for (let tick = 0; tick < 300; tick += 1) {
      if (tick % 40 === 0) world.playerFire()
      if (tick % 53 === 0) world.playerMelee()
      world.step({})
      if (world.aliveUnits.some((unit) => unit.knockback)) shovedTicks += 1
    }
    return {shovedTicks, state: JSON.stringify(world.snapshot())}
  }
  const first = run()
  const second = run()
  assert.ok(first.shovedTicks > 0, 'the replay exercised the push path')
  assert.equal(first.shovedTicks, second.shovedTicks)
  assert.equal(first.state, second.state)
})
