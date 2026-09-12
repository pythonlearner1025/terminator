import {icon} from './icons.js'
import {animate,escapeHtml as esc} from './hud.js'
import {loadSettings,saveSettings} from './settings.js'
import {iconButton,itemName,playerLabels,shortStatus} from './labels.js'
import * as sfx from './sfx.js'
import {PartyScreens} from './party-screens.js'
import {ACTIONS,DEFAULT_BINDINGS,keyLabel,rebind,validCode} from './bindings.js'
import {DIFFICULTIES} from '../core/data/difficulty.js'
import {RESISTANCE_EMBLEM} from './emblem.js'

const btn=(action,label,kind='')=>`<button class="tm-btn ${kind}" data-action="${action}" data-testid="${action==='play'?'menu-play':action}">${label}</button>`
const header=(title='',action='back')=>`<header class="tm-screen-header"><h1>${title}</h1>${iconButton(action,'Back','back')}</header>`
export class Screens {
  constructor(hud,actions){
    this.hud=hud;this.actions=actions;this.route=null;this.settings=loadSettings();this.category='weapons'
    this.root=document.createElement('section');this.root.className='tm-screen';this.root.hidden=true;this.root.dataset.testid='game-screen';hud.root.append(this.root)
    this.party=new PartyScreens(this)
    this.toastNode=document.createElement('div');this.toastNode.className='tm-toast';this.toastNode.hidden=true;this.toastNode.setAttribute('role','status');hud.root.append(this.toastNode)
    this.onClick=e=>{const button=e.target.closest('[data-action]');if(button && hud.root.contains(button))this.action(button.dataset.action,button)}
    this.onInput=e=>{const key=e.target.dataset.setting;if(!key)return;this.settings[key]=['quality','difficulty'].includes(key)?e.target.value:Number(e.target.value);const output=this.root.querySelector(`[data-output="${key}"]`);if(output)output.textContent=this.formatSetting(key,this.settings[key]);this.persistSettings()}
    this.onMouse=e=>{
      if(this.captureBinding){e.preventDefault();e.stopImmediatePropagation();this.assignBinding(`Mouse${e.button}`);return}
      this.handleShortcut(`Mouse${e.button}`,e)
    }
    this.onKey=e=>{
      if(this.route==='controls'){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)this.dismissControls();return}
      if(this.captureBinding){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)this.assignBinding(e.code);return}
      if(e.code==='Tab' && this.route){const nodes=[...this.root.querySelectorAll('button:not(:disabled),input,select')].filter(n=>n.offsetParent!==null);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey && (document.activeElement===first || !this.root.contains(document.activeElement))){e.preventDefault();last?.focus()}else if(!e.shiftKey && (document.activeElement===last || !this.root.contains(document.activeElement))){e.preventDefault();first?.focus()}return}
      if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return
      this.handleShortcut(e.code,e)
    }
    hud.root.addEventListener('click',this.onClick);this.root.addEventListener('input',this.onInput);window.addEventListener('mousedown',this.onMouse,true);window.addEventListener('keydown',this.onKey,true)
    this.actions.settings(this.settings)
  }
  show(route){
    if(route===this.route)return
    if(!route && this.route && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      this.leaving?.remove()
      const leaving=this.leaving=this.root.cloneNode(true)
      leaving.inert=true;leaving.setAttribute('aria-hidden','true')
      leaving.removeAttribute('data-testid');leaving.style.pointerEvents='none';leaving.style.zIndex='15'
      this.hud.root.append(leaving)
      leaving.animate([{opacity:1},{opacity:0}],{duration:160,easing:'ease-out'}).finished.catch(()=>{}).finally(()=>leaving.remove())
    }
    this.toastNode.hidden=true
    this.previousRoute=this.route;this.route=route;this.root.hidden=!route;this.root.dataset.screen=route || 'playing';this.hud.elements.combat.hidden=Boolean(route && route!=='pause')
    this.root.className=`tm-screen${route==='main'?' tm-menu':route==='pause'?' tm-paused':route==='trader'?' tm-trader-screen':''}`
    this.captureBinding=null
    this.actions.route?.(route)
    this.root.setAttribute('aria-label',route?`${route} screen`:'Game')
    this.root.setAttribute('role','dialog')
    if(!route){this.root.replaceChildren();this.actions.input(true);return}
    this.actions.input(false)
    if(route==='main')this.main()
    else if(route==='lobby')this.lobby()
    else if(route==='pause')this.pause()
    else if(route==='settings')this.settingsScreen()
    else if(route==='bindings')this.bindingsScreen()
    else if(route==='controls')this.controlsCard()
    else if(route==='loading')this.loadingScreen()
    else if(route==='trader')this.trader()
    else if(route==='postmatch')this.postmatch()
    else if(route==='quit')this.quit()
    else if(route==='party-host' || route==='party-join')this.party.show(route)
    this.root.querySelector('button')?.focus({preventScroll:true})
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)this.root.animate?.([{opacity:0},{opacity:1}],{duration:200,easing:'ease-out'})
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
  main(){this.root.innerHTML=`<div class="tm-brand"><h1>TERMINATOR</h1><div class="tm-brand-subtitle">HUMAN VS SKYNET</div><nav class="tm-menu-nav" aria-label="Main menu">${btn('play','PLAY','primary')}${btn('host-party','HOST PARTY')}${btn('join-party','JOIN PARTY')}${btn('connect-agent','CONNECT AGENT')}${btn('settings','SETTINGS')}${btn('quit','QUIT')}</nav></div>`}
  difficultyControl(){return `<label class="tm-difficulty"><span class="tm-eyebrow">DIFFICULTY</span><select aria-label="Difficulty" data-setting="difficulty" data-testid="difficulty">${Object.values(DIFFICULTIES).map(d=>`<option value="${d.id}" ${d.id===this.settings.difficulty?'selected':''}>${d.label.toUpperCase()}</option>`).join('')}</select></label>`}
  lobby(){this.root.innerHTML=`${header('SKYNET LOBBY','main-menu')}<div class="tm-lobby-grid"><div><div class="tm-eyebrow">LOBBY CODE</div><h2 class="tm-code" data-live="code"></h2><p class="tm-status" role="status"><span data-live="agentIcon"></span> <span data-live="agent"></span></p><div class="tm-eyebrow">CONNECT YOUR AGENT WITH</div><div class="tm-install"><code class="tm-mono" data-live="install"></code><button class="tm-btn ghost" data-action="copy-mcp" data-testid="copy-mcp">COPY</button></div>${this.difficultyControl()}</div></div><div class="tm-screen-footer">${btn('start-match','START','primary')}</div>`;this.refreshLobby()}
  refreshLobby(){
    const state=this.lobbyState || {}
    this.live('code',state.code || '------')
    const iconNode=this.root.querySelector('[data-live="agentIcon"]')
    iconNode.innerHTML=icon(state.error?'pause':state.agentName?'check':state.code?'skull':'pause')
    this.live('agent',state.agentName || (state.error || state.code?'BUILT-IN':'CONNECTING'))
    if(state.agentName && state.agentName!==this.lastLobbyAgent){this.lastLobbyAgent=state.agentName;animate(this.root.querySelector('[data-live="agent"]'),'tm-power');sfx.skynetPowerOn()}
    this.live('install',state.code?state.installLine:'')
    const copy=this.root.querySelector('[data-action="copy-mcp"]');if(copy)copy.disabled=!state.code
  }
  pause(){this.root.innerHTML=`<div class="tm-pause-card" aria-label="Paused"><h1>PAUSED</h1>${btn('resume','RESUME','primary')}<div class="tm-pause-utilities">${btn('settings','SETTINGS')}${btn('main-menu','MAIN MENU','danger')}</div></div>`}
  settingsScreen(){this.root.innerHTML=`${header('SETTINGS')}<div class="tm-settings-grid"><div>${[['sensitivity','Sensitivity',.25,3,.05],['fov','FOV',60,110,1],['hud','HUD size',50,100,2],['master','Master',0,100,1],['music','Music',0,100,1],['effects','Effects',0,100,1]].map(([key,label,min,max,step])=>`<label class="tm-setting"><span>${label}</span><input aria-label="${label}" data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${this.settings[key]}"><output data-output="${key}">${this.formatSetting(key,this.settings[key])}</output></label>`).join('')}<label class="tm-setting"><span>Quality</span><select data-setting="quality" aria-label="Quality">${['low','medium','high'].map(q=>`<option value="${q}" ${q===this.settings.quality?'selected':''}>${q.toUpperCase()}</option>`).join('')}</select></label></div></div><div class="tm-screen-footer">${btn('bindings','KEY BINDINGS')}</div>`}
  bindingsScreen(){this.root.innerHTML=`${header('KEY BINDINGS')}<div class="tm-bindings-grid">${ACTIONS.map(([id,label])=>`<label class="tm-binding"><span>${label}</span><button class="tm-btn ghost" data-action="bind:${id}" aria-label="Rebind ${label}" data-testid="bind-${id}">${esc(keyLabel(this.settings.bindings[id]))}</button></label>`).join('')}</div><div class="tm-screen-footer"><span class="tm-bind-status" role="status" data-live="bindingStatus"></span>${btn('reset-bindings','RESET')}</div>`}
  assignBinding(code){
    if(!validCode(code)){this.live('bindingStatus','UNAVAILABLE');return}
    this.settings.bindings=rebind(this.settings.bindings,this.captureBinding,code)
    this.captureBinding=null;this.persistSettings();this.bindingsScreen()
  }
  persistSettings(){this.actions.settings(this.settings);if(!saveSettings(this.settings))this.toast('Storage unavailable')}
  handleShortcut(code,e){
    if(this.route==='loading')return
    let action
    const bindings=this.settings.bindings
    if(code===bindings.pause || code==='Escape')action=this.route?'back':'pause'
    else if(this.view?.wave.phase==='intermission' && (!this.route || this.route==='trader')){
      if(code===bindings.ready)action='ready'
      if(code===bindings.trader)action=this.route==='trader'?'back':'trader'
    }else if(!this.route && this.extra?.spectate){
      if(code===bindings.previous)action='spectate-previous'
      if(code===bindings.next)action='spectate-next'
    }
    if(action){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)this.action(action)}
  }
  loadingScreen(){this.root.innerHTML=`<div class="tm-loading-card">${RESISTANCE_EMBLEM}<div class="tm-eyebrow">LOADING</div><progress data-testid="asset-progress" aria-label="Asset loading" max="1" value="0"></progress><output data-live="progress">0%</output><div role="status" data-live="loadError"></div>${btn('retry-load','RETRY','ghost')}</div>`;this.root.querySelector('[data-action="retry-load"]').hidden=true}
  loadingProgress(loaded,total){const bar=this.root.querySelector('progress');if(bar){bar.max=total;bar.value=loaded;this.live('progress',`${Math.round(loaded/total*100)}%`)}}
  loadingError(){this.live('loadError','ASSETS UNAVAILABLE');const retry=this.root.querySelector('[data-action="retry-load"]');if(retry)retry.hidden=false}
  controlsCard(){this.root.innerHTML=`<div class="tm-controls-card">${RESISTANCE_EMBLEM}<h1>CONTROLS</h1><div class="tm-controls-grid">${[['forward','Move'],['jump','Jump'],['fire','Fire'],['aim','Aim'],['reload','Reload'],['sprint','Sprint'],['crouch','Crouch'],['grenade','Grenade'],['melee','Knife'],['pause','Pause']].map(([id,label])=>`<div><kbd>${id==='forward'?['forward','left','backward','right'].map(key=>esc(keyLabel(this.settings.bindings[key]))).join(' '):esc(keyLabel(this.settings.bindings[id]))}</kbd><span>${label}</span></div>`).join('')}</div>${btn('dismiss-controls','CONTINUE')}<small class="tm-eyebrow">ANY KEY</small></div>`}
  async enterMatch(start,returnRoute=null){
    this.pendingStart=start;this.startReturn=returnRoute
    if(!this.settings.controlsSeen){this.show('controls');return}
    await this.finishStart()
  }
  dismissControls(){this.settings.controlsSeen=true;this.persistSettings();void this.finishStart()}
  async finishStart(){
    const start=this.pendingStart,returnRoute=this.startReturn;this.pendingStart=null;this.startReturn=null
    if(!start)return
    try{await start();if(!this.root.isConnected)return;this.show(returnRoute);this.hud.lastPhase=''}
    catch{if(this.root.isConnected){this.show('main');this.toast('Start unavailable')}}
  }
  formatSetting(key,value){return key==='sensitivity'?`${Number(value).toFixed(2)}x`:key==='fov'?`${value}°`:`${value}%`}
  trader(){this.root.innerHTML=`${header('TRADER')}<div class="tm-trader-grid"><nav class="tm-categories" aria-label="Trader categories">${[['weapons','m4'],['ammo','ammo'],['armor','armor'],['items','crate']].map(([category,i])=>`<button data-action="category:${category}" class="${this.category===category?'selected':''}">${icon(i)}${category.toUpperCase()}</button>`).join('')}</nav><div class="tm-items" data-live="items"></div><aside class="tm-loadout"><div class="tm-eyebrow">SCRAP</div><div class="tm-balance" aria-label="Scrap">${icon('scrap')}<span data-live="balance"></span></div><button class="tm-btn" data-action="purchase:fill-ammo" aria-label="Fill all ammo">${icon('ammo')}FILL AMMO <span data-live="fillPrice"></span></button><button class="tm-btn" data-action="purchase:full-armor" aria-label="Buy full armor">${icon('armor')}FULL ARMOR <span data-live="armorPrice"></span></button><div class="tm-eyebrow">CLOSES IN</div><b class="tm-time" data-live="time" aria-label="Time remaining"></b></aside></div>`;this.traderKey='';this.refreshTrader()}
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
    this.root.querySelector('[data-live="items"]').innerHTML=items.map(item=>`<article class="tm-item">${icon(item.id)}<h3>${esc(itemName(item))}</h3><button class="tm-btn" data-action="purchase:${item.action}" aria-label="${esc(`${item.owned?'Owned':'Buy'} ${itemName(item)}`)}" ${item.owned || item.price==null?'disabled':''}>${item.owned?'OWNED':`BUY ${item.price ?? '…'}`}</button></article>`).join('')
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
    if(action?.startsWith('bind:')){this.captureBinding=action.slice(5);this.live('bindingStatus','KEY / MOUSE');button.textContent='…';return}
    if(action==='bindings'){this.show('bindings');return}
    if(action==='reset-bindings'){this.settings.bindings={...DEFAULT_BINDINGS};this.persistSettings();this.bindingsScreen();return}
    if(action==='dismiss-controls'){this.dismissControls();return}
    if(action==='retry-load'){this.actions.retry?.();return}
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
    if(action==='back'){if(['party-host','party-join'].includes(this.route)){this.actions.partyLeave();this.party.state=null;this.show('main')}else if(this.route==='bindings')this.show('settings');else if(this.route==='settings')this.show(this.settingsReturn || 'main');else if(['pause','trader'].includes(this.route))this.show(null);else this.show('main');return}
    if(action==='pause'){if(!this.route)this.show('pause');return}
    if(action==='resume'){this.show(null);return}
    if(action==='play' || action==='connect-agent'){this.actions.lobby();this.show('lobby');return}
    if(action==='start-match'){await this.enterMatch(()=>this.actions.start());return}
    if(action==='main-menu'){this.actions.menu();return}
    if(action==='play-again'){this.actions.restart();return}
    if(action==='trader'){if(this.view.wave.phase==='intermission')this.show('trader');return}
    if(action==='ready'){this.show(null);this.actions.ready();return}
    if(action==='quit')this.show('quit')
  }
  live(key,value,flash=false){const node=this.root.querySelector(`[data-live="${key}"]`);if(node && node.textContent!==String(value)){node.textContent=String(value);if(flash)animate(node)}}
  toast(message){this.toastNode.textContent=message;this.toastNode.hidden=false;this.toastUntil=performance.now()+3500}
  dispose(){this.leaving?.remove();this.party.dispose();this.hud.root.removeEventListener('click',this.onClick);this.root.removeEventListener('input',this.onInput);window.removeEventListener('mousedown',this.onMouse,true);window.removeEventListener('keydown',this.onKey,true);this.root.remove();this.toastNode.remove()}
}
