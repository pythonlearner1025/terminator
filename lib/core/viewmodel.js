import weaponsData from './data/weapons.json' with {type: 'json'}
import {clamp, normalizeAngle, planarDistance, round, yawTo} from './math.js'

export function projectViewModel(world) {
  const player = world.player
  const weapon = weaponsData.weapons[player.activeWeapon]
  const ammo = player.ammo[player.activeWeapon] || {mag: 0, reserve: 0}
  const now = world.time
  const recentEvents = world.eventLog.filter((event) => now - event.t <= 5)
  const killFeed = recentEvents.filter(({type}) => type === 'kill').slice(-5).reverse().map((event) => ({
    id: `${event.tick}:${event.unitId}`,
    text: `${weaponLabel(event.weapon)}  ${event.headshot ? 'HEADSHOT  ' : ''}${unitLabel(event.unitType)}`,
    age: round(now - event.t, 3),
  }))
  const hitMarkers = recentEvents.filter((event) => event.type === 'shot' && event.by === 'player' && event.hit && now - event.t <= 0.35).map((event) => ({
    id: `${event.tick}:${event.weapon}`,
    kind: event.killed ? 'kill' : event.headshot ? 'headshot' : 'hit',
  }))
  const damageDirections = recentEvents.filter((event) => event.type === 'player_damage' && event.attackerPos && now - event.t <= 1).map((event) => ({
    id: `${event.tick}:${event.unitId || event.unitType}`,
    angle: normalizeAngle(player.yaw - yawTo(player.pos, event.attackerPos)),
    strength: clamp(event.amount / 30, 0.25, 1),
    age: round(now - event.t, 3),
  }))
  const nameplates = world.aliveUnits.filter((unit) => {
    const dist = planarDistance(player.pos, unit.pos)
    if (dist > 25) return false
    const angle = Math.abs(normalizeAngle(yawTo(player.pos, unit.pos) - player.yaw))
    return angle < Math.PI * 0.45 && world.lineOfSight({...player.pos, y: player.pos.y + 1.5}, {...unit.pos, y: unit.pos.y + 1.3})
  }).map((unit) => {
    const chatter = [...recentEvents].reverse().find((event) => event.type === 'unit_say' && event.unitId === unit.id)
    return {
      id: unit.id,
      label: unitLabel(unit.type),
      rev: unit.rev,
      hp: round(unit.hp),
      maxHp: unit.maxHp,
      ratio: clamp(unit.hp / unit.maxHp, 0, 1),
      distance: round(planarDistance(player.pos, unit.pos), 1),
      pos: {...unit.pos},
      chatter: chatter?.text || '',
    }
  })
  const reloadProgress = player.reloadTimer > 0 && weapon.reloadSeconds
    ? clamp(1 - player.reloadTimer / weapon.reloadSeconds, 0, 1)
    : 0
  return {
    tick: world.tick,
    health: {value: round(player.hp), max: 100, ratio: clamp(player.hp / 100, 0, 1), low: player.hp < 35, critical: player.hp < 20},
    armor: {value: round(player.armor), max: 100, ratio: clamp(player.armor / 100, 0, 1)},
    ammo: {mag: ammo.mag, reserve: ammo.reserve, capacity: weapon.mag, low: ammo.mag > 0 && ammo.mag <= Math.ceil(weapon.mag * 0.25), empty: ammo.mag === 0},
    weapon: {id: weapon.id, name: weapon.name, slot: weapon.slot, reloadProgress, reloading: player.reloadTimer > 0,
      aiming: player.aiming, spread: world.playerSpread},
    wave: {
      current: world.wave,
      total: 10,
      remaining: world.aliveUnits.length,
      phase: world.phase,
      timer: world.phase === 'intermission' ? round(world.phaseTicksLeft / 60, 1) : round(world.waveTime(), 1),
      budget: world.waveBudget,
      multiplier: world.performanceMultiplier,
    },
    skynet: {
      status: world.skynet.name === 'BUILT-IN' ? 'BUILT-IN' : world.skynet.name,
      connected: world.skynet.connected,
      fallbackCount: world.skynet.fallbackCount,
      revs: {...world.skynet.revs},
    },
    scrap: player.scrap,
    grenades: player.grenades,
    sprintStamina: round(player.sprintStamina, 2),
    crosshair: {
      spread: world.playerSpread,
      reloadProgress,
    },
    killFeed,
    hitMarkers,
    damageDirections,
    nameplates,
    transmission: world.transmission,
  }
}

function unitLabel(type) {
  if (type === 'scout') return 'T-600 SCOUT'
  if (type === 'heavy') return 'T-800 HEAVY'
  return 'T-800 ENDO'
}

function weaponLabel(id) {
  return weaponsData.weapons[id]?.name?.toUpperCase() || String(id || 'UNKNOWN').toUpperCase()
}
