import assert from 'node:assert/strict'
import test from 'node:test'
import {MAX_WAVES} from '../../../lib/core/waves.js'
import {proveFullMatch, runSniperMatch} from '../../../tools/measure-pacing.mjs'

/**
 * The headless full match: ten waves through the real WaveDirector with the
 * built-in Skynet and the sniper ghost, seed 7. The ghost is invulnerable
 * because the HK-Tank kills a strafing ghost on wave 5; everything else it does
 * is a player's work, so the director still has to end every wave on its own.
 * tools/measure-pacing.mjs owns the ghost and the proof; this pins them.
 */
test('the sniper ghost plays waves one to ten and rides the chopper out', () => {
  const run = runSniperMatch({invulnerable: true})
  const proof = proveFullMatch(run)
  const log = run.world.eventLog

  assert.equal(run.exception, null, `the match threw: ${run.exception?.stack}`)
  assert.equal(run.stalled, null, `a wave never ended: ${JSON.stringify(run.stalled)}`)
  assert.deepEqual(run.wavesFinished, Array.from({length: MAX_WAVES}, (_, index) => index + 1))
  assert.equal(run.director.telemetryByWave.get(MAX_WAVES).end_reason, 'extracted')
  assert.equal(log.some(({type}) => type === 'script_error'), false, 'no unit script threw')

  for (const type of ['mob_incoming', 'special_dispatched', 'deck_card', 'trader_moved']) {
    assert.equal(log.some((event) => event.type === type), true, `missing ${type}`)
  }
  assert.equal(log.some(({type}) => type === 'cache_taken' || type === 'cache_spawned'), true, 'missing cache events')
  const phases = log.filter(({type}) => type === 'extraction').map(({phase}) => phase)
  assert.deepEqual(phases, ['announced', 'arrived', 'complete'])
  const cardPhases = new Set(log.filter(({type}) => type === 'deck_card').map(({phase}) => phase))
  assert.deepEqual([...cardPhases].sort(), ['dealt', 'fired'], 'cards are dealt and fired')
  assert.deepEqual(proof.failures, [])
})
