import assert from 'node:assert/strict'
import test from 'node:test'
import map from '../../lib/core/data/map.json' with {type: 'json'}
import {World} from '../../lib/core/world.js'

const balconyFloor = colliderTop('building_balcony')

test('player climbs from the courtyard to the balcony with scripted input', () => {
  const world = new World({seed: 11})
  world.configureMap({doors: {building_ground: 'unlocked', building_balcony: 'unlocked'}})
  const heights = []
  for (const waypoint of [
    {x: 0, z: 18},
    {x: 10, z: 25.5},
    {x: 10, z: 18.5},
    {x: 0, z: 18.5},
    {x: 0, z: 15.7},
  ]) walkPlayerTo(world, waypoint, heights)

  assert.ok(Math.hypot(world.player.pos.x, world.player.pos.z - 15.7) < 0.2)
  assert.equal(world.player.pos.y, balconyFloor)
  for (const tread of [0.5, 1, 1.5, 2, 2.5, 3]) {
    assert.ok(heights.some((height) => Math.abs(height - tread) < 1e-6), `missing stair tread ${tread}`)
  }
})

test('player cannot enter the second floor slab from below', () => {
  const world = new World({seed: 12})
  const slab = map.colliders.find(({id}) => id === 'building_second_floor')
  const slabBottom = slab.center.y - slab.size.y / 2
  world.player.pos = {x: 5, y: 1, z: 22}
  world.player.vel.y = 20
  let highestHead = -Infinity
  for (let tick = 0; tick < 90; tick += 1) {
    world.step()
    highestHead = Math.max(highestHead, world.player.pos.y + 1.8)
  }
  assert.ok(highestHead <= slabBottom + 1e-6, `head reached ${highestHead} above slab bottom ${slabBottom}`)
  assert.equal(world.player.pos.y, colliderTop('building_ground_floor'))
})

test('player falls off the balcony edge and lands on the ground', () => {
  const world = new World({seed: 13})
  world.player.pos = {x: 0, y: balconyFloor, z: 15.5}
  for (let tick = 0; tick < 30; tick += 1) {
    world.step({move: {x: 0, z: 1}, yaw: Math.PI, pitch: 0})
  }
  assert.ok(world.player.pos.y > 0 && world.player.pos.y < balconyFloor)
  assert.ok(world.player.vel.y < 0)
  for (let tick = 0; tick < 90; tick += 1) world.step()
  assert.equal(world.player.pos.y, colliderTop('ground'))
  assert.equal(world.player.vel.y, 0)
})

test('Scout paths from a spawn gate to the balcony and follows surface height', () => {
  const target = {x: 0, y: balconyFloor, z: 15.5}
  const climb = {tick(self, sense, act) { act.moveTo(target) }}
  const world = new World({seed: 14, brains: {scout: climb}})
  world.configureMap({doors: {building_ground: 'unlocked', building_balcony: 'unlocked'}})
  world.player.alive = false
  const gate = map.spawnGates.find(({id}) => id === 'S2')
  const scout = world.spawnUnit('scout', gate.pos, {yaw: gate.yaw})
  for (let tick = 0; tick < 900; tick += 1) world.step()

  assert.ok(Math.hypot(scout.pos.x - target.x, scout.pos.z - target.z) <= 0.6)
  assert.equal(scout.pos.y, balconyFloor)
  assert.ok(scout.pathCache.path.some(({y}) => y === 0.5))
  assert.ok(scout.pathCache.path.some(({y}) => y === balconyFloor))
  const sense = world.buildSense(scout, [])
  assert.ok(sense.nav.pathTo(target))
  assert.equal(sense.nav.coverNear(target, {x: 0, y: 1.65, z: 9}, 8)?.y, balconyFloor)
})

test('Heavy cannot path to stairs blocked by a locked door', () => {
  const target = {x: 0, y: balconyFloor, z: 15.5}
  const world = new World({seed: 15, brains: {heavy: {tick() {}}}})
  world.configureMap({doors: {building_ground: 'locked', building_balcony: 'unlocked'}})
  const gate = map.spawnGates.find(({id}) => id === 'S2')
  const heavy = world.spawnUnit('heavy', gate.pos, {yaw: gate.yaw})
  assert.equal(world.buildSense(heavy, []).nav.pathTo(target), null)
  assert.ok(world.findPath({x: 10, y: balconyFloor, z: 22}, target), 'ground door must not block the upper level')

  const balconyLocked = new World({seed: 16})
  balconyLocked.configureMap({doors: {building_ground: 'unlocked', building_balcony: 'locked'}})
  assert.ok(
    balconyLocked.findPath({x: 0, y: 0, z: 9}, {x: 0, y: colliderTop('building_ground_floor'), z: 22}),
    'balcony door must not block the ground level',
  )
})

test('balcony line of sight reaches the courtyard but the slab blocks vertical sight', () => {
  const world = new World({seed: 17})
  assert.equal(world.lineOfSight({x: 5, y: 4.7, z: 15.5}, {x: 5, y: 1.65, z: 9}), true)
  assert.equal(world.lineOfSight({x: 5, y: 1, z: 22}, {x: 5, y: 4.5, z: 22}), false)
})

function walkPlayerTo(world, target, heights, maxTicks = 600) {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const dx = target.x - world.player.pos.x
    const dz = target.z - world.player.pos.z
    if (Math.hypot(dx, dz) < 0.12) return
    world.step({move: {x: 0, z: 1}, yaw: Math.atan2(dx, dz), pitch: 0})
    heights.push(world.player.pos.y)
  }
  assert.fail(`player did not reach ${JSON.stringify(target)} from ${JSON.stringify(world.player.pos)}`)
}

function colliderTop(id) {
  const collider = map.colliders.find((item) => item.id === id)
  return collider.center.y + collider.size.y / 2
}
