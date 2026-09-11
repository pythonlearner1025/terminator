import mapData from './data/map.json' with {type: 'json'}
import unitsData from './data/units.json' with {type: 'json'}
import {nearestGates, validateWaveConfig} from './waves.js'

export class BuiltinSkynet {
  constructor({map = mapData, catalog = unitsData} = {}) {
    this.map = map
    this.catalog = catalog
  }

  plan({wave, budget, telemetry}) {
    const camped = mostCampedPosition(telemetry, this.map) || {x: 0, y: 0, z: 8}
    const gates = nearestGates(this.map, camped, wave <= 2 ? 2 : 3)
    const usedWeapon = mostUsedWeapon(telemetry)
    const preferred = counterOrder(usedWeapon)
    const knobs = {gates, doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false}
    if (wave % 3 === 0) {
      const zone = closestLightZone(this.map, camped)
      if (zone) knobs.lights[zone.id] = 'off'
    }
    const mapSpend = Object.keys(knobs.lights).length * 40
    const remaining = budget - mapSpend
    const maxPerType = budget * 0.4
    const counts = {scout: 0, endo: 0, heavy: 0}
    const targetCount = wave === 1 ? 1 : wave === 2 ? 2 : Math.min(12, 4 + wave)

    if (wave === 1) {
      counts.scout = 1
    } else if (wave >= 3) {
      counts.scout = 1
      counts.endo = 1
    } else {
      counts.scout = 1
      counts.endo = 1
    }
    let spent = counts.scout * this.catalog.types.scout.cost + counts.endo * this.catalog.types.endo.cost
    let cursor = 0
    while (Object.values(counts).reduce((sum, count) => sum + count, 0) < targetCount && cursor < 100) {
      const type = preferred[cursor % preferred.length]
      const unit = this.catalog.types[type]
      const typeSpend = counts[type] * unit.cost
      if (spent + unit.cost <= remaining && typeSpend + unit.cost <= maxPerType) {
        counts[type] += 1
        spent += unit.cost
      }
      cursor += 1
      if (preferred.every((id) => spent + this.catalog.types[id].cost > remaining
        || counts[id] * this.catalog.types[id].cost + this.catalog.types[id].cost > maxPerType)) break
    }
    const spawns = []
    let groupIndex = 0
    for (const type of preferred) {
      if (!counts[type]) continue
      spawns.push({t: groupIndex * (wave <= 2 ? 10 : 2.5), gate: gates[groupIndex % gates.length], unit: type, count: counts[type]})
      groupIndex += 1
    }
    const config = {spawns, knobs}
    const validation = validateWaveConfig(config, {wave, budget, map: this.map, catalog: this.catalog})
    if (validation.ok) return config
    return safeConfig(wave, budget, gates, this.map, this.catalog)
  }
}

function safeConfig(wave, budget, gates, map, catalog) {
  const spawns = wave >= 3
    ? [{t: 0, gate: gates[0], unit: 'scout', count: 1}, {t: 1, gate: gates[1] || gates[0], unit: 'endo', count: 1}]
    : [{t: 0, gate: gates[0], unit: 'scout', count: 1}]
  const config = {spawns, knobs: {gates: [...new Set(spawns.map(({gate}) => gate))], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false}}
  const result = validateWaveConfig(config, {wave, budget, map, catalog})
  if (!result.ok) throw new Error(`Built-in Skynet failed to make a valid config: ${result.errors.map(({code}) => code).join(', ')}`)
  return config
}

function mostUsedWeapon(telemetry) {
  const entries = Object.entries(telemetry?.shots || {}).filter(([id]) => !id.startsWith('unit:'))
  entries.sort((a, b) => b[1].fired - a[1].fired || a[0].localeCompare(b[0]))
  return entries[0]?.[0] || 'pistol'
}

function counterOrder(weapon) {
  if (weapon === 'shotgun') return ['endo', 'scout', 'heavy']
  if (weapon === 'plasma') return ['scout', 'endo', 'heavy']
  if (weapon === 'm4') return ['heavy', 'scout', 'endo']
  return ['scout', 'endo', 'heavy']
}

function mostCampedPosition(telemetry, map) {
  const entries = Object.entries(telemetry?.heatmap || {})
  if (!entries.length) return null
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const [x, z] = entries[0][0].split(':').map(Number)
  return {x: map.bounds.minX + x * 2 + 1, y: 0, z: map.bounds.minZ + z * 2 + 1}
}

function closestLightZone(map, pos) {
  return [...map.lightZones].sort((a, b) => {
    const ad = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z)
    const bd = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z)
    return ad - bd || a.id.localeCompare(b.id)
  })[0]
}
