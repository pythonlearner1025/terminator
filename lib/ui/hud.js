const STYLE = `
.tm-hud{position:fixed;left:0;top:0;z-index:60;overflow:hidden;pointer-events:none;box-sizing:border-box;
  color:#eef5ff;font-family:Impact,"Arial Narrow",sans-serif;letter-spacing:.07em;text-shadow:0 2px 3px #000;user-select:none}
.tm-hud *{box-sizing:border-box}.tm-panel{position:absolute;background:linear-gradient(135deg,rgba(9,17,25,.9),rgba(16,25,34,.66));
  border:1px solid rgba(155,190,220,.34);padding:10px 14px;clip-path:polygon(0 0,96% 0,100% 16%,100% 100%,4% 100%,0 84%)}
.tm-scrap{left:18px;top:18px;color:#f4c45d;font-size:20px}.tm-feed{left:18px;top:72px;width:320px;font:12px ui-monospace,monospace}
.tm-feed div{margin:4px 0;padding:5px 8px;background:rgba(5,9,14,.65);border-left:2px solid #d9ecff}
.tm-wave{left:50%;top:16px;transform:translateX(-50%);min-width:250px;text-align:center}.tm-wave-main{font-size:20px}.tm-wave-sub{font:11px ui-monospace,monospace;color:#a8c4d8;margin-top:4px}
.tm-skynet{right:18px;top:18px;width:285px;border-color:rgba(238,49,49,.58);background:linear-gradient(135deg,rgba(35,5,8,.9),rgba(22,9,12,.7))}
.tm-skynet-title{color:#ff3e3e;font-size:18px}.tm-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff3030;box-shadow:0 0 8px #ff3030;margin-right:6px}
.tm-skynet-row{font:11px ui-monospace,monospace;margin-top:5px}.tm-transmission{color:#ff7777;min-height:16px;border-top:1px solid #74272b;padding-top:5px}
.tm-vitals{left:18px;bottom:18px;width:250px}.tm-vital-row{display:grid;grid-template-columns:28px 1fr 42px;gap:8px;align-items:center;margin:5px 0}
.tm-vital-label{font-size:11px}.tm-bar{height:10px;background:#10171e;border:1px solid #4a5660}.tm-fill{height:100%;transition:width .12s linear}.tm-health{background:#ce2d2d}.tm-armor{background:#3f8fd2}
.tm-vital-value{text-align:right;font-size:18px}.tm-weapon{right:18px;bottom:18px;min-width:260px;text-align:right}.tm-weapon-name{font-size:14px;color:#b9cee0}
.tm-ammo{font-size:46px;line-height:1}.tm-ammo small{font-size:18px;color:#a7b4c0}.tm-ammo.low{color:#f4ad3f}.tm-ammo.empty{color:#ff3e3e}.tm-grenade{font:12px ui-monospace,monospace;margin-top:5px}
.tm-cross{position:absolute;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%)}.tm-cross i{position:absolute;background:#e7f4ff;box-shadow:0 0 4px #000}
.tm-cross .n,.tm-cross .s{left:16px;width:2px;height:8px}.tm-cross .n{top:0}.tm-cross .s{bottom:0}.tm-cross .w,.tm-cross .e{top:16px;height:2px;width:8px}.tm-cross .w{left:0}.tm-cross .e{right:0}
.tm-hit{position:absolute;inset:5px;border:2px solid #fff;transform:rotate(45deg);opacity:0}.tm-hit.show{animation:tm-hit .26s ease-out}.tm-hit.headshot{border-color:#ff4242}.tm-hit.kill{border-color:#f4c45d;border-width:3px}
.tm-reload{position:absolute;inset:-7px;border:2px solid transparent;border-top-color:#f4ad3f;border-radius:50%;display:none}
.tm-damage{position:absolute;inset:0}.tm-damage b{position:absolute;left:50%;top:50%;width:90px;height:8px;margin-left:-45px;margin-top:-42%;background:linear-gradient(90deg,transparent,#ef3030,transparent);transform-origin:45px calc(50vh - 4px);opacity:.85}
.tm-nameplates{position:absolute;left:50%;top:28%;transform:translateX(-50%);display:flex;gap:12px;align-items:flex-start}.tm-nameplate{min-width:135px;background:rgba(5,8,11,.78);border-top:2px solid #d52c2c;padding:5px 8px;text-align:center;font:10px ui-monospace,monospace}
.tm-nameplate .bar{height:3px;background:#1d252c;margin-top:4px}.tm-nameplate .bar i{display:block;height:100%;background:#d52c2c}.tm-chatter{color:#ff8a8a;margin-top:3px}.tm-phase{position:absolute;left:50%;top:105px;transform:translateX(-50%);text-align:center;color:#f4c45d;font-size:24px}.tm-phase small{display:block;font:11px ui-monospace,monospace;color:#fff;margin-top:4px}
.tm-vignette{position:absolute;inset:0;box-shadow:inset 0 0 110px 24px rgba(130,0,0,.72);display:none}.tm-vignette.show{display:block}.tm-vignette.critical{animation:tm-pulse .65s ease-in-out infinite alternate}
@keyframes tm-hit{0%{opacity:1;transform:rotate(45deg) scale(.5)}100%{opacity:0;transform:rotate(45deg) scale(1.7)}}
@keyframes tm-pulse{from{opacity:.42}to{opacity:.95}}
`

