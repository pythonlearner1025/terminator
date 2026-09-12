import mapData from './data/map.json' with {type: 'json'}
import unitsData from './data/units.json' with {type: 'json'}
import weaponsData from './data/weapons.json' with {type: 'json'}
import * as scoutBrain from './brains/default-scout.js'
import * as endoBrain from './brains/default-endo.js'
import * as heavyBrain from './brains/default-heavy.js'
import * as t1000Brain from './brains/default-t1000.js'
import * as hkaerialBrain from './brains/default-hkaerial.js'
import * as hktankBrain from './brains/default-hktank.js'
import {NavGrid} from './nav.js'
import {SeededRng} from './rng.js'
import {FuelExhaustedError, sandboxLoadError, sandboxReady, UnitScriptRegistry} from './sandbox/index.js'
import {
  colliderSurfacesAt,
  pointInsideColliderFootprint,
  rayCollider,
  sphereIntersectsCollider,
  staticColliders,
  sweepSphereCollider,
} from './collision.js'
import {
  clamp,
  copyVec,
  directionFromAngles,
  distance,
  moveAngle,
  normalizeAngle,
  planarDistance,
  raySphere,
  round,
  yawTo,
} from './math.js'

export const TICK_RATE = 60
export const TICK_SECONDS = 1 / TICK_RATE
export const HOST_PLAYER_ID = 'player'
export const MAX_PLAYERS = 3

export const EMPTY_INPUTS = Object.freeze({
  move: Object.freeze({x: 0, z: 0}),
  yaw: 0,
  pitch: 0,
  fire: false,
  aim: false,
  reload: false,
  switchTo: null,
  sprint: false,
  crouch: false,
  jump: false,
  grenade: false,
  melee: false,
  ready: false,
})

const DEFAULT_BRAINS = {
  scout: scoutBrain,
  endo: endoBrain,
  heavy: heavyBrain,
  t1000: t1000Brain,
  hkaerial: hkaerialBrain,
  hktank: hktankBrain,
}
const SOUND_RADII = {gunshot: 60, footstep: 12, reload: 10, explosion: 60}
export const PLAYER_RADIUS = 0.38
export const ENEMY_PROJECTILE_SPEEDS = Object.freeze({round: 30, bolt: 18, shell: 22})
export const LAUNCHER_PROJECTILE_SPEED = 32
const PLAYER_EYE_HEIGHT = 1.65
const CROUCH_EYE_HEIGHT = 1.12
const PLAYER_HEIGHT = 1.8
const CROUCH_HEIGHT = 1.25
const SURFACE_EPSILON = 0.04
const JUMP_VELOCITY = 6.4
const JUMP_HEAD_CLEARANCE = 1.1
const AIR_STEERING_ACCELERATION = 9

/**
 * Deterministic, headless game state. One call to step(inputsByPlayer) advances
 * exactly one 1/60 second tick. Inputs are absolute state, not mouse or key deltas.
 */
export class World {
  constructor({map = mapData, units = unitsData, weapons = weaponsData, brains = {}, scriptSources = {}, seed = 1} = {}) {
    this.map = map
    this.unitCatalog = units
    this.weaponCatalog = weapons
    this.brains = {...DEFAULT_BRAINS, ...brains}
    this.brainOverrides = {...brains}
    this.scriptRegistry = new UnitScriptRegistry({scriptSources})
    this.rng = new SeededRng(seed)
    this.seed = Number(seed) || 1
    this.tick = 0
    this.units = []
    this.unitById = new Map()
    this.nextUnitId = 1
    this.eventLog = []
    this.snapshotEventCursor = 0
    this.replay = []
    this.projectiles = []
    this.nextProjectileId = 1
    this.sounds = []
    this.messages = []
    this.mapState = {
      doors: Object.fromEntries(map.doors.map((door) => [door.id, door.default])),
      lights: Object.fromEntries(map.lightZones.map((zone) => [zone.id, zone.default])),
      fog: 0,
      hazards: [],
      flankWallBroken: Boolean(map.flankWall.broken),
      gates: [],
    }
    this.nav = new NavGrid(map, this.dynamicColliders())
    this.phase = 'wave'
    this.wave = 1
    this.bossPhase = false
    this.waveStartedAtTick = 0
    this.phaseTicksLeft = 0
    this.waveBudget = 0
    this.performanceMultiplier = 1
    this.scaling = {players: 1, budgetMultiplier: 1, unitHealthMultiplier: 1, maxAlive: 24}
    this.skynet = {
      name: 'BUILT-IN',
      connected: true,
      fallbackCount: 0,
      revs: Object.fromEntries(Object.keys(this.unitCatalog.types).map((type) => [type, this.scriptRegistry.current(type)?.rev || 1])),
    }
    this.transmission = 'RESISTANCE SIGNAL ACQUIRED'
    this.sandbox = {invulnerable: false, infiniteScrap: false}
    this.players = new Map()
    this.hostPlayerId = HOST_PLAYER_ID
    this.previousInputsByPlayer = new Map()
    this.lastInputsBundle = {}
    this.addPlayer({id: this.hostPlayerId, name: 'Player 1'})
    this.telemetry = this.createTelemetry()
  }

  get time() {
    return this.tick * TICK_SECONDS
  }

  get aliveUnits() {
    return this.units.filter((unit) => unit.alive)
  }

  get player() {
    return this.players.get(this.hostPlayerId) || this.players.values().next().value
  }

  get livingPlayers() {
    return [...this.players.values()].filter((player) => player.alive)
  }

  get maxAlive() {
    return this.scaling?.maxAlive ?? this.unitCatalog.maxAlive
  }

  get previousInputs() {
    return this.previousInputsByPlayer.get(this.hostPlayerId) || normalizeInputs(EMPTY_INPUTS)
  }

  set previousInputs(inputs) {
    this.previousInputsByPlayer.set(this.hostPlayerId, normalizeInputs(inputs))
  }

  createPlayer({id, name}) {
    const ammo = {}
    for (const id of this.weaponCatalog.slots) {
      const weapon = this.weaponCatalog.weapons[id]
      ammo[id] = {
        mag: weapon.mag,
        reserve: id === 'pistol' ? weapon.reserveMax : 0,
        owned: id === 'pistol',
      }
    }
    return {
      id,
      name,
      hp: 100,
      armor: 0,
      pos: copyVec(this.map.playerStart.pos),
      vel: {x: 0, y: 0, z: 0},
      yaw: this.map.playerStart.yaw,
      pitch: this.map.playerStart.pitch,
      weaponSlots: [...this.weaponCatalog.slots],
      activeWeapon: 'pistol',
      ammo,
      reloadTimer: 0,
      fireCooldown: 0,
      meleeCooldown: 0,
      grenadeCooldown: 0,
      sprintStamina: 6,
      crouch: false,
      aiming: false,
      moving: false,
      sprinting: false,
      grounded: true,
      airbornePeakY: null,
      firing: false,
      grenades: 1,
      scrap: 400,
      alive: true,
      downed: false,
      lastFootstepAtTick: -1000,
    }
  }

  addPlayer({id, name} = {}) {
    const playerId = String(id || '').trim()
    if (!playerId) throw new TypeError('player id must be a non-empty string')
    if (this.players.has(playerId)) return this.players.get(playerId)
    if (this.players.size >= MAX_PLAYERS) throw new RangeError(`at most ${MAX_PLAYERS} players may connect`)
    const player = this.createPlayer({id: playerId, name: String(name || `Player ${this.players.size + 1}`)})
    this.players.set(playerId, player)
    this.previousInputsByPlayer.set(playerId, normalizeInputs(EMPTY_INPUTS))
    if (this.telemetry?.players) this.telemetry.players[playerId] = this.createPlayerTelemetry(player)
    this.emit('player_join', {playerId, name: player.name})
    return player
  }

  removePlayer(id) {
    const playerId = String(id)
    const player = this.players.get(playerId)
    if (!player) return false
    this.players.delete(playerId)
    this.previousInputsByPlayer.delete(playerId)
    if (playerId === this.hostPlayerId) this.hostPlayerId = this.players.keys().next().value || null
    this.emit('player_leave', {playerId, name: player.name})
    return true
  }

  getPlayer(playerId = this.hostPlayerId) {
    return this.players.get(playerId) || null
  }

  nearestLivingPlayer(pos) {
    let nearest = null
    for (const player of this.players.values()) {
      if (!player.alive) continue
      const dist = planarDistance(pos, player.pos)
      if (!nearest || dist < nearest.dist) nearest = {player, dist}
    }
    return nearest?.player || null
  }

  respawnDeadPlayers() {
    for (const player of this.players.values()) {
      if (player.alive) continue
      player.hp = 100
      player.alive = true
      player.downed = false
      player.pos = copyVec(this.map.playerStart.pos)
      player.vel = {x: 0, y: 0, z: 0}
      player.yaw = this.map.playerStart.yaw
      player.pitch = this.map.playerStart.pitch
      player.reloadTimer = 0
      player.fireCooldown = 0
      player.meleeCooldown = 0
      player.grenadeCooldown = 0
      player.aiming = false
      player.crouch = false
      player.moving = false
      player.sprinting = false
      player.grounded = true
      player.airbornePeakY = null
      player.firing = false
      player.lastFootstepAtTick = this.tick - 1000
      this.emit('player_respawn', {playerId: player.id, name: player.name})
    }
  }

  createTelemetry() {
    const shots = Object.fromEntries(Object.keys(this.weaponCatalog.weapons).map((id) => [id, {fired: 0, hits: 0}]))
    const telemetry = {
      playerPath: [],
      heatmap: {},
      damageTaken: [],
      kills: [],
      shots,
      reloads: [],
      healthArmor: [],
      purchases: [],
      units: {},
      unitTypes: Object.fromEntries(Object.keys(this.unitCatalog.types).map((id) => [id, {spawned: 0, killed: 0}])),
      timeToClear: null,
      appliedBudget: 0,
      knobs: {},
      counters: {kills: 0, damageEvents: 0, shots: 0, hits: 0},
      players: {},
      ...(this.sandboxEnabled() ? {sandbox: true} : {}),
    }
    for (const player of this.players.values()) telemetry.players[player.id] = this.createPlayerTelemetry(player)
    return telemetry
  }

  createPlayerTelemetry(player) {
    return {
      id: player.id,
      name: player.name,
      playerPath: [],
      heatmap: {},
      damageTaken: [],
      kills: [],
      shots: Object.fromEntries(Object.keys(this.weaponCatalog.weapons).map((id) => [id, {fired: 0, hits: 0}])),
      reloads: [],
      healthArmor: [],
      purchases: [],
      damageDealt: 0,
      counters: {kills: 0, damageEvents: 0, shots: 0, hits: 0},
      hp: player.hp,
      armor: player.armor,
      scrap: player.scrap,
      alive: player.alive,
      downed: player.downed,
    }
  }

  syncTelemetryPlayers() {
    for (const player of this.players.values()) {
      const stats = this.telemetry.players[player.id] ||= this.createPlayerTelemetry(player)
      Object.assign(stats, {
        id: player.id,
        name: player.name,
        hp: player.hp,
        armor: player.armor,
        scrap: player.scrap,
        alive: player.alive,
        downed: player.downed,
      })
    }
  }

  resetWaveTelemetry({budget = 0, knobs = {}} = {}) {
    this.telemetry = this.createTelemetry()
    this.telemetry.appliedBudget = budget
    this.telemetry.knobs = structuredClone(knobs)
    this.waveStartedAtTick = this.tick
  }

  sandboxEnabled() {
    return Boolean(this.sandbox.invulnerable || this.sandbox.infiniteScrap)
  }

  setSandbox({invulnerable = false, infiniteScrap = false} = {}) {
    this.sandbox = {invulnerable: Boolean(invulnerable), infiniteScrap: Boolean(infiniteScrap)}
    this.syncSandboxPlayer()
    if (this.telemetry) {
      if (this.sandboxEnabled()) this.telemetry.sandbox = true
      else delete this.telemetry.sandbox
    }
    return {...this.sandbox}
  }

  syncSandboxPlayer() {
    const player = this.players.get(this.hostPlayerId)
    if (!player) return
    if (this.sandbox.invulnerable) {
      player.hp = 100
      player.armor = 100
      player.alive = true
      player.downed = false
    }
    if (this.sandbox.infiniteScrap) player.scrap = 999999
  }

  traderViewModel(playerId = this.hostPlayerId) {
    const player = this.requirePlayer(playerId)
    let fillAmmo = 0
    for (const id of this.weaponCatalog.slots) {
      const ammo = player.ammo[id]
      const weapon = this.weaponCatalog.weapons[id]
      if (!ammo?.owned) continue
      const missing = Math.max(0, weapon.mag - ammo.mag) + Math.max(0, weapon.reserveMax - ammo.reserve)
      fillAmmo += Math.ceil(missing / weapon.mag) * weapon.ammoPrice
    }
    return {
      fillAmmo,
      fullArmor: Math.ceil(Math.max(0, 100 - player.armor) * 2),
      medkit: 100,
      error: null,
    }
  }

