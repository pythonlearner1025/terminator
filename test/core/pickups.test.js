import assert from 'node:assert/strict'
import test from 'node:test'
import {defaultMap as map} from '../../lib/core/map.js'
import {
  CACHE_AMMO_SHARE,
  CACHE_ARMOR,
  CACHE_GRENADES,
  CACHE_PICKUP_RADIUS,
  Pickups,
  WEAPON_CACHE_WAVE,
} from '../../lib/core/pickups.js'
import {SeededRng} from '../../lib/core/rng.js'
import {World} from '../../lib/core/world.js'

const kinds = pickups => pickups.active.map(cache => cache.kind)
const ids = pickups => pickups.active.map(cache => cache.id)
const taken = world => world.eventLog.filter(event => event.type === 'cache_taken')
const spawned = world => world.eventLog.filter(event => event.type === 'cache_spawned')

function planned(world, wave, seed = 4) {
  world.pickups.plan(wave, new SeededRng(seed))
  return world.pickups
}

// One cache under the player's feet isolates an effect from the map layout.
function collect(world, kind, playerId = 'player') {
  const player = world.getPlayer(playerId)
  world.pickups.active = [{id: `test_${kind}`, kind, pos: {...player.pos}}]
  world.pickups.announced = true
  world.pickups.step(world)
  return player
}

test('a plan fills four spots with one cache of each kind', () => {
  const world = new World({seed: 11})
  const pickups = planned(world, 3)
  assert.equal(pickups.active.length, 4)
  assert.deepEqual(kinds(pickups), ['weapon', 'armor', 'ammo', 'grenades'])
  assert.equal(new Set(ids(pickups)).size, 4)
  for (const cache of pickups.active) {
    const spot = map.cacheSpots.find(item => item.id === cache.id)
    assert.ok(spot, `${cache.id} is not an authored cache spot`)
    assert.deepEqual(cache.pos, spot.pos)
  }
})

test('the weapon cache starts at wave one and hands over m4, shotgun, then plasma', () => {
  const world = new World({seed: 12})
  assert.equal(WEAPON_CACHE_WAVE, 1, 'a revolver alone cannot hold wave one')
  assert.deepEqual(kinds(planned(world, 1)), ['weapon', 'armor', 'ammo', 'grenades'])
  assert.deepEqual(kinds(planned(world, 2)), ['weapon', 'armor', 'ammo', 'grenades'])
  const player = collect(world, 'weapon')
  assert.equal(player.ammo.m4.owned, true)
  assert.equal(player.ammo.m4.mag, world.weaponCatalog.weapons.m4.mag)
  assert.equal(player.ammo.shotgun.owned, false)
  collect(world, 'weapon')
  assert.equal(player.ammo.shotgun.owned, true)
  collect(world, 'weapon')
  assert.equal(player.ammo.plasma.owned, true)
})

test('a weapon cache falls back to ammunition once the player owns all three', () => {
  const world = new World({seed: 13})
  const player = world.player
  world.giveAllWeapons()
  player.ammo.m4.reserve = 0
  collect(world, 'weapon')
  assert.equal(player.ammo.m4.reserve, Math.round(world.weaponCatalog.weapons.m4.reserveMax * CACHE_AMMO_SHARE))
})

test('armor, ammunition and grenade caches apply their amounts and respect the caps', () => {
  const world = new World({seed: 14})
  const player = world.player
  assert.equal(collect(world, 'armor').armor, CACHE_ARMOR)
  player.armor = 80
  assert.equal(collect(world, 'armor').armor, 100)
  player.grenades = 1
  assert.equal(collect(world, 'grenades').grenades, 1 + CACHE_GRENADES)
  player.grenades = world.weaponCatalog.weapons.grenade.max
  assert.equal(collect(world, 'grenades').grenades, world.weaponCatalog.weapons.grenade.max)
  player.ammo.pistol.reserve = 0
  player.ammo.m4.reserve = 0
  collect(world, 'ammo')
  assert.equal(player.ammo.pistol.reserve, Math.round(world.weaponCatalog.weapons.pistol.reserveMax * CACHE_AMMO_SHARE))
  assert.equal(player.ammo.m4.reserve, 0, 'an unowned weapon gets nothing')
  player.ammo.pistol.reserve = world.weaponCatalog.weapons.pistol.reserveMax
  collect(world, 'ammo')
  assert.equal(player.ammo.pistol.reserve, world.weaponCatalog.weapons.pistol.reserveMax)
})

