import assert from 'node:assert/strict'
import test from 'node:test'
import {Pacer} from '../../../lib/core/director.js'
import {POPULATION, Population, pickSpawnSpot, spawnCandidates, spotIsBehind, spotIsValid} from '../../../lib/core/population.js'
import {SeededRng} from '../../../lib/core/rng.js'
import {World} from '../../../lib/core/world.js'

const idleBrain = {tick() {}}

function makeWorld(seed = 77) {
  return new World({seed, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain, t1000: idleBrain, hkaerial: idleBrain, hktank: idleBrain}})
}

function makePopulation(world, {wave = 1, reservoir = 400, card = 'nothing'} = {}) {
  const pacer = new Pacer(world)
  pacer.beginWave({wave, reservoir, rushReserveFraction: POPULATION.rushReserveFraction})
  const population = new Population(world, pacer)
  population.beginWave({wave, card})
  return {pacer, population}
}

test('candidates are gates plus interior spots, and flyers take gates only', () => {
  const world = makeWorld()
  const ground = spawnCandidates(world, {flying: false})
  const air = spawnCandidates(world, {flying: true})
  assert.equal(air.length, world.map.spawnGates.length)
  assert.equal(ground.length, world.map.spawnGates.length + (world.map.spawnSpots || []).length)
})

test('a spot in view or inside 12 metres is never valid', () => {
  const world = makeWorld()
  const player = world.player
  const near = {id: 'near', pos: {x: player.pos.x + 4, y: 0, z: player.pos.z}}
  assert.equal(spotIsValid(world, near), false, 'closer than 12 metres')

  const ahead = {id: 'ahead', pos: {x: player.pos.x, y: 0, z: player.pos.z + 16}}
  player.yaw = 0
  assert.equal(world.lineOfSight({...player.pos, y: player.pos.y + 1.65}, {...ahead.pos, y: 1}), true, 'the fixture spot really is visible')
  assert.equal(spotIsValid(world, ahead), false, 'a seen spot is out')
})

test('behind means more than 110 degrees off the nearest player yaw', () => {
  const world = makeWorld()
  world.player.yaw = 0
  const behind = {id: 'b', pos: {x: world.player.pos.x, y: 0, z: world.player.pos.z - 20}}
  const front = {id: 'f', pos: {x: world.player.pos.x, y: 0, z: world.player.pos.z + 20}}
  assert.equal(spotIsBehind(world, behind), true)
  assert.equal(spotIsBehind(world, front), false)
})

test('the picker never returns a seen spot and takes the behind pool on a roll under 0.75', () => {
  const world = makeWorld()
  world.player.yaw = 0
  for (let round = 0; round < 200; round += 1) {
    const picked = pickSpawnSpot(world, world.rng, {preferBehind: true})
    assert.ok(picked, 'the default map always has a valid spot')
    assert.equal(spotIsValid(world, picked.spot), true, 'the chosen spot is out of view')
  }

  // Two scripted rolls: the first chooses the pool, the second the index.
  const behindRoll = pickSpawnSpot(world, scriptedRng([0.74, 0]), {preferBehind: true})
  assert.equal(behindRoll.behind, true, 'a roll under 0.75 takes a behind spot')
  const anyRoll = pickSpawnSpot(world, scriptedRng([0.76, 0]), {preferBehind: true})
  const allValid = spawnCandidates(world).filter((spot) => spotIsValid(world, spot))
  assert.equal(anyRoll.spot.id, allValid[0].id, 'a roll of 0.75 or more picks from every valid spot')
  assert.equal(pickSpawnSpot(world, scriptedRng([0]), {preferBehind: false}).spot.id, allValid[0].id,
    'without preferBehind the single roll is the index')
})

test('a mob spends the common cost, spawns enraged, and announces itself once', () => {
  const world = makeWorld()
  const {pacer, population} = makePopulation(world, {wave: 3, reservoir: 600})
  const before = pacer.reservoir
  population.nextMobSeconds = 0
  population.step()
  const size = population.pending.length
  assert.ok(size >= POPULATION.mobSize.min, 'a mob is at least six')
  assert.equal(before - pacer.reservoir, size * world.unitCatalog.types.scout.cost)

  for (let tick = 0; tick < 60 * 5 && population.pending.length > 0; tick += 1) {
    world.tick += 1
    population.step()
  }
  const incoming = world.eventLog.filter(({type}) => type === 'mob_incoming')
  assert.equal(incoming.length, 1)
  assert.equal(incoming[0].size, size)
  assert.equal(typeof incoming[0].spotId, 'string')
  const mobUnits = world.aliveUnits.filter((unit) => !unit.wanderer)
  assert.equal(mobUnits.length, size)
  assert.equal(mobUnits.every((unit) => unit.enraged === true), true, 'mob units are enraged')
})

