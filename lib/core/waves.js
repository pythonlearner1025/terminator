import mapData from './data/map.json' with {type: 'json'}
import unitsData from './data/units.json' with {type: 'json'}
import {clamp, copyVec, planarDistance, round} from './math.js'

export const MAX_WAVES = 10
export const INTERMISSION_SECONDS = 45
export const WAVE_TIME_CAP_SECONDS = 240

export function performanceMultiplier(telemetry) {
  if (!telemetry) return 1
  const healthLost = telemetry.healthLost ?? telemetry.damageTaken?.reduce((sum, event) => sum + event.amount, 0) ?? 0
  const clearSeconds = telemetry.timeToClear ?? 120
  const damagePerMinute = telemetry.damagePerMinute ?? (clearSeconds > 0 ? healthLost * 60 / clearSeconds : healthLost)
  const healthScore = clamp(1 - healthLost / 100, -1, 1) * 0.25
  const speedScore = clamp((120 - clearSeconds) / 90, -1, 1) * 0.25
  const damageScore = clamp((180 - damagePerMinute) / 180, -1, 1) * 0.15
  return round(clamp(1 + healthScore + speedScore + damageScore, 0.8, 1.5), 3)
}

export function waveBudget(wave, telemetry = null) {
  const multiplier = performanceMultiplier(telemetry)
  return {base: 300 + 120 * wave, multiplier, applied: Math.round((300 + 120 * wave) * multiplier)}
}

export function mapKnobCost(knobs = {}) {
  return Object.keys(knobs.doors || {}).length * 30
    + Object.keys(knobs.lights || {}).length * 40
    + clamp(Number(knobs.fog) || 0, 0, 3) * 20
    + (knobs.hazards?.length || 0) * 60
    + (knobs.break_flank_wall ? 150 : 0)
}

export function configCost(config, catalog = unitsData) {
  const unitCost = (config.spawns || []).reduce((sum, group) => {
    const unit = catalog.types[group.unit]
    return sum + (unit ? unit.cost * Math.max(0, Number(group.count) || 0) : 0)
  }, 0)
  return unitCost + mapKnobCost(config.knobs)
}

