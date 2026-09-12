// Range commands remain in core. Views only consume the resulting state and events.
export const RANGE_START = Object.freeze({x: -18, y: 0, z: -13, yaw: Math.PI / 2, pitch: 0})
export const RANGE_DISTANCES = Object.freeze([10, 20, 40])
export const RANGE_WEAPONS = Object.freeze(['pistol', 'm4', 'shotgun', 'plasma', 'knife', 'grenade', 'sniper', 'launcher'])
export const RANGE_RESPAWN_TICKS = 120

export function parseRangeFlag(search = '') {
  return new URLSearchParams(String(search || '')).get('range') === '1'
}

export function rangeLayout() {
  const types = ['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank']
  const rows = [[-23, -20.5, -15.5, -10, -7, -25], [-27, -16.5, -12, -8, -10, -20], [-27.5, -28.3, -17.5, -13.5, -11, -15]]
  return RANGE_DISTANCES.flatMap((row, index) => types.map((type, column) => ({
    id: `range-${row}-${type}`, type, row,
    distance: type === 'hktank' ? 40 : row,
    pos: {x: RANGE_START.x + (type === 'hktank' ? 40 : row), y: type === 'hkaerial' ? 4 : 0, z: rows[index][column]},
    yaw: -Math.PI / 2,
  })))
}

// The fixed tick remains 1/60 s. Only wall-time admission changes.
export class RangeClock {
  constructor() { this.scale = 1; this.accumulator = 0; this.pending = 0 }
  setScale(scale) {
    if (![0, 0.1, 0.25, 1].includes(scale)) return false
    this.scale = scale; this.accumulator = 0; this.pending = 0
    return true
  }
  step() { if (this.scale === 0) this.pending += 1 }
  takeTicks(deltaMs) {
    if (this.scale === 0) { const ticks = Math.min(1, this.pending); this.pending -= ticks; return ticks }
    this.accumulator += Math.min(.1, Math.max(0, Number(deltaMs) || 0) / 1000) * this.scale
    const ticks = Math.floor((this.accumulator + 1e-10) * 60)
    this.accumulator = Math.max(0, this.accumulator - ticks / 60)
    return ticks
  }
}

export class WeaponsRange {
  constructor(world, director) {
    this.world = world; this.director = director; this.clock = new RangeClock()
    this.layout = rangeLayout(); this.targets = new Map(); this.selected = 'pistol'
    world.setSandbox({invulnerable: true, infiniteScrap: true, infiniteAmmo: true})
    director.setSandbox(true)
  }
  start() {
    const p = this.world.player
    p.pos = {x: RANGE_START.x, y: RANGE_START.y, z: RANGE_START.z}
    p.vel = {x: 0, y: 0, z: 0}; p.yaw = RANGE_START.yaw; p.pitch = RANGE_START.pitch
    this.respawn(); this.equip('pistol')
  }
  spawn(slot) {
    const unit = this.world.spawnUnit(slot.type, slot.pos, {yaw: slot.yaw, brain: 'dummy'})
    if (unit) { this.targets.set(slot.id, unit.id); this.world.emit('range_respawn', {slot: slot.id, unitId: unit.id, pos: unit.pos}) }
    return unit
  }
  respawn() {
    // Only this fixture's targets are replaced. Sandbox-spawned units stay intact.
    const ids = new Set(this.targets.values())
    for (const unit of this.world.units) if (ids.has(unit.id)) { unit.brain?.destroy?.(); this.world.unitById.delete(unit.id) }
    this.world.units = this.world.units.filter(unit => !ids.has(unit.id))
    this.targets.clear()
    for (const slot of this.layout) this.spawn(slot)
  }
  afterStep() {
    for (const slot of this.layout) {
      const id = this.targets.get(slot.id), unit = this.world.unitById.get(id)
      if (unit?.alive || (unit && this.world.tick - unit.diedAtTick < RANGE_RESPAWN_TICKS)) continue
      if (unit) {
        this.world.unitById.delete(id)
        this.world.units = this.world.units.filter(candidate => candidate.id !== id)
      }
      this.spawn(slot)
    }
  }
  equip(id) {
    if (!RANGE_WEAPONS.includes(id)) return false
    const w = this.world, p = w.player
    this.selected = id; w.giveAllWeapons()
    if (id === 'knife' || id === 'grenade') p.activeWeapon = id
    else w.switchWeapon(id)
    p.reloadTimer = 0; p.fireCooldown = 0; p.meleeCooldown = 0; p.grenadeCooldown = 0; p.aiming = false
    return true
  }
  setReloads(enabled) {
    this.world.setSandbox({...this.world.sandbox, noReload: !enabled})
    if (!enabled) { this.world.player.reloadTimer = 0; this.world.giveAllWeapons() }
  }
  reload() {
    const p = this.world.player, ammo = p.ammo[p.activeWeapon]
    if (this.world.sandbox.noReload || !ammo || p.reloadTimer > 0) return false
    ammo.mag = Math.min(ammo.mag, this.world.weaponCatalog.weapons[p.activeWeapon].mag - 1)
    return this.world.startReload()
  }
  input(input, loop = null) {
    const p = this.world.player
    const requestedFire = input.fire
    if (loop) {
      input = {yaw: p.yaw, pitch: p.pitch}
      if (loop === 'fire') input.fire = true
      if (loop === 'aim') input.aim = Math.floor((this.world.tick - (this.loopStartedAt || 0)) / 90) % 2 === 0
      if (loop === 'reload' && p.reloadTimer === 0) this.reload()
    }
    if (requestedFire) input.fire = true
    if (p.activeWeapon === 'knife') return {...input, fire: false, melee: (input.fire && p.meleeCooldown <= 1 / 60) || input.melee}
    if (p.activeWeapon === 'grenade') return {...input, fire: false, grenade: (input.fire && p.grenadeCooldown <= 1 / 60) || input.grenade}
    // An empty magazine starts its normal reload while the trigger remains held.
    if (input.fire && p.ammo[p.activeWeapon]?.mag === 0) this.world.startReload()
    return input
  }
}