test('the mob curve opens at eight on wave one and clamps at twenty', () => {
  // Ten scouts against the starting revolver killed a scripted bot in 12 to 14 s.
  assert.equal(POPULATION.mobSize.base, 6, 'the wave one opener is eight commons, not ten')
  assert.equal(POPULATION.mobSize.base + POPULATION.mobSize.perWave * 10, 26, 'wave ten asks for 26 before the cap')
  const sizeFor = wave => makePopulation(makeWorld(), {wave, reservoir: 4000}).population.mobSize()
  assert.equal(sizeFor(1), 8)
  assert.equal(sizeFor(10), POPULATION.mobSize.max)
})

test('mob and special timers stand still outside build_up and sustain_peak', () => {
  const world = makeWorld()
  const {pacer, population} = makePopulation(world, {wave: 4, reservoir: 900})
  pacer.state = 'relax'
  const mobTimer = population.nextMobSeconds
  for (let tick = 0; tick < 120; tick += 1) {
    world.tick += 1
    population.step()
  }
  assert.equal(population.nextMobSeconds, mobTimer)
  assert.equal(world.units.length, population.wanderers.size, 'relax spawns nothing new')
})

test('a special is dispatched alerted, 15 to 35 metres out, and pays the reservoir', () => {
  const world = makeWorld()
  const {pacer, population} = makePopulation(world, {wave: 2, reservoir: 900})
  const before = pacer.reservoir
  population.specialTimers.set('endo', 0)
  population.step()
  population.step()
  const dispatched = world.eventLog.filter(({type}) => type === 'special_dispatched')
  assert.equal(dispatched.length, 1)
  assert.equal(dispatched[0].unitType, 'endo')
  assert.equal(before - pacer.reservoir, world.unitCatalog.types.endo.cost)
  const unit = world.unitById.get(dispatched[0].unitId)
  assert.ok(unit.lastKnownPlayer, 'a dispatched special is alerted')
  const distance = Math.hypot(unit.pos.x - world.player.pos.x, unit.pos.z - world.player.pos.z)
  assert.ok(distance >= POPULATION.specialDistance.min && distance <= POPULATION.specialDistance.max, `distance ${distance}`)
})

test('wave start seeds 2 plus half the wave wanderers, dazed and paid for', () => {
  const world = makeWorld()
  const {pacer, population} = makePopulation(world, {wave: 6, reservoir: 900})
  assert.equal(population.wanderers.size, 2 + 3)
  assert.equal(pacer.reservoir, 900 - 5 * world.unitCatalog.types.scout.cost)
  for (const unitId of population.wanderers.keys()) {
    const unit = world.unitById.get(unitId)
    assert.equal(unit.wanderer, true)
    assert.equal(unit.enraged, false, 'a wanderer keeps its default brain')
  }
})

test('an unseen far wanderer despawns and refunds, but never after the reservoir is empty', () => {
  const world = makeWorld()
  const {pacer, population} = makePopulation(world, {wave: 1, reservoir: 400})
  pacer.state = 'peak_fade' // no spending, so only wanderer bookkeeping runs
  const [first, second] = [...population.wanderers.keys()]
  const cost = world.unitCatalog.types.scout.cost
  for (const unitId of [first, second]) {
    const unit = world.unitById.get(unitId)
    unit.pos = {x: 39, y: 0, z: 27}
  }
  world.player.pos = {x: -39, y: 0, z: -27}

  const refundBefore = pacer.reservoir
  runSeconds(world, population, POPULATION.wanderers.despawnSeconds + 1)
  assert.equal(world.unitById.has(first), false, 'the wanderer left quietly')
  assert.equal(pacer.reservoir, refundBefore + 2 * cost, 'both refunds landed')
  assert.equal(world.eventLog.some(({type}) => type === 'unit_death'), false, 'a despawn is silent')
  assert.equal(world.telemetry.units[first].causeOfDeath, 'despawned')

  const {pacer: drained, population: late} = makePopulation(world, {wave: 1, reservoir: 400})
  drained.state = 'peak_fade'
  const lateId = [...late.wanderers.keys()][0]
  world.unitById.get(lateId).pos = {x: 39, y: 0, z: 27}
  drained.drain()
  runSeconds(world, late, POPULATION.wanderers.despawnSeconds + 1)
  assert.equal(world.unitById.has(lateId), false, 'it still leaves')
  assert.equal(drained.reservoir, 0, 'an empty reservoir takes no refund')
})

