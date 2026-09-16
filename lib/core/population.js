import {PLAYER_EYE_HEIGHT, directorTelemetry} from './director.js'
import {copyVec, normalizeAngle, planarDistance, round, yawTo} from './math.js'
import {TICK_SECONDS} from './world.js'

/**
 * Population functions for the in-wave pacer: where a spawn may appear, when a
 * mob, a special, or a wanderer is due, and which wave event card is dealt.
 * Everything here spends the pacer reservoir and draws from world.rng, so a
 * seed plus an input stream reproduces the same wave.
 */

export const POPULATION = Object.freeze({
  firstMobSeconds: [5, 10],
  mobIntervalSeconds: [30, 60],
  finaleMobIntervalSeconds: [30, 50],
  mobSize: Object.freeze({base: 6, perWave: 2, min: 6, max: 20}),
  mobSpacingSeconds: 0.25,
  mobJitterMeters: 0.6,
  behindChance: 0.75,
  behindDegrees: 110,
  specials: Object.freeze({
    endo: Object.freeze({everySeconds: [20, 40], count: 1, doubleFromWave: 6, unlockWave: 1}),
    heavy: Object.freeze({everySeconds: [60, 120], count: 1, unlockWave: 2}),
    hkaerial: Object.freeze({everySeconds: [60, 120], count: 1, unlockWave: 3, gatesOnly: true}),
    t1000: Object.freeze({everySeconds: [90, 150], count: 1, unlockWave: 4}),
  }),
  specialDistance: Object.freeze({min: 15, max: 35}),
  wanderers: Object.freeze({
    base: 2,
    perWaves: 2,
    minDistance: 25,
    despawnSeconds: 20,
    despawnDistance: 40,
    // The trickle: build_up tops the map back up to this many living wanderers,
    // one every trickleSeconds, so the gap between mobs still has pressure.
    standing: Object.freeze({base: 3, perWaves: 2}),
    trickleSeconds: 4,
    trickleDistance: Object.freeze({minDistance: 20, maxDistance: 35}),
  }),
  rushReserveFraction: 0.15,
  stragglers: Object.freeze({maxAlive: 3, seconds: 15, unseenSweepSeconds: 30}),
  spotMinDistance: 12,
  spotSightHeight: 1,
  retrySeconds: 1,
  sightIntervalTicks: 30,
  finale: Object.freeze({holdSeconds: 180, mobSize: 12, mobEverySeconds: 20, exitRadius: 6}),
})

export const DECK_CARDS = Object.freeze(['lights_out', 'fog', 'door_lock', 'heavy_pair', 'aerial_patrol', 't1000_hunt', 'nothing'])

export const CARD_UNLOCK_WAVE = Object.freeze({
  lights_out: 1,
  fog: 1,
  door_lock: 2,
  heavy_pair: 2,
  aerial_patrol: 3,
  t1000_hunt: 4,
  nothing: 1,
})

// These three cards wait for a moment inside the wave, so they fire late. Every
// other card fires at wave start, the tick it is dealt.
export const DELAYED_CARDS = Object.freeze(['lights_out', 'heavy_pair', 't1000_hunt'])

export const KNOB_PRICES = Object.freeze({door: 30, light: 40, fogLevel: 20})

export const FOG_CARD_LEVEL = 2
export const DEFAULT_LOCK_DOOR = 'tunnel_w'

export function spawnCandidates(world, {flying = false} = {}) {
  const gates = world.map.spawnGates || []
  // Interior spots are ground only; flyers use gates.
  const interior = flying ? [] : (world.map.spawnSpots || [])
  return [...gates, ...interior]
}

// A spot is usable when every living player is far enough away and none of them
// can see it. Sight runs eye height to chest height, the same as a unit.
export function spotIsValid(world, spot, {minDistance = POPULATION.spotMinDistance, maxDistance = Infinity} = {}) {
  const players = world.livingPlayers
  if (players.length === 0) return true
  let nearest = Infinity
  for (const player of players) {
    const dist = planarDistance(player.pos, spot.pos)
    if (dist < minDistance) return false
    nearest = Math.min(nearest, dist)
    const eye = {...player.pos, y: player.pos.y + PLAYER_EYE_HEIGHT}
    if (world.lineOfSight(eye, {...spot.pos, y: spot.pos.y + POPULATION.spotSightHeight})) return false
  }
  return nearest <= maxDistance
}

