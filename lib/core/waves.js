import {defaultMap as mapData} from './map.js'
import unitsData from './data/units.json' with {type: 'json'}
import {DIFFICULTIES, getDifficulty} from './data/difficulty.js'
import * as scoutBrain from './brains/default-scout.js'
import * as endoBrain from './brains/default-endo.js'
import * as heavyBrain from './brains/default-heavy.js'
import * as t1000Brain from './brains/default-t1000.js'
import * as hkaerialBrain from './brains/default-hkaerial.js'
import * as hktankBrain from './brains/default-hktank.js'
import scoutScriptSource from './brains/default-scout.script-src.js'
import endoScriptSource from './brains/default-endo.script-src.js'
import heavyScriptSource from './brains/default-heavy.script-src.js'
import t1000ScriptSource from './brains/default-t1000.script-src.js'
import hkaerialScriptSource from './brains/default-hkaerial.script-src.js'
import hktankScriptSource from './brains/default-hktank.script-src.js'
import {EventBus} from './events.js'
import {clamp, copyVec, planarDistance, round} from './math.js'
import {buildWaveSummary, finalizeWaveTelemetry, telemetryPerformanceInputs} from './telemetry.js'
import {EMPTY_INPUTS} from './world.js'

export const MAX_WAVES = 10
export const INTERMISSION_SECONDS = 45
export const WAVE_CLEAR_SCRAP = 150
export const WAVE_TIME_CAP_SECONDS = 240
export const SCRIPT_API_VERSION = 1
export const MAX_SIMULATIONS_PER_INTERMISSION = 10
export const MAX_SIMULATION_WALL_SECONDS = 10
export const MAX_SIMULATION_SPEED = 50
export const COOP_SCALING = Object.freeze({
  1: Object.freeze({players: 1, budgetMultiplier: 1, unitHealthMultiplier: 1, maxAlive: 24}),
  2: Object.freeze({players: 2, budgetMultiplier: 1.6, unitHealthMultiplier: 1.35, maxAlive: 30}),
  3: Object.freeze({players: 3, budgetMultiplier: 2.1, unitHealthMultiplier: 1.7, maxAlive: 36}),
})

export const PERFORMANCE_FORMULA = Object.freeze({
  base: '300 + 120 * wave',
  multiplier: 'clamp(1 + health_score + speed_score + damage_score, 0.8, 1.5)',
  health_score: 'clamp(1 - health_lost / 100, -1, 1) * 0.25',
  speed_score: 'clamp((120 - time_to_clear) / 90, -1, 1) * 0.25',
  damage_score: 'clamp((180 - damage_per_minute) / 180, -1, 1) * 0.15',
  applied: 'round(base * multiplier)',
  inputs: Object.freeze(['health_lost', 'time_to_clear', 'damage_per_minute']),
  min: 0.8,
  max: 1.5,
})

const DEFAULT_BRAINS = {scout: scoutBrain, endo: endoBrain, heavy: heavyBrain, t1000: t1000Brain, hkaerial: hkaerialBrain, hktank: hktankBrain}
const DEFAULT_SCRIPT_SOURCES = {
  scout: scoutScriptSource,
  endo: endoScriptSource,
  heavy: heavyScriptSource,
  t1000: t1000ScriptSource,
  hkaerial: hkaerialScriptSource,
  hktank: hktankScriptSource,
}
const RUSH_BRAIN = Object.freeze({
  tick(self, sense, act) {
    const target = sense.player?.pos || sense.lastKnownPlayer?.pos
    if (target) {
      act.moveTo(target)
      act.face(target)
      act.aimAt(target)
    }
    if (self.type === 'scout' || self.type === 't1000') act.melee()
    else act.fire()
  },
})

export function performanceMultiplier(telemetry) {
  if (!telemetry) return 1
  const {healthLost, timeToClear, damagePerMinute} = telemetryPerformanceInputs(telemetry)
  const healthScore = clamp(1 - healthLost / 100, -1, 1) * 0.25
  const speedScore = clamp((120 - timeToClear) / 90, -1, 1) * 0.25
  const damageScore = clamp((180 - damagePerMinute) / 180, -1, 1) * 0.15
  return round(clamp(1 + healthScore + speedScore + damageScore, 0.8, 1.5), 3)
}

export function waveBudget(wave, telemetry = null) {
  const multiplier = performanceMultiplier(telemetry)
  const base = 300 + 120 * wave
  return {base, multiplier, applied: Math.round(base * multiplier)}
}

export function isBossWave(wave) {
  return wave === 5 || wave === 10
}

export function unlockedUnitTypes(wave) {
  const types = ['scout', 'endo']
  if (wave >= 2) types.push('heavy')
  if (wave >= 3) types.push('hkaerial')
  if (wave >= 4) types.push('t1000')
  if (isBossWave(wave)) types.push('hktank')
  return types
}

export function difficultyScaling(playerCount = 1, difficulty = 'normal') {
  const count = Math.max(1, Math.min(3, Math.floor(Number(playerCount) || 1)))
  const preset = getDifficulty(difficulty)
  const scaling = structuredClone(COOP_SCALING[count])
  scaling.budgetMultiplier = round(scaling.budgetMultiplier * preset.budgetMultiplier, 4)
  scaling.unitHealthMultiplier = round(scaling.unitHealthMultiplier * preset.unitHealthMultiplier, 4)
  // Older snapshots have no difficulty field and remain Normal.
  if (preset.id !== 'normal') scaling.difficulty = preset.id
  return scaling
}

