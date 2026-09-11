import {Screens} from './screens.js'
import {presentationSnapshot,DOSSIER_UNAVAILABLE_PLACEHOLDER} from './presentation.js'
import {applyAudioSettings} from './sfx.js'

let lastReceivedDossier = DOSSIER_UNAVAILABLE_PLACEHOLDER

// Owns screen navigation and adapts existing gameplay/network APIs to UI callbacks.
export class UiSession {
  constructor(manager){
    this.manager=manager;this.active=true;this.lobbyOpened=false;this.readyPulse=false
    this.originalRenderScale=manager.ctx.viewer.renderManager.renderScale
    this.screens=new Screens(manager.hud,{
      input:active=>this.setInput(active),
      settings:settings=>this.applySettings(settings),
      lobby:()=>this.openLobby(),
      start:()=>this.startMatch(),
      menu:()=>{manager.start()},
      restart:()=>{manager.start();manager.ui.openLobby();manager.ui.screens.show('lobby')},
      ready:()=>{this.readyPulse=true},
      purchase:item=>this.purchase(item),
      quotes:()=>this.quotes(),
      dossier:()=>this.fetchDossier(),
    })
    this.screens.show('main')
    this.screens.setDossier(lastReceivedDossier)
  }
  get frozen(){return this.screens.frozen}
  setInput(active){
    const {manager:m}=this
    if(active){m.input.start({yaw:m.world.player.yaw,pitch:m.world.player.pitch});this.applySettings(this.screens.settings)}
    else m.input.stop()
  }
  sample(){
    const m=this.manager
    const input=this.screens.route?{yaw:m.world.player.yaw,pitch:m.world.player.pitch}:m.input.sample()
    if(this.readyPulse){input.ready=true;this.readyPulse=false}
    return input
  }
  applySettings(settings){
    const m=this.manager
    m.input.mouseSensitivity=.0022*settings.sensitivity;m.input.fov=settings.fov
    const camera=m.playerView.camera
    if(camera){camera.fov=settings.fov;camera.updateProjectionMatrix()}
    m.ctx.viewer.renderManager.renderScale={low:.65,medium:.85,high:1}[settings.quality]
    m.audio?.setVolumes?.({master:settings.master/100,music:settings.music/100,effects:settings.effects/100})
    window.dispatchEvent(new CustomEvent('terminator-audio-settings',{detail:{master:settings.master/100,music:settings.music/100,effects:settings.effects/100}}))
    applyAudioSettings(settings)
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
    for(const key of ['showLobby','renderConnectedLobby','useLocalFallback'])this.lobbyMethods[key]=lobby[key]
    lobby.showLobby=()=>{}
    lobby.renderConnectedLobby=()=>{}
    lobby.useLocalFallback=()=>{this.lobbyError='Lobby service offline. Built-in Skynet is ready.'}
    lobby.start()
  }
  startMatch(){
    if(this.manager.lobby?.active)this.manager.lobby.beginMatch()
    else this.manager.director.start()
  }
  lobbySnapshot(){
    const {lobby,world}=this.manager
    const agentName=world.skynet.name==='BUILT-IN'?'':world.skynet.name
    return {code:lobby?.code,agentName,status:lobby?.code?'Uplink established / agent can join':this.lobbyError || 'Opening uplink...',error:this.lobbyError,installLine:lobby?.code?`claude mcp add skynet -- npx terminator-skynet-mcp --url ${lobby.serverUrl} --code ${lobby.code}`:'Waiting for lobby code'}
  }
  sync(view){
    const extra=presentationSnapshot(this.manager.world,this.manager.director)
    this.manager.hud.render(view,extra)
    this.screens.render(view,extra,this.lobbySnapshot())
  }
  quotes(){
    const world=this.manager.world
    if(typeof world.traderViewModel==='function')return world.traderViewModel()
    return {fillAmmo:null,fullArmor:null,medkit:null,error:'Purchases unavailable: core purchase API is not installed.'}
  }
  purchase(item){
    const world=this.manager.world
    if(world.phase!=='intermission')return {ok:false,error:'Trader closed'}
    if(typeof world.purchase!=='function')return {ok:false,error:'Purchase unavailable: World.purchase is not installed.'}
    return world.purchase(item)
  }
  async fetchDossier(){
    const lobby=this.manager.lobby
    if(!lobby?.baseUrl){this.screens.setDossier(lastReceivedDossier);return}
    try{
      const response=await lobby.fetch(`${lobby.baseUrl}/dossier`)
      if(!response.ok)throw new Error(`Dossier request failed: HTTP ${response.status}`)
      const data=await response.json()
      if(this.active){lastReceivedDossier=data;this.screens.setDossier(data)}
    }catch(error){if(this.active){this.screens.setDossier(DOSSIER_UNAVAILABLE_PLACEHOLDER);this.screens.toast(error.message)}}
  }
  dispose(){
    this.active=false
    this.screens.dispose()
    if(this.lobbyMethods)for(const [key,method]of Object.entries(this.lobbyMethods))this.manager.lobby[key]=method
    if(this.originalRenderScale!==undefined)this.manager.ctx.viewer.renderManager.renderScale=this.originalRenderScale
  }
}
