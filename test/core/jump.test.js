import assert from 'node:assert/strict'
import test from 'node:test'
import mapData from '../../lib/core/data/map.json' with {type: 'json'}
import {TICK_RATE, World} from '../../lib/core/world.js'

const idleBrain = {tick() {}}
const brains = {scout: idleBrain, endo: idleBrain, heavy: idleBrain}

test('jump apex and airtime stay within ten percent of the target tune', () => {
  const world = new World({seed: 31, brains})
  const startY = world.player.pos.y
  let apex = startY
  let airborneTicks = 0
  world.step({jump: true})
  assert.equal(world.replay[0].player.jump, true)
  const snapshot = world.snapshot()
  assert.equal(snapshot.previousInputs.player.jump, true)
  assert.equal(snapshot.replay[0].player.jump, true)
  while (!world.player.grounded && airborneTicks < TICK_RATE * 2) {
    apex = Math.max(apex, world.player.pos.y)
    airborneTicks += 1
    world.step()
  }

  const apexHeight = apex - startY
  const airtime = (airborneTicks + 1) / TICK_RATE
  assert.ok(Math.abs(apexHeight - 1) <= 0.1, `apex was ${apexHeight.toFixed(3)} m`)
  assert.ok(Math.abs(airtime - 0.75) <= 0.075, `airtime was ${airtime.toFixed(3)} s`)
  assert.equal(world.player.pos.y, startY)
})

test('a second jump pulse while airborne cannot reset vertical velocity', () => {
  const world = new World({seed: 32, brains})
  world.step({jump: true})
  world.step()
  const before = world.player.vel.y
  world.step({jump: true})
  assert.ok(world.player.vel.y < before)
  assert.equal(world.eventLog.filter(({type}) => type === 'land').length, 0)
})

test('a low ceiling blocks takeoff', () => {
  const map = structuredClone(mapData)
  map.colliders.push({
    id: 'jump_test_ceiling', kind: 'floor', center: {x: 0, y: 2.3, z: 9},
    size: {x: 4, y: 0.2, z: 4}, navBlock: false, blocksSight: true,
  })
  const world = new World({map, seed: 33, brains})
  world.step({jump: true})
  assert.equal(world.player.pos.y, map.playerStart.pos.y)
  assert.equal(world.player.vel.y, 0)
  assert.equal(world.player.grounded, true)
})

test('a running jump lands on a reachable container top', () => {
  const map = structuredClone(mapData)
  map.colliders.push({
    id: 'jump_test_container', kind: 'container', center: {x: 0, y: 0.4, z: 11.5},
    size: {x: 3, y: 0.8, z: 4}, navBlock: true, blocksSight: true,
  })
  const world = new World({map, seed: 34, brains})
  for (let tick = 0; tick < 90; tick += 1) {
    world.step({move: {x: 0, z: 1}, yaw: 0, jump: tick === 0})
    if (world.player.grounded && world.player.pos.y > 0) break
  }
  assert.equal(world.player.pos.y, 0.8)
  assert.ok(world.player.pos.z > 9.5 && world.player.pos.z < 13.5)
})

test('landing emits the peak-to-surface fall height without damage', () => {
  const world = new World({seed: 35, brains})
  world.player.pos = {x: 0, y: 3, z: 9}
  world.player.vel.y = 0
  world.player.grounded = false
  for (let tick = 0; tick < TICK_RATE * 2 && !world.eventLog.some(({type}) => type === 'land'); tick += 1) world.step()
  const landing = world.eventLog.find(({type}) => type === 'land')
  assert.ok(landing)
  assert.equal(landing.playerId, world.player.id)
  assert.ok(Math.abs(landing.fallHeight - 3) <= 0.01)
  assert.equal(world.player.hp, 100)
})

test('air control preserves takeoff momentum, steering is reduced, and crouch cancels', () => {
  const world = new World({seed: 36, brains})
  world.step({move: {x: 0, z: 1}, yaw: 0, sprint: true, jump: true})
  assert.equal(Math.hypot(world.player.vel.x, world.player.vel.z), 7.5)
  world.step({move: {x: 0, z: 0}, yaw: 0, crouch: true})
  assert.equal(Math.hypot(world.player.vel.x, world.player.vel.z), 7.5)
  assert.equal(world.player.crouch, false)
  world.step({move: {x: 1, z: 0}, yaw: 0})
  assert.ok(world.player.vel.x < 0)
  assert.ok(world.player.vel.z > 7, 'air steering does not instantly replace sprint momentum')
})

test('predictPlayer matches authoritative movement throughout a jump', () => {
  const source = new World({seed: 37, brains})
  source.addPlayer({id: 'guest-1', name: 'Sarah'})
  const snapshot = JSON.parse(JSON.stringify(source.snapshot()))
  const stepped = new World({brains}).applySnapshot(snapshot)
  const predicted = new World({brains}).applySnapshot(snapshot)

  for (let tick = 0; tick < 50; tick += 1) {
    const inputs = {
      move: {x: tick > 12 ? 0.35 : 0, z: 1}, yaw: tick / 100, pitch: -0.1,
      sprint: tick < 18, crouch: tick === 20, jump: tick === 0 || tick === 14,
    }
    stepped.step({'guest-1': inputs})
    predicted.predictPlayer('guest-1', inputs)
    assert.deepEqual(movementState(predicted.getPlayer('guest-1')), movementState(stepped.getPlayer('guest-1')), `prediction drifted at tick ${tick}`)
  }
})

function movementState(player) {
  return {
    pos: player.pos, vel: player.vel, yaw: player.yaw, pitch: player.pitch,
    crouch: player.crouch, moving: player.moving, sprinting: player.sprinting,
    sprintStamina: player.sprintStamina, grounded: player.grounded, airbornePeakY: player.airbornePeakY,
  }
}
