import {Object3DComponent} from 'threepipe'
import mapData from '../lib/core/data/map.json' with {type: 'json'}
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
import {CameraFeel} from '../lib/view/camera-feel.js'
import {GrenadeView} from '../lib/view/grenade.js'
import {InputController} from '../lib/view/input.js'
import {MapView} from '../lib/view/map.js'
import {PlayerView} from '../lib/view/player.js'
import {UnitView} from '../lib/view/units.js'
import {mountPlayersView} from '../lib/view/players.js'
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

  start() {
    this.stop()
    const viewer = this.ctx.viewer
    this.world = new World({map: mapData, seed: this.seed})
    this.sessionMode = 'single'
    this.localPlayerId = this.world.hostPlayerId
    this.partyState = null
    this.director = new WaveDirector(this.world, {
      builtin: new BuiltinSkynet({map: mapData}),
      intermissionSeconds: this.intermissionSeconds,
    })
    this.mapView = new MapView(viewer, mapData)
    this.unitView = new UnitView(viewer)
    this.playerView = new PlayerView(viewer)
    this.grenadeView = new GrenadeView(viewer)
    this.input = new InputController(viewer)
    this.hud = new Hud(viewer)
    this.lobby = new LobbyClient({world: this.world, director: this.director, intermissionSeconds: this.intermissionSeconds})
    this.cameraFeel = new CameraFeel()
    const rangeSource=viewer.scene.modelRoot.getObjectByName('Weapons Range') || viewer.scene.modelRoot.getObjectByName('Weapons_Range')
    this.rangePreview=rangeSource?{source:rangeSource,visible:rangeSource.visible}:null
    if(rangeSource)rangeSource.visible=false
    this.ui = new UiSession(this)
    this.accumulator = 0
    this.started = true
    this.syncViews()
  }

  startViews() {
    if (this.viewsStarted || !this.world) return false
    try {
      this.mapView.start()
      this.unitView.start(this.world)
      this.playerView.start(this.world)
      this.grenadeView.start(this.world, this.playerView.weapons.material)
      this.playersView = mountPlayersView(this.ctx.viewer, this.world,
        () => this.localPlayerId ?? this.world?.localPlayerId ?? this.world?.player?.id ?? 'player')
      this.viewsStarted = true
      this.syncViews()
      this.visualWarmup = warmupMatch(this).then(report => {
        if(this.viewsStarted)this.visualWarmupReport=report
        return report
      })
      return true
    } catch (error) {
      this.playersView?.stop(); this.playersView = null
      this.grenadeView?.stop()
      this.playerView?.stop()
      this.unitView?.stop()
      this.mapView?.stop()
      throw error
    }
  }

  stopViews() {
    if (!this.viewsStarted) return
    this.viewsStarted = false
    this.playersView?.stop(); this.playersView = null
    this.grenadeView?.stop()
    this.playerView?.stop()
    this.unitView?.stop()
    this.mapView?.stop()
  }

  update({deltaTime} = {}) {
    if (!this.started || !this.world) return
    if (this.ui?.frozen || (!this.range && this.cameraFeel?.hitStopped)) {
      this.accumulator = 0
      if (this.sessionMode !== 'guest') this.lobby?.update()
      this.party?.interpolate?.()
      this.ui?.sync(projectViewModel(this.world, this.localPlayerId))
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
      if (this.cameraFeel?.hitStopped) { this.accumulator = 0; break }
    }
    if (steps === 8) this.accumulator = Math.min(this.accumulator, TICK_SECONDS)
    if (this.sessionMode !== 'guest') this.lobby?.update()
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
    this.unitView?.sync(this.world)
    this.playersView?.sync(this.world)
    this.playerView?.sync(this.world)
    this.grenadeView?.sync(this.world)
    this.cameraFeel?.apply(this.playerView?.camera,this.range?this.world.time:undefined)
    this.rangeView?.sync(this.world)
    if (this.ui) this.ui.sync(projectViewModel(this.world, this.localPlayerId))
    else this.hud?.render(projectViewModel(this.world, this.localPlayerId))
    this.ctx.viewer.setDirty(this)
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
    try {
      this.ui?.preparePartyMatch()
      const preparation = this.party.prepareMatch({hostLoaded: false})
      try {
        this.startViews()
        await Promise.all([this.visualWarmup, prepareAudio()])
        this.party.acceptLoaded(this.localPlayerId)
      } catch (error) {
        this.party.cancelPreparing(error)
        throw error
      }
      const prepared = await preparation
      if (prepared?.ok === false) return prepared
      const result = this.director.start()
      if (result === false || result?.ok === false) return result || {ok: false, error: 'Match could not start'}
      this.party.startMatch()
      this._acceptPartyState(this.party.state(), 'host')
      return {ok: true}
    } finally {
      this.matchStarting = false
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
      this.ui?.preparePartyMatch()
      this.startViews()
      party.loaded?.()
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
    this.world = new World({map: mapData, seed: this.seed})
    this.director = new WaveDirector(this.world, {
      builtin: new BuiltinSkynet({map: mapData}),
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
    this.started = false
    this.matchStarting = false
    this.visualWarmup = null
    this.visualWarmupReport = null
    this.ui?.dispose()
    if(this.rangePreview){this.rangePreview.source.visible=this.rangePreview.visible;this.rangePreview=null}
    this._stopParty()
    this.cameraFeel?.dispose()
    this.lobby?.stop()
    this.input?.stop()
    this.hud?.dispose()
    this.stopViews()
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
    this.accumulator = 0
    this.sessionMode = 'single'
    this.localPlayerId = 'player'
    this.partyState = null
  }

  destroy() {
    this.stop()
    return super.destroy()
  }
}

function structuredCloneSafe(value) {
  try { return structuredClone(value) } catch { return {...value} }
}
