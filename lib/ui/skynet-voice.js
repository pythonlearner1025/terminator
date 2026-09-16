import {HEATMAP_CELL_METERS} from '../core/telemetry.js'

// Skynet speaks one line per director verb through world.transmission, which the
// HUD ticker already shows. Presentation only: no core state changes here.
export const TAUNT_INTERVAL_SECONDS = 8

// Zone boxes over the map's ground plan, first match wins. Anything outside them
// is open ground, which Skynet calls the yard.
export const ZONES = Object.freeze([
  Object.freeze({name: 'tunnel', minX: -30, maxX: -18, minZ: -5, maxZ: 5}),
  Object.freeze({name: 'building', minX: -15, maxX: 15, minZ: 16, maxZ: 28}),
  Object.freeze({name: 'dock', minX: 16, maxX: 30, minZ: -15, maxZ: 7}),
  Object.freeze({name: 'barracks', minX: 26, maxX: 42, minZ: 7, maxZ: 30}),
  Object.freeze({name: 'courtyard', minX: -13, maxX: 13, minZ: -13, maxZ: 13}),
])
export const OPEN_ZONE = 'yard'
export const DEFAULT_BOUNDS = Object.freeze({minX: -42, minZ: -30})

export function zoneAt(pos = {}) {
  const x = Number(pos.x) || 0
  const z = Number(pos.z) || 0
  for (const zone of ZONES) if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) return zone.name
  return OPEN_ZONE
}

// Heatmap keys are `cellX:cellZ`, counted from the map's minimum corner.
export function cellCenter(key, meters = HEATMAP_CELL_METERS, bounds = DEFAULT_BOUNDS) {
  const [cellX, cellZ] = String(key).split(':').map(Number)
  return {
    x: (Number(bounds?.minX) || 0) + (cellX + 0.5) * meters,
    z: (Number(bounds?.minZ) || 0) + (cellZ + 0.5) * meters,
  }
}

// The hottest cell names the zone. The percent is that zone's share of the wave.
export function hottestZone(summary = {}, bounds = DEFAULT_BOUNDS) {
  const meters = Number(summary.heatmap_cell_meters) || HEATMAP_CELL_METERS
  const totals = new Map()
  let total = 0
  let best = null
  for (const [key, raw] of Object.entries(summary.heatmap || {})) {
    const weight = Number(raw) || 0
    if (weight <= 0) continue
    const zone = zoneAt(cellCenter(key, meters, bounds))
    total += weight
    totals.set(zone, (totals.get(zone) || 0) + weight)
    if (!best || weight > best.weight) best = {zone, weight}
  }
  if (!best) return null
  return {zone: best.zone, percent: Math.round(totals.get(best.zone) / total * 100)}
}

export function campLine(summary, bounds) {
  const camp = hottestZone(summary, bounds)
  return camp ? `CAMPED ${camp.zone.toUpperCase()} ${camp.percent}%. ADJUSTING.` : null
}

export function tauntFor(event, world) {
  if (event.type === 'mob_incoming') return event.behind ? 'POSITION KNOWN. UNITS REROUTED.' : 'UNITS INBOUND.'
  if (event.type === 'special_dispatched') return event.unitType === 't1000' ? 'T-1000 DISPATCHED.' : null
  if (event.type === 'deck_card') return event.card === 'lights_out' && event.phase === 'fired' ? 'LIGHTS ARE MINE.' : null
  if (event.type === 'stragglers_enraged') return 'FINISH THEM.'
  if (event.type === 'extraction') {
    if (event.phase === 'announced') return 'EXTRACTION SIGNAL DETECTED.'
    if (event.phase === 'arrived') return 'ALL UNITS. TERMINATE.'
    return null
  }
  if (event.type === 'wave_summary') return campLine(event, world?.map?.bounds)
  return null
}

export class SkynetVoice {
  constructor(world = null) {
    this.world = world
    this.eventIndex = 0
    this.lastAt = -Infinity
  }
  consume(world = this.world) {
    if (!world?.eventLog) return this
    this.world = world
    const now = Number(world.time) || 0
    for (; this.eventIndex < world.eventLog.length; this.eventIndex += 1) {
      const event = world.eventLog[this.eventIndex]
      const line = tauntFor(event, world)
      if (!line) continue
      const at = Number.isFinite(event.t) ? event.t : now
      if (at - this.lastAt < TAUNT_INTERVAL_SECONDS) continue
      this.lastAt = at
      world.transmission = line
    }
    return this
  }
  dispose() {
    this.world = null
    this.eventIndex = 0
    this.lastAt = -Infinity
  }
}

// Mount and step in one call, the way bindBulletPresentation binds each frame.
// A new match brings a new World, which resets the cursor and the rate limit.
export function mountSkynetVoice(manager) {
  const world = manager?.world
  if (!world) return null
  let voice = manager.skynetVoice
  if (!voice || voice.world !== world) voice = manager.skynetVoice = new SkynetVoice(world)
  return voice.consume(world)
}

export default mountSkynetVoice
