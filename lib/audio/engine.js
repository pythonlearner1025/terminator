import {SOUND_CATALOG} from './catalog.js'
import {renderSynthBuffer} from './synth.js'
import {createRoomImpulse, roomAt, probeAcoustics} from './acoustics.js'

const DEFAULT_VOLUMES = Object.freeze({master: 0.8, music: 0.55, effects: 0.85, ui: 0.8, voice: 0.9})
const GESTURES = ['pointerdown', 'keydown', 'touchstart']
const VOLUME_KEYS = Object.keys(DEFAULT_VOLUMES)
const ROOM_SEND = {outside: 0.025, building: 0.18, tunnel: 0.3}
const MAX_VOICES = 64

export class WebAudioEngine {
  constructor({camera = null, catalog = SOUND_CATALOG, contextFactory = null, logger = defaultLogger, volumes = null} = {}) {
    Object.assign(this, {camera, catalog, contextFactory, logger})
    this.volumes = {...DEFAULT_VOLUMES}
    for (const source of [readStoredVolumes(), volumes || {}]) for (const key of VOLUME_KEYS) {
      if (Number.isFinite(Number(source[key]))) this.volumes[key] = clamp(Number(source[key]), 0, 1)
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
    this.intensity = 0.35
    this.gestureTarget = null
    this._unlocking = null
    this._randomState = 0x7f4a7c15
    this._epoch = 0
    this._lastSpatial = -1
    this._duckUntil = 0
    this._voiceUntil = 0
    this._pending = []
    this.stats = {loaded: 0, failed: [], samplePlays: 0, synthPlays: 0, culled: 0, peakVoices: 0}
    this._boundUnlock = () => { void this.unlock() }
    this._boundSettings = (event) => this.setVolumes(event?.detail || readStoredVolumes())
  }

  start({gestureTarget = globalThis.window, ambient = true} = {}) {
    if (this.running) return this
    this.running = true
    this.stats = {loaded: 0, failed: [], samplePlays: 0, synthPlays: 0, culled: 0, peakVoices: 0}
    this.gestureTarget = gestureTarget || null
    for (const type of GESTURES) this.gestureTarget?.addEventListener?.(type, this._boundUnlock, {capture: true, passive: true})
    this.gestureTarget?.addEventListener?.('terminator-audio-settings', this._boundSettings)
    globalThis.window?.addEventListener?.('storage', this._boundSettings)
    this._abort = new AbortController()
    // Fetch while the menu is visible. Decode only after the gesture creates a context.
    this._downloads = new Map()
    for (const definition of Object.values(this.catalog)) for (const variant of definition.variants) {
      if (!variant.file || this._downloads.has(variant.file)) continue
      const url = new URL(`../../assets/audio/${variant.file}`, import.meta.url)
      this._downloads.set(variant.file, fetch(url, {signal: this._abort.signal})
        .then(response => { if (!response.ok) throw Error(`HTTP ${response.status}`); return response.arrayBuffer() })
        .catch(() => null))
    }
    if (ambient) this.startLoop('ambient_bed', {tag: 'ambient-bed', bus: 'ambient'})
    return this
  }

  async unlock() {
    if (!this.running) return false
    if (this._unlocking) return this._unlocking
    if (this.context?.state === 'running') return true
    this._unlocking = this._createAndResume()
    try { return await this._unlocking } finally { this._unlocking = null }
  }

  async _createAndResume() {
    const epoch = this._epoch
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext
      if (!this.contextFactory && !AudioContextClass) return false
      this.context = this.contextFactory ? this.contextFactory() : new AudioContextClass({latencyHint: 'interactive'})
      this._buildBuses()
      this.setVolumes(this.volumes, {immediate: true})
    }
    const context = this.context
    try { if (context.state === 'suspended') await context.resume() } catch { return false }
    if (!this.running || epoch !== this._epoch || context.state !== 'running') return false
    this._removeGestureListeners()
    this.updateListener(this.camera)
    this.loading = true
    const downloads = [...(this._downloads || [])]
    let cursor = 0
    await Promise.all(Array.from({length: 4}, async () => {
      while (cursor < downloads.length && this.running && epoch === this._epoch) {
        const [file, promise] = downloads[cursor++]
        try {
          const bytes = await promise
          if (!bytes) throw Error('Download failed')
          const buffer = await context.decodeAudioData(bytes)
          if (epoch !== this._epoch) return
          this.buffers.set(file, buffer)
          this.stats.loaded++
        } catch {
          if (epoch === this._epoch) this.stats.failed.push(file)
        }
      }
    }))
    if (!this.running || epoch !== this._epoch) return false
    this.loading = false
    this._downloads.clear()
    for (const [tag, request] of this.desiredLoops) this._play(request.name, {...request.options, tag, loop: true})
    for (const request of this._pending.splice(0)) {
      if (context.currentTime - request.at < 0.3) this._play(request.name, request.options)
    }
    this._applyMusicMix(true)
    if (this.stats.failed.length) console.warn(`[audio] ${this.stats.failed.length} samples unavailable; using procedural fallback where available`)
    return true
  }

