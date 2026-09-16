import {defaultMap} from '../map.js'
import * as scoutBrain from '../brains/default-scout.js'
import * as endoBrain from '../brains/default-endo.js'
import * as heavyBrain from '../brains/default-heavy.js'
import * as t1000Brain from '../brains/default-t1000.js'
import * as hkaerialBrain from '../brains/default-hkaerial.js'
import * as hktankBrain from '../brains/default-hktank.js'
import {copyVec, planarDistance, round} from '../math.js'
import {expandSpawnGroups} from '../waves.js'
import {World} from '../world.js'
import {best, ghostFromWave, ghostInputAt, last, selectGhost} from './ghost.js'

export {best, ghostFromWave, ghostInputAt, last, selectGhost}

const DEFAULT_BRAINS = Object.freeze({
  scout: scoutBrain,
  endo: endoBrain,
  heavy: heavyBrain,
  t1000: t1000Brain,
  hkaerial: hkaerialBrain,
  hktank: hktankBrain,
})

export function simulate({
  mapData = defaultMap,
  waveConfig,
  scripts = {},
  ghost = null,
  seed = 1,
  maxSeconds = 240,
  brainFactory = null,
  maxWallSeconds = 10,
} = {}) {
  if (typeof ghost === 'string' || typeof ghost === 'number') {
    throw new TypeError('ghost selector must be resolved with selectGhost before simulate')
  }
  const brains = resolveBrains(scripts, brainFactory)
  const world = new World({
    map: mapData,
    ...(brains ? {brains} : {}),
    ...(brainFactory ? {} : {scriptSources: normalizeScriptSources(scripts)}),
    seed,
  })
  try {
    const config = normalizeSimulationConfig(waveConfig)
    const hostPlayer = world.getPlayer(world.hostPlayerId)
    const wave = Number(waveConfig?.wave) || 1
    world.wave = wave
    world.bossPhase = wave === 5 || wave === 10
    world.phase = 'wave'
    world.configureMap(config.knobs)
    world.resetWaveTelemetry({budget: Number(waveConfig?.applied_budget || 0), knobs: config.knobs})
    for (const [type, script] of Object.entries(scripts || {})) {
      if (world.skynet.revs[type] != null && Number.isInteger(script?.rev)) world.skynet.revs[type] = script.rev
    }
    prepareGhostWeapons(world, ghost)

    const schedule = expandSpawnGroups(config.spawns)
    const maxTicks = Math.max(0, Math.floor(Math.min(3600, Number(maxSeconds) || 0) * 60))
    const startedAt = performance.now()
    let nextSpawn = 0
    let cleared = false
    for (let tick = 0; tick < maxTicks; tick += 1) {
      while (nextSpawn < schedule.length && world.aliveUnits.length < world.maxAlive) {
        const entry = schedule[nextSpawn]
        if (entry.t > world.waveTime() + 1e-6) break
        const gate = mapData.spawnGates.find(({id}) => id === entry.gate)
        if (!gate) throw new Error(`Unknown spawn gate in simulation: ${entry.gate}`)
        const offset = entry.unit === 'hktank' ? 0 : ((entry.index % 3) - 1) * 0.55
        world.spawnUnit(entry.unit, {x: gate.pos.x + offset, y: gate.pos.y, z: gate.pos.z + offset}, {
          yaw: gate.yaw,
          rev: world.skynet.revs[entry.unit] || 1,
        })
        nextSpawn += 1
      }

      const recorded = ghostInputAt(ghost, tick)
      world.step({[hostPlayer.id]: {...recorded, fire: false}})
      if (recorded.fire) fireGhostAtNearestVisible(world, hostPlayer, ghost)
      if (!hostPlayer.alive) break
      if (nextSpawn >= schedule.length && world.aliveUnits.length === 0) {
        cleared = true
        break
      }
      if (tick % 60 === 0 && performance.now() - startedAt > maxWallSeconds * 1000) {
        throw new Error(`Simulation exceeded ${maxWallSeconds} second wall-time limit`)
      }
    }

    const elapsed = world.waveTime()
    const units = {}
    for (const type of Object.keys(world.unitCatalog.types)) {
      // Retired corpses are absent from world.units; telemetry retains every spawn.
      const stats = Object.values(world.telemetry.units).filter((unit) => unit.type === type)
      if (stats.length === 0) continue
      units[type] = {
        spawned: stats.length,
        killed: stats.filter((unit) => unit.causeOfDeath != null).length,
        damage_dealt: round(stats.reduce((sum, item) => sum + item.damageDealt, 0), 4),
        avg_lifetime: round(stats.reduce((sum, item) => sum + item.lifetime, 0) / stats.length, 4),
      }
    }
    const unitStats = Object.values(world.telemetry.units)
    return {
      time_to_clear: cleared ? elapsed : null,
      player_died: !hostPlayer.alive,
      damage_to_player: round(world.telemetry.damageTaken.reduce((sum, event) => sum + event.amount, 0), 4),
      units,
      script_errors: unitStats.reduce((sum, item) => sum + item.scriptErrors, 0),
      fuel_exhausted: unitStats.reduce((sum, item) => sum + item.fuelExhausted, 0),
      seed: world.seed,
    }
  } finally {
    world.destroy()
  }
}