const MARKUP = `
<div class="tm-vignette" data-role="vignette"></div>
<div class="tm-panel tm-scrap" data-testid="scrap">SCRAP <span data-role="scrap">0</span></div>
<div class="tm-feed" data-role="feed"></div>
<div class="tm-panel tm-wave" data-testid="wave-block"><div class="tm-wave-main" data-role="wave"></div><div class="tm-wave-sub" data-role="waveSub"></div></div>
<div class="tm-panel tm-skynet" data-testid="skynet-panel"><div class="tm-skynet-title"><span class="tm-dot"></span>SKYNET: <span data-role="skynet"></span></div><div class="tm-skynet-row" data-role="budget"></div><div class="tm-skynet-row" data-role="revs"></div><div class="tm-skynet-row tm-transmission" data-role="transmission"></div></div>
<div class="tm-panel tm-vitals" data-testid="vitals"><div class="tm-vital-row"><span class="tm-vital-label">HP</span><span class="tm-bar"><i class="tm-fill tm-health" data-role="healthBar"></i></span><b class="tm-vital-value" data-role="health"></b></div><div class="tm-vital-row"><span class="tm-vital-label">AR</span><span class="tm-bar"><i class="tm-fill tm-armor" data-role="armorBar"></i></span><b class="tm-vital-value" data-role="armor"></b></div></div>
<div class="tm-panel tm-weapon" data-testid="weapon-block"><div class="tm-weapon-name" data-role="weapon"></div><div class="tm-ammo" data-role="ammo"></div><div class="tm-grenade" data-role="grenades"></div></div>
<div class="tm-cross" data-role="cross"><i class="n"></i><i class="s"></i><i class="w"></i><i class="e"></i><div class="tm-hit" data-role="hit"></div><div class="tm-reload" data-role="reload"></div></div>
<div class="tm-damage" data-role="damage"></div><div class="tm-nameplates" data-role="nameplates"></div><div class="tm-phase" data-role="phase"></div>
`

export class Hud {
  constructor(viewer) {
    this.viewer = viewer
    this.style = document.createElement('style')
    this.style.textContent = STYLE
    document.head.appendChild(this.style)
    this.root = document.createElement('div')
    this.root.className = 'tm-hud'
    this.root.dataset.testid = 'terminator-hud'
    this.root.innerHTML = MARKUP
    viewer.container.appendChild(this.root)
    this.elements = {}
    for (const item of this.root.querySelectorAll('[data-role]')) this.elements[item.dataset.role] = item
    this.box = null
    this.lastHitId = ''
    this.sync()
  }

