import {AudioBindings} from '../audio/bindings.js'

let audioEngine = null
let autoBindings = null
let autoFrame = 0
let autoAttempts = 0
let manuallyBound = false
let uiRoot = null
let lastHover = null

const onUiPointer = (event) => {
  const control = event.target?.closest?.('button,[role="button"],input,select')
  if (!control || control === lastHover || !uiRoot?.contains(control)) return
  lastHover = control
  audioEngine?.play('ui_hover')
}

const onUiLeave = (event) => {
  if (!event.relatedTarget || !uiRoot?.contains(event.relatedTarget)) lastHover = null
}

const onUiActivate = (event) => {
  if (event.target?.closest?.('button,[role="button"],input,select') && uiRoot?.contains(event.target)) audioEngine?.play('ui_click')
}

export function setSfxEngine(engine) {
  manuallyBound = Boolean(engine)
  audioEngine = engine || null
  return audioEngine
}

export const bindSfx = setSfxEngine

export function playUiHover() {
  return play('ui_hover')
}

export function playUiClick() {
  return play('ui_click')
}

export function playTraderOpen() {
  return play('trader_open')
}

export function playPurchase() {
  return play('cash_register')
}

export function purchaseSuccess() {
  if (autoBindings) return null
  return play('cash_register')
}

export function purchaseDenied() {
  return play('dry_fire', {pitch: 0.72, gain: 0.8})
}

export function playSkynetTransmission(text = '') {
  play('skynet_static')
  const cue = 1 + [...String(text)].reduce((n, c) => n + c.charCodeAt(0), 0) % 5
  audioEngine?.speak?.(`voice_taunt_${cue}`)
  return [...String(text)].filter((character) => character.trim()).slice(0, 16).map((_, index) => (
    play('typewriter_tick', {delay: 0.05 + index * 0.038, gain: 0.74})
  ))
}

export function playTypewriterTick() {
  return play('typewriter_tick')
}

export function skynetPowerOn() {
  if (autoBindings) return null
  return play('skynet_static', {gain: 1.15})
}

export function transmissionStatic() {
  if (autoBindings) return null
  play('skynet_static')
  return Array.from({length: 12}, (_, index) => play('typewriter_tick', {delay: 0.07 + index * 0.05, gain: 0.62}))
}

export function waveKlaxon() {
  if (autoBindings) return null
  play('wave_start', {delay: 0.08})
  audioEngine?.speak?.('voice_wave_1', {priority: true, delay: 1.6})
  return play('wave_klaxon')
}

export function waveClearStinger() {
  if (autoBindings) return null
  audioEngine?.speak?.('voice_clear', {priority: true, delay: 0.6})
  return play('wave_clear')
}

export function hitTarget(kind = 'hit') {
  if (autoBindings) return null
  if (kind === 'headshot' || kind === 'kill') return play('headshot_clang', {gain: kind === 'kill' ? 1.1 : 0.82})
  return play('sparks_metal', {gain: 0.34})
}

export function fireWeapon(weapon) {
  if (autoBindings) return null
  const sound = {pistol: 'pistol_9mm', m4: 'm4_rifle', shotgun: 'shotgun_fire', plasma: 'plasma_bolt', knife: 'knife_swing', grenade: 'grenade_throw'}[weapon]
  if (!sound) return null
  const voice = play(sound)
  if (weapon === 'shotgun') play('shotgun_pump', {delay: 0.34})
  return voice
}

export function setSoundVolumes({master, music, effects, ui, voice} = {}) {
  ensureAudio()
  const volumes = cleanVolumes({master, music, effects, ui, voice})
  try {
    const current = JSON.parse(globalThis.localStorage?.getItem('terminator.settings.v1') || '{}')
    globalThis.localStorage?.setItem('terminator.settings.v1', JSON.stringify({
      ...current,
      ...(volumes.master == null ? {} : {master: Math.round(volumes.master * 100)}),
      ...(volumes.music == null ? {} : {music: Math.round(volumes.music * 100)}),
      ...(volumes.ui == null ? {} : {ui: Math.round(volumes.ui * 100)}),
      ...(volumes.voice == null ? {} : {voice: Math.round(volumes.voice * 100)}),
      ...(volumes.effects == null ? {} : {effects: Math.round(volumes.effects * 100)}),
    }))
  } catch {}
  audioEngine?.setVolumes(volumes)
  globalThis.window?.dispatchEvent?.(new CustomEvent('terminator-audio-settings', {detail: volumes}))
  return volumes
}

