import {Vector3} from 'threepipe'
import {icon} from './icons.js'
import {STYLE} from './styles.js'
import * as sfx from './sfx.js'

const MARKUP = `
<div class="tm-combat" data-role="combat">
<div class="tm-vignette" data-role="vignette"></div>
<div class="tm-panel tm-scrap" data-testid="scrap">${icon('scrap')}<div><small>SCRAP</small><b data-role="scrap">0</b></div></div>
<div class="tm-feed" data-role="feed" data-testid="kill-feed"></div>
<div class="tm-panel tm-wave" data-role="wavePanel" data-testid="wave-block"><div class="tm-wave-main" data-role="wave"></div><div class="tm-unit-bar" data-role="units"></div><div class="tm-wave-sub" data-role="waveSub"></div></div>
<div class="tm-panel tm-skynet" data-role="skynetPanel" data-testid="skynet-panel"><div class="tm-skynet-title"><span class="tm-dot" data-role="dot"></span>SKYNET: <span data-role="skynet"></span></div><div class="tm-skynet-row tm-budget" data-role="budget"></div><div class="tm-skynet-row tm-revs" data-role="revs"></div><div class="tm-skynet-row tm-amber" data-role="fallback" hidden></div><div class="tm-transmission"><span class="tm-transmission-label">TRANSMISSION // ENCRYPTED UPLINK</span><span class="tm-transmission-text" data-role="transmission"></span></div></div>
<div class="tm-panel tm-vitals" data-testid="vitals"><div class="tm-vital-row">${icon('health')}<div><span class="tm-vital-label">HEALTH</span><div class="tm-meter"><i class="tm-fill tm-health" data-role="healthBar"></i></div></div><b class="tm-vital-value" data-role="health"></b></div><div class="tm-vital-row armor">${icon('armor')}<div><span class="tm-vital-label">ARMOR</span><div class="tm-meter"><i class="tm-fill tm-armor" data-role="armorBar"></i></div></div><b class="tm-vital-value" data-role="armor"></b></div><div class="tm-stamina"><i data-role="stamina"></i></div></div>
<div class="tm-panel tm-weapon" data-testid="weapon-block"><div class="tm-weapon-top"><span class="tm-weapon-icon" data-role="weaponIcon"></span><span class="tm-weapon-name" data-role="weapon"></span></div><div class="tm-ammo" data-role="ammo"><b data-role="mag"></b><small>/ <span data-role="reserve"></span></small></div><div class="tm-grenade">${icon('grenade')}<span data-role="grenades"></span><span class="tm-muted">FRAG / G</span></div></div>
<div class="tm-cross" data-role="cross"><i class="n"></i><i class="s"></i><i class="w"></i><i class="e"></i><span class="tm-cross-center"></span><div class="tm-hit" data-role="hit"></div><svg class="tm-reload" data-role="reload" data-testid="reload-ring" viewBox="0 0 70 70" hidden><circle class="track" cx="35" cy="35" r="30"/><circle data-role="reloadProgress" cx="35" cy="35" r="30"/></svg></div><div class="tm-reload-label" data-role="reloadLabel" hidden>RELOADING</div>
<div class="tm-damage" data-role="damage" data-testid="damage-directions"></div><div class="tm-nameplates" data-role="nameplates" data-testid="nameplates"></div>
<div class="tm-trader-marker" data-role="trader" data-testid="trader-marker" hidden>${icon('crate')}<span>SUPPLY CRATE</span><small data-role="traderDistance"></small></div>
<div class="tm-ready" data-role="ready" data-testid="intermission" hidden><button data-action="ready">Press R to end intermission early</button><br><button data-action="trader">E / Open trader</button></div>
<div class="tm-banner" data-role="banner" hidden><b data-role="bannerTitle"></b><small data-role="bannerSub"></small></div>
<div class="tm-controls"><kbd>WASD</kbd>MOVE <kbd>SHIFT</kbd>SPRINT <kbd>R</kbd>RELOAD <kbd>1-4</kbd>WEAPONS <kbd>V</kbd>KNIFE <button data-action="pause">ESC / PAUSE</button></div>
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
    this.style.textContent = STYLE
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
    const now = performance.now()
    this.text('scrap', view.scrap.toLocaleString(), true)
    this.text('health', Math.ceil(view.health.value), true)
    this.text('armor', Math.ceil(view.armor.value), true)
    el.healthBar.style.width = `${view.health.ratio*100}%`
    el.armorBar.style.width = `${view.armor.ratio*100}%`
    el.stamina.style.width = `${extra.staminaRatio === undefined ? 100 : extra.staminaRatio*100}%`
    el.vignette.classList.toggle('show',view.health.low)
    el.vignette.classList.toggle('critical',view.health.critical)
    this.text('weapon', view.weapon.name.toUpperCase())
    if (this.weaponId !== view.weapon.id) {el.weaponIcon.innerHTML = icon(view.weapon.id);this.weaponId = view.weapon.id;animate(el.weaponIcon)}
    el.ammo.className = `tm-ammo${view.ammo.empty?' empty':view.ammo.low?' low':''}`
    this.text('mag', String(view.ammo.mag).padStart(2,'0'), true)
    this.text('reserve', view.ammo.reserve)
    this.text('grenades', view.grenades, true)
    const intermission = view.wave.phase === 'intermission'
    this.text('wave', intermission ? 'TRADER OPEN' : `WAVE ${String(view.wave.current).padStart(2,'0')} / ${view.wave.total}`)
    this.text('waveSub', intermission ? `RESUPPLY ENDS IN ${Math.ceil(view.wave.timer)} s` : `${extra.remaining ?? view.wave.remaining} TERMINATORS REMAIN`)
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
    this.text('budget',`BUDGET ${extra.nextBudget ?? view.wave.budget} (x${(extra.nextMultiplier ?? view.wave.multiplier).toFixed(1)})`)
    this.text('revs',`ENDO r${view.skynet.revs.endo} · SCOUT r${view.skynet.revs.scout} · HEAVY r${view.skynet.revs.heavy}`)
    el.fallback.hidden = !view.skynet.fallbackCount
    this.text('fallback',`FALLBACK ${view.skynet.fallbackCount}`)
    if (view.skynet.connected && !this.connected) {animate(el.skynetPanel,'tm-power');sfx.skynetPowerOn()}
    this.connected = view.skynet.connected
    const transmission = String(view.transmission || '')
    if (transmission !== this.transmission) {this.transmission=transmission;this.transmissionAt=now;sfx.transmissionStatic()}
    const chars = Math.floor((now-(this.transmissionAt || 0))/24)
    this.text('transmission',transmission ? `> ${transmission.slice(0,chars)}` : 'Awaiting transmission...')
    el.transmission.classList.toggle('tm-caret',Boolean(transmission && chars<transmission.length))
    if (view.wave.phase !== this.lastPhase || view.wave.current !== this.lastWave) {
      if (view.wave.phase === 'wave' && extra.matchStarted) {
        animate(el.wavePanel,'slam');this.banner(`WAVE ${view.wave.current}`, 'HOLD THE LINE');sfx.waveKlaxon(view.wave.current)
        this.waveStartScrap = view.scrap
      } else if (intermission) {
        this.banner('WAVE CLEARED',`+${extra.waveScrap ?? Math.max(0,view.scrap-(this.waveStartScrap || 0))} SCRAP RECOVERED`);sfx.waveClearStinger()
      }
      this.lastPhase=view.wave.phase;this.lastWave=view.wave.current
    }
    if (this.bannerUntil && now>this.bannerUntil) el.banner.hidden=true
    this.renderFeed(view.killFeed)
    this.renderNameplates(view.nameplates,extra.nameplateHeights)
    this.renderDamage(view.damageDirections)
    this.renderCrosshair(view)
    this.renderTrader(extra.trader,intermission)
  }
  banner(title, subtitle) {
    this.text('bannerTitle',title);this.text('bannerSub',subtitle)
    this.elements.banner.hidden=false
    animate(this.elements.banner,'enter')
    this.bannerUntil=performance.now()+3000
  }
  renderFeed(items) {
    const active = new Set(items.map(x=>x.id))
    for (const [id,row] of this.feed) if (!active.has(id)) {row.remove();this.feed.delete(id)}
    for (const item of [...items].reverse()) {
      let row=this.feed.get(item.id)
      if (!row) {row=document.createElement('div');row.className='tm-feed-row';row.innerHTML=icon('skull')+escapeHtml(item.text);this.feed.set(item.id,row);this.elements.feed.prepend(row)}
      row.style.opacity=String(Math.max(0,1-item.age/5))
    }
  }
  project(pos, height=0) {
    this.point.set(pos.x,pos.y+height,pos.z).project(this.viewer.scene.mainCamera)
    return {x:(this.point.x+1)*50,y:(1-this.point.y)*50,visible:this.point.z>-1 && this.point.z<1 && Math.abs(this.point.x)<.96 && Math.abs(this.point.y)<.93,z:this.point.z}
  }
  renderNameplates(items,heights = {}) {
    const active=new Set(items.map(x=>x.id))
    for(const [id,plate] of this.plates) if(!active.has(id)){plate.remove();this.plates.delete(id)}
    for(const item of items){
      let plate=this.plates.get(item.id)
      if(!plate){plate=document.createElement('div');plate.className='tm-nameplate';plate.innerHTML='<strong></strong><small></small><div class="tm-meter"><i class="tm-fill"></i></div><div class="tm-chatter"></div>';this.plates.set(item.id,plate);this.elements.nameplates.append(plate)}
      const point=this.project(item.pos,heights[item.id] ?? 2.5)
      plate.hidden=!point.visible || item.distance>25
      plate.style.left=`${point.x}%`;plate.style.top=`${point.y}%`
      plate.children[0].textContent=item.label
      plate.children[1].textContent=`rev ${item.rev} / ${Math.round(item.distance)} m`
      plate.querySelector('i').style.width=`${item.ratio*100}%`
      plate.lastElementChild.textContent=item.chatter
      plate.lastElementChild.hidden=!item.chatter
    }
  }
  renderDamage(items) {
    const active=new Set(items.map(x=>x.id))
    for(const [id,arc] of this.arcs) if(!active.has(id)){arc.remove();this.arcs.delete(id)}
    for(const item of items){let arc=this.arcs.get(item.id);if(!arc){arc=document.createElement('b');this.arcs.set(item.id,arc);this.elements.damage.append(arc)}arc.style.transform=`rotate(${item.angle}rad)`;arc.style.opacity=String(Math.max(0,(1-item.age)*item.strength))}
  }
  renderCrosshair(view) {
    this.elements.cross.style.setProperty('--gap',`${Math.min(30,5+view.crosshair.spread*2)}px`)
    this.elements.reload.toggleAttribute('hidden',!view.weapon.reloading)
    this.elements.reloadLabel.hidden=!view.weapon.reloading
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
    this.text('traderDistance',`${p.visible?'':'↗ '}${Math.round(trader.distance)} m / E TO TRADE`)
  }
  dispose() {
    sfx.stopSfx?.()
    this.root?.remove();this.style?.remove();this.root=null;this.style=null;this.elements={}
    this.plates.clear();this.feed.clear();this.arcs.clear()
  }
}
