import assert from 'node:assert/strict'
import test from 'node:test'
import {BuiltinSkynet} from '../../../lib/core/builtin-skynet.js'
import {CARD_UNLOCK_WAVE, DECK_CARDS, Deck, FOG_CARD_LEVEL} from '../../../lib/core/population.js'
import {SeededRng} from '../../../lib/core/rng.js'
import {World} from '../../../lib/core/world.js'
import {WaveDirector} from '../../../lib/core/waves.js'

const idleBrain = {tick() {}}

function makeWorld(seed = 31) {
  return new World({seed, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain, t1000: idleBrain, hkaerial: idleBrain, hktank: idleBrain}})
}

test('the deck deals every card before repeating and never twice in a row', () => {
  const deck = new Deck(new SeededRng(9))
  const dealt = []
  for (let wave = 1; wave <= 20; wave += 1) dealt.push(deck.deal(10).dealt)
  for (let index = 1; index < dealt.length; index += 1) {
    assert.notEqual(dealt[index], dealt[index - 1], `card ${index} repeats`)
  }
  assert.deepEqual([...new Set(dealt)].sort(), [...DECK_CARDS].sort(), 'a reshuffle brings every card back')
})

test('a locked card plays as nothing but still leaves the pile', () => {
  const deck = new Deck(new SeededRng(4))
  for (let round = 0; round < 40; round += 1) {
    const result = deck.deal(1)
    if (CARD_UNLOCK_WAVE[result.dealt] > 1) {
      assert.equal(result.locked, true)
      assert.equal(result.card, 'nothing', `${result.dealt} is locked before wave ${CARD_UNLOCK_WAVE[result.dealt]}`)
    } else {
      assert.equal(result.card, result.dealt)
    }
  }
  const late = new Deck(new SeededRng(4))
  const cards = Array.from({length: 40}, () => late.deal(10).card)
  assert.equal(cards.includes('t1000_hunt'), true, 'wave 10 unlocks everything')
})

test('the fog card sets fog level 2 and pays the knob price from the reservoir', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet()})
  director.deck.deal = () => ({dealt: 'fog', card: 'fog', locked: false})
  director.start()
  assert.equal(world.mapState.fog, FOG_CARD_LEVEL)
  assert.equal(director.card, 'fog')
  assert.equal(director.pacer.reservoirMax - director.pacer.reservoir >= 40, true, 'the fog level cost came out of the reservoir')
  const dealt = world.eventLog.filter(({type}) => type === 'deck_card')
  // A card with no delayed effect is dealt and fired in the same tick.
  assert.deepEqual(dealt.map(({card, wave, phase}) => [card, wave, phase]), [['fog', 1, 'dealt'], ['fog', 1, 'fired']])
})

test('the door lock card locks tunnel_w when no door use is on record', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet()})
  director.deck.deal = () => ({dealt: 'door_lock', card: 'door_lock', locked: false})
  director.start()
  assert.equal(world.mapState.doors.tunnel_w, 'locked')
})

test('the aerial patrol card puts two flyers up at wave start', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet()})
  director.deck.deal = () => ({dealt: 'aerial_patrol', card: 'aerial_patrol', locked: false})
  director.wave = 2
  director.start()
  director.step({}) // queued at wave start, on the field one tick later
  const dispatched = world.eventLog.filter(({type}) => type === 'special_dispatched')
  assert.equal(dispatched.length, 2)
  assert.equal(dispatched.every(({unitType}) => unitType === 'hkaerial'), true)
})

test('the lights out card kills the nearest light zone at the first peak', () => {
  const world = makeWorld()
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet()})
  director.deck.deal = () => ({dealt: 'lights_out', card: 'lights_out', locked: false})
  director.start()
  const lit = Object.values(world.mapState.lights).filter((state) => state === 'on').length
  const dealt = world.eventLog.filter(({type}) => type === 'deck_card')
  assert.deepEqual(dealt.map(({phase}) => phase), ['dealt'], 'a delayed card is only dealt at wave start')
  assert.equal(Object.values(world.mapState.lights).filter((state) => state === 'on').length, lit, 'the lights stay on until the peak')

  director.pacer.setIntensity(world.hostPlayerId, 1.4)
  director.step({})
  assert.equal(director.pacer.state, 'sustain_peak')
  assert.equal(Object.values(world.mapState.lights).filter((state) => state === 'on').length, lit - 1)
  const fired = world.eventLog.filter(({type}) => type === 'deck_card')
  assert.deepEqual(fired.map(({card, phase}) => [card, phase]), [['lights_out', 'dealt'], ['lights_out', 'fired']])
})
