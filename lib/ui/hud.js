import {Vector3} from 'threepipe'
import {waveBannerTitle} from './boss.js'
import {icon} from './icons.js'
import {STYLE,TERSE_STYLE,HUD_SCALE_STYLE} from './styles.js'
import * as sfx from './sfx.js'
import {getDifficulty} from '../core/data/difficulty.js'
import {PRESENTATION_STYLE} from './presentation-styles.js'

const MARKUP = `
<div class="tm-combat" data-role="combat">
<div class="tm-vignette" data-role="vignette"></div>
<div class="tm-panel tm-scrap" data-testid="scrap">${icon('scrap')}<div><b data-role="scrap">0</b></div></div>
<div class="tm-feed" data-role="feed" data-testid="kill-feed"></div>
<section class="tm-teammates" data-role="teammates" data-testid="teammates" aria-label="Teammates" hidden><div data-role="teammateRows"></div></section>
<div class="tm-panel tm-wave" data-role="wavePanel" data-testid="wave-block"><div class="tm-wave-main" data-role="wave"></div><div class="tm-unit-bar" data-role="units"></div><div class="tm-wave-sub" data-role="waveSub"></div></div>
<div class="tm-panel tm-skynet" data-role="skynetPanel" data-testid="skynet-panel"><div class="tm-skynet-title"><span class="tm-dot" data-role="dot"></span>SKYNET · <span data-role="skynet"></span> · BUDGET <span data-role="budget"></span></div><div class="tm-skynet-row tm-revs" data-role="revs"></div><div class="tm-transmission"><span class="tm-transmission-text" data-role="transmission"></span></div></div>
<div class="tm-panel tm-vitals" data-testid="vitals"><div class="tm-vital-row" aria-label="Health">${icon('health')}<div><div class="tm-meter"><i class="tm-fill tm-health" data-role="healthBar"></i></div></div><b class="tm-vital-value" data-role="health"></b></div><div class="tm-vital-row armor" aria-label="Armor">${icon('armor')}<div><div class="tm-meter"><i class="tm-fill tm-armor" data-role="armorBar"></i></div></div><b class="tm-vital-value" data-role="armor"></b></div><div class="tm-stamina"><i data-role="stamina"></i></div></div>
<div class="tm-panel tm-weapon" data-testid="weapon-block"><div class="tm-weapon-top"><span class="tm-weapon-icon" data-role="weaponIcon"></span></div><div class="tm-ammo" data-role="ammo"><b data-role="mag"></b><small>/<span data-role="reserve"></span></small></div><div class="tm-grenade">${icon('grenade')}<span data-role="grenades"></span></div></div>
<div data-role="centerFeedback" style="position:absolute;left:50%;top:50%;width:0;height:0"><div class="tm-hit" data-role="hit"></div><svg class="tm-reload" data-role="reload" data-testid="reload-ring" viewBox="0 0 70 70" hidden><circle class="track" cx="35" cy="35" r="30"/><circle data-role="reloadProgress" cx="35" cy="35" r="30"/></svg></div>
<div class="tm-damage" data-role="damage" data-testid="damage-directions"></div><div class="tm-nameplates" data-role="nameplates" data-testid="nameplates"></div>
<div class="tm-trader-marker" data-role="trader" data-testid="trader-marker" hidden>${icon('crate')}<small data-role="traderDistance"></small></div>
<div class="tm-ready" data-role="ready" data-testid="intermission" hidden><button data-action="trader" aria-label="Trader">${icon('crate')} TRADER (E)</button><button data-action="ready" aria-label="Ready">${icon('check')} START WAVE (R)</button></div>
<div class="tm-banner" data-role="banner" hidden><b data-role="bannerTitle"></b><small data-role="bannerSub"></small></div>
<div class="tm-controls"><button data-action="pause" aria-label="Pause">${icon('pause')} PAUSE</button></div>
</div><div class="tm-scanlines"></div>`