  _buildBuses() {
    const c = this.context
    this.buses = Object.fromEntries([...VOLUME_KEYS, 'ambient', 'combat', 'duck', 'reverbReturn'].map(key => [key, c.createGain()]))
    const b = this.buses
    b.compressor = c.createDynamicsCompressor()
    Object.assign(b.compressor.threshold, {value: -6})
    b.compressor.knee.value = 8; b.compressor.ratio.value = 8
    b.compressor.attack.value = 0.003; b.compressor.release.value = 0.16
    b.master.connect(b.compressor); b.compressor.connect(c.destination)
    for (const key of ['effects', 'ui', 'voice']) b[key].connect(b.master)
    b.music.connect(b.duck); b.duck.connect(b.master)
    b.ambient.connect(b.music); b.combat.connect(b.music)
    b.reverb = c.createConvolver(); b.reverb.normalize = false
    b.reverb.buffer = createRoomImpulse(c)
    b.reverb.connect(b.reverbReturn); b.reverbReturn.connect(b.effects)
    b.reverbReturn.gain.value = 0.7
  }

  setVolumes(next = {}, {immediate = false} = {}) {
    for (const key of VOLUME_KEYS) {
      if (Number.isFinite(Number(next[key]))) this.volumes[key] = clamp(Number(next[key]), 0, 1)
      if (this.buses) this._ramp(this.buses[key].gain, this.volumes[key] ** 1.65, immediate ? 0 : 0.08)
    }
    return {...this.volumes}
  }

  _ramp(parameter, value, seconds = 0.08) {
    const now = this.context.currentTime
    if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(now)
    else { parameter.cancelScheduledValues(now); parameter.setValueAtTime(parameter.value, now) }
    parameter.linearRampToValueAtTime(value, now + seconds)
  }

  play(name, options = {}) {
    if (!this.running || this.context?.state !== 'running') return null
    if (this.loading) {
      this._pending.push({name, options, at: this.context.currentTime})
      if (this._pending.length > 16) this._pending.shift()
      return null
    }
    return this._play(name, options)
  }

