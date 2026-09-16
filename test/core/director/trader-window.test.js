import assert from 'node:assert/strict'
import test from 'node:test'
import {DIRECTOR_STATES, PACING} from '../../../lib/core/director.js'
import {World} from '../../../lib/core/world.js'
import {WaveDirector} from '../../../lib/core/waves.js'

/**
 * The trader window rule: the trader opens between waves and nowhere else.
 * A relax window sits inside a live wave, with enemies still on the map, so it
 * must keep the trader shut. The owner reported the opposite behaviour.
 */

const idleBrain = {tick() {}}
const config = {
  spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
  knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
}

function makeWorld(seed = 1717) {
  return new World({seed, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain, t1000: idleBrain, hkaerial: idleBrain, hktank: idleBrain}})
}

// One step of a live wave, with the meter pinned so the state machine is exact.
function stepWave(director, world, intensity) {
  director.pacer.setIntensity(world.hostPlayerId, intensity)
  director.step({})
}

test('a relax window inside a live wave keeps the trader shut, and the intermission opens it', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {maxWaves: 3})
  director.start(config)
  director.step({})
  world.player.scrap = 1000
  world.player.hp = 40

  // An empty reservoir buys nothing more, so the living units are the only
  // thing that holds the wave open.
  director.pacer.drain()
  // A guard the player can see is never swept as a straggler, so the relax
  // window runs its full length with an enemy alive.
  const guard = world.spawnUnit('scout', {x: world.player.pos.x, y: 0, z: world.player.pos.z + 6})
  assert.equal(world.unitSeenByAnyPlayer(guard), true, 'the fixture must stay in sight')

  // Climb to the peak, hold it out, then drop the meter into a relax window.
  stepWave(director, world, PACING.peak + 0.2)
  assert.equal(director.pacer.state, DIRECTOR_STATES.sustainPeak)
  const sustainTicks = Math.ceil(director.pacer.stateTimer * 60) + 1
  for (let tick = 0; tick < sustainTicks; tick += 1) stepWave(director, world, PACING.peak + 0.2)
  assert.equal(director.pacer.state, DIRECTOR_STATES.peakFade)
  stepWave(director, world, 0)
  assert.equal(director.pacer.state, DIRECTOR_STATES.relax)

  // Walk the whole relax window. The trader stays shut on every tick.
  let relaxTicks = 0
  while (director.pacer.state === DIRECTOR_STATES.relax) {
    assert.equal(director.phase, 'wave', 'the wave is still running')
    assert.ok(world.aliveUnits.length > 0, 'an enemy is still alive')
    assert.equal(world.traderOpen, false, `relax tick ${relaxTicks} opened the trader`)
    assert.equal(world.purchase('medkit').ok, false, 'the purchase gate rejects during relax')
    stepWave(director, world, 0)
    relaxTicks += 1
    assert.ok(relaxTicks < 60 * 60, 'the relax window never ended')
  }
  assert.ok(relaxTicks >= PACING.relaxSeconds[0] * 60, 'the test walked a full relax window')
  assert.equal(director.pacer.state, DIRECTOR_STATES.buildUp)
  assert.equal(world.traderOpen, false, 'build_up keeps the trader shut too')

  // Kill the last of them. Only now may the trader open.
  for (const unit of [...world.aliveUnits]) world.damageUnit(unit.id, 10000, {playerId: world.hostPlayerId})
  assert.equal(world.aliveUnits.length, 0)
  assert.equal(world.traderOpen, false, 'the last death alone is not the window')

  stepWave(director, world, 0)
  assert.equal(director.phase, 'intermission', 'an empty map ends the wave')
  assert.equal(world.traderOpen, true, 'the intermission is the trader window')
  // The wave end heals the team, so the medkit needs a fresh wound to price.
  world.player.hp = 40
  assert.equal(world.purchase('medkit').ok, true, 'the purchase gate accepts between waves')
})

test('the wave never reaches the intermission while a unit, a spawn, or the reservoir is left', () => {
  const world = makeWorld(88)
  const director = new WaveDirector(world, {maxWaves: 3})
  director.start(config)
  director.step({})

  // A living unit holds the wave open.
  world.spawnUnit('scout', {x: world.player.pos.x + 4, y: 0, z: world.player.pos.z + 4})
  director.pacer.drain()
  director.population.pending.length = 0
  director.nextSpawn = director.spawnSchedule.length
  assert.equal(director.waveCleared(), false, 'a living unit blocks the wave end')

  for (const unit of [...world.aliveUnits]) world.despawnUnit(unit.id)
  assert.equal(world.aliveUnits.length, 0)

  // A scheduled spawn that has not fired holds it open.
  director.nextSpawn = 0
  assert.equal(director.waveCleared(), false, 'a pending scripted spawn blocks the wave end')
  director.nextSpawn = director.spawnSchedule.length

  // A queued population spawn holds it open.
  director.population.pending.push({t: 999, type: 'scout', gate: 'N1'})
  assert.equal(director.waveCleared(), false, 'a queued population spawn blocks the wave end')
  director.population.pending.length = 0

  // Scrap left in the reservoir holds it open.
  director.pacer.reservoir = 50
  assert.equal(director.waveCleared(), false, 'a reservoir with scrap left blocks the wave end')
  director.pacer.drain()

  assert.equal(director.waveCleared(), true, 'an empty map, schedule, and reservoir ends the wave')
})
