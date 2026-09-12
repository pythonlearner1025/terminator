import * as E from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'
import {createUnitFigure} from '../../generators/unit-template.generator.js'
import {bindUnitRig,animateUnit} from './units-animation.js'

const MAPS = ['albedo', 'normal', 'roughness', 'metalness', 'ao', 'emissive']
const STAGE_Y = 80

// A view of the authored Endo source. No World access and no gameplay mutations.
export class MenuScene {
  constructor(viewer) {
    this.viewer = viewer
    this.cursor = {x:0, y:0}
    this.materials = new Set()
    this.textures = []
    this.onPointer = event => {
      const box = viewer.canvas.getBoundingClientRect()
      this.cursor.x = Math.max(-1, Math.min(1, (event.clientX-box.left)/box.width*2-1))
      this.cursor.y = Math.max(-1, Math.min(1, (event.clientY-box.top)/box.height*2-1))
    }
    this.onRender = () => this.render()
    window.addEventListener('pointermove', this.onPointer)
    viewer.addEventListener('preRender', this.onRender)
  }

  async load(progress) {
    this.setActive(false)
    this.figure?.traverse(child=>{if(child.isSkinnedMesh)child.skeleton.dispose()})
    this.owner?.cleanup();this.owner=null;this.root=null
    for (const texture of this.textures) texture.dispose()
    this.textures = []
    let completed = 0
    const loader = new E.TextureLoader()
    const tasks = MAPS.map(async name => {
      const texture = await loader.loadAsync(new URL(`../../assets/store/materials/steel-${name}.png`, import.meta.url).href)
      if (this.disposed) { texture.dispose(); return }
      texture.wrapS = texture.wrapT = E.RepeatWrapping
      texture.anisotropy = 4
      texture.colorSpace = name === 'albedo' || name === 'emissive' ? E.SRGBColorSpace : E.NoColorSpace
      this.textures.push(texture)
      progress(++completed, MAPS.length + 1)
      return [name, texture]
    })
    tasks.push(document.fonts.load('600 24px Barlow').then(() => { progress(++completed, MAPS.length+1) }))
    const settled = await Promise.allSettled(tasks)
    if (this.disposed) return
    const failure = settled.find(item => item.status === 'rejected')
    if (failure) throw failure.reason
    this.maps = Object.fromEntries(settled.slice(0, MAPS.length).map(item => item.value))
    this.build()
  }