  purchase(item, playerId = this.hostPlayerId) {
    if (this.phase !== 'intermission' && !this.sandboxEnabled()) return {ok: false, error: 'Trader closed'}
    const player = this.players.get(playerId)
    if (!player) return {ok: false, error: `Unknown player: ${playerId}`}
    const quote = this.traderViewModel(playerId)
    let price = 0
    let name = item
    let apply = null

    if (this.weaponCatalog.slots.includes(item)) {
      const weapon = this.weaponCatalog.weapons[item]
      if (player.ammo[item].owned) return {ok: false, error: `${weapon.name} already owned`}
      price = weapon.price
      name = weapon.name
      apply = () => {
        player.ammo[item].owned = true
        player.ammo[item].mag = weapon.mag
      }
    } else if (String(item).startsWith('ammo:')) {
      const id = String(item).slice(5)
      const weapon = this.weaponCatalog.weapons[id]
      const ammo = player.ammo[id]
      if (!weapon?.mag || !ammo?.owned) return {ok: false, error: 'Weapon not owned'}
      if (ammo.reserve >= weapon.reserveMax) return {ok: false, error: 'Ammo already full'}
      price = weapon.ammoPrice
      name = `${weapon.name} ammo`
      apply = () => { ammo.reserve = Math.min(weapon.reserveMax, ammo.reserve + weapon.mag) }
    } else if (item === 'fill-ammo') {
      if (quote.fillAmmo <= 0) return {ok: false, error: 'Ammo already full'}
      price = quote.fillAmmo
      name = 'All ammunition'
      apply = () => {
        for (const id of this.weaponCatalog.slots) {
          const ammo = player.ammo[id]
          if (!ammo.owned) continue
          ammo.mag = this.weaponCatalog.weapons[id].mag
          ammo.reserve = this.weaponCatalog.weapons[id].reserveMax
        }
      }
    } else if (item === 'full-armor') {
      if (quote.fullArmor <= 0) return {ok: false, error: 'Armor already full'}
      price = quote.fullArmor
      name = 'Full body armor'
      apply = () => { player.armor = 100 }
    } else if (item === 'medkit') {
      if (player.hp >= 100) return {ok: false, error: 'Health already full'}
      price = quote.medkit
      name = 'Field medkit'
      apply = () => { player.hp = Math.min(100, player.hp + 50) }
    } else if (item === 'grenade') {
      if (player.grenades >= this.weaponCatalog.weapons.grenade.max) return {ok: false, error: 'Grenades already full'}
      price = this.weaponCatalog.weapons.grenade.price
      name = 'Frag grenade'
      apply = () => { player.grenades += 1 }
    } else {
      return {ok: false, error: `Unknown trader item: ${item}`}
    }

    const infiniteScrap = this.sandbox.infiniteScrap && player.id === this.hostPlayerId
    if (!infiniteScrap && player.scrap < price) return {ok: false, error: `Need ${price} Scrap`}
    if (!infiniteScrap) player.scrap -= price
    apply()
    if (infiniteScrap) player.scrap = 999999
    const purchase = {t: this.waveTime(), item: String(item), price, playerId: player.id}
    this.telemetry.purchases.push(purchase)
    this.playerTelemetry(player.id).purchases.push(structuredClone(purchase))
    this.emit('purchase', purchase)
    return {ok: true, item: String(item), name, price}
  }

  giveAllWeapons(playerId = this.hostPlayerId) {
    const player = this.requirePlayer(playerId)
    for (const id of this.weaponCatalog.slots) {
      const weapon = this.weaponCatalog.weapons[id]
      player.ammo[id].owned = true
      player.ammo[id].mag = weapon.mag
      player.ammo[id].reserve = weapon.reserveMax
    }
    player.grenades = this.weaponCatalog.weapons.grenade.max
    return true
  }

  requirePlayer(playerId) {
    const player = this.players.get(playerId)
    if (!player) throw new Error(`Unknown player: ${playerId}`)
    return player
  }

  playerTelemetry(playerId) {
    const player = this.requirePlayer(playerId)
    return this.telemetry.players[playerId] ||= this.createPlayerTelemetry(player)
  }

  configureMap(knobs = {}) {
    if (Array.isArray(knobs.gates)) this.mapState.gates = [...knobs.gates]
    for (const [id, state] of Object.entries(knobs.doors || {})) this.mapState.doors[id] = state
    for (const [id, state] of Object.entries(knobs.lights || {})) this.mapState.lights[id] = state
    if (Number.isInteger(knobs.fog)) this.mapState.fog = knobs.fog
    if (Array.isArray(knobs.hazards)) this.mapState.hazards = knobs.hazards.map((item) => ({...item}))
    if (knobs.break_flank_wall === true) this.mapState.flankWallBroken = true
    this.nav.rebuild(this.dynamicColliders())
    for (const unit of this.units) {
      unit.pathCache.path = null
      unit.pathCache.computedAtTick = -1000
    }
  }

  dynamicColliders() {
    const colliders = []
    for (const door of this.map.doors) {
      if (this.mapState?.doors?.[door.id] !== 'locked') continue
      colliders.push({id: `door:${door.id}`, center: door.pos, size: door.size, navBlock: true, blocksSight: true})
    }
    if (!this.mapState?.flankWallBroken) {
      colliders.push({
        id: `flank:${this.map.flankWall.id}`,
        center: this.map.flankWall.pos,
        size: this.map.flankWall.size,
        navBlock: true,
        blocksSight: true,
      })
    }
    return colliders
  }

  activeColliders() {
    return [...staticColliders(this.map), ...this.dynamicColliders()]
  }

  findPath(start, end) {
    return this.nav.findPath(start, end)
  }

  lineOfSight(from, to) {
    const length = distance(from, to)
    if (length <= 1e-6) return true
    const direction = {
      x: (to.x - from.x) / length,
      y: ((to.y || 0) - (from.y || 0)) / length,
      z: (to.z - from.z) / length,
    }
    for (const collider of this.activeColliders()) {
      if (collider.blocksSight === false) continue
      const hit = rayCollider(from, direction, collider, length)
      if (hit && hit.distance > 1e-4 && hit.distance < length - 1e-3) return false
    }
    return true
  }

  visionConeTest(unit, pos) {
    const type = this.unitCatalog.types[unit.type]
    const dist = planarDistance(unit.pos, pos)
    if (dist > type.visionRange) return false
    const targetYaw = yawTo(unit.pos, pos)
    return Math.abs(normalizeAngle(targetYaw - unit.yaw)) <= type.visionDeg * Math.PI / 360
  }

  spawnUnit(typeId, pos, {yaw = 0, rev, id} = {}) {
    const type = this.unitCatalog.types[typeId]
    if (!type) throw new Error(`Unknown unit type: ${typeId}`)
    if (this.aliveUnits.length >= this.maxAlive) return null
    const unitId = id || `${typeId}-${this.nextUnitId++}`
    if (this.unitById.has(unitId)) throw new Error(`Duplicate unit id: ${unitId}`)
    const resolvedRev = rev ?? (Object.hasOwn(this.brainOverrides, typeId) ? 1 : this.scriptRegistry.current(typeId)?.rev || 1)
    const spawnPos = copyVec(pos)
    if (type.flying) spawnPos.y = clamp(Number(pos?.y) || (type.altitudeMin + type.altitudeMax) / 2, type.altitudeMin, type.altitudeMax)
    else {
      const spawnSurface = this.nav.supportAt(spawnPos, spawnPos.y)
      if (spawnSurface) spawnPos.y = spawnSurface.y
    }
    const maxHp = round(type.hp * (this.scaling?.unitHealthMultiplier || 1), 4)
    const unit = {
      id: unitId,
      type: typeId,
      rev: resolvedRev,
      hp: maxHp,
      maxHp,
      pos: spawnPos,
      vel: {x: 0, y: 0, z: 0},
      yaw,
      alive: true,
      spawnedAt: this.time,
      spawnedAtTick: this.tick,
      diedAtTick: null,
      firstDamagedAtTick: null,
      lastDamagedAtTick: null,
      staggerTicks: 0,
      cooldown: 0,
      shotCooldown: 0,
      burstRemaining: 0,
      secondaryCooldown: 0,
      secondaryShotCooldown: 0,
      secondaryBurstRemaining: 0,
      spinUp: 0,
      playerVisible: false,
      targetPlayerId: null,
      reactionReadyTick: this.tick,
      lastKnownPlayer: null,
      lastSayTick: -1000,
      broadcasts: [],
      mem: {},
      intent: {moveTo: null, face: null, aimAt: null, fire: false, melee: false, crouch: false},
      pathCache: {targetKey: '', computedAtTick: -1000, path: null, index: 0},
      brain: null,
      brainPhase: this.units.length % 6,
    }
    this.units.push(unit)
    this.unitById.set(unit.id, unit)
    this.telemetry.units[unit.id] = {
      type: typeId,
      spawnedAt: this.time,
      lifetime: 0,
      causeOfDeath: null,
      distanceTraveled: 0,
      shotsFired: 0,
      damageDealt: 0,
      scriptErrors: 0,
      fuelExhausted: 0,
    }
    this.telemetry.unitTypes[typeId] ??= {spawned: 0, killed: 0}
    this.telemetry.unitTypes[typeId].spawned += 1
    this.emit('unit_spawn', {unitId: unit.id, unitType: unit.type, rev: unit.rev})
    try {
      unit.brain = this.createUnitBrain(typeId, unit.rev)
    } catch (error) {
      unit.brain = DEFAULT_BRAINS[typeId]
      this.telemetry.units[unit.id].scriptErrors += 1
      this.emit('script_error', {
        unitId: unit.id,
        unitType: unit.type,
        rev: unit.rev,
        message: String(error?.message || error),
      })
    }
    return unit
  }

  navSurfacePoint(origin, direction, maxDistance = 120) {
    const length = Math.hypot(direction?.x || 0, direction?.y || 0, direction?.z || 0)
    if (length <= 1e-9) return null
    const ray = {x: direction.x / length, y: direction.y / length, z: direction.z / length}
    let closest = null
    for (const collider of this.activeColliders()) {
      if (!this.nav.isSurfaceCollider(collider.id)) continue
      const hit = rayCollider(origin, ray, collider, maxDistance)
      if (!hit || hit.normal.y < 0.5 || (closest && hit.distance >= closest.distance)) continue
      closest = hit
    }
    return closest ? addScaled(origin, ray, closest.distance) : null
  }

  clearUnits() {
    const count = this.units.length
    for (const unit of this.units) unit.brain?.destroy?.()
    this.units.length = 0
    this.unitById.clear()
    this.projectiles = this.projectiles.filter((projectile) => projectile.owner !== 'unit')
    return count
  }

  killAllUnits() {
    let count = 0
    for (const unit of this.aliveUnits) {
      this.damageUnit(unit.id, unit.hp, {source: 'sandbox', weapon: 'sandbox'})
      count += 1
    }
    return count
  }

  createUnitBrain(typeId, rev) {
    if (Object.hasOwn(this.brainOverrides, typeId)) return this.brainOverrides[typeId]
    return this.scriptRegistry.createBrain(typeId, rev).brain
  }

  step(rawInputs = EMPTY_INPUTS) {
    const sandboxError = sandboxLoadError()
    if (sandboxError) throw sandboxError
    if (!sandboxReady()) return this
    this.syncSandboxPlayer()
    const inputsByPlayer = normalizeInputsBundle(rawInputs, this.players, this.previousInputsByPlayer, this.hostPlayerId)
    this.replay.push(structuredClone(inputsByPlayer))
    this.cleanupSignals()
    for (const player of this.players.values()) {
      this.updatePlayer(player, inputsByPlayer[player.id], this.previousInputsByPlayer.get(player.id) || EMPTY_INPUTS)
    }
    if (this.projectiles.length > 0) this.updateProjectiles()
    this.lastBrainTickCount = 0
    const aliveUnits = this.aliveUnits
    if (this.tick % 6 === 0) aliveUnits.forEach((unit, index) => { unit.brainPhase = index % 6 })
    const maxBrainTicks = Math.max(1, Math.ceil(aliveUnits.length / 4))
    const brainPhase = this.tick % 6
    for (const unit of aliveUnits) {
      if (!unit.alive || unit.brainPhase !== brainPhase) continue
      if (this.lastBrainTickCount >= maxBrainTicks) break
      this.tickBrain(unit)
      this.lastBrainTickCount += 1
    }
    for (const unit of this.units) if (unit.alive) this.updateUnit(unit)
    this.updateHazards()
    this.syncSandboxPlayer()
    this.sampleTelemetry()
    this.lastInputsBundle = structuredClone(inputsByPlayer)
    for (const [playerId, inputs] of Object.entries(inputsByPlayer)) this.previousInputsByPlayer.set(playerId, inputs)
    this.tick += 1
    return this
  }