export function spotIsBehind(world, spot) {
  const player = world.nearestLivingPlayer(spot.pos)
  if (!player) return false
  const angle = Math.abs(normalizeAngle(yawTo(player.pos, spot.pos) - player.yaw))
  return angle > POPULATION.behindDegrees * Math.PI / 180
}

/**
 * Pick one spawn spot. With preferBehind the pacer takes a spot behind the
 * nearest player 75 percent of the time, whenever such a spot is valid.
 * Returns null when nothing is valid; the caller waits and tries again.
 */
export function pickSpawnSpot(world, rng, {flying = false, preferBehind = false, minDistance, maxDistance} = {}) {
  const valid = spawnCandidates(world, {flying}).filter((spot) => spotIsValid(world, spot, {minDistance, maxDistance}))
  if (valid.length === 0) return null
  const behind = valid.filter((spot) => spotIsBehind(world, spot))
  const roll = preferBehind && behind.length > 0 ? rng.next() : 1
  const pool = roll < POPULATION.behindChance ? behind : valid
  const spot = pool[Math.min(pool.length - 1, Math.floor(rng.next() * pool.length))]
  return {spot, behind: behind.includes(spot)}
}

export function shuffleDeck(cards, rng) {
  const pile = [...cards]
  for (let index = pile.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng.next() * (index + 1))
    const held = pile[index]
    pile[index] = pile[swap]
    pile[swap] = held
  }
  return pile
}

/** One shuffled deck of wave event cards. One card per wave, never twice in a row. */
export class Deck {
  constructor(rng, {cards = DECK_CARDS, unlocks = CARD_UNLOCK_WAVE} = {}) {
    this.rng = rng
    this.cards = [...cards]
    this.unlocks = unlocks
    this.pile = shuffleDeck(this.cards, rng)
    this.lastDealt = null
  }

  // Returns the dealt card and the card that plays. A card locked on this wave
  // plays as nothing but still leaves the pile.
  deal(wave) {
    if (this.pile.length === 0) this.pile = shuffleDeck(this.cards, this.rng)
    let index = this.pile.findIndex((card) => card !== this.lastDealt)
    if (index < 0) {
      this.pile = shuffleDeck(this.cards, this.rng)
      index = Math.max(0, this.pile.findIndex((card) => card !== this.lastDealt))
    }
    const dealt = this.pile.splice(index, 1)[0]
    this.lastDealt = dealt
    const locked = (this.unlocks[dealt] ?? 1) > wave
    return {dealt, card: locked ? 'nothing' : dealt, locked}
  }
}

/**
 * Mobs, specials, wanderers, the end-of-wave rush, the straggler rule, and the
 * spawn half of the wave event cards. Timers advance only while the pacer
 * spends, so a relax window really is quiet.
 */
export class Population {
  constructor(world, pacer, {numbers = POPULATION, rng = world.rng} = {}) {
    this.world = world
    this.pacer = pacer
    this.numbers = {...POPULATION, ...numbers}
    this.rng = rng
    this.wave = 0
    this.card = 'nothing'
    this.finale = false
    this.pending = []
    this.nextMobSeconds = Infinity
    this.specialTimers = new Map()
    this.wanderers = new Map()
    this.stragglerSeconds = 0
    this.stragglersDone = false
    this.rushDone = false
    this.cardDone = new Set()
    this.nextWandererSeconds = 0
    this.unseenAfterEnrage = new Map()
  }

  get idle() {
    return this.pending.length === 0
  }

  get commonType() {
    const types = this.world.unitCatalog.types
    return Object.keys(types).find((id) => types[id].role === 'common') || 'scout'
  }

  unitCost(type) {
    return Number(this.world.unitCatalog.types[type]?.cost) || 0
  }

  // The same script revision the legacy schedule spawns with.
  unitRev(type) {
    return this.world.skynet?.revs?.[type] || 1
  }

  beginWave({wave, card = 'nothing', finale = false}) {
    this.wave = wave
    this.card = card
    this.finale = finale
    this.pending.length = 0
    this.nextMobSeconds = this.rng.range(...this.numbers.firstMobSeconds)
    this.specialTimers = new Map(Object.entries(this.numbers.specials)
      .filter(([, spec]) => wave >= spec.unlockWave)
      .map(([type, spec]) => [type, this.rng.range(...spec.everySeconds)]))
    this.wanderers.clear()
    this.stragglerSeconds = 0
    this.stragglersDone = false
    this.rushDone = false
    this.cardDone.clear()
    this.nextWandererSeconds = this.numbers.wanderers.trickleSeconds
    this.unseenAfterEnrage.clear()
    this.spawnWanderers()
    if (card === 'aerial_patrol') this.spawnCardUnits('hkaerial', 2)
  }

