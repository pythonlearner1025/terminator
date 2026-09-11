import {SOUND_CATALOG} from './catalog.js'
import {renderSynthBuffer} from './synth.js'

const DEFAULT_VOLUMES = Object.freeze({master: 0.8, music: 0.55, effects: 0.85})
const GESTURES = ['pointerdown', 'keydown', 'touchstart']

export class WebAudioEngine {
  constructor({camera = null, catalog = SOUND_CATALOG, contextFactory = null, logger = defaultLogger, volumes = null} = {}) {
    this.camera = camera
    this.catalog = catalog
    this.contextFactory = contextFactory
    this.logger = logger
    this.volumes = {...DEFAULT_VOLUMES}
    for (const source of [readStoredVolumes(), volumes || {}]) {
      for (const key of ['master', 'music', 'effects']) {
        if (Number.isFinite(Number(source[key]))) this.volumes[key] = clamp(Number(source[key]), 0, 1)
      }
    }
    this.context = null
    this.buses = null
    this.buffers = new Map()
    this.voices = new Map()
    this.loops = new Map()
    this.desiredLoops = new Map()
    this.variationCursor = new Map()
    this.running = false
    this.combatActive = false
    this.gestureTarget = null
    this._unlocking = null
    this._randomState = 0x7f4a7c15
    this._boundUnlock = () => { void this.unlock() }
    this._boundSettings = (event) => this.setVolumes(event?.detail || readStoredVolumes())
  }

  start({gestureTarget = globalThis.window, ambient = true} = {}) {
    if (this.running) return this
    this.running = true
    this.gestureTarget = gestureTarget || null
    for (const type of GESTURES) this.gestureTarget?.addEventListener?.(type, this._boundUnlock, {capture: true, passive: true})
    this.gestureTarget?.addEventListener?.('terminator-audio-settings', this._boundSettings)
    globalThis.window?.addEventListener?.('storage', this._boundSettings)
    if (ambient) this.startLoop('ambient_bed', {tag: 'ambient-bed', bus: 'ambient'})
    return this
  }

  async unlock() {
    if (!this.running) return false
    if (this.context?.state === 'running') return true
    if (this._unlocking) return this._unlocking
    this._unlocking = this._createAndResume()
    try {
      return await this._unlocking
    } finally {
      this._unlocking = null
    }
  }

