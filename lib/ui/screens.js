import {icon,SKULL} from './icons.js'
import {animate,escapeHtml as esc} from './hud.js'
import {loadSettings,saveSettings} from './settings.js'
import {iconButton,itemName,playerLabels,shortStatus} from './labels.js'
import * as sfx from './sfx.js'
import {PartyScreens} from './party-screens.js'

const btn=(action,label,kind='')=>`<button class="tm-btn ${kind}" data-action="${action}" data-testid="${action==='play'?'menu-play':action}">${label}</button>`
const header=(title='',action='back')=>`<header class="tm-screen-header"><h1>${title}</h1>${iconButton(action,'Back','back')}</header>`
export class Screens {
  constructor(hud,actions){
    this.hud=hud;this.actions=actions;this.route=null;this.settings=loadSettings();this.category='weapons'
    this.root=document.createElement('section');this.root.className='tm-screen';this.root.hidden=true;this.root.dataset.testid='game-screen';hud.root.append(this.root)
    this.party=new PartyScreens(this)
    this.toastNode=document.createElement('div');this.toastNode.className='tm-toast';this.toastNode.hidden=true;this.toastNode.setAttribute('role','status');hud.root.append(this.toastNode)
    this.onClick=e=>{const button=e.target.closest('[data-action]');if(button && hud.root.contains(button))this.action(button.dataset.action,button)}
    this.onInput=e=>{const key=e.target.dataset.setting;if(!key)return;this.settings[key]=key==='quality'?e.target.value:Number(e.target.value);const output=this.root.querySelector(`[data-output="${key}"]`);if(output)output.textContent=this.formatSetting(key,this.settings[key]);this.actions.settings(this.settings);if(!saveSettings(this.settings))this.toast('Storage unavailable')}
    this.onMouse=e=>{if(this.route!=='main')return;const b=this.hud.box;this.root.style.setProperty('--eye-x',`${((e.clientX-b.left)/b.width-.5)*12}px`);this.root.style.setProperty('--eye-y',`${((e.clientY-b.top)/b.height-.5)*10}px`)}
    this.onKey=e=>{
      if(e.code==='Tab' && this.route){const nodes=[...this.root.querySelectorAll('button:not(:disabled),input,select')].filter(n=>n.offsetParent!==null);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey && (document.activeElement===first || !this.root.contains(document.activeElement))){e.preventDefault();last?.focus()}else if(!e.shiftKey && (document.activeElement===last || !this.root.contains(document.activeElement))){e.preventDefault();first?.focus()}return}
      if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return
      if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.action(this.route?'back':'pause');return}
      if(this.view?.wave.phase==='intermission' && (!this.route || this.route==='trader')){
        if(e.code==='KeyR' || e.code==='KeyE'){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)this.action(e.code==='KeyR'?'ready':this.route==='trader'?'back':'trader')}
      }
    }
    hud.root.addEventListener('click',this.onClick);this.root.addEventListener('input',this.onInput);window.addEventListener('mousemove',this.onMouse);window.addEventListener('keydown',this.onKey,true)
    this.actions.settings(this.settings)
  }
  show(route){
    if(route===this.route)return
    this.toastNode.hidden=true
    this.previousRoute=this.route;this.route=route;this.root.hidden=!route;this.root.dataset.screen=route || 'playing';this.hud.elements.combat.hidden=Boolean(route && route!=='pause')
    this.root.className=`tm-screen${route==='main'?' tm-menu':route==='pause'?' tm-paused':route==='trader'?' tm-trader-screen':''}`
    this.root.setAttribute('aria-label',route?`${route} screen`:'Game')
    this.root.setAttribute('role','dialog')
    if(!route){this.root.replaceChildren();this.actions.input(true);return}
    this.actions.input(false)
    if(route==='main')this.main()
    else if(route==='lobby')this.lobby()
    else if(route==='pause')this.pause()
    else if(route==='settings')this.settingsScreen()
    else if(route==='trader')this.trader()
    else if(route==='postmatch')this.postmatch()
    else if(route==='quit')this.quit()
    else if(route==='party-host' || route==='party-join')this.party.show(route)
    this.root.querySelector('button')?.focus({preventScroll:true})
  }
  get frozen(){return Boolean(this.route && this.route!=='trader')}
  render(view,extra,lobby){
    this.view=view;this.extra=extra;this.lobbyState=lobby
    if(this.toastUntil && performance.now()>this.toastUntil)this.toastNode.hidden=true
    if(extra.matchStarted && view.wave.phase==='ended' && !this.ended){this.ended=true;this.show('postmatch')}
    if(this.route==='trader' && view.wave.phase!=='intermission'){this.show(null)}
    if(this.route==='trader')this.refreshTrader()
    if(this.route==='lobby')this.refreshLobby()
    if(this.route==='party-host' || this.route==='party-join')this.party.refresh()
  }
  main(){this.root.innerHTML=`<div class="tm-brand"><h1>TERMINATOR</h1><div class="tm-brand-subtitle">HUMAN VS SKYNET</div><nav class="tm-menu-nav" aria-label="Main menu">${btn('play','PLAY','primary')}${btn('host-party','HOST PARTY')}${btn('join-party','JOIN PARTY')}${btn('connect-agent','CONNECT AGENT')}${btn('settings','SETTINGS')}${btn('quit','QUIT')}</nav></div><div class="tm-menu-art">${SKULL}</div>`}
  lobby(){this.root.innerHTML=`${header('SKYNET LOBBY','main-menu')}<div class="tm-lobby-grid"><div><div class="tm-eyebrow">LOBBY CODE</div><h2 class="tm-code" data-live="code"></h2><p class="tm-status" role="status"><span data-live="agentIcon"></span> <span data-live="agent"></span></p><div class="tm-eyebrow">CONNECT YOUR AGENT WITH</div><div class="tm-install"><code class="tm-mono" data-live="install"></code><button class="tm-btn ghost" data-action="copy-mcp" data-testid="copy-mcp">COPY</button></div></div></div><div class="tm-screen-footer">${btn('start-match','START','primary')}</div>`;this.refreshLobby()}
  refreshLobby(){
    const state=this.lobbyState || {}
    this.live('code',state.code || '------')
    const iconNode=this.root.querySelector('[data-live="agentIcon"]')
    iconNode.innerHTML=icon(state.error?'pause':state.agentName?'check':state.code?'skull':'pause')
    this.live('agent',state.agentName?`${state.agentName} connected`:state.error?'Lobby offline. Built-in Skynet plays.':state.code?'No agent yet. Built-in Skynet plays if you start now.':'Connecting')
    if(state.agentName && state.agentName!==this.lastLobbyAgent){this.lastLobbyAgent=state.agentName;animate(this.root.querySelector('[data-live="agent"]'),'tm-power');sfx.skynetPowerOn()}
    this.live('install',state.code?state.installLine:'')
    const copy=this.root.querySelector('[data-action="copy-mcp"]');if(copy)copy.disabled=!state.code
  }
  pause(){this.root.innerHTML=`<div class="tm-pause-card" aria-label="Paused"><h1>PAUSED</h1>${btn('resume','RESUME','primary')}<div class="tm-pause-utilities">${btn('settings','SETTINGS')}${btn('main-menu','MAIN MENU','danger')}</div></div>`}
  settingsScreen(){this.root.innerHTML=`${header('SETTINGS')}<div class="tm-settings-grid"><div>${[['sensitivity','Sensitivity',.25,3,.05],['fov','FOV',60,110,1],['master','Master',0,100,1],['music','Music',0,100,1],['effects','Effects',0,100,1]].map(([key,label,min,max,step])=>`<label class="tm-setting"><span>${label}</span><input aria-label="${label}" data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${this.settings[key]}"><output data-output="${key}">${this.formatSetting(key,this.settings[key])}</output></label>`).join('')}<label class="tm-setting"><span>Quality</span><select data-setting="quality" aria-label="Quality">${['low','medium','high'].map(q=>`<option value="${q}" ${q===this.settings.quality?'selected':''}>${q.toUpperCase()}</option>`).join('')}</select></label></div></div>`}
  formatSetting(key,value){return key==='sensitivity'?`${Number(value).toFixed(2)}x`:key==='fov'?`${value}°`:`${value}%`}
  trader(){this.root.innerHTML=`${header('TRADER')}<div class="tm-trader-grid"><nav class="tm-categories" aria-label="Trader categories">${[['weapons','m4'],['ammo','ammo'],['armor','armor'],['items','crate']].map(([category,i])=>`<button data-action="category:${category}" class="${this.category===category?'selected':''}">${icon(i)}${category.toUpperCase()}</button>`).join('')}</nav><div class="tm-items" data-live="items"></div><aside class="tm-loadout"><div class="tm-eyebrow">SCRAP</div><div class="tm-balance" aria-label="Scrap">${icon('scrap')}<span data-live="balance"></span></div><button class="tm-btn" data-action="purchase:fill-ammo" aria-label="Fill all ammo">${icon('ammo')}FILL AMMO <span data-live="fillPrice"></span></button><button class="tm-btn" data-action="purchase:full-armor" aria-label="Buy full armor">${icon('armor')}FULL ARMOR <span data-live="armorPrice"></span></button><div class="tm-eyebrow">CLOSES IN</div><b class="tm-time" data-live="time" aria-label="Time remaining"></b><p class="tm-muted">E closes the trader. R starts the next wave.</p></aside></div>`;this.traderKey='';this.refreshTrader()}
  refreshTrader(){
    const extra=this.extra;if(!extra)return
    this.live('balance',this.view.scrap.toLocaleString(),true);this.live('time',`${Math.ceil(this.view.wave.timer)}s`)
    const quotes=this.actions.quotes()
    this.live('fillPrice',quotes.fillAmmo ?? '…');this.live('armorPrice',quotes.fullArmor ?? '…')
    const key=JSON.stringify([this.category,extra.loadout,extra.armor,extra.grenades,quotes])
    if(key===this.traderKey)return;this.traderKey=key
    let items=[]
    if(this.category==='weapons')items=Object.values(extra.catalog).filter(w=>w.slot).map(w=>({...w,action:w.id,owned:extra.loadout.some(o=>o.id===w.id)}))
    if(this.category==='ammo')items=extra.loadout.map(w=>({...w,owned:false,action:`ammo:${w.id}`,price:w.ammoPrice}))
    if(this.category==='armor')items=[{id:'armor',action:'full-armor',price:quotes.fullArmor}]
    if(this.category==='items')items=[{...extra.catalog.grenade,action:'grenade'},{id:'health',action:'medkit',price:quotes.medkit}]
    this.root.querySelector('[data-live="items"]').innerHTML=items.map(item=>`<article class="tm-item">${icon(item.id)}<h3>${esc(itemName(item))}</h3><button class="tm-btn" data-action="purchase:${item.action}" aria-label="${esc(`${item.owned?'Owned':'Buy'} ${itemName(item)}`)}" ${item.owned || item.price==null?'disabled':''}>${item.price ?? '…'}${item.owned?icon('check'):''}</button></article>`).join('')
  }
  postmatch(){
    if(this.extra.scoreboard?.length>1){this.scoreboard();return}
    const s=this.extra.stats
    this.root.innerHTML=`${header(s.survived?'SURVIVED':'<span class="tm-red">TERMINATED</span>','main-menu')}<div class="tm-result-wave" aria-label="Wave reached">WAVE ${s.wave}/10</div><div class="tm-match-stats">${[['skull','KILLS',Object.values(s.kills).reduce((a,b)=>a+b,0)],['aim','ACCURACY',`${s.accuracy}%`],['health','DAMAGE TAKEN',s.damage],['scrap','SCRAP',s.scrap.toLocaleString()]].map(([glyph,label,value])=>`<div class="tm-match-stat" aria-label="${label}">${icon(glyph)}<b>${value}</b><small class="tm-eyebrow">${label}</small></div>`).join('')}</div><div class="tm-screen-footer">${btn('play-again','PLAY AGAIN','primary')}</div>`
  }
  scoreboard(){
    const stats=this.extra.stats
    this.root.innerHTML=`${header(stats.survived?'SURVIVED':'<span class="tm-red">TERMINATED</span>','main-menu')}<div class="tm-result-wave" aria-label="Wave reached">WAVE ${stats.wave}/10</div><div class="tm-scoreboard-wrap"><table class="tm-scoreboard" data-testid="coop-scoreboard" aria-label="${this.extra.scoreboardPartial?'Partial match results':'Match results'}"><thead><tr><th scope="col">PLAYER</th>${[['skull','KILLS'],['aim','ACCURACY'],['health','DAMAGE TAKEN'],['scrap','SCRAP']].map(([glyph,label])=>`<th scope="col" aria-label="${label}">${icon(glyph)} ${label}</th>`).join('')}</tr></thead><tbody>${this.extra.scoreboard.map((player,index)=>`<tr class="${player.id===this.extra.localPlayerId?'local':''}" aria-label="${esc(player.name)}${player.connected?'':' disconnected'}"><td class="tm-score-name">${esc(player.name)}${player.connected?'':' (left)'}</td><td>${player.kills}</td><td>${player.accuracy}%</td><td>${player.damageTaken==null?'?':player.damageTaken.toLocaleString()}</td><td>${player.scrap==null?'?':player.scrap.toLocaleString()}</td></tr>`).join('')}</tbody></table></div><div class="tm-screen-footer">${btn('play-again','PLAY AGAIN','primary')}</div>`
  }
  quit(){this.root.innerHTML=`<div class="tm-pause-card" style="margin:auto"><h1>QUIT TO MAIN MENU?</h1>${btn('main-menu','QUIT','danger')}${btn('back','BACK')}</div>`}
  async action(action,button){
    if(button?.disabled)return
    if(await this.party.action(action))return
    if(action==='host-party' || action==='join-party'){this.show(action==='host-party'?'party-host':'party-join');return}
    if(action==='spectate-next' || action==='spectate-previous'){this.actions.spectate(action==='spectate-next'?1:-1);return}
    if(action?.startsWith('category:')){this.category=action.split(':')[1];this.trader();return}
    if(action?.startsWith('purchase:')){
      const item=action.slice(9)
      const result=await this.actions.purchase(item)
      if(!this.root.isConnected)return
      const ok=result?.ok===true
      const message=ok?'':shortStatus(result?.error)
      this.live('purchaseFeedback',message)
      if(ok){sfx.purchaseSuccess(item);animate(this.root.querySelector('[data-live="balance"]'))}else{sfx.purchaseDenied();if(button)animate(button,'tm-denied');this.toast(message)}
      this.traderKey='';return
    }
    if(action==='copy-mcp'){try{await navigator.clipboard.writeText(this.lobbyState.installLine);animate(button)}catch{this.toast('Clipboard unavailable')}return}
    if(action==='settings'){this.settingsReturn=this.route || 'pause';this.show('settings');return}
    if(action==='back'){if(['party-host','party-join'].includes(this.route)){this.actions.partyLeave();this.party.state=null;this.show('main')}else if(this.route==='settings')this.show(this.settingsReturn || 'main');else if(['pause','trader'].includes(this.route))this.show(null);else this.show('main');return}
    if(action==='pause'){if(!this.route)this.show('pause');return}
    if(action==='resume'){this.show(null);return}
    if(action==='play' || action==='connect-agent'){this.actions.lobby();this.show('lobby');return}
    if(action==='start-match'){this.actions.start();this.show(null);this.hud.lastPhase='';return}
    if(action==='main-menu'){this.actions.menu();return}
    if(action==='play-again'){this.actions.restart();return}
    if(action==='trader'){if(this.view.wave.phase==='intermission')this.show('trader');return}
    if(action==='ready'){this.show(null);this.actions.ready();return}
    if(action==='quit')this.show('quit')
  }
  live(key,value,flash=false){const node=this.root.querySelector(`[data-live="${key}"]`);if(node && node.textContent!==String(value)){node.textContent=String(value);if(flash)animate(node)}}
  toast(message){this.toastNode.textContent=message;this.toastNode.hidden=false;this.toastUntil=performance.now()+3500}
  dispose(){this.party.dispose();this.hud.root.removeEventListener('click',this.onClick);this.root.removeEventListener('input',this.onInput);window.removeEventListener('mousemove',this.onMouse);window.removeEventListener('keydown',this.onKey,true);this.root.remove();this.toastNode.remove()}
}
