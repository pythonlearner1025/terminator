import {icon,SKULL} from './icons.js'
import {animate,escapeHtml as esc} from './hud.js'
import {loadSettings,saveSettings} from './settings.js'
import {DOSSIER_UNAVAILABLE_PLACEHOLDER} from './presentation.js'
import * as sfx from './sfx.js'

const btn=(action,label,kind='')=>`<button class="tm-btn ${kind}" data-action="${action}" data-testid="${action==='play'?'menu-play':action}">${label}</button>`
const header=(eyebrow,title,action='back',label='Back')=>`<header class="tm-screen-header"><div><div class="tm-eyebrow">${eyebrow}</div><h1>${title}</h1></div>${btn(action,label,'ghost')}</header>`
const clock=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`
export class Screens {
  constructor(hud,actions){
    this.hud=hud;this.actions=actions;this.route=null;this.settings=loadSettings();this.category='weapons';this.dossier=DOSSIER_UNAVAILABLE_PLACEHOLDER
    this.root=document.createElement('section');this.root.className='tm-screen';this.root.hidden=true;this.root.dataset.testid='game-screen';hud.root.append(this.root)
    this.toastNode=document.createElement('div');this.toastNode.className='tm-toast';this.toastNode.hidden=true;this.toastNode.setAttribute('role','status');hud.root.append(this.toastNode)
    this.onClick=e=>{const button=e.target.closest('[data-action]');if(button && hud.root.contains(button))this.action(button.dataset.action,button)}
    this.onInput=e=>{const key=e.target.dataset.setting;if(!key)return;this.settings[key]=key==='quality'?e.target.value:Number(e.target.value);const output=this.root.querySelector(`[data-output="${key}"]`);if(output)output.textContent=this.formatSetting(key,this.settings[key]);this.actions.settings(this.settings);if(!saveSettings(this.settings))this.toast('Settings apply now. Browser storage is unavailable.')}
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
    this.previousRoute=this.route;this.route=route;this.root.hidden=!route;this.root.dataset.screen=route || 'playing';this.hud.elements.combat.hidden=Boolean(route && !['pause','settings','trader'].includes(route))
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
    else if(route==='dossier')this.dossierScreen()
    else if(route==='quit')this.quit()
    this.root.querySelector('button')?.focus({preventScroll:true})
  }
  get frozen(){return Boolean(this.route && this.route!=='trader')}
  render(view,extra,lobby){
    this.view=view;this.extra=extra;this.lobbyState=lobby
    if(this.toastUntil && performance.now()>this.toastUntil)this.toastNode.hidden=true
    if(extra.matchStarted && view.wave.phase==='ended' && !this.ended){this.ended=true;this.show('postmatch');this.actions.dossier()}
    if(this.route==='trader' && view.wave.phase!=='intermission'){this.show(null);this.toast('Trader closed. Hold the line.')}
    if(this.route==='trader')this.refreshTrader()
    if(this.route==='lobby')this.refreshLobby()
    if(['postmatch','dossier'].includes(this.route))this.typeDossier()
  }
  main(){this.root.innerHTML=`<div class="tm-brand"><div class="tm-eyebrow">LOS ANGELES / 2029</div><h1>TERMINATOR</h1><div class="tm-brand-subtitle">HUMAN VS SKYNET</div><p class="tm-menu-description">The machines learned to hunt.<br>Give them something to fear.</p><nav class="tm-menu-nav" aria-label="Main menu">${btn('play','PLAY <small>01</small>','primary')}${btn('connect-agent','CONNECT AGENT <small>02</small>')}${btn('dossier','DOSSIER <small>03</small>')}${btn('settings','SETTINGS <small>04</small>')}${btn('quit','QUIT <small>05</small>')}</nav></div><div class="tm-menu-art">${SKULL}</div><div class="tm-art-caption tm-mono">CYBERDYNE SYSTEMS<br>MODEL 101 // T-800<br><span class="tm-red">NEURAL NET PROCESSOR: ACTIVE</span></div><footer class="tm-menu-bottom"><span>RESISTANCE COMMAND // BUNKER 7</span><span>BUILD 0.15.0 / HUMANITY IS NOT OBSOLETE</span></footer>`}
  lobby(){this.root.innerHTML=`${header('RESISTANCE COMMAND / UPLINK','ESTABLISH CONTACT','main-menu','Main menu')}<div class="tm-lobby-grid"><div><div class="tm-eyebrow">YOUR LOBBY CODE</div><h2 class="tm-code" data-live="code">------</h2><p class="tm-muted">Give this code to the agent that will command Skynet.</p><p class="tm-status" data-live="agent">Waiting for Skynet</p><p class="tm-mono tm-muted" data-live="connection">Opening uplink...</p><div class="tm-install"><code class="tm-mono" data-live="install"></code>${btn('copy-mcp','COPY')}</div><p class="tm-notice" data-live="lobbyNotice"></p></div><aside class="tm-surface"><div class="tm-eyebrow">OPERATION / LAST STAND</div><div class="tm-map-preview"><div class="tm-map-grid"></div></div><h2>${esc(this.extra?.mapName || 'Bunker 7')}</h2><p class="tm-settings-note" style="margin-top:18px">10 waves. One survivor.<br>Defend the resistance supply compound.<br>Resupply between waves.</p></aside></div><footer class="tm-screen-footer"><span class="tm-mono">EXTERNAL AGENT OPTIONAL<br><span data-live="fallback">Built-in Skynet will play</span></span>${btn('start-match','DEPLOY TO BUNKER 7','primary')}</footer>`;this.refreshLobby()}
  refreshLobby(){const state=this.lobbyState || {};this.live('code',state.code || '------');this.live('agent',state.agentName?`${state.agentName} connected`:'Waiting for Skynet');this.live('connection',state.status || 'Opening uplink...');this.live('install',state.installLine || 'Waiting for lobby code');this.live('fallback',state.agentName?'External Skynet agent will play':'Built-in Skynet will play');this.live('lobbyNotice',state.error || 'Start when ready. An external agent can join this lobby.');const copy=this.root.querySelector('[data-action="copy-mcp"]');if(copy)copy.disabled=!state.code}
  pause(){this.root.innerHTML=`<div class="tm-pause-card"><div class="tm-eyebrow">RESISTANCE SIGNAL HELD</div><h1>PAUSED</h1>${btn('resume','RESUME','primary')}${btn('settings','SETTINGS')}${btn('main-menu','QUIT TO MENU','danger')}</div>`}
  settingsScreen(){this.root.innerHTML=`${header('SYSTEM CONFIGURATION','SETTINGS')}<div class="tm-settings-grid"><div>${[['sensitivity','Mouse sensitivity',.25,3,.05],['fov','Field of view',60,110,1],['master','Master volume',0,100,1],['music','Music volume',0,100,1],['effects','Effects volume',0,100,1]].map(([key,label,min,max,step])=>`<label class="tm-setting"><span>${label}</span><input aria-label="${label}" data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${this.settings[key]}"><output data-output="${key}">${this.formatSetting(key,this.settings[key])}</output></label>`).join('')}<label class="tm-setting"><span>Quality preset</span><select data-setting="quality" aria-label="Quality preset">${['low','medium','high'].map(q=>`<option value="${q}" ${q===this.settings.quality?'selected':''}>${q.toUpperCase()}</option>`).join('')}</select></label></div><aside class="tm-surface tm-settings-note">${icon('skull')}<h3>YOUR SURVIVAL. YOUR SETUP.</h3><p>Changes apply immediately and are saved on this device.</p><p style="margin-top:22px">Lower quality reduces render resolution. Mouse sensitivity controls aim speed. Field of view changes how much of the battlefield you see.</p></aside></div><footer class="tm-screen-footer"><span class="tm-mono">SETTINGS SAVED AUTOMATICALLY</span>${btn('back','DONE','primary')}</footer>`}
  formatSetting(key,value){return key==='sensitivity'?`${Number(value).toFixed(2)}x`:key==='fov'?`${value}°`:`${value}%`}
  trader(){this.root.innerHTML=`${header('RESISTANCE SUPPLY / INTERMISSION','TRADER OPEN','back','Return to field')}<div class="tm-trader-grid"><nav class="tm-categories" aria-label="Trader categories">${[['weapons','m4'],['ammo','ammo'],['armor','armor'],['items','crate']].map(([category,i])=>`<button data-action="category:${category}" class="${this.category===category?'selected':''}">${icon(i)}${category.toUpperCase()}</button>`).join('')}</nav><div class="tm-items" data-live="items"></div><aside class="tm-loadout"><div class="tm-eyebrow">YOUR EQUIPMENT</div><h3>LOADOUT</h3><div class="tm-loadout-list" data-live="loadout"></div><div class="tm-balance"><small>AVAILABLE SCRAP</small><span data-live="balance"></span></div>${btn('purchase:fill-ammo','FILL ALL AMMO <span data-live="fillPrice"></span>')}${btn('purchase:full-armor','BUY FULL ARMOR <span data-live="armorPrice"></span>')}<p class="tm-notice" data-live="purchaseApi"></p></aside></div><footer class="tm-screen-footer"><div><div class="tm-purchase-feedback" data-live="purchaseFeedback" role="status"></div><span class="tm-mono">PRESS R TO END INTERMISSION EARLY</span></div><div><span class="tm-eyebrow">TRADER CLOSES IN </span><b class="tm-time" data-live="time"></b></div></footer>`;this.traderKey='';this.refreshTrader()}
  refreshTrader(){
    const extra=this.extra;if(!extra)return
    this.live('balance',this.view.scrap.toLocaleString(),true);this.live('time',`${Math.ceil(this.view.wave.timer)}s`)
    const quotes=this.actions.quotes()
    this.live('fillPrice',quotes.fillAmmo == null?'PENDING':quotes.fillAmmo);this.live('armorPrice',quotes.fullArmor == null?'PENDING':quotes.fullArmor)
    this.live('purchaseApi',quotes.error || '')
    const key=JSON.stringify([this.category,extra.loadout,extra.armor,extra.grenades,quotes])
    if(key===this.traderKey)return;this.traderKey=key
    this.root.querySelector('[data-live="loadout"]').innerHTML=extra.loadout.map(w=>`<div class="tm-loadout-row"><span>${esc(w.name)}</span><small>${w.mag} / ${w.reserve}</small></div>`).join('')+`<div class="tm-loadout-row"><span>Armor</span><small>${Math.ceil(extra.armor)}</small></div><div class="tm-loadout-row"><span>Frag grenades</span><small>${extra.grenades}</small></div>`
    let items=[]
    if(this.category==='weapons')items=Object.values(extra.catalog).filter(w=>w.slot).map(w=>({...w,action:w.id,owned:extra.loadout.some(o=>o.id===w.id),description:`SLOT ${w.slot} / ${w.damage}${w.pellets>1?` x ${w.pellets}`:''} DAMAGE`}))
    if(this.category==='ammo')items=extra.loadout.map(w=>({...w,id:'ammo',action:`ammo:${w.id}`,name:`${w.name} ammo`,price:w.ammoPrice,description:`${extra.catalog[w.id].mag} ROUNDS / MAGAZINE`,slot:null}))
    if(this.category==='armor')items=[{id:'armor',action:'full-armor',name:'Full body armor',price:quotes.fullArmor,description:'RESTORE ARMOR AT THE SUPPLY CRATE'}]
    if(this.category==='items')items=[{...extra.catalog.grenade,action:'grenade',description:'FRAGMENTATION / AREA DENIAL'},{id:'health',action:'medkit',name:'Field medkit',price:quotes.medkit,description:'RESISTANCE MEDICAL SUPPLIES'}]
    this.root.querySelector('[data-live="items"]').innerHTML=items.map(item=>`<article class="tm-item">${icon(item.id)}<div><h3>${esc(item.name)}</h3><small>${esc(item.description)}</small>${item.slot?`<div class="tm-stats-bars">${[['DAMAGE',item.damage*(item.pellets || 1),100],['RATE',item.rate,12],['MAG',item.mag,30]].map(([label,value,max])=>`<div class="tm-stat-bar"><span>${label} ${value}</span><div class="tm-meter"><i class="tm-fill" style="width:${Math.min(100,value/max*100)}%"></i></div></div>`).join('')}</div>`:''}</div><button class="tm-btn" data-action="purchase:${item.action}" ${item.owned?'disabled':''}>${item.owned?'OWNED':item.price==null?'PENDING':`${item.price} SCRAP`}</button></article>`).join('')
  }
  postmatch(){const s=this.extra.stats;this.root.innerHTML=`${header('RESISTANCE / AFTER ACTION REPORT',s.survived?'SURVIVED':'<span class="tm-red">TERMINATED</span>','main-menu','Main menu')}<div class="tm-post-grid"><div class="tm-match-stats">${[['WAVE REACHED',`${s.wave} / 10`],['ACCURACY',`${s.accuracy}%`],['DAMAGE TAKEN',s.damage],['SCRAP EARNED',s.scrap.toLocaleString()],['TIME IN COMBAT',clock(s.seconds)],['TOTAL KILLS',Object.values(s.kills).reduce((a,b)=>a+b,0)]].map(([label,value])=>`<div class="tm-match-stat"><small>${label}</small><b>${value}</b></div>`).join('')}<div class="tm-kills">${Object.entries(s.kills).map(([type,n])=>`<div><span class="tm-eyebrow">${type}</span><b>${String(n).padStart(2,'0')}</b></div>`).join('')}</div></div>${this.dossierMarkup()}</div><footer class="tm-screen-footer"><span class="tm-mono">THE MACHINES ARE LEARNING.<br>SO ARE YOU.</span>${btn('play-again','PLAY AGAIN','primary')}</footer>`;this.beginDossier()}
  dossierMarkup(){return `<section class="tm-dossier" data-testid="dossier-reveal"><div class="tm-dossier-heading"><span class="tm-eyebrow tm-red">SKYNET / HUMAN ANALYSIS</span>${icon('skull')}</div><div class="tm-dossier-markdown" data-live="markdown"></div><div class="tm-traits" data-live="traits"></div></section>`}
  dossierScreen(){this.root.innerHTML=`${header('INTERCEPTED INTELLIGENCE','THE DOSSIER')}<div class="tm-dossier-only">${this.dossierMarkup()}</div><footer class="tm-screen-footer"><span class="tm-mono">CLASSIFIED / RESISTANCE EYES ONLY</span>${btn('back','BACK','primary')}</footer>`;this.beginDossier()}
  setDossier(value){this.dossier=value && typeof value.markdown==='string'?value:DOSSIER_UNAVAILABLE_PLACEHOLDER;if(['postmatch','dossier'].includes(this.route))this.beginDossier()}
  beginDossier(){this.dossierStart=performance.now();this.dossierChars=-1;this.root.querySelector('[data-live="traits"]').replaceChildren();this.typeDossier()}
  typeDossier(){
    const text=String(this.dossier.markdown || 'No analysis supplied.')
    const chars=Math.min(text.length,Math.floor((performance.now()-this.dossierStart)/12))
    if(chars===this.dossierChars)return;this.dossierChars=chars
    const node=this.root.querySelector('[data-live="markdown"]');if(!node)return
    node.innerHTML=markdown(text.slice(0,chars));node.classList.toggle('tm-caret',chars<text.length)
    if(chars===text.length)this.root.querySelector('[data-live="traits"]').innerHTML=(this.dossier.traits || []).map(t=>{const confidence=Math.max(0,Math.min(1,Number(t.confidence) || 0));return `<div class="tm-trait"><div class="tm-trait-label"><span>${esc(t.key)}: ${esc(typeof t.value==='object'?JSON.stringify(t.value):t.value)}</span><b>${Math.round(confidence*100)}%</b></div><div class="tm-meter"><i class="tm-fill" style="width:${confidence*100}%"></i></div></div>`}).join('')
  }
  quit(){this.root.innerHTML=`<div class="tm-pause-card" style="margin:auto"><div class="tm-eyebrow">SIGNAL CLOSED</div><h1>STAND DOWN</h1><p class="tm-settings-note" style="margin:25px 0">You can close this tab.<br>The resistance will be here.</p>${btn('main-menu','RETURN TO MENU','primary')}</div>`}
  async action(action,button){
    if(action?.startsWith('category:')){this.category=action.split(':')[1];this.trader();return}
    if(action?.startsWith('purchase:')){
      const item=action.slice(9)
      const result=await this.actions.purchase(item)
      if(!this.root.isConnected)return
      const ok=result?.ok===true
      const message=ok?`PURCHASE COMPLETE / ${result.name || item}`:result?.error || 'Purchase unavailable'
      this.live('purchaseFeedback',message)
      if(ok){sfx.purchaseSuccess(item);animate(this.root.querySelector('[data-live="balance"]'))}else{sfx.purchaseDenied();if(button)animate(button,'tm-denied');this.toast(message)}
      this.traderKey='';return
    }
    if(action==='copy-mcp'){try{await navigator.clipboard.writeText(this.lobbyState.installLine);this.toast('MCP install command copied')}catch{this.toast('Clipboard unavailable. Select and copy the command above.')}return}
    if(action==='settings'){this.settingsReturn=this.route || 'pause';this.show('settings');return}
    if(action==='back'){if(this.route==='settings')this.show(this.settingsReturn || 'main');else if(['pause','trader'].includes(this.route))this.show(null);else this.show('main');return}
    if(action==='pause'){if(!this.route)this.show('pause');return}
    if(action==='resume'){this.show(null);return}
    if(action==='play' || action==='connect-agent'){this.actions.lobby();this.show('lobby');return}
    if(action==='start-match'){this.actions.start();this.show(null);this.hud.lastPhase='';return}
    if(action==='main-menu'){this.actions.menu();return}
    if(action==='play-again'){this.actions.restart();return}
    if(action==='dossier'){this.show('dossier');this.actions.dossier();return}
    if(action==='trader'){if(this.view.wave.phase==='intermission')this.show('trader');return}
    if(action==='ready'){this.show(null);this.actions.ready();return}
    if(action==='quit')this.show('quit')
  }
  live(key,value,flash=false){const node=this.root.querySelector(`[data-live="${key}"]`);if(node && node.textContent!==String(value)){node.textContent=String(value);if(flash)animate(node)}}
  toast(message){this.toastNode.textContent=message;this.toastNode.hidden=false;this.toastUntil=performance.now()+3500}
  dispose(){this.hud.root.removeEventListener('click',this.onClick);this.root.removeEventListener('input',this.onInput);window.removeEventListener('mousemove',this.onMouse);window.removeEventListener('keydown',this.onKey,true);this.root.remove();this.toastNode.remove()}
}
// Agent markdown is escaped before a deliberately small formatting subset is applied.
export function markdown(value){return esc(value).split('\n').map(line=>/^#{1,6} /.test(line)?`<h3>${line.replace(/^#{1,6} /,'')}</h3>`:`${line.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/^[-*] /,'• ')}\n`).join('')}
