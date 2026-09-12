import assert from 'node:assert/strict'
import test from 'node:test'
import {defaultMap as map} from '../../lib/core/map.js'
import {World} from '../../lib/core/world.js'

test('A* routes around the authored courtyard divider', () => {
  const world = new World({seed: 1})
  const start = {x: -3, y: 0, z: 0}
  const end = {x: 3, y: 0, z: 0}
  const path = world.findPath(start, end)
  assert.ok(path)
  assert.ok(path.length > 8, `expected a detour, got ${path.length} cells`)
  for (const point of path) assert.equal(world.nav.isBlocked(world.nav.worldToCell(point)), false)
  assert.equal(map.colliders.some(({id}) => id === 'courtyard_divider'), true)
})

test('line of sight is blocked by a collider and clear beside it', () => {
  const world = new World({seed: 1})
  assert.equal(world.lineOfSight({x: -5, y: 1, z: 0}, {x: 5, y: 1, z: 0}), false)
  assert.equal(world.lineOfSight({x: -5, y: 1, z: 8}, {x: 5, y: 1, z: 8}), true)
})
