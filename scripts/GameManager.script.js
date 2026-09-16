import {bindBulletPresentation} from '../lib/view/bullets.js'
import {Object3DComponent} from 'threepipe'
import mapRules from '../lib/core/data/map.json' with {type: 'json'}
import mapPieceRegistry from '../lib/core/data/map-piece-registry.json' with {type: 'json'}
import {scenePlacements} from '../lib/core/map.js'
import {buildV2PlayableMap} from '../lib/core/v2-map.js'
import {BuiltinSkynet} from '../lib/core/builtin-skynet.js'
import {projectViewModel} from '../lib/core/viewmodel.js'
import {WaveDirector} from '../lib/core/waves.js'
import {TICK_SECONDS, World} from '../lib/core/world.js'
import {LobbyClient} from '../lib/net/lobby-client.js'
import {PartyGuest} from '../lib/net/party-guest.js'
import {PartyHost} from '../lib/net/party-host.js'
import {Hud} from '../lib/ui/hud.js'
import {UiSession} from '../lib/ui/session.js'
import {prepareAudio} from '../lib/ui/sfx.js'
import {mountSkynetVoice} from '../lib/ui/skynet-voice.js'
import {CameraFeel} from '../lib/view/camera-feel.js'
import {GrenadeView} from '../lib/view/grenade.js'
import {InputController} from '../lib/view/input.js'
import {mountCachesView} from '../lib/view/caches.js' // map
import {mountExtractionView} from '../lib/view/extraction.js' // map
import {MapView} from '../lib/view/map.js'
import {PlayerView} from '../lib/view/player.js'
import {UnitView} from '../lib/view/units.js'
import {mountPlayersView} from '../lib/view/players.js'
import {loadBakedLightingNoise} from '../lib/view/v2/lighting-noise-baked.js'
import {createStartupProfile} from '../lib/ui/startup-profile.js'
import {holdStartupRendering,holdCoveredEditorRendering} from '../lib/view/startup-rendering.js'
import {warmupMatch} from '../lib/view/match-warmup.js'

export class GameManager extends Object3DComponent {
  static ComponentType = 'GameManager'
  static StateProperties = [
    {key: 'seed', type: 'number'},
    {key: 'intermissionSeconds', type: 'number', uiConfig: {bounds: [5, 90], stepSize: 5}},
  ]

  seed = 2029
  intermissionSeconds = 45
  world = null
  director = null
  input = null
  mapView = null
  unitView = null
  playerView = null
  grenadeView = null
  hud = null
  ui = null
  cameraFeel = null
  lobby = null
  party = null
  partyState = null
  partyStateListeners = new Set()
  partyOffs = []
  sessionMode = 'single'
  localPlayerId = 'player'
  accumulator = 0
  started = false
  viewsStarted = false
  uiProjectionTick = null

  init(object, state) {
    super.init(object, state)
    this.releaseCoveredEditor?.()
    this.releaseCoveredEditor=holdCoveredEditorRendering(this.ctx.viewer)
    // The editor uses a separate runtime canvas for Play. Keep its imported
    // authoring copies off the GPU until the real menu owns the camera. The
    // stopped editor and createStoppedGame retain their normal rendering.
    if (this.ctx.viewer.canvas?.classList?.contains('game-canvas-overlay')) {
      this.releaseLoadRender = holdStartupRendering(this.ctx.viewer)
    }
  }