export function scaledWaveBudget(wave, telemetry = null, playerCount = 1, difficulty = 'normal') {
  const budget = waveBudget(wave, telemetry)
  const scaling = difficultyScaling(playerCount, difficulty)
  return {...budget, applied: Math.round(budget.applied * scaling.budgetMultiplier), scaling}
}

export function mapKnobCost(knobs = {}) {
  const doors = isRecord(knobs.doors) ? Object.keys(knobs.doors).length : 0
  const lights = isRecord(knobs.lights) ? Object.keys(knobs.lights).length : 0
  const hazards = Array.isArray(knobs.hazards) ? knobs.hazards.length : 0
  return doors * 30
    + lights * 40
    + clamp(finite(knobs.fog, 0), 0, 3) * 20
    + hazards * 60
    + (knobs.break_flank_wall === true ? 150 : 0)
}

export function configCost(config, catalog = unitsData) {
  const groups = Array.isArray(config?.spawns) ? config.spawns : []
  const unitCost = groups.reduce((sum, group) => {
    const unit = catalog.types[group?.unit]
    const count = Number.isInteger(group?.count) && group.count > 0 ? group.count : 0
    return sum + (unit ? unit.cost * count : 0)
  }, 0)
  return unitCost + mapKnobCost(isRecord(config?.knobs) ? config.knobs : {})
}

