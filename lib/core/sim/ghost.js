import {HOST_PLAYER_ID, normalizeInputs} from '../world.js'

export function ghostFromWave(telemetry, replay) {
  const shots = telemetry?.shots || {}
  const accuracy = Object.fromEntries(Object.entries(shots)
    .filter(([weapon]) => !weapon.startsWith('unit:'))
    .map(([weapon, stats]) => {
      const fired = Number(stats?.fired ?? stats?.shots_fired ?? 0)
      const hits = Number(stats?.hits ?? 0)
      return [weapon, fired > 0 ? hits / fired : Math.max(0, Math.min(1, Number(stats?.accuracy) || 0))]
    }))
  return {
    wave: Number(telemetry?.wave) || null,
    inputs: Array.isArray(replay) ? replay.map((input) => normalizeInputs(input?.[HOST_PLAYER_ID] || input)) : [],
    accuracy,
    time_to_clear: finiteOrNull(telemetry?.timeToClear ?? telemetry?.time_to_clear),
  }
}

export function last(telemetry, replays) {
  const entries = waveEntries(telemetry)
  if (entries.length === 0) return null
  const [wave, summary] = entries.sort((a, b) => Number(b[0]) - Number(a[0]))[0]
  return ghostFromWave({...summary, wave: Number(wave)}, replayFor(replays, wave))
}

export function best(telemetry, replays) {
  const entries = waveEntries(telemetry).filter(([, summary]) => {
    const clear = summary?.timeToClear ?? summary?.time_to_clear
    return clear !== null && clear !== '' && Number.isFinite(Number(clear)) && !summary?.player_died && !summary?.playerDied
  })
  if (entries.length === 0) return null
  const [wave, summary] = entries.sort((a, b) => {
    const aTime = Number(a[1].timeToClear ?? a[1].time_to_clear)
    const bTime = Number(b[1].timeToClear ?? b[1].time_to_clear)
    return aTime - bTime || Number(a[0]) - Number(b[0])
  })[0]
  return ghostFromWave({...summary, wave: Number(wave)}, replayFor(replays, wave))
}

export function selectGhost(telemetry, replays, selector = 'last') {
  if (selector === 'last') return last(telemetry, replays)
  if (selector === 'best') return best(telemetry, replays)
  const wave = Number(selector)
  const summary = waveEntries(telemetry).find(([key]) => Number(key) === wave)?.[1]
  return summary ? ghostFromWave({...summary, wave}, replayFor(replays, wave)) : null
}

export function ghostInputAt(ghost, tick) {
  if (!ghost?.inputs?.[tick]) {
    const previous = ghost?.inputs?.at(-1)
    return normalizeInputs(previous ? {...previous, move: {x: 0, z: 0}, fire: false, reload: false, grenade: false, melee: false, ready: false} : {})
  }
  return normalizeInputs(ghost.inputs[tick])
}

function waveEntries(value) {
  if (value instanceof Map) return [...value.entries()]
  if (Array.isArray(value)) return value.map((summary, index) => [summary?.wave ?? index + 1, summary])
  if (value && typeof value === 'object') return Object.entries(value.telemetryByWave || value.telemetry_by_wave || value)
  return []
}

function replayFor(replays, wave) {
  if (replays instanceof Map) return replays.get(Number(wave)) || replays.get(String(wave)) || []
  if (Array.isArray(replays)) return Array.isArray(replays[Number(wave) - 1]) ? replays[Number(wave) - 1] : replays
  return replays?.[wave] || replays?.[String(wave)] || []
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}
