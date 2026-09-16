import assert from 'node:assert/strict'
import test from 'node:test'
import {buildMapFromPlacements, defaultMap as map} from '../../lib/core/map.js'
import {NavGrid} from '../../lib/core/nav.js'
import {PLAYER_RADIUS, World} from '../../lib/core/world.js'

const CACHE_SPACING = 8
const world = new World({seed: 91})
// The crate blocks its own cell, so the trader spots are judged without it.
const crateFreeMap = {...map, trader: {...map.trader, navBlock: false, blocksSight: false}}
const crateFreeNav = new NavGrid(crateFreeMap, world.dynamicColliders())

// A spot is good when a walkable surface carries it and the grid cell that
// holds it is open, both within the one step the movement code allows.
function standsOn(nav, pos) {
  const cell = nav.worldToCell(pos)
  return nav.walkableSurfacesAt(pos, nav.spec.agentRadius).some(item => Math.abs(item.y - pos.y) <= nav.maxStep)
    && nav.nodesAt(cell.x, cell.z).some(node => nav.blocked[node.index] === 0 && Math.abs(node.y - pos.y) <= nav.maxStep)
}

function reaches(nav, pos) {
  const path = nav.findPath(map.playerStart.pos, pos)
  const end = path?.at(-1)
  return Boolean(end) && Math.hypot(end.x - pos.x, end.z - pos.z) < 1.2 && Math.abs(end.y - pos.y) <= nav.maxStep
}

function floorUnderCrate(spot) {
  return {x: spot.pos.x, y: spot.pos.y - map.trader.size.y / 2, z: spot.pos.z}
}

test('every cache and interior spawn spot stands on reachable walkable ground', () => {
  assert.equal(map.cacheSpots.length, 12)
  assert.equal(map.spawnSpots.length, 10)
  for (const spot of [...map.cacheSpots, ...map.spawnSpots]) {
    assert.equal(standsOn(world.nav, spot.pos), true, `${spot.id} has no open walkable surface`)
    assert.equal(world.positionBlocked(spot.pos, PLAYER_RADIUS), false, `${spot.id} sits inside a collider`)
    assert.equal(reaches(world.nav, spot.pos), true, `${spot.id} is unreachable from the player start`)
  }
})

test('the extraction point is open ground beside gate E1', () => {
  const gate = map.spawnGates.find(item => item.id === map.extraction.gateId)
  assert.equal(map.extraction.gateId, 'E1')
  assert.equal(map.extraction.holdSeconds, 180)
  assert.ok(Math.hypot(gate.pos.x - map.extraction.pos.x, gate.pos.z - map.extraction.pos.z) < 8)
  assert.equal(standsOn(world.nav, map.extraction.pos), true)
  assert.equal(world.positionBlocked(map.extraction.pos, PLAYER_RADIUS), false)
  assert.equal(reaches(world.nav, map.extraction.pos), true)
})

test('every trader spot puts the crate on reachable walkable ground', () => {
  assert.equal(map.traderSpots.length, 4)
  assert.deepEqual(map.traderSpots[0].pos, map.trader.pos)
  for (const spot of map.traderSpots) {
    const floor = floorUnderCrate(spot)
    assert.equal(standsOn(crateFreeNav, floor), true, `${spot.id} has no open walkable surface`)
    assert.equal(reaches(crateFreeNav, floor), true, `${spot.id} is unreachable from the player start`)
  }
})

test('cache spots are unique and at least eight metres apart', () => {
  const spots = map.cacheSpots
  assert.equal(new Set(spots.map(spot => spot.id)).size, spots.length)
  for (const [index, spot] of spots.entries()) {
    for (const other of spots.slice(index + 1)) {
      const gap = Math.hypot(spot.pos.x - other.pos.x, spot.pos.y - other.pos.y, spot.pos.z - other.pos.z)
      assert.ok(gap >= CACHE_SPACING, `${spot.id} and ${other.id} are ${gap.toFixed(2)} m apart`)
    }
  }
})

test('moving the trader keeps every spot reachable and announces the move', () => {
  for (const spot of map.traderSpots.slice(1)) {
    const moved = new World({seed: 92})
    assert.equal(moved.setTraderSpot(spot.id), true)
    assert.deepEqual(moved.map.trader.pos, spot.pos)
    assert.deepEqual(moved.map.trader.center, spot.pos)
    assert.equal(moved.traderSpotId, spot.id)
    const event = moved.eventLog.at(-1)
    assert.equal(event.type, 'trader_moved')
    assert.deepEqual(event, {...event, id: spot.id, pos: spot.pos})
    assert.equal(moved.setTraderSpot(spot.id), false, 'a repeated move must not rebuild navigation')
    assert.equal(moved.setTraderSpot('nowhere'), false)
    for (const target of [...map.cacheSpots, ...map.spawnSpots, {id: 'extraction', pos: map.extraction.pos}]) {
      assert.equal(reaches(moved.nav, target.pos), true, `${target.id} is unreachable with the trader at ${spot.id}`)
    }
    // The authored map keeps the position every other world loaded it with.
    assert.deepEqual(map.trader.pos, map.traderSpots[0].pos)
  }
})

test('map.js normalizes authored spots and tolerates a map without them', () => {
  for (const spot of [...map.cacheSpots, ...map.traderSpots, ...map.spawnSpots]) {
    assert.deepEqual(Object.keys(spot), ['id', 'pos', 'yaw'])
    assert.deepEqual(Object.keys(spot.pos), ['x', 'y', 'z'])
    assert.equal(Number.isFinite(spot.yaw), true)
  }
  assert.equal(map.spawnSpots.every(spot => map.spawnGates.every(gate => gate.id !== spot.id)), true)
  const bare = buildMapFromPlacements(bareRules(), {assets: {}}, [])
  assert.deepEqual(bare.cacheSpots, [])
  assert.deepEqual(bare.traderSpots, [])
  assert.deepEqual(bare.spawnSpots, [])
  assert.equal(bare.extraction, null)
})

function bareRules() {
  const rules = structuredClone({...map, colliders: [], mapPieces: []})
  delete rules.cacheSpots
  delete rules.traderSpots
  delete rules.spawnSpots
  delete rules.extraction
  return rules
}