  build() {
    const source = this.viewer.scene.modelRoot.getObjectByName('Unit Template Endo')
      || this.viewer.scene.modelRoot.getObjectByName('Unit_Template_Endo')
    if (!source) throw new Error('Endo template unavailable')
    this.owner = new RuntimeObjectOwner('terminator-menu-stage')
    this.root = this.owner.attachRuntimeRoot(new E.Group(), this.viewer.scene, source)
    this.root.name = 'Endo menu stage'
    this.root.position.y = STAGE_Y
    this.root.visible = false

    // Current authored templates are bounded previews. Use their full runtime figure
    // until a detailed template replaces the preview; then clone its actual skeleton.
    const figureSource = source.children.find(child => child.userData.unitTemplateType === 'endo')
    const detailed = figureSource && !figureSource.userData.unitAnatomy?.preview
    this.figure = detailed ? cloneSkeleton(figureSource) : createUnitFigure(E, 'endo')
    this.figure.name = 'Menu T-800 Endo'
    this.figure.position.set(.83, 0, 0)
    this.figure.rotation.y = -.16
    const maps = this.maps
    const steel = new E.PhysicalMaterial({name:'Menu worn steel', color:0xffffff, vertexColors:true,
      map:maps.albedo, normalMap:maps.normal, roughnessMap:maps.roughness, metalnessMap:maps.metalness,
      aoMap:maps.ao, metalness:1, roughness:.58, normalScale:new E.Vector2(.12,.12), envMapIntensity:.9})
    // Bind the reflection environment only once it has loaded. Binding the empty texture first
    // compiles the PBR shader with invalid cube UV defines and the material fails to validate.
    this.stageEnvironment = new E.RGBELoader().load(new URL('../../assets/textures/units/studio_small_09_1k.hdr', import.meta.url).href, (texture) => {
      texture.mapping = E.EquirectangularReflectionMapping
      for (const material of this.materials) {
        if (material.isMeshStandardMaterial || material.isPhysicalMaterial || 'envMap' in material) { material.envMap = texture; material.needsUpdate = true }
      }
    })
    this.figure.traverse(child => {
      // Clones never execute authored components in Play.
      for (const key of ['EntityComponentPlugin','kite3dGenerated','kite3dAuthoring']) delete child.userData[key]
      if (!child.material) return
      if (child.isSkinnedMesh || child.name === 'Combined articulated steel') {
        // Clone the reflection texture so stage cleanup cannot dispose the unit renderer's cache.
        child.material = steel
      } else if (/Bloom|Heat/.test(child.name)) {
        child.material = new E.UnlitMaterial({name:'Menu optic glow', map:maps.emissive, color:0xff1606,
          blending:E.AdditiveBlending, transparent:true, depthWrite:false, side:E.DoubleSide})
      } else {
        child.material = new E.PhysicalMaterial({name:'Menu optical lens', map:maps.albedo,
          normalMap:maps.normal, roughnessMap:maps.roughness, metalnessMap:maps.metalness, aoMap:maps.ao,
          color:0x310000, roughness:.2, metalness:.2, emissive:0xff1504, emissiveMap:maps.emissive, emissiveIntensity:7})
      }
      this.materials.add(child.material)
    })
    this.root.add(this.figure)
    this.rig=this.figure.getObjectByName('Pelvis')?bindUnitRig(this.figure):null
    this.pose={type:'endo',alive:true,pos:{x:0,y:0,z:0},intent:{aimAt:{x:0,y:.6,z:3}}}
    this.head = this.figure.getObjectByName('Head')
    this.chest = this.figure.getObjectByName('Chest')
    this.eyes = ['Eye Left','Eye Right'].map(name => this.figure.getObjectByName(name)).filter(Boolean)
    this.eyeOrigins = this.eyes.map(eye => eye.position.clone())
    const floorMaterial = new E.PhysicalMaterial({name:'Wet steel stage', map:maps.albedo, normalMap:maps.normal,
      roughnessMap:maps.roughness, metalnessMap:maps.metalness, aoMap:maps.ao, color:0x030608,
      roughness:.95, metalness:.3, normalScale:new E.Vector2(.15,.15), envMapIntensity:.08})
    this.materials.add(floorMaterial)
    const floor = new E.Mesh2(new E.CylinderGeometry(2.8,2.9,.08,64), floorMaterial)
    floor.name = 'Menu wet deck'; floor.position.set(.83,-.09,0)
    this.root.add(floor)
    const fill = new E.HemisphereLight(0x9dcfff, 0x090e17, 2.4)
    const key = new E.DirectionalLight(0xd7e6ef, 7); key.position.set(-3,4,4)
    const front = new E.PointLight(0xbfd9ff, 18, 9, 2); front.position.set(.2,1.6,2.6)
    const rim = new E.DirectionalLight(0x64b8ff, 5.5); rim.position.set(3,3,-2)
    const red = new E.PointLight(0xff230b, 15, 8, 2); red.position.set(-1,1.5,-1)
    for (const light of [key, rim]) {light.target.position.set(.83,1,0); this.root.add(light.target)}
    this.root.add(fill, key, rim, red, front)
    this.rain = this.particles(230, true)
    this.embers = this.particles(48, false)
  }

