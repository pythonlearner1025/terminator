import mapData from './data/map.json' with {type: 'json'}
import unitsData from './data/units.json' with {type: 'json'}
import weaponsData from './data/weapons.json' with {type: 'json'}
import * as scoutBrain from './brains/default-scout.js'
import * as endoBrain from './brains/default-endo.js'
import * as heavyBrain from './brains/default-heavy.js'
import {NavGrid} from './nav.js'
import {SeededRng} from './rng.js'
import {FuelExhaustedError, UnitScriptRegistry} from './sandbox/index.js'
import {
  clamp,
  copyVec,
  directionFromAngles,
  distance,
  moveAngle,
  normalizeAngle,
  planarDistance,
  pointInsideExpandedBox,
  rayAabb,
  raySphere,
  round,
  yawTo,
} from './math.js'

export const TICK_RATE = 60
export const TICK_SECONDS = 1 / TICK_RATE

export const EMPTY_INPUTS = Object.freeze({
  move: Object.freeze({x: 0, z: 0}),
  yaw: 0,
  pitch: 0,
  fire: false,
  reload: false,
  switchTo: null,
  sprint: false,
  crouch: false,
  grenade: false,
  melee: false,
  ready: false,
})

const DEFAULT_BRAINS = {scout: scoutBrain, endo: endoBrain, heavy: heavyBrain}
const SOUND_RADII = {gunshot: 60, footstep: 12, reload: 10, explosion: 60}
const PLAYER_RADIUS = 0.38
const PLAYER_EYE_HEIGHT = 1.65
const CROUCH_EYE_HEIGHT = 1.12
const PLAYER_HEIGHT = 1.8
const CROUCH_HEIGHT = 1.25
const SURFACE_EPSILON = 0.04