  updatePlayer(player, inputs, previousInputs) {
    player.aiming = false
    player.firing = false
    player.yaw = inputs.yaw
    player.pitch = clamp(inputs.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
    if (!player.alive) {
      player.crouch = false
      player.moving = false
      player.sprinting = false
      return
    }

    if (inputs.switchTo) this.switchWeapon(inputs.switchTo, player.id)
    player.fireCooldown = Math.max(0, player.fireCooldown - TICK_SECONDS)
    player.meleeCooldown = Math.max(0, player.meleeCooldown - TICK_SECONDS)
    player.grenadeCooldown = Math.max(0, player.grenadeCooldown - TICK_SECONDS)
    if (player.reloadTimer > 0) {
      player.reloadTimer = Math.max(0, player.reloadTimer - TICK_SECONDS)
      if (player.reloadTimer === 0) this.finishReload(player.id)
    }

    if (inputs.reload && !previousInputs.reload) this.startReload(player.id)
    player.aiming = inputs.aim && player.reloadTimer === 0
      && Boolean(this.weaponCatalog.weapons[player.activeWeapon]?.mag)
      && !inputs.melee && !inputs.grenade && player.meleeCooldown === 0 && player.grenadeCooldown === 0
    this.movePlayer(player, inputs, {previousInputs})
    if (inputs.melee && !previousInputs.melee) this.playerMelee(player.id)
    if (inputs.grenade && !previousInputs.grenade) this.throwGrenade(player.id)
    if (inputs.fire) player.firing = this.playerFire(player.id)
  }

  movePlayer(player, inputs, {emitSound = true, previousInputs = EMPTY_INPUTS} = {}) {
    let x = clamp(inputs.move.x, -1, 1)
    let z = clamp(inputs.move.z, -1, 1)
    const magnitude = Math.hypot(x, z)
    if (magnitude > 1) {
      x /= magnitude
      z /= magnitude
    }
    const moving = magnitude > 0.01
    let grounded = Boolean(this.playerSupportAt(player.pos, player.pos.y, {
      radius: PLAYER_RADIUS,
      maxAbove: SURFACE_EPSILON,
      maxBelow: SURFACE_EPSILON,
    })) && player.vel.y <= 0 && player.airbornePeakY == null
    const wasGrounded = grounded
    player.crouch = grounded && (inputs.crouch || !this.playerHasHeadClearance(player.pos, PLAYER_HEIGHT))
    const jumping = grounded && inputs.jump && !previousInputs.jump && this.playerHasJumpClearance(player.pos)
    if (jumping) {
      player.crouch = false
      player.vel.y = JUMP_VELOCITY
      player.airbornePeakY = player.pos.y
      grounded = false
    }
    const canSprint = wasGrounded
      ? inputs.sprint && moving && !player.aiming && !player.crouch && player.sprintStamina > 0
      : Boolean(player.sprinting)
    if (wasGrounded) {
      player.sprinting = canSprint
      if (canSprint) player.sprintStamina = Math.max(0, player.sprintStamina - TICK_SECONDS)
      else player.sprintStamina = Math.min(6, player.sprintStamina + TICK_SECONDS * 1.5)
    }
    const speed = (player.crouch ? 2.6 : canSprint ? 7.5 : 5)
      * (player.aiming ? (this.weaponCatalog.aim || weaponsData.aim).moveMultiplier : 1)
    const forwardX = Math.sin(player.yaw)
    const forwardZ = Math.cos(player.yaw)
    const rightX = -Math.cos(player.yaw)
    const rightZ = Math.sin(player.yaw)
    const desiredX = (rightX * x + forwardX * z) * speed
    const desiredZ = (rightZ * x + forwardZ * z) * speed
    if (grounded || jumping) {
      player.vel.x = desiredX
      player.vel.z = desiredZ
    } else if (moving) {
      const deltaX = desiredX - player.vel.x
      const deltaZ = desiredZ - player.vel.z
      const delta = Math.hypot(deltaX, deltaZ)
      const amount = Math.min(delta, AIR_STEERING_ACCELERATION * TICK_SECONDS)
      if (delta > 0) {
        player.vel.x += deltaX / delta * amount
        player.vel.z += deltaZ / delta * amount
      }
    }
    player.moving = Math.hypot(player.vel.x, player.vel.z) > 0.01
    const bodyHeight = player.crouch ? CROUCH_HEIGHT : PLAYER_HEIGHT
    const nextX = clamp(player.pos.x + player.vel.x * TICK_SECONDS, this.map.bounds.minX + PLAYER_RADIUS, this.map.bounds.maxX - PLAYER_RADIUS)
    const nextZ = clamp(player.pos.z + player.vel.z * TICK_SECONDS, this.map.bounds.minZ + PLAYER_RADIUS, this.map.bounds.maxZ - PLAYER_RADIUS)
    grounded = this.movePlayerAxis(player, 'x', nextX, bodyHeight, grounded)
    grounded = this.movePlayerAxis(player, 'z', nextZ, bodyHeight, grounded)
    grounded = this.updatePlayerVertical(player, bodyHeight, grounded, {emitEvent: emitSound})
    player.grounded = grounded
    if (moving && grounded) {
      const interval = canSprint ? 15 : 24
      if (this.tick - player.lastFootstepAtTick >= interval) {
        player.lastFootstepAtTick = this.tick
        if (emitSound) this.addSound('footstep', player.pos, undefined, player.id)
      }
    }
  }

  movePlayerAxis(player, axis, value, bodyHeight, grounded) {
    const candidate = {...player.pos, [axis]: value}
    const support = grounded ? this.playerSupportAt(candidate, player.pos.y, {radius: PLAYER_RADIUS}) : null
    if (support) candidate.y = support.y
    if (this.positionBlocked(candidate, PLAYER_RADIUS, bodyHeight) || !this.playerHasHeadClearance(candidate, bodyHeight, support)) {
      player.vel[axis] = 0
      return grounded
    }
    player.pos[axis] = value
    if (!support) return false
    player.pos.y = support.y
    player.vel.y = 0
    return true
  }

  updatePlayerVertical(player, bodyHeight, grounded, {emitEvent = true} = {}) {
    if (grounded) {
      player.vel.y = 0
      player.airbornePeakY = null
      return true
    }
    const fromY = player.pos.y
    player.airbornePeakY = Math.max(player.airbornePeakY ?? fromY, fromY)
    player.vel.y = Math.max(-30, player.vel.y - (this.map.walkable?.gravity ?? 18) * TICK_SECONDS)
    let toY = fromY + player.vel.y * TICK_SECONDS
    if (player.vel.y > 0) {
      const ceiling = this.playerCeilingBetween(player.pos, fromY + bodyHeight, toY + bodyHeight)
      if (ceiling !== null) {
        toY = ceiling - bodyHeight
        player.vel.y = 0
      }
    } else {
      const landing = this.playerLandingSurface(player.pos, fromY, toY, PLAYER_RADIUS)
      if (landing && this.playerHasHeadClearance({...player.pos, y: landing.y}, bodyHeight, landing)) {
        const fallHeight = Math.max(0, (player.airbornePeakY ?? fromY) - landing.y)
        player.pos.y = landing.y
        player.vel.y = 0
        player.airbornePeakY = null
        if (emitEvent) this.emit('land', {playerId: player.id, pos: copyVec(player.pos), fallHeight: round(fallHeight, 3)})
        return true
      }
    }
    player.pos.y = toY
    player.airbornePeakY = Math.max(player.airbornePeakY, toY)
    return false
  }

  playerSupportAt(pos, currentY, {radius = 0, maxAbove = this.nav.maxStep, maxBelow = this.nav.maxStep} = {}) {
    let best = this.nav.supportAt(pos, currentY, {radius, maxAbove, maxBelow})
    for (const collider of this.activeColliders()) {
      if (this.nav.isSurfaceCollider(collider.id) || this.nav.isMovementHole(collider.id, pos, radius)) continue
      for (const {top: y} of colliderSurfacesAt(pos, collider, radius)) {
        if (y > currentY + maxAbove + SURFACE_EPSILON || y < currentY - maxBelow - SURFACE_EPSILON) continue
        if (!best || y > best.y) best = {id: collider.id, colliderId: collider.id, level: collider.kind, y}
      }
    }
    return best
  }

  playerLandingSurface(pos, fromY, toY, radius = 0) {
    let best = this.nav.landingSurface(pos, fromY, toY, radius)
    for (const collider of this.activeColliders()) {
      if (this.nav.isSurfaceCollider(collider.id) || this.nav.isMovementHole(collider.id, pos, radius)) continue
      for (const {top: y} of colliderSurfacesAt(pos, collider, radius)) {
        if (y > fromY + SURFACE_EPSILON || y < toY - SURFACE_EPSILON) continue
        if (!best || y > best.y) best = {id: collider.id, colliderId: collider.id, level: collider.kind, y}
      }
    }
    return best
  }

  playerHasJumpClearance(pos) {
    if (!this.playerHasHeadClearance(pos, PLAYER_HEIGHT)) return false
    const headY = pos.y + PLAYER_HEIGHT
    return this.playerCeilingBetween(pos, headY, headY + JUMP_HEAD_CLEARANCE) === null
  }

  playerCeilingBetween(pos, fromHeadY, toHeadY) {
    let ceiling = null
    for (const collider of this.activeColliders()) {
      if (collider.kind !== 'floor' || this.nav.isMovementHole(collider.id, pos, PLAYER_RADIUS)) continue
      for (const {bottom} of colliderSurfacesAt(pos, collider, PLAYER_RADIUS)) {
        if (bottom < fromHeadY - SURFACE_EPSILON || bottom > toHeadY + SURFACE_EPSILON) continue
        if (ceiling === null || bottom < ceiling) ceiling = bottom
      }
    }
    return ceiling
  }

  playerHasHeadClearance(pos, bodyHeight, support = null) {
    for (const collider of this.activeColliders()) {
      if (collider.kind !== 'floor' || collider.id === support?.colliderId) continue
      if (this.nav.isMovementHole(collider.id, pos, PLAYER_RADIUS)) continue
      for (const {bottom, top} of colliderSurfacesAt(pos, collider, PLAYER_RADIUS)) {
        if (top > pos.y + SURFACE_EPSILON && bottom < pos.y + bodyHeight - SURFACE_EPSILON) return false
      }
    }
    return true
  }

  positionBlocked(pos, radius = 0, height = PLAYER_HEIGHT) {
    return this.activeColliders().some((collider) => {
      if (!collider.navBlock) return false
      if (collider.kind === 'stair' && this.nav.isSurfaceCollider(collider.id)) return false
      return colliderSurfacesAt(pos, collider, radius).some(({bottom, top}) => (
        top > (pos.y || 0) + SURFACE_EPSILON && bottom < (pos.y || 0) + height - SURFACE_EPSILON
      ))
    })
  }

  predictPlayer(playerId, rawInputs = EMPTY_INPUTS) {
    const player = this.requirePlayer(playerId)
    const inputs = normalizeInputs(rawInputs)
    player.aiming = false
    player.firing = false
    player.yaw = inputs.yaw
    player.pitch = clamp(inputs.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
    if (player.alive) {
      player.aiming = inputs.aim && player.reloadTimer === 0
        && Boolean(this.weaponCatalog.weapons[player.activeWeapon]?.mag)
        && !inputs.melee && !inputs.grenade && player.meleeCooldown === 0 && player.grenadeCooldown === 0
      const previousInputs = this.previousInputsByPlayer.get(player.id) || EMPTY_INPUTS
      this.movePlayer(player, inputs, {emitSound: false, previousInputs})
      this.previousInputsByPlayer.set(player.id, inputs)
    } else {
      player.moving = false
      player.sprinting = false
    }
    return structuredClone(player)
  }

  switchWeapon(requested, playerId = this.hostPlayerId) {
    const player = this.requirePlayer(playerId)
    if (requested === 'next' || requested === 'previous') {
      const direction = requested === 'next' ? 1 : -1
      const start = Math.max(0, player.weaponSlots.indexOf(player.activeWeapon))
      for (let offset = 1; offset <= player.weaponSlots.length; offset += 1) {
        const index = (start + direction * offset + player.weaponSlots.length) % player.weaponSlots.length
        const candidate = player.weaponSlots[index]
        if (!player.ammo[candidate]?.owned) continue
        requested = candidate
        break
      }
    }
    const id = typeof requested === 'number' ? player.weaponSlots[requested - 1] : requested
    if (!id || !player.ammo[id]?.owned) return false
    player.activeWeapon = id
    player.reloadTimer = 0
    return true
  }

  startReload(playerId = this.hostPlayerId) {
    const player = this.requirePlayer(playerId)
    const id = player.activeWeapon
    const ammo = player.ammo[id]
    const weapon = this.weaponCatalog.weapons[id]
    if (!weapon?.mag || !ammo || player.reloadTimer > 0 || ammo.mag >= weapon.mag || ammo.reserve <= 0) return false
    player.reloadTimer = weapon.reloadSeconds
    player.aiming = false
    const reload = {
      t: this.waveTime(),
      weapon: id,
      magazineFraction: round(ammo.mag / weapon.mag, 4),
      playerId: player.id,
    }
    this.telemetry.reloads.push(reload)
    this.playerTelemetry(player.id).reloads.push(structuredClone(reload))
    this.addSound('reload', player.pos, undefined, player.id)
    this.emit('reload', reload)
    return true
  }

  finishReload(playerId = this.hostPlayerId) {
    const player = this.requirePlayer(playerId)
    const id = player.activeWeapon
    const ammo = player.ammo[id]
    const weapon = this.weaponCatalog.weapons[id]
    if (!ammo || !weapon?.mag) return
    const rounds = Math.min(weapon.mag - ammo.mag, ammo.reserve)
    ammo.mag += rounds
    ammo.reserve -= rounds
    this.emit('reload_complete', {playerId: player.id, weapon: id, mag: ammo.mag, reserve: ammo.reserve})
  }

  get playerSpread() {
    return this.playerSpreadFor(this.hostPlayerId)
  }

  playerSpreadFor(playerId = this.hostPlayerId) {
    const player = this.requirePlayer(playerId)
    const base = this.weaponCatalog.weapons[player.activeWeapon]?.spreadDeg || 0
    return base * (player.aiming && player.reloadTimer === 0
      ? (this.weaponCatalog.aim || weaponsData.aim).spreadMultiplier : 1)
  }

  playerFire(playerId = this.hostPlayerId) {
    const player = this.requirePlayer(playerId)
    const id = player.activeWeapon
    const weapon = this.weaponCatalog.weapons[id]
    const ammo = player.ammo[id]
    if (!weapon || !ammo || player.fireCooldown > 0 || player.reloadTimer > 0 || ammo.mag <= 0) return false
    ammo.mag -= 1
    player.fireCooldown = 1 / weapon.rate
    const origin = {...player.pos, y: player.pos.y + (player.crouch ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT)}
    if (weapon.projectile === 'shell') {
      const spread = this.playerSpreadFor(player.id) * Math.PI / 180
      const direction = directionFromAngles(
        player.yaw + this.rng.range(-spread, spread),
        player.pitch + this.rng.range(-spread, spread),
      )
      const projectile = this.spawnProjectile({
        type: 'shell',
        owner: 'player',
        ownerId: player.id,
        pos: origin,
        vel: scaleVec(direction, weapon.projectileSpeed || LAUNCHER_PROJECTILE_SPEED),
        damage: weapon.damage,
        splash: weapon.radius,
        weapon: id,
        life: 5,
        armingDistance: weapon.armingDistance || 0,
        radius: 0.09,
      })
      this.recordShot(id, false, player.id)
      this.addSound('gunshot', player.pos, undefined, player.id)
      this.emit('shot', {by: player.id, playerId: player.id, weapon: id, hit: false, headshot: false, killed: false, unitId: null, origin, projectileId: projectile.id})
      return true
    }
    let anyHit = false
    let headshot = false
    let killed = false
    let hitUnitId = null
    for (let pellet = 0; pellet < (weapon.pellets || 1); pellet += 1) {
      const spread = this.playerSpreadFor(player.id) * Math.PI / 180
      const yaw = player.yaw + this.rng.range(-spread, spread)
      const pitch = player.pitch + this.rng.range(-spread, spread)
      const result = this.hitscan({origin, direction: directionFromAngles(yaw, pitch), weaponId: id, damage: weapon.damage, source: 'player', playerId: player.id})
      if (result.kind === 'unit') {
        anyHit = true
        const results = result.hits || [result]
        headshot ||= results.some((hit) => hit.headshot)
        killed ||= results.some((hit) => hit.killed)
        hitUnitId ||= results[0]?.unitId || null
      }
    }
    this.recordShot(id, anyHit, player.id)
    this.addSound('gunshot', player.pos, undefined, player.id)
    this.emit('shot', {by: player.id, playerId: player.id, weapon: id, hit: anyHit, headshot, killed, unitId: hitUnitId, origin})
    return true
  }

  playerMelee(playerId = this.hostPlayerId) {
    const player = this.requirePlayer(playerId)
    const weapon = this.weaponCatalog.weapons.knife
    if (player.meleeCooldown > 0) return false
    player.meleeCooldown = 1 / weapon.rate
    const forward = directionFromAngles(player.yaw, 0)
    let best = null
    for (const unit of this.units) {
      if (!unit.alive || planarDistance(player.pos, unit.pos) > weapon.range) continue
      const angle = Math.abs(normalizeAngle(yawTo(player.pos, unit.pos) - player.yaw))
      if (angle > Math.PI / 4) continue
      if (!best || planarDistance(player.pos, unit.pos) < best.distance) best = {unit, distance: planarDistance(player.pos, unit.pos)}
    }
    const hit = Boolean(best)
    if (best) this.damageUnit(best.unit.id, weapon.damage, {source: 'player', playerId: player.id, weapon: 'knife', point: {
      x: player.pos.x + forward.x * best.distance,
      y: player.pos.y + 1,
      z: player.pos.z + forward.z * best.distance,
    }})
    this.recordShot('knife', hit, player.id)
    this.addSound('gunshot', player.pos, 8, player.id)
    this.emit('shot', {by: player.id, playerId: player.id, weapon: 'knife', hit, headshot: false, killed: Boolean(best && !best.unit.alive), unitId: best?.unit.id || null})
    return true
  }

  throwGrenade(playerId = this.hostPlayerId) {
    const player = this.requirePlayer(playerId)
    if (player.grenades <= 0 || player.grenadeCooldown > 0) return false
    player.grenades -= 1
    player.grenadeCooldown = 1
    const radius = 0.09
    const speed = 12
    const launchPitch = clamp(player.pitch + 20 * Math.PI / 180, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
    const direction = directionFromAngles(player.yaw, launchPitch)
    const pos = {
      x: player.pos.x,
      y: player.pos.y + (player.crouch ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT),
      z: player.pos.z,
    }
    const projectile = {
      id: `projectile-${this.nextProjectileId++}`,
      type: 'grenade',
      owner: 'player',
      ownerId: player.id,
      playerId: player.id,
      pos,
      vel: {x: direction.x * speed, y: direction.y * speed, z: direction.z * speed},
      born: this.tick,
      damage: this.weaponCatalog.weapons.grenade.damage,
      splash: this.weaponCatalog.weapons.grenade.radius,
      weapon: 'grenade',
      radius,
      restitution: 0.35,
      friction: 0.28,
      spawnTick: this.tick,
      detonateTick: this.tick + Math.round(2.5 * TICK_RATE),
      grounded: false,
    }
    this.projectiles.push(projectile)
    this.emit('grenade_thrown', {
      by: player.id,
      playerId: player.id,
      projectileId: projectile.id,
      pos: projectile.pos,
      velocity: projectile.vel,
      fuse: 2.5,
    })
    return true
  }

  updateProjectiles() {
    const active = []
    const colliders = this.activeColliders()
    for (const projectile of this.projectiles) {
      if (projectile.type === 'grenade') {
        if (this.tick >= projectile.detonateTick) this.detonateGrenade(projectile)
        else {
          this.updateGrenadeProjectile(projectile, colliders)
          active.push(projectile)
        }
        continue
      }
      if (this.tick - projectile.born >= Math.ceil((projectile.life || 3) * TICK_RATE)) continue
      if (projectile.type === 'shell') projectile.vel.y -= (this.map.walkable?.gravity ?? 18) * TICK_SECONDS
      const movement = scaleVec(projectile.vel, TICK_SECONDS)
      const remainingRange = projectile.maxDistance == null ? Infinity : projectile.maxDistance - (projectile.distanceTraveled || 0)
      const movementLength = vectorLength(movement)
      const segmentLength = Math.min(movementLength, remainingRange)
      if (segmentLength <= 1e-9) continue
      const direction = scaleVec(movement, 1 / movementLength)
      const collision = this.projectileCollision(projectile, direction, segmentLength, colliders)
      const travel = collision?.distance ?? segmentLength
      projectile.pos.x += direction.x * travel
      projectile.pos.y += direction.y * travel
      projectile.pos.z += direction.z * travel
      projectile.distanceTraveled = (projectile.distanceTraveled || 0) + travel
      if (!collision) {
        if (projectile.maxDistance == null || projectile.distanceTraveled < projectile.maxDistance - 1e-9) active.push(projectile)
        continue
      }
      const targetId = collision.target?.id || null
      this.emit('projectile_hit', {
        id: projectile.id,
        projectileType: projectile.type,
        pos: projectile.pos,
        normal: collision.normal,
        targetId,
      })
      if (projectile.splash > 0) {
        if (collision.armed !== false) this.detonateProjectile(projectile, collision.target)
      } else if (projectile.owner === 'unit' && collision.target?.kind === 'player') {
        const unit = this.unitById.get(projectile.ownerId)
        const dealt = this.damagePlayer(projectile.damage, unit || {id: projectile.ownerId, type: 'unit', pos: projectile.pos}, collision.target.id)
        if (unit && this.telemetry.units[unit.id]) this.telemetry.units[unit.id].damageDealt += dealt
        this.recordProjectileHit(`unit:${unit?.type || 'unknown'}`, dealt > 0)
      } else if (projectile.owner === 'player' && collision.target?.kind === 'unit') {
        const result = this.damageUnit(collision.target.id, projectile.damage, {
          source: 'player',
          playerId: projectile.ownerId,
          weapon: projectile.weapon,
          point: projectile.pos,
          normal: collision.normal,
          direction,
          part: collision.part,
        })
        this.recordProjectileHit(projectile.weapon, result.damage > 0, projectile.ownerId)
      }
    }
    this.projectiles = active
  }

  spawnProjectile({type, owner, ownerId, pos, vel, damage, splash = 0, weapon = null, life = 3, armingDistance = 0, radius = 0.04, maxDistance = null}) {
    const projectile = {
      id: `projectile-${this.nextProjectileId++}`,
      type,
      owner,
      ownerId,
      pos: copyVec(pos),
      vel: copyVec(vel),
      born: this.tick,
      damage,
      splash,
      weapon,
      life,
      armingDistance,
      distanceTraveled: 0,
      radius,
      maxDistance,
    }
    this.projectiles.push(projectile)
    this.emit('projectile_fired', {
      id: projectile.id,
      projectileType: type,
      ownerId,
      pos: projectile.pos,
      vel: projectile.vel,
      weapon,
    })
    return projectile
  }

  projectileCollision(projectile, direction, maxDistance, colliders) {
    let closest = null
    const radius = projectile.radius || 0.04
    const movement = scaleVec(direction, maxDistance)
    const mapHit = this.sweepGrenade(projectile.pos, movement, radius, colliders)
    if (mapHit) closest = {
      distance: mapHit.fraction * maxDistance,
      normal: mapHit.normal,
      target: null,
    }

    if (projectile.owner === 'unit') {
      for (const player of this.livingPlayers) {
        const height = player.crouch ? CROUCH_HEIGHT : PLAYER_HEIGHT
        const hitDistance = rayVerticalCapsule(projectile.pos, direction, player.pos, height, PLAYER_RADIUS + radius, maxDistance)
        if (hitDistance === null || (closest && hitDistance >= closest.distance)) continue
        const hitPos = addScaled(projectile.pos, direction, hitDistance)
        closest = {
          distance: hitDistance,
          normal: capsuleNormal(hitPos, player.pos, height, PLAYER_RADIUS),
          target: {kind: 'player', id: player.id},
        }
      }
    } else if (projectile.owner === 'player') {
      for (const unit of this.units) {
        if (!unit.alive) continue
        const spec = this.unitCatalog.types[unit.type]
        const hit = sweepSphereCollider(projectile.pos, movement, radius, this.unitHitCollider(unit, spec))
        const hitDistance = hit?.fraction * maxDistance
        if (!hit || (closest && hitDistance >= closest.distance)) continue
        closest = {
          distance: hitDistance,
          normal: hit.normal,
          target: {kind: 'unit', id: unit.id},
          part: unitPartForHitVolume(spec, hit.part),
        }
      }
    }
    if (closest && projectile.armingDistance > 0) {
      closest.armed = (projectile.distanceTraveled || 0) + closest.distance >= projectile.armingDistance
    }
    return closest
  }

  detonateProjectile(projectile, directTarget = null) {
    const center = copyVec(projectile.pos)
    const hits = []
    let enemyHit = false
    if (projectile.owner === 'player') {
      for (const unit of this.units) {
        if (!unit.alive) continue
        const dist = directTarget?.kind === 'unit' && directTarget.id === unit.id
          ? 0
          : distance(center, {...unit.pos, y: unit.pos.y + this.unitCatalog.types[unit.type].height / 2})
        if (dist > projectile.splash) continue
        const result = this.damageUnit(unit.id, projectile.damage * Math.max(0, 1 - dist / projectile.splash), {
          source: 'player',
          playerId: projectile.ownerId,
          weapon: projectile.weapon,
          point: center,
          normal: normalizedVector({x: unit.pos.x - center.x, y: unit.pos.y - center.y, z: unit.pos.z - center.z}),
          direction: normalizedVector(projectile.vel),
          distance: dist,
        })
        if (result.damage <= 0) continue
        enemyHit = true
        hits.push({kind: 'unit', id: unit.id, damage: round(result.damage, 4), killed: result.killed})
      }
      this.recordProjectileHit(projectile.weapon, enemyHit, projectile.ownerId)
    } else {
      const owner = this.unitById.get(projectile.ownerId)
      let totalDamage = 0
      for (const player of this.livingPlayers) {
        const dist = directTarget?.kind === 'player' && directTarget.id === player.id
          ? 0
          : distance(center, {...player.pos, y: player.pos.y + PLAYER_HEIGHT / 2})
        if (dist > projectile.splash) continue
        const damage = this.damagePlayer(projectile.damage * Math.max(0, 1 - dist / projectile.splash), owner || {id: projectile.ownerId, type: 'hktank', pos: center}, player.id)
        if (damage <= 0) continue
        totalDamage += damage
        hits.push({kind: 'player', id: player.id, damage: round(damage, 4), killed: !player.alive})
      }
      if (owner && this.telemetry.units[owner.id]) this.telemetry.units[owner.id].damageDealt += totalDamage
      this.recordProjectileHit(`unit:${owner?.type || 'hktank'}`, hits.length > 0)
    }
    this.addSound('explosion', center, undefined, projectile.owner === 'player' ? projectile.ownerId : null)
    this.emit('explosion', {
      by: projectile.ownerId,
      playerId: projectile.owner === 'player' ? projectile.ownerId : null,
      projectileId: projectile.id,
      pos: center,
      radius: projectile.splash,
      hit: hits.length > 0,
      hits,
    })
  }

  updateGrenadeProjectile(projectile, colliders) {
    const radius = projectile.radius || 0.09
    const restitution = Number.isFinite(projectile.restitution) ? projectile.restitution : 0.35
    const friction = Number.isFinite(projectile.friction) ? projectile.friction : 0.28
    const support = projectile.grounded
      ? colliders.find((collider) => {
        return colliderSurfacesAt(projectile.pos, collider, radius)
          .some(({top}) => Math.abs(projectile.pos.y - radius - top) <= 0.012)
      })
      : null
    if (!support) {
      projectile.grounded = false
      projectile.vel.y -= (this.map.walkable?.gravity ?? 18) * TICK_SECONDS
    } else {
      const surface = colliderSurfacesAt(projectile.pos, support, radius)
        .sort((a, b) => Math.abs(projectile.pos.y - radius - a.top) - Math.abs(projectile.pos.y - radius - b.top))[0]
      projectile.pos.y = surface.top + radius
      projectile.vel.y = 0
      const planarSpeed = Math.hypot(projectile.vel.x, projectile.vel.z)
      const slowed = Math.max(0, planarSpeed - 3.2 * TICK_SECONDS)
      const scale = planarSpeed > 1e-9 ? slowed / planarSpeed : 0
      projectile.vel.x *= scale
      projectile.vel.z *= scale
    }

    let remaining = TICK_SECONDS
    for (let collisionCount = 0; remaining > 1e-7 && collisionCount < 4; collisionCount += 1) {
      const movement = {
        x: projectile.vel.x * remaining,
        y: projectile.vel.y * remaining,
        z: projectile.vel.z * remaining,
      }
      if (Math.hypot(movement.x, movement.y, movement.z) <= 1e-9) break
      const collision = this.sweepGrenade(projectile.pos, movement, radius, colliders)
      if (!collision) {
        projectile.pos.x += movement.x
        projectile.pos.y += movement.y
        projectile.pos.z += movement.z
        break
      }

      projectile.pos.x += movement.x * collision.fraction
      projectile.pos.y += movement.y * collision.fraction
      projectile.pos.z += movement.z * collision.fraction
      const intoSurface = projectile.vel.x * collision.normal.x
        + projectile.vel.y * collision.normal.y
        + projectile.vel.z * collision.normal.z
      if (intoSurface >= 0) {
        remaining *= Math.max(0, 1 - collision.fraction)
        continue
      }

      const impactSpeed = -intoSurface
      const impulse = (1 + restitution) * intoSurface
      projectile.vel.x -= collision.normal.x * impulse
      projectile.vel.y -= collision.normal.y * impulse
      projectile.vel.z -= collision.normal.z * impulse
      const normalSpeed = projectile.vel.x * collision.normal.x
        + projectile.vel.y * collision.normal.y
        + projectile.vel.z * collision.normal.z
      const keep = 1 - friction
      projectile.vel.x = collision.normal.x * normalSpeed + (projectile.vel.x - collision.normal.x * normalSpeed) * keep
      projectile.vel.y = collision.normal.y * normalSpeed + (projectile.vel.y - collision.normal.y * normalSpeed) * keep
      projectile.vel.z = collision.normal.z * normalSpeed + (projectile.vel.z - collision.normal.z * normalSpeed) * keep
      if (collision.normal.y > 0.5 && projectile.vel.y < 0.72) {
        projectile.vel.y = 0
        projectile.grounded = true
      } else projectile.grounded = false
      if (impactSpeed >= 0.8) {
        this.emit('grenade_bounce', {
          by: projectile.playerId,
          playerId: projectile.playerId,
          projectileId: projectile.id,
          colliderId: collision.collider.id,
          pos: projectile.pos,
          speed: round(impactSpeed, 4),
        })
      }
      projectile.pos.x += collision.normal.x * 1e-5
      projectile.pos.y += collision.normal.y * 1e-5
      projectile.pos.z += collision.normal.z * 1e-5
      remaining *= Math.max(0, 1 - collision.fraction)
    }

    if (projectile.grounded && Math.hypot(projectile.vel.x, projectile.vel.z) < 0.04) {
      projectile.vel.x = 0
      projectile.vel.z = 0
    }
  }

  sweepGrenade(origin, movement, radius, colliders) {
    let closest = null
    for (const collider of colliders) {
      const collision = sweepSphereCollider(origin, movement, radius, collider)
      if (collision && (!closest || collision.fraction < closest.fraction)) closest = collision
    }
    return closest
  }

  detonateGrenade(projectile) {
    const weapon = this.weaponCatalog.weapons.grenade
    const center = copyVec(projectile.pos)
    const hits = []
    let unitHit = false
    for (const unit of this.units) {
      if (!unit.alive) continue
      const dist = distance(center, unit.pos)
      if (dist > weapon.radius) continue
      const result = this.damageUnit(unit.id, weapon.damage * (1 - dist / weapon.radius), {
        source: 'player',
        playerId: projectile.playerId,
        weapon: 'grenade',
        point: center,
        distance: dist,
      })
      if (result.damage <= 0) continue
      unitHit = true
      hits.push({kind: 'unit', id: unit.id, damage: round(result.damage, 4), killed: result.killed})
    }
    for (const player of this.livingPlayers) {
      const dist = distance(center, player.pos)
      if (dist > weapon.radius) continue
      const damage = this.damagePlayer(weapon.damage * (1 - dist / weapon.radius), {
        id: projectile.id,
        type: 'grenade',
        pos: center,
      }, player.id)
      if (damage > 0) hits.push({kind: 'player', id: player.id, damage: round(damage, 4), killed: !player.alive})
    }
    this.recordShot('grenade', unitHit, projectile.playerId)
    this.addSound('explosion', center, undefined, projectile.playerId)
    this.emit('explosion', {
      by: projectile.playerId,
      playerId: projectile.playerId,
      projectileId: projectile.id,
      pos: center,
      radius: weapon.radius,
      hit: hits.length > 0,
      hits,
    })
  }

  unitHitCollider(unit, spec = this.unitCatalog.types[unit.type]) {
    const moving = Math.hypot(unit.vel?.x || 0, unit.vel?.z || 0) > 0.08
    const pose = unit.type === 'scout'
      ? (unit.intent?.melee && !moving ? 'melee' : 'idle')
      : (unit.intent?.aimAt || unit.intent?.fire ? 'aim' : 'idle')
    let shapes = Array.isArray(spec.hitVolumes) ? spec.hitVolumes : spec.hitVolumes?.[pose] || spec.hitVolumes?.idle
    shapes ||= [{
      id: 'body', part: Object.hasOwn(spec.parts || {}, 'Chest') ? 'Chest' : 'Hull', shape: 'box',
      offset: {x: 0, y: spec.height * 0.42, z: 0},
      size: {x: spec.radius * 2, y: spec.height * 0.66, z: spec.radius * 2},
    }]
    if (!spec.hitVolumes && Object.hasOwn(spec.parts || {}, 'Head')) shapes = [...shapes, {
      id: 'head', part: 'Head', shape: 'sphere',
      offset: {x: 0, y: spec.height * 0.84, z: 0}, radius: spec.radius * 0.5,
    }]
    return {id: `unit:${unit.id}`, center: unit.pos, yaw: unit.yaw, shapes}
  }

  hitscan({origin, direction, weaponId = 'pistol', damage, source = 'player', playerId = null, maxDistance = 100}) {
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1
    const ray = {x: direction.x / length, y: direction.y / length, z: direction.z / length}
    let blocker = {kind: 'miss', distance: maxDistance}
    for (const collider of this.activeColliders()) {
      const hit = rayCollider(origin, ray, collider, maxDistance)
      if (hit && hit.distance < blocker.distance) blocker = {kind: 'collider', colliderId: collider.id, distance: hit.distance}
    }
    const candidates = []
    for (const unit of this.units) {
      if (!unit.alive) continue
      const hit = this.unitRayHit(origin, ray, unit, Math.min(maxDistance, blocker.distance))
      if (hit) candidates.push({...hit, unit, unitId: unit.id})
    }
    candidates.sort((a, b) => a.distance - b.distance || a.unitId.localeCompare(b.unitId))
    if (candidates.length === 0) return blocker

    const weapon = this.weaponCatalog.weapons[weaponId] || {}
    const hitLimit = Math.max(1, 1 + (weapon.penetration || 0))
    const falloff = weapon.penetrationMultiplier || 1
    const hits = []
    for (const [index, candidate] of candidates.slice(0, hitLimit).entries()) {
      const point = addScaled(origin, ray, candidate.distance)
      let part = candidate.part
      let plate = false
      let spine = false
      if (candidate.unit.type === 'heavy' && part !== 'Head') {
        const towardShooterX = origin.x - candidate.unit.pos.x
        const towardShooterZ = origin.z - candidate.unit.pos.z
        const planar = Math.hypot(towardShooterX, towardShooterZ) || 1
        const facingDot = (towardShooterX / planar) * Math.sin(candidate.unit.yaw)
          + (towardShooterZ / planar) * Math.cos(candidate.unit.yaw)
        if (facingDot > 0.25) {
          part = 'Chest'
          plate = true
        } else if (facingDot < -0.25) {
          part = 'Spine'
          spine = true
        }
      }
      const result = this.damageUnit(candidate.unit.id, (damage ?? weapon.damage ?? 0) * falloff ** index, {
        source,
        ...(playerId ? {playerId} : {}),
        weapon: weaponId,
        point,
        normal: normalizedVector({x: point.x - candidate.unit.pos.x, y: point.y - (candidate.unit.pos.y + this.unitCatalog.types[candidate.unit.type].height / 2), z: point.z - candidate.unit.pos.z}),
        direction: ray,
        part,
        headshot: part === 'Head',
        plate,
        spine,
        distance: candidate.distance,
      })
      hits.push({...candidate, ...result, part, headshot: part === 'Head', plate, spine, point})
    }
    return {...hits[0], kind: 'unit', hits}
  }

  unitRayHit(origin, ray, unit, maxDistance = 100) {
    const spec = this.unitCatalog.types[unit.type]
    const hit = rayCollider(origin, ray, this.unitHitCollider(unit, spec), maxDistance)
    if (!hit) return null
    const part = unitPartForHitVolume(spec, hit.part)
    return {distance: hit.distance, normal: hit.normal, part, headshot: part === 'Head', hitPart: hit.part.id}
  }

  damageUnit(unitId, amount, context = {}) {
    const unit = this.unitById.get(unitId)
    if (!unit?.alive || amount <= 0) return {damage: 0, killed: false}
    const spec = this.unitCatalog.types[unit.type]
    const defaultPart = Object.hasOwn(spec.parts || {}, 'Chest') ? 'Chest' : 'Hull'
    const part = context.part || (context.headshot && Object.hasOwn(spec.parts || {}, 'Head') ? 'Head' : defaultPart)
    const targetedPart = Boolean(context.part || context.headshot || context.plate || context.spine)
    const multiplier = targetedPart ? unitPartMultiplier(spec, part) : 1
    const damage = Math.min(unit.hp, Math.max(0, amount * multiplier))
    unit.hp = Math.max(0, unit.hp - damage)
    unit.firstDamagedAtTick ??= this.tick
    unit.lastDamagedAtTick = this.tick
    if ((spec.staggerResist || 0) < 1 && damage >= 65) {
      unit.staggerTicks = Math.max(unit.staggerTicks || 0, Math.round(0.4 * (1 - (spec.staggerResist || 0)) * TICK_RATE))
    }
    const point = copyVec(context.point || unit.pos)
    const direction = normalizedVector(context.direction || (context.source === 'player'
      ? subtractVec(unit.pos, this.players.get(context.playerId ?? this.hostPlayerId)?.pos || unit.pos)
      : {x: 0, y: 0, z: 0}))
    const normal = normalizedVector(context.normal || scaleVec(direction, -1))
    this.telemetry.counters.damageEvents += 1
    const shooter = context.source === 'player'
      ? this.players.get(context.playerId ?? this.hostPlayerId)
      : null
    if (shooter) {
      const shooterTelemetry = this.playerTelemetry(shooter.id)
      shooterTelemetry.damageDealt = round((shooterTelemetry.damageDealt || 0) + damage, 4)
      shooterTelemetry.counters.damageEvents += 1
    }
    this.emit('unit_damage', {
      unitId: unit.id,
      unitType: unit.type,
      part,
      amount: round(damage),
      weapon: context.weapon || 'unknown',
      headshot: part === 'Head',
      pos: point,
      point,
      normal,
      direction,
      plate: Boolean(context.plate),
      spine: Boolean(context.spine),
      ...(shooter ? {playerId: shooter.id} : {}),
    })
    if (unit.hp > 0) return {damage, killed: false}

    unit.alive = false
    unit.diedAtTick = this.tick
    unit.brain?.destroy?.()
    const stats = this.telemetry.units[unit.id]
    stats.lifetime = round((this.tick - unit.spawnedAtTick) * TICK_SECONDS)
    stats.causeOfDeath = context.weapon || context.source || 'damage'
    const kill = {
      t: this.waveTime(),
      unitType: unit.type,
      unitId: unit.id,
      playerId: shooter?.id || null,
      playerName: shooter?.name || null,
      weapon: context.weapon || shooter?.activeWeapon || context.source || 'damage',
      distance: round(context.distance ?? (shooter ? planarDistance(shooter.pos, unit.pos) : 0), 3),
      headshot: part === 'Head',
      part,
      pos: point,
      direction,
      timeFromFirstDamage: round((this.tick - (unit.firstDamagedAtTick ?? this.tick)) * TICK_SECONDS),
    }
    if (shooter) {
      if (this.sandbox.infiniteScrap && shooter.id === this.hostPlayerId) shooter.scrap = 999999
      else shooter.scrap += this.unitCatalog.types[unit.type].scrap
      this.telemetry.kills.push(kill)
      this.telemetry.counters.kills += 1
      this.playerTelemetry(shooter.id).kills.push(structuredClone(kill))
      this.playerTelemetry(shooter.id).counters.kills += 1
    }
    this.emit('kill', kill)
    this.telemetry.unitTypes[unit.type] ??= {spawned: 0, killed: 0}
    this.telemetry.unitTypes[unit.type].killed += 1
    this.emit('unit_death', {unitId: unit.id, unitType: unit.type, rev: unit.rev, cause: stats.causeOfDeath})
    return {damage, killed: true}
  }

  damagePlayer(amount, attacker = {}, playerId = this.hostPlayerId) {
    if (typeof attacker === 'string') {
      playerId = attacker
      attacker = {}
    }
    const player = this.players.get(playerId)
    if (!player || !player.alive || amount <= 0) return 0
    if (this.sandbox.invulnerable && player.id === this.hostPlayerId) {
      this.syncSandboxPlayer()
      return 0
    }
    const armorDamage = Math.min(player.armor, amount * 0.6)
    player.armor -= armorDamage
    const hpDamage = Math.min(player.hp, amount - armorDamage)
    player.hp -= hpDamage
    if (player.hp <= 0) {
      player.alive = false
      player.downed = true
    }
    const facing = attacker.pos
      ? Math.abs(normalizeAngle(yawTo(player.pos, attacker.pos) - player.yaw)) <= Math.PI / 2
      : false
    const event = {
      t: this.waveTime(),
      amount: round(hpDamage + armorDamage),
      unitType: attacker.type || 'hazard',
      unitId: attacker.id || null,
      attackerPos: attacker.pos ? copyVec(attacker.pos) : null,
      playerPos: copyVec(player.pos),
      playerFacing: player.yaw,
      playerFacingAttacker: facing,
      playerId: player.id,
      playerName: player.name,
    }
    this.telemetry.damageTaken.push(event)
    this.telemetry.counters.damageEvents += 1
    this.playerTelemetry(player.id).damageTaken.push(structuredClone(event))
    this.playerTelemetry(player.id).counters.damageEvents += 1
    this.emit('player_damage', event)
    if (!player.alive) this.emit('player_death', {playerId: player.id, unitId: attacker.id || null, unitType: attacker.type || 'hazard'})
    return hpDamage + armorDamage
  }

  recordShot(weaponId, hit, playerId = null) {
    this.telemetry.shots[weaponId] ??= {fired: 0, hits: 0}
    this.telemetry.shots[weaponId].fired += 1
    this.telemetry.counters.shots += 1
    if (hit) {
      this.telemetry.shots[weaponId].hits += 1
      this.telemetry.counters.hits += 1
    }
    if (playerId && this.players.has(playerId)) {
      const telemetry = this.playerTelemetry(playerId)
      telemetry.shots[weaponId] ??= {fired: 0, hits: 0}
      telemetry.shots[weaponId].fired += 1
      telemetry.counters.shots += 1
      if (hit) {
        telemetry.shots[weaponId].hits += 1
        telemetry.counters.hits += 1
      }
    }
  }

  recordProjectileHit(weaponId, hit, playerId = null) {
    if (!hit) return
    this.telemetry.shots[weaponId] ??= {fired: 0, hits: 0}
    this.telemetry.shots[weaponId].hits += 1
    this.telemetry.counters.hits += 1
    if (playerId && this.players.has(playerId)) {
      const telemetry = this.playerTelemetry(playerId)
      telemetry.shots[weaponId] ??= {fired: 0, hits: 0}
      telemetry.shots[weaponId].hits += 1
      telemetry.counters.hits += 1
    }
  }

  tickBrain(unit) {
    const type = this.unitCatalog.types[unit.type]
    const visiblePlayers = this.visiblePlayersForUnit(unit)
    const target = visiblePlayers[0] || null
    const seen = Boolean(target)
    const sounds = this.heardSounds(unit)
    const newStimulus = (seen && (!unit.playerVisible || unit.targetPlayerId !== target.id))
      || (!seen && sounds.length > 0 && unit.lastStimulusTick !== sounds.at(-1).tick)
    if (newStimulus) {
      unit.reactionReadyTick = this.tick + Math.ceil(type.reactionDelay * TICK_RATE)
      unit.lastStimulusTick = sounds.at(-1)?.tick ?? this.tick
    }
    unit.playerVisible = seen
    if (target) {
      unit.targetPlayerId = target.id
      unit.lastKnownPlayer = {id: target.id, pos: copyVec(target.pos), t: this.waveTime()}
    } else if (unit.lastKnownPlayer && this.waveTime() - unit.lastKnownPlayer.t > 10) {
      unit.lastKnownPlayer = null
      unit.targetPlayerId = null
    }
    const previousIntent = structuredClone(unit.intent)
    unit.intent.fire = false
    unit.intent.melee = false
    const sense = this.buildSense(unit, sounds, visiblePlayers)
    const act = this.buildAct(unit)
    try {
      unit.brain?.tick?.(this.buildSelf(unit), sense, act, unit.mem)
    } catch (error) {
      if (error instanceof FuelExhaustedError) {
        unit.intent = previousIntent
        this.telemetry.units[unit.id].fuelExhausted += 1
        this.emit('fuelExhausted', {unitId: unit.id, unitType: unit.type, rev: unit.rev})
        return
      }
      this.telemetry.units[unit.id].scriptErrors += 1
      unit.brain?.destroy?.()
      unit.brain = DEFAULT_BRAINS[unit.type]
      unit.mem = {}
      this.emit('script_error', {unitId: unit.id, unitType: unit.type, rev: unit.rev, message: String(error?.message || error)})
    }
  }

  acceptScript({unitType, source}) {
    const result = this.scriptRegistry.acceptScript({unitType, source}, (candidate) => this.smokeScript(candidate))
    if (result.ok) this.skynet.revs[unitType] = result.rev
    return result
  }

  snapshot() {
    this.syncTelemetryPlayers()
    const eventStart = this.snapshotEventCursor
    const eventCursor = this.eventLog.length
    const snapshot = {
      version: 1,
      tick: this.tick,
      seed: this.seed,
      rngState: this.rng.state,
      hostPlayerId: this.hostPlayerId,
      playerOrder: [...this.players.keys()],
      players: Object.fromEntries([...this.players].map(([id, player]) => [id, structuredClone(player)])),
      units: this.units.map((unit) => {
        const {brain, ...state} = unit
        return structuredClone(state)
      }),
      projectiles: structuredClone(this.projectiles),
      mapState: structuredClone(this.mapState),
      phase: this.phase,
      wave: this.wave,
      bossPhase: this.bossPhase,
      waveStartedAtTick: this.waveStartedAtTick,
      phaseTicksLeft: this.phaseTicksLeft,
      waveBudget: this.waveBudget,
      performanceMultiplier: this.performanceMultiplier,
      scaling: structuredClone(this.scaling),
      ...(this.sandboxEnabled() ? {sandbox: structuredClone(this.sandbox)} : {}),
      nextUnitId: this.nextUnitId,
      nextProjectileId: this.nextProjectileId,
      lastBrainTickCount: this.lastBrainTickCount || 0,
      previousInputs: Object.fromEntries([...this.previousInputsByPlayer].map(([id, inputs]) => [id, structuredClone(inputs)])),
      lastInputsBundle: structuredClone(this.lastInputsBundle),
      replay: structuredClone(this.replay),
      sounds: structuredClone(this.sounds),
      messages: structuredClone(this.messages),
      telemetry: structuredClone(this.telemetry),
      skynet: structuredClone(this.skynet),
      transmission: this.transmission,
      scriptRevisions: Object.fromEntries([...this.scriptRegistry.revisions].map(([type, revisions]) => [type, structuredClone(revisions)])),
      eventStart,
      eventCursor,
      events: structuredClone(this.eventLog.slice(eventStart)),
    }
    this.snapshotEventCursor = eventCursor
    return snapshot
  }

  applySnapshot(snapshot) {
    if (!snapshot || snapshot.version !== 1) throw new TypeError('unsupported world snapshot')
    const playerEntries = Array.isArray(snapshot.players)
      ? snapshot.players.map((player) => [player.id, player])
      : (snapshot.playerOrder || Object.keys(snapshot.players || {}))
        .map((id) => [id, snapshot.players?.[id]])
        .filter(([, player]) => player)
    if (playerEntries.length === 0) throw new TypeError('world snapshot has no players')

    for (const unit of this.units) unit.brain?.destroy?.()
    this.tick = snapshot.tick
    this.seed = snapshot.seed
    this.rng.state = snapshot.rngState >>> 0 || 1
    this.hostPlayerId = snapshot.hostPlayerId
    this.players = new Map(playerEntries.map(([id, player]) => [id, structuredClone(player)]))
    if (!this.players.has(this.hostPlayerId)) this.hostPlayerId = this.players.keys().next().value
    this.previousInputsByPlayer = new Map([...this.players.keys()].map((id) => [
      id,
      normalizeInputs(snapshot.previousInputs?.[id] || EMPTY_INPUTS),
    ]))
    this.lastInputsBundle = structuredClone(snapshot.lastInputsBundle || {})
    this.mapState = structuredClone(snapshot.mapState)
    this.nav = new NavGrid(this.map, this.dynamicColliders())
    this.phase = snapshot.phase
    this.wave = snapshot.wave
    this.bossPhase = Boolean(snapshot.bossPhase)
    this.waveStartedAtTick = snapshot.waveStartedAtTick
    this.phaseTicksLeft = snapshot.phaseTicksLeft
    this.waveBudget = snapshot.waveBudget
    this.performanceMultiplier = snapshot.performanceMultiplier
    this.scaling = structuredClone(snapshot.scaling)
    this.sandbox = snapshot.sandbox
      ? {invulnerable: Boolean(snapshot.sandbox.invulnerable), infiniteScrap: Boolean(snapshot.sandbox.infiniteScrap)}
      : {invulnerable: false, infiniteScrap: false}
    this.nextUnitId = snapshot.nextUnitId
    this.nextProjectileId = snapshot.nextProjectileId || 1
    this.lastBrainTickCount = snapshot.lastBrainTickCount || 0
    this.projectiles = structuredClone(snapshot.projectiles || [])
    this.replay = structuredClone(snapshot.replay || [])
    this.sounds = structuredClone(snapshot.sounds || [])
    this.messages = structuredClone(snapshot.messages || [])
    this.telemetry = structuredClone(snapshot.telemetry)
    if (this.sandboxEnabled()) this.telemetry.sandbox = true
    else delete this.telemetry.sandbox
    this.telemetry.unitTypes ??= Object.fromEntries(Object.keys(this.unitCatalog.types).map((id) => [id, {spawned: 0, killed: 0}]))
    this.skynet = structuredClone(snapshot.skynet)
    this.transmission = snapshot.transmission

    if (snapshot.scriptRevisions) {
      this.scriptRegistry.revisions = new Map(Object.entries(snapshot.scriptRevisions)
        .map(([type, revisions]) => [type, structuredClone(revisions)]))
    }
    this.units = (snapshot.units || []).map((state) => {
      const unit = structuredClone(state)
      if (!unit.alive) return {...unit, brain: null}
      try {
        return {...unit, brain: this.createUnitBrain(unit.type, unit.rev)}
      } catch {
        return {...unit, brain: DEFAULT_BRAINS[unit.type]}
      }
    })
    this.unitById = new Map(this.units.map((unit) => [unit.id, unit]))

    const eventStart = Number(snapshot.eventStart) || 0
    const events = structuredClone(snapshot.events || [])
    if (eventStart === 0 || this.eventLog.length < eventStart) this.eventLog = events
    else {
      this.eventLog.length = eventStart
      this.eventLog.push(...events)
    }
    this.snapshotEventCursor = Number(snapshot.eventCursor) || eventStart + events.length
    return this
  }

  smokeScript({unitType, source, rev}) {
    const smokeWorld = new World({
      map: this.map,
      units: this.unitCatalog,
      weapons: this.weaponCatalog,
      scriptSources: {[unitType]: {source, rev}},
      seed: this.seed,
    })
    const player = smokeWorld.getPlayer(smokeWorld.hostPlayerId).pos
    smokeWorld.spawnUnit(unitType, {x: player.x, y: 0, z: player.z + 4}, {yaw: Math.PI, rev})
    for (let tick = 0; tick < 5 * TICK_RATE; tick += 1) smokeWorld.step()
    const log = smokeWorld.eventLog.filter(({type}) => type === 'script_error' || type === 'fuelExhausted')
    smokeWorld.destroy()
    const error = log.find(({type}) => type === 'script_error')
    return error ? {ok: false, error: error.message, log} : {ok: true, log}
  }

  destroy() {
    for (const unit of this.units) unit.brain?.destroy?.()
  }

  buildSelf(unit) {
    const spec = this.unitCatalog.types[unit.type]
    return {
      id: unit.id,
      type: unit.type,
      hp: unit.hp,
      maxHp: unit.maxHp,
      pos: copyVec(unit.pos),
      yaw: unit.yaw,
      vel: copyVec(unit.vel),
      weapon: {
        ready: unit.cooldown <= 0 && unit.shotCooldown <= 0,
        range: spec.range,
        spread: spec.spreadDeg,
        cooldownLeft: Math.max(unit.cooldown, unit.shotCooldown),
      },
      alive: unit.alive,
      spawnedAt: unit.spawnedAt,
      flying: Boolean(spec.flying),
      altitude: spec.flying ? unit.pos.y : 0,
    }
  }

  buildSense(unit, sounds = this.heardSounds(unit), visiblePlayers = this.visiblePlayersForUnit(unit)) {
    const players = visiblePlayers.map((player) => this.playerSense(unit, player, true))
    const player = players[0] ? withoutId(players[0]) : null
    return {
      time: this.waveTime(),
      rand: () => this.rng.next(),
      flying: Boolean(this.unitCatalog.types[unit.type].flying),
      altitude: this.unitCatalog.types[unit.type].flying ? unit.pos.y : 0,
      player,
      players,
      lastKnownPlayer: unit.lastKnownPlayer
        ? {id: unit.lastKnownPlayer.id, pos: copyVec(unit.lastKnownPlayer.pos), t: unit.lastKnownPlayer.t}
        : null,
      allies: this.units.filter((ally) => ally.alive).map((ally) => ({id: ally.id, type: ally.type, pos: copyVec(ally.pos), hp: ally.hp, alive: ally.alive})),
      sounds: sounds.map(({kind, pos, t}) => ({kind, pos: copyVec(pos), t})),
      messages: this.messages
        .filter((message) => message.from !== unit.id && this.tick - message.tick <= 120)
        .map(({from, t, data}) => ({from, t, data: structuredClone(data)})),
      nav: {
        canSee: (pos) => this.lineOfSight(this.unitEye(unit), pos),
        pathTo: (pos) => this.pathIntent(unit, pos),
        coverNear: (pos, fromPos, radius) => this.coverNear(unit, pos, fromPos, radius),
        randomPoint: (radius) => this.randomPoint(unit.pos, radius),
        gates: this.map.spawnGates.map((gate) => ({id: gate.id, pos: copyVec(gate.pos)})),
        doors: this.map.doors.map((door) => ({id: door.id, pos: copyVec(door.pos), locked: this.mapState.doors[door.id] === 'locked'})),
      },
    }
  }

  buildAct(unit) {
    return {
      moveTo: (pos) => { unit.intent.moveTo = copyVec(pos) },
      stop: () => { unit.intent.moveTo = null; unit.vel.x = 0; unit.vel.y = 0; unit.vel.z = 0 },
      face: (pos) => { unit.intent.face = copyVec(pos) },
      fire: () => { unit.intent.fire = true },
      aimAt: (pos) => { unit.intent.aimAt = copyVec(pos) },
      melee: () => { unit.intent.melee = true },
      crouch: (on) => { unit.intent.crouch = Boolean(on) },
      say: (text) => {
        if (this.tick - unit.lastSayTick < 300) return
        unit.lastSayTick = this.tick
        this.emit('unit_say', {unitId: unit.id, text: String(text).slice(0, 40)})
      },
      broadcast: (data) => {
        if (unit.broadcasts.filter((tick) => this.tick - tick < 60).length >= 2) return
        let copy
        try { copy = structuredClone(data) } catch { return }
        if (JSON.stringify(copy).length > 512) return
        unit.broadcasts.push(this.tick)
        this.messages.push({from: unit.id, tick: this.tick, t: this.waveTime(), data: copy})
      },
    }
  }

  playerSense(unit, player, includeId = false) {
    return {
      ...(includeId ? {id: player.id} : {}),
      pos: copyVec(player.pos),
      dist: planarDistance(unit.pos, player.pos),
      vel: copyVec(player.vel),
      facingMe: Math.abs(normalizeAngle(yawTo(player.pos, unit.pos) - player.yaw)) <= Math.PI / 6,
      hp: player.hp,
      armor: player.armor,
      weapon: player.activeWeapon,
      reloading: player.reloadTimer > 0,
    }
  }

  visiblePlayersForUnit(unit) {
    return [...this.players.values()]
      .filter((player) => this.canUnitSeePlayer(unit, player.id))
      .sort((a, b) => planarDistance(unit.pos, a.pos) - planarDistance(unit.pos, b.pos))
  }

  canUnitSeePlayer(unit, playerId = null) {
    if (playerId == null) return this.visiblePlayersForUnit(unit).length > 0
    const player = this.players.get(playerId)
    if (!player?.alive || !this.visionConeTest(unit, player.pos)) return false
    return this.lineOfSight(this.unitEye(unit), {...player.pos, y: player.pos.y + (player.crouch ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT)})
  }

  unitEye(unit) {
    return {...unit.pos, y: unit.pos.y + this.unitCatalog.types[unit.type].height * 0.78}
  }

  heardSounds(unit) {
    return this.sounds.filter((sound) => this.tick - sound.tick <= 120 && planarDistance(unit.pos, sound.pos) <= sound.radius)
  }

  pathIntent(unit, pos) {
    if (this.unitCatalog.types[unit.type].flying) {
      const next = copyVec(pos)
      return {next, dist: distance(unit.pos, next)}
    }
    const path = this.pathForUnit(unit, pos)
    if (!path?.length) return null
    const index = Math.min(unit.pathCache.index + 1, path.length - 1)
    return {next: copyVec(path[index]), dist: this.nav.pathDistance(path.slice(index))}
  }

  pathForUnit(unit, target) {
    if (this.unitCatalog.types[unit.type].flying) return [copyVec(unit.pos), copyVec(target)]
    const targetCell = this.nav.worldToCell(target)
    const targetKey = `${targetCell.x}:${targetCell.z}:${targetCell.layer || targetCell.y}`
    const cache = unit.pathCache
    const mayRepath = this.tick - cache.computedAtTick >= 30
    if (cache.computedAtTick < 0 || (mayRepath && (!cache.path || cache.targetKey !== targetKey))) {
      cache.targetKey = targetKey
      cache.computedAtTick = this.tick
      cache.path = this.findPath(unit.pos, target)
      cache.index = 0
    }
    return cache.path
  }

  coverNear(unit, pos, fromPos, radius) {
    const center = this.nav.worldToCell(pos)
    const cells = Math.max(1, Math.ceil(radius / this.map.navGrid.cellSize))
    let best = null
    for (let ring = 1; ring <= cells; ring += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue
          const cell = {x: center.x + dx, z: center.z + dz, y: center.y, layer: center.layer}
          for (const openCell of this.nav.cellsAt(cell, {openOnly: true})) {
            const candidate = this.nav.cellCenter(openCell)
            const sightPoint = {...candidate, y: candidate.y + 1}
            if (this.lineOfSight(fromPos, sightPoint)) continue
            const path = this.findPath(unit.pos, candidate)
            if (!path) continue
            const score = this.nav.pathDistance(path)
            if (!best || score < best.score) best = {point: candidate, score}
          }
        }
      }
      if (best) break
    }
    return best?.point || null
  }

  randomPoint(center, radius) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = this.rng.range(-Math.PI, Math.PI)
      const length = Math.sqrt(this.rng.next()) * radius
      const point = {x: center.x + Math.sin(angle) * length, y: center.y, z: center.z + Math.cos(angle) * length}
      const cell = this.nav.nearestOpen(this.nav.worldToCell(point))
      if (cell) return this.nav.cellCenter(cell)
    }
    return copyVec(center)
  }

  updateUnit(unit) {
    const spec = this.unitCatalog.types[unit.type]
    unit.cooldown = Math.max(0, unit.cooldown - TICK_SECONDS)
    unit.shotCooldown = Math.max(0, unit.shotCooldown - TICK_SECONDS)
    unit.secondaryCooldown = Math.max(0, (unit.secondaryCooldown || 0) - TICK_SECONDS)
    unit.secondaryShotCooldown = Math.max(0, (unit.secondaryShotCooldown || 0) - TICK_SECONDS)
    unit.staggerTicks = Math.max(0, (unit.staggerTicks || 0) - 1)
    if (spec.regen > 0 && unit.hp < unit.maxHp && this.tick - (unit.lastDamagedAtTick ?? -Infinity) >= (spec.regenDelay || 3) * TICK_RATE) {
      unit.hp = Math.min(unit.maxHp, unit.hp + spec.regen * TICK_SECONDS)
    }
    this.moveUnit(unit, spec)
    const faceTarget = unit.intent.aimAt || unit.intent.face || unit.intent.moveTo
    if (faceTarget) unit.yaw = moveAngle(unit.yaw, yawTo(unit.pos, faceTarget), spec.turnRateDeg * Math.PI / 180 * TICK_SECONDS)
    const canReact = this.tick >= unit.reactionReadyTick && unit.staggerTicks <= 0
    if (spec.attack === 'melee') this.updateMeleeUnit(unit, spec, canReact)
    else if (spec.attack === 'burst' || spec.shotsPerBurst) this.updateBurstUnit(unit, spec, canReact)
    else if (spec.attack === 'cannon') this.updateTankUnit(unit, spec, canReact)
    else this.updateHeavyUnit(unit, spec, canReact)
  }

  moveUnit(unit, spec) {
    if (spec.flying) {
      this.moveFlyingUnit(unit, spec)
      return
    }
    if (!unit.intent.moveTo || this.tick < unit.reactionReadyTick || unit.staggerTicks > 0) {
      unit.vel.x = 0
      unit.vel.y = 0
      unit.vel.z = 0
      return
    }
    const path = this.pathForUnit(unit, unit.intent.moveTo)
    if (!path?.length) {
      unit.vel.x = 0
      unit.vel.y = 0
      unit.vel.z = 0
      return
    }
    const cache = unit.pathCache
    while (cache.index < path.length - 1 && distance(unit.pos, path[cache.index]) < 0.45) cache.index += 1
    const target = path[cache.index] || unit.intent.moveTo
    const dx = target.x - unit.pos.x
    const dz = target.z - unit.pos.z
    const length = Math.hypot(dx, dz)
    if (length < 0.02) {
      const vertical = target.y - unit.pos.y
      unit.vel.x = 0
      unit.vel.z = 0
      unit.vel.y = vertical / TICK_SECONDS
      unit.pos.y = target.y
      this.telemetry.units[unit.id].distanceTraveled += Math.abs(vertical)
      return
    }
    const step = Math.min(length, spec.speed * TICK_SECONDS)
    unit.vel.x = dx / length * spec.speed
    unit.vel.z = dz / length * spec.speed
    unit.pos.x += dx / length * step
    unit.pos.z += dz / length * step
    const previousY = unit.pos.y
    const support = this.nav.supportAt(unit.pos, unit.pos.y)
    if (support) unit.pos.y = support.y
    unit.vel.y = (unit.pos.y - previousY) / TICK_SECONDS
    this.telemetry.units[unit.id].distanceTraveled += Math.hypot(step, unit.pos.y - previousY)
  }

  moveFlyingUnit(unit, spec) {
    if (!unit.intent.moveTo || this.tick < unit.reactionReadyTick || unit.staggerTicks > 0) {
      unit.vel = {x: 0, y: 0, z: 0}
      return
    }
    const target = copyVec(unit.intent.moveTo)
    target.y = clamp(target.y || (spec.altitudeMin + spec.altitudeMax) / 2, spec.altitudeMin, spec.altitudeMax)
    const delta = subtractVec(target, unit.pos)
    const length = vectorLength(delta)
    if (length <= 0.02) {
      unit.vel = {x: 0, y: 0, z: 0}
      return
    }
    const step = Math.min(length, spec.speed * TICK_SECONDS)
    const velocity = scaleVec(delta, spec.speed / length)
    const movement = scaleVec(delta, step / length)
    const candidates = [
      addVec(unit.pos, movement),
      {x: unit.pos.x + movement.x, y: unit.pos.y, z: unit.pos.z},
      {x: unit.pos.x, y: unit.pos.y, z: unit.pos.z + movement.z},
      {x: unit.pos.x, y: unit.pos.y + movement.y, z: unit.pos.z},
    ]
    const next = candidates.find((candidate) => this.flyerPositionClear(candidate, spec))
    if (!next) {
      unit.vel = {x: 0, y: 0, z: 0}
      return
    }
    next.x = clamp(next.x, this.map.bounds.minX + spec.radius, this.map.bounds.maxX - spec.radius)
    next.z = clamp(next.z, this.map.bounds.minZ + spec.radius, this.map.bounds.maxZ - spec.radius)
    next.y = clamp(next.y, spec.altitudeMin, spec.altitudeMax)
    const travelled = distance(unit.pos, next)
    unit.vel = travelled > 1e-9 ? scaleVec(subtractVec(next, unit.pos), 1 / TICK_SECONDS) : {x: 0, y: 0, z: 0}
    unit.pos = next
    this.telemetry.units[unit.id].distanceTraveled += travelled
  }

  flyerPositionClear(pos, spec) {
    if (pos.x < this.map.bounds.minX + spec.radius || pos.x > this.map.bounds.maxX - spec.radius) return false
    if (pos.z < this.map.bounds.minZ + spec.radius || pos.z > this.map.bounds.maxZ - spec.radius) return false
    const center = {...pos, y: pos.y + spec.height / 2}
    return !this.activeColliders().some((collider) => sphereIntersectsCollider(center, spec.radius, collider))
  }

  updateMeleeUnit(unit, spec, canReact) {
    const player = this.unitTargetPlayer(unit)
    if (!unit.intent.melee || !canReact || unit.cooldown > 0 || !player) return
    if (planarDistance(unit.pos, player.pos) > spec.range) return
    unit.cooldown = spec.cooldown
    const dealt = this.damagePlayer(spec.damage, unit, player.id)
    this.telemetry.units[unit.id].damageDealt += dealt
    this.emit('melee', {unitId: unit.id, playerId: player.id, hit: dealt > 0})
  }

  updateBurstUnit(unit, spec, canReact) {
    if (!canReact || !this.unitTargetPlayer(unit)) return
    if (unit.burstRemaining <= 0 && unit.intent.fire && unit.cooldown <= 0 && this.unitAimAligned(unit, spec)) {
      unit.burstRemaining = spec.shotsPerBurst
    }
    if (unit.burstRemaining <= 0 || unit.shotCooldown > 0) return
    this.fireUnitWeapon(unit, spec)
    unit.burstRemaining -= 1
    unit.shotCooldown = 1 / spec.roundsPerSecond
    if (unit.burstRemaining === 0) unit.cooldown = spec.cooldown
  }

  updateHeavyUnit(unit, spec, canReact) {
    if (!unit.intent.fire || !canReact || !this.unitTargetPlayer(unit) || !this.unitAimAligned(unit, spec)) {
      unit.spinUp = Math.max(0, unit.spinUp - TICK_SECONDS * 2)
      return
    }
    unit.spinUp = Math.min(spec.spinUp, unit.spinUp + TICK_SECONDS)
    if (unit.spinUp < spec.spinUp || unit.shotCooldown > 0) return
    this.fireUnitWeapon(unit, spec)
    unit.shotCooldown = 1 / spec.roundsPerSecond
  }

  updateTankUnit(unit, spec, canReact) {
    if (!unit.intent.fire || !canReact || !this.unitTargetPlayer(unit) || !this.unitAimAligned(unit, spec)) return
    if (unit.cooldown <= 0) {
      this.fireUnitWeapon(unit, spec)
      unit.cooldown = spec.cooldown
    }
    const burst = spec.burst
    if (!burst) return
    if (unit.secondaryBurstRemaining <= 0 && unit.secondaryCooldown <= 0) unit.secondaryBurstRemaining = burst.shots
    if (unit.secondaryBurstRemaining <= 0 || unit.secondaryShotCooldown > 0) return
    this.fireUnitWeapon(unit, {...spec, ...burst, attack: 'burst', projectileSpeed: burst.projectileSpeed || burst.speed})
    unit.secondaryBurstRemaining -= 1
    unit.secondaryShotCooldown = 1 / burst.roundsPerSecond
    if (unit.secondaryBurstRemaining === 0) unit.secondaryCooldown = burst.cooldown
  }

  unitAimAligned(unit, spec) {
    const target = unit.intent.aimAt || unit.intent.face
    if (!target) return false
    return Math.abs(normalizeAngle(yawTo(unit.pos, target) - unit.yaw)) <= spec.spreadDeg * Math.PI / 180
  }

  fireUnitWeapon(unit, spec) {
    const intended = this.unitTargetPlayer(unit)
    if (!intended) return
    const origin = this.unitEye(unit)
    const target = {...intended.pos, y: intended.pos.y + (intended.crouch ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT)}
    const baseYaw = yawTo(origin, target)
    const basePitch = Math.atan2(target.y - origin.y, Math.hypot(target.x - origin.x, target.z - origin.z))
    const spread = spec.spreadDeg * Math.PI / 180
    const yawError = this.rng.range(-spread, spread)
    const pitchError = this.rng.range(-spread, spread)
    const projectileType = spec.projectile || (spec.attack === 'bolt' ? 'bolt' : 'round')
    const speed = spec.projectileSpeed || spec.speed || ENEMY_PROJECTILE_SPEEDS[projectileType]
    let velocity
    if (projectileType === 'shell') {
      const perturbedTarget = addScaled(target, directionFromAngles(baseYaw + Math.PI / 2, 0), Math.tan(yawError) * distance(origin, target))
      perturbedTarget.y += Math.tan(pitchError) * planarDistance(origin, target)
      velocity = ballisticVelocity(origin, perturbedTarget, speed, this.map.walkable?.gravity ?? 18)
    } else {
      velocity = scaleVec(directionFromAngles(baseYaw + yawError, basePitch + pitchError), speed)
    }
    const projectile = this.spawnProjectile({
      type: projectileType,
      owner: 'unit',
      ownerId: unit.id,
      pos: origin,
      vel: velocity,
      damage: spec.damage,
      splash: spec.splash || 0,
      weapon: spec.attack,
      life: spec.projectileLife || (projectileType === 'round' ? 2 : projectileType === 'shell' ? 4 : 3),
      radius: projectileType === 'shell' ? 0.12 : 0.04,
      maxDistance: spec.range,
    })
    const stats = this.telemetry.units[unit.id]
    stats.shotsFired += 1
    this.recordShot(`unit:${unit.type}`, false)
    this.addSound('gunshot', unit.pos)
    this.emit('shot', {by: unit.id, unitType: unit.type, playerId: intended.id, weapon: spec.attack, hit: false, origin, target, projectileId: projectile.id})
    return projectile
  }

  unitTargetPlayer(unit) {
    const assigned = this.players.get(unit.targetPlayerId)
    if (assigned?.alive) return assigned
    return this.visiblePlayersForUnit(unit)[0] || null
  }

  closestColliderDistance(origin, direction, maxDistance) {
    let closest = null
    for (const collider of this.activeColliders()) {
      if (collider.blocksSight === false) continue
      const hit = rayCollider(origin, direction, collider, maxDistance)
      if (hit && hit.distance > 1e-4 && (closest === null || hit.distance < closest)) closest = hit.distance
    }
    return closest
  }

  updateHazards() {
    if (this.tick % 30 !== 0) return
    for (const player of this.livingPlayers) {
      for (const active of this.mapState.hazards) {
        const slot = this.map.hazardSlots.find((item) => item.id === active.slot)
        if (!slot || !pointInsideColliderFootprint(player.pos, {center: slot.pos, size: slot.size})) continue
        this.damagePlayer(active.kind === 'electric' ? 12 : 8, {type: `hazard:${active.kind}`, pos: slot.pos}, player.id)
      }
    }
  }

  addSound(kind, pos, radius = SOUND_RADII[kind] || 0, playerId = null) {
    const sound = {kind, pos: copyVec(pos), tick: this.tick, t: this.waveTime(), radius, ...(playerId ? {playerId} : {})}
    this.sounds.push(sound)
    this.emit('sound', {kind, pos: sound.pos, radius, ...(playerId ? {playerId} : {})})
  }

  cleanupSignals() {
    this.sounds = this.sounds.filter((sound) => this.tick - sound.tick <= 120)
    this.messages = this.messages.filter((message) => this.tick - message.tick <= 120)
    for (const unit of this.units) unit.broadcasts = unit.broadcasts.filter((tick) => this.tick - tick < 60)
  }

  sampleTelemetry() {
    if (this.tick % 15 === 0) {
      for (const player of this.players.values()) {
        const point = {t: this.waveTime(), ...copyVec(player.pos)}
        const stats = this.playerTelemetry(player.id)
        stats.playerPath.push(point)
        const cellX = Math.floor((player.pos.x - this.map.bounds.minX) / 2)
        const cellZ = Math.floor((player.pos.z - this.map.bounds.minZ) / 2)
        const key = `${cellX}:${cellZ}`
        stats.heatmap[key] = round((stats.heatmap[key] || 0) + 0.25, 2)
        this.telemetry.heatmap[key] = round((this.telemetry.heatmap[key] || 0) + 0.25, 2)
        if (player.id === this.hostPlayerId) this.telemetry.playerPath.push(structuredClone(point))
      }
    }
    if (this.tick % 60 === 0) {
      for (const player of this.players.values()) {
        const sample = {t: this.waveTime(), hp: round(player.hp), armor: round(player.armor)}
        this.playerTelemetry(player.id).healthArmor.push(sample)
        if (player.id === this.hostPlayerId) this.telemetry.healthArmor.push(structuredClone(sample))
      }
    }
    this.syncTelemetryPlayers()
    for (const unit of this.units) {
      if (!unit.alive) continue
      this.telemetry.units[unit.id].lifetime = round((this.tick - unit.spawnedAtTick) * TICK_SECONDS)
    }
  }

  emit(type, data = {}) {
    const event = {type, tick: this.tick, t: round(this.time), wave: this.wave, ...structuredClone(data)}
    this.eventLog.push(event)
    return event
  }

  waveTime() {
    return round((this.tick - this.waveStartedAtTick) * TICK_SECONDS)
  }
}