export function validateWaveConfig(config, {wave = 1, budget, map = mapData, catalog = unitsData} = {}) {
  const appliedBudget = budget ?? waveBudget(wave).applied
  const errors = []
  const spawns = Array.isArray(config?.spawns) ? config.spawns : []
  const knobs = isRecord(config?.knobs) ? config.knobs : {}
  const knownGates = new Set(map.spawnGates.map(({id}) => id))
  const knownDoors = new Set(map.doors.map(({id}) => id))
  const knownLights = new Set(map.lightZones.map(({id}) => id))
  const knownHazards = new Map(map.hazardSlots.map((slot) => [slot.id, new Set(slot.types)]))
  const unlocked = new Set(unlockedUnitTypes(wave))
  const countByType = Object.fromEntries(Object.keys(catalog.types).map((id) => [id, 0]))

  if (!Array.isArray(config?.spawns)) errors.push(error('spawns', 'INVALID_SPAWNS', 'spawns must be an array'))
  if (!isRecord(config?.knobs)) errors.push(error('knobs', 'INVALID_KNOBS', 'knobs must be an object'))
  if (knobs.gates != null && !Array.isArray(knobs.gates)) errors.push(error('knobs.gates', 'INVALID_GATES', 'gates must be an array'))
  if (knobs.doors != null && !isRecord(knobs.doors)) errors.push(error('knobs.doors', 'INVALID_DOORS', 'doors must be an object'))
  if (knobs.lights != null && !isRecord(knobs.lights)) errors.push(error('knobs.lights', 'INVALID_LIGHTS', 'lights must be an object'))
  if (knobs.hazards != null && !Array.isArray(knobs.hazards)) errors.push(error('knobs.hazards', 'INVALID_HAZARDS', 'hazards must be an array'))
  if (knobs.break_flank_wall != null && typeof knobs.break_flank_wall !== 'boolean') {
    errors.push(error('knobs.break_flank_wall', 'INVALID_FLANK_WALL', 'break_flank_wall must be a boolean'))
  }

  const spawnGates = spawns.map((group) => group?.gate).filter(Boolean)
  const gatesAreExplicit = Array.isArray(knobs.gates)
  const requestedGates = gatesAreExplicit ? knobs.gates : spawnGates
  const activeGates = [...new Set(requestedGates)]
  if (activeGates.length > 3) errors.push(error('knobs.gates', 'TOO_MANY_GATES', 'at most three spawn gates may be active'))
  activeGates.forEach((id, index) => {
    if (!knownGates.has(id)) errors.push(error(`knobs.gates.${index}`, 'UNKNOWN_GATE', `unknown spawn gate: ${id}`))
  })

  for (const [id, state] of Object.entries(isRecord(knobs.doors) ? knobs.doors : {})) {
    if (!knownDoors.has(id)) errors.push(error(`knobs.doors.${id}`, 'UNKNOWN_DOOR', `unknown door: ${id}`))
    if (!['locked', 'unlocked'].includes(state)) errors.push(error(`knobs.doors.${id}`, 'INVALID_DOOR_STATE', `invalid door state for ${id}: ${state}`))
  }
  for (const [id, state] of Object.entries(isRecord(knobs.lights) ? knobs.lights : {})) {
    if (!knownLights.has(id)) errors.push(error(`knobs.lights.${id}`, 'UNKNOWN_LIGHT', `unknown light zone: ${id}`))
    if (!['on', 'off'].includes(state)) errors.push(error(`knobs.lights.${id}`, 'INVALID_LIGHT_STATE', `invalid light state for ${id}: ${state}`))
  }
  if (!Number.isInteger(knobs.fog ?? 0) || (knobs.fog ?? 0) < 0 || (knobs.fog ?? 0) > 3) {
    errors.push(error('knobs.fog', 'INVALID_FOG', 'fog must be an integer from 0 to 3'))
  }
  for (const [index, hazard] of (Array.isArray(knobs.hazards) ? knobs.hazards : []).entries()) {
    if (!isRecord(hazard)) {
      errors.push(error(`knobs.hazards.${index}`, 'INVALID_HAZARD', 'hazard must be an object'))
      continue
    }
    const types = knownHazards.get(hazard.slot)
    if (!types) errors.push(error(`knobs.hazards.${index}.slot`, 'UNKNOWN_HAZARD_SLOT', `unknown hazard slot: ${hazard.slot}`))
    else if (!types.has(hazard.kind)) errors.push(error(`knobs.hazards.${index}.kind`, 'UNKNOWN_HAZARD_KIND', `unknown hazard kind for ${hazard.slot}: ${hazard.kind}`))
  }

  const spendByType = Object.fromEntries(Object.keys(catalog.types).map((id) => [id, 0]))
  for (const [index, group] of spawns.entries()) {
    if (!isRecord(group)) {
      errors.push(error(`spawns.${index}`, 'INVALID_SPAWN_GROUP', 'spawn group must be an object'))
      continue
    }
    if (!Number.isFinite(group.t) || group.t < 0) errors.push(error(`spawns.${index}.t`, 'INVALID_SPAWN_TIME', 'spawn time must be zero or greater'))
    if (!knownGates.has(group.gate)) errors.push(error(`spawns.${index}.gate`, 'UNKNOWN_GATE', `unknown spawn gate: ${group.gate}`))
    if (gatesAreExplicit && knownGates.has(group.gate) && !activeGates.includes(group.gate)) {
      errors.push(error(`spawns.${index}.gate`, 'INACTIVE_GATE', `spawn gate is not active: ${group.gate}`))
    }
    const unit = catalog.types[group.unit]
    if (!unit) errors.push(error(`spawns.${index}.unit`, 'UNKNOWN_UNIT', `unknown unit type: ${group.unit}`))
    else if (!unlocked.has(group.unit)) errors.push(error(`spawns.${index}.unit`, 'UNIT_LOCKED', `${group.unit} is not available on wave ${wave}`))
    if (!Number.isInteger(group.count) || group.count < 1) errors.push(error(`spawns.${index}.count`, 'INVALID_COUNT', 'spawn count must be a positive integer'))
    if (unit && Number.isInteger(group.count) && group.count > 0) {
      countByType[group.unit] += group.count
      spendByType[group.unit] += unit.cost * group.count
      if (group.unit === 'hktank') {
        const gate = map.spawnGates.find(({id}) => id === group.gate)
        const minimumWidth = unit.radius * 2 + 1
        if (!gate?.boss || !Number.isFinite(gate.width) || gate.width < minimumWidth) {
          errors.push(error(`spawns.${index}.gate`, 'BOSS_GATE_TOO_NARROW', `hktank requires a boss gate at least ${minimumWidth} meters wide`))
        }
      }
    }
  }

  for (const [id, spend] of Object.entries(spendByType)) {
    const oneLargeUnit = countByType[id] === 1 && spend === catalog.types[id]?.cost && spend <= appliedBudget
    if (spend > appliedBudget * 0.4 + 1e-9 && !oneLargeUnit) {
      errors.push(error('spawns', 'UNIT_BUDGET_CAP', `${id} exceeds 40 percent of the wave budget`))
    }
  }
  const bossCount = countByType.hktank || 0
  if (isBossWave(wave) && bossCount !== 1) errors.push(error('spawns', 'BOSS_REQUIRED', `wave ${wave} requires exactly one hktank`))
  if (!isBossWave(wave) && bossCount > 0) errors.push(error('spawns', 'BOSS_NOT_SCHEDULED', 'hktank spawns only on waves 5 and 10'))
  const usedTypes = Object.entries(countByType).filter(([id, count]) => id !== 'hktank' && count > 0).length
  if (usedTypes === 0) errors.push(error('spawns', 'NO_UNITS', 'a wave requires at least one unit'))
  else if (wave >= 3 && usedTypes < 2) errors.push(error('spawns', 'TOO_FEW_UNIT_TYPES', 'waves three and later require at least two unit types'))
  const cost = configCost({spawns, knobs}, catalog)
  if (cost > appliedBudget) errors.push(error('', 'OVER_BUDGET', `config costs ${cost}, budget is ${appliedBudget}`))
  return {ok: errors.length === 0, errors, cost, budget: appliedBudget}
}

export class WaveDirector {
  constructor(world, {
    builtin,
    difficulty = 'normal',
    intermissionSeconds = INTERMISSION_SECONDS,
    maxWaves = MAX_WAVES,
    now = () => Date.now(),
    eventBus = new EventBus(),
  } = {}) {
    this.world = world
    this.difficulty = getDifficulty(difficulty).id
    this.builtin = builtin
    this.intermissionSeconds = intermissionSeconds
    this.maxWaves = maxWaves
    this.now = now
    this.events = eventBus
    this.phase = 'lobby'
    this.wave = 0
    this.config = null
    this.spawnSchedule = []
    this.nextSpawn = 0
    this.intermissionTicksLeft = 0
    this.submissionDeadlineMs = null
    this.pendingSubmission = null
    this.lastValidConfig = null
    this.lastSubmissionIssue = null
    this.lastTelemetry = null
    this.telemetryByWave = new Map()
    this.replays = new Map()
    this.pendingPurchases = []
    this.replayStartIndex = world.replay.length
    this.rushActive = false
    this.sandboxMode = world.sandboxEnabled?.() === true
    this.sandboxPaused = this.sandboxMode
    this.worldEventCursor = world.eventLog.length
    this.damageEventTimes = []
    this.lastPlayerPosTick = -1
    this.world.phase = 'lobby'
    this.world.wave = 0
    this.events.emit({type: 'phase', wave: 0, t: 0, phase: 'lobby'})
  }