  async _createAndResume() {
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext
      if (!this.contextFactory && !AudioContextClass) return false
      this.context = this.contextFactory ? this.contextFactory() : new AudioContextClass({latencyHint: 'interactive'})
      this._buildBuses()
      this.setVolumes(this.volumes, {immediate: true})
    }
    if (this.context.state === 'suspended') await this.context.resume()
    if (this.context.state !== 'running') return false
    this._removeGestureListeners()
    this.updateListener(this.camera)
    for (const [tag, request] of this.desiredLoops) {
      if (!this.loops.has(tag)) this._play(request.name, {...request.options, tag, loop: true})
    }
    this._applyMusicMix(true)
    return true
  }

  _buildBuses() {
    const context = this.context
    const master = context.createGain()
    const music = context.createGain()
    const effects = context.createGain()
    const ambient = context.createGain()
    const combat = context.createGain()
    const compressor = context.createDynamicsCompressor?.()
    if (compressor) {
      compressor.threshold.value = -8
      compressor.knee.value = 12
      compressor.ratio.value = 5
      compressor.attack.value = 0.003
      compressor.release.value = 0.18
      master.connect(compressor)
      compressor.connect(context.destination)
    } else {
      master.connect(context.destination)
    }
    music.connect(master)
    effects.connect(master)
    ambient.connect(music)
    combat.connect(music)
    this.buses = {master, music, effects, ambient, combat, compressor}
  }

  setVolumes(next = {}, {immediate = false} = {}) {
    for (const key of ['master', 'music', 'effects']) {
      if (Number.isFinite(Number(next[key]))) this.volumes[key] = clamp(Number(next[key]), 0, 1)
    }
    if (!this.context || !this.buses) return this.volumes
    const now = this.context.currentTime
    for (const key of ['master', 'music', 'effects']) {
      const parameter = this.buses[key].gain
      const value = this.volumes[key] ** 1.65
      parameter.cancelScheduledValues?.(now)
      if (immediate) parameter.setValueAtTime(value, now)
      else {
        parameter.setValueAtTime(parameter.value, now)
        parameter.linearRampToValueAtTime(value, now + 0.08)
      }
    }
    return this.volumes
  }

  play(name, options = {}) {
    if (!this.running || !this.context || this.context.state !== 'running') return null
    return this._play(name, options)
  }

  _play(name, options = {}) {
    const definition = this.catalog[name]
    if (!definition || !this.context || !this.buses) return null
    const loop = options.loop ?? definition.loop ?? false
    const tag = options.tag || (loop ? name : null)
    if (tag && this.loops.has(tag)) {
      if (options.position) this.updateLoopPosition(tag, options.position)
      return this.loops.get(tag)
    }
    const variantIndex = this._variationIndex(name, definition, options.variant)
    const bufferKey = `${name}:${variantIndex}`
    let buffer = this.buffers.get(bufferKey)
    if (!buffer) {
      buffer = renderSynthBuffer(this.context, definition.variants[variantIndex], hashString(bufferKey))
      this.buffers.set(bufferKey, buffer)
    }

    const source = this.context.createBufferSource()
    const gainNode = this.context.createGain()
    const baseGain = (definition.gain ?? 1) * (options.gain ?? 1) * this._range(0.94, 1.06)
    const pitch = (options.pitch ?? 1) * this._range(0.965, 1.035)
    const startAt = this.context.currentTime + Math.max(0, options.delay || 0)
    source.buffer = buffer
    source.loop = loop
    source.playbackRate.setValueAtTime(pitch, startAt)
    gainNode.gain.setValueAtTime(loop ? 0 : baseGain, startAt)
    if (loop) gainNode.gain.linearRampToValueAtTime(baseGain, startAt + Math.max(0.01, options.fadeIn ?? 0.08))
    source.connect(gainNode)

    let panner = null
    if (options.position) {
      panner = this.context.createPanner()
      panner.panningModel = 'HRTF'
      panner.distanceModel = 'inverse'
      panner.refDistance = options.refDistance || 2
      panner.maxDistance = options.maxDistance || 75
      panner.rolloffFactor = options.rolloffFactor || 1.15
      panner.coneInnerAngle = 360
      panner.coneOuterAngle = 360
      setPosition(panner, options.position, startAt)
      gainNode.connect(panner)
      panner.connect(this._busFor(definition, options))
    } else {
      gainNode.connect(this._busFor(definition, options))
    }

    const voice = {name, source, gainNode, panner, startedAt: startAt, tag, stopped: false}
    source.onended = () => this._forgetVoice(voice)
    const pool = this.voices.get(name) || []
    const poolSize = Math.max(2, definition.voices || 4)
    while (pool.length >= poolSize) this._stopVoice(pool.shift(), 0.008)
    pool.push(voice)
    this.voices.set(name, pool)
    if (tag) this.loops.set(tag, voice)
    source.start(startAt)
    this._log(name, variantIndex, definition, options)
    return voice
  }

  startLoop(name, options = {}) {
    const tag = options.tag || name
    this.desiredLoops.set(tag, {name, options: {...options, tag}})
    if (!this.running || !this.context || this.context.state !== 'running') return null
    return this._play(name, {...options, tag, loop: true})
  }

  stopLoop(tag, {fade = 0.12, forget = true} = {}) {
    if (forget) this.desiredLoops.delete(tag)
    const voice = this.loops.get(tag)
    if (!voice) return false
    this.loops.delete(tag)
    this._stopVoice(voice, fade)
    return true
  }

  updateLoopPosition(tag, position) {
    const voice = this.loops.get(tag)
    if (!voice?.panner || !this.context) return false
    setPosition(voice.panner, position, this.context.currentTime)
    return true
  }

  setCombatActive(active) {
    const next = Boolean(active)
    if (next === this.combatActive && (next ? this.desiredLoops.has('combat-music') : !this.desiredLoops.has('combat-music'))) return
    this.combatActive = next
    if (next) this.startLoop('combat_music', {tag: 'combat-music', bus: 'combat', fadeIn: 0.3})
    else this.stopLoop('combat-music', {fade: 0.45})
    this._applyMusicMix()
  }

  _applyMusicMix(immediate = false) {
    if (!this.context || !this.buses) return
    const now = this.context.currentTime
    const ambient = this.buses.ambient.gain
    const combat = this.buses.combat.gain
    const targetAmbient = this.combatActive ? 0.3 : 1
    const targetCombat = this.combatActive ? 1 : 0
    for (const [parameter, value] of [[ambient, targetAmbient], [combat, targetCombat]]) {
      parameter.cancelScheduledValues?.(now)
      parameter.setValueAtTime(parameter.value, now)
      if (immediate) parameter.setValueAtTime(value, now)
      else parameter.linearRampToValueAtTime(value, now + 0.35)
    }
  }

  updateListener(camera = this.camera) {
    if (camera) this.camera = camera
    if (!this.context || !this.camera) return false
    const listener = this.context.listener
    const position = cameraPosition(this.camera)
    const quaternion = this.camera.quaternion || {x: 0, y: 0, z: 0, w: 1}
    const forward = rotateVector({x: 0, y: 0, z: -1}, quaternion)
    const up = rotateVector({x: 0, y: 1, z: 0}, quaternion)
    setListenerVector(listener, 'position', position, this.context.currentTime)
    if (listener.forwardX) {
      listener.forwardX.setValueAtTime(forward.x, this.context.currentTime)
      listener.forwardY.setValueAtTime(forward.y, this.context.currentTime)
      listener.forwardZ.setValueAtTime(forward.z, this.context.currentTime)
      listener.upX.setValueAtTime(up.x, this.context.currentTime)
      listener.upY.setValueAtTime(up.y, this.context.currentTime)
      listener.upZ.setValueAtTime(up.z, this.context.currentTime)
    } else listener.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z)
    return true
  }

  async stop() {
    this.running = false
    this._removeGestureListeners()
    this.gestureTarget?.removeEventListener?.('terminator-audio-settings', this._boundSettings)
    globalThis.window?.removeEventListener?.('storage', this._boundSettings)
    this.gestureTarget = null
    this.desiredLoops.clear()
    for (const pool of this.voices.values()) for (const voice of [...pool]) this._stopVoice(voice, 0)
    this.voices.clear()
    this.loops.clear()
    this.buffers.clear()
    const context = this.context
    this.context = null
    this.buses = null
    if (context && context.state !== 'closed') {
      try { await context.close() } catch {}
    }
  }

  _busFor(definition, options) {
    const bus = options.bus || definition.channel || definition.bus || 'effects'
    return this.buses[bus] || this.buses.effects
  }

  _variationIndex(name, definition, requested) {
    if (Number.isInteger(requested)) return Math.abs(requested) % definition.variants.length
    const cursor = this.variationCursor.get(name) || 0
    this.variationCursor.set(name, cursor + 1)
    return cursor % definition.variants.length
  }

  _stopVoice(voice, fade) {
    if (!voice || voice.stopped) return
    voice.stopped = true
    const now = this.context?.currentTime || 0
    try {
      voice.gainNode.gain.cancelScheduledValues?.(now)
      voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now)
      voice.gainNode.gain.linearRampToValueAtTime(0, now + fade)
      voice.source.stop(now + fade + 0.01)
    } catch {}
    if (voice.tag) this.loops.delete(voice.tag)
  }

  _forgetVoice(voice) {
    const pool = this.voices.get(voice.name)
    if (pool) {
      const index = pool.indexOf(voice)
      if (index >= 0) pool.splice(index, 1)
      if (!pool.length) this.voices.delete(voice.name)
    }
    if (voice.tag && this.loops.get(voice.tag) === voice) this.loops.delete(voice.tag)
    try { voice.source.disconnect(); voice.gainNode.disconnect(); voice.panner?.disconnect() } catch {}
  }

  _removeGestureListeners() {
    for (const type of GESTURES) this.gestureTarget?.removeEventListener?.(type, this._boundUnlock, {capture: true})
  }

  _range(min, max) {
    this._randomState ^= this._randomState << 13
    this._randomState ^= this._randomState >>> 17
    this._randomState ^= this._randomState << 5
    return min + ((this._randomState >>> 0) / 4294967296) * (max - min)
  }

  _log(name, variant, definition, options) {
    const position = options.position
    const suffix = position ? ` pos=${round(position.x)},${round(position.y)},${round(position.z)}` : ''
    this.logger?.(`[audio] ${name} variant=${variant + 1} bus=${options.bus || definition.channel || definition.bus}${suffix}`)
  }
}

