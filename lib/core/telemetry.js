import {round} from './math.js'

export const PATH_SAMPLE_HZ = 4
export const STATUS_SAMPLE_HZ = 1
export const HEATMAP_CELL_METERS = 2

export function telemetryPerformanceInputs(telemetry = {}) {
  const damageTaken = Array.isArray(telemetry.damageTaken)
    ? telemetry.damageTaken
    : Array.isArray(telemetry.damage_taken) ? telemetry.damage_taken : []
  const healthLost = finiteOr(
    telemetry.healthLost ?? telemetry.health_lost,
    damageTaken.reduce((sum, event) => sum + finiteOr(event.amount, 0), 0),
  )
  const rawClear = telemetry.timeToClear ?? telemetry.time_to_clear
  const timeToClear = finiteOr(rawClear, 120)
  const damagePerMinute = finiteOr(
    telemetry.damagePerMinute ?? telemetry.damage_per_minute,
    timeToClear > 0 ? healthLost * 60 / timeToClear : healthLost,
  )
  return {
    healthLost: round(Math.max(0, healthLost), 4),
    timeToClear: round(Math.max(0, timeToClear), 4),
    damagePerMinute: round(Math.max(0, damagePerMinute), 4),
  }
}

export function finalizeWaveTelemetry(telemetry, {timeToClear, multiplier = 1} = {}) {
  if (Number.isFinite(timeToClear)) telemetry.timeToClear = round(timeToClear, 4)
  const inputs = telemetryPerformanceInputs(telemetry)
  telemetry.healthLost = inputs.healthLost
  telemetry.damagePerMinute = inputs.damagePerMinute
  telemetry.performanceMultiplier = multiplier
  return telemetry
}

export function buildWaveSummary(telemetry, {
  wave,
  playerDied = false,
  endReason = playerDied ? 'player_dead' : 'cleared',
  multiplier = telemetry?.performanceMultiplier ?? 1,
  scaling = telemetry?.scaling ?? {players: 1, budgetMultiplier: 1, unitHealthMultiplier: 1, maxAlive: 24},
} = {}) {
  const source = telemetry || {}
  const inputs = telemetryPerformanceInputs(source)
  const shots = Object.fromEntries(Object.entries(source.shots || {})
    .filter(([weapon]) => !weapon.startsWith('unit:'))
    .map(([weapon, stats]) => {
      const fired = finiteOr(stats.fired ?? stats.shots_fired, 0)
      const hits = finiteOr(stats.hits, 0)
      return [weapon, {fired, hits, accuracy: fired > 0 ? round(hits / fired, 4) : 0}]
    }))
  const units = Object.fromEntries(Object.entries(source.units || {}).map(([id, stats]) => [id, {
    unit_type: stats.type ?? stats.unit_type,
    rev: stats.rev ?? 1,
    spawned_at: finiteOr(stats.spawnedAt ?? stats.spawned_at, 0),
    lifetime: finiteOr(stats.lifetime, 0),
    cause_of_death: stats.causeOfDeath ?? stats.cause_of_death ?? null,
    distance_traveled: round(finiteOr(stats.distanceTraveled ?? stats.distance_traveled, 0), 4),
    shots_fired: finiteOr(stats.shotsFired ?? stats.shots_fired, 0),
    damage_dealt: round(finiteOr(stats.damageDealt ?? stats.damage_dealt, 0), 4),
    script_errors: finiteOr(stats.scriptErrors ?? stats.script_errors, 0),
    fuel_exhausted: finiteOr(stats.fuelExhausted ?? stats.fuel_exhausted, 0),
  }]))

  return {
    wave: Number(wave) || 0,
    time_to_clear: source.timeToClear ?? source.time_to_clear ?? null,
    duration_seconds: finiteOr(source.durationSeconds ?? source.duration_seconds, source.timeToClear ?? source.time_to_clear ?? 0),
    player_died: Boolean(playerDied),
    end_reason: endReason,
    health_lost: inputs.healthLost,
    damage_per_minute: inputs.damagePerMinute,
    applied_budget: finiteOr(source.appliedBudget ?? source.applied_budget, 0),
    performance_multiplier: finiteOr(multiplier, 1),
    scaling: structuredClone(scaling),
    knobs: structuredClone(source.knobs || {}),
    player_path: (source.playerPath || source.player_path || []).map((point) => ({
      t: finiteOr(point.t, 0), x: finiteOr(point.x ?? point.pos?.x, 0),
      y: finiteOr(point.y ?? point.pos?.y, 0), z: finiteOr(point.z ?? point.pos?.z, 0),
    })),
    heatmap_cell_meters: HEATMAP_CELL_METERS,
    heatmap: structuredClone(source.heatmap || {}),
    damage_taken: (source.damageTaken || source.damage_taken || []).map((event) => ({
      t: finiteOr(event.t, 0),
      amount: finiteOr(event.amount, 0),
      unit_type: event.unitType ?? event.unit_type ?? 'hazard',
      unit_id: event.unitId ?? event.unit_id ?? null,
      attacker_pos: cloneNullable(event.attackerPos ?? event.attacker_pos),
      player_pos: cloneNullable(event.playerPos ?? event.player_pos),
      player_facing: finiteOr(event.playerFacing ?? event.player_facing, 0),
      player_facing_attacker: Boolean(event.playerFacingAttacker ?? event.player_facing_attacker),
      player_id: event.playerId ?? event.player_id ?? null,
    })),
    kills: (source.kills || []).map((kill) => ({
      t: finiteOr(kill.t, 0),
      unit_type: kill.unitType ?? kill.unit_type,
      unit_id: kill.unitId ?? kill.unit_id,
      weapon: kill.weapon,
      distance: finiteOr(kill.distance, 0),
      headshot: Boolean(kill.headshot),
      time_from_first_damage: finiteOr(kill.timeFromFirstDamage ?? kill.time_from_first_damage, 0),
      player_id: kill.playerId ?? kill.player_id ?? null,
    })),
    shots,
    reloads: (source.reloads || []).map((reload) => ({
      t: finiteOr(reload.t, 0),
      weapon: reload.weapon,
      magazine_fraction: finiteOr(reload.magazineFraction ?? reload.magazine_fraction, 0),
    })),
    health_armor: (source.healthArmor || source.health_armor || []).map((sample) => ({
      t: finiteOr(sample.t, 0), hp: finiteOr(sample.hp, 0), armor: finiteOr(sample.armor, 0),
    })),
    purchases: (source.purchases || []).map((purchase) => ({
      t: finiteOr(purchase.t, 0), item: purchase.item, price: finiteOr(purchase.price, 0),
      player_id: purchase.playerId ?? purchase.player_id ?? null,
    })),
    players: Object.values(source.players || {}).map((player) => buildPlayerSummary(player, source)),
    units,
    counters: structuredClone(source.counters || {}),
  }
}

