import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../../lib/core/world.js'

const idleBrain = {tick() {}}

test('sense.player targets the nearest visible player and sense.players includes every visible id', () => {
  const world = new World({seed: 7, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
  const guest = world.addPlayer({id: 'guest-1', name: 'Kyle'})
  world.player.pos = {x: 5, y: 0, z: 12}
  guest.pos = {x: 5, y: 0, z: 8}
  const unit = world.spawnUnit('scout', {x: 5, y: 0, z: 2}, {yaw: 0})

  const sense = world.buildSense(unit, [])
  assert.equal(sense.player.dist, 6)
  assert.equal(Object.hasOwn(sense.player, 'id'), false)
  assert.deepEqual(sense.players.map(({id}) => id), ['guest-1', 'player'])

  world.step()
  assert.equal(unit.targetPlayerId, guest.id)
  assert.equal(unit.lastKnownPlayer.id, guest.id)
  assert.deepEqual(unit.lastKnownPlayer.pos, guest.pos)
})

test('sandbox scripts receive sense.players through JSON marshalling', () => {
  const source = `
    export function tick(self, sense, act, mem) {
      mem.ids = sense.players.map((player) => player.id)
      mem.nearestDistance = sense.player && sense.player.dist
    }
  `
  const world = new World({scriptSources: {scout: source}})
  const guest = world.addPlayer({id: 'guest-1', name: 'Kyle'})
  world.player.pos = {x: 5, y: 0, z: 12}
  guest.pos = {x: 5, y: 0, z: 8}
  const unit = world.spawnUnit('scout', {x: 5, y: 0, z: 2}, {yaw: 0})

  world.step()

  assert.deepEqual(unit.mem.ids, ['guest-1', 'player'])
  assert.equal(unit.mem.nearestDistance, 6)
  world.destroy()
})

test('unit melee and hitscan damage the selected teammate rather than the host', () => {
  const meleeWorld = new World({brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
  const meleeGuest = meleeWorld.addPlayer({id: 'guest-1', name: 'Kyle'})
  meleeWorld.player.pos = {x: 5, y: 0, z: 8}
  meleeGuest.pos = {x: 5, y: 0, z: 3}
  const scout = meleeWorld.spawnUnit('scout', {x: 5, y: 0, z: 2}, {yaw: 0})
  scout.targetPlayerId = meleeGuest.id
  scout.intent.melee = true
  meleeWorld.updateMeleeUnit(scout, meleeWorld.unitCatalog.types.scout, true)
  assert.equal(meleeGuest.hp, 75)
  assert.equal(meleeWorld.player.hp, 100)

  const gunWorld = new World({seed: 4, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
  const gunGuest = gunWorld.addPlayer({id: 'guest-1', name: 'Sarah'})
  gunWorld.player.pos = {x: 5, y: 0, z: 12}
  gunGuest.pos = {x: 5, y: 0, z: 8}
  const endo = gunWorld.spawnUnit('endo', {x: 5, y: 0, z: 2}, {yaw: 0})
  endo.targetPlayerId = gunGuest.id
  gunWorld.fireUnitWeapon(endo, {...gunWorld.unitCatalog.types.endo, spreadDeg: 0})
  for (let tick = 0; tick < 30; tick += 1) gunWorld.step({})
  assert.equal(gunGuest.hp, 85)
  assert.equal(gunWorld.player.hp, 100)
})