export function validateWaveConfig(config, {wave = 1, budget, map = mapData, catalog = unitsData} = {}) {
  const appliedBudget = budget ?? waveBudget(wave).applied
  const errors = []
  const spawns = Array.isArray(config?.spawns) ? config.spawns : []
  const knobs = config?.knobs && typeof config.knobs === 'object' ? config.knobs : {}
  const knownGates = new Set(map.spawnGates.map(({id}) => id))
  const knownDoors = new Set(map.doors.map(({id}) => id))
  const knownLights = new Set(map.lightZones.map(({id}) => id))
  const knownHazards = new Map(map.hazardSlots.map((slot) => [slot.id, new Set(slot.types)]))
  const activeGates = Array.isArray(knobs.gates) ? knobs.gates : [...new Set(spawns.map(({gate}) => gate).filter(Boolean))]

  if (!Array.isArray(config?.spawns)) errors.push(error('spawns', 'INVALID_SPAWNS', 'spawns must be an array'))
  if (!config?.knobs || typeof config.knobs !== 'object' || Array.isArray(config.knobs)) {
    errors.push(error('knobs', 'INVALID_KNOBS', 'knobs must be an object'))
  }
  if (activeGates.length > 3) errors.push(error('knobs.gates', 'TOO_MANY_GATES', 'at most three spawn gates may be active'))
  activeGates.forEach((id, index) => {
    if (!knownGates.has(id)) errors.push(error(`knobs.gates.${index}`, 'UNKNOWN_GATE', `unknown spawn gate: ${id}`))
  })
  for (const [id, state] of Object.entries(knobs.doors || {})) {
    if (!knownDoors.has(id)) errors.push(error(`knobs.doors.${id}`, 'UNKNOWN_DOOR', `unknown door: ${id}`))
    if (!['locked', 'unlocked'].includes(state)) errors.push(error(`knobs.doors.${id}`, 'INVALID_DOOR_STATE', `invalid door state for ${id}: ${state}`))
  }
  for (const [id, state] of Object.entries(knobs.lights || {})) {
    if (!knownLights.has(id)) errors.push(error(`knobs.lights.${id}`, 'UNKNOWN_LIGHT', `unknown light zone: ${id}`))
    if (!['on', 'off'].includes(state)) errors.push(error(`knobs.lights.${id}`, 'INVALID_LIGHT_STATE', `invalid light state for ${id}: ${state}`))
  }
  if (!Number.isInteger(knobs.fog ?? 0) || (knobs.fog ?? 0) < 0 || (knobs.fog ?? 0) > 3) {
    errors.push(error('knobs.fog', 'INVALID_FOG', 'fog must be an integer from 0 to 3'))
  }
  for (const [index, hazard] of (knobs.hazards || []).entries()) {
    const types = knownHazards.get(hazard.slot)
    if (!types) errors.push(error(`knobs.hazards.${index}.slot`, 'UNKNOWN_HAZARD_SLOT', `unknown hazard slot: ${hazard.slot}`))
    else if (!types.has(hazard.kind)) errors.push(error(`knobs.hazards.${index}.kind`, 'UNKNOWN_HAZARD_KIND', `unknown hazard kind for ${hazard.slot}: ${hazard.kind}`))
  }

  const spendByType = Object.fromEntries(Object.keys(catalog.types).map((id) => [id, 0]))
  for (const [index, group] of spawns.entries()) {
    if (!Number.isFinite(group.t) || group.t < 0) errors.push(error(`spawns.${index}.t`, 'INVALID_SPAWN_TIME', 'spawn time must be zero or greater'))
    if (!knownGates.has(group.gate)) errors.push(error(`spawns.${index}.gate`, 'UNKNOWN_GATE', `unknown spawn gate: ${group.gate}`))
    if (activeGates.length && knownGates.has(group.gate) && !activeGates.includes(group.gate)) {
      errors.push(error(`spawns.${index}.gate`, 'INACTIVE_GATE', `spawn gate is not active: ${group.gate}`))
    }
    const unit = catalog.types[group.unit]
    if (!unit) errors.push(error(`spawns.${index}.unit`, 'UNKNOWN_UNIT', `unknown unit type: ${group.unit}`))
    if (!Number.isInteger(group.count) || group.count < 1) errors.push(error(`spawns.${index}.count`, 'INVALID_COUNT', 'spawn count must be a positive integer'))
    if (unit && Number.isInteger(group.count) && group.count > 0) spendByType[group.unit] += unit.cost * group.count
  }

  for (const [id, spend] of Object.entries(spendByType)) {
    if (spend > appliedBudget * 0.4 + 1e-9) {
      errors.push(error('spawns', 'UNIT_BUDGET_CAP', `${id} exceeds 40 percent of the wave budget`))
    }
  }
  const usedTypes = Object.values(spendByType).filter((spend) => spend > 0).length
  if (wave >= 3 && usedTypes < 2) errors.push(error('spawns', 'TOO_FEW_UNIT_TYPES', 'waves three and later require at least two unit types'))
  const cost = configCost({spawns, knobs}, catalog)
  if (cost > appliedBudget) errors.push(error('', 'OVER_BUDGET', `config costs ${cost}, budget is ${appliedBudget}`))
  return {ok: errors.length === 0, errors, cost, budget: appliedBudget}
}

export class WaveDirector {
  constructor(world, {builtin, intermissionSeconds = INTERMISSION_SECONDS, maxWaves = MAX_WAVES} = {}) {
    this.world = world
    this.builtin = builtin
    this.intermissionSeconds = intermissionSeconds
    this.maxWaves = maxWaves
    this.phase = 'lobby'
    this.wave = 0
    this.config = null
    this.spawnSchedule = []
    this.nextSpawn = 0
    this.intermissionTicksLeft = 0
    this.lastTelemetry = null
  }

  start(config = null) {
    if (this.phase !== 'lobby') return false
    return this.beginWave(config)
  }