  on(type, listener) {
    return this.events.on(type, listener)
  }

  setDifficulty(id) {
    if (this.phase !== 'lobby' || !Object.hasOwn(DIFFICULTIES, id)) return false
    if (this.difficulty !== id) {
      this.difficulty = id
      this.pendingSubmission = null
      this.lastValidConfig = null
      this.world.scaling = difficultyScaling(this.world.players.size, id)
    }
    return true
  }

  getState() {
    const nextWave = Math.min(this.wave + 1, this.maxWaves)
    const budget = this.phase === 'ended' ? null : scaledWaveBudget(nextWave, this.lastTelemetry, this.world.players.size, this.difficulty)
    return {
      phase: this.phase,
      difficulty: this.difficulty,
      wave: this.wave,
      budget: budget?.applied ?? null,
      multiplier: budget?.multiplier ?? this.world.performanceMultiplier,
      scaling: structuredClone(budget?.scaling || this.world.scaling),
      deadline_ms: this.submissionDeadlineMs,
      applied_config: this.config ? structuredClone(this.config) : null,
      script_revs: structuredClone(this.world.skynet.revs),
      fallback_count: this.world.skynet.fallbackCount,
      ...(this.sandboxMode ? {sandbox: true, paused: this.sandboxPaused} : {}),
    }
  }

  setSandbox(enabled = true) {
    this.sandboxMode = Boolean(enabled)
    this.sandboxPaused = this.sandboxMode
    return this.sandboxMode
  }

  startWaves() {
    if (!this.sandboxMode) return {ok: false, error: 'Sandbox mode is not active'}
    if (this.phase === 'lobby') {
      const result = this.start()
      if (!result?.ok) return result || {ok: false, error: 'Waves could not start'}
      this.sandboxPaused = false
      return result
    }
    this.sandboxPaused = false
    return {ok: true}
  }

  pauseWaves() {
    if (!this.sandboxMode) return false
    this.sandboxPaused = true
    return true
  }

  submitConfig(submission, {atMs = this.now()} = {}) {
    const targetWave = this.wave + 1
    const errors = []
    if (this.phase !== 'lobby' && this.phase !== 'intermission') {
      errors.push(error('wave', 'NOT_ACCEPTING_SUBMISSIONS', 'wave configs are accepted only in the lobby or intermission'))
    }
    if (submission?.wave != null && submission.wave !== targetWave) {
      errors.push(error('wave', 'WRONG_WAVE', `expected wave ${targetWave}, got ${submission.wave}`))
    }
    if (this.submissionDeadlineMs != null && atMs > this.submissionDeadlineMs) {
      errors.push(error('wave', 'DEADLINE_MISSED', `submission deadline was ${this.submissionDeadlineMs}`))
    }
    const config = configWithoutWave(submission)
    const budget = scaledWaveBudget(targetWave, this.lastTelemetry, this.world.players.size, this.difficulty).applied
    const validation = validateWaveConfig(config, {wave: targetWave, budget, map: this.world.map, catalog: this.world.unitCatalog})
    errors.push(...validation.errors)
    if (errors.length > 0) {
      this.pendingSubmission = null
      this.lastSubmissionIssue = errors.some(({code}) => code === 'DEADLINE_MISSED') ? 'late_submission' : 'invalid_submission'
      return {ok: false, errors, cost: validation.cost, budget}
    }
    const normalized = normalizeConfig(config)
    this.pendingSubmission = {wave: targetWave, config: normalized}
    this.lastValidConfig = structuredClone(normalized)
    this.lastSubmissionIssue = null
    return {ok: true, errors: [], cost: validation.cost, budget}
  }

  start(config = null) {
    if (this.phase !== 'lobby') return false
    return this.beginWave(config)
  }

  ready(wave = this.wave) {
    if (this.phase !== 'intermission') return {ok: false, error: 'not in intermission'}
    if (wave !== this.wave) return {ok: false, error: `expected wave ${this.wave}`}
    const result = this.beginWave()
    return result?.ok ? {ok: true} : result
  }

