import {InstancedMesh, InstancedBufferAttribute, DynamicDrawUsage, LatheGeometry, SphereGeometry,
  PhysicalMaterial, TextureLoader, SRGBColorSpace, Vector2, Vector3, Object3D, Color} from 'threepipe'
import {releaseMesh} from './mesh-release.js'

let maps
export function bulletMaps() {
  if (maps) return maps
  maps = {}; const loader = new TextureLoader(), pending = []
  for (const name of ['albedo','normal','roughness','metalness','ao','emissive']) {
    const url = new URL(`../../assets/textures/bullets/bullet-${name}.png`, import.meta.url).href
    pending.push(new Promise((resolve,reject) => {
      maps[name] = loader.load(url,resolve,undefined,reject)
      maps[name].name = `Bullet ${name}`
      if (name === 'albedo' || name === 'emissive') maps[name].colorSpace = SRGBColorSpace
    }))
  }
  maps.ready = Promise.all(pending)
  return maps
}
function material() {
  const m = bulletMaps()
  return new PhysicalMaterial({name:'Worn copper jacket and hot base', map:m.albedo, normalMap:m.normal,
    roughnessMap:m.roughness, metalnessMap:m.metalness, aoMap:m.ao, emissiveMap:m.emissive,
    color:0xffffff, metalness:1, roughness:1, emissive:0xffffff, emissiveIntensity:1,
    normalScale:new Vector2(.3,.3)})
}
const FORWARD = new Vector3(0,0,1)

// Real volume, depth testing, surface normals and instance transforms. No screen-length floor.
export class BulletBatch {
  constructor(parent, capacity, resources = {}) {
    this.capacity = capacity; this.count = 0
    this.temp = new Object3D(); this.color = new Color(); this.position = new Vector3()
    const profile = [[0,-1],[.4,-1],[.5,-.88],[.5,-.3],[.41,-.15],[.2,-.035],[0,0]]
    const geometry = new LatheGeometry(profile.map(p => new Vector2(...p)),12).rotateX(Math.PI/2)
    geometry.setAttribute('uv1',geometry.attributes.uv.clone())
    const bodyMaterial = resources.material || material()
    bodyMaterial.userData.ssaoDisabled=true;bodyMaterial.userData.ssaoCastDisabled=true;bodyMaterial.userData.renderToGBuffer=false
    this.glow = new Float32Array(capacity*4)
    geometry.setAttribute('bulletGlow',new InstancedBufferAttribute(this.glow,4).setUsage(DynamicDrawUsage))
    bodyMaterial.registerMaterialExtensions([{
      uuid:'bullet-hot-base', computeCacheKey:'bullet-hot-base-v2',
      parsVertexSnippet:'attribute vec4 bulletGlow; varying vec4 vBulletGlow;',
      parsFragmentSnippet:'varying vec4 vBulletGlow;',
      shaderExtender(shader) {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBulletGlow=bulletGlow;')
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vBulletGlow.a < 0.0 ? vBulletGlow.rgb * -vBulletGlow.a * (0.3 + totalEmissiveRadiance) : totalEmissiveRadiance * vBulletGlow.rgb * vBulletGlow.a;')
      },
    }])
    this.mesh = new InstancedMesh(geometry,bodyMaterial,capacity)
    this.mesh.name = 'Instanced bullet bodies'
    const trailGeometry = new SphereGeometry(.5,8,4).translate(0,0,-.5)
    trailGeometry.setAttribute('uv1',trailGeometry.attributes.uv.clone())
    const trailMaterial = bodyMaterial.clone()
    trailMaterial.unregisterMaterialExtensions(trailMaterial.materialExtensions.slice())
    trailMaterial.name = 'Faint bullet heat wake'; trailMaterial.transparent = true
    trailMaterial.opacity = .055; trailMaterial.depthWrite = false; trailMaterial.metalness = 0
    trailMaterial.emissive.setRGB(.55,.35,.13); trailMaterial.emissiveIntensity = .3
    this.trail = new InstancedMesh(trailGeometry,trailMaterial,capacity)
    this.trail.name = 'Short bullet heat wakes'
    this.meshes = [this.mesh,this.trail]
    for (const mesh of this.meshes) {
      mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.count = 0; mesh.visible = false
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      for (let i=0;i<capacity;i++) mesh.setColorAt(i,this.color)
      mesh.instanceColor.setUsage(DynamicDrawUsage)
      parent.add(mesh)
    }
    this.positions = new Float32Array(capacity*3)
  }
  begin() {this.count = 0}
  add(position,direction,style,speed=style.speed,timeScale=1,travel=Infinity) {
    if (this.count >= this.capacity) return false
    const index = this.count++, k = index*3, g = index*4
    this.positions[k] = position.x; this.positions[k+1] = position.y; this.positions[k+2] = position.z
    const stretch = Math.min(style.length*.4,Math.max(0,speed)*.0006*timeScale)
    const length = Math.min(style.length+stretch,Math.max(style.length*.1,travel))
    this.temp.position.copy(position); this.temp.quaternion.setFromUnitVectors(FORWARD,direction)
    this.temp.scale.set(style.width,style.width,length); this.temp.updateMatrix()
    this.mesh.setMatrixAt(index,this.temp.matrix)
    this.color.setRGB(style.color[0],style.color[1],style.color[2]); this.mesh.setColorAt(index,this.color)
    this.glow[g] = style.hot[0]; this.glow[g+1] = style.hot[1]; this.glow[g+2] = style.hot[2]; this.glow[g+3] = style.plasma ? -style.emissive : style.emissive
    this.temp.position.addScaledVector(direction,-length)
    this.temp.scale.set(style.width*.55,style.width*.55,Math.min(style.trail,Math.max(0,travel-length)))
    this.temp.updateMatrix(); this.trail.setMatrixAt(index,this.temp.matrix)
    this.color.setRGB(style.hot[0],style.hot[1],style.hot[2]); this.trail.setColorAt(index,this.color)
    return true
  }
  finish() {
    for (const mesh of this.meshes) {
      mesh.count = this.count; mesh.visible = this.count>0
      if (this.count) {mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true}
    }
    if (this.count) this.mesh.geometry.attributes.bulletGlow.needsUpdate = true
  }
  dispose() {
    for (const mesh of this.meshes) {mesh.removeFromParent(); mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); releaseMesh(mesh)}
  }
}
