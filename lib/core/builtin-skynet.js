import {defaultMap as mapData} from './map.js'
import unitsData from './data/units.json' with {type: 'json'}
import {isBossWave, nearestGates, unlockedUnitTypes, validateWaveConfig} from './waves.js'

export class BuiltinSkynet {
  constructor({map = mapData, catalog = unitsData} = {}) {
    this.map = map
    this.catalog = catalog
  }

  plan({wave, budget, telemetry, scaling}) {
    const camped = mostCampedPosition(telemetry, this.map) || {x: 0, y: 0, z: 8}
    const bossGate = this.map.spawnGates.find((gate) => gate.boss)
    const normalGates = nearestGates(this.map, camped, isBossWave(wave) ? 2 : wave <= 2 ? 2 : 3)
      .filter((id) => id !== bossGate?.id)
    const gates = isBossWave(wave) && bossGate ? [bossGate.id, ...normalGates].slice(0, 3) : normalGates
    const unlocked = new Set(unlockedUnitTypes(wave).filter((id) => id !== 'hktank'))
    const preferred = priorityOrder(wave, counterOrder(mostUsedWeapon(telemetry))).filter((id) => unlocked.has(id))
    const knobs = {
      gates,
      doors: {},
      lights: {},
      fog: longRangeFog(telemetry),
      hazards: [],
      break_flank_wall: false,
    }

    if (wave % 3 === 0) {
      const zone = closestLightZone(this.map, camped)
      if (zone) knobs.lights[zone.id] = 'off'
    }
    if (wave >= 5) {
      const door = mostUsedDoor(telemetry, this.map)
      if (door) knobs.doors[door] = 'locked'
    }

    const counts = spendOnUnits({
      budget: budget - knobSpend(knobs),
      capBudget: budget,
      preferred,
      catalog: this.catalog,
      minimumTypes: wave >= 3 ? 2 : 1,
      maxUnits: scaling?.maxAlive ?? this.catalog.maxAlive,
    })
    const spawns = []
    if (isBossWave(wave) && bossGate) spawns.push({t: 0, gate: bossGate.id, unit: 'hktank', count: 1})
    for (const type of preferred) {
      if (!counts[type]) continue
      const index = spawns.length
      spawns.push({
        t: index * (wave <= 2 ? 6 : 2.5),
        gate: normalGates[index % normalGates.length],
        unit: type,
        count: counts[type],
      })
    }
    const config = {spawns, knobs}
    const validation = validateWaveConfig(config, {wave, budget, map: this.map, catalog: this.catalog})
    if (validation.ok) return config
    return safeConfig(wave, budget, gates, this.map, this.catalog)
  }
}

function spendOnUnits({budget, capBudget, preferred, catalog, minimumTypes, maxUnits}) {
  const counts = Object.fromEntries(Object.keys(catalog.types).map((id) => [id, 0]))
  const perTypeLimit = capBudget * 0.4
  let spent = 0
  let total = 0
  const affordable = preferred.filter((id) => catalog.types[id].cost > 0 && catalog.types[id].cost <= budget)

  for (const type of affordable.slice(0, minimumTypes)) {
    const cost = catalog.types[type].cost
    counts[type] += 1
    spent += cost
    total += 1
  }

  let progress = true
  while (progress && total < maxUnits) {
    progress = false
    for (const type of preferred) {
      const cost = catalog.types[type].cost
      const nextCount = counts[type] + 1
      const exceedsCap = nextCount * cost > perTypeLimit + 1e-9
      if (spent + cost > budget || (exceedsCap && nextCount > 1)) continue
      counts[type] += 1
      spent += cost
      total += 1
      progress = true
      if (total >= maxUnits) break
    }
  }
  return counts
}