  returnToLobby() {
    if (this.phase !== 'ended') return {ok: false, error: 'match is not over'}
    for (const unit of this.world.units) unit.brain?.destroy?.()
    this.world.units.length = 0
    this.world.unitById.clear()
    this.world.projectiles.length = 0
    this.world.sounds.length = 0
    this.world.messages.length = 0
    this.world.replay.length = 0
    this.world.eventLog.length = 0
    this.world.snapshotEventCursor = 0
    this.world.nextUnitId = 1
    this.world.rng.state = this.world.seed >>> 0 || 1
    this.world.lastBrainTickCount = 0
    this.world.wave = 0
    this.world.waveStartedAtTick = this.world.tick
    this.world.phaseTicksLeft = 0
    this.world.waveBudget = 0
    this.world.performanceMultiplier = 1
    this.world.scaling = difficultyScaling(this.world.players.size, this.difficulty)
    this.world.mapState = {
      doors: Object.fromEntries(this.world.map.doors.map((door) => [door.id, door.default])),
      lights: Object.fromEntries(this.world.map.lightZones.map((zone) => [zone.id, zone.default])),
      fog: 0,
      hazards: [],
      flankWallBroken: Boolean(this.world.map.flankWall.broken),
      gates: [],
    }
    this.world.nav.rebuild(this.world.dynamicColliders())
    for (const [id, player] of this.world.players) {
      const connected = player.connected !== false
      Object.assign(player, this.world.createPlayer({id, name: player.name}), {connected})
    }
    this.world.previousInputsByPlayer = new Map([...this.world.players.keys()].map((id) => [id, structuredClone(EMPTY_INPUTS)]))
    this.world.lastInputsBundle = {}
    this.world.telemetry = this.world.createTelemetry()
    this.phase = 'lobby'
    this.wave = 0
    this.config = null
    this.spawnSchedule = []
    this.nextSpawn = 0
    this.intermissionTicksLeft = 0
    this.submissionDeadlineMs = null
    this.pendingSubmission = null
    this.lastValidConfig = null
    this.lastSubmissionIssue = null
    this.lastTelemetry = null
    this.telemetryByWave.clear()
    this.replays.clear()
    this.pendingPurchases.length = 0
    this.replayStartIndex = 0
    this.rushActive = false
    this.damageEventTimes.length = 0
    this.lastPlayerPosTick = -1
    this.worldEventCursor = 0
    this.world.skynet.fallbackCount = 0
    this.events.clear()
    this.world.phase = 'lobby'
    this._recordWorldEvent('phase', {wave: 0, phase: 'lobby'})
    return {ok: true}
  }

  beginWave(directConfig = null) {
    this._flushWorldEvents()
    const wave = this.wave + 1
    if (wave > this.maxWaves) {
      this.setPhase('ended')
      return false
    }
    const budgetInfo = scaledWaveBudget(wave, this.lastTelemetry, this.world.players.size, this.difficulty)
    const selection = this.selectConfig(wave, budgetInfo.applied, directConfig)
    if (!selection.ok) return selection

    this.wave = wave
    this.config = structuredClone(selection.config)
    this.spawnSchedule = expandSpawnGroups(this.config.spawns)
    this.nextSpawn = 0
    this.rushActive = false
    this.damageEventTimes = []
    this.pendingSubmission = null
    this.submissionDeadlineMs = null
    this.world.wave = wave
    this.world.bossPhase = isBossWave(wave)
    this.world.phase = 'wave'
    this.world.waveBudget = budgetInfo.applied
    this.world.performanceMultiplier = budgetInfo.multiplier
    this.world.scaling = structuredClone(budgetInfo.scaling)
    this.world.projectiles.length = 0
    this.world.respawnDeadPlayers()
    this.resetWaveMap()
    this.world.configureMap(this.config.knobs)
    this.world.resetWaveTelemetry({budget: budgetInfo.applied, knobs: this.config.knobs})
    for (const purchase of this.pendingPurchases) {
      const carried = {...purchase, t: 0}
      this.world.telemetry.purchases.push(carried)
      if (purchase.playerId && this.world.players.has(purchase.playerId)) {
        this.world.playerTelemetry(purchase.playerId).purchases.push(structuredClone(carried))
      }
    }
    this.pendingPurchases.length = 0
    this.world.telemetry.performanceMultiplier = budgetInfo.multiplier
    this.world.telemetry.scaling = structuredClone(budgetInfo.scaling)
    this.world.telemetry.boss = this.world.bossPhase
    this.world.telemetry.finale = wave === MAX_WAVES
    this.replayStartIndex = this.world.replay.length
    this.setPhase('wave')
    this._recordWorldEvent('config_applied', {
      fallback: selection.fallback,
      reason: selection.reason,
      source: selection.source,
      budget: budgetInfo.applied,
      multiplier: budgetInfo.multiplier,
      scaling: budgetInfo.scaling,
    })
    return {
      ok: true,
      errors: [],
      cost: configCost(this.config, this.world.unitCatalog),
      budget: budgetInfo.applied,
      fallback: selection.fallback,
      reason: selection.reason,
      scaling: structuredClone(budgetInfo.scaling),
    }
  }

  selectConfig(wave, budget, directConfig) {
    let config = directConfig ? configWithoutWave(directConfig) : null
    let fallback = false
    let reason = null
    let source = directConfig ? 'direct' : 'submission'

    if (!config && this.pendingSubmission?.wave === wave) config = this.pendingSubmission.config
    if (config) {
      const result = validateWaveConfig(config, {wave, budget, map: this.world.map, catalog: this.world.unitCatalog})
      if (result.ok) {
        const normalized = normalizeConfig(config)
        this.lastValidConfig = structuredClone(normalized)
        return {ok: true, config: normalized, fallback, reason, source}
      }
      fallback = true
      reason = 'invalid_submission'
    } else {
      fallback = true
      reason = this.lastSubmissionIssue || 'missing_submission'
    }

    this.world.skynet.fallbackCount += 1
    source = 'last_valid_config'
    config = this.lastValidConfig
    if (!validateWaveConfig(config, {wave, budget, map: this.world.map, catalog: this.world.unitCatalog}).ok) {
      source = 'built_in'
      config = this.builtin?.plan({
        wave,
        budget,
        multiplier: waveBudget(wave, this.lastTelemetry).multiplier,
        telemetry: this.lastTelemetry,
        scaling: difficultyScaling(this.world.players.size, this.difficulty),
      })
    }
    if (!validateWaveConfig(config, {wave, budget, map: this.world.map, catalog: this.world.unitCatalog}).ok) {
      source = 'emergency'
      config = emergencyWaveConfig(wave, budget, this.world.map, this.world.unitCatalog)
    }
    const validation = validateWaveConfig(config, {wave, budget, map: this.world.map, catalog: this.world.unitCatalog})
    if (!validation.ok) return validation
    return {ok: true, config: normalizeConfig(config), fallback, reason, source}
  }

