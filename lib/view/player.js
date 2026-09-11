import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh2,
  PlaneGeometry,
  UnlitMaterial,
  Vector3,
} from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'

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
    this.flashTicks = 0
    this.offset = new Vector3()
  }

  start(world) {
    this.stop()
    const source = findAuthored(this.viewer.scene.modelRoot, 'Player Start')
    if (!source) throw new Error('Player Start authored node not found')
    this.owner = new RuntimeObjectOwner('terminator-player-view')
    this.root = this.owner.attachRuntimeRoot(new Group(), this.viewer.scene, source)
    this.root.name = 'Player Runtime'
    this.buildWeapon()
    this.takeCamera()
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

  buildWeapon() {
    const gun = new Group()
    gun.name = 'First Person Weapon'
    const dark = new UnlitMaterial({color: new Color(0x121a22)})
    const steel = new UnlitMaterial({color: new Color(0x53616e)})
    const accent = new UnlitMaterial({color: new Color(0xc92727)})
    const add = (name, size, pos, material) => {
      const mesh = new Mesh2(new BoxGeometry(...size), material)
      mesh.name = name
      mesh.position.set(...pos)
      mesh.raycast = () => {}
      gun.add(mesh)
    }
    add('Pistol Slide', [0.12, 0.1, 0.5], [0, 0.03, -0.12], steel)
    add('Pistol Barrel', [0.065, 0.06, 0.42], [0, 0.04, -0.39], dark)
    add('Pistol Grip', [0.1, 0.27, 0.14], [0, -0.15, 0.03], dark)
    add('Pistol Sight', [0.025, 0.03, 0.05], [0, 0.095, -0.26], accent)
    const flash = new Mesh2(new PlaneGeometry(0.2, 0.2), new UnlitMaterial({
      color: new Color(0xffd17a), transparent: true, opacity: 0.95, blending: AdditiveBlending,
      depthWrite: false, side: DoubleSide,
    }))
    flash.name = 'Player Muzzle Flash'
    flash.position.set(0, 0.04, -0.62)
    flash.visible = false
    flash.raycast = () => {}
    gun.add(flash)
    gun.scale.setScalar(0.8)
    this.root.add(gun)
    this.gun = gun
    this.flash = flash
  }

  sync(world) {
    const camera = this.camera
    if (!camera) return
    const player = world.player
    const eye = player.crouch ? 1.12 : 1.65
    camera.position.set(player.pos.x, player.pos.y + eye, player.pos.z)
    camera.rotation.set(player.pitch, player.yaw + Math.PI, 0)
    camera.updateMatrixWorld()
    camera.setDirty?.({source: 'Terminator PlayerView'})
    if (this.gun) {
      this.offset.set(0.3, -0.25, -0.65).applyQuaternion(camera.quaternion)
      this.gun.position.copy(camera.position).add(this.offset)
      this.gun.quaternion.copy(camera.quaternion)
    }
    for (; this.eventIndex < world.eventLog.length; this.eventIndex += 1) {
      const event = world.eventLog[this.eventIndex]
      if (event.type === 'shot' && event.by === 'player') this.flashTicks = 4
    }
    if (this.flash) {
      this.flash.visible = this.flashTicks > 0
      if (this.flashTicks > 0) {
        this.flash.rotation.z = (world.tick % 11) / 11 * Math.PI
        this.flashTicks -= 1
      }
    }
  }

  stop() {
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
    this.flashTicks = 0
  }
}

function findAuthored(root, name) {
  return root.getObjectByName(name) || root.getObjectByName(name.replaceAll(' ', '_'))
}
