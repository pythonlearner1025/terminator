import * as E from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'
import {soldierMaterials} from '../../generators/soldier-materials.js'
import {createSoldierFigure} from '../../generators/soldier-template.generator.js'
import {bindPlayerRig, animatePlayer, disposePlayerRig} from './players-animation.js'
import {PlayerWeaponLibrary, selectPlayerWeapon} from './players-weapons.js'
import {PlayersShowcase} from './players-showcase.js'
import {UnitFx} from './fx.js'

export class PlayersView {
  constructor(viewer) {
    this.viewer = viewer; this.visuals = new Map()
    this.from = new E.Vector3(); this.to = new E.Vector3(); this.direction = new E.Vector3()
    this.owner = null; this.showcase = null; this.world = null
  }
  start(world, localPlayerId) {
    this.stop(); this.world = world; this.localPlayerId = localPlayerId
    this.template = this.viewer.scene.modelRoot.getObjectByName('Soldier Template') || this.viewer.scene.modelRoot.getObjectByName('Soldier_Template')
    if (!this.template) throw new Error('Soldier Template authored node not found; run npm run scene')
    this.owner = new RuntimeObjectOwner('terminator-players-view')
    this.root = this.owner.attachRuntimeRoot(new E.Group(), this.viewer.scene, this.template); this.root.name = 'Players Runtime'
    this.lastTick = world.tick || 0; this.eventIndex = world.eventLog?.length || 0
    // Weapon and FX pools are lazy: zero geometry or GPU cost in single player.
    this.onKey = event => {
      if (event.code !== 'F10' || event.repeat) return
      event.preventDefault()
      if (this.showcase) { this.showcase.stop(); this.showcase = null }
      else this.showcase = new PlayersShowcase(this)
    }
    this.onRender = () => { this.autoSync?.(); this.showcase?.update() }
    window.addEventListener('keydown', this.onKey); this.viewer.addEventListener('preRender', this.onRender)
    this.sync()
  }
  ensureResources() {
    this.weapons ||= new PlayerWeaponLibrary(this.root, this.materials.olive)
    this.fx ||= new UnitFx(this.root)
  }
  createVisual(id, variant, parent = this.root) {
    this.materials ||= soldierMaterials(E)
    this.ensureResources()
    if (!this.runtimeTemplate) {
      this.runtimeTemplate = createSoldierFigure(E)
      this.runtimeTemplate.visible = false
      this.root.add(this.runtimeTemplate)
    }
    // The full figure stays hidden until a teammate exists. The authored Generator
    // preview remains lightweight and is never cloned into Play.
    const object = this.runtimeTemplate.clone(true)
    object.visible = true
    object.traverse(child => {
      for (const key of ['EntityComponentPlugin', 'kite3dGenerated', 'kite3dAuthoring', 'kite3dRuntime', 'excludeFromExport']) delete child.userData[key]
      if (child.isSkinnedMesh) child.material = this.materials[variant]
      if (child.name === 'Headlamp Lens') child.material = this.materials.lamp
    })
    object.name = `Resistance ${id} (${variant})`; object.position.set(0, 0, 0); object.rotation.set(0, 0, 0)
    this.owner.trackEffect(object, this.template); parent.add(object)
    const rig = bindPlayerRig(object), weapon = this.weapons.attach(rig.joints.Chest)
    selectPlayerWeapon(weapon, 'pistol')
    return {id, object, rig, weapon, variant, lastFiring: false, cooldown: 0, shotTick: -1}
  }
  sync(world = this.world) {
    if (!this.owner || !world) return
    this.world = world
    const tick = Number(world.tick) || 0, dt = Math.min(.1, Math.max(0, (tick - this.lastTick) / 60)); this.lastTick = tick
    const ids = new Set(), entries = playerEntries(world.players)
    for (let index = 0; index < entries.length; index++) {
      const [id, player] = entries[index]
      if (String(id) === String(this.localPlayerId) || player.id != null && String(player.id) === String(this.localPlayerId)) continue
      if (!player.pos) continue
      ids.add(id)
      let visual = this.visuals.get(id)
      if (!visual) {
        // Join order is stable in the core Map and the snapshot's plain object.
        const variant = player.variant === 'gray' || player.variant === 'olive' ? player.variant : index % 2 ? 'olive' : 'gray'
        visual = this.createVisual(id, variant); this.visuals.set(id, visual)
      }
      this.syncVisual(visual, player, dt, tick / 60)
      visual.object.visible = !this.showcase
    }
    for (const [id, visual] of this.visuals) if (!ids.has(id)) { this.removeVisual(visual); this.visuals.delete(id) }
    const events = world.eventLog || []
    if (this.eventIndex > events.length) this.eventIndex = 0
    for (; this.eventIndex < events.length; this.eventIndex++) {
      const event = events[this.eventIndex], id = event.playerId ?? event.by
      const visual = this.visuals.get(id)
      if (visual && event.type === 'shot' && visual.shotTick !== tick) this.fire(visual, tick)
      if (visual && event.type === 'player_damage') visual.rig.hit = 1
    }
    this.fx?.update(dt)
  }
  syncVisual(visual, player, dt, time) {
    visual.object.position.set(player.pos.x, player.pos.y, player.pos.z)
    visual.object.rotation.y = player.yaw || 0
    selectPlayerWeapon(visual.weapon, typeof player.weapon === 'string' ? player.weapon : player.weapon?.id || player.activeWeapon)
    visual.cooldown = Math.max(0, visual.cooldown - dt)
    const firing = player.alive !== false && !player.downed && player.hp > 0 && Boolean(player.firing)
    const stateShot = firing && (!visual.lastFiring || visual.cooldown <= 0)
    if (stateShot) visual.rig.recoil = 1
    animatePlayer(visual.rig, player, visual.weapon, dt, time)
    if (stateShot) this.fire(visual, this.world?.tick || 0)
    visual.lastFiring = firing
  }
  fire(visual, tick) {
    if (visual.rig.death || visual.rig.downed > .1) return
    visual.rig.recoil = 1; visual.shotTick = tick
    const id = visual.weapon.id
    const rate = this.world?.weaponCatalog?.weapons?.[id]?.rate
    visual.cooldown = rate > 0 ? 1 / rate : ({m4: .1, plasma: .24, shotgun: .8, pistol: .25}[id] || .5)
    if (['knife', 'grenade'].includes(id)) return
    visual.object.updateMatrixWorld(true)
    visual.weapon.active.muzzle.getWorldPosition(this.from)
    visual.weapon.active.muzzle.getWorldDirection(this.direction).negate()
    this.to.copy(this.from).addScaledVector(this.direction, 8)
    this.fx.shot(this.from, this.to, id === 'plasma' ? 'endo' : 'heavy')
  }
  removeVisual(visual) { disposePlayerRig(visual.rig); visual.object.removeFromParent() }
  stop() {
    if (this.onKey) window.removeEventListener('keydown', this.onKey)
    if (this.onRender) this.viewer.removeEventListener('preRender', this.onRender)
    this.autoSync = null; this.onKey = null; this.onRender = null
    this.showcase?.stop(); this.showcase = null
    for (const visual of this.visuals.values()) this.removeVisual(visual)
    this.visuals.clear()
    this.weapons?.stop(); this.weapons = null
    this.fx?.dispose(); this.fx = null
    this.owner?.cleanup(); this.owner = null; this.root = null; this.world = null; this.materials = null; this.runtimeTemplate = null; this.template = null
  }
}

export function playerEntries(players) {
  return players instanceof Map ? [...players] : Object.entries(players || {})
}

// Three-line GameManager integration; direct users can call sync themselves.
export function mountPlayersView(viewer, world, getLocalPlayerId) {
  const view = new PlayersView(viewer)
  view.start(world, getLocalPlayerId())
  view.autoSync = () => { view.localPlayerId = getLocalPlayerId(); view.sync() }
  return view
}
