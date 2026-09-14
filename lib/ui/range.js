import {parseRangeFlag, RANGE_WEAPONS} from '../core/range.js'
export {parseRangeFlag}

const STYLE = `
.tm-range{left:2.4%;top:calc(3.2% + 62px);z-index:26;width:320px;padding:12px 14px;pointer-events:auto;max-height:calc(100% - 135px);overflow:auto;background:#09131cf2}
.tm-range h2{margin:0;color:var(--blue);font-size:19px;letter-spacing:.12em}.tm-range header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #91bdd242;padding-bottom:8px}
.tm-range small,.tm-range output{font:11px ui-monospace,monospace;color:#a3becd}.tm-range fieldset{border:0;padding:0;margin:10px 0}.tm-range legend{font:11px ui-monospace,monospace;letter-spacing:.1em;color:#c5d6df;margin-bottom:5px}
.tm-range-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.tm-range-grid.two{grid-template-columns:1fr 1fr}.tm-range-grid.three{grid-template-columns:repeat(3,1fr)}
.tm-range button{min-height:29px;padding:5px 3px;background:#172b3a;border:1px solid #668da363;font:12px ui-monospace,monospace;color:#d4e5ef;cursor:pointer}.tm-range button:hover{background:#29485a}.tm-range button[aria-pressed=true]{border-color:#8ed4f1;background:#315265;color:white}.tm-range button:disabled{opacity:.4;cursor:default}
.tm-range label{display:flex;align-items:center;gap:6px;font:12px ui-monospace,monospace;color:#c5d6df;min-height:25px}.tm-range input{accent-color:#96d9f2}.tm-range output{display:block;margin-top:8px;color:#ffd99e}.tm-range-ruler{position:absolute;left:50%;top:53%;transform:translateX(-50%);color:#ffe2a6;font:12px ui-monospace,monospace;text-shadow:0 1px 3px #000;pointer-events:none}.tm-range-ruler:before{content:'+';position:absolute;left:50%;top:-28px;font-size:15px}
.tm-hud.is-range-inspecting .tm-nameplates,.tm-hud.is-range-inspecting .tm-reload{visibility:hidden}.tm-hud.is-range .tm-feed{top:calc(3.2% + 580px)}.tm-hud.is-range .tm-boss,.tm-hud.is-range .tm-trader-marker,.tm-hud.is-range .tm-ready{display:none!important}
.tm-hud.is-range.is-sandbox .tm-sandbox{left:calc(2.4% + 362px)}
`
const button = (action, value, label) => `<button type="button" data-range-action="${action}" data-value="${value}" data-testid="range-${action}-${value}">${label}</button>`
const group = (title, body, cols = '') => `<fieldset><legend>${title}</legend><div class="tm-range-grid ${cols}">${body}</div></fieldset>`

export function mountRangePanel(manager, search = globalThis.location?.search) {
  return parseRangeFlag(search) ? new RangePanel(manager) : null
}