function buildPlayerSummary(player, aggregate) {
  const duration = finiteOr(aggregate.durationSeconds ?? aggregate.duration_seconds, aggregate.timeToClear ?? aggregate.time_to_clear ?? 0)
  const inputs = telemetryPerformanceInputs({...player, timeToClear: duration})
  const shots = Object.fromEntries(Object.entries(player.shots || {})
    .filter(([weapon]) => !weapon.startsWith('unit:'))
    .map(([weapon, stats]) => {
      const fired = finiteOr(stats.fired ?? stats.shots_fired, 0)
      const hits = finiteOr(stats.hits, 0)
      return [weapon, {fired, hits, accuracy: fired > 0 ? round(hits / fired, 4) : 0}]
    }))
  return {
    id: player.id,
    name: player.name,
    hp: finiteOr(player.hp, 0),
    armor: finiteOr(player.armor, 0),
    scrap: finiteOr(player.scrap, 0),
    alive: Boolean(player.alive),
    downed: Boolean(player.downed),
    health_lost: inputs.healthLost,
    damage_per_minute: inputs.damagePerMinute,
    damage_dealt: round(finiteOr(player.damageDealt ?? player.damage_dealt, 0), 4),
    kills: (player.kills || []).map((kill) => ({
      t: finiteOr(kill.t, 0),
      unit_type: kill.unitType ?? kill.unit_type,
      unit_id: kill.unitId ?? kill.unit_id,
      weapon: kill.weapon,
      distance: finiteOr(kill.distance, 0),
      headshot: Boolean(kill.headshot),
      time_from_first_damage: finiteOr(kill.timeFromFirstDamage ?? kill.time_from_first_damage, 0),
    })),
    shots,
    damage_taken: structuredClone(player.damageTaken || player.damage_taken || []),
    reloads: structuredClone(player.reloads || []),
    purchases: structuredClone(player.purchases || []),
    player_path: structuredClone(player.playerPath || player.player_path || []),
    health_armor: structuredClone(player.healthArmor || player.health_armor || []),
    counters: structuredClone(player.counters || {}),
  }
}

function cloneNullable(value) {
  return value == null ? null : structuredClone(value)
}

function finiteOr(value, fallback) {
  return value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback
}