  step(inputs = {}) {
    if (this.sandboxMode && this.sandboxPaused) {
      const tick = this.world.tick
      this.world.step(inputs)
      if (this.phase === 'wave') this.world.waveStartedAtTick += this.world.tick - tick
      this._flushWorldEvents()
      this.emitPlayerPosition()
      return
    }
    if (this.phase === 'wave') {
      this.spawnDueUnits()
      if (this.world.waveTime() >= WAVE_TIME_CAP_SECONDS) this.forceRush()
      this.world.step(inputs)
      this._flushWorldEvents()
      this.emitPlayerPosition()
      if (this.world.livingPlayers.length === 0) this.finishWave({playerDied: true, endReason: 'player_dead'})
      else if (this.nextSpawn >= this.spawnSchedule.length && this.world.aliveUnits.length === 0) this.finishWave()
      return
    }
    if (this.phase === 'intermission') {
      this.world.step(inputs)
      this._flushWorldEvents()
      this.emitPlayerPosition()
      this.intermissionTicksLeft = Math.max(0, this.intermissionTicksLeft - 1)
      this.world.phaseTicksLeft = this.intermissionTicksLeft
      if (this.world.lastInputsBundle[this.world.hostPlayerId]?.ready || this.intermissionTicksLeft === 0) this.beginWave()
    }
  }

  recordPurchase(item, price) {
    const purchase = {t: this.world.waveTime(), item: String(item), price: Number(price) || 0}
    this.world.telemetry.purchases.push(purchase)
    this._recordWorldEvent('purchase', purchase)
    return purchase
  }

  spawnDueUnits() {
    while (this.nextSpawn < this.spawnSchedule.length && this.world.aliveUnits.length < this.world.maxAlive) {
      const entry = this.spawnSchedule[this.nextSpawn]
      if (entry.t > this.world.waveTime() + 1e-6) break
      const gate = this.world.map.spawnGates.find(({id}) => id === entry.gate)
      if (!gate) break
      const offset = entry.unit === 'hktank' ? 0 : ((entry.index % 3) - 1) * 0.55
      const unit = this.world.spawnUnit(entry.unit, {x: gate.pos.x + offset, y: gate.pos.y, z: gate.pos.z + offset}, {
        yaw: gate.yaw,
        rev: this.world.skynet.revs[entry.unit] || 1,
      })
      if (unit && this.rushActive) unit.brain = RUSH_BRAIN
      this.nextSpawn += 1
    }
    this._flushWorldEvents()
  }

  forceRush() {
    if (!this.rushActive) {
      this.rushActive = true
      for (let index = this.nextSpawn; index < this.spawnSchedule.length; index += 1) {
        this.spawnSchedule[index].t = Math.min(this.spawnSchedule[index].t, WAVE_TIME_CAP_SECONDS)
      }
    }
    for (const unit of this.world.aliveUnits) {
      const target = this.world.nearestLivingPlayer(unit.pos)
      if (!target) continue
      if (unit.brain !== RUSH_BRAIN) unit.brain?.destroy?.()
      unit.brain = RUSH_BRAIN
      unit.targetPlayerId = target.id
      unit.intent.moveTo = copyVec(target.pos)
      unit.intent.face = copyVec(target.pos)
      unit.intent.aimAt = copyVec(target.pos)
      unit.intent.fire = unit.type !== 'scout' && unit.type !== 't1000'
      unit.intent.melee = unit.type === 'scout' || unit.type === 't1000'
      unit.reactionReadyTick = this.world.tick
    }
  }

  finishWave({playerDied = false, endReason = 'cleared'} = {}) {
    const elapsed = this.world.waveTime()
    const timeToClear = playerDied ? null : elapsed
    for (const unit of this.world.units) {
      if (this.world.telemetry.units[unit.id]) this.world.telemetry.units[unit.id].rev = unit.rev
    }
    this.world.telemetry.durationSeconds = elapsed
    finalizeWaveTelemetry(this.world.telemetry, {
      ...(timeToClear == null ? {} : {timeToClear}),
      multiplier: this.world.performanceMultiplier,
    })
    this.world.syncTelemetryPlayers()
    this.lastTelemetry = structuredClone(this.world.telemetry)
    const summary = buildWaveSummary(this.lastTelemetry, {
      wave: this.wave,
      boss: isBossWave(this.wave),
      finale: this.wave === MAX_WAVES,
      playerDied,
      endReason,
      multiplier: this.world.performanceMultiplier,
      scaling: this.world.scaling,
    })
    this.telemetryByWave.set(this.wave, structuredClone(summary))
    this.replays.set(this.wave, this.world.replay.slice(this.replayStartIndex).map((input) => structuredClone(input)))
    this._recordWorldEvent('wave_summary', summary)
    if (playerDied || this.wave >= this.maxWaves) {
      this.setPhase('ended')
      return summary
    }
    for (const player of this.world.livingPlayers) {
      player.hp = 100
      if (this.world.sandbox?.infiniteScrap && player.id === this.world.hostPlayerId) player.scrap = 999999
      else player.scrap += WAVE_CLEAR_SCRAP
    }
    this.intermissionTicksLeft = Math.round(this.intermissionSeconds * 60)
    this.world.phaseTicksLeft = this.intermissionTicksLeft
    this.submissionDeadlineMs = Math.round(this.now() + this.intermissionSeconds * 1000)
    this.setPhase('intermission')
    return summary
  }