  step() {
    this.flushPending()
    if (this.pacer.spending) {
      const dt = TICK_SECONDS
      this.nextMobSeconds -= dt
      if (this.nextMobSeconds <= 0) this.dueMob()
      for (const [type, remaining] of [...this.specialTimers]) {
        const left = remaining - dt
        this.specialTimers.set(type, left)
        if (left <= 0) this.dueSpecial(type)
      }
      if (this.card === 'heavy_pair' && !this.cardDone.has('heavy_pair') && this.pacer.buildUpCount >= 2) {
        if (this.spawnCardUnits('heavy', 2)) this.cardFired('heavy_pair')
      }
      this.trickleWanderers(dt)
      this.checkRush()
    }
    if (this.card === 'lights_out' && !this.cardDone.has('lights_out') && this.pacer.state === 'sustain_peak') this.fireLightsOut()
    this.checkWanderers()
    this.checkStragglers()
  }

  flushPending() {
    const now = this.world.waveTime()
    while (this.pending.length > 0 && this.pending[0].t <= now + 1e-6) {
      const entry = this.pending.shift()
      const unit = this.world.spawnUnit(entry.type, entry.pos, entry.options)
      if (!unit) continue
      if (entry.announce) {
        this.world.emit('mob_incoming', {size: entry.announce.size, spotId: entry.announce.spotId, behind: entry.announce.behind, pos: copyVec(entry.pos)})
        directorCount(this.world, 'mobs')
      }
      if (entry.dispatch) {
        this.world.emit('special_dispatched', {unitType: unit.type, unitId: unit.id, spotId: entry.dispatch.spotId, pos: copyVec(unit.pos)})
      }
    }
  }

  mobSize() {
    const room = Math.max(0, this.world.maxAlive - this.world.aliveUnits.length - this.pending.length)
    const {base, perWave, min, max} = this.numbers.mobSize
    return Math.max(0, Math.min(base + perWave * this.wave, max, room))
  }

  dueMob() {
    const {min} = this.numbers.mobSize
    const cost = this.unitCost(this.commonType)
    const size = this.mobSize()
    if (size < min || this.pacer.spendable < cost * min) return this.retryMob()
    const affordable = Math.min(size, Math.floor(this.pacer.spendable / Math.max(1, cost)))
    if (affordable < min) return this.retryMob()
    const picked = pickSpawnSpot(this.world, this.rng, {preferBehind: true})
    if (!picked) return this.retryMob()
    if (!this.pacer.spend(cost * affordable)) return this.retryMob()
    this.queueMob(picked, affordable)
    if (this.card === 't1000_hunt' && !this.cardDone.has('t1000_hunt')) {
      if (this.spawnCardUnits('t1000', 1)) this.cardFired('t1000_hunt')
    }
    this.nextMobSeconds = this.rng.range(...(this.finale ? this.numbers.finaleMobIntervalSeconds : this.numbers.mobIntervalSeconds))
    return true
  }

  retryMob() {
    this.nextMobSeconds = this.numbers.retrySeconds
    return false
  }

  // A free mob ignores the reservoir. The extraction finale uses it.
  spawnMob({size, preferBehind = true} = {}) {
    const room = Math.max(0, this.world.maxAlive - this.world.aliveUnits.length - this.pending.length)
    const count = Math.max(0, Math.min(size, room))
    if (count === 0) return false
    const picked = pickSpawnSpot(this.world, this.rng, {preferBehind})
    if (!picked) return false
    this.queueMob(picked, count)
    return true
  }

  queueMob({spot, behind}, size) {
    const now = this.world.waveTime()
    const jitter = this.numbers.mobJitterMeters
    for (let index = 0; index < size; index += 1) {
      this.pending.push({
        t: round(now + index * this.numbers.mobSpacingSeconds, 4),
        type: this.commonType,
        pos: {
          x: spot.pos.x + this.rng.range(-jitter, jitter),
          y: spot.pos.y,
          z: spot.pos.z + this.rng.range(-jitter, jitter),
        },
        options: {yaw: spot.yaw || 0, rev: this.unitRev(this.commonType), enraged: true},
        ...(index === 0 ? {announce: {size, spotId: spot.id, behind}} : {}),
      })
    }
    this.pending.sort((a, b) => a.t - b.t)
  }

