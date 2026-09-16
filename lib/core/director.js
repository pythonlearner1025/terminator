import {planarDistance, round} from './math.js'
import {TICK_SECONDS} from './world.js'

/**
 * In-wave pacer. It keeps one intensity number per living player, drives the
 * four director states from the team maximum, and holds the wave reservoir the
 * population functions spend. Headless and deterministic: every timer comes
 * from world.rng and every clock from the tick counter.
 */

// Sight tests run from here; world.js uses the same standing eye height.
export const PLAYER_EYE_HEIGHT = 1.65

export const DIRECTOR_STATES = Object.freeze({
  buildUp: 'build_up',
  sustainPeak: 'sustain_peak',
  peakFade: 'peak_fade',
  relax: 'relax',
})

export const SPENDING_STATES = Object.freeze([DIRECTOR_STATES.buildUp, DIRECTOR_STATES.sustainPeak])

export const INTENSITY = Object.freeze({
  perDamagePoint: 1 / 100,
  lowHealth: 25,
  lowHealthGain: 0.3,
  deathRadius: 16,
  deathGain: 0.1,
  decayPerSecond: 0.1,
  min: 0,
  max: 1.5,
  engagedDamageSeconds: 3,
  engagedRadius: 12,
  // The line-of-sight half of the engaged rule runs at 2 Hz.
  sightIntervalTicks: 30,
})

export const PACING = Object.freeze({
  peak: 1,
  fade: 0.6,
  sustainSeconds: [3, 5],
  relaxSeconds: [15, 25],
})

export function directorTelemetry(world) {
  const telemetry = world.telemetry
  if (!telemetry) return {peaks: 0, mobs: 0, stragglers: 0, relaxSeconds: 0}
  telemetry.director ??= {peaks: 0, mobs: 0, stragglers: 0, relaxSeconds: 0}
  return telemetry.director
}

export class Pacer {
  constructor(world, {rng = world.rng} = {}) {
    this.world = world
    this.rng = rng
    this.wave = 0
    this.state = DIRECTOR_STATES.buildUp
    this.stateSeconds = 0
    this.stateTimer = 0
    this.buildUpCount = 0
    this.intensityByPlayer = new Map()
    this.lastDamageAt = new Map()
    this.sightEngaged = new Map()
    this.lastHp = new Map()
    this.eventCursor = world.eventLog.length
    this.reservoir = 0
    this.reservoirMax = 0
    this.rushReserve = 0
    this.reserveReleased = false
    this.sync()
  }

  // A wave always opens in build_up with a fresh reservoir. Intensity carries
  // over from the last wave, as the contract requires.
  beginWave({wave, reservoir = 0, rushReserveFraction = 0}) {
    this.wave = wave
    this.reservoirMax = Math.max(0, Math.round(reservoir))
    this.reservoir = this.reservoirMax
    this.rushReserve = Math.round(this.reservoirMax * rushReserveFraction)
    this.reserveReleased = false
    this.eventCursor = this.world.eventLog.length
    this.buildUpCount = 1
    this.stateSeconds = 0
    this.state = DIRECTOR_STATES.buildUp
    this.stateTimer = 0
    for (const player of this.world.players.values()) this.lastHp.set(player.id, player.hp)
    directorTelemetry(this.world)
    this.sync()
    this._emitState()
  }

  // Back to the lobby: cold meter, empty reservoir, no open trader.
  reset() {
    this.wave = 0
    this.state = DIRECTOR_STATES.buildUp
    this.stateSeconds = 0
    this.stateTimer = 0
    this.buildUpCount = 0
    this.intensityByPlayer.clear()
    this.lastDamageAt.clear()
    this.sightEngaged.clear()
    this.lastHp.clear()
    this.eventCursor = this.world.eventLog.length
    this.reservoir = 0
    this.reservoirMax = 0
    this.rushReserve = 0
    this.reserveReleased = false
    this.sync()
  }

  get spending() {
    return SPENDING_STATES.includes(this.state)
  }

  // Money the population may spend right now. The end-of-wave rush reserve is
  // off limits until releaseReserve opens it.
  get spendable() {
    return Math.max(0, this.reservoir - (this.reserveReleased ? 0 : this.rushReserve))
  }

  spend(amount) {
    const cost = Math.max(0, Math.round(amount))
    if (cost > this.spendable) return false
    this.reservoir -= cost
    return true
  }

  // Wanderers pay their cost back when they leave unseen. A reservoir already
  // at zero never grows again, so the wave can still end.
  refund(amount) {
    if (this.reservoir <= 0) return false
    this.reservoir = Math.min(this.reservoirMax, this.reservoir + Math.max(0, Math.round(amount)))
    return true
  }

  releaseReserve() {
    this.reserveReleased = true
  }

  drain() {
    this.reservoir = 0
    this.reserveReleased = true
  }

  intensity(playerId) {
    return this.intensityByPlayer.get(playerId) || 0
  }

  setIntensity(playerId, value) {
    this.intensityByPlayer.set(playerId, clampIntensity(value))
  }

