const UNIT_LABELS = Object.freeze({
  scout: 'Scout',
  endo: 'Endo',
  heavy: 'Heavy',
  t1000: 'T-1000',
  hkaerial: 'HK-Aerial',
  hktank: 'HK-Tank',
})

const SANDBOX_STYLE = `
.tm-sandbox{left:2.4%;top:calc(3.2% + 62px);z-index:25;width:292px;padding:12px 14px;pointer-events:auto;transform:scale(var(--hud-scale));transform-origin:top left}
.tm-sandbox-head{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #91bdd242;padding-bottom:7px;margin-bottom:8px;color:var(--blue)}
.tm-sandbox-head strong{font-size:18px;letter-spacing:.14em}.tm-sandbox-head small{font:10px ui-monospace,monospace;color:var(--muted)}
.tm-sandbox-units{display:grid;grid-template-columns:1fr 1fr;gap:5px}.tm-sandbox button{min-height:30px;padding:5px 8px;border:1px solid #8abedc5c;background:#142637;text-align:left;font-size:14px;text-transform:uppercase}
.tm-sandbox button span{float:right;color:var(--blue)}.tm-sandbox-options{display:flex;justify-content:space-between;align-items:center;margin:8px 0;font-size:12px;color:var(--muted)}
.tm-sandbox-options input{accent-color:var(--blue)}.tm-sandbox-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px}.tm-sandbox-actions button{font-size:12px;text-align:center}
.tm-sandbox-actions .wide{grid-column:1/-1}.tm-sandbox-status{display:block;min-height:14px;margin-top:7px;color:var(--amber);font:10px ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tm-hud.is-sandbox .tm-feed{top:calc(3.2% + 350px)}
`

export function parseSandboxFlag(search = '') {
  const value = new URLSearchParams(String(search || '')).get('sandbox')
  return value !== null && value.length > 0
}