  dueSpecial(type) {
    const spec = this.numbers.specials[type]
    const count = spec.doubleFromWave && this.wave >= spec.doubleFromWave ? 2 : spec.count
    const spawned = this.spawnSpecial(type, count, {gatesOnly: spec.gatesOnly === true})
    this.specialTimers.set(type, spawned ? this.rng.range(...spec.everySeconds) : this.numbers.retrySeconds)
  }

  spawnSpecial(type, count, {gatesOnly = false} = {}) {
    const cost = this.unitCost(type)
    let spawned = 0
    for (let index = 0; index < count; index += 1) {
      if (this.world.aliveUnits.length + this.pending.length >= this.world.maxAlive) break
      const picked = pickSpawnSpot(this.world, this.rng, {
        flying: gatesOnly || this.world.unitCatalog.types[type]?.flying === true,
        minDistance: this.numbers.specialDistance.min,
        maxDistance: this.numbers.specialDistance.max,
      })
      if (!picked) break
      if (!this.pacer.spend(cost)) break
      this.pending.push({
        t: this.world.waveTime(),
        type,
        pos: copyVec(picked.spot.pos),
        options: {yaw: picked.spot.yaw || 0, rev: this.unitRev(type), alerted: true},
        dispatch: {spotId: picked.spot.id},
      })
      spawned += 1
    }
    if (spawned > 0) this.pending.sort((a, b) => a.t - b.t)
    return spawned > 0
  }

  // Deck spawns pay the same reservoir price as a dispatched special.
  spawnCardUnits(type, count) {
    return this.spawnSpecial(type, count, {gatesOnly: this.numbers.specials[type]?.gatesOnly === true})
  }

  spawnWanderers() {
    const {base, perWaves, minDistance} = this.numbers.wanderers
    const count = base + Math.floor(this.wave / perWaves)
    for (let index = 0; index < count; index += 1) {
      if (!this.spawnWanderer({minDistance})) break
    }
  }

  spawnWanderer({minDistance, maxDistance = Infinity} = {}) {
    const type = this.commonType
    const cost = this.unitCost(type)
    if (this.world.aliveUnits.length + this.pending.length >= this.world.maxAlive) return false
    const picked = pickSpawnSpot(this.world, this.rng, {minDistance, maxDistance})
    if (!picked) return false
    if (!this.pacer.spend(cost)) return false
    const unit = this.world.spawnUnit(type, copyVec(picked.spot.pos), {yaw: picked.spot.yaw || 0, rev: this.unitRev(type), wanderer: true})
    if (!unit) return false
    this.wanderers.set(unit.id, {cost, unseenSeconds: 0})
    return true
  }

  standingWanderers() {
    const {standing} = this.numbers.wanderers
    return standing.base + Math.floor(this.wave / standing.perWaves)
  }

  livingWanderers() {
    let living = 0
    for (const unitId of this.wanderers.keys()) if (this.world.unitById.get(unitId)?.alive) living += 1
    return living
  }

  /**
   * Build up tops the map back up to the standing wanderer count, one every four
   * seconds. Mobs stay rare and loud; the trickle is what fills the quiet.
   */
  trickleWanderers(dt) {
    if (this.pacer.state !== 'build_up') return
    this.nextWandererSeconds -= dt
    if (this.nextWandererSeconds > 0) return
    this.nextWandererSeconds = this.numbers.wanderers.trickleSeconds
    if (this.livingWanderers() >= this.standingWanderers()) return
    this.spawnWanderer(this.numbers.wanderers.trickleDistance)
  }

  // A wanderer nobody has seen for 20 seconds, 40 metres out, leaves quietly and
  // pays its cost back. An empty reservoir keeps the refund.
  checkWanderers() {
    if (this.world.tick % this.numbers.sightIntervalTicks !== 0) return
    const step = this.numbers.sightIntervalTicks * TICK_SECONDS
    const {despawnSeconds, despawnDistance} = this.numbers.wanderers
    for (const [unitId, record] of [...this.wanderers]) {
      const unit = this.world.unitById.get(unitId)
      if (!unit?.alive) {
        this.wanderers.delete(unitId)
        continue
      }
      if (this.world.unitSeenByAnyPlayer?.(unit)) {
        record.unseenSeconds = 0
        continue
      }
      record.unseenSeconds += step
      if (record.unseenSeconds < despawnSeconds) continue
      const players = this.world.livingPlayers
      const nearest = players.reduce((best, player) => Math.min(best, planarDistance(player.pos, unit.pos)), Infinity)
      if (players.length > 0 && nearest <= despawnDistance) continue
      if (this.world.despawnUnit?.(unitId)) {
        this.wanderers.delete(unitId)
        this.pacer.refund(record.cost)
      }
    }
  }

