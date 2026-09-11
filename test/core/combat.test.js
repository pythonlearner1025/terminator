import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../lib/core/world.js'

test('hitscan doubles head damage and halves frontal Heavy plate damage', () => {
  const headWorld = new World({seed: 7})
  const headTarget = headWorld.spawnUnit('heavy', {x: 10, y: 0, z: 0}, {yaw: 0})
  const head = headWorld.hitscan({
    origin: {x: 10, y: 1.89, z: 5},
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
    origin: {x: 10, y: 0.9, z: 5},
    direction: {x: 0, y: 0, z: -1},
    damage: 100,
  })
  assert.equal(plate.kind, 'unit')
  assert.equal(plate.plate, true)
  assert.equal(plate.damage, 50)
  assert.equal(plateTarget.hp, 850)
})