  start() {
    const releaseLoadRender = this.releaseLoadRender
    this.releaseLoadRender = null
    this.stop()
    this.releaseLoadRender = releaseLoadRender
    const profile = this.startup = createStartupProfile()
    profile.mark('manager-start')
    const viewer = this.ctx.viewer
    this.hiddenUnitSources = []
    viewer.scene.modelRoot.traverse(object => {
      if (!object.userData?.rootPath?.startsWith('/kite3d/@unit-')) return
      this.hiddenUnitSources.push([object, object.visible])
      object.visible = false
    })
    const mapRoot = viewer.scene.modelRoot.getObjectByName('Map')
    if (!mapRoot) throw new Error('Map authored node not found')
    this.mapData = profile.measure('map-collision-build', () => buildV2PlayableMap(mapRules, mapPieceRegistry, scenePlacements(mapRoot)))
    this.world = profile.measure('world-build', () => new World({map: this.mapData, seed: this.seed}))
    this.sessionMode = 'single'
    this.localPlayerId = this.world.hostPlayerId
    this.partyState = null
    this.director = new WaveDirector(this.world, {
      builtin: new BuiltinSkynet({map: this.mapData}),
      intermissionSeconds: this.intermissionSeconds,
    })
    this.mapView = new MapView(viewer, this.mapData)
    this.unitView = new UnitView(viewer)
    this.playerView = new PlayerView(viewer)
    this.grenadeView = new GrenadeView(viewer)
    this.input = new InputController(viewer)
    this.hud = new Hud(viewer)
    this.lobby = new LobbyClient({world: this.world, director: this.director, intermissionSeconds: this.intermissionSeconds})
    this.cameraFeel = new CameraFeel()
    this.ui = new UiSession(this)
    this.accumulator = 0
    this.uiProjectionTick = null
    this.started = true
    this.syncViews()
  }

  // Asset-only work may overlap menu loading. The immutable atmosphere cache
  // belongs to its loader, while cancellation belongs to this manager lifetime.
  prepareMenuAssets() {
    if (this.menuAssets) return this.menuAssets
    const abort = this.menuAssetsAbort = new AbortController()
    const pending = this.startup.measure('menu-lighting-decode', () => loadBakedLightingNoise({signal:abort.signal}))
    this.menuAssets = pending
    pending.catch(error => {
      if (this.menuAssets === pending) this.menuAssets = null
      if (!abort.signal.aborted) this.menuPreparationError = error
    })
    return pending
  }

  prepareMap() {
    if (!this.mapView || this.mapView.root) return
    try {this.startup.measure('map-batching', () => this.mapView.start())}
    catch (error) {this.mapView.stop(); throw error}
  }

  startViews() {
    if (this.viewsStarted || !this.world) return false
    this.ui?.promotePreparation?.()
    this.warmupAbort = new AbortController()
    const signal = this.warmupAbort.signal
    const profile = this.startup
    const before = performance.now()
    try {
      this.prepareMap()
      this.mapView.startEffects()
      this.unitView.start(this.world)
      this.playerView.start(this.world)
      this.grenadeView.start(this.world, this.playerView.weapons.material)
      this.playersView = mountPlayersView(this.ctx.viewer, this.world,
        () => this.localPlayerId ?? this.world?.localPlayerId ?? this.world?.player?.id ?? 'player')
      // map: cache crates and the extraction beacon are runtime-only and sync themselves each frame
      this.cachesView = mountCachesView(this.ctx.viewer, () => this.world)
      this.extractionView = mountExtractionView(this.ctx.viewer, () => this.world)
      this.viewsStarted = true
      this.syncViews()
      profile.spans.push({name:'view-construction',start:before,end:performance.now(),ms:performance.now()-before,status:'ready'})
      this.visualWarmup = profile.measure('visual-warmup', () => warmupMatch(this, {signal})).then(report => {
        if(!signal.aborted && this.viewsStarted)this.visualWarmupReport=report
        return report
      }).catch(error => {
        if (!signal.aborted) {this.stopViews(); this.mapView?.stop()}
        throw error
      })
      // Observe rejection even when preparation is initiated outside startMatch.
      this.visualWarmup.catch(() => {})
      return true
    } catch (error) {
      this.warmupAbort.abort()
      this.viewsStarted = false
      this.playersView?.stop(); this.playersView = null
      // map: the runtime cache crates and the extraction beacon leave no scene objects behind
      this.cachesView?.stop(); this.cachesView = null
      this.extractionView?.stop(); this.extractionView = null
      this.grenadeView?.stop()
      this.playerView?.stop()
      this.unitView?.stop()
      this.mapView?.stop()
      throw error
    }
  }

  stopViews() {
    this.warmupAbort?.abort()
    this.warmupAbort = null
    this.visualWarmup = null
    this.visualWarmupReport = null
    if (!this.viewsStarted) return
    this.viewsStarted = false
    this.playersView?.stop(); this.playersView = null
    // map: the runtime cache crates and the extraction beacon leave no scene objects behind
    this.cachesView?.stop(); this.cachesView = null
    this.extractionView?.stop(); this.extractionView = null
    this.grenadeView?.stop()
    this.playerView?.stop()
    this.unitView?.stop()
  }