  _play(name, options = {}) {
    const d = this.catalog[name]
    if (!d || !this.context || !this.buses || this.loading) return null
    const loop = options.loop ?? d.loop ?? false
    const tag = options.tag || (loop ? name : null)
    if (tag && this.loops.has(tag)) {
      if (options.position) this.updateLoopPosition(tag, options.position)
      return this.loops.get(tag)
    }
    const spatial = options.position && this.listenerPosition
      ? probeAcoustics(this.world, this.listenerPosition, options.position) : {distance: 0, blocked: false}
    if (spatial.distance > (options.maxDistance ?? 80)) { this.stats.culled++; return null }
    const variantIndex = this._variationIndex(name, d, options.variant)
    const variant = d.variants[variantIndex]
    const key = variant.file || `${name}:${variantIndex}`
    let buffer = this.buffers.get(key)
    if (!buffer) {
      const recipe = variant.fallback || (!variant.file && variant)
      if (!recipe) return null
      buffer = renderSynthBuffer(this.context, recipe, hashString(key))
      this.buffers.set(key, buffer)
    }
    const sampled = Boolean(variant.file && !this.stats.failed.includes(variant.file))
    this.stats[sampled ? 'samplePlays' : 'synthPlays']++
    const c = this.context, startAt = c.currentTime + Math.max(0, options.delay || 0)
    const source = c.createBufferSource(), gainNode = c.createGain()
    const baseGain = (d.gain ?? 1) * (options.gain ?? 1) * (d.stable ? 1 : this._range(0.94, 1.06))
    const pitch = (options.pitch ?? 1) * (d.stable ? 1 : this._range(0.98, 1.02))
    source.buffer = buffer; source.loop = loop
    source.playbackRate.setValueAtTime(pitch, startAt)
    gainNode.gain.setValueAtTime(loop ? 0 : baseGain, startAt)
    if (loop) gainNode.gain.linearRampToValueAtTime(baseGain, startAt + (options.fadeIn ?? 0.12))
    source.connect(gainNode)
    let panner = null, filter = null, occlusion = null, send = null
    let output = gainNode
    if (options.position) {
      filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 0.65
      occlusion = c.createGain()
      gainNode.connect(filter); filter.connect(occlusion)
      panner = c.createPanner(); panner.panningModel = 'equalpower'; panner.distanceModel = 'inverse'
      panner.refDistance = options.refDistance ?? 3; panner.maxDistance = options.maxDistance ?? 80
      panner.rolloffFactor = options.rolloffFactor ?? 1.05
      setPosition(panner, options.position, startAt)
      occlusion.connect(panner); output = panner
    }
    output.connect(this._busFor(d, options))
    if ((options.bus || d.bus) === 'effects') {
      send = c.createGain(); output.connect(send); send.connect(this.buses.reverb)
    }
    const voice = {name, source, gainNode, panner, filter, occlusion, send, baseGain, startedAt: startAt, tag,
      position: options.position ? {...options.position} : null, stopped: false, definition: d, distant: Boolean(options.distant)}
    this._setSpatial(voice, spatial, true)
    source.onended = () => this._forgetVoice(voice)
    const pool = this.voices.get(name) || []
    while (pool.length >= (d.voices || 8)) this._stopVoice(pool[0], 0.008)
    let all = [...this.voices.values()].flat()
    if (all.length >= MAX_VOICES) {
      const oldest = all.filter(v => !v.tag && v.definition.bus === 'effects').sort((a, b) => a.startedAt - b.startedAt)[0]
      if (oldest) this._stopVoice(oldest, 0.008)
      else { source.disconnect(); gainNode.disconnect(); return null }
    }
    pool.push(voice); this.voices.set(name, pool)
    if (tag) this.loops.set(tag, voice)
    source.start(startAt)
    this.stats.peakVoices = Math.max(this.stats.peakVoices, [...this.voices.values()].reduce((n, p) => n + p.length, 0))
    if (d.duck) this.duckMusic(d.duck, 0.26)
    if (d.distant && !options.distant) this._play(d.distant, {...options, distant: true, gain: (options.gain ?? 1) * (spatial.distance ? Math.min(0.9, 0.16 + spatial.distance / 30) : 0.2), delay: (options.delay || 0) + 0.025, refDistance: 12, rolloffFactor: 0.75})
    this._log(name, variantIndex, d, options)
    return voice
  }