  teamIntensity() {
    let peak = 0
    for (const player of this.world.livingPlayers) peak = Math.max(peak, this.intensity(player.id))
    return peak
  }

  step() {
    this._consumeEvents()
    this._updateSight()
    this._decay()
    this._advanceState()
    this.sync()
  }

  // Writes the fields the HUD, the view model, and co-op guests read.
  sync() {
    this.world.director = {
      state: this.state,
      intensity: round(this.teamIntensity(), 4),
      reservoir: this.reservoir,
      reservoirMax: this.reservoirMax,
    }
    this.world.traderOpen = this.world.phase === 'intermission' || this.state === DIRECTOR_STATES.relax
  }

  engaged(playerId) {
    const since = this.lastDamageAt.get(playerId)
    if (since != null && this.world.waveTime() - since <= INTENSITY.engagedDamageSeconds) return true
    return this.sightEngaged.get(playerId) === true
  }

  _consumeEvents() {
    const log = this.world.eventLog
    while (this.eventCursor < log.length) {
      const event = log[this.eventCursor]
      this.eventCursor += 1
      if (event.type === 'player_damage') {
        const playerId = event.playerId || this.world.hostPlayerId
        this.lastDamageAt.set(playerId, this.world.waveTime())
        this._add(playerId, Number(event.amount || 0) * INTENSITY.perDamagePoint)
      } else if (event.type === 'unit_death') {
        const pos = this.world.unitById.get(event.unitId)?.pos
        if (!pos) continue
        for (const player of this.world.livingPlayers) {
          const dist = planarDistance(player.pos, pos)
          if (dist >= INTENSITY.deathRadius) continue
          this._add(player.id, INTENSITY.deathGain * (1 - dist / INTENSITY.deathRadius))
        }
      }
    }
    for (const player of this.world.players.values()) {
      const previous = this.lastHp.get(player.id)
      if (player.alive && previous != null && previous >= INTENSITY.lowHealth && player.hp < INTENSITY.lowHealth) {
        this._add(player.id, INTENSITY.lowHealthGain)
      }
      this.lastHp.set(player.id, player.hp)
    }
  }

  _updateSight() {
    if (this.world.tick % INTENSITY.sightIntervalTicks !== 0) return
    for (const player of this.world.players.values()) {
      if (!player.alive) {
        this.sightEngaged.set(player.id, false)
        continue
      }
      const eye = {...player.pos, y: player.pos.y + PLAYER_EYE_HEIGHT}
      let engaged = false
      for (const unit of this.world.aliveUnits) {
        if (planarDistance(player.pos, unit.pos) > INTENSITY.engagedRadius) continue
        if (!this.world.lineOfSight(this.world.unitEye(unit), eye)) continue
        engaged = true
        break
      }
      this.sightEngaged.set(player.id, engaged)
    }
  }

  _decay() {
    for (const player of this.world.livingPlayers) {
      if (this.engaged(player.id)) continue
      this._add(player.id, -INTENSITY.decayPerSecond * TICK_SECONDS)
    }
  }

  _advanceState() {
    this.stateSeconds += TICK_SECONDS
    if (this.state === DIRECTOR_STATES.relax) {
      const telemetry = directorTelemetry(this.world)
      telemetry.relaxSeconds = round(telemetry.relaxSeconds + TICK_SECONDS, 4)
    }
    const team = this.teamIntensity()
    if (this.state === DIRECTOR_STATES.buildUp && team >= PACING.peak) return this._setState(DIRECTOR_STATES.sustainPeak)
    if (this.state === DIRECTOR_STATES.sustainPeak && this.stateSeconds >= this.stateTimer) return this._setState(DIRECTOR_STATES.peakFade)
    if (this.state === DIRECTOR_STATES.peakFade && (team <= PACING.fade || this.world.aliveUnits.length === 0)) return this._setState(DIRECTOR_STATES.relax)
    if (this.state === DIRECTOR_STATES.relax && this.stateSeconds >= this.stateTimer) return this._setState(DIRECTOR_STATES.buildUp)
    return false
  }

  _setState(next) {
    this.state = next
    this.stateSeconds = 0
    this.stateTimer = next === DIRECTOR_STATES.sustainPeak ? this.rng.range(...PACING.sustainSeconds)
      : next === DIRECTOR_STATES.relax ? this.rng.range(...PACING.relaxSeconds)
        : 0
    if (next === DIRECTOR_STATES.sustainPeak) directorTelemetry(this.world).peaks += 1
    if (next === DIRECTOR_STATES.buildUp) this.buildUpCount += 1
    this.sync()
    this._emitState()
    return true
  }

  _emitState() {
    this.world.emit('director_state', {
      state: this.state,
      wave: this.wave,
      intensity: round(this.teamIntensity(), 4),
      reservoir: this.reservoir,
      reservoirMax: this.reservoirMax,
    })
  }

  _add(playerId, amount) {
    this.intensityByPlayer.set(playerId, clampIntensity(this.intensity(playerId) + amount))
  }
}

function clampIntensity(value) {
  return Math.max(INTENSITY.min, Math.min(INTENSITY.max, round(Number(value) || 0, 6)))
}
