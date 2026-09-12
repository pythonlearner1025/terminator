import {Group} from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'
import {WeaponView} from './weapons.js'
import {AIM_VIEW} from './weapons-animation.js'
import {syncAimInput} from './input.js'

export class PlayerView {
  constructor(viewer) {
    this.viewer = viewer
    this.owner = null
    this.root = null
    this.gun = null
    this.flash = null
    this.camera = null
    this.savedCamera = null
    this.eventIndex = 0
    this.weapons = null
    this.onRender = null
  }

  start(world) {
    this.stop()
    const source = findAuthored(this.viewer.scene.modelRoot, 'Player Start')
    if (!source) throw new Error('Player Start authored node not found')
    this.owner = new RuntimeObjectOwner('terminator-player-view')
    this.root = this.owner.attachRuntimeRoot(new Group(), this.viewer.scene, source)
    this.root.name = 'Player Runtime'
    this.weapons = new WeaponView(this.root,this.viewer)
    this.gun = this.weapons.root
    this.takeCamera()
    this.onRender = () => this.weapons?.beforeRender(this.camera)
    this.viewer.addEventListener('preRender', this.onRender)
    this.eventIndex = world.eventLog.length
    this.sync(world)
  }

  takeCamera() {
    const camera = this.viewer.scene.mainCamera
    this.camera = camera
    this.savedCamera = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      order: camera.rotation.order,
      controlsMode: camera.controlsMode,
      autoLookAtTarget: camera.autoLookAtTarget,
      autoNearFar: camera.autoNearFar,
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
    }
    camera.controlsMode = ''
    camera.autoLookAtTarget = false
    camera.autoNearFar = false
    camera.near = 0.05
    camera.far = 180
    camera.fov = 72
    camera.rotation.order = 'YXZ'
    camera.updateProjectionMatrix()
    camera.activateMain?.()
  }

  sync(world) {
    const camera = this.camera
    if (!camera) return
    const player = world.player
    const eye = player.crouch ? 1.12 : 1.65
    camera.position.set(player.pos.x, player.pos.y + eye, player.pos.z)
    camera.rotation.set(player.pitch, player.yaw + Math.PI, 0)
    this.weapons?.sync(world)
    const baseFov=syncAimInput(this.viewer,player.aiming)
    if(this.weapons)this.weapons.baseFov=baseFov
    const aim=this.weapons?.animation.aimAmount || 0
    camera.fov=baseFov+(AIM_VIEW.fov-baseFov)*aim
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    camera.setDirty?.({source: 'Terminator PlayerView'})
  }

  stop() {
    syncAimInput(this.viewer,false)
    if (this.onRender) this.viewer.removeEventListener('preRender', this.onRender)
    this.onRender = null
    this.weapons?.dispose()
    this.weapons = null
    const camera = this.camera
    const saved = this.savedCamera
    if (camera && saved) {
      camera.rotation.order = saved.order
      camera.position.copy(saved.position)
      camera.quaternion.copy(saved.quaternion)
      camera.controlsMode = saved.controlsMode
      camera.autoLookAtTarget = saved.autoLookAtTarget
      camera.autoNearFar = saved.autoNearFar
      camera.fov = saved.fov
      camera.near = saved.near
      camera.far = saved.far
      camera.updateProjectionMatrix()
      camera.activateMain?.()
      camera.setDirty?.({source: 'Terminator PlayerView'})
    }
    this.camera = null
    this.savedCamera = null
    this.owner?.cleanup()
    this.owner = null
    this.root = null
    this.gun = null
    this.flash = null
    this.eventIndex = 0
  }
}

function findAuthored(root, name) {
  return root.getObjectByName(name) || root.getObjectByName(name.replaceAll(' ', '_'))
}