  _setSpatial(voice, spatial, immediate = false) {
    voice.blocked = spatial.blocked
    if (voice.filter) {
      this._ramp(voice.filter.frequency, spatial.blocked ? 1100 : Math.max(3600, 18000 - spatial.distance * 180), immediate ? 0 : 0.12)
      this._ramp(voice.occlusion.gain, spatial.blocked ? 0.48 : 1, immediate ? 0 : 0.12)
    }
    if (voice.send) this._ramp(voice.send.gain, ROOM_SEND[this.room || 'outside'], immediate ? 0 : 0.2)
  }

  updateEnvironment(world) { this.world = world }

  startLoop(name, options = {}) {
    const tag = options.tag || name
    this.desiredLoops.set(tag, {name, options: {...options, tag}})
    if (!this.running || this.context?.state !== 'running' || this.loading) return null
    return this._play(name, {...options, tag, loop: true})
  }

  stopLoop(tag, {fade = 0.12, forget = true} = {}) {
    if (forget) this.desiredLoops.delete(tag)
    const voice = this.loops.get(tag)
    if (!voice) return false
    this._stopVoice(voice, fade)
    return true
  }

  updateLoopPosition(tag, position) {
    const request = this.desiredLoops.get(tag)
    if (request) request.options.position = {...position}
    const voice = this.loops.get(tag)
    if (!voice?.panner || !this.context) return false
    voice.position = {...position}
    setPosition(voice.panner, position, this.context.currentTime)
    return true
  }

  setCombatActive(active) {
    const next = Boolean(active)
    if (next === this.combatActive && (next ? this.desiredLoops.has('combat-music') : !this.desiredLoops.has('combat-music'))) return
    this.combatActive = next
    if (next) this.startLoop('combat_music', {tag: 'combat-music', bus: 'combat', fadeIn: 0.8})
    else this.stopLoop('combat-music', {fade: 1.2})
    this._applyMusicMix()
  }

  setIntensity(value) {
    const next = clamp(value, 0, 1)
    if (Math.abs(next - this.intensity) < 0.025) return
    this.intensity = next
    this._applyMusicMix()
  }

  _applyMusicMix(immediate = false) {
    if (!this.buses) return
    this._ramp(this.buses.ambient.gain, this.combatActive ? 0.42 : 1, immediate ? 0 : 1.5)
    this._ramp(this.buses.combat.gain, this.combatActive ? 0.3 + this.intensity * 0.7 : 0, immediate ? 0 : 1.5)
  }

  duckMusic(amount = 0.55, duration = 0.3) {
    if (!this.buses) return
    const now = this.context.currentTime
    this._duckTarget = now < this._duckUntil ? Math.min(this._duckTarget ?? 1, amount) : amount
    amount = this._duckTarget
    this._duckUntil = Math.max(this._duckUntil, now + duration)
    this._ramp(this.buses.duck.gain, Math.min(this.buses.duck.gain.value, amount), 0.025)
    this.buses.duck.gain.setValueAtTime(amount, this._duckUntil)
    this.buses.duck.gain.linearRampToValueAtTime(1, this._duckUntil + 0.65)
  }

  speak(cue, {priority = false, delay = 0} = {}) {
    if (!this.running || this.context?.state !== 'running' || this.loading) return null
    const now = this.context.currentTime
    if (!priority && now < this._voiceUntil + 8) return null
    if (priority) for (const pool of [...this.voices.values()]) for (const voice of [...pool]) {
      if (voice.definition.bus === 'voice') this._stopVoice(voice, 0.06)
    }
    const voice = this.play(cue, {delay})
    if (voice) {
      this._voiceUntil = now + delay + voice.source.buffer.duration
      this.duckMusic(0.3, delay + voice.source.buffer.duration)
    }
    return voice
  }