export function applyAudioSettings(settings = {}) {
  return setSoundVolumes({master: settings.master, music: settings.music, effects: settings.effects, ui: settings.ui, voice: settings.voice})
}

export function stopSfx() {
  if (autoFrame) globalThis.cancelAnimationFrame?.(autoFrame)
  autoFrame = 0
  detachUiSounds()
  const manager = globalThis.window?.terminator?.manager
  if (manager) {
    manager.audio = null
    manager.audioBindings = null
  }
  autoBindings?.stop()
  autoBindings = null
  audioEngine = null
  manuallyBound = false
}

export const onUiHover = playUiHover
export const onUiClick = playUiClick
export const onTraderOpen = playTraderOpen
export const onPurchase = playPurchase
export const onSkynetTransmission = playSkynetTransmission
export const onTypewriterTick = playTypewriterTick

function play(name, options) {
  ensureAudio()
  return audioEngine?.play(name, options) || null
}

function ensureAudio() {
  if (manuallyBound || autoBindings || autoFrame || typeof window === 'undefined') return
  autoAttempts = 0
  const connect = () => {
    autoFrame = 0
    const world = window.terminator?.world
    const viewer = window.viewer
    if (!world || !viewer) {
      autoAttempts += 1
      if (autoAttempts < 120) autoFrame = requestAnimationFrame(connect)
      return
    }
    autoBindings = new AudioBindings({
      world,
      viewer,
      eventBus: window.terminator?.manager?.director?.events,
      phaseProvider: () => window.terminator?.manager?.director?.phase,
    })
    autoBindings.start()
    audioEngine = autoBindings.engine
    const manager = window.terminator?.manager
    if (manager) {
      manager.audio = audioEngine
      manager.audioBindings = autoBindings
    }
    attachUiSounds(viewer.container)
    let wasAlive = true
    let audioWorld = world
    const sync = () => {
      autoFrame = 0
      const currentWorld = window.terminator?.world
      if (!currentWorld) {
        const manager = window.terminator?.manager
        if (manager) {
          manager.audio = null
          manager.audioBindings = null
        }
        autoBindings?.stop()
        detachUiSounds()
        autoBindings = null
        audioEngine = null
        return
      }
      if (currentWorld !== autoBindings.world) {
        autoBindings.stop()
        autoBindings = new AudioBindings({
          world: currentWorld,
          viewer,
          eventBus: window.terminator?.manager?.director?.events,
          phaseProvider: () => window.terminator?.manager?.director?.phase,
        })
        autoBindings.start()
        audioEngine = autoBindings.engine
        const manager = window.terminator?.manager
        if (manager) {
          manager.audio = audioEngine
          manager.audioBindings = autoBindings
        }
      }
      // Missing local death hook belongs here, keeping the gameplay event contract intact.
      if (audioWorld !== currentWorld) { wasAlive = true; audioWorld = currentWorld }
      const playerId = window.terminator?.manager?.localPlayerId || currentWorld.localPlayerId || currentWorld.hostPlayerId
      const player = currentWorld.getPlayer?.(playerId) || currentWorld.player
      if (wasAlive && !player.alive) {
        audioEngine.play('death_stinger')
        audioEngine.speak?.('voice_death', {priority: true, delay: 0.65})
      }
      wasAlive = player.alive
      autoBindings.sync(currentWorld)
      autoFrame = requestAnimationFrame(sync)
    }
    autoFrame = requestAnimationFrame(sync)
  }
  autoFrame = requestAnimationFrame(connect)
}

function attachUiSounds(root) {
  if (uiRoot === root) return
  detachUiSounds()
  uiRoot = root
  uiRoot?.addEventListener('pointerover', onUiPointer)
  uiRoot?.addEventListener('pointerleave', onUiLeave)
  uiRoot?.addEventListener('click', onUiActivate)
}

function detachUiSounds() {
  uiRoot?.removeEventListener('pointerover', onUiPointer)
  uiRoot?.removeEventListener('pointerleave', onUiLeave)
  uiRoot?.removeEventListener('click', onUiActivate)
  uiRoot = null
  lastHover = null
}

function cleanVolumes(input) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Number.isFinite(Number(value))
    ? Math.max(0, Math.min(1, Number(value) > 1 ? Number(value) / 100 : Number(value)))
    : undefined]))
}