  update({deltaTime} = {}) {
    if (!this.started || !this.world) return
    if (this.ui?.frozen) {
      this.accumulator = 0
      if (this.sessionMode !== 'guest') this.lobby?.update()
      this.party?.interpolate?.()
      this.syncUi(true)
      return true
    }
    if(this.range){
      const ticks=this.range.clock.takeTicks(deltaTime)
      for(let i=0;i<ticks;i++){
        this.director.pauseWaves()
        this.director.step(this.ui.sample())
        this.range.afterStep()
        this.cameraFeel?.consume(this.world)
      }
      this.syncViews()
      return true
    }
    this.accumulator += Math.min(0.1, Math.max(0, Number(deltaTime) || 16.667) / 1000)
    let steps = 0
    while (this.accumulator >= TICK_SECONDS && steps < 8) {
      const inputs = this.ui ? this.ui.sample() : this.input.sample()
      if (this.sessionMode === 'host') this.party?.step(inputs)
      else if (this.sessionMode === 'guest') this.party?.step(inputs)
      else this.director.step(inputs)
      this.cameraFeel?.consume(this.world)
      this.accumulator -= TICK_SECONDS
      steps += 1
    }
    if (steps === 8) this.accumulator = Math.min(this.accumulator, TICK_SECONDS)
    if (this.sessionMode !== 'guest') this.lobby?.update()
    // View-only hit-stop. The fixed steps and the party clock above already ran; only the
    // presentation holds, so unit and weapon animation, projectiles and camera springs freeze.
    if (this.cameraFeel?.hitStopped) return true
    this.syncViews()
    return true
  }

  preFrame() {
    this.hud?.sync()
  }

  syncViews() {
    if (!this.world) return
    if (this.sessionMode === 'guest' && this.director) {
      this.director.phase = this.world.phase
      this.director.wave = this.world.wave
    }
    this.mapView?.sync(this.world)
    const bullets=bindBulletPresentation(this)
    this.playerView?.sync(this.world)
    this.unitView?.sync(this.world)
    this.playersView?.sync(this.world)
    bullets?.flush()
    this.grenadeView?.sync(this.world)
    mountSkynetVoice(this) // presence: Skynet taunts read director events before the HUD projection
    this.cameraFeel?.apply(this.playerView?.camera,this.range?this.world.time:undefined)
    this.rangeView?.sync(this.world)
    this.syncUi()
    this.ctx.viewer.setDirty(this)
  }

  syncUi(force=false) {
    if(!this.world)return
    if(!force&&this.uiProjectionTick!==null&&this.world.tick>=this.uiProjectionTick&&this.world.tick-this.uiProjectionTick<2)return
    this.uiProjectionTick=this.world.tick
    const view=projectViewModel(this.world,this.localPlayerId,{includeEnemyNameplates:false})
    if(this.ui)this.ui.sync(view)
    else this.hud?.render(view)
  }

  async startHost({name, relay} = {}) {
    if (this.world?.sandboxEnabled?.()) return {ok: false, error: {code: 'sandbox'}}
    this._stopParty()
    this.sessionMode = 'host'
    this.localPlayerId = this.world.hostPlayerId
    const party = this.party = new PartyHost({world: this.world, director: this.director, name, relay})
    this._bindParty(party, 'host')
    this._setPartyState({role: 'host', status: 'connecting', code: party.code, hostId: this.localPlayerId,
      localPlayerId: this.localPlayerId, playerId: this.localPlayerId, players: []})
    try {
      await party.start({name})
      this._acceptPartyState(party.state(), 'host')
      return {ok: true, ...this.partyState}
    } catch (error) {
      this._setPartyState({...this.partyState, status: 'error', error})
      throw error
    }
  }