export function animate(element, className = 'tm-change') {
  element.classList.remove(className)
  void element.offsetWidth
  element.classList.add(className)
}
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}
export class Hud {
  constructor(viewer) {
    this.viewer = viewer
    this.style = document.createElement('style')
    this.style.dataset.terminatorStyle = 'true'
    this.style.textContent = STYLE+TERSE_STYLE+PRESENTATION_STYLE+HUD_SCALE_STYLE
    document.head.appendChild(this.style)
    this.root = document.createElement('div')
    this.root.className = 'tm-hud'
    this.root.dataset.testid = 'terminator-hud'
    this.root.innerHTML = MARKUP
    viewer.container.appendChild(this.root)
    this.elements = Object.fromEntries([...this.root.querySelectorAll('[data-role]')].map(el => [el.dataset.role, el]))
    this.point = new Vector3()
    this.plates = new Map()
    this.feed = new Map()
    this.arcs = new Map()
    this.teammates = new Map()
    const spectate=document.createElement('section')
    spectate.className='tm-spectate';spectate.dataset.testid='spectating';spectate.hidden=true
    spectate.innerHTML=`<strong data-spectate="name"></strong><div class="tm-spectate-controls"><button data-action="spectate-previous" aria-label="Previous player">${icon('back')} PREVIOUS</button><small data-spectate="count"></small><button data-action="spectate-next" aria-label="Next player">${icon('next')} NEXT</button></div>`
    this.elements.combat.append(spectate);this.elements.spectate=spectate
    this.lastHitId = ''
    this.lastPhase = ''
    this.lastWave = 0
    this.transmission = ''
    this.wavePeakPlaceholder = 0
    this.sync()
  }
  sync() {
    if (!this.root) return
    const rect = this.viewer.canvas.getBoundingClientRect()
    if (this.box && ['left','top','width','height'].every(key => this.box[key] === rect[key])) return
    this.box = {left:rect.left,top:rect.top,width:rect.width,height:rect.height}
    Object.assign(this.root.style, {left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`})
  }
  text(key, value, flash = false) {
    const el = this.elements[key]
    const text = String(value)
    if (el.textContent === text) return
    el.textContent = text
    if (flash) animate(el)
  }
  render(view, extra = {}) {
    if (!this.root) return
    this.view = view
    const el = this.elements
    this.presentationTimeMs = extra.presentationTimeMs
    const now = this.presentationTimeMs ?? performance.now()
    this.renderTeammates(view.teammates || [])
    this.renderSpectate(extra.spectate)
    this.root.classList.toggle('is-coop',(view.scaling?.players || 1)>1)
    this.text('scrap', view.scrap, true)
    this.text('health', Math.ceil(view.health.value), true)
    this.text('armor', Math.ceil(view.armor.value), true)
    el.healthBar.style.width = `${view.health.ratio*100}%`
    el.armorBar.style.width = `${view.armor.ratio*100}%`
    el.stamina.style.width = `${extra.staminaRatio === undefined ? 100 : extra.staminaRatio*100}%`
    el.vignette.classList.toggle('show',view.health.low)
    el.vignette.classList.toggle('critical',view.health.critical)
    if (this.weaponId !== view.weapon.id) {el.weaponIcon.innerHTML = icon(view.weapon.id);this.weaponId = view.weapon.id;animate(el.weaponIcon)}
    el.ammo.className = `tm-ammo${view.ammo.empty?' empty':view.ammo.low?' low':''}`
    this.text('mag', String(view.ammo.mag).padStart(2,'0'), true)
    this.text('reserve', view.ammo.reserve)
    this.text('grenades', view.grenades, true)
    const intermission = view.wave.phase === 'intermission'
    this.text('wave', `WAVE ${view.wave.current}/${view.wave.total}`)
    const difficulty=getDifficulty(extra.difficulty || view.scaling?.difficulty).label.toUpperCase()
    this.text('waveSub', `${difficulty} · ${intermission ? `${Math.ceil(view.wave.timer)}s` : `${extra.remaining ?? view.wave.remaining} LEFT`}`)
    el.wavePanel.classList.toggle('trader',intermission)
    el.ready.hidden = !intermission
    if (view.wave.current !== this.lastWave) this.wavePeakPlaceholder = 0
    this.wavePeakPlaceholder = Math.max(this.wavePeakPlaceholder,view.wave.remaining)
    const total = extra.waveTotal ?? this.wavePeakPlaceholder
    const remaining = extra.remaining ?? view.wave.remaining
    const iconKey = `${total}:${remaining}:${intermission}`
    if (iconKey !== this.iconKey) {
      this.iconKey = iconKey
      const count = Math.min(24,total)
      el.units.innerHTML = intermission ? '' : Array.from({length:count},(_,i) => icon('skull',i < Math.ceil(remaining/Math.max(1,total)*count)?'':'cleared')).join('')
    }
    this.text('skynet', view.skynet.status)
    el.dot.classList.toggle('connected',view.skynet.connected)
    this.text('budget',extra.nextBudget ?? view.wave.budget)
    this.text('revs',`E${view.skynet.revs.endo} S${view.skynet.revs.scout} H${view.skynet.revs.heavy} T${view.skynet.revs.t1000??0} A${view.skynet.revs.hkaerial??0} K${view.skynet.revs.hktank??0}`)
    if (view.skynet.connected && !this.connected) {animate(el.skynetPanel,'tm-power');sfx.skynetPowerOn()}
    this.connected = view.skynet.connected
    const source = String(view.transmission || '').replace(/\s+/g,' ').trim()
    const transmission = source.length>22?`${source.slice(0,21).replace(/\s+\S*$/,'').replace(/[.,;:!?]+$/,'')}…`:source
    if (transmission !== this.transmission) {this.transmission=transmission;this.transmissionAt=now;sfx.transmissionStatic()}
    const chars = Math.floor((now-(this.transmissionAt || 0))/24)
    this.text('transmission',transmission.slice(0,chars))
    el.transmission.classList.toggle('tm-caret',Boolean(transmission && chars<transmission.length))
    if (view.wave.phase !== this.lastPhase || view.wave.current !== this.lastWave) {
      if (view.wave.phase === 'wave' && extra.matchStarted) {
        animate(el.wavePanel,'slam');this.banner(waveBannerTitle(view.wave), '');sfx.waveKlaxon(view.wave.current)
        this.waveStartScrap = view.scrap
      } else if (intermission) {
        this.banner('✓',`+${extra.waveScrap ?? Math.max(0,view.scrap-(this.waveStartScrap || 0))}`);sfx.waveClearStinger()
      }
      this.lastPhase=view.wave.phase;this.lastWave=view.wave.current
    }
    if (this.bannerUntil && now>this.bannerUntil) el.banner.hidden=true
    this.renderFeed(view.killFeed)
    this.renderNameplates(view.nameplates)
    this.renderDamage(view.damageDirections)
    this.renderCenterFeedback(view)
    this.renderTrader(extra.trader,intermission)
  }
  renderTeammates(items) {
    this.elements.teammates.hidden=!items.length
    const active=new Set(items.map(item=>item.id))
    for(const [id,row] of this.teammates)if(!active.has(id)){row.remove();this.teammates.delete(id)}
    for(const item of items){
      let row=this.teammates.get(item.id)
      if(!row){row=document.createElement('article');row.innerHTML='<div class="tm-teammate-title"><strong></strong><small></small></div><div class="tm-meter" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="100"><i class="tm-fill"></i></div><div class="tm-teammate-meta"><span></span><span></span></div>';this.teammates.set(item.id,row);this.elements.teammateRows.append(row)}
      const down=item.downed || item.alive===false
      const health=Number(item.health?.value ?? item.hp ?? item.health) || 0
      const armor=Number(item.armor?.value ?? item.armor) || 0
      row.className=`tm-teammate${down?' downed':''}`;row.dataset.playerId=item.id
      row.querySelector('strong').textContent=item.name
      row.querySelector('small').textContent=''
      const meter=row.querySelector('.tm-meter');meter.setAttribute('aria-valuenow',Math.max(0,Math.min(100,health)));meter.setAttribute('aria-label',`${item.name} health`)
      row.querySelector('i').style.width=`${Math.max(0,Math.min(100,health))}%`
      const healthText=down?'0':String(Math.ceil(health))
      if(row._healthText!==healthText){
        row.lastElementChild.firstElementChild.innerHTML=icon('health')+healthText
        row._healthText=healthText
      }
      const armorNode=row.lastElementChild.lastElementChild
      const armorWidth=Math.max(0,Math.min(100,armor))
      if(row._armorWidth!==armorWidth){
        armorNode.innerHTML=icon('armor')+`<span class="tm-armor-meter"><i style="width:${armorWidth}%"></i></span>`
        row._armorWidth=armorWidth
      }
      armorNode.setAttribute('aria-label',`${item.name} armor ${Math.ceil(armor)}`)
    }
  }
  renderSpectate(target) {
    this.spectatingId=target?.id
    this.elements.spectate.hidden=!target
    this.root.classList.toggle('is-spectating',Boolean(target))
    if(!target)return
    this.elements.spectate.querySelector('[data-spectate="name"]').textContent=target.name
    this.elements.spectate.querySelector('[data-spectate="count"]').textContent=`${target.index}/${target.count}`
    for(const button of this.elements.spectate.querySelectorAll('button'))button.disabled=target.count<2
  }
  banner(title, subtitle) {
    this.text('bannerTitle',title);this.text('bannerSub',subtitle)
    this.elements.banner.hidden=false
    animate(this.elements.banner,'enter')
    this.bannerUntil=(this.presentationTimeMs ?? performance.now())+3000
  }
  renderFeed(items) {
    items=items.slice(0,3)
    const active = new Set(items.map(x=>x.id))
    for (const [id,row] of this.feed) if (!active.has(id)) {row.remove();this.feed.delete(id)}
    for (const item of [...items].reverse()) {
      let row=this.feed.get(item.id)
      if (!row) {row=document.createElement('div');row.className='tm-feed-row';row.setAttribute('aria-label',item.text);const weapon=/M79|LAUNCHER/i.test(item.text)?'launcher':/M14|MARKSMAN|SNIPER/i.test(item.text)?'sniper':/PLASMA/i.test(item.text)?'plasma':/SHOTGUN/i.test(item.text)?'shotgun':/M4/i.test(item.text)?'m4':'pistol';const type=/T-1000/i.test(item.text)?'t1000':/HK-AERIAL/i.test(item.text)?'hkaerial':/HK-TANK/i.test(item.text)?'hktank':/SCOUT/i.test(item.text)?'scout':/HEAVY/i.test(item.text)?'heavy':'endo';row.innerHTML=icon(weapon)+(item.text.includes('HEADSHOT')?icon('aim'):icon('skull'))+icon(type);this.feed.set(item.id,row);this.elements.feed.prepend(row)}
      row.style.opacity=String(Math.max(0,1-item.age/5))
    }
  }
  project(pos, height=0) {
    this.point.set(pos.x,pos.y+height,pos.z).project(this.viewer.scene.mainCamera)
    return {x:(this.point.x+1)*50,y:(1-this.point.y)*50,visible:this.point.z>-1 && this.point.z<1 && Math.abs(this.point.x)<.96 && Math.abs(this.point.y)<.93,z:this.point.z}
  }
  renderNameplates(items = []) {
    // Enemy overlays have no DOM or projection work; only friendly identifiers remain.
    items=items.filter(item=>item.kind==='teammate' || item.teammate===true || item.type==='teammate')
    const active=new Set(items.map(x=>x.id))
    for(const [id,plate] of this.plates) if(!active.has(id)){plate.remove();this.plates.delete(id)}
    for(const item of items){
      let plate=this.plates.get(item.id)
      if(!plate){plate=document.createElement('div');plate.className='tm-nameplate';plate.innerHTML='<strong></strong><small></small><div class="tm-meter"><i class="tm-fill"></i></div>';this.plates.set(item.id,plate);this.elements.nameplates.append(plate)}
      const down=item.downed || item.alive===false
      plate.className=`tm-nameplate teammate${down?' downed':''}`
      const point=this.project(item.pos,down?.65:2.05)
      plate.hidden=!point.visible || (this.elements.spectate.hidden===false && item.id===this.spectatingId)
      plate.style.left=`${point.x}%`;plate.style.top=`${point.y}%`
      plate.children[0].textContent=item.label || item.name
      plate.children[1].textContent=down?'✚':''
      plate.querySelector('i').style.width=`${Math.max(0,Math.min(1,item.ratio ?? item.hp/(item.maxHp || 100)))*100}%`
    }
  }
  renderDamage(items) {
    const active=new Set(items.map(x=>x.id))
    for(const [id,arc] of this.arcs) if(!active.has(id)){arc.remove();this.arcs.delete(id)}
    for(const item of items){let arc=this.arcs.get(item.id);if(!arc){arc=document.createElement('b');this.arcs.set(item.id,arc);this.elements.damage.append(arc)}arc.style.transform=`rotate(${item.angle}rad)`;arc.style.opacity=String(Math.max(0,(1-item.age)*item.strength))}
  }
  renderCenterFeedback(view) {
    // Editor scrollbar gutters can shrink the HUD's percentage containing block.
    this.elements.centerFeedback.style.left=`${this.box.width/2}px`
    this.elements.centerFeedback.style.top=`${this.box.height/2}px`
    this.elements.reload.toggleAttribute('hidden',!view.weapon.reloading)
    this.elements.reloadProgress.style.strokeDashoffset=String(188.5*(1-view.weapon.reloadProgress))
    const latest=view.hitMarkers.at(-1)
    if(latest && latest.id!==this.lastHitId){
      this.lastHitId=latest.id
      this.showHit(latest.kind)
    }
  }
  showHit(kind) {
    const hit=this.elements.hit
    hit.className=`tm-hit ${kind}`
    hit.innerHTML=kind==='kill'?icon('skull'):'<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="3"><path d="m3 3 7 7m10 10 7 7M3 27l7-7M20 10l7-7"/></svg>'
    animate(hit,'show');sfx.hitTarget(kind)
  }
  renderTrader(trader,visible) {
    const el=this.elements.trader
    el.hidden=!visible || !trader
    if(el.hidden)return
    const p=this.project(trader.pos,1.7)
    // A crate behind the camera remains an edge waypoint, with its bearing supplied by the adapter.
    const x=p.z>=1?50-Math.sin(trader.bearing)*40:p.x
    el.style.left=`${Math.max(10,Math.min(90,x))}%`
    el.style.top=`${Math.max(29,Math.min(72,p.z>=1?68:p.y))}%`
    this.text('traderDistance',`${p.visible?'':'↗ '}${Math.round(trader.distance)}m`)
  }
  dispose() {
    sfx.stopSfx?.()
    this.root?.remove();this.style?.remove();this.root=null;this.style=null;this.elements={}
    this.plates.clear();this.feed.clear();this.arcs.clear();this.teammates.clear()
  }
}
