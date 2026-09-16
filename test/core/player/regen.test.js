import assert from 'node:assert/strict'
import test from 'node:test'
import {TICK_RATE, World} from '../../../lib/core/world.js'

function hurt(world, amount, playerId = 'player') {
  world.damagePlayer(amount, {type: 'hazard'}, playerId)
}
function run(world, ticks) {
  for (let i = 0; i < ticks; i++) world.step()
}

test('no regeneration inside five seconds of damage', () => {
  const world = new World({seed: 7})
  const player = world.getPlayer('player')
  hurt(world, 70)
  assert.equal(player.hp, 30)
  assert.equal(player.lastDamagedAtTick, world.tick)
  run(world, 5 * TICK_RATE - 1)
  assert.equal(player.hp, 30, 'the calm spell is not over yet')
})

test('regeneration heals four health per second after the calm spell', () => {
  const world = new World({seed: 7})
  const player = world.getPlayer('player')
  hurt(world, 70)
  run(world, 5 * TICK_RATE)
  assert.ok(Math.abs(player.hp - 30) < 1e-9, 'the first regenerating tick has not run yet')
  run(world, TICK_RATE)
  assert.ok(Math.abs(player.hp - 34) < 1e-9, `expected 34, got ${player.hp}`)
  run(world, TICK_RATE)
  assert.ok(Math.abs(player.hp - 38) < 1e-9, `expected 38, got ${player.hp}`)
})

test('new damage restarts the calm spell', () => {
  const world = new World({seed: 7})
  const player = world.getPlayer('player')
  hurt(world, 70)
  run(world, 5 * TICK_RATE + 30)
  const healed = player.hp
  assert.ok(healed > 30)
  hurt(world, 5)
  run(world, 5 * TICK_RATE - 1)
  assert.ok(Math.abs(player.hp - (healed - 5)) < 1e-9, 'damage restarts the five second wait')
})

test('regeneration stops at the floor and never passes it', () => {
  const world = new World({seed: 7})
  const player = world.getPlayer('player')
  hurt(world, 70)
  run(world, 5 * TICK_RATE + 10 * TICK_RATE)
  assert.equal(player.hp, 40, 'regeneration caps at the floor')
  player.hp = 40
  run(world, TICK_RATE)
  assert.equal(player.hp, 40, 'no regeneration at the floor')
  player.hp = 75
  run(world, TICK_RATE)
  assert.equal(player.hp, 75, 'regeneration never touches health above the floor')
})

test('medkits and the wave-clear reset still heal past the floor', () => {
  const world = new World({seed: 7})
  const player = world.getPlayer('player')
  hurt(world, 70)
  world.phase = 'intermission'
  player.scrap = 400
  assert.deepEqual(world.purchase('medkit', 'player').ok, true)
  assert.equal(player.hp, 80, 'the medkit heals 50 past the floor')
  hurt(world, 80)
  assert.equal(player.alive, false)
  world.respawnDeadPlayers()
  assert.equal(player.hp, 100, 'the wave-clear reset still heals to full')
})

test('the damage clock round-trips through a snapshot', () => {
  const world = new World({seed: 7})
  world.addPlayer({id: 'guest', name: 'Guest'})
  run(world, 4)
  hurt(world, 70)
  const stamp = world.getPlayer('player').lastDamagedAtTick
  assert.equal(stamp, world.tick)
  const snapshot = world.snapshot()
  assert.equal(snapshot.players.player.lastDamagedAtTick, stamp)
  assert.equal(snapshot.players.guest.lastDamagedAtTick, null)

  const mirror = new World({seed: 7})
  mirror.applySnapshot(snapshot)
  assert.equal(mirror.getPlayer('player').lastDamagedAtTick, stamp)
  assert.equal(mirror.getPlayer('guest').lastDamagedAtTick, null)
  run(mirror, 5 * TICK_RATE - 1)
  assert.equal(mirror.getPlayer('player').hp, 30, 'the guest waits out the same calm spell')
  run(mirror, TICK_RATE + 1)
  assert.ok(mirror.getPlayer('player').hp > 33.9, 'and then regenerates')

  delete snapshot.players.player.lastDamagedAtTick
  const legacy = new World({seed: 7})
  legacy.applySnapshot(snapshot)
  assert.equal(legacy.getPlayer('player').lastDamagedAtTick, null, 'an older snapshot reads as never damaged')
})