/**
 * Deterministic, headless game state. One call to step(inputs) advances exactly one
 * 1/60 second tick. Inputs are absolute state, not mouse or key deltas.
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
    this.replay = []
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
    this.waveStartedAtTick = 0
    this.phaseTicksLeft = 0
    this.waveBudget = 0
    this.performanceMultiplier = 1
    this.skynet = {
      name: 'BUILT-IN',
      connected: true,
      fallbackCount: 0,
      revs: Object.fromEntries(Object.keys(this.unitCatalog.types).map((type) => [type, this.scriptRegistry.current(type)?.rev || 1])),
    }
    this.transmission = 'RESISTANCE SIGNAL ACQUIRED'
    this.player = this.createPlayer()
    this.previousInputs = normalizeInputs(EMPTY_INPUTS)
    this.telemetry = this.createTelemetry()
  }

  get time() {
    return this.tick * TICK_SECONDS
  }

  get aliveUnits() {
    return this.units.filter((unit) => unit.alive)
  }

  createPlayer() {
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
      grenades: 1,
      scrap: 0,
      alive: true,
      lastFootstepAtTick: -1000,
    }
  }

  createTelemetry() {
    const shots = Object.fromEntries(Object.keys(this.weaponCatalog.weapons).map((id) => [id, {fired: 0, hits: 0}]))
    return {
      playerPath: [],
      heatmap: {},
      damageTaken: [],
      kills: [],
      shots,
      reloads: [],
      healthArmor: [],
      purchases: [],
      units: {},
      timeToClear: null,
      appliedBudget: 0,
      knobs: {},
      counters: {kills: 0, damageEvents: 0, shots: 0, hits: 0},
    }
  }

  resetWaveTelemetry({budget = 0, knobs = {}} = {}) {
    this.telemetry = this.createTelemetry()
    this.telemetry.appliedBudget = budget
    this.telemetry.knobs = structuredClone(knobs)
    this.waveStartedAtTick = this.tick
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
    return [...this.map.colliders, ...this.dynamicColliders()]
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
      const hit = rayAabb(from, direction, collider.center, collider.size, length)
      if (hit !== null && hit > 1e-4 && hit < length - 1e-3) return false
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
    if (this.aliveUnits.length >= this.unitCatalog.maxAlive) return null
    const unitId = id || `${typeId}-${this.nextUnitId++}`
    if (this.unitById.has(unitId)) throw new Error(`Duplicate unit id: ${unitId}`)
    const resolvedRev = rev ?? (Object.hasOwn(this.brainOverrides, typeId) ? 1 : this.scriptRegistry.current(typeId)?.rev || 1)
    const spawnPos = copyVec(pos)
    const spawnSurface = this.nav.supportAt(spawnPos, spawnPos.y)
    if (spawnSurface) spawnPos.y = spawnSurface.y
    const unit = {
      id: unitId,
      type: typeId,
      rev: resolvedRev,
      hp: type.hp,
      maxHp: type.hp,
      pos: spawnPos,
      vel: {x: 0, y: 0, z: 0},
      yaw,
      alive: true,
      spawnedAt: this.time,
      spawnedAtTick: this.tick,
      diedAtTick: null,
      firstDamagedAtTick: null,
      cooldown: 0,
      shotCooldown: 0,
      burstRemaining: 0,
      spinUp: 0,
      playerVisible: false,
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

  createUnitBrain(typeId, rev) {
    if (Object.hasOwn(this.brainOverrides, typeId)) return this.brainOverrides[typeId]
    return this.scriptRegistry.createBrain(typeId, rev).brain
  }

  step(rawInputs = EMPTY_INPUTS) {
    const inputs = normalizeInputs(rawInputs)
    this.replay.push(inputs)
    this.cleanupSignals()
    this.updatePlayer(inputs)
    this.lastBrainTickCount = 0
    const brainPhase = this.tick % 6
    for (const unit of this.units) {
      if (!unit.alive || unit.brainPhase !== brainPhase) continue
      this.tickBrain(unit)
      this.lastBrainTickCount += 1
    }
    for (const unit of this.units) if (unit.alive) this.updateUnit(unit)
    this.updateHazards()
    this.sampleTelemetry()
    this.previousInputs = inputs
    this.tick += 1
    return this
  }

  updatePlayer(inputs) {
    const player = this.player
    player.yaw = inputs.yaw
    player.pitch = clamp(inputs.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
    player.crouch = inputs.crouch || !this.playerHasHeadClearance(player.pos, PLAYER_HEIGHT)
    if (!player.alive) return

    if (inputs.switchTo) this.switchWeapon(inputs.switchTo)
    player.fireCooldown = Math.max(0, player.fireCooldown - TICK_SECONDS)
    player.meleeCooldown = Math.max(0, player.meleeCooldown - TICK_SECONDS)
    player.grenadeCooldown = Math.max(0, player.grenadeCooldown - TICK_SECONDS)
    if (player.reloadTimer > 0) {
      player.reloadTimer = Math.max(0, player.reloadTimer - TICK_SECONDS)
      if (player.reloadTimer === 0) this.finishReload()
    }

    this.movePlayer(inputs)
    if (inputs.reload && !this.previousInputs.reload) this.startReload()
    if (inputs.melee && !this.previousInputs.melee) this.playerMelee()
    if (inputs.grenade && !this.previousInputs.grenade) this.throwGrenade()
    if (inputs.fire) this.playerFire()
  }

  movePlayer(inputs) {
    const player = this.player
    let x = clamp(inputs.move.x, -1, 1)
    let z = clamp(inputs.move.z, -1, 1)
    const magnitude = Math.hypot(x, z)
    if (magnitude > 1) {
      x /= magnitude
      z /= magnitude
    }
    const moving = magnitude > 0.01
    const canSprint = inputs.sprint && moving && !player.crouch && player.sprintStamina > 0
    if (canSprint) player.sprintStamina = Math.max(0, player.sprintStamina - TICK_SECONDS)
    else player.sprintStamina = Math.min(6, player.sprintStamina + TICK_SECONDS * 1.5)
    const speed = player.crouch ? 2.6 : canSprint ? 7.5 : 5
    const forwardX = Math.sin(player.yaw)
    const forwardZ = Math.cos(player.yaw)
    const rightX = Math.cos(player.yaw)
    const rightZ = -Math.sin(player.yaw)
    player.vel.x = (rightX * x + forwardX * z) * speed
    player.vel.z = (rightZ * x + forwardZ * z) * speed
    const bodyHeight = player.crouch ? CROUCH_HEIGHT : PLAYER_HEIGHT
    let grounded = Boolean(this.nav.supportAt(player.pos, player.pos.y, {
      radius: PLAYER_RADIUS,
      maxAbove: SURFACE_EPSILON,
      maxBelow: SURFACE_EPSILON,
    })) && player.vel.y <= 0
    const nextX = clamp(player.pos.x + player.vel.x * TICK_SECONDS, this.map.bounds.minX + PLAYER_RADIUS, this.map.bounds.maxX - PLAYER_RADIUS)
    const nextZ = clamp(player.pos.z + player.vel.z * TICK_SECONDS, this.map.bounds.minZ + PLAYER_RADIUS, this.map.bounds.maxZ - PLAYER_RADIUS)
    grounded = this.movePlayerAxis('x', nextX, bodyHeight, grounded)
    grounded = this.movePlayerAxis('z', nextZ, bodyHeight, grounded)
    this.updatePlayerVertical(bodyHeight, grounded)
    if (moving) {
      const interval = canSprint ? 15 : 24
      if (this.tick - player.lastFootstepAtTick >= interval) {
        player.lastFootstepAtTick = this.tick
        this.addSound('footstep', player.pos)
      }
    }
  }

  movePlayerAxis(axis, value, bodyHeight, grounded) {
    const player = this.player
    const candidate = {...player.pos, [axis]: value}
    const support = grounded ? this.nav.supportAt(candidate, player.pos.y, {radius: PLAYER_RADIUS}) : null
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

  updatePlayerVertical(bodyHeight, grounded) {
    const player = this.player
    if (grounded) {
      player.vel.y = 0
      return
    }
    const fromY = player.pos.y
    player.vel.y = Math.max(-30, player.vel.y - (this.map.walkable?.gravity ?? 18) * TICK_SECONDS)
    let toY = fromY + player.vel.y * TICK_SECONDS
    if (player.vel.y > 0) {
      const ceiling = this.playerCeilingBetween(player.pos, fromY + bodyHeight, toY + bodyHeight)
      if (ceiling !== null) {
        toY = ceiling - bodyHeight
        player.vel.y = 0
      }
    } else {
      const landing = this.nav.landingSurface(player.pos, fromY, toY, PLAYER_RADIUS)
      if (landing && this.playerHasHeadClearance({...player.pos, y: landing.y}, bodyHeight, landing)) {
        player.pos.y = landing.y
        player.vel.y = 0
        return
      }
    }
    player.pos.y = toY
  }

  playerCeilingBetween(pos, fromHeadY, toHeadY) {
    let ceiling = null
    for (const collider of this.activeColliders()) {
      if (collider.kind !== 'floor' || this.nav.isMovementHole(collider.id, pos, PLAYER_RADIUS)) continue
      if (!pointInsideExpandedBox(pos, collider, PLAYER_RADIUS)) continue
      const bottom = collider.center.y - collider.size.y / 2
      if (bottom < fromHeadY - SURFACE_EPSILON || bottom > toHeadY + SURFACE_EPSILON) continue
      if (ceiling === null || bottom < ceiling) ceiling = bottom
    }
    return ceiling
  }

  playerHasHeadClearance(pos, bodyHeight, support = null) {
    for (const collider of this.activeColliders()) {
      if (collider.kind !== 'floor' || collider.id === support?.colliderId) continue
      if (this.nav.isMovementHole(collider.id, pos, PLAYER_RADIUS)) continue
      if (!pointInsideExpandedBox(pos, collider, PLAYER_RADIUS)) continue
      const bottom = collider.center.y - collider.size.y / 2
      const top = collider.center.y + collider.size.y / 2
      if (top > pos.y + SURFACE_EPSILON && bottom < pos.y + bodyHeight - SURFACE_EPSILON) return false
    }
    return true
  }

  positionBlocked(pos, radius = 0, height = PLAYER_HEIGHT) {
    return this.activeColliders().some((collider) => {
      if (!collider.navBlock) return false
      if (collider.kind === 'stair' && this.nav.isSurfaceCollider(collider.id)) return false
      if (!pointInsideExpandedBox(pos, collider, radius)) return false
      const bottom = collider.center.y - collider.size.y / 2
      const top = collider.center.y + collider.size.y / 2
      return top > (pos.y || 0) + SURFACE_EPSILON && bottom < (pos.y || 0) + height - SURFACE_EPSILON
    })
  }

  switchWeapon(requested) {
    const id = typeof requested === 'number' ? this.player.weaponSlots[requested - 1] : requested
    if (!id || !this.player.ammo[id]?.owned) return false
    this.player.activeWeapon = id
    this.player.reloadTimer = 0
    return true
  }

  startReload() {
    const player = this.player
    const id = player.activeWeapon
    const ammo = player.ammo[id]
    const weapon = this.weaponCatalog.weapons[id]
    if (!weapon?.mag || !ammo || player.reloadTimer > 0 || ammo.mag >= weapon.mag || ammo.reserve <= 0) return false
    player.reloadTimer = weapon.reloadSeconds
    this.telemetry.reloads.push({
      t: this.waveTime(),
      weapon: id,
      magazineFraction: round(ammo.mag / weapon.mag, 4),
    })
    this.addSound('reload', player.pos)
    this.emit('reload', {weapon: id, magazineFraction: round(ammo.mag / weapon.mag, 4)})
    return true
  }

  finishReload() {
    const player = this.player
    const id = player.activeWeapon
    const ammo = player.ammo[id]
    const weapon = this.weaponCatalog.weapons[id]
    if (!ammo || !weapon?.mag) return
    const rounds = Math.min(weapon.mag, ammo.reserve)
    ammo.mag = rounds
    ammo.reserve -= rounds
    this.emit('reload_complete', {weapon: id, mag: ammo.mag, reserve: ammo.reserve})
  }

  playerFire() {
    const player = this.player
    const id = player.activeWeapon
    const weapon = this.weaponCatalog.weapons[id]
    const ammo = player.ammo[id]
    if (!weapon || !ammo || player.fireCooldown > 0 || player.reloadTimer > 0 || ammo.mag <= 0) return false
    ammo.mag -= 1
    player.fireCooldown = 1 / weapon.rate
    const origin = {...player.pos, y: player.pos.y + (player.crouch ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT)}
    let anyHit = false
    let headshot = false
    let killed = false
    let hitUnitId = null
    for (let pellet = 0; pellet < (weapon.pellets || 1); pellet += 1) {
      const spread = weapon.spreadDeg * Math.PI / 180
      const yaw = player.yaw + this.rng.range(-spread, spread)
      const pitch = player.pitch + this.rng.range(-spread, spread)
      const result = this.hitscan({origin, direction: directionFromAngles(yaw, pitch), weaponId: id, damage: weapon.damage, source: 'player'})
      if (result.kind === 'unit') {
        anyHit = true
        headshot ||= result.headshot
        killed ||= result.killed
        hitUnitId ||= result.unitId
      }
    }
    this.recordShot(id, anyHit)
    this.addSound('gunshot', player.pos)
    this.emit('shot', {by: 'player', weapon: id, hit: anyHit, headshot, killed, unitId: hitUnitId, origin})
    return true
  }

  playerMelee() {
    const player = this.player
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
    if (best) this.damageUnit(best.unit.id, weapon.damage, {source: 'player', weapon: 'knife', point: {
      x: player.pos.x + forward.x * best.distance,
      y: player.pos.y + 1,
      z: player.pos.z + forward.z * best.distance,
    }})
    this.recordShot('knife', hit)
    this.addSound('gunshot', player.pos, 8)
    this.emit('shot', {by: 'player', weapon: 'knife', hit, headshot: false, killed: Boolean(best && !best.unit.alive), unitId: best?.unit.id || null})
    return true
  }

  throwGrenade() {
    const player = this.player
    const weapon = this.weaponCatalog.weapons.grenade
    if (player.grenades <= 0 || player.grenadeCooldown > 0) return false
    player.grenades -= 1
    player.grenadeCooldown = 1
    const forward = directionFromAngles(player.yaw, 0)
    const center = {x: player.pos.x + forward.x * 6, y: 0.4, z: player.pos.z + forward.z * 6}
    let hit = false
    for (const unit of this.units) {
      if (!unit.alive) continue
      const dist = distance(center, unit.pos)
      if (dist > weapon.radius) continue
      hit = true
      this.damageUnit(unit.id, weapon.damage * (1 - dist / (weapon.radius * 1.5)), {source: 'player', weapon: 'grenade', point: center})
    }
    this.recordShot('grenade', hit)
    this.addSound('explosion', center)
    this.emit('explosion', {by: 'player', pos: center, hit})
    return true
  }

  hitscan({origin, direction, weaponId = 'pistol', damage, source = 'player', maxDistance = 100}) {
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1
    const ray = {x: direction.x / length, y: direction.y / length, z: direction.z / length}
    let closest = {kind: 'miss', distance: maxDistance}
    for (const collider of this.activeColliders()) {
      const hitDistance = rayAabb(origin, ray, collider.center, collider.size, maxDistance)
      if (hitDistance !== null && hitDistance < closest.distance) closest = {kind: 'collider', colliderId: collider.id, distance: hitDistance}
    }
    for (const unit of this.units) {
      if (!unit.alive) continue
      const spec = this.unitCatalog.types[unit.type]
      const headCenter = {x: unit.pos.x, y: unit.pos.y + spec.height * 0.84, z: unit.pos.z}
      const headDistance = raySphere(origin, ray, headCenter, spec.radius * 0.5, maxDistance)
      const bodyCenter = {x: unit.pos.x, y: unit.pos.y + spec.height * 0.42, z: unit.pos.z}
      const bodySize = {x: spec.radius * 2, y: spec.height * 0.66, z: spec.radius * 2}
      const bodyDistance = rayAabb(origin, ray, bodyCenter, bodySize, maxDistance)
      let unitDistance = bodyDistance
      let headshot = false
      if (headDistance !== null && (unitDistance === null || headDistance < unitDistance)) {
        unitDistance = headDistance
        headshot = true
      }
      if (unitDistance === null || unitDistance >= closest.distance) continue
      closest = {kind: 'unit', unit, unitId: unit.id, distance: unitDistance, headshot}
    }
    if (closest.kind !== 'unit') return closest

    const point = {
      x: origin.x + ray.x * closest.distance,
      y: origin.y + ray.y * closest.distance,
      z: origin.z + ray.z * closest.distance,
    }
    let multiplier = closest.headshot ? 2 : 1
    let plate = false
    let spine = false
    if (closest.unit.type === 'heavy' && !closest.headshot) {
      const towardShooterX = origin.x - closest.unit.pos.x
      const towardShooterZ = origin.z - closest.unit.pos.z
      const planar = Math.hypot(towardShooterX, towardShooterZ) || 1
      const facingDot = (towardShooterX / planar) * Math.sin(closest.unit.yaw)
        + (towardShooterZ / planar) * Math.cos(closest.unit.yaw)
      if (facingDot > 0.25) {
        multiplier = 0.5
        plate = true
      } else if (facingDot < -0.25) {
        multiplier = 2
        spine = true
      }
    }
    const result = this.damageUnit(closest.unit.id, (damage ?? this.weaponCatalog.weapons[weaponId]?.damage ?? 0) * multiplier, {
      source,
      weapon: weaponId,
      point,
      headshot: closest.headshot,
      plate,
      spine,
      distance: closest.distance,
    })
    return {...closest, ...result, plate, spine, point}
  }

  damageUnit(unitId, amount, context = {}) {
    const unit = this.unitById.get(unitId)
    if (!unit?.alive || amount <= 0) return {damage: 0, killed: false}
    const damage = Math.min(unit.hp, Math.max(0, amount))
    unit.hp = Math.max(0, unit.hp - damage)
    unit.firstDamagedAtTick ??= this.tick
    this.telemetry.counters.damageEvents += 1
    this.emit('unit_damage', {
      unitId: unit.id,
      unitType: unit.type,
      amount: round(damage),
      weapon: context.weapon || 'unknown',
      headshot: Boolean(context.headshot),
      plate: Boolean(context.plate),
      spine: Boolean(context.spine),
    })
    if (unit.hp > 0) return {damage, killed: false}

    unit.alive = false
    unit.diedAtTick = this.tick
    unit.brain?.destroy?.()
    const stats = this.telemetry.units[unit.id]
    stats.lifetime = round((this.tick - unit.spawnedAtTick) * TICK_SECONDS)
    stats.causeOfDeath = context.weapon || context.source || 'damage'
    const playerKill = context.source === 'player'
    if (playerKill) {
      this.player.scrap += this.unitCatalog.types[unit.type].scrap
      const kill = {
        t: this.waveTime(),
        unitType: unit.type,
        unitId: unit.id,
        weapon: context.weapon || this.player.activeWeapon,
        distance: round(context.distance ?? planarDistance(this.player.pos, unit.pos), 3),
        headshot: Boolean(context.headshot),
        timeFromFirstDamage: round((this.tick - (unit.firstDamagedAtTick ?? this.tick)) * TICK_SECONDS),
      }
      this.telemetry.kills.push(kill)
      this.telemetry.counters.kills += 1
      this.emit('kill', kill)
    }
    this.emit('unit_death', {unitId: unit.id, unitType: unit.type, rev: unit.rev, cause: stats.causeOfDeath})
    return {damage, killed: true}
  }

  damagePlayer(amount, attacker = {}) {
    const player = this.player
    if (!player.alive || amount <= 0) return 0
    const armorDamage = Math.min(player.armor, amount * 0.6)
    player.armor -= armorDamage
    const hpDamage = Math.min(player.hp, amount - armorDamage)
    player.hp -= hpDamage
    if (player.hp <= 0) player.alive = false
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
    }
    this.telemetry.damageTaken.push(event)
    this.telemetry.counters.damageEvents += 1
    this.emit('player_damage', event)
    if (!player.alive) this.emit('player_death', {unitId: attacker.id || null, unitType: attacker.type || 'hazard'})
    return hpDamage + armorDamage
  }

  recordShot(weaponId, hit) {
    this.telemetry.shots[weaponId] ??= {fired: 0, hits: 0}
    this.telemetry.shots[weaponId].fired += 1
    this.telemetry.counters.shots += 1
    if (hit) {
      this.telemetry.shots[weaponId].hits += 1
      this.telemetry.counters.hits += 1
    }
  }

  tickBrain(unit) {
    const type = this.unitCatalog.types[unit.type]
    const seen = this.canUnitSeePlayer(unit)
    const sounds = this.heardSounds(unit)
    const newStimulus = (seen && !unit.playerVisible) || (!seen && sounds.length > 0 && unit.lastStimulusTick !== sounds.at(-1).tick)
    if (newStimulus) {
      unit.reactionReadyTick = this.tick + Math.ceil(type.reactionDelay * TICK_RATE)
      unit.lastStimulusTick = sounds.at(-1)?.tick ?? this.tick
    }
    unit.playerVisible = seen
    if (seen) unit.lastKnownPlayer = {pos: copyVec(this.player.pos), t: this.waveTime()}
    else if (unit.lastKnownPlayer && this.waveTime() - unit.lastKnownPlayer.t > 10) unit.lastKnownPlayer = null
    const previousIntent = structuredClone(unit.intent)
    unit.intent.fire = false
    unit.intent.melee = false
    const sense = this.buildSense(unit, sounds)
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

  smokeScript({unitType, source, rev}) {
    const smokeWorld = new World({
      map: this.map,
      units: this.unitCatalog,
      weapons: this.weaponCatalog,
      scriptSources: {[unitType]: {source, rev}},
      seed: this.seed,
    })
    const player = smokeWorld.player.pos
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
    }
  }

  buildSense(unit, sounds = this.heardSounds(unit)) {
    const playerVisible = unit.playerVisible
    const player = playerVisible ? {
      pos: copyVec(this.player.pos),
      dist: planarDistance(unit.pos, this.player.pos),
      vel: copyVec(this.player.vel),
      facingMe: Math.abs(normalizeAngle(yawTo(this.player.pos, unit.pos) - this.player.yaw)) <= Math.PI / 6,
      hp: this.player.hp,
      armor: this.player.armor,
      weapon: this.player.activeWeapon,
      reloading: this.player.reloadTimer > 0,
    } : null
    return {
      time: this.waveTime(),
      rand: () => this.rng.next(),
      player,
      lastKnownPlayer: unit.lastKnownPlayer ? {pos: copyVec(unit.lastKnownPlayer.pos), t: unit.lastKnownPlayer.t} : null,
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

  canUnitSeePlayer(unit) {
    if (!this.player.alive || !this.visionConeTest(unit, this.player.pos)) return false
    return this.lineOfSight(this.unitEye(unit), {...this.player.pos, y: this.player.pos.y + (this.player.crouch ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT)})
  }

  unitEye(unit) {
    return {...unit.pos, y: unit.pos.y + this.unitCatalog.types[unit.type].height * 0.78}
  }

  heardSounds(unit) {
    return this.sounds.filter((sound) => this.tick - sound.tick <= 120 && planarDistance(unit.pos, sound.pos) <= sound.radius)
  }

  pathIntent(unit, pos) {
    const path = this.pathForUnit(unit, pos)
    if (!path?.length) return null
    const index = Math.min(unit.pathCache.index + 1, path.length - 1)
    return {next: copyVec(path[index]), dist: this.nav.pathDistance(path.slice(index))}
  }

  pathForUnit(unit, target) {
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
    this.moveUnit(unit, spec)
    const faceTarget = unit.intent.aimAt || unit.intent.face || unit.intent.moveTo
    if (faceTarget) unit.yaw = moveAngle(unit.yaw, yawTo(unit.pos, faceTarget), spec.turnRateDeg * Math.PI / 180 * TICK_SECONDS)
    const canReact = this.tick >= unit.reactionReadyTick
    if (spec.attack === 'melee') this.updateMeleeUnit(unit, spec, canReact)
    else if (spec.attack === 'burst') this.updateBurstUnit(unit, spec, canReact)
    else this.updateHeavyUnit(unit, spec, canReact)
  }

  moveUnit(unit, spec) {
    if (!unit.intent.moveTo || this.tick < unit.reactionReadyTick) {
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

  updateMeleeUnit(unit, spec, canReact) {
    if (!unit.intent.melee || !canReact || unit.cooldown > 0 || !this.player.alive) return
    if (planarDistance(unit.pos, this.player.pos) > spec.range) return
    unit.cooldown = spec.cooldown
    const dealt = this.damagePlayer(spec.damage, unit)
    this.telemetry.units[unit.id].damageDealt += dealt
    this.emit('melee', {unitId: unit.id, hit: dealt > 0})
  }

  updateBurstUnit(unit, spec, canReact) {
    if (!canReact || !this.player.alive) return
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
    if (!unit.intent.fire || !canReact || !this.player.alive || !this.unitAimAligned(unit, spec)) {
      unit.spinUp = Math.max(0, unit.spinUp - TICK_SECONDS * 2)
      return
    }
    unit.spinUp = Math.min(spec.spinUp, unit.spinUp + TICK_SECONDS)
    if (unit.spinUp < spec.spinUp || unit.shotCooldown > 0) return
    this.fireUnitWeapon(unit, spec)
    unit.shotCooldown = 1 / spec.roundsPerSecond
  }

  unitAimAligned(unit, spec) {
    const target = unit.intent.aimAt || unit.intent.face
    if (!target) return false
    return Math.abs(normalizeAngle(yawTo(unit.pos, target) - unit.yaw)) <= spec.spreadDeg * Math.PI / 180
  }

  fireUnitWeapon(unit, spec) {
    const origin = this.unitEye(unit)
    const target = {...this.player.pos, y: this.player.pos.y + (this.player.crouch ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT)}
    const dist = distance(origin, target)
    const baseYaw = yawTo(origin, target)
    const basePitch = Math.atan2(target.y - origin.y, Math.hypot(target.x - origin.x, target.z - origin.z))
    const spread = spec.spreadDeg * Math.PI / 180
    const yawError = this.rng.range(-spread, spread)
    const pitchError = this.rng.range(-spread, spread)
    const direction = directionFromAngles(baseYaw + yawError, basePitch + pitchError)
    const blockerDistance = this.closestColliderDistance(origin, direction, dist)
    const angularRadius = Math.atan2(PLAYER_RADIUS, Math.max(0.1, dist))
    const hit = blockerDistance === null && Math.hypot(yawError, pitchError) <= angularRadius * 1.5
    let dealt = 0
    if (hit) dealt = this.damagePlayer(spec.damage, unit)
    const stats = this.telemetry.units[unit.id]
    stats.shotsFired += 1
    stats.damageDealt += dealt
    this.recordShot(`unit:${unit.type}`, hit)
    this.emit('shot', {by: unit.id, unitType: unit.type, weapon: spec.attack, hit, origin, target})
  }

  closestColliderDistance(origin, direction, maxDistance) {
    let closest = null
    for (const collider of this.activeColliders()) {
      if (collider.blocksSight === false) continue
      const hit = rayAabb(origin, direction, collider.center, collider.size, maxDistance)
      if (hit !== null && hit > 1e-4 && (closest === null || hit < closest)) closest = hit
    }
    return closest
  }

  updateHazards() {
    if (!this.player.alive || this.tick % 30 !== 0) return
    for (const active of this.mapState.hazards) {
      const slot = this.map.hazardSlots.find((item) => item.id === active.slot)
      if (!slot || !pointInsideExpandedBox(this.player.pos, {center: slot.pos, size: slot.size})) continue
      this.damagePlayer(active.kind === 'electric' ? 12 : 8, {type: `hazard:${active.kind}`, pos: slot.pos})
    }
  }

  addSound(kind, pos, radius = SOUND_RADII[kind] || 0) {
    const sound = {kind, pos: copyVec(pos), tick: this.tick, t: this.waveTime(), radius}
    this.sounds.push(sound)
    this.emit('sound', {kind, pos: sound.pos, radius})
  }

  cleanupSignals() {
    this.sounds = this.sounds.filter((sound) => this.tick - sound.tick <= 120)
    this.messages = this.messages.filter((message) => this.tick - message.tick <= 120)
    for (const unit of this.units) unit.broadcasts = unit.broadcasts.filter((tick) => this.tick - tick < 60)
  }

  sampleTelemetry() {
    if (this.tick % 15 === 0) {
      const point = {t: this.waveTime(), ...copyVec(this.player.pos)}
      this.telemetry.playerPath.push(point)
      const cellX = Math.floor((this.player.pos.x - this.map.bounds.minX) / 2)
      const cellZ = Math.floor((this.player.pos.z - this.map.bounds.minZ) / 2)
      const key = `${cellX}:${cellZ}`
      this.telemetry.heatmap[key] = round((this.telemetry.heatmap[key] || 0) + 0.25, 2)
    }
    if (this.tick % 60 === 0) {
      this.telemetry.healthArmor.push({t: this.waveTime(), hp: round(this.player.hp), armor: round(this.player.armor)})
    }
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
 * {move:{x,z}, yaw, pitch, fire, reload, switchTo, sprint, crouch,
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
    reload: Boolean(inputs.reload),
    switchTo: inputs.switchTo ?? null,
    sprint: Boolean(inputs.sprint),
    crouch: Boolean(inputs.crouch),
    grenade: Boolean(inputs.grenade),
    melee: Boolean(inputs.melee),
    ready: Boolean(inputs.ready),
  }
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}
