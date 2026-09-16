import assert from 'node:assert/strict'
import test from 'node:test'
import {DIRECTOR_STATES, INTENSITY, PACING, Pacer} from '../../../lib/core/director.js'
import {World} from '../../../lib/core/world.js'
import {INTERMISSION_SECONDS, WaveDirector} from '../../../lib/core/waves.js'

const idleBrain = {tick() {}}
const config = {
  spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
  knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
}

function makeWorld(seed = 4242) {
  return new World({seed, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain, t1000: idleBrain, hkaerial: idleBrain, hktank: idleBrain}})
}

test('the four states follow the contract transitions on synthetic intensity', () => {
  const world = makeWorld()
  const pacer = new Pacer(world)
  pacer.beginWave({wave: 1, reservoir: 400})
  assert.equal(pacer.state, DIRECTOR_STATES.buildUp)

  pacer.setIntensity(world.hostPlayerId, 1.4)
  pacer.step()
  assert.equal(pacer.state, DIRECTOR_STATES.sustainPeak, 'intensity 1.0 leaves build_up')
  assert.ok(pacer.stateTimer >= PACING.sustainSeconds[0] && pacer.stateTimer <= PACING.sustainSeconds[1])

  // A live unit keeps the "no unit alive" branch of peak_fade out of the way.
  world.spawnUnit('scout', {x: 30, y: 0, z: 26})
  const sustainTicks = Math.ceil(pacer.stateTimer * 60) + 1
  for (let tick = 0; tick < sustainTicks && pacer.state === DIRECTOR_STATES.sustainPeak; tick += 1) {
    pacer.setIntensity(world.hostPlayerId, 1.4)
    pacer.step()
  }
  assert.equal(pacer.state, DIRECTOR_STATES.peakFade, 'the sustain timer expires into peak_fade')

  pacer.setIntensity(world.hostPlayerId, 0.5)
  pacer.step()
  assert.equal(pacer.state, DIRECTOR_STATES.relax, 'intensity 0.6 or lower leaves peak_fade')
  assert.ok(pacer.stateTimer >= PACING.relaxSeconds[0] && pacer.stateTimer <= PACING.relaxSeconds[1])

  const relaxTicks = Math.ceil(pacer.stateTimer * 60) + 1
  for (let tick = 0; tick < relaxTicks; tick += 1) pacer.step()
  assert.equal(pacer.state, DIRECTOR_STATES.buildUp, 'the relax timer expires into build_up')
  assert.equal(pacer.buildUpCount, 2)

  const states = world.eventLog.filter(({type}) => type === 'director_state').map(({state}) => state)
  assert.deepEqual(states, ['build_up', 'sustain_peak', 'peak_fade', 'relax', 'build_up'])
})

test('peak_fade also leaves when the last unit dies', () => {
  const world = makeWorld()
  const pacer = new Pacer(world)
  pacer.beginWave({wave: 1, reservoir: 100})
  pacer.state = DIRECTOR_STATES.peakFade
  pacer.setIntensity(world.hostPlayerId, 1.4)
  pacer.step()
  assert.equal(pacer.state, DIRECTOR_STATES.relax)
})

test('damage, a low health crossing, and a near death raise intensity; quiet decays it', () => {
  const world = makeWorld()
  const pacer = new Pacer(world)
  pacer.beginWave({wave: 1, reservoir: 100})

  world.damagePlayer(50, {type: 'test'})
  pacer.step()
  assert.equal(pacer.intensity(world.hostPlayerId), 0.5, '50 damage is half a point')

  world.player.hp = 20
  pacer.step()
  assert.ok(pacer.intensity(world.hostPlayerId) >= 0.8, 'crossing below 25 hp adds 0.3')
  const afterCrossing = pacer.intensity(world.hostPlayerId)
  world.player.hp = 19
  pacer.step()
  assert.equal(pacer.intensity(world.hostPlayerId), afterCrossing, 'the crossing pays once')

  const unit = world.spawnUnit('scout', {x: world.player.pos.x + 2, y: 0, z: world.player.pos.z})
  const before = pacer.intensity(world.hostPlayerId)
  world.damageUnit(unit.id, 9999, {source: 'player', weapon: 'pistol'})
  pacer.step()
  assert.ok(pacer.intensity(world.hostPlayerId) > before, 'a death within 10 m adds intensity')

  world.clearUnits()
  world.tick += 4 * 60
  const quiet = pacer.intensity(world.hostPlayerId)
  for (let tick = 0; tick < 60; tick += 1) pacer.step()
  assert.ok(Math.abs(pacer.intensity(world.hostPlayerId) - (quiet - INTENSITY.decayPerSecond)) < 1e-3, 'unengaged decay is 0.05 per second')
})

