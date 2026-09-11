import {projectViewModel} from '../core/viewmodel.js'

// Older core builds omit teammates from nameplates. Fill only missing entries,
// through the same view-model channel, without changing authoritative state.
export function withCoopNameplates(view, world, localPlayerId, spectate) {
  const observer = world.getPlayer(spectate?.id || localPlayerId)
  if (!observer) return view
  const nameplates = spectate ? projectViewModel(world, observer.id).nameplates : view.nameplates
  const existing = new Set(nameplates.map(item => item.playerId || item.id))
  const teammates = [...world.players.values()]
    .filter(player => player.id !== localPlayerId && player.id !== spectate?.id && !existing.has(player.id))
    .map(player => ({
      id: player.id, kind: 'teammate', label: player.name, pos: {...player.pos},
      hp: player.hp, maxHp: 100, ratio: Math.max(0, Math.min(1, player.hp / 100)),
      distance: Math.hypot(player.pos.x-observer.pos.x, player.pos.y-observer.pos.y, player.pos.z-observer.pos.z),
      alive: player.alive, downed: player.downed, chatter: '',
    }))
  return {...view, nameplates: [...nameplates, ...teammates]}
}