  sync() {
    if (!this.root) return
    const rect = this.viewer.canvas.getBoundingClientRect()
    if (this.box && this.box.left === rect.left && this.box.top === rect.top && this.box.width === rect.width && this.box.height === rect.height) return
    this.box = {left: rect.left, top: rect.top, width: rect.width, height: rect.height}
    Object.assign(this.root.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`})
  }

  render(view) {
    if (!this.root) return
    const el = this.elements
    el.scrap.textContent = String(view.scrap)
    el.health.textContent = String(view.health.value)
    el.armor.textContent = String(view.armor.value)
    el.healthBar.style.width = `${view.health.ratio * 100}%`
    el.armorBar.style.width = `${view.armor.ratio * 100}%`
    el.vignette.classList.toggle('show', view.health.low)
    el.vignette.classList.toggle('critical', view.health.critical)
    el.weapon.textContent = `${view.weapon.slot}  ${view.weapon.name.toUpperCase()}`
    el.ammo.className = `tm-ammo${view.ammo.empty ? ' empty' : view.ammo.low ? ' low' : ''}`
    el.ammo.innerHTML = `${view.ammo.mag} <small>/ ${view.ammo.reserve}</small>`
    el.grenades.textContent = `GRENADES ${view.grenades}  |  STAMINA ${Math.round(view.sprintStamina / 6 * 100)}%`
    el.wave.textContent = view.wave.phase === 'intermission' ? 'TRADER OPEN' : `WAVE ${view.wave.current} / ${view.wave.total}`
    el.waveSub.textContent = view.wave.phase === 'wave' ? `${view.wave.remaining} TERMINATORS REMAIN` : `${view.wave.timer.toFixed(1)} SECONDS`
    el.skynet.textContent = view.skynet.status
    el.budget.textContent = `BUDGET ${view.wave.budget}  (x${view.wave.multiplier.toFixed(2)})${view.skynet.fallbackCount ? `  FALLBACK ${view.skynet.fallbackCount}` : ''}`
    el.revs.textContent = `ENDO r${view.skynet.revs.endo}  SCOUT r${view.skynet.revs.scout}  HEAVY r${view.skynet.revs.heavy}`
    el.transmission.textContent = view.transmission ? `> ${view.transmission}` : ''
    el.phase.innerHTML = view.wave.phase === 'intermission'
      ? `INTERMISSION <small>TRADER CRATE INSIDE NORTH BUILDING  |  PRESS E WHEN READY</small>`
      : ''
    el.phase.dataset.testid = view.wave.phase === 'intermission' ? 'intermission' : ''
    this.renderFeed(view.killFeed)
    this.renderNameplates(view.nameplates)
    this.renderDamage(view.damageDirections)
    this.renderCrosshair(view)
  }

  renderFeed(items) {
    this.elements.feed.replaceChildren(...items.map((item) => {
      const row = document.createElement('div')
      row.textContent = item.text
      row.style.opacity = String(Math.max(0.15, 1 - item.age / 5))
      return row
    }))
  }

  renderNameplates(items) {
    this.elements.nameplates.replaceChildren(...items.slice(0, 4).map((item) => {
      const plate = document.createElement('div')
      plate.className = 'tm-nameplate'
      const title = document.createElement('div')
      title.textContent = `${item.label} rev ${item.rev}  ${item.distance} m`
      const bar = document.createElement('div')
      bar.className = 'bar'
      const fill = document.createElement('i')
      fill.style.width = `${item.ratio * 100}%`
      bar.appendChild(fill)
      plate.append(title, bar)
      if (item.chatter) {
        const chatter = document.createElement('div')
        chatter.className = 'tm-chatter'
        chatter.textContent = item.chatter
        plate.appendChild(chatter)
      }
      return plate
    }))
  }

  renderDamage(items) {
    this.elements.damage.replaceChildren(...items.map((item) => {
      const arc = document.createElement('b')
      arc.style.transform = `rotate(${item.angle}rad)`
      arc.style.opacity = String(Math.max(0, (1 - item.age) * item.strength))
      return arc
    }))
  }

  renderCrosshair(view) {
    const gap = Math.min(13, 3 + view.crosshair.spread)
    this.elements.cross.querySelector('.n').style.top = `${-gap}px`
    this.elements.cross.querySelector('.s').style.bottom = `${-gap}px`
    this.elements.cross.querySelector('.w').style.left = `${-gap}px`
    this.elements.cross.querySelector('.e').style.right = `${-gap}px`
    const reload = this.elements.reload
    reload.style.display = view.weapon.reloading ? 'block' : 'none'
    reload.style.transform = `rotate(${view.weapon.reloadProgress * 360}deg)`
    const latest = view.hitMarkers.at(-1)
    if (latest && latest.id !== this.lastHitId) {
      this.lastHitId = latest.id
      const hit = this.elements.hit
      hit.className = `tm-hit ${latest.kind}`
      void hit.offsetWidth
      hit.classList.add('show')
    }
  }

  dispose() {
    this.root?.remove()
    this.style?.remove()
    this.root = null
    this.style = null
    this.elements = {}
    this.box = null
  }
}