test('intensity clamps to the 0 through 1.5 band and the team takes the maximum', () => {
  const world = makeWorld()
  world.addPlayer({id: 'guest-1', name: 'Sarah'})
  const pacer = new Pacer(world)
  pacer.beginWave({wave: 1, reservoir: 100})
  pacer.setIntensity(world.hostPlayerId, 9)
  pacer.setIntensity('guest-1', -4)
  assert.equal(pacer.intensity(world.hostPlayerId), 1.5)
  assert.equal(pacer.intensity('guest-1'), 0)
  assert.equal(pacer.teamIntensity(), 1.5)
})

test('the reservoir holds back 15 percent until the rush releases it', () => {
  const world = makeWorld()
  const pacer = new Pacer(world)
  pacer.beginWave({wave: 1, reservoir: 400, rushReserveFraction: 0.15})
  assert.equal(pacer.reservoirMax, 400)
  assert.equal(pacer.rushReserve, 60)
  assert.equal(pacer.spendable, 340)
  assert.equal(pacer.spend(341), false, 'the reserve is out of reach')
  assert.equal(pacer.spend(340), true)
  assert.equal(pacer.reservoir, 60)
  assert.equal(pacer.spendable, 0)
  pacer.releaseReserve()
  assert.equal(pacer.spendable, 60)
  pacer.drain()
  assert.equal(pacer.reservoir, 0)
  assert.equal(pacer.refund(12), false, 'no refunds once the reservoir is empty')
})

test('the trader stays shut in every wave state, and opens in intermission', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {maxWaves: 2})
  director.start(config)
  director.step({})
  world.player.scrap = 1000
  world.player.hp = 40

  for (const state of ['build_up', 'sustain_peak', 'peak_fade', 'relax']) {
    director.pacer.state = state
    director.pacer.sync()
    assert.equal(world.traderOpen, false, `${state} keeps the trader shut`)
    assert.equal(world.purchase('medkit').ok, false, `${state} rejects a purchase`)
  }

  director.finishWave()
  assert.equal(director.phase, 'intermission')
  assert.equal(world.traderOpen, true)
  // The wave end heals the team, so the medkit needs a fresh wound to price.
  world.player.hp = 40
  assert.equal(world.purchase('medkit').ok, true, 'the intermission opens the trader')
})

test('the intermission is 15 seconds and opens the trader', () => {
  const world = makeWorld()
  assert.equal(INTERMISSION_SECONDS, 15)
  const director = new WaveDirector(world, {maxWaves: 3, now: () => 1000})
  director.start(config)
  director.step({})
  director.finishWave()
  assert.equal(director.phase, 'intermission')
  assert.equal(director.intermissionTicksLeft, 15 * 60)
  assert.equal(world.traderOpen, true)
})

test('the director state, trader window, and finale ride the snapshot', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {maxWaves: 10})
  director.start(config)
  director.step({})
  director.pacer.state = 'relax'
  director.finishWave()
  assert.equal(world.traderOpen, true, 'the intermission is the only trader window')
  world.extraction = {pos: {x: 1, y: 0, z: 2}, phase: 'announced', timer: 12}

  const guest = makeWorld()
  guest.applySnapshot(world.snapshot())
  assert.equal(guest.traderOpen, true)
  assert.deepEqual(guest.director, world.director)
  assert.deepEqual(guest.extraction, world.extraction)
})
