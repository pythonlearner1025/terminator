import assert from 'node:assert/strict'
import test from 'node:test'
import {Pacer} from '../../../lib/core/director.js'
import {POPULATION, Population} from '../../../lib/core/population.js'
import {World} from '../../../lib/core/world.js'

const idleBrain = {tick() {}}

function makeWorld(seed = 91) {
  return new World({seed, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain, t1000: idleBrain, hkaerial: idleBrain, hktank: idleBrain}})
}

// The population only reads world.tick, so a bare loop is enough here.
function runSeconds(world, population, seconds) {
  for (let tick = 0; tick < Math.round(seconds * 60); tick += 1) {
    world.tick += 1
    population.step()
  }
}

function emptyWave(world, {wave = 1} = {}) {
  const pacer = new Pacer(world)
  pacer.beginWave({wave, reservoir: 200})
  const population = new Population(world, pacer)
  population.beginWave({wave})
  for (const unitId of [...population.wanderers.keys()]) world.despawnUnit(unitId)
  population.wanderers.clear()
  pacer.drain()
  return {pacer, population}
}

test('a unit nobody can see after the enrage is swept so the wave can end', () => {
  const world = makeWorld()
  const {population} = emptyWave(world)
  // A flyer parked over a roof: alive, hunting, and out of every sight line.
  const stuck = world.spawnUnit('hkaerial', {x: 38.6, y: 4.7, z: 2.9})
  assert.equal(world.unitSeenByAnyPlayer(stuck), false, 'the fixture must be out of sight')

  runSeconds(world, population, POPULATION.stragglers.seconds + 1)
  assert.equal(population.stragglersDone, true, 'the straggler rule fired first')
  assert.equal(stuck.alive, true, 'the sweep does not run at the same moment')

  runSeconds(world, population, POPULATION.stragglers.unseenSweepSeconds - 3)
  assert.equal(world.aliveUnits.length, 1, 'the sweep waits the full thirty seconds')

  runSeconds(world, population, 4)
  assert.equal(world.aliveUnits.length, 0, 'the stuck unit left silently')
  assert.equal(world.telemetry.units[stuck.id].causeOfDeath, 'despawned')
  assert.equal(world.eventLog.some(({type}) => type === 'unit_death'), false, 'a sweep is not a kill')
})

test('the sweep never removes a unit a player can see', () => {
  const world = makeWorld()
  const {population} = emptyWave(world)
  const seen = world.spawnUnit('scout', {x: world.player.pos.x, y: 0, z: world.player.pos.z + 6})
  assert.equal(world.unitSeenByAnyPlayer(seen), true, 'the fixture must be in sight')

  runSeconds(world, population, POPULATION.stragglers.seconds + POPULATION.stragglers.unseenSweepSeconds + 2)
  assert.equal(seen.alive, true, 'a visible straggler is the player\'s problem, not the sweep\'s')
  assert.equal(population.unseenAfterEnrage.get(seen.id), 0)
})

test('build up tops the map back up to the standing wanderer count', () => {
  const world = makeWorld(92)
  const pacer = new Pacer(world)
  pacer.beginWave({wave: 4, reservoir: 600})
  const population = new Population(world, pacer)
  population.beginWave({wave: 4})
  const seeded = population.wanderers.size
  assert.equal(seeded, POPULATION.wanderers.base + 2, 'wave start still seeds 2 plus half the wave')
  const standing = POPULATION.wanderers.standing.base + 2
  assert.ok(standing > seeded, 'the trickle has room to work on this wave')

  assert.equal(pacer.state, 'build_up')
  runSeconds(world, population, POPULATION.wanderers.trickleSeconds * 4)
  assert.equal(population.livingWanderers(), standing, 'the trickle stops at the standing count')

  // Relax spends nothing, so no new wanderer is placed. The despawn refund rule
  // still runs there, so count spawns, not survivors.
  pacer.state = 'relax'
  const spawns = () => world.eventLog.filter(({type}) => type === 'unit_spawn').length
  const placed = spawns()
  runSeconds(world, population, POPULATION.wanderers.trickleSeconds * 3)
  assert.equal(spawns(), placed, 'no trickle outside build up')
})