  setPhase(phase) {
    if (this.phase === phase && this.world.phase === phase) return
    this.phase = phase
    this.world.phase = phase
    const data = {phase, wave: this.wave}
    if (phase === 'intermission') data.deadline_ms = this.submissionDeadlineMs
    this._recordWorldEvent('phase', data)
  }

  resetWaveMap() {
    this.world.mapState.gates = []
    this.world.mapState.doors = Object.fromEntries(this.world.map.doors.map((door) => [door.id, door.default]))
    this.world.mapState.lights = Object.fromEntries(this.world.map.lightZones.map((zone) => [zone.id, zone.default]))
    this.world.mapState.fog = 0
    this.world.mapState.hazards = []
  }

  emitPlayerPosition() {
    if (this.world.tick === this.lastPlayerPosTick || this.world.tick % 60 !== 0) return
    this.lastPlayerPosTick = this.world.tick
    for (const player of this.world.players.values()) {
      this._emitProtocol('player_pos', {
        player_id: player.id,
        name: player.name,
        pos: copyVec(player.pos),
        yaw: player.yaw,
        hp: player.hp,
        armor: player.armor,
        weapon: player.activeWeapon,
        alive: player.alive,
        downed: player.downed,
      })
    }
  }

  _recordWorldEvent(type, data) {
    this.world.emit(type, data)
    this._flushWorldEvents()
  }

  _flushWorldEvents() {
    while (this.worldEventCursor < this.world.eventLog.length) {
      this._forwardWorldEvent(this.world.eventLog[this.worldEventCursor])
      this.worldEventCursor += 1
    }
  }

  _forwardWorldEvent(event) {
    if (event.type === 'phase') return void this._emitProtocol('phase', {
      phase: event.phase,
      wave: event.wave,
      ...(event.deadline_ms == null ? {} : {deadline_ms: event.deadline_ms}),
    }, event)
    if (event.type === 'wave_summary') {
      const {type, tick, t, ...summary} = event
      return void this._emitProtocol('wave_summary', summary, event)
    }
    if (event.type === 'player_damage') {
      const t = this._eventWaveTime(event)
      this.damageEventTimes = this.damageEventTimes.filter((seen) => t - seen < 1)
      if (this.damageEventTimes.length >= 5) return
      this.damageEventTimes.push(t)
      return void this._emitProtocol('damage', {
        amount: event.amount,
        unit_type: event.unitType,
        unit_id: event.unitId,
        player_id: event.playerId,
        player_facing_attacker: event.playerFacingAttacker,
      }, event)
    }
    if (event.type === 'kill') return void this._emitProtocol('kill', {
      unit_type: event.unitType,
      unit_id: event.unitId,
      weapon: event.weapon,
      distance: event.distance,
      headshot: event.headshot,
      part: event.part,
      pos: event.pos,
      direction: event.direction,
      player_id: event.playerId,
    }, event)
    if (event.type === 'unit_damage') return void this._emitProtocol('unit_damage', {
      unit_id: event.unitId,
      unit_type: event.unitType,
      part: event.part,
      amount: event.amount,
      weapon: event.weapon,
      headshot: event.headshot,
      pos: event.pos,
      normal: event.normal,
      direction: event.direction,
      player_id: event.playerId ?? null,
    }, event)
    if (event.type === 'unit_spawn') return void this._emitProtocol('unit_spawn', {
      unit_id: event.unitId, unit_type: event.unitType, rev: event.rev,
    }, event)
    if (event.type === 'unit_death') return void this._emitProtocol('unit_death', {
      unit_id: event.unitId, unit_type: event.unitType, rev: event.rev, cause: event.cause,
    }, event)
    if (event.type === 'script_error' || event.type === 'fuel_exhausted' || event.type === 'fuelExhausted') {
      const type = event.type === 'fuelExhausted' ? 'fuel_exhausted' : event.type
      return void this._emitProtocol(type, {
      unit_id: event.unitId, unit_type: event.unitType, rev: event.rev, ...(event.message ? {message: event.message} : {}),
    }, event)
    }
    if (event.type === 'purchase') {
      if (this.phase === 'intermission') this.pendingPurchases.push({item: event.item, price: event.price, playerId: event.playerId})
      return void this._emitProtocol('purchase', {item: event.item, price: event.price, player_id: event.playerId}, event)
    }
    if (event.type === 'config_applied') return void this._emitProtocol('config_applied', {
      wave: event.wave,
      fallback: event.fallback,
      ...(event.reason ? {reason: event.reason} : {}),
      ...(event.source ? {source: event.source} : {}),
    }, event)
  }

  _emitProtocol(type, data, sourceEvent = null) {
    return this.events.emit({
      type,
      wave: data.wave ?? this.wave,
      t: sourceEvent ? this._eventWaveTime(sourceEvent) : this.world.waveTime(),
      ...structuredClone(data),
    })
  }

  _eventWaveTime(event) {
    return round(Math.max(0, (event.tick - this.world.waveStartedAtTick) / 60), 4)
  }
}