function safeConfig(wave, budget, gates, map, catalog) {
  const unlocked = new Set(unlockedUnitTypes(wave).filter((id) => id !== 'hktank'))
  const affordable = Object.values(catalog.types)
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))
    .filter((unit) => unlocked.has(unit.id) && unit.cost > 0 && unit.cost <= budget)
  const required = wave >= 3 ? 2 : 1
  const selected = affordable.slice(0, required)
  const spawns = selected.map((unit, index) => ({
    t: index,
    gate: gates[index % gates.length],
    unit: unit.id,
    count: 1,
  }))
  if (isBossWave(wave)) {
    const bossGate = map.spawnGates.find((gate) => gate.boss)
    if (bossGate) spawns.unshift({t: 0, gate: bossGate.id, unit: 'hktank', count: 1})
  }
  const config = {
    spawns,
    knobs: {
      gates: [...new Set(spawns.map(({gate}) => gate))],
      doors: {},
      lights: {},
      fog: 0,
      hazards: [],
      break_flank_wall: false,
    },
  }
  const result = validateWaveConfig(config, {wave, budget, map, catalog})
  if (!result.ok) throw new Error(`Built-in Skynet failed to make a valid config: ${result.errors.map(({code}) => code).join(', ')}`)
  return config
}

function mostUsedWeapon(telemetry) {
  const entries = Object.entries(telemetry?.shots || {}).filter(([id]) => !id.startsWith('unit:'))
  entries.sort((a, b) => shotsFired(b[1]) - shotsFired(a[1]) || a[0].localeCompare(b[0]))
  return entries[0]?.[0] || 'pistol'
}

function counterOrder(weapon) {
  if (weapon === 'shotgun' || weapon === 'launcher') return ['endo', 'heavy', 'hkaerial', 't1000', 'scout']
  if (weapon === 'plasma') return ['scout', 'endo', 'hkaerial', 't1000', 'heavy']
  if (weapon === 'm4' || weapon === 'sniper') return ['heavy', 't1000', 'scout', 'hkaerial', 'endo']
  return ['scout', 'endo', 'heavy', 'hkaerial', 't1000']
}

function priorityOrder(wave, order) {
  const priority = []
  if (wave >= 4) priority.push('t1000')
  if (wave >= 3) priority.push('hkaerial')
  if (wave >= 2) priority.push('heavy')
  return [...new Set([...priority, ...order])]
}

function longRangeFog(telemetry) {
  const shots = telemetry?.shots || {}
  const longRange = ['m4', 'plasma'].reduce((total, weapon) => ({
    fired: total.fired + shotsFired(shots[weapon]),
    hits: total.hits + Number(shots[weapon]?.hits || 0),
  }), {fired: 0, hits: 0})
  if (longRange.fired < 8) return 0
  const accuracy = longRange.hits / longRange.fired
  if (accuracy >= 0.75) return 3
  if (accuracy >= 0.55) return 2
  return 0
}

function mostUsedDoor(telemetry, map) {
  const uses = telemetry?.doorUses || telemetry?.door_uses || {}
  const known = new Set(map.doors.map(({id}) => id))
  return Object.entries(uses)
    .filter(([id]) => known.has(id))
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))[0]?.[0] || null
}

function mostCampedPosition(telemetry, map) {
  const heatmap = telemetry?.heatmap?.cells || telemetry?.heatmap || {}
  const entries = Object.entries(heatmap)
  if (!entries.length) return null
  entries.sort((a, b) => heatValue(b[1]) - heatValue(a[1]) || a[0].localeCompare(b[0]))
  const [x, z] = entries[0][0].split(':').map(Number)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return {x: map.bounds.minX + x * 2 + 1, y: 0, z: map.bounds.minZ + z * 2 + 1}
}

function closestLightZone(map, pos) {
  return [...map.lightZones].sort((a, b) => {
    const ad = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z)
    const bd = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z)
    return ad - bd || a.id.localeCompare(b.id)
  })[0]
}

function knobSpend(knobs) {
  return Object.keys(knobs.doors).length * 30
    + Object.keys(knobs.lights).length * 40
    + knobs.fog * 20
}

function shotsFired(stats) {
  return Number(stats?.fired ?? stats?.shots_fired ?? 0)
}

function heatValue(value) {
  return Number(value?.seconds ?? value?.time ?? value ?? 0)
}