  // The smallest purchase the pacer can still make this wave: a minimum mob, or
  // the cheapest unlocked special. Below it the reservoir is spent, whatever the
  // leftover change says, so the rush fires instead of stalling the wave.
  minimumSpend() {
    const mob = this.unitCost(this.commonType) * this.numbers.mobSize.min
    const specials = Object.entries(this.numbers.specials)
      .filter(([, spec]) => this.wave >= spec.unlockWave)
      .map(([type]) => this.unitCost(type))
    return Math.max(1, Math.min(mob, ...specials))
  }

  checkRush() {
    if (this.rushDone || this.pacer.reservoir <= 0) return
    if (this.pacer.spendable >= this.minimumSpend()) return
    const cost = Math.max(1, this.unitCost(this.commonType))
    this.pacer.releaseReserve()
    const size = Math.max(1, Math.floor(this.pacer.reservoir / cost))
    if (!this.spawnMob({size, preferBehind: true})) return
    this.rushDone = true
    this.pacer.drain()
  }

  // The four minute cap and the finale both end the reservoir at once.
  forceRush() {
    if (this.rushDone) return
    this.pacer.releaseReserve()
    if (this.pacer.reservoir > 0) {
      const cost = Math.max(1, this.unitCost(this.commonType))
      this.spawnMob({size: Math.max(1, Math.floor(this.pacer.reservoir / cost))})
    }
    this.rushDone = true
    this.pacer.drain()
  }

  checkStragglers() {
    if (this.stragglersDone) return this.sweepUnreachable()
    const alive = this.world.aliveUnits
    const hunting = this.pacer.reservoir <= 0 && this.pending.length === 0 && alive.length > 0 && alive.length <= this.numbers.stragglers.maxAlive
    if (!hunting) {
      this.stragglerSeconds = 0
      return
    }
    this.stragglerSeconds += TICK_SECONDS
    if (this.stragglerSeconds < this.numbers.stragglers.seconds) return
    let count = 0
    for (const unit of alive) if (this.world.enrageUnit?.(unit.id)) count += 1
    this.stragglersDone = true
    this.world.emit('stragglers_enraged', {count})
    directorCount(this.world, 'stragglers')
  }

  /**
   * A wave must always be able to end. The straggler rule already sent every
   * survivor at the players. A unit that no player has seen for another thirty
   * seconds after that is stuck in the map, so it leaves silently and the wave
   * closes. Nothing that a player can see is ever swept.
   */
  sweepUnreachable() {
    if (this.pacer.reservoir > 0 || this.pending.length > 0) return
    if (this.world.tick % this.numbers.sightIntervalTicks !== 0) return
    const step = this.numbers.sightIntervalTicks * TICK_SECONDS
    for (const unit of [...this.world.aliveUnits]) {
      if (this.world.unitSeenByAnyPlayer?.(unit)) {
        this.unseenAfterEnrage.set(unit.id, 0)
        continue
      }
      const unseen = (this.unseenAfterEnrage.get(unit.id) || 0) + step
      this.unseenAfterEnrage.set(unit.id, unseen)
      if (unseen < this.numbers.stragglers.unseenSweepSeconds) continue
      if (this.world.despawnUnit?.(unit.id)) this.unseenAfterEnrage.delete(unit.id)
    }
  }

  fireLightsOut() {
    const zone = nearestLightZone(this.world)
    if (!zone) return
    if (!this.pacer.spend(KNOB_PRICES.light)) return
    this.world.configureMap({lights: {[zone.id]: 'off'}})
    this.cardFired('lights_out')
  }

  // A delayed card says so when the effect lands, never when it is dealt.
  cardFired(card) {
    this.cardDone.add(card)
    this.world.emit('deck_card', {card, wave: this.wave, phase: 'fired'})
  }
}

export function nearestLightZone(world) {
  const zones = world.map.lightZones || []
  const players = world.livingPlayers
  if (zones.length === 0) return null
  if (players.length === 0) return zones[0]
  const team = players.reduce((sum, player) => ({x: sum.x + player.pos.x / players.length, z: sum.z + player.pos.z / players.length}), {x: 0, z: 0})
  return [...zones].sort((a, b) => Math.hypot(a.pos.x - team.x, a.pos.z - team.z) - Math.hypot(b.pos.x - team.x, b.pos.z - team.z)
    || a.id.localeCompare(b.id))[0]
}

function directorCount(world, key) {
  if (world.telemetry) directorTelemetry(world)[key] += 1
}