  async joinParty({code, relay, signal, name} = {}) {
    if (this.world?.sandboxEnabled?.()) return {ok: false, error: {code: 'sandbox'}}
    this._stopParty()
    this.lobby?.stop()
    this.sessionMode = 'guest'
    this.localPlayerId = null
    const party = this.party = new PartyGuest({code, relay, signalOrigin: signal, name})
    this._bindParty(party, 'guest')
    this.partyOffs.push(party.on('world', ({detail}) => this._adoptGuestWorld(detail.world, detail.playerId)))
    this._setPartyState({role: 'guest', status: 'connecting', code: party.code, hostId: 'player', players: []})
    try {
      await party.start()
      this._acceptPartyState(party.partyState, 'guest')
      return {ok: true, ...this.partyState}
    } catch (error) {
      this._setPartyState({...this.partyState, status: 'error', error})
      throw error
    }
  }

  setPartyReady(value = true) {
    if (this.sessionMode === 'host') this.party?.setReady(this.localPlayerId, value)
    else if (this.sessionMode === 'guest') this.party?.ready(value)
    else return {ok: false, error: 'Not in a party'}
    return {ok: true}
  }

  async startMatch({override = false} = {}) {
    if (this.sessionMode !== 'host' || !this.party) return {ok: false, error: 'Only the host can start the party'}
    if (this.matchStarting) return {ok: false, error: 'Match is already starting'}
    const players = this.party.state().players
    if (!override && !players.every((player) => player.ready)) return {ok: false, error: 'Every player must be ready'}
    this.matchStarting = true
    const party = this.party, world = this.world
    try {
      this.startup.beginMatch?.('party-host-request')
      this.ui?.preparePartyMatch()
      const preparation = this.party.prepareMatch({hostLoaded: false})
      try {
        this.startViews()
        const [warmup] = await Promise.all([this.visualWarmup, prepareAudio()])
        if (warmup?.cancelled || this.party !== party || this.world !== world) {
          party.cancelPreparing('Match preparation stopped')
          return {ok:false, cancelled:true}
        }
        party.acceptLoaded(this.localPlayerId)
      } catch (error) {
        party.cancelPreparing(error)
        throw error
      }
      const prepared = await preparation
      if (this.party !== party || this.world !== world) return {ok:false, cancelled:true}
      if (prepared?.ok === false) {this.startup.failMatch(prepared.error);return prepared}
      const result = this.director.start()
      if (result === false || result?.ok === false) return result || {ok: false, error: 'Match could not start'}
      this.startup.mark('match-ready')
      this.party.startMatch()
      this._acceptPartyState(this.party.state(), 'host')
      return {ok: true}
    } catch (error) {
      if (this.world === world) this.startup.failMatch(error)
      throw error
    } finally {
      if (this.world === world) this.matchStarting = false
    }
  }

  returnPartyToLobby() {
    if (this.sessionMode !== 'host' || !this.party) return {ok: false, error: 'Only the host can return the party to the lobby'}
    const result = this.party.returnToLobby()
    if (result?.ok === false) return result
    this.stopViews()
    this._acceptPartyState(this.party.state(), 'host')
    this.ui?.returnToPartyLobby('host')
    return {ok: true}
  }

  leaveParty() {
    this.stopViews()
    this.mapView?.stop()
    const wasGuest = this.sessionMode === 'guest'
    this._stopParty()
    if (wasGuest) this._resetSingleWorld()
    else if (this.world) {
      for (const playerId of [...this.world.players.keys()]) {
        if (playerId !== this.world.hostPlayerId) this.world.removePlayer(playerId)
      }
    }
    this.sessionMode = 'single'
    this.localPlayerId = this.world?.hostPlayerId || 'player'
    this._setPartyState(null)
    return {ok: true}
  }

  onPartyState(listener) {
    this.partyStateListeners.add(listener)
    if (this.partyState) listener(this.partyState)
    return () => this.partyStateListeners.delete(listener)
  }

