import {distance} from './math.js'

// Four caches are live per wave, one of each kind, on four of the twelve
// authored map.cacheSpots. The director plans them at wave start; the world
// steps them every tick so any living player can take one by walking over it.
export const CACHES_PER_WAVE = 4
export const CACHE_KINDS = Object.freeze(['weapon', 'armor', 'ammo', 'grenades'])
export const WEAPON_CACHE_WAVE = 1
export const WEAPON_CACHE_ORDER = Object.freeze(['m4', 'shotgun', 'plasma'])
export const CACHE_PICKUP_RADIUS = 1.2
export const CACHE_ARMOR = 50
export const CACHE_ARMOR_MAX = 100
export const CACHE_AMMO_SHARE = 0.3
export const CACHE_GRENADES = 2

export class Pickups {
  constructor(map) {
    this.spots = map?.cacheSpots || []
    this.wave = 0
    this.active = []
    this.announced = true
  }

  // Deterministic: the only randomness is the passed rng, one draw per cache.
  plan(wave, rng) {
    const pool = [...this.spots]
    this.wave = Number(wave) || 0
    this.active = []
    for (let index = 0; index < CACHES_PER_WAVE && pool.length; index += 1) {
      const [spot] = pool.splice(Math.floor(rng.next() * pool.length), 1)
      this.active.push({id: spot.id, kind: kindFor(index, this.wave), pos: {...spot.pos}})
    }
    this.announced = false
    return this.active
  }

  step(world) {
    if (!world) return
    if (!this.announced) {
      this.announced = true
      for (const cache of this.active) world.emit('cache_spawned', {id: cache.id, kind: cache.kind, pos: {...cache.pos}})
    }
    if (!this.active.length) return
    for (const player of world.livingPlayers) {
      for (let index = this.active.length - 1; index >= 0; index -= 1) {
        const cache = this.active[index]
        if (distance(player.pos, cache.pos) > CACHE_PICKUP_RADIUS) continue
        this.active.splice(index, 1)
        this.give(world, player, cache.kind)
        world.emit('cache_taken', {id: cache.id, kind: cache.kind, playerId: player.id, pos: {...cache.pos}})
      }
    }
  }

  // A weapon cache hands over the first weapon this player does not own. A
  // player who already owns all three gets the ammunition cache instead.
  give(world, player, kind) {
    if (kind === 'armor') player.armor = Math.min(CACHE_ARMOR_MAX, player.armor + CACHE_ARMOR)
    else if (kind === 'grenades') player.grenades = Math.min(world.weaponCatalog.weapons.grenade.max, player.grenades + CACHE_GRENADES)
    else if (kind === 'weapon') {
      const id = WEAPON_CACHE_ORDER.find(weaponId => !player.ammo[weaponId]?.owned)
      if (!id) return this.give(world, player, 'ammo')
      player.ammo[id].owned = true
      player.ammo[id].mag = world.weaponCatalog.weapons[id].mag
    } else {
      for (const id of world.weaponCatalog.slots) {
        const ammo = player.ammo[id]
        if (!ammo?.owned) continue
        const weapon = world.weaponCatalog.weapons[id]
        ammo.reserve = Math.min(weapon.reserveMax, ammo.reserve + Math.round(weapon.reserveMax * CACHE_AMMO_SHARE))
      }
    }
  }

  snapshot() {
    return {wave: this.wave, announced: this.announced, active: this.active.map(cache => ({...cache, pos: {...cache.pos}}))}
  }

  applySnapshot(snapshot) {
    this.wave = Number(snapshot?.wave) || 0
    this.announced = snapshot?.announced !== false
    this.active = (snapshot?.active || []).map(cache => ({id: cache.id, kind: cache.kind, pos: {...cache.pos}}))
    return this
  }
}

function kindFor(index, wave) {
  const kind = CACHE_KINDS[index]
  return kind === 'weapon' && wave < WEAPON_CACHE_WAVE ? 'ammo' : kind
}
