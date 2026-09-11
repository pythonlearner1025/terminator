import {WebAudioEngine} from './engine.js'

const PLAYER_WEAPONS = {
  pistol: 'pistol_9mm',
  m4: 'm4_rifle',
  shotgun: 'shotgun_fire',
  plasma: 'plasma_bolt',
}

const RELOADS = {
  pistol: 'reload_pistol',
  m4: 'reload_m4',
  shotgun: 'reload_shotgun',
  plasma: 'reload_plasma',
}

const SERVO_STEPS = {
  scout: {name: 'servo_scout', stride: 1.45},
  endo: {name: 'servo_endo', stride: 1.2},
  heavy: {name: 'servo_heavy', stride: 0.82},
}

export class AudioBindings {
  constructor({world = null, viewer = null, camera = null, engine = null, ownsEngine = engine == null, phaseProvider = null, eventBus = null} = {}) {
    this.world = world
    this.viewer = viewer
    this.camera = camera || viewer?.scene?.mainCamera || null
    this.engine = engine || new WebAudioEngine({camera: this.camera})
    this.ownsEngine = ownsEngine
    this.phaseProvider = phaseProvider
    this.eventBus = eventBus
    this.eventIndex = 0
    this.unitMotion = new Map()
    this.lastTransmission = null
    this.lastDryFireTick = -1000
    this.pendingEvents = []
    this.unsubscribe = null
    this.started = false
  }

  start(world = this.world) {
    this.stop({closeEngine: false})
    this.world = world
    this.camera = this.camera || this.viewer?.scene?.mainCamera || null
    this.engine.camera = this.camera
    this.engine.start()
    if (globalThis.navigator?.userActivation?.isActive) void this.engine.unlock()
    const bus = this.eventBus || world?.events || world?.eventBus || world?.bus
    this.unsubscribe = typeof bus?.subscribe === 'function'
      ? bus.subscribe((event) => {
        if (event.type === 'phase') this._receiveEvent(event)
      })
      : null
    this.eventIndex = 0
    if (this.unsubscribe && Array.isArray(bus.history)) {
      const phase = bus.history.findLast?.((event) => event.type === 'phase')
      if (phase) this.pendingEvents.push(phase)
    }
    this.lastTransmission = null
    this.lastDryFireTick = -1000
    this.started = true
    this.engine.setCombatActive(this._phase() === 'wave')
    return this
  }

  sync(world = this.world) {
    if (!this.started || !world) return
    this.world = world
    this.engine.updateListener(this.viewer?.scene?.mainCamera || this.camera)
    this.engine.setCombatActive(this._phase() === 'wave')
    if (!this.engine.context || this.engine.context.state !== 'running') return

    for (const event of this.pendingEvents.splice(0)) this._processEvent(event)
    for (; this.eventIndex < world.eventLog.length; this.eventIndex += 1) {
      const event = world.eventLog[this.eventIndex]
      if (this.unsubscribe && event.type === 'phase') continue
      this._processEvent(event)
    }
    this._syncUnitMotion()
    this._syncDryFire()
    this._syncTransmission()
    this._syncHeartbeat()
  }

  _receiveEvent(event) {
    if (!this.started) return
    if (this.engine.context?.state === 'running') this._processEvent(event)
    else {
      this.pendingEvents.push(event)
      if (this.pendingEvents.length > 256) this.pendingEvents.shift()
    }
  }