/**
 * Absolute per-tick input record:
 * {move:{x,z}, yaw, pitch, fire, aim, reload, switchTo, sprint, crouch, jump,
 * grenade, melee, ready}. move.x is right and move.z is forward.
 */
export function normalizeInputs(inputs = EMPTY_INPUTS) {
  return {
    move: {
      x: finite(inputs.move?.x, 0),
      z: finite(inputs.move?.z, 0),
    },
    yaw: finite(inputs.yaw, 0),
    pitch: finite(inputs.pitch, 0),
    fire: Boolean(inputs.fire),
    aim: Boolean(inputs.aim),
    reload: Boolean(inputs.reload),
    switchTo: inputs.switchTo ?? null,
    sprint: Boolean(inputs.sprint),
    crouch: Boolean(inputs.crouch),
    jump: Boolean(inputs.jump),
    grenade: Boolean(inputs.grenade),
    melee: Boolean(inputs.melee),
    ready: Boolean(inputs.ready),
  }
}

export function normalizeInputsBundle(rawInputs = EMPTY_INPUTS, players, previousInputs = new Map(), hostPlayerId = HOST_PLAYER_ID) {
  const playerIds = players instanceof Map ? [...players.keys()] : Object.keys(players || {})
  const input = rawInputs && typeof rawInputs === 'object' && !Array.isArray(rawInputs) ? rawInputs : {}
  const bundled = !looksLikeInputs(input) && playerIds.some((playerId) => Object.hasOwn(input, playerId))
  return Object.fromEntries(playerIds.map((playerId) => {
    let source
    if (bundled && Object.hasOwn(input, playerId)) source = input[playerId]
    else if (!bundled && playerId === hostPlayerId) source = input
    else source = previousInputs.get?.(playerId) || previousInputs[playerId] || EMPTY_INPUTS
    return [playerId, normalizeInputs(source)]
  }))
}