  particles(count, rain) {
    const positions = new Float32Array(count * (rain ? 6 : 3))
    let seed = rain ? 800 : 2029
    const rand = () => ((seed = (Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
    const seeds = Array.from({length:count}, () => ({x:(rand()-.5)*8,y:rand()*6,z:(rand()-.5)*5,speed:.6+rand()}))
    const geometry = new E.BufferGeometry()
    geometry.setAttribute('position',new E.BufferAttribute(positions,3))
    const material = rain
      ? new E.LineBasicMaterial({color:0x97bfd5, transparent:true, opacity:.16, depthWrite:false})
      : new E.PointsMaterial({color:0xff6b24, map:this.maps.emissive, transparent:true, opacity:.75,
        blending:E.AdditiveBlending, size:.028, depthWrite:false})
    const object = rain ? new E.LineSegments(geometry,material) : new E.Points(geometry,material)
    object.name = rain ? 'Menu rain' : 'Menu embers'
    object.frustumCulled = false
    this.root.add(object)
    return {object, positions, seeds, rain}
  }

  setActive(active) {
    active = Boolean(active && this.root && !this.disposed)
    if (this.active === active) return
    this.active = active
    if (this.root) this.root.visible = active
    if (active) {
      const camera = this.viewer.scene.mainCamera
      this.saved = {camera,position:camera.position.clone(),quaternion:camera.quaternion.clone(),
        target:camera.target?.clone(),fov:camera.fov,near:camera.near,far:camera.far,
        controlsMode:camera.controlsMode,autoLookAtTarget:camera.autoLookAtTarget,autoNearFar:camera.autoNearFar}
      this.savedFog = this.viewer.scene.fog
      this.viewer.scene.fog = new E.Fog(0x020609,3.8,10)
      camera.controlsMode = ''; camera.autoLookAtTarget = false
      camera.autoNearFar = false
      camera.fov = 36; camera.near = .04; camera.far = 40
      camera.updateProjectionMatrix()
      this.startedAt = performance.now()
      this.render()
    } else if (this.saved) {
      const {camera,position,quaternion,target,...properties} = this.saved
      camera.position.copy(position); camera.quaternion.copy(quaternion)
      if (target) camera.target.copy(target)
      Object.assign(camera,properties); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
      camera.setDirty?.()
      this.viewer.scene.fog = this.savedFog
      this.savedFog = undefined
      this.saved = null
    }
    this.viewer.setDirty()
  }

  render() {
    if (!this.active || !this.saved) return
    const time = (performance.now()-this.startedAt)/1000
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1
    const dt=Math.min(.05,Math.max(0,time-(this.lastTime ?? time)))
    this.lastTime=time
    if(this.rig)animateUnit(this.rig,this.pose,dt,time*motion)
    const camera = this.saved.camera
    const aspect = camera.aspect || (this.viewer.canvas.clientWidth/Math.max(1,this.viewer.canvas.clientHeight))
    // Wide views keep the figure on the right of the menu text; tall views center it and pull back.
    const shift = aspect >= 1.2 ? .08 : .83
    const distance = aspect >= 1.2 ? 3.9 : 3.9 + (1.2-aspect)*2.4
    camera.position.set(shift+this.cursor.x*.018*motion, STAGE_Y+1.45-this.cursor.y*.012*motion, distance)
    camera.lookAt(shift,STAGE_Y+1.05,0)
    camera.updateMatrixWorld(true)
    if (this.head) {this.head.rotation.y = this.cursor.x*.15; this.head.rotation.x = this.cursor.y*.07}
    if (this.chest) this.chest.rotation.z = Math.sin(time*.8)*.006*motion
    this.eyes.forEach((eye,index) => {
      eye.position.copy(this.eyeOrigins[index]); eye.position.x += this.cursor.x*.003; eye.position.y -= this.cursor.y*.002
    })
    for (const particles of [this.rain, this.embers]) {
      const {positions,seeds,rain} = particles
      seeds.forEach((seed,i) => {
        const offset = i*(rain?6:3)
        const y = rain ? 5-((seed.y+time*seed.speed*4*motion)%6) : (seed.y+time*seed.speed*.16*motion)%5
        const x = seed.x+(rain ? -.08*y : Math.sin(time*.3+i)*.12*motion)
        positions.set([x,y,seed.z],offset)
        if (rain) positions.set([x+.012,y+.16,seed.z],offset+3)
      })
      particles.object.geometry.attributes.position.needsUpdate = true
    }
    this.figure.updateMatrixWorld(true)
    this.viewer.setDirty()
  }

  dispose() {
    this.setActive(false)
    this.disposed = true
    window.removeEventListener('pointermove',this.onPointer)
    this.viewer.removeEventListener('preRender',this.onRender)
    this.figure?.traverse(child=>{if(child.isSkinnedMesh)child.skeleton.dispose()})
    this.owner?.cleanup()
    for (const texture of this.textures) texture.dispose()
    this.materials.clear()
    this.root = null
  }
}

function cloneSkeleton(source) {
  const clone = source.clone(true)
  const original = [], copies = []
  source.traverse(child => original.push(child)); clone.traverse(child => copies.push(child))
  const map = new Map(original.map((child,index) => [child,copies[index]]))
  for (const child of original) if (child.isSkinnedMesh) {
    const copy = map.get(child)
    copy.skeleton = child.skeleton.clone()
    copy.skeleton.bones = child.skeleton.bones.map(bone => map.get(bone))
    copy.bind(copy.skeleton,child.bindMatrix)
  }
  return clone
}
