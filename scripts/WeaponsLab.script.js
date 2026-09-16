import {weaponSurfaceMaps} from '../lib/view/weapons-materials.js'
import {bulletMaps} from '../lib/view/bullet-batch.js'
import {bindBulletPresentation} from '../lib/view/bullets.js'
import * as E from 'threepipe'
import {World} from '../lib/core/world.js'
import {WaveDirector} from '../lib/core/waves.js'
import {WeaponsRange} from '../lib/core/range.js'
import {projectViewModel} from '../lib/core/viewmodel.js'
import {PlayerView} from '../lib/view/player.js'
import {UnitView} from '../lib/view/units.js'
import {GrenadeView} from '../lib/view/grenade.js'
import {CameraFeel} from '../lib/view/camera-feel.js'
import {InputController} from '../lib/view/input.js'
import {RangeView} from '../lib/view/range.js'
import {LabEnvironment} from '../lib/view/lab-environment.js'
import {createLabMap, labTargetLayout, LAB_PLATES} from '../lib/view/lab-layout.js'
import {Hud} from '../lib/ui/hud.js'
import {WeaponsLabSession} from '../lib/ui/lab-session.js'

export function bootLabWorld(seed = 2029) {
  const world = new World({map: createLabMap(), seed})
  const director = new WaveDirector(world)
  const range = new WeaponsRange(world, director); range.layout = labTargetLayout(); range.start()
  director.pauseWaves()
  return {world, director, range}
}
export function labRangeProps(modelRoot) {
  return {plates: LAB_PLATES.map((spec, index) => {
    const stand=modelRoot.getObjectByName(`Plate ${index + 1}`)||modelRoot.getObjectByName(`Plate_${index + 1}`)
    const pivot=stand?.getObjectByName('Plate Pivot')||stand?.getObjectByName('Plate_Pivot')
    if(!pivot)throw new Error(`Plate ${index + 1} placed asset is missing Plate Pivot`)
    return {...spec,pivot,lastHit:-Infinity,hits:0}
  })}
}
export class WeaponsLab extends E.Object3DComponent {
  static ComponentType = 'WeaponsLab'
  static StateProperties = [{key: 'seed', type: 'number'}]
  seed = 2029
  start() {
    this.stop()
    const viewer = this.ctx.viewer
    this.hiddenUnitSources = []
    viewer.scene.modelRoot.traverse(object => {
      if (!object.userData?.rootPath?.startsWith('/kite3d/@unit-')) return
      this.hiddenUnitSources.push([object, object.visible])
      object.visible = false
    })
    Object.assign(this, bootLabWorld(this.seed))
    this.localPlayerId = this.world.player.id; this.sessionMode = 'single'
    this.mapView = new LabEnvironment(viewer); this.mapView.start()
    this.unitView = new UnitView(viewer); this.unitView.start(this.world)
    // Keep the unit showcase shortcut confined to the normal game.
    window.removeEventListener('keydown', this.unitView.onKey)
    this.playerView = new PlayerView(viewer)
    const source = viewer.scene.modelRoot.getObjectByName('Firing_Line')
    this.playerView.start(this.world, source)
    // PlayerView applies the same rebuilt-revolver default and URL overrides as the game.
    this.mapView.bindWeapon(this.playerView.weapons.materials)
    this.grenadeView = new GrenadeView(viewer); this.grenadeView.start(this.world, this.playerView.weapons.material, source)
    this.cameraFeel = new CameraFeel(); this.input = new InputController(viewer); this.hud = new Hud(viewer)
    this.rangeView = new RangeView(this, {source: viewer.scene.modelRoot.getObjectByName('Range'),
      props: labRangeProps(viewer.scene.modelRoot), lighting: this.mapView})
    this.rangeView.lighting = 'overcast'
    this.ui = new WeaponsLabSession(this)
    this.started = true; this.syncViews()
    const environment = this.mapView
    this.ready = Promise.all([environment.ready, weaponSurfaceMaps().ready, bulletMaps().ready]).then(() => {
      if (this.mapView === environment) this.playerView.weapons.material.needsUpdate = true
    }).catch(error => {if (this.mapView === environment) console.error('[Weapons Lab] Environment load failed', error)})
  }
  update({deltaTime = 0} = {}) {
    if (!this.started) return
    const ticks = this.capturePaused ? 0 : this.range.clock.takeTicks(deltaTime)
    for (let i = 0; i < ticks; i++) {
      this.director.pauseWaves(); this.director.step(this.ui.sample()); this.range.afterStep(); this.cameraFeel.consume(this.world)
    }
    this.syncViews(); return true
  }
  syncViews() {
    if (!this.started) return
    const bullets=bindBulletPresentation(this)
    this.mapView.sync(); this.playerView.sync(this.world); this.unitView.sync(this.world); bullets?.flush()
    this.grenadeView.sync(this.world); this.cameraFeel.apply(this.playerView.camera, this.world.time)
    this.rangeView.sync(this.world); this.ui.sync(projectViewModel(this.world))
    this.ctx.viewer.setDirty()
  }
  preFrame() {this.hud?.sync()}
  stop() {
    this.started = false
    this.ui?.dispose(); this.ui = null
    this.rangeView?.dispose(); this.rangeView = null
    this.input?.stop(); this.input = null; this.cameraFeel?.dispose(); this.cameraFeel = null
    this.hud?.dispose(); this.hud = null
    this.grenadeView?.stop(); this.grenadeView = null
    this.playerView?.stop(); this.playerView = null
    const cached = this.unitView?.materials?.metal
    const extensions = cached?.materialExtensions?.filter(extension => extension.uuid === 'SSAOPlugin') || []
    if (extensions.length) cached.unregisterMaterialExtensions(extensions)
    this.unitView?.stop(); this.unitView = null
    this.mapView?.stop(); this.mapView = null
    for (const [source, visible] of this.hiddenUnitSources || []) source.visible = visible
    this.hiddenUnitSources = null
    this.world?.destroy(); this.world = null; this.range = null; this.director = null
  }
  destroy() {this.stop(); return super.destroy()}
}