function finite(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Object.is(number, -0) ? 0 : number
}

function looksLikeInputs(value) {
  return [
    'move', 'yaw', 'pitch', 'fire', 'aim', 'reload', 'switchTo',
    'sprint', 'crouch', 'jump', 'grenade', 'melee', 'ready',
  ].some((key) => Object.hasOwn(value, key))
}

function withoutId(value) {
  const {id, ...rest} = value
  return rest
}

function addVec(a, b) {
  return {x: a.x + b.x, y: (a.y || 0) + (b.y || 0), z: a.z + b.z}
}

function subtractVec(a, b) {
  return {x: a.x - b.x, y: (a.y || 0) - (b.y || 0), z: a.z - b.z}
}

function scaleVec(vector, scale) {
  return {x: vector.x * scale, y: (vector.y || 0) * scale, z: vector.z * scale}
}

function addScaled(origin, direction, distanceAlongRay) {
  return addVec(origin, scaleVec(direction, distanceAlongRay))
}

function vectorLength(vector) {
  return Math.hypot(vector.x, vector.y || 0, vector.z)
}

function normalizedVector(vector) {
  const length = vectorLength(vector)
  return length > 1e-9 ? scaleVec(vector, 1 / length) : {x: 0, y: 0, z: 0}
}

function unitPartForHitVolume(spec, volume) {
  if (Object.hasOwn(spec.parts || {}, volume.part)) return volume.part
  const id = String(volume.id || volume.part || '').toLowerCase()
  if (id === 'head' && Object.hasOwn(spec.parts || {}, 'Head')) return 'Head'
  if (id.includes('pelvis') && Object.hasOwn(spec.parts || {}, 'Pelvis')) return 'Pelvis'
  if (id.includes('spine') && Object.hasOwn(spec.parts || {}, 'Spine')) return 'Spine'
  if (id.includes('chest') && Object.hasOwn(spec.parts || {}, 'Chest')) return 'Chest'
  const side = id.includes('left') ? 'Left' : id.includes('right') ? 'Right' : null
  if (side && (id.includes('arm') || id.includes('front'))) return `Upper Arm ${side}`
  if (side && (id.includes('leg') || id.includes('rear'))) return `Thigh ${side}`
  return Object.hasOwn(spec.parts || {}, 'Chest') ? 'Chest' : 'Hull'
}