  _processEvent(event) {
    const world = this.world
    if (event.type === 'phase') {
      if (event.phase === 'wave') {
        this.engine.play('wave_klaxon')
        this.engine.setCombatActive(true)
      } else if (event.phase === 'intermission') {
        this.engine.play('wave_clear')
        this.engine.play('trader_open', {delay: 0.45})
        this.engine.setCombatActive(false)
      } else this.engine.setCombatActive(false)
      return
    }

    if (event.type === 'unit_spawn') {
      this.engine.play('spawn_gate', {position: this._unitPosition(event.unitId)})
      return
    }

    if (event.type === 'shot') {
      if (event.by === 'player') this._playerShot(event)
      else this._unitShot(event)
      return
    }

    if (event.type === 'unit_damage') {
      this.engine.play('sparks_metal', {position: this._unitPosition(event.unitId), gain: event.plate ? 1.2 : 0.82})
      return
    }

    if (event.type === 'unit_death') {
      this.engine.play('unit_death', {position: this._unitPosition(event.unitId), pitch: event.unitType === 'heavy' ? 0.78 : event.unitType === 'scout' ? 1.12 : 1})
      this._stopHeavy(event.unitId, true)
      return
    }

    if (event.type === 'reload') {
      const name = RELOADS[event.weapon]
      if (name) this.engine.play(name)
      return
    }

    if (event.type === 'explosion') {
      this.engine.play('grenade_throw', {gain: 0.9})
      this.engine.play('grenade_explosion', {position: event.pos, delay: 0.16})
      return
    }

    if (event.type === 'sound' && event.kind === 'footstep') {
      const surface = surfaceAt(event.pos)
      this.engine.play(surface === 'metal' ? 'footstep_metal' : 'footstep_concrete', {position: event.pos, refDistance: 1})
      return
    }

    if (event.type === 'purchase') {
      this.engine.play('cash_register')
      return
    }

    if (event.type === 'transmission') this._playTransmission(event.text || event.message || '')

    if (event.type === 'melee') {
      const unit = world.unitById.get(event.unitId)
      if (unit?.type === 'scout' && event.hit) this.engine.play('knife_hit', {position: unit.pos, pitch: 0.72})
    }
  }

  _playerShot(event) {
    if (event.weapon === 'knife') {
      this.engine.play('knife_swing')
      if (event.hit) this.engine.play('knife_hit', {position: this._unitPosition(event.unitId)})
      return
    }
    const name = PLAYER_WEAPONS[event.weapon]
    if (name) this.engine.play(name)
    if (event.weapon === 'shotgun') this.engine.play('shotgun_pump', {delay: 0.34})
    if (event.hit) this.engine.play('sparks_metal', {position: this._unitPosition(event.unitId), gain: 0.7})
    if (event.headshot) this.engine.play('headshot_clang', {position: this._unitPosition(event.unitId)})
  }

  _unitShot(event) {
    const position = event.origin || this._unitPosition(event.by)
    if (event.unitType === 'endo') {
      this.engine.play('plasma_bolt', {position})
      this.engine.play(event.hit ? 'plasma_impact_player' : 'plasma_impact_concrete', {
        position: event.hit ? this.world.player.pos : event.target,
        delay: 0.07,
      })
      return
    }
    if (event.unitType === 'heavy') {
      const tag = `minigun:${event.by}`
      this.engine.startLoop('minigun_loop', {tag, position, bus: 'effects', fadeIn: 0.04})
    }
  }

  _syncUnitMotion() {
    const world = this.world
    const aliveIds = new Set()
    for (const unit of world.units) {
      if (!unit.alive) continue
      aliveIds.add(unit.id)
      let state = this.unitMotion.get(unit.id)
      if (!state) {
        state = {pos: {...unit.pos}, traveled: 0, spin: 0, screechTick: -1000}
        this.unitMotion.set(unit.id, state)
      }
      const moved = Math.hypot(unit.pos.x - state.pos.x, unit.pos.z - state.pos.z)
      state.traveled += moved
      state.pos = {...unit.pos}
      const step = SERVO_STEPS[unit.type]
      if (step && state.traveled >= step.stride) {
        state.traveled %= step.stride
        this.engine.play(step.name, {position: unit.pos})
        if (unit.type === 'heavy') this.engine.play('heavy_stomp', {position: unit.pos, gain: 0.78})
      }

      if (unit.type === 'scout') {
        const speed = Math.hypot(unit.vel.x, unit.vel.z)
        const distance = Math.hypot(unit.pos.x - world.player.pos.x, unit.pos.z - world.player.pos.z)
        if (speed > 5.5 && distance < 14 && world.tick - state.screechTick >= 240) {
          state.screechTick = world.tick
          this.engine.play('scout_screech', {position: unit.pos})
        }
      }

      if (unit.type === 'heavy') this._syncHeavy(unit, state)
    }
    for (const [unitId, state] of this.unitMotion) {
      if (aliveIds.has(unitId)) continue
      if (state.spin > 0) this._stopHeavy(unitId, true)
      this.unitMotion.delete(unitId)
    }
  }