  updateListener(camera = this.camera) {
    if (camera) this.camera = camera
    if (!this.context || !this.camera) return false
    const listener = this.context.listener
    const position = this.listenerPosition = cameraPosition(this.camera)
    this.room = roomAt(position)
    const quaternion = this.camera.quaternion || {x: 0, y: 0, z: 0, w: 1}
    const forward = rotateVector({x: 0, y: 0, z: -1}, quaternion), up = rotateVector({x: 0, y: 1, z: 0}, quaternion)
    setListenerVector(listener, 'position', position, this.context.currentTime)
    if (listener.forwardX) {
      for (const axis of ['X', 'Y', 'Z']) {
        listener[`forward${axis}`].setValueAtTime(forward[axis.toLowerCase()], this.context.currentTime)
        listener[`up${axis}`].setValueAtTime(up[axis.toLowerCase()], this.context.currentTime)
      }
    } else listener.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z)
    // Ten probes per second per active source, never per rendered triangle.
    if (this.context.currentTime - this._lastSpatial >= 0.1) {
      this._lastSpatial = this.context.currentTime
      for (const pool of this.voices.values()) for (const voice of pool) {
        this._setSpatial(voice, voice.position ? probeAcoustics(this.world, position, voice.position) : {distance: 0, blocked: false})
        if (voice.tag?.startsWith('minigun:')) this.duckMusic(0.6, 0.15)
      }
    }
    return true
  }

  async stop() {
    this.running = false; this._epoch++
    this._abort?.abort(); this._downloads?.clear(); this._pending.length = 0
    this._removeGestureListeners()
    this.gestureTarget?.removeEventListener?.('terminator-audio-settings', this._boundSettings)
    globalThis.window?.removeEventListener?.('storage', this._boundSettings)
    this.gestureTarget = null
    this.desiredLoops.clear()
    for (const pool of [...this.voices.values()]) for (const voice of [...pool]) this._stopVoice(voice, 0)
    this.voices.clear(); this.loops.clear(); this.buffers.clear()
    const context = this.context
    this.context = null; this.buses = null; this.world = null; this.loading = false
    this._voiceUntil = 0; this._duckUntil = 0; this._lastSpatial = -1
    this.combatActive = false
    if (context && context.state !== 'closed') { try { await context.close() } catch {} }
  }

  _busFor(definition, options) {
    return this.buses[options.bus || definition.channel || definition.bus || 'effects'] || this.buses.effects
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
      this._ramp(voice.gainNode.gain, 0, fade)
      voice.source.stop(now + fade + 0.01)
    } catch {}
    this._removeFromPool(voice)
  }

  _removeFromPool(voice) {
    const pool = this.voices.get(voice.name)
    if (pool) {
      const index = pool.indexOf(voice)
      if (index >= 0) pool.splice(index, 1)
      if (!pool.length) this.voices.delete(voice.name)
    }
    if (voice.tag && this.loops.get(voice.tag) === voice) this.loops.delete(voice.tag)
  }

  _forgetVoice(voice) {
    this._removeFromPool(voice)
    for (const node of [voice.source, voice.gainNode, voice.panner, voice.filter, voice.occlusion, voice.send]) { try { node?.disconnect() } catch {} }
  }

  _removeGestureListeners() {
    for (const type of GESTURES) this.gestureTarget?.removeEventListener?.(type, this._boundUnlock, {capture: true})
  }

  _range(min, max) {
    this._randomState ^= this._randomState << 13; this._randomState ^= this._randomState >>> 17; this._randomState ^= this._randomState << 5
    return min + ((this._randomState >>> 0) / 4294967296) * (max - min)
  }

  _log(name, variant, definition, options) {
    this.logger?.(`[audio] ${name} variant=${variant + 1} bus=${options.bus || definition.channel || definition.bus}`)
  }
}
export const AudioEngine = WebAudioEngine
export default WebAudioEngine

function defaultLogger(line) {
  globalThis.__terminatorSoundLog ??= []
  globalThis.__terminatorSoundLog.push(line)
  if (globalThis.__terminatorSoundLog.length > 256) globalThis.__terminatorSoundLog.shift()
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
      ui: normalizeStoredVolume(parsed.uiVolume ?? parsed.ui),
      voice: normalizeStoredVolume(parsed.voiceVolume ?? parsed.voice),
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