test('a cache is taken inside 1.2 metres and left alone outside it', () => {
  const world = new World({seed: 15})
  const player = world.player
  const pos = {x: player.pos.x, y: player.pos.y, z: player.pos.z + CACHE_PICKUP_RADIUS + .05}
  world.pickups.active = [{id: 'cache_test', kind: 'armor', pos}]
  world.pickups.announced = true
  world.pickups.step(world)
  assert.equal(world.pickups.active.length, 1)
  assert.equal(player.armor, 0)
  pos.z = player.pos.z + CACHE_PICKUP_RADIUS - .05
  world.pickups.step(world)
  assert.equal(world.pickups.active.length, 0)
  assert.equal(player.armor, CACHE_ARMOR)
})

test('a dead player takes nothing', () => {
  const world = new World({seed: 16})
  world.player.alive = false
  collect(world, 'armor')
  assert.equal(world.pickups.active.length, 1)
  assert.equal(world.player.armor, 0)
})

test('the world steps the caches and reports both cache events once', () => {
  const world = new World({seed: 17})
  const pickups = planned(world, 4)
  const cache = pickups.active[1]
  world.step()
  assert.equal(spawned(world).length, 4)
  assert.deepEqual(spawned(world).map(event => event.kind), ['weapon', 'armor', 'ammo', 'grenades'])
  assert.deepEqual(spawned(world)[1], {...spawned(world)[1], id: cache.id, kind: 'armor', pos: cache.pos})
  world.player.pos = {...cache.pos}
  const state = world.rng.state
  world.step()
  assert.equal(spawned(world).length, 4, 'cache_spawned fires once per plan')
  assert.equal(taken(world).length, 1)
  assert.deepEqual(taken(world)[0], {...taken(world)[0], id: cache.id, kind: 'armor', playerId: 'player', pos: cache.pos})
  assert.equal(world.player.armor, CACHE_ARMOR)
  assert.equal(pickups.active.length, 3)
  assert.equal(world.rng.state, state, 'taking a cache must not consume world randomness')
})

test('caches round trip through a world snapshot', () => {
  const host = new World({seed: 18})
  planned(host, 5)
  host.step()
  host.setTraderSpot('trader_dock')
  const guest = new World({seed: 99})
  guest.applySnapshot(host.snapshot())
  assert.deepEqual(guest.pickups.snapshot(), host.pickups.snapshot())
  assert.deepEqual(guest.pickups.active, host.pickups.active)
  assert.equal(guest.traderSpotId, 'trader_dock')
  assert.deepEqual(guest.map.trader.pos, host.map.trader.pos)
  guest.step()
  assert.equal(spawned(guest).length, 4, 'a restored plan does not announce itself again')
})

test('planning is deterministic and only reads the rng it is given', () => {
  const first = new Pickups(map)
  const second = new Pickups(map)
  first.plan(3, new SeededRng(7))
  second.plan(3, new SeededRng(7))
  assert.deepEqual(ids(first), ids(second))
  second.plan(3, new SeededRng(8))
  assert.notDeepEqual(ids(first), ids(second))
  const world = new World({seed: 19})
  const state = world.rng.state
  world.pickups.plan(3, new SeededRng(7))
  assert.equal(world.rng.state, state)
  assert.deepEqual(ids(world.pickups), ids(first))
})