  _syncHeavy(unit, state) {
    const spin = Math.max(0, unit.spinUp || 0)
    const required = this.world.unitCatalog.types.heavy?.spinUp || 1
    if (spin > 0 && state.spin <= 0) this.engine.play('minigun_spinup', {position: unit.pos})
    if (spin >= required * 0.92) this.engine.startLoop('minigun_loop', {tag: `minigun:${unit.id}`, position: unit.pos, fadeIn: 0.06})
    else if (spin < required * 0.5 && this.engine.loops.has(`minigun:${unit.id}`)) this.engine.stopLoop(`minigun:${unit.id}`, {fade: 0.08})
    if (spin <= 0 && state.spin > 0) this.engine.play('minigun_spindown', {position: unit.pos})
    this.engine.updateLoopPosition(`minigun:${unit.id}`, unit.pos)
    state.spin = spin
  }

  _stopHeavy(unitId, playTail) {
    const state = this.unitMotion.get(unitId)
    const position = this._unitPosition(unitId)
    const stopped = this.engine.stopLoop(`minigun:${unitId}`, {fade: 0.08})
    if (playTail && (stopped || state?.spin > 0)) this.engine.play('minigun_spindown', {position})
    if (state) state.spin = 0
  }

  _syncDryFire() {
    const world = this.world
    const input = world.replay.at(-1)
    const player = world.player
    const ammo = player.ammo[player.activeWeapon]
    if (!input?.fire || !ammo || ammo.mag > 0 || player.reloadTimer > 0 || world.tick - this.lastDryFireTick < 15) return
    this.lastDryFireTick = world.tick
    this.engine.play('dry_fire')
  }

  _syncTransmission() {
    const transmission = String(this.world.transmission || '')
    if (!transmission || transmission === this.lastTransmission) return
    this.lastTransmission = transmission
    this._playTransmission(transmission)
  }

  _playTransmission(text) {
    this.engine.play('skynet_static')
    const characters = [...String(text)].filter((character) => character.trim()).slice(0, 16)
    characters.forEach((_, index) => this.engine.play('typewriter_tick', {delay: 0.05 + index * 0.038, gain: 0.74}))
  }

  _syncHeartbeat() {
    const hp = this.world.player.hp
    if (hp < 35 && hp > 0) {
      this.engine.startLoop('low_health_heartbeat', {tag: 'low-health', gain: hp < 20 ? 1 : 0.72, fadeIn: 0.12})
    } else this.engine.stopLoop('low-health', {fade: 0.22})
  }

  _unitPosition(unitId) {
    const pos = this.world?.unitById?.get(unitId)?.pos
    return pos ? {...pos, y: (pos.y || 0) + 1} : {...(this.world?.player?.pos || {x: 0, y: 0, z: 0})}
  }

  _phase() {
    return this.phaseProvider?.() || this.world?.phase
  }

  stop({closeEngine = this.ownsEngine} = {}) {
    this.started = false
    this.unsubscribe?.()
    this.unsubscribe = null
    for (const unitId of this.unitMotion.keys()) this.engine.stopLoop(`minigun:${unitId}`, {fade: 0})
    this.engine.stopLoop('low-health', {fade: 0})
    this.engine.setCombatActive(false)
    this.unitMotion.clear()
    this.eventIndex = 0
    this.pendingEvents.length = 0
    this.lastTransmission = null
    if (closeEngine) void this.engine.stop()
  }
}

export function bindAudio(options) {
  const bindings = new AudioBindings(options)
  return bindings.start(options.world)
}

export function surfaceAt(pos = {}) {
  const x = Number(pos.x) || 0
  const y = Number(pos.y) || 0
  const z = Number(pos.z) || 0
  const onDock = x >= 17 && z >= -15 && z <= 5
  const onBalcony = y > 2.2 && z >= 14.5 && z <= 27.5 && Math.abs(x) <= 14.5
  return onDock || onBalcony ? 'metal' : 'concrete'
}

export default bindAudio