export class RangePanel {
  constructor(manager) {
    this.manager = manager; this.range = manager.ui?.range || manager.range
    this.style = document.createElement('style'); this.style.dataset.terminatorRangeStyle = 'true'; this.style.textContent = STYLE
    document.head.append(this.style)
    this.root = document.createElement('aside'); this.root.className = 'tm-panel tm-range'
    this.root.dataset.testid = 'range-panel'; this.root.setAttribute('aria-label', 'Weapons range controls')
    this.root.innerHTML = `<header><h2>WEAPONS RANGE</h2><small>F1 PANEL</small></header>
      ${group('LOADOUT / INFINITE AMMO', RANGE_WEAPONS.map(id => button('weapon', id, id.toUpperCase())).join(''))}
      <label><input type="checkbox" data-range-option="reloads" data-testid="range-reloads" checked>Magazine reloads</label>
      ${group('TIME / WORLD AND EFFECTS', [[1,'1x'],[.25,'0.25x'],[.1,'0.1x'],[0,'Pause']].map(([v,l]) => button('time', v, l)).join(''))}
      <div class="tm-range-grid two">${button('step','once','STEP 1/60 s')}${button('fire','once','FIRE ONCE')}</div>
      ${group('CAMERA / DRAG TO ORBIT, WHEEL TO ZOOM', button('camera','inspect','INSPECT') + button('camera','player','PLAYER VIEW'), 'two')}
      ${group('INSPECT ANIMATION LOOP', ['idle','fire','reload','aim'].map(id => button('loop',id,id.toUpperCase())).join(''))}
      ${group('OVERLAYS', [['trajectories','Shot paths'],['impacts','Impact marks'],['freeze','Freeze flash'],['hitboxes','Hitboxes']].map(([id,label]) => `<label><input type="checkbox" data-range-option="${id}" data-testid="range-${id}" ${['trajectories','impacts'].includes(id)?'checked':''}>${label}</label>`).join(''), 'two')}
      ${group('YARD LIGHTING', ['night','overcast','noon'].map(id => button('light',id,id.toUpperCase())).join(''), 'three')}
      <div class="tm-range-grid two">${button('targets','reset','RESPAWN TARGETS')}${button('shots','clear','CLEAR SHOTS')}</div>
      <output data-testid="range-status">18 targets / 6 plates / director paused</output>`
    manager.hud.elements.combat.append(this.root); manager.hud.root.classList.add('is-range')
    this.stopPointer = event => event.stopPropagation()
    this.onClick = event => {
      event.stopPropagation()
      const b = event.target.closest('[data-range-action]'); if (!b) return
      this.action(b.dataset.rangeAction, b.dataset.value)
    }
    this.onChange = event => {
      const option = event.target.dataset.rangeOption; if (!option) return
      if (option === 'reloads') manager.range.setReloads(event.target.checked)
      else manager.rangeView.options[option] = event.target.checked
      this.sync(); manager.syncViews()
    }
    this.onKey = event => {
      if (event.code !== 'F1') return
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.repeat) return
      this.root.hidden = !this.root.hidden
      if (manager.ui?.sandbox) manager.ui.sandbox.root.hidden = this.root.hidden
      if (!this.root.hidden) { manager.input.stop(); manager.ui?.bindings.clear() }
      else if (!manager.rangeView?.inspecting && !manager.ui.screens.route) manager.ui.setInput(true)
    }
    this.pointerEvents = ['pointerdown','mousedown','mouseup','contextmenu','mousemove','wheel']
    for (const type of this.pointerEvents) this.root.addEventListener(type, this.stopPointer)
    this.root.addEventListener('click', this.onClick); this.root.addEventListener('change', this.onChange)
    window.addEventListener('keydown', this.onKey, true)
  }
  action(action, value) {
    const m = this.manager, range = m.range, view = m.rangeView
    if (action === 'weapon') {
      range.equip(value); view?.equip(value)
    } else if (action === 'time') range.clock.setScale(Number(value))
    else if (action === 'step') range.clock.step()
    else if (action === 'fire') range.firePulse = true
    else if (action === 'camera') view.setInspect(value === 'inspect')
    else if (action === 'loop') { view.loop = value; range.loopStartedAt = m.world.tick; if (value === 'idle') m.world.player.aiming = false }
    else if (action === 'light') view.setLighting(value)
    else if (action === 'targets') range.respawn()
    else if (action === 'shots') view.clearShots()
    this.sync(); m.syncViews()
  }
  sync() {
    const m = this.manager, range = m.range, view = m.rangeView
    if (!view) return
    // Combat effects share simulation time. Navigation fades must finish even during Pause.
    for(const animation of m.hud.elements.combat.getAnimations({subtree:true})){
      animation.playbackRate=range.clock.scale
      if(range.clock.scale===0 && this.lastTick!==undefined && m.world.tick>this.lastTick)animation.currentTime+=1000*(m.world.tick-this.lastTick)/60
    }
    this.lastTick=m.world.tick
    for(const input of this.root.querySelectorAll('[data-range-option]')) {
      const option=input.dataset.rangeOption
      input.checked=option==='reloads'?!m.world.sandbox.noReload:view.options[option]
    }
    for (const b of this.root.querySelectorAll('[data-range-action]')) {
      const a = b.dataset.rangeAction, v = b.dataset.value
      const selected = a === 'weapon' ? m.world.player.activeWeapon === v : a === 'time' ? range.clock.scale === Number(v)
        : a === 'camera' ? (v === 'inspect') === view.inspecting : a === 'loop' ? view.loop === v : a === 'light' ? view.lighting === v : false
      b.setAttribute('aria-pressed', String(selected))
      b.disabled = (a === 'step' && range.clock.scale !== 0) || (a === 'loop' && (!view.inspecting || (v === 'reload' && m.world.sandbox.noReload)))
    }
    // Enemy target names/distances have no rendered range overlay.
    view.options.ruler = false
    this.root.querySelector('[data-testid="range-status"]').textContent = `${m.world.aliveUnits.length} targets / ${view.shots.length} paths / ${view.inspecting ? view.loop : 'lane'} / tick ${m.world.tick}`
  }
  dispose() {
    window.removeEventListener('keydown', this.onKey, true)
    for (const type of this.pointerEvents) this.root.removeEventListener(type, this.stopPointer)
    this.root.removeEventListener('click', this.onClick); this.root.removeEventListener('change', this.onChange)
    this.manager.hud.root.classList.remove('is-range'); this.root.remove(); this.style.remove()
  }
}
