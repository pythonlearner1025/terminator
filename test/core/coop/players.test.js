import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../../lib/core/world.js'

const idleBrain = {tick() {}}
const makeWorld = () => new World({seed: 2029, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})

test('two players keep separate input history, ammo, scrap, and purchases', () => {
  const world = makeWorld()
  const guest = world.addPlayer({id: 'guest-1', name: 'Kyle'})
  const startingMag = world.player.ammo.pistol.mag

  world.step({
    player: {fire: true},
    'guest-1': {move: {x: 0, z: 1}, yaw: 0, fire: true},
  })
  assert.equal(world.player.ammo.pistol.mag, startingMag - 1)
  assert.equal(guest.ammo.pistol.mag, startingMag - 1)
  const guestZ = guest.pos.z

  world.step({player: {fire: false}})
  assert.ok(guest.pos.z > guestZ, 'missing guest input reuses the last absolute input')
  assert.deepEqual(Object.keys(world.replay[0]), ['player', 'guest-1'])
  assert.equal(world.replay[1]['guest-1'].move.z, 1)

  world.phase = 'intermission'
  world.player.hp = 10
  guest.hp = 40
  const hostScrap = world.player.scrap
  assert.equal(world.purchase('medkit', guest.id).ok, true)
  assert.equal(guest.hp, 90)
  assert.equal(guest.scrap, 300)
  assert.equal(world.player.hp, 10)
  assert.equal(world.player.scrap, hostScrap)
  assert.equal(world.telemetry.players[guest.id].purchases.length, 1)
})

test('unit kill scrap and telemetry are credited to the shooter', () => {
  const world = makeWorld()
  const guest = world.addPlayer({id: 'guest-1', name: 'Sarah'})
  const hostScrap = world.player.scrap
  const guestScrap = guest.scrap
  const unit = world.spawnUnit('scout', {x: 5, y: 0, z: 8})

  world.damageUnit(unit.id, 9999, {source: 'player', playerId: guest.id, weapon: 'pistol'})

  assert.equal(world.player.scrap, hostScrap)
  assert.equal(guest.scrap, guestScrap + world.unitCatalog.types.scout.scrap)
  assert.equal(world.telemetry.players[guest.id].kills.length, 1)
  assert.equal(world.telemetry.players.player.kills.length, 0)
  assert.equal(world.eventLog.findLast(({type}) => type === 'kill').playerId, guest.id)
})
