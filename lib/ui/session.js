import {Screens} from './screens.js'
import {presentationSnapshot} from './presentation.js'
import {applyAudioSettings} from './sfx.js'
import {PartySession} from './party.js'
import {SpectateView} from '../view/spectate.js'
import {projectViewModel} from '../core/viewmodel.js'
import {withCoopNameplates} from './coop-view.js'
import {MenuScene} from '../view/menu-scene.js'
import {BindingInput,keyLabel} from './bindings.js'
import {bindLobbyDifficulty} from './lobby-difficulty.js'
import {applyPerformanceQuality} from '../view/performance-quality.js'


// Owns screen navigation and adapts existing gameplay/network APIs to UI callbacks.
export class UiSession {
  constructor(manager){
    this.manager=manager;this.active=true;this.lobbyOpened=false;this.readyPulse=false
    this.originalRenderScale=manager.ctx.viewer.renderManager.renderScale
    this.party=new PartySession(manager,state=>this.partyChanged(state))
    this.spectate=new SpectateView(manager.ctx.viewer)
    manager.ctx.viewer.canvas.removeEventListener('mousedown',this.spectate.onMouse,true)
    this.menuScene=new MenuScene(manager.ctx.viewer)
    this.screens=new Screens(manager.hud,{
      input:active=>this.setInput(active),
      settings:settings=>this.applySettings(settings),
      route:route=>this.menuScene.setActive(manager.director.phase==='lobby' && ['main','lobby','party-host','party-join','settings','bindings'].includes(route)),
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
      partyStart:async override=>{this.menuScene.setActive(false);return this.party.start(override)},
      partyLeave:()=>this.party.leave(),
      spectate:direction=>this.spectate.cycle(direction),
    })
    this.bindings=new BindingInput(manager.input,this.screens.settings.bindings)
    this.loadMenu()
  }
  async loadMenu(){
    this.screens.show('loading')
    this.screens.loadingScreen()
    try{
      await this.menuScene.load((loaded,total)=>{if(this.active)this.screens.loadingProgress(loaded,total)})
      if(!this.active)return
    }catch(error){
      if(this.active){console.warn('[Presentation] Menu assets failed to load');this.screens.loadingError()}
      return
    }
    this.screens.show('main')
    const invite=new URLSearchParams(location.search)
    if(invite.has('party')){
      this.screens.party.invite=invite.get('party') || ''
      this.screens.party.relay=invite.get('relay') || ''
      this.screens.show('party-join')
    }
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
  get localPlayerId(){return this.manager.localPlayerId ?? this.party.state?.playerId ?? this.manager.world.localPlayerId ?? this.manager.world.hostPlayerId}
  get localPlayer(){return this.manager.world.getPlayer(this.localPlayerId) || this.manager.world.player}
  get frozen(){return this.screens.frozen && !(['pause','settings','bindings'].includes(this.screens.route) && this.party.state?.status==='playing')}
  setInput(active){
    const {manager:m}=this
    this.bindings?.setActive(active)
    if(active && this.localPlayer.alive){m.input.start({yaw:this.localPlayer.yaw,pitch:this.localPlayer.pitch});this.applySettings(this.screens.settings)}
    else m.input.stop()
  }
  sample(){
    const m=this.manager
    const input=this.screens.route || !this.localPlayer.alive?{yaw:this.localPlayer.yaw,pitch:this.localPlayer.pitch}:this.bindings.sample()
    if(this.readyPulse){input.ready=true;this.readyPulse=false}
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
    m.input.mouseSensitivity=.0022*settings.sensitivity;m.input.fov=settings.fov
    const camera=m.playerView.camera
    if(camera){camera.fov=settings.fov;camera.updateProjectionMatrix()}
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
    lobby.useLocalFallback=()=>{this.lobbyError='Lobby service offline. Built-in Skynet is ready.'}
    lobby.start()
  }
  async startMatch(){
    await this.lobbyDifficulty?.prepare().catch(()=>{})
    if(!this.active)return
    this.menuScene.setActive(false)
    this.manager.startViews()
    if(this.manager.lobby?.active)this.manager.lobby.beginMatch()
    else this.manager.director.start()
  }
  lobbySnapshot(){
    const {lobby,world}=this.manager
    const agentName=world.skynet.name==='BUILT-IN'?'':world.skynet.name
    return {code:lobby?.code,agentName,status:lobby?.code?'Uplink established / agent can join':this.lobbyError || 'Opening uplink...',error:this.lobbyError,installLine:lobby?.code?`claude mcp add skynet -- npx terminator-skynet-mcp --url ${lobby.serverUrl} --code ${lobby.code}`:'Waiting for lobby code'}
  }
  sync(view){
    this.party.sync()
    const {world,playerView}=this.manager
    if(this.localPlayerId!==world.hostPlayerId)view=projectViewModel(world,this.localPlayerId)
    const extra=presentationSnapshot(world,this.manager.director,this.localPlayerId)
    extra.spectate=this.spectate.sync(world,this.localPlayerId,playerView,!this.screens.route,this.manager.playersView,this.screens.settings.fov)
    view=withCoopNameplates(view,world,this.localPlayerId,extra.spectate)
    if(this.wasDead!==!this.localPlayer.alive){this.wasDead=!this.localPlayer.alive;this.setInput(!this.screens.route)}
    this.manager.hud.render(view,extra)
    this.screens.render(view,extra,this.lobbySnapshot())
  }
  quotes(){
    const world=this.manager.world
    if(typeof world.traderViewModel==='function')return world.traderViewModel(this.localPlayerId)
    return {fillAmmo:null,fullArmor:null,medkit:null,error:'Purchases unavailable: core purchase API is not installed.'}
  }
  purchase(item){
    const world=this.manager.world
    if(world.phase!=='intermission')return {ok:false,error:'Trader closed'}
    if(typeof world.purchase!=='function')return {ok:false,error:'Purchase unavailable: World.purchase is not installed.'}
    return world.purchase(item,this.localPlayerId)
  }
  dispose(){
    this.active=false
    // The unit material cache survives a match. Detach this match's SSAO extension
    // before GameManager disposes its materials and then removes the post plugin.
    // Otherwise the next match registers a second tSSAOMap uniform on the cache.
    const cachedMetal=this.manager.unitView?.materials?.metal
    const extensions=cachedMetal?.materialExtensions?.filter(extension=>extension.uuid==='SSAOPlugin') || []
    if(extensions.length)cachedMetal.unregisterMaterialExtensions(extensions)
    this.menuScene.dispose()
    this.bindings?.dispose()
    this.lobbyDifficulty?.dispose()
    this.party.dispose()
    this.spectate.dispose()
    this.screens.dispose()
    if(this.lobbyMethods)for(const [key,method]of Object.entries(this.lobbyMethods))this.manager.lobby[key]=method
    if(this.originalRenderScale!==undefined)this.manager.ctx.viewer.renderManager.renderScale=this.originalRenderScale
  }
}