export const AudioEngine = WebAudioEngine
export default WebAudioEngine

function defaultLogger(line) {
  globalThis.__terminatorSoundLog ??= []
  globalThis.__terminatorSoundLog.push(line)
  console.log(line)
}

function readStoredVolumes() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem('terminator.settings.v1')
      || globalThis.localStorage?.getItem('terminator.settings')
      || globalThis.localStorage?.getItem('terminator:settings')
      || '{}')
    return {
      master: normalizeStoredVolume(parsed.masterVolume ?? parsed.master),
      music: normalizeStoredVolume(parsed.musicVolume ?? parsed.music),
      effects: normalizeStoredVolume(parsed.effectsVolume ?? parsed.effects),
    }
  } catch {
    return {}
  }
}

function normalizeStoredVolume(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  return clamp(number > 1 ? number / 100 : number, 0, 1)
}

function setPosition(node, pos, time) {
  if (node.positionX) {
    node.positionX.setValueAtTime(Number(pos.x) || 0, time)
    node.positionY.setValueAtTime(Number(pos.y) || 0, time)
    node.positionZ.setValueAtTime(Number(pos.z) || 0, time)
  } else node.setPosition?.(Number(pos.x) || 0, Number(pos.y) || 0, Number(pos.z) || 0)
}

function setListenerVector(listener, prefix, value, time) {
  const x = listener[`${prefix}X`]
  if (x) {
    x.setValueAtTime(value.x, time)
    listener[`${prefix}Y`].setValueAtTime(value.y, time)
    listener[`${prefix}Z`].setValueAtTime(value.z, time)
  } else if (prefix === 'position') listener.setPosition?.(value.x, value.y, value.z)
}

function cameraPosition(camera) {
  const elements = camera.matrixWorld?.elements
  if (elements?.length >= 16) return {x: elements[12], y: elements[13], z: elements[14]}
  return {x: Number(camera.position?.x) || 0, y: Number(camera.position?.y) || 0, z: Number(camera.position?.z) || 0}
}

function rotateVector(vector, quaternion) {
  const qx = Number(quaternion.x) || 0
  const qy = Number(quaternion.y) || 0
  const qz = Number(quaternion.z) || 0
  const qw = Number.isFinite(Number(quaternion.w)) ? Number(quaternion.w) : 1
  const ix = qw * vector.x + qy * vector.z - qz * vector.y
  const iy = qw * vector.y + qz * vector.x - qx * vector.z
  const iz = qw * vector.z + qx * vector.y - qy * vector.x
  const iw = -qx * vector.x - qy * vector.y - qz * vector.z
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  }
}

function hashString(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10
}