  _bindParty(party, role) {
    this.partyOffs.push(party.on('state', ({detail}) => this._acceptPartyState(detail, role)))
    this.partyOffs.push(party.on('match-start', () => {
      this.ui?.preparePartyMatch()
      this.startViews()
      this._acceptPartyState({...party.partyState, matchStarted: true}, role)
    }))
    this.partyOffs.push(party.on('match-prepare', () => {
      this.startup.beginMatch?.('party-remote-request')
      this.ui?.preparePartyMatch()
      const world = this.world
      const prepare = async () => {
        if (!this.started || this.party !== party || this.world !== world) return
        this.startViews()
        const signal = this.warmupAbort.signal
        const [warmup] = await Promise.all([this.visualWarmup, prepareAudio()])
        if (!signal.aborted && !warmup?.cancelled && this.party === party && this.world === world) party.loaded?.()
      }
      prepare().catch(error => {
        if (this.started && this.party === party) {
          this.startup.failMatch(error)
          this._setPartyState({...this.partyState, status:'error', error:{message:error.message}})
        }
      })
    }))
    this.partyOffs.push(party.on('return-lobby', () => {
      this.director.phase = this.world.phase
      this.director.wave = this.world.wave
      this.stopViews()
      this._acceptPartyState({...party.partyState, matchStarted: false}, role)
      this.ui?.returnToPartyLobby(role)
    }))
    this.partyOffs.push(party.on('ended', ({detail}) => {
      this.input?.stop()
      this.stopViews()
      this.mapView?.stop()
      this._setPartyState({...this.partyState, status: role === 'guest' ? 'host_left' : 'error', error: detail, notice: detail.notice})
    }))
  }

  _acceptPartyState(state, role = this.sessionMode) {
    const players = Array.isArray(state?.players) ? state.players : []
    const hostId = players.find((player) => player.host)?.id || this.partyState?.hostId || 'player'
    const playerId = this.localPlayerId || this.party?.playerId || (role === 'host' ? hostId : null)
    const status = state?.matchStarted ? 'playing' : state?.connected ? 'lobby' : this.partyState?.status || 'connecting'
    this._setPartyState({...state, role, status, hostId, playerId, localPlayerId: playerId, players})
  }

  _setPartyState(state) {
    this.partyState = state ? structuredCloneSafe(state) : null
    for (const listener of this.partyStateListeners) listener(this.partyState)
  }

  _adoptGuestWorld(world, playerId) {
    const previous = this.world
    this.world = world
    this.localPlayerId = playerId
    this.world.localPlayerId = playerId
    this.world.hostPlayerId = playerId
    this.director.world = world
    this.director.phase = world.phase
    this.director.wave = world.wave
    world.purchase = (item) => this.party?.purchase(item) || Promise.resolve({ok: false, error: 'Party disconnected'})
    if (previous !== world) previous?.destroy?.()
  }

  _resetSingleWorld() {
    this.lobby?.stop()
    this.world?.destroy?.()
    this.world = new World({map: this.mapData, seed: this.seed})
    this.director = new WaveDirector(this.world, {
      builtin: new BuiltinSkynet({map: this.mapData}),
      intermissionSeconds: this.intermissionSeconds,
    })
    this.lobby = new LobbyClient({world: this.world, director: this.director, intermissionSeconds: this.intermissionSeconds})
  }

  _stopParty() {
    for (const off of this.partyOffs) off()
    this.partyOffs.length = 0
    this.party?.stop()
    this.party = null
  }

  stop() {
    this.menuAssetsAbort?.abort(); this.menuAssetsAbort = null
    this.menuAssets = null
    this.menuPreparationError = null
    this.warmupAbort?.abort()
    this.releaseLoadRender?.(); this.releaseLoadRender = null
    this.started = false
    this.matchStarting = false
    this.visualWarmup = null
    this.visualWarmupReport = null
    this.ui?.dispose()
    this._stopParty()
    this.cameraFeel?.dispose()
    this.lobby?.stop()
    this.input?.stop()
    this.hud?.dispose()
    this.stopViews()
    this.mapView?.stop()
    for (const [source, visible] of this.hiddenUnitSources || []) source.visible = visible
    this.hiddenUnitSources = null
    this.input = null
    this.lobby = null
    this.hud = null
    this.ui = null
    this.cameraFeel = null
    this.playerView = null
    this.grenadeView = null
    this.unitView = null
    this.mapView = null
    this.director = null
    this.world?.destroy?.()
    this.world = null
    this.mapData = null
    this.accumulator = 0
    this.sessionMode = 'single'
    this.localPlayerId = 'player'
    this.partyState = null
  }

  destroy() {
    this.releaseCoveredEditor?.();this.releaseCoveredEditor=null
    this.stop()
    return super.destroy()
  }
}

function structuredCloneSafe(value) {
  try { return structuredClone(value) } catch { return {...value} }
}