function resolveBrains(scripts, brainFactory) {
  if (!brainFactory) return null
  if (typeof brainFactory.createBrains === 'function') {
    const result = brainFactory.createBrains({scripts, defaults: DEFAULT_BRAINS})
    if (isPromise(result)) throw new TypeError('brainFactory.createBrains must be synchronous')
    return {...DEFAULT_BRAINS, ...result}
  }
  const create = typeof brainFactory === 'function' ? brainFactory : brainFactory.createBrain?.bind(brainFactory)
  if (!create) throw new TypeError('brainFactory must be a function or expose createBrain/createBrains')
  return Object.fromEntries(Object.entries(DEFAULT_BRAINS).map(([unitType, fallback]) => {
    const script = scripts?.[unitType]
    const result = create({unitType, source: typeof script === 'string' ? script : script?.source, script, fallback})
    if (isPromise(result)) throw new TypeError('brainFactory must be synchronous')
    return [unitType, result || fallback]
  }))
}

function normalizeScriptSources(scripts) {
  return Object.fromEntries(Object.entries(scripts || {}).map(([unitType, script]) => [unitType,
    typeof script === 'string' ? script : {source: script.source, rev: script.rev || 1},
  ]))
}

function fireGhostAtNearestVisible(world, player, ghost) {
  const weaponId = player.activeWeapon
  const weapon = world.weaponCatalog.weapons[weaponId]
  const ammo = player.ammo[weaponId]
  if (!weapon || !ammo || player.fireCooldown > 0 || player.reloadTimer > 0 || ammo.mag <= 0) return false
  ammo.mag -= 1
  player.fireCooldown = 1 / weapon.rate
  const origin = {...player.pos, y: player.pos.y + (player.crouch ? 1.12 : 1.65)}
  const target = world.aliveUnits
    .filter((unit) => world.lineOfSight(origin, world.unitEye(unit)))
    .sort((a, b) => planarDistance(player.pos, a.pos) - planarDistance(player.pos, b.pos) || a.id.localeCompare(b.id))[0]
  const accuracy = Math.max(0, Math.min(1, Number(ghost?.accuracy?.[weaponId] || 0)))
  const hit = Boolean(target) && world.rng.next() < accuracy
  if (hit) {
    world.damageUnit(target.id, weapon.damage * (weapon.pellets || 1), {
      source: 'player',
      playerId: player.id,
      weapon: weaponId,
      distance: planarDistance(player.pos, target.pos),
      point: copyVec(target.pos),
    })
  }
  world.recordShot(weaponId, hit, player.id)
  world.addSound('gunshot', player.pos, undefined, player.id)
  world.emit('shot', {by: player.id, playerId: player.id, weapon: weaponId, hit, headshot: false, killed: Boolean(target && !target.alive), unitId: target?.id || null, origin})
  return true
}

function prepareGhostWeapons(world, ghost) {
  if (!ghost) return
  const player = world.getPlayer(world.hostPlayerId)
  for (const id of world.weaponCatalog.slots) {
    player.ammo[id].owned = true
    player.ammo[id].reserve = world.weaponCatalog.weapons[id].reserveMax
  }
}

function normalizeSimulationConfig(config) {
  return {
    spawns: Array.isArray(config?.spawns) ? config.spawns.map((group) => ({...group})) : [],
    knobs: config?.knobs && typeof config.knobs === 'object' ? structuredClone(config.knobs) : {},
  }
}

function isPromise(value) {
  return value && typeof value.then === 'function'
}