function unitPartMultiplier(spec, part) {
  if (Object.hasOwn(spec.parts || {}, part)) return spec.parts[part]
  if (/Arm|Forearm|Hand|Thigh|Shin|Foot/.test(part) && Object.hasOwn(spec.parts || {}, 'Limbs')) return spec.parts.Limbs
  return 1
}

function rayVerticalCapsule(origin, direction, base, height, radius, maxDistance) {
  const lowerY = (base.y || 0) + radius
  const upperY = (base.y || 0) + Math.max(radius, height - radius)
  let closest = null
  for (const centerY of [lowerY, upperY]) {
    const hit = raySphere(origin, direction, {x: base.x, y: centerY, z: base.z}, radius, maxDistance)
    if (hit !== null && (closest === null || hit < closest)) closest = hit
  }
  const ox = origin.x - base.x
  const oz = origin.z - base.z
  const a = direction.x ** 2 + direction.z ** 2
  if (a > 1e-10) {
    const b = 2 * (ox * direction.x + oz * direction.z)
    const c = ox ** 2 + oz ** 2 - radius ** 2
    const discriminant = b ** 2 - 4 * a * c
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant)
      for (const candidate of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        if (candidate < 0 || candidate > maxDistance) continue
        const y = origin.y + direction.y * candidate
        if (y < lowerY || y > upperY) continue
        if (closest === null || candidate < closest) closest = candidate
      }
    }
  }
  return closest
}

function capsuleNormal(point, base, height, radius) {
  const axisY = clamp(point.y, (base.y || 0) + radius, (base.y || 0) + Math.max(radius, height - radius))
  return normalizedVector({x: point.x - base.x, y: point.y - axisY, z: point.z - base.z})
}

function ballisticVelocity(origin, target, speed, gravity) {
  const dx = target.x - origin.x
  const dz = target.z - origin.z
  const planar = Math.hypot(dx, dz)
  if (planar <= 1e-6) return scaleVec(normalizedVector(subtractVec(target, origin)), speed)
  const dy = target.y - origin.y
  const speedSquared = speed ** 2
  const discriminant = speedSquared ** 2 - gravity * (gravity * planar ** 2 + 2 * dy * speedSquared)
  if (discriminant < 0) return scaleVec(normalizedVector(subtractVec(target, origin)), speed)
  const tangent = (speedSquared - Math.sqrt(discriminant)) / (gravity * planar)
  const horizontalSpeed = speed / Math.sqrt(1 + tangent ** 2)
  return {
    x: dx / planar * horizontalSpeed,
    y: horizontalSpeed * tangent,
    z: dz / planar * horizontalSpeed,
  }
}
