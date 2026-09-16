import assert from 'node:assert/strict'
import test from 'node:test'
import {BuiltinSkynet} from '../../../lib/core/builtin-skynet.js'
import {World} from '../../../lib/core/world.js'
import {WaveDirector} from '../../../lib/core/waves.js'

const DIRECTOR_EVENTS = ['director_state', 'mob_incoming', 'special_dispatched', 'stragglers_enraged', 'deck_card', 'extraction']

function runMatch(seed) {
  const world = new World({seed})
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet(), maxWaves: 2, now: () => 1000})
  director.start()
  for (let tick = 0; tick < 90 * 60; tick += 1) {
    if (director.phase === 'ended') break
    director.step({
      move: {x: Math.sin(tick / 120) * 0.3, z: Math.cos(tick / 150) * 0.3},
      yaw: Math.sin(tick / 200) * 1.4,
      pitch: 0,
      fire: tick % 4 === 0,
    })
  }
  return {world, director}
}

test('the same seed and inputs give the same director event log', {timeout: 60000}, () => {
  const first = runMatch(3001)
  const second = runMatch(3001)
  const pick = (run) => run.world.eventLog
    .filter(({type}) => DIRECTOR_EVENTS.includes(type))
    .map(({type, tick, ...rest}) => ({type, tick, ...rest}))

  const firstEvents = pick(first)
  assert.ok(firstEvents.length > 3, 'the pacer really ran')
  assert.deepEqual(firstEvents, pick(second))
  assert.deepEqual(first.world.director, second.world.director)
  assert.equal(first.world.rng.state, second.world.rng.state)
  assert.deepEqual(first.world.telemetry.director, second.world.telemetry.director)
})

test('the wave summary carries the director section', () => {
  const {director} = runMatch(3002)
  const summary = director.telemetryByWave.get(1)
  assert.ok(summary, 'wave one finished')
  assert.deepEqual(Object.keys(summary.director).sort(), ['mobs', 'peaks', 'relax_seconds', 'stragglers'])
  assert.equal(Number.isFinite(summary.director.mobs), true)
  assert.equal(Number.isFinite(summary.director.relax_seconds), true)
})