  beginWave(config = null) {
    const wave = this.wave + 1
    if (wave > this.maxWaves) {
      this.setPhase('ended')
      return false
    }
    const budgetInfo = waveBudget(wave, this.lastTelemetry)
    const candidate = config || this.builtin?.plan({wave, budget: budgetInfo.applied, multiplier: budgetInfo.multiplier, telemetry: this.lastTelemetry})
    const validation = validateWaveConfig(candidate, {wave, budget: budgetInfo.applied, map: this.world.map, catalog: this.world.unitCatalog})
    if (!validation.ok) return validation

    this.wave = wave
    this.config = structuredClone(candidate)
    this.spawnSchedule = expandSpawnGroups(candidate.spawns)
    this.nextSpawn = 0
    this.world.wave = wave
    this.world.phase = 'wave'
    this.world.waveBudget = budgetInfo.applied
    this.world.performanceMultiplier = budgetInfo.multiplier
    this.world.configureMap(candidate.knobs)
    this.world.resetWaveTelemetry({budget: budgetInfo.applied, knobs: candidate.knobs})
    this.setPhase('wave')
    this.world.emit('config_applied', {fallback: !config, budget: budgetInfo.applied, multiplier: budgetInfo.multiplier})
    return {ok: true, errors: [], cost: validation.cost, budget: validation.budget}
  }

  step(inputs) {
    if (this.phase === 'lobby') this.start()
    if (this.phase === 'wave') {
      this.spawnDueUnits()
      if (this.world.waveTime() >= WAVE_TIME_CAP_SECONDS) this.forceRush()
      this.world.step(inputs)
      if (!this.world.player.alive) this.setPhase('ended')
      else if (this.nextSpawn >= this.spawnSchedule.length && this.world.aliveUnits.length === 0) this.finishWave()
      return
    }
    if (this.phase === 'intermission') {
      this.world.step(inputs)
      this.intermissionTicksLeft = Math.max(0, this.intermissionTicksLeft - 1)
      this.world.phaseTicksLeft = this.intermissionTicksLeft
      if (inputs.ready || this.intermissionTicksLeft === 0) this.beginWave()
      return
    }
    this.world.step(inputs)
  }

  spawnDueUnits() {
    while (this.nextSpawn < this.spawnSchedule.length && this.world.aliveUnits.length < this.world.unitCatalog.maxAlive) {
      const entry = this.spawnSchedule[this.nextSpawn]
      if (entry.t > this.world.waveTime() + 1e-6) break
      const gate = this.world.map.spawnGates.find(({id}) => id === entry.gate)
      if (!gate) break
      const offset = ((entry.index % 3) - 1) * 0.55
      this.world.spawnUnit(entry.unit, {x: gate.pos.x + offset, y: gate.pos.y, z: gate.pos.z + offset}, {
        yaw: gate.yaw,
        rev: this.world.skynet.revs[entry.unit] || 1,
      })
      this.nextSpawn += 1
    }
  }

  forceRush() {
    for (const unit of this.world.aliveUnits) {
      unit.intent.moveTo = copyVec(this.world.player.pos)
      unit.intent.face = copyVec(this.world.player.pos)
      unit.intent.aimAt = copyVec(this.world.player.pos)
      unit.intent.fire = true
      unit.intent.melee = true
      unit.reactionReadyTick = this.world.tick
    }
  }

  finishWave() {
    this.world.telemetry.timeToClear = this.world.waveTime()
    this.lastTelemetry = structuredClone(this.world.telemetry)
    if (this.wave >= this.maxWaves) {
      this.setPhase('ended')
      return
    }
    this.intermissionTicksLeft = Math.round(this.intermissionSeconds * 60)
    this.world.phaseTicksLeft = this.intermissionTicksLeft
    this.setPhase('intermission')
  }

  setPhase(phase) {
    if (this.phase === phase && this.world.phase === phase) return
    this.phase = phase
    this.world.phase = phase
    this.world.emit('phase', {phase, wave: this.wave, secondsLeft: round(this.intermissionTicksLeft / 60, 3)})
  }
}

export function expandSpawnGroups(groups = []) {
  return groups.flatMap((group) => Array.from({length: group.count}, (_, index) => ({
    t: group.t + index * 0.5,
    gate: group.gate,
    unit: group.unit,
    index,
  }))).sort((a, b) => a.t - b.t || a.gate.localeCompare(b.gate) || a.unit.localeCompare(b.unit))
}

function error(path, code, message) {
  return {path, code, message}
}

export function nearestGates(map, pos, count = 3) {
  return [...map.spawnGates]
    .sort((a, b) => planarDistance(a.pos, pos) - planarDistance(b.pos, pos) || a.id.localeCompare(b.id))
    .slice(0, count)
    .map(({id}) => id)
}
