import {scheduleMenuPreparation,createMenuAssetQueue} from './menu-preload.js'
import {weaponSurfaceMaps} from '../view/weapons-materials.js'
import {Screens} from './screens.js'
import {presentationSnapshot} from './presentation.js'
import {applyAudioSettings,prepareAudio} from './sfx.js'
import {PartySession} from './party.js'
import {SpectateView} from '../view/spectate.js'
import {projectViewModel} from '../core/viewmodel.js'
import {withCoopNameplates} from './coop-view.js'
import {MenuScene} from '../view/menu-scene.js'
import {BindingInput,keyLabel} from './bindings.js'
import {bindLobbyDifficulty} from './lobby-difficulty.js'
import {applyPerformanceQuality} from '../view/performance-quality.js'
import {WeaponsRange,parseRangeFlag} from '../core/range.js'
import {mountRangePanel} from './range.js'
import {RangeView} from '../view/range.js'
import {parseSandboxFlag,SandboxPanel} from './sandbox.js'
import {mountCrosshair} from './crosshair.js'


// Owns screen navigation and adapts existing gameplay/network APIs to UI callbacks.
export class UiSession {
  constructor(manager){
    this.manager=manager;this.active=true;this.lobbyOpened=false;this.readyPulse=false
    this.rangeEnabled=parseRangeFlag(globalThis.location?.search)
    this.sandboxEnabled=this.rangeEnabled || parseSandboxFlag(globalThis.location?.search)
    if(this.sandboxEnabled){manager.world.setSandbox({invulnerable:true,infiniteScrap:true});manager.director.setSandbox(true)}
    this.originalRenderScale=manager.ctx.viewer.renderManager.renderScale
    this.party=new PartySession(manager,state=>this.partyChanged(state))
    this.spectate=new SpectateView(manager.ctx.viewer)
    manager.ctx.viewer.canvas.removeEventListener('mousedown',this.spectate.onMouse,true)
    this.menuScene=new MenuScene(manager.ctx.viewer)
    this.screens=new Screens(manager.hud,{
      input:active=>this.setInput(active),
      settings:settings=>this.applySettings(settings),
      route:route=>{
        if(route==='main')this.cancelMatchPreparation()
        this.menuScene.setActive(manager.director.phase==='lobby' && ['main','lobby','party-host','party-join','settings','bindings'].includes(route))
        if(route==='main' && this.assetQueue?.stats.promoted){this.resetAssetQueue();this.schedulePreparation()}
      },
      retry:()=>this.loadMenu(),
      lobby:()=>this.openLobby(),
      start:()=>this.startMatch(),
      menu:()=>{manager.start()},
      restart:()=>{manager.start();manager.ui.openLobby();manager.ui.screens.show('lobby')},
      ready:()=>{this.readyPulse=true},
      purchase:item=>this.purchase(item),
      quotes:()=>this.quotes(),
      partyHost:options=>this.party.connect('host',options),
      partyJoin:options=>this.party.connect('guest',options),
      partyReady:value=>this.party.ready(value),
      partyCanReady:()=>typeof manager.setPartyReady==='function',
      partyStart:async override=>this.party.start(override),
      partyLeave:()=>this.party.leave(),
      returnParty:()=>manager.returnPartyToLobby(),
      spectate:direction=>this.spectate.cycle(direction),
      sandbox:()=>this.sandboxEnabled,
    })
    // Capture before Screens opens a controls card or starts asynchronous work.
    this.onStartClick = event => this.recordStartClick(event)
    manager.hud.root.addEventListener('click',this.onStartClick,true)
    this.sandbox=parseSandboxFlag(globalThis.location?.search)?new SandboxPanel(manager):null
    this.range=manager.range=this.rangeEnabled?new WeaponsRange(manager.world,manager.director):null
    this.rangePanel=mountRangePanel(manager)
    this.bindings=new BindingInput(manager.input,this.screens.settings.bindings)
    this.loadMenu()
  }
  async loadMenu(){
    this.menuLoadError=null
    this.cancelPreparation?.()
    this.resetAssetQueue()
    if(this.rangeEnabled){
      this.screens.show('loading');this.screens.loadingScreen()
      try {await this.startMatch();if(this.active)this.screens.show(null)}
      catch(error){if(this.active){console.error('[Range] Failed to start',error);this.screens.loadingError()}}
      return
    }
    this.screens.show('loading')
    this.screens.loadingScreen()
    try{
      const menu = this.manager.startup.measure('menu-assets-and-build', () => this.menuScene.load((loaded,total)=>{if(this.active)this.screens.loadingProgress(loaded,total)}))
      // Low-priority, bounded asset hints overlap menu downloads without
      // gating the menu. Lighting uses the production immutable decode cache.
      this.assetQueue.start()
      this.manager.prepareMenuAssets().catch(()=>{})
      await menu
      if(!this.active)return
    }catch(error){
      if(this.active){this.manager.releaseLoadRender?.();this.manager.releaseLoadRender=null;console.warn('[Presentation] Menu assets failed to load',error);this.menuLoadError={message:error?.message||String(error),stack:error?.stack};this.screens.loadingError()}
      return
    }
    this.screens.show('main')
    this.manager.releaseLoadRender?.();this.manager.releaseLoadRender=null
    this.manager.startup.mark('menu-ready')
    this.schedulePreparation()
    const invite=new URLSearchParams(location.search)
    if(invite.has('party') && this.sandboxEnabled)this.screens.toast('Sandbox is single-player only.')
    if(invite.has('party') && !this.sandboxEnabled){
      this.screens.party.invite=invite.get('party') || ''
      this.screens.party.relay=invite.get('relay') || ''
      this.screens.show('party-join')
    }
  }
  recordStartClick(event){
    const button = event.target?.closest?.('[data-action]')
    if (!button || button.disabled) return
    const action = button.dataset.action
    // The disconnected party START button creates a party, not a match.
    const party = this.screens.party.state
    if (action === 'party-start' && (!party?.code || !['connected','lobby','ready'].includes(party.status))) return
    if (action === 'start-match' || action === 'party-start' || (action === 'play' && this.sandboxEnabled)) {
      this.manager.startup.beginMatch('dom-start-click', event.timeStamp)
    }
  }
  resetAssetQueue(){
    this.assetQueue?.dispose()
    this.assetQueue = createMenuAssetQueue({onError:error=>{this.preparationError=error}})
    this.manager.startup.menuPreparation = this.assetQueue.stats
  }
  schedulePreparation(){
    this.cancelPreparation?.()
    this.cancelPreparation = scheduleMenuPreparation(() => {
      if (!this.active || this.manager.viewsStarted) return
      const maps = this.manager.startup.measure('menu-weapon-preload', () => weaponSurfaceMaps().ready)
      maps.catch(() => {})
      this.assetQueue?.start()
      this.manager.prepareMap()
      return maps
    }, {onError:error=>{this.preparationError=error}})
  }
  cancelMatchPreparation(){
    this.manager.startup.cancelMatch()
    if (!this.matchPreparation && !this.manager.matchStarting && !this.manager.warmupAbort) return
    this.manager.party?.cancelPreparing?.('Match preparation stopped')
    this.manager.stopViews()
    this.manager.mapView?.stop()
  }
  promotePreparation(){
    this.cancelPreparation?.()
    this.assetQueue?.promote()
  }
  partyChanged(state){
    if(!this.screens)return
    this.screens.party.refresh(state)
    if((state.status==='host_left' || state.error?.code==='host_left') && /host (left|connection)/i.test(state.error || state.notice || 'Host left')){
      this.setInput(false)
      this.screens.show('main')
      queueMicrotask(()=>{if(this.active && this.party.state?.status==='host_left')this.party.leave()})
    }else if(state.status==='playing' && ['party-host','party-join'].includes(this.screens.route)){
      if(!this.screens.settings.controlsSeen)void this.screens.enterMatch(()=>{})
      else this.screens.show(null)
    }
  }
  returnToPartyLobby(role){
    this.manager.startup.cancelMatch()
    this.setInput(false)
    this.menuScene.setActive(true)
    this.screens.ended=false
    this.screens.show(role==='host'?'party-host':'party-join')
    this.resetAssetQueue()
    this.schedulePreparation()
  }
  preparePartyMatch(){this.promotePreparation();this.menuScene.setActive(false)}
  get localPlayerId(){return this.manager.localPlayerId ?? this.party.state?.playerId ?? this.manager.world.localPlayerId ?? this.manager.world.hostPlayerId}
  get localPlayer(){return this.manager.world.getPlayer(this.localPlayerId) || this.manager.world.player}
  get frozen(){return this.screens.frozen && !(['pause','settings','bindings'].includes(this.screens.route) && this.party.state?.status==='playing')}
  setInput(active){
    const {manager:m}=this
    this.bindings?.setActive(active)
    if(active && this.localPlayer.alive && !m.rangeView?.inspecting){m.input.start({yaw:this.localPlayer.yaw,pitch:this.localPlayer.pitch});this.applySettings(this.screens.settings);if(m.input.active && m.viewsStarted)m.startup.inputReady()}
    else m.input.stop()
  }
  sample(){
    const m=this.manager
    const input=this.screens.route || !this.localPlayer.alive?{yaw:this.localPlayer.yaw,pitch:this.localPlayer.pitch}:this.bindings.sample()
    if(this.readyPulse){input.ready=true;this.readyPulse=false}
    if(this.range){
      if(this.range.firePulse){input.fire=true;this.range.firePulse=false}
      return this.range.input(input,m.rangeView?.inspecting?m.rangeView.loop:null)
    }
    return input
  }
  applySettings(settings){
    const m=this.manager
    if(this.bindings){this.bindings.bindings=settings.bindings;this.bindings.clear()}
    if(m.sessionMode!=='guest')m.director.setDifficulty(settings.difficulty)
    this.lobbyDifficulty?.sync().catch(()=>{})
    for(const [action,label] of [['trader','TRADER'],['ready','START WAVE']]){
      const node=m.hud.root.querySelector(`[data-action="${action}"]`)
      if(node)node.textContent=`${label} (${keyLabel(settings.bindings[action])})`
    }
    m.hud.root.style.setProperty('--hud-scale',String((settings.hud ?? 72)/100))
    m.input.mouseSensitivity=.0022*settings.sensitivity;m.input.fov=settings.fov
    const camera=m.playerView.camera
    if(camera){camera.fov=settings.fov;camera.updateProjectionMatrix()}
    this.crosshair=mountCrosshair(m.hud.root,settings,this.crosshair ?? null)
    applyPerformanceQuality(m,settings.quality)
    m.audio?.setVolumes?.({master:settings.master/100,music:settings.music/100,effects:settings.effects/100})
    window.dispatchEvent(new CustomEvent('terminator-audio-settings',{detail:{master:settings.master/100,music:settings.music/100,effects:settings.effects/100}}))
    applyAudioSettings({master:settings.master/100,music:settings.music/100,effects:settings.effects/100})
    m.ctx.viewer.setDirty()
  }
  openLobby(){
    if(this.lobbyOpened)return
    this.lobbyOpened=true
    const lobby=this.manager.lobby
    if(!lobby)return
    // The current client owns a legacy overlay and has no headless option. Replace only
    // its presentation methods on this instance; transport and director logic stay intact.
    this.lobbyMethods={}
    this.lobbyDifficulty=bindLobbyDifficulty(lobby,this.manager.director)
    for(const key of ['showLobby','renderConnectedLobby','useLocalFallback'])this.lobbyMethods[key]=lobby[key]
    lobby.showLobby=()=>{}
    lobby.renderConnectedLobby=()=>{this.lobbyDifficulty.sync().catch(()=>{})}
    lobby.useLocalFallback=()=>{
      this.manager.world.skynet.name='BUILT-IN'
      this.manager.world.skynet.connected=false
      this.lobbyError=lobby.serverUrl?'Lobby service offline. Built-in Skynet is ready.':null
    }
    lobby.start()
  }
  startMatch(){
    if(this.matchPreparation)return this.matchPreparation
    this.matchPreparation=this.prepareMatch().catch(error=>{
      this.manager?.startup?.failMatch?.(error)
      throw error
    }).finally(()=>{this.matchPreparation=null})
    return this.matchPreparation
  }
  async prepareMatch(){
    if(!this.active)return
    const profile=this.manager.startup, world=this.manager.world
    profile.beginMatch('solo-request')
    profile.mark('match-request')
    this.promotePreparation()
    // The plan only gates director.start; it need not serialize asset preparation.
    const plan=profile.measure('lobby-plan', () => this.lobbyDifficulty?.prepare().catch(()=>{}))
    this.menuScene.setActive(false)
    this.manager.releaseLoadRender?.();this.manager.releaseLoadRender=null
    if(this.range)this.range.start()
    this.manager.startViews()
    const [,warmup]=await Promise.all([plan,this.manager.visualWarmup,profile.measure('audio-ready', () => prepareAudio())])
    if(!this.active || warmup?.cancelled || this.manager.world!==world)throw new DOMException('Match preparation stopped','AbortError')
    if(this.range && !this.manager.rangeView){this.manager.rangeView=new RangeView(this.manager);await this.manager.rangeView.ready}
    if(!this.active || this.manager.world!==world)throw new DOMException('Match preparation stopped','AbortError')
    if(this.sandboxEnabled){this.manager.lobby?.stop();this.manager.director.setSandbox(true)}
    else if(this.manager.lobby?.active)this.manager.lobby.beginMatch()
    else this.manager.director.start()
    profile.mark('match-ready')
  }
  lobbySnapshot(){
    const {lobby,world}=this.manager
    const agentName=world.skynet.name==='BUILT-IN'?'':world.skynet.name
    return {code:lobby?.code,agentName,status:lobby?.code?'Uplink established / agent can join':this.lobbyError || (lobby?.serverUrl?'Opening uplink...':'Built-in Skynet is ready.'),error:this.lobbyError,installLine:lobby?.code?`claude mcp add skynet -- npx terminator-skynet-mcp --url ${lobby.serverUrl} --code ${lobby.code}`:'Waiting for lobby code'}
  }
  sync(view){
    this.party.sync()
    const {world,playerView}=this.manager
    if(this.localPlayerId!==world.hostPlayerId)view=projectViewModel(world,this.localPlayerId,{includeEnemyNameplates:false})
    const extra=presentationSnapshot(world,this.manager.director,this.localPlayerId)
    if(this.range)extra.presentationTimeMs=world.time*1000
    extra.party=this.party.state
    extra.spectate=this.spectate.sync(world,this.localPlayerId,playerView,!this.screens.route,this.manager.playersView,this.screens.settings.fov)
    view=withCoopNameplates(view,world,this.localPlayerId,extra.spectate)
    if(this.wasDead!==!this.localPlayer.alive){this.wasDead=!this.localPlayer.alive;this.setInput(!this.screens.route)}
    this.manager.hud.render(view,extra)
    this.crosshair?.sync(view,!this.screens.route && this.localPlayer.alive)
    this.screens.render(view,extra,this.lobbySnapshot())
    this.sandbox?.sync()
    this.rangePanel?.sync()
  }
  quotes(){
    const world=this.manager.world
    if(typeof world.traderViewModel==='function')return world.traderViewModel(this.localPlayerId)
    return {fillAmmo:null,fullArmor:null,medkit:null,error:'Purchases unavailable: core purchase API is not installed.'}
  }
  purchase(item){
    const world=this.manager.world
    // director pass: a relax window opens the trader inside a wave too.
    if(world.phase!=='intermission' && !world.traderOpen && !this.sandboxEnabled)return {ok:false,error:'Trader closed'}
    if(typeof world.purchase!=='function')return {ok:false,error:'Purchase unavailable: World.purchase is not installed.'}
    return world.purchase(item,this.localPlayerId)
  }
  dispose(){
    this.active=false
    this.cancelPreparation?.()
    this.assetQueue?.dispose()
    this.manager.hud.root.removeEventListener('click',this.onStartClick,true)
    this.manager.startup.cancelMatch()
    this.rangePanel?.dispose()
    this.crosshair?.stop();this.crosshair=null
    this.manager.rangeView?.dispose();this.manager.rangeView=null
    this.manager.range=null;this.range=null
    // The unit material cache survives a match. Detach this match's SSAO extension
    // before GameManager disposes its materials and then removes the post plugin.
    // Otherwise the next match registers a second tSSAOMap uniform on the cache.
    for(const material of Object.values(this.manager.unitView?.materials || {})) {
      if(!material?.isMaterial)continue
      const extensions=material.materialExtensions?.filter(extension=>extension.uuid==='SSAOPlugin') || []
      if(extensions.length)material.unregisterMaterialExtensions(extensions)
    }
    this.menuScene.dispose()
    this.bindings?.dispose()
    this.lobbyDifficulty?.dispose()
    this.party.dispose()
    this.spectate.dispose()
    this.sandbox?.dispose()
    this.screens.dispose()
    if(this.lobbyMethods)for(const [key,method]of Object.entries(this.lobbyMethods))this.manager.lobby[key]=method
    if(this.originalRenderScale!==undefined)this.manager.ctx.viewer.renderManager.renderScale=this.originalRenderScale
  }
}
