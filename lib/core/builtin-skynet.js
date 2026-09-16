import {defaultMap as mapData} from './map.js'
import unitsData from './data/units.json' with {type: 'json'}
import {POPULATION} from './population.js'
import {isBossWave, nearestGates, validateWaveConfig} from './waves.js'

/**
 * The built-in Skynet. Since the director pass it plans the frame of a wave,
 * not its contents: which gates are hot, and the population numbers the in-wave
 * pacer runs. Only boss waves still list a spawn group. The event deck owns
 * lights, fog, and doors, so this plan never touches them.
 */
export class BuiltinSkynet {
  constructor({map = mapData, catalog = unitsData} = {}) {
    this.map = map
    this.catalog = catalog
  }

  plan({wave, budget, telemetry}) {
    const camped = mostCampedPosition(telemetry, this.map) || {x: 0, y: 0, z: 8}
    const bossGate = this.map.spawnGates.find((gate) => gate.boss)
    const normalGates = nearestGates(this.map, camped, isBossWave(wave) ? 2 : wave <= 2 ? 2 : 3)
      .filter((id) => id !== bossGate?.id)
    const gates = isBossWave(wave) && bossGate ? [bossGate.id, ...normalGates].slice(0, 3) : normalGates
    const knobs = {gates, doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false}
    const spawns = isBossWave(wave) && bossGate ? [{t: 0, gate: bossGate.id, unit: 'hktank', count: 1}] : []
    // The contract's starting tune. A later agent overrides fields here
    // without touching the pacer.
    const population = structuredClone(POPULATION)
    const config = {spawns, knobs, population}
    const validation = validateWaveConfig(config, {wave, budget, map: this.map, catalog: this.catalog, requireUnits: false})
    if (validation.ok) return config
    // No usable boss gate on this map: the pacer still runs the whole wave.
    return {spawns: [], knobs: {...knobs, gates: normalGates}, population}
  }
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

function heatValue(value) {
  return Number(value?.seconds ?? value?.time ?? value ?? 0)
}