export class SandboxPanel {
  constructor(manager) {
    this.manager = manager
    this.style = document.createElement('style')
    this.style.dataset.terminatorSandboxStyle = 'true'
    this.style.textContent = SANDBOX_STYLE
    document.head.append(this.style)

    this.root = document.createElement('aside')
    this.root.className = 'tm-panel tm-sandbox'
    this.root.dataset.testid = 'sandbox-panel'
    this.root.setAttribute('aria-label', 'Sandbox controls')
    const unitButtons = Object.keys(manager.world.unitCatalog.types).map((type) => (
      `<button type="button" data-sandbox-action="spawn" data-unit="${type}" data-testid="sandbox-spawn-${type}">${UNIT_LABELS[type] || type}<span data-count="${type}">0</span></button>`
    )).join('')
    this.root.innerHTML = `<div class="tm-sandbox-head"><strong>SANDBOX</strong><small>F1 TOGGLE</small></div>
      <div class="tm-sandbox-units">${unitButtons}</div>
      <label class="tm-sandbox-options"><span>SPAWN BATCH</span><span><input type="checkbox" data-testid="sandbox-x5"> x5</span></label>
      <div class="tm-sandbox-actions">
        <button type="button" data-sandbox-action="clear" data-testid="sandbox-clear">CLEAR UNITS</button>
        <button type="button" data-sandbox-action="kill" data-testid="sandbox-kill">KILL ALL</button>
        <button type="button" class="wide" data-sandbox-action="waves" data-testid="sandbox-waves">START WAVES</button>
        <button type="button" class="wide" data-sandbox-action="weapons" data-testid="sandbox-weapons">GIVE ALL WEAPONS</button>
      </div><output class="tm-sandbox-status" data-sandbox-status>TRADER: E · AIM THEN SPAWN</output>`
    manager.hud.elements.combat.append(this.root)
    manager.hud.root.classList.add('is-sandbox')

    this.stopPointer = event => event.stopPropagation()
    this.onClick = event => {
      event.stopPropagation()
      const button = event.target.closest('[data-sandbox-action]')
      if (!button || !this.root.contains(button)) return
      event.preventDefault()
      this.action(button.dataset.sandboxAction, button.dataset.unit)
    }
    this.onKey = event => {
      if (event.code !== 'F1' || this.manager.ui?.rangeEnabled) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!event.repeat) this.root.hidden = !this.root.hidden
    }
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'contextmenu']) {
      this.root.addEventListener(type, this.stopPointer)
    }
    this.root.addEventListener('click', this.onClick)
    window.addEventListener('keydown', this.onKey, true)
    this.sync()
  }

  action(action, unitType) {
    const {world, director} = this.manager
    if (action === 'spawn') {
      const total = this.root.querySelector('[data-testid="sandbox-x5"]').checked ? 5 : 1
      const point = this.aimPoint()
      const player = world.getPlayer(this.manager.localPlayerId) || world.player
      const right = {x: Math.cos(player.yaw), z: -Math.sin(player.yaw)}
      let spawned = 0
      for (let index = 0; index < total; index += 1) {
        const offset = total === 1 ? 0 : (index - 2) * 0.65
        const unit = world.spawnUnit(unitType, {
          x: point.x + right.x * offset,
          y: point.y,
          z: point.z + right.z * offset,
        }, {yaw: Math.atan2(player.pos.x - point.x, player.pos.z - point.z)})
        if (unit) spawned += 1
      }
      this.status(`${spawned} ${UNIT_LABELS[unitType] || unitType} spawned`)
    } else if (action === 'clear') {
      this.status(`${world.clearUnits()} units cleared`)
    } else if (action === 'kill') {
      this.status(`${world.killAllUnits()} units killed`)
    } else if (action === 'waves') {
      if (director.sandboxPaused) {
        const result = director.startWaves()
        this.status(result?.ok ? 'Waves running' : result?.error || 'Waves unavailable')
      } else {
        director.pauseWaves()
        this.status('Waves paused')
      }
    } else if (action === 'weapons') {
      world.giveAllWeapons(this.manager.localPlayerId)
      this.status('All weapons and ammo supplied')
    }
    this.sync()
  }

  aimPoint() {
    const world = this.manager.world
    const player = world.getPlayer(this.manager.localPlayerId) || world.player
    const camera = this.manager.playerView?.camera || this.manager.ctx.viewer.scene.mainCamera
    if (camera?.position?.clone) {
      const origin = camera.position.clone()
      const direction = camera.position.clone().set(0, 0, -1)
      camera.getWorldPosition(origin)
      camera.getWorldDirection(direction)
      const hit = world.navSurfacePoint(origin, direction)
      if (hit) return hit
      const planar = Math.hypot(direction.x, direction.z)
      if (planar > 1e-6) return {
        x: player.pos.x + direction.x / planar * 6,
        y: player.pos.y,
        z: player.pos.z + direction.z / planar * 6,
      }
    }
    return {
      x: player.pos.x + Math.sin(player.yaw) * 6,
      y: player.pos.y,
      z: player.pos.z + Math.cos(player.yaw) * 6,
    }
  }

  status(message) {
    this.root.querySelector('[data-sandbox-status]').textContent = message
  }

  sync() {
    const counts = Object.fromEntries(Object.keys(this.manager.world.unitCatalog.types).map((type) => [type, 0]))
    for (const unit of this.manager.world.aliveUnits) counts[unit.type] = (counts[unit.type] || 0) + 1
    for (const [type, count] of Object.entries(counts)) {
      const node = this.root.querySelector(`[data-count="${type}"]`)
      if (node) node.textContent = String(count)
    }
    const waves = this.root.querySelector('[data-sandbox-action="waves"]')
    waves.textContent = this.manager.director.sandboxPaused ? 'START WAVES' : 'PAUSE WAVES'
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey, true)
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'contextmenu']) {
      this.root.removeEventListener(type, this.stopPointer)
    }
    this.root.removeEventListener('click', this.onClick)
    this.manager.hud.root.classList.remove('is-sandbox')
    this.root.remove()
    this.style.remove()
  }
}