export function expandSpawnGroups(groups = []) {
  return groups.flatMap((group) => Array.from({length: group.count}, (_, index) => ({
    t: group.t + index * 0.5,
    gate: group.gate,
    unit: group.unit,
    index,
  }))).sort((a, b) => a.t - b.t || Number(b.unit === 'hktank') - Number(a.unit === 'hktank') || a.gate.localeCompare(b.gate) || a.unit.localeCompare(b.unit))
}

export function nearestGates(map, pos, count = 3) {
  return [...map.spawnGates]
    .sort((a, b) => planarDistance(a.pos, pos) - planarDistance(b.pos, pos) || a.id.localeCompare(b.id))
    .slice(0, count)
    .map(({id}) => id)
}

export function buildRulesPayload({
  map = mapData,
  catalog = unitsData,
  defaultBrains = DEFAULT_BRAINS,
  defaultScripts = DEFAULT_SCRIPT_SOURCES,
  playerCount = 1,
  difficulty = 'normal',
} = {}) {
  return {
    unit_catalog: structuredClone(catalog),
    map_knobs: {
      costs: {gate: 0, door: 30, light: 40, fog_level: 20, hazard: 60, break_flank_wall: 150},
      max_active_gates: 3,
      gates: map.spawnGates.map(({id}) => id),
      doors: map.doors.map(({id}) => id),
      light_zones: map.lightZones.map(({id}) => id),
      fog: {min: 0, max: 3},
      hazard_slots: map.hazardSlots.map(({id, types}) => ({id, kinds: [...types]})),
      flank_wall: {id: map.flankWall.id, one_time: true},
    },
    budget_formula: structuredClone(PERFORMANCE_FORMULA),
    roster_by_wave: Object.fromEntries(Array.from({length: MAX_WAVES}, (_, index) => [index + 1, unlockedUnitTypes(index + 1)])),
    boss_waves: [5, 10],
    scaling: difficultyScaling(playerCount, difficulty),
    difficulty: getDifficulty(difficulty).id,
    difficulties: Object.values(DIFFICULTIES).map((entry) => ({...entry})),
    difficulty_scaling: Object.values(COOP_SCALING).map((entry) => structuredClone(entry)),
    script_api_version: SCRIPT_API_VERSION,
    default_scripts: Object.fromEntries(Object.keys(catalog.types).map((type) => [
      type,
      defaultScripts[type] || defaultScriptSource(defaultBrains[type]),
    ])),
    map_summary: {
      id: map.id,
      name: map.name,
      bounds: structuredClone(map.bounds),
      gates: map.spawnGates.map(({id, pos}) => ({id, pos: copyVec(pos)})),
      doors: map.doors.map(({id, pos}) => ({id, pos: copyVec(pos)})),
      light_zones: map.lightZones.map(({id, pos}) => ({id, pos: copyVec(pos)})),
      hazard_slots: map.hazardSlots.map(({id, pos}) => ({id, pos: copyVec(pos)})),
    },
    simulator: {
      max_calls_per_intermission: MAX_SIMULATIONS_PER_INTERMISSION,
      max_wall_seconds: MAX_SIMULATION_WALL_SECONDS,
      max_speed: MAX_SIMULATION_SPEED,
    },
    caps: {
      simulate_calls_per_intermission: MAX_SIMULATIONS_PER_INTERMISSION,
      simulate_wall_seconds: MAX_SIMULATION_WALL_SECONDS,
    },
  }
}

function defaultScriptSource(brain) {
  const init = typeof brain.init === 'function' ? `export ${brain.init.toString()}\n\n` : ''
  return `${init}export ${brain.tick.toString()}\n`
}

function normalizeConfig(config) {
  const knobs = structuredClone(config.knobs || {})
  knobs.gates = Array.isArray(knobs.gates)
    ? [...new Set(knobs.gates)]
    : [...new Set(config.spawns.map(({gate}) => gate))]
  knobs.doors = {...(knobs.doors || {})}
  knobs.lights = {...(knobs.lights || {})}
  knobs.fog ??= 0
  knobs.hazards = (knobs.hazards || []).map((hazard) => ({...hazard}))
  knobs.break_flank_wall = Boolean(knobs.break_flank_wall)
  return {spawns: config.spawns.map((group) => ({...group})), knobs}
}

function configWithoutWave(config) {
  if (!isRecord(config)) return config
  const {wave, ...rest} = config
  return rest
}

function emergencyWaveConfig(wave, budget, map, catalog) {
  const gates = map.spawnGates.map(({id}) => id)
  const unlocked = new Set(unlockedUnitTypes(wave).filter((id) => id !== 'hktank'))
  const affordable = Object.values(catalog.types).sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))
    .filter((unit) => unlocked.has(unit.id) && unit.cost > 0 && unit.cost <= budget)
  const required = wave >= 3 ? 2 : 1
  if (affordable.length < required) return {spawns: [], knobs: {gates: [], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false}}
  const selected = affordable.slice(0, required)
  const spawns = selected.map((unit, index) => ({t: index, gate: gates[index % gates.length], unit: unit.id, count: 1}))
  if (isBossWave(wave)) {
    const bossGate = map.spawnGates.find((gate) => gate.boss)
    if (bossGate) spawns.unshift({t: 0, gate: bossGate.id, unit: 'hktank', count: 1})
  }
  return {
    spawns,
    knobs: {
      gates: [...new Set(spawns.map(({gate}) => gate))].slice(0, 3), doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false,
    },
  }
}

function error(path, code, message) {
  return {path, code, message}
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
