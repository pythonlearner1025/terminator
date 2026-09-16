import assert from 'node:assert/strict'
import test from 'node:test'
import {projectViewModel} from '../../../lib/core/viewmodel.js'
import {World} from '../../../lib/core/world.js'
import {WaveDirector, buildRulesPayload, difficultyScaling} from '../../../lib/core/waves.js'

const idleBrain = {tick() {}}
const config = {
  spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
  knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
}

function makeParty() {
  const world = new World({seed: 11, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain}})
  world.addPlayer({id: 'guest-1', name: 'Sarah'})
  return world
}

test('difficulty scaling matches all three player-count tiers and is projected', () => {
  assert.deepEqual(difficultyScaling(1), {players: 1, budgetMultiplier: 1, unitHealthMultiplier: 1, maxAlive: 32})
  assert.deepEqual(difficultyScaling(2), {players: 2, budgetMultiplier: 1.6, unitHealthMultiplier: 1.35, maxAlive: 38})
  assert.deepEqual(difficultyScaling(3), {players: 3, budgetMultiplier: 2.1, unitHealthMultiplier: 1.7, maxAlive: 44})

  const world = makeParty()
  const director = new WaveDirector(world)
  const started = director.start(config)
  director.step({})

  assert.equal(started.budget, Math.round(420 * 1.6))
  assert.deepEqual(started.scaling, difficultyScaling(2))
  assert.equal(world.aliveUnits[0].maxHp, 60 * 1.35)
  assert.equal(world.maxAlive, 38)
  assert.deepEqual(projectViewModel(world).scaling, difficultyScaling(2))
  assert.deepEqual(buildRulesPayload({playerCount: 3}).scaling, difficultyScaling(3))
})

test('a dead teammate respawns next wave and the match ends only when everyone is dead together', () => {
  const world = makeParty()
  const guest = world.getPlayer('guest-1')
  // The in-wave pacer is off: this test drives the legacy schedule and the phase machine.
  const director = new WaveDirector(world, {maxWaves: 3, intermissionSeconds: 45, pacer: false})
  world.player.ammo.m4.owned = true
  director.start(config)
  director.step({})

  world.damagePlayer(1000, {type: 'test'}, world.hostPlayerId)
  guest.hp = 40
  director.step({})
  assert.equal(director.phase, 'wave', 'one surviving teammate keeps the match alive')

  for (const unit of world.aliveUnits) world.damageUnit(unit.id, 9999, {source: 'player', playerId: guest.id, weapon: 'pistol'})
  director.step({})
  assert.equal(director.phase, 'intermission')
  assert.equal(world.player.alive, false)
  assert.equal(guest.hp, 100)
  assert.equal(guest.scrap, 400 + 12 + 150)
  const firstSummary = director.telemetryByWave.get(1)
  assert.deepEqual(firstSummary.scaling, difficultyScaling(2))
  assert.equal(firstSummary.players.length, 2)

  assert.equal(director.submitConfig({wave: 2, ...config}).ok, true)
  director.ready(1)
  assert.equal(world.player.alive, true)
  assert.equal(world.player.downed, false)
  assert.equal(world.player.hp, 100)
  assert.equal(world.player.ammo.m4.owned, true, 'respawn preserves the loadout')

  director.step({})
  world.damagePlayer(1000, {type: 'test'}, world.hostPlayerId)
  world.damagePlayer(1000, {type: 'test'}, guest.id)
  director.step({})
  assert.equal(director.phase, 'ended')
  assert.equal(director.telemetryByWave.get(2).player_died, true)
})

test('an ended co-op match resets to a fresh lobby without replacing the roster', () => {
  const world = makeParty()
  const director = new WaveDirector(world, {maxWaves: 3})
  const roster = [...world.players.values()]
  director.start(config)
  director.step({})
  world.damagePlayer(1000, {type: 'test'}, 'player')
  world.damagePlayer(1000, {type: 'test'}, 'guest-1')
  director.step({})
  assert.equal(director.phase, 'ended')

  assert.deepEqual(director.returnToLobby(), {ok: true})
  assert.equal(director.phase, 'lobby')
  assert.equal(world.phase, 'lobby')
  assert.equal(world.wave, 0)
  assert.deepEqual([...world.players.values()], roster)
  assert.ok([...world.players.values()].every(player => player.alive && player.hp === 100 && player.scrap === 400))
  assert.equal(world.units.length, 0)
  assert.equal(world.eventLog.at(-1).phase, 'lobby')
  assert.equal(director.start(config).ok, true, 'the same director can start a second match')
})

test('the per-player view model selects its HUD and lists teammate state', () => {
  const world = makeParty()
  const guest = world.getPlayer('guest-1')
  world.player.hp = 75
  world.player.armor = 20
  guest.hp = 45
  guest.armor = 60
  guest.pos.x += 3

  const view = projectViewModel(world, guest.id)
  assert.equal(view.health.value, 45)
  assert.equal(view.armor.value, 60)
  assert.deepEqual(view.teammates, [{
    id: 'player', name: 'Player 1', hp: 75, health: 75, armor: 20,
    distance: 3, alive: true, downed: false,
  }])
})
