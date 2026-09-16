import * as E from 'threepipe'
import {LAB_LIGHTS} from './lab-layout.js'
import {MapPost} from './post.js'

export class LabEnvironment {
  constructor(viewer) {this.viewer = viewer; this.hidden = []; this.lights = {}}
  start() {
    this.stop()
    const scene = this.viewer.scene
    this.root = new E.Group()
    scene.add(this.root)
    this.root.name = 'Lab environment runtime'
    this.saved = {background: scene.background, environment: scene.environment, fog: scene.fog,
      autoDisposeSceneMaps: scene.autoDisposeSceneMaps, environmentIntensity: scene.environmentIntensity}
    scene.autoDisposeSceneMaps = false; scene.background = new E.Color(0x303941); scene.fog = null
    this.tonemap = this.viewer.getPlugin(E.TonemapPlugin); this.exposure = this.tonemap.exposure
    for (const [id, spec] of Object.entries(LAB_LIGHTS)) {
      const source = scene.modelRoot.getObjectByName(spec.name)
      const light = source.clone(); this.root.add(light)
      source.getWorldPosition(light.position); source.getWorldQuaternion(light.quaternion)
      // glTF directional lights carry an attached target. Preserve that direction after cloning.
      if (light.target && source.target) {light.target = source.target.clone(); source.target.getWorldPosition(light.target.position); this.root.add(light.target)}
      light.visible = false; this.lights[id] = light
      this.hidden.push([source, source.visible]); source.visible = false
    }
    this.key = this.lights.overcast
    this.fill = new E.HemisphereLight(0xd3e4fa, 0x343838, 1.4); this.root.add(this.fill)
    for (const source of scene.modelRoot.children) {
      if (/^Targets_/.test(source.name)||source.userData?.unitTemplateType) {this.hidden.push([source, source.visible]); source.visible = false}
    }
    this.post = new MapPost(this.viewer); this.post.start(); this.post.settings.motionBlur = false
    this.setLighting('overcast')
    const active = this.root
    this.ready = this.viewer.import(new URL('../../assets/hdri/qwantani_moon_noon_puresky_2k.hdr', import.meta.url).href).then(texture => {
      if (this.root !== active) {texture.dispose(); return}
      this.environment = texture; scene.environment = texture; scene.environmentIntensity = .4; this.viewer.setDirty()
    })
  }
  setLighting(id) {
    if (!LAB_LIGHTS[id]) return false
    for (const [key, light] of Object.entries(this.lights)) light.visible = key === id
    this.lighting = id
    this.fill.intensity = id === 'night' ? .35 : id === 'noon' ? 1.1 : 1.7
    this.tonemap.exposure = LAB_LIGHTS[id].exposure
    this.viewer.renderManager.resetShadows(); this.viewer.setDirty(); return true
  }
  sync() {this.post?.sync()}
  bindWeapon(materials) {
    if(this.onRender)this.viewer.removeEventListener('preRender',this.onRender)
    for(const previous of this.weaponMaterials||[])previous.unregisterMaterialExtensions([this.weaponExtension])
    const material=Array.isArray(materials)?materials[0]:materials
    this.weaponMaterials=Array.isArray(materials)?materials:[materials]
    this.weaponMaterial = material
    this.weaponLight = {color: {value: new E.Color()}, direction: {value: new E.Vector3()}, fill: {value: new E.Color()}}
    const uniforms = this.weaponLight
    this.weaponExtension = {
      uuid: 'lab-authored-weapon-light', computeCacheKey: 'lab-authored-weapon-light-v1', priority: -10,
      extraUniforms: {labLightColor: uniforms.color, labLightDirection: uniforms.direction, labFill: uniforms.fill},
      parsFragmentSnippet: 'uniform vec3 labLightColor; uniform vec3 labLightDirection; uniform vec3 labFill;',
      shaderExtender(shader) {
        shader.fragmentShader = shader.fragmentShader
          .replace('directLight.color = vec3(2.8, 3.1, 3.5);', 'directLight.color = labLightColor;')
          .replace('directLight.direction = normalize(vec3(-0.5, 0.8, 0.7));', 'directLight.direction = labLightDirection;')
          .replace('vec3 irradiance = vec3(0.22, 0.26, 0.31);', 'vec3 irradiance = labFill;')
      },
    }
    for(const m of this.weaponMaterials)m.registerMaterialExtensions([this.weaponExtension])
    this.onRender = () => {
      const light = this.lights[this.lighting], camera = this.viewer.scene.mainCamera
      uniforms.color.value.copy(light.color).multiplyScalar(light.intensity * 1.6)
      light.getWorldDirection(uniforms.direction.value).transformDirection(camera.matrixWorldInverse)
      uniforms.fill.value.copy(this.fill.color).multiplyScalar(this.fill.intensity * .28)
    }
    this.viewer.addEventListener('preRender', this.onRender)
  }
  stop() {
    if (!this.root) return
    if (this.onRender) this.viewer.removeEventListener('preRender', this.onRender)
    for(const m of this.weaponMaterials||[])m.unregisterMaterialExtensions([this.weaponExtension])
    this.post?.stop(); this.post = null
    for (const [source, visible] of this.hidden) source.visible = visible
    this.hidden = []
    Object.assign(this.viewer.scene, this.saved); this.tonemap.exposure = this.exposure
    this.environment?.dispose(); this.environment = null
    this.root.traverse(object => {if (object.isLight) object.shadow?.dispose?.()})
    this.root.removeFromParent(); this.root = null
    this.saved = null; this.tonemap = null; this.lights = {}; this.fill = null; this.key = null
    this.weaponMaterials = null; this.weaponMaterial = null; this.weaponExtension = null; this.onRender = null
  }
}
