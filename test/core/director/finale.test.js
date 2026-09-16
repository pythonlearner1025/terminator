import assert from 'node:assert/strict'
import test from 'node:test'
import {BuiltinSkynet} from '../../../lib/core/builtin-skynet.js'
import {POPULATION} from '../../../lib/core/population.js'
import {projectViewModel} from '../../../lib/core/viewmodel.js'
import {World} from '../../../lib/core/world.js'
import {WaveDirector} from '../../../lib/core/waves.js'

const idleBrain = {tick() {}}

function startFinale(seed = 108) {
  const world = new World({seed, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain, t1000: idleBrain, hkaerial: idleBrain, hktank: idleBrain}})
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet()})
  director.wave = 9
  assert.equal(director.start().ok, true)
  return {world, director}
}

test('wave ten announces the extraction and projects it', () => {
  const {world, director} = startFinale()
  assert.equal(director.wave, 10)
  assert.equal(world.extraction.phase, 'announced')
  assert.deepEqual(world.extraction.pos, world.map.extraction.pos)
  const announced = world.eventLog.filter(({type}) => type === 'extraction')
  assert.deepEqual(announced.map(({phase}) => phase), ['announced'])
  const view = projectViewModel(world)
  assert.equal(view.extraction.phase, 'announced')
  assert.equal(view.wave.finale, true)
})

test('clearing the map never ends wave ten; only the landed chopper does', () => {
  const {world, director} = startFinale()
  director.pacer.drain()
  director.population.rushDone = true
  for (const unit of [...world.units]) world.despawnUnit(unit.id)
  director.population.pending.length = 0
  director.step({})
  assert.equal(director.phase, 'wave', 'an empty map still waits for the extraction')

  for (const player of world.livingPlayers) player.pos = {...world.extraction.pos}
  director.step({})
  assert.equal(director.phase, 'wave', 'an empty pad is not a ride home')

  world.extraction.timer = POPULATION.finale.holdSeconds
  director.step({})
  assert.equal(director.phase, 'ended')
  assert.equal(world.extraction.phase, 'complete')
  const summary = director.telemetryByWave.get(10)
  assert.equal(summary.end_reason, 'extracted')
  assert.equal(summary.player_died, false)
  assert.deepEqual(world.eventLog.filter(({type}) => type === 'extraction').map(({phase}) => phase), ['announced', 'arrived', 'complete'])
})

test('at the hold time the chopper lands, the wall breaks, and free mobs keep coming', () => {
  const {world, director} = startFinale()
  director.pacer.drain()
  director.population.rushDone = true
  world.mapState.flankWallBroken = false
  world.extraction.timer = POPULATION.finale.holdSeconds - 0.01
  director.step({})
  assert.equal(world.extraction.phase, 'arrived')
  assert.equal(world.mapState.flankWallBroken, true)
  assert.equal(world.aliveUnits.every((unit) => unit.enraged === true), true, 'everything alive hunts')

  const arrived = world.eventLog.filter(({type}) => type === 'extraction').map(({phase}) => phase)
  assert.deepEqual(arrived, ['announced', 'arrived'])
  const queued = director.population.pending.length
  assert.equal(queued, POPULATION.finale.mobSize, 'a free mob lands with the chopper')

  // The reservoir stays empty: finale mobs cost nothing.
  assert.equal(director.pacer.reservoir, 0)
})