test('a wanderer in sight keeps its unseen timer at zero', () => {
  const world = makeWorld()
  const {population} = makePopulation(world, {wave: 1, reservoir: 400})
  const unitId = [...population.wanderers.keys()][0]
  const unit = world.unitById.get(unitId)
  world.player.pos = {x: 0, y: 0, z: 0}
  world.player.yaw = 0
  unit.pos = {x: 0, y: 0, z: 8}
  runSeconds(world, population, POPULATION.wanderers.despawnSeconds + 1)
  assert.equal(world.unitById.has(unitId), true, 'a watched wanderer stays')
  assert.equal(population.wanderers.get(unitId).unseenSeconds, 0)
})

test('three or fewer units alive for 15 seconds on an empty reservoir enrage once', () => {
  const world = makeWorld()
  const {pacer, population} = makePopulation(world, {wave: 1, reservoir: 400})
  for (const unitId of [...population.wanderers.keys()]) world.despawnUnit(unitId)
  population.wanderers.clear()
  pacer.drain()
  const unit = world.spawnUnit('scout', {x: 20, y: 0, z: 20})
  assert.equal(unit.enraged, false)

  runSeconds(world, population, POPULATION.stragglers.seconds - 1)
  assert.equal(unit.enraged, false, 'the rule waits the full 15 seconds')
  runSeconds(world, population, 2)
  assert.equal(unit.enraged, true)
  const events = world.eventLog.filter(({type}) => type === 'stragglers_enraged')
  assert.deepEqual(events.map(({count}) => count), [1])

  const second = world.spawnUnit('scout', {x: 21, y: 0, z: 20})
  runSeconds(world, population, POPULATION.stragglers.seconds + 2)
  assert.equal(second.enraged, false, 'the rule fires once per wave')
})

test('the end-of-wave rush spends the held back reserve and empties the reservoir', () => {
  const world = makeWorld()
  const {pacer, population} = makePopulation(world, {wave: 1, reservoir: 400})
  pacer.spend(pacer.spendable)
  assert.ok(pacer.reservoir > 0, 'the reserve survives normal spending')
  population.step()
  assert.equal(pacer.reservoir, 0)
  assert.equal(population.rushDone, true)
  assert.ok(population.pending.length > 0, 'the reserve became a mob')
})

test('the built-in population numbers reach the pacer through the plan', async () => {
  const {BuiltinSkynet} = await import('../../../lib/core/builtin-skynet.js')
  const plan = new BuiltinSkynet().plan({wave: 4, budget: 780, telemetry: null})
  assert.deepEqual(plan.spawns, [], 'no scripted spawns outside boss waves')
  assert.deepEqual(plan.knobs.lights, {})
  assert.deepEqual(plan.knobs.doors, {})
  assert.equal(plan.knobs.fog, 0)
  assert.equal(plan.population.mobSize.min, POPULATION.mobSize.min)
  assert.deepEqual(plan.population.firstMobSeconds, POPULATION.firstMobSeconds)

  const boss = new BuiltinSkynet().plan({wave: 5, budget: 900, telemetry: null})
  assert.deepEqual(boss.spawns.map(({unit, gate}) => `${unit}@${gate}`), ['hktank@S3'])
})

test('shuffling uses the world rng and stays reproducible', () => {
  const first = new SeededRng(5)
  const second = new SeededRng(5)
  const world = makeWorld()
  assert.deepEqual(
    pickSpawnSpot(world, first, {preferBehind: true}).spot.id,
    pickSpawnSpot(world, second, {preferBehind: true}).spot.id,
  )
})

function scriptedRng(values) {
  let index = 0
  return {next: () => values[Math.min(index++, values.length - 1)], range: (min, max) => min + (max - min) * 0.5}
}

function runSeconds(world, population, seconds) {
  for (let tick = 0; tick < Math.round(seconds * 60); tick += 1) {
    world.tick += 1
    population.step()
  }
}
