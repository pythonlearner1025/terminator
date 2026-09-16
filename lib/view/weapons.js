import {
  Group, Vector3, PerspectiveCamera,
} from 'threepipe'
import {weaponMaterial} from './weapons-materials.js'
import {instantiateWeaponRigs, instantiateGrenade, WEAPON_IDS} from './weapon-assets.js'
export {WEAPON_IDS} from './weapon-assets.js'
import {AuthoredWeaponClips,WeaponAnimation} from './weapons-animation.js'
import {WeaponFx} from './fx.js'
import {RevolverFx} from './revolver-fx.js'
import {WeaponWorldFx} from './fx-world.js'
import {WeaponScreenFx} from './fx-screen.js'
import {BulletView} from './bullets.js'
import {ProjectileView} from './projectiles.js'
import {ScopeOverlay} from '../ui/scope.js'

// A separate projection without another render pass. Depth is compressed into the
// near foreground so the gun keeps its own depth ordering and cannot enter walls.
export function viewmodelProjection(camera) {
  return {
    uuid: 'terminator-viewmodel-projection', computeCacheKey: 'terminator-viewmodel-projection-v2',
    extraUniforms: {weaponProjection: {value: camera.projectionMatrix}},
    parsVertexSnippet: 'uniform mat4 weaponProjection;',
    shaderExtender(shader) {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\ngl_Position = weaponProjection * mvPosition;\ngl_Position.z = gl_Position.z * 0.02 - gl_Position.w * 0.978;')
    },
  }
}

// Weapon geometry comes exclusively from the authored glTF files.
export function createWeaponRigs(parent, material, modelRoot,options) {
  const materials=new Map()
  const materialFor=source=>{
    if(!materials.has(source)) {
      const next=material.userData.viewProjection
        ? weaponMaterial(material.userData.viewProjection,source,material.userData.weaponFlash)
        : source.clone()
      if(material.envMap){next.envMap=material.envMap;next.envMapIntensity=material.envMapIntensity}
      materials.set(source,next)
    }
    return materials.get(source)
  }
  return instantiateWeaponRigs(parent,modelRoot,materialFor,options)
}
export function createGrenadeModel(material,modelRoot) {return instantiateGrenade(modelRoot,material)}

// Keeps every rig in the view, shows the one weapon the player holds and hides
// the rest. Exactly one rig is visible after this call.
// threepipe unregisters a material as soon as the last object holding it leaves
// the scene graph, and unregistering disposes it, which throws away the program
// the match warmup linked: the rig would then link its shaders in the frame the
// player draws it. Hiding keeps the material registered and costs no draw.
export function keepRigsResident(rigs,feel,shown) {
  for(const rig of Object.values(rigs)){
    if(rig.root.parent!==feel)feel.add(rig.root)
    rig.root.visible=rig.id===shown
  }
}

export class WeaponView {
  constructor(parent,viewer) {
    this.viewer=viewer
    this.root=new Group();this.root.name='First Person Weapons';parent.add(this.root)
    this.feel=new Group();this.root.add(this.feel)
    this.camera=new PerspectiveCamera(54,1,.02,8)
    this.baseFov=72
    this.projection=viewmodelProjection(this.camera)
    this.material=weaponMaterial(this.projection)
    this.rigs=createWeaponRigs(this.feel,this.material,viewer.scene.modelRoot)
    keepRigsResident(this.rigs,this.feel,'pistol')
    this.materials=[this.material,...new Set(Object.values(this.rigs).flatMap(rig=>{const out=[];rig.root.traverse(n=>{if(n.material)out.push(n.material)});return out}))]
    this.worldFx=new WeaponWorldFx(parent)
    this.worldFx.visualFloorRoot=viewer?.scene.modelRoot
    this.screenFx=viewer?new WeaponScreenFx(viewer,this.worldFx):null
    this.fx=new WeaponFx(this.feel,this.projection,this.material,this.worldFx)
    this.worldFx.onSound=(kind,detail)=>viewer?.canvas.dispatchEvent(new CustomEvent('terminator:weapon-sound',{detail:{kind,...detail}}))
    this.animation=new WeaponAnimation(this.rigs,this.fx)
    this.variants=new Map([['pistol',this.rigs.pistol]]);this.variant='pistol'
    this.bullets=new BulletView(parent);this.tracers=this.bullets;this.projectiles=new ProjectileView(parent)
    this.worldFx.tracers=this.tracers;this.worldFx.projectiles=this.projectiles
    this.muzzlePosition=new Vector3()
    this.scope=viewer?new ScopeOverlay(viewer):null
  }
  selectVariant(id='pistol') {
    if(!['pistol','swingout','revolver-rebuild'].includes(id))throw new Error('Unknown revolver variant: '+id)
    if(this.variant===id)return
    if(!this.variants.has(id)){
      const rig=createWeaponRigs(this.feel,this.material,this.viewer.scene.modelRoot,{ids:[id]})[id]
      rig.id='pistol';rig.clipPlayer=new AuthoredWeaponClips(rig);this.variants.set(id,rig)
      rig.root.traverse(n=>{if(n.material&&!this.materials.includes(n.material))this.materials.push(n.material)})
    }
    this.animation.setClipTime(null)
    this.rigs.pistol.clipPlayer?.mixer.stopAllAction();this.rigs.pistol.root.removeFromParent()
    if(this.fx.revolver)this.fx.revolver.pending=null
    if(['swingout','revolver-rebuild'].includes(id))this.fx.revolver||=new RevolverFx(this.fx)
    this.rigs.pistol=this.variants.get(id);this.variant=id;this.animation.shown='pistol'
    this.animation.switchAge=0;this.rigs.pistol.clipPlayer.name=null
    this.feel.add(this.rigs.pistol.root)
    this.environment=null
  }
  sync(world) {
    this.world=world
    this.worldFx.colliders=world.activeColliders()
    this.worldFx.sync(world,this.viewer?.scene.mainCamera)
    const camera=this.viewer?.scene.mainCamera
    if(camera){this.root.position.copy(camera.position);this.root.quaternion.copy(camera.quaternion)}
    this.animation.sync(world)
    if(!this.warming)keepRigsResident(this.rigs,this.feel,this.animation.shown)
    this.root.updateMatrixWorld(true)
    this.rigs[this.animation.shown].muzzle.getWorldPosition(this.muzzlePosition)
    if(camera) {
      // Match the independent weapon projection at the muzzle plane.
      this.muzzlePosition.applyMatrix4(camera.matrixWorldInverse)
      const ratio=Math.tan(camera.fov*Math.PI/360)/Math.tan(this.camera.fov*Math.PI/360)
      this.muzzlePosition.x*=ratio;this.muzzlePosition.y*=ratio
      this.muzzlePosition.applyMatrix4(camera.matrixWorld)
    }
    this.tracers.sync(world,this.muzzlePosition,this.worldFx.colliders)
    this.projectiles.timeScale=this.bullets.pool.timeScale
    this.projectiles.sync(world,camera)
    this.scope?.sync(this.animation.shown,this.animation.aimAmount,world.player.reloadTimer>0)
    this.feel.visible=!this.scope?.visible
    this.screenFx?.sync(world)
  }
  beforeRender(camera) {
    if(!this.world)return
    // Match world zoom while retaining the existing 54 degree hip projection.
    const zoom=Math.tan(camera.fov*Math.PI/360)/Math.tan(this.baseFov*Math.PI/360)
    const fov=2*Math.atan(Math.tan((this.rigs[this.animation.shown].root.userData.viewModel.fov||54)*Math.PI/360)*zoom)*180/Math.PI
    if(this.camera.aspect!==camera.aspect || this.camera.fov!==fov) {
      this.camera.aspect=camera.aspect;this.camera.fov=fov;this.camera.updateProjectionMatrix()
    }
    this.root.position.copy(camera.position);this.root.quaternion.copy(camera.quaternion)
    this.adoptEnvironment()
    // GameManager applies CameraFeel after PlayerView.sync. Read its final offset here.
    const hip=1-this.animation.aimAmount
    this.feel.rotation.set(-(camera.rotation.x-this.world.player.pitch)*.8*hip,0,-camera.rotation.z*.65*hip)
    this.root.updateMatrixWorld(true)
    this.fx.beforeRender(camera,this.animation.aimAmount)
    this.screenFx?.layout();this.scope?.layout()
  }
  // Setting envMap marks every weapon material for a rebuild, and three drops
  // the program it had. The warmup calls this before it compiles, so the rigs
  // it compiles keep their programs instead of linking on first draw.
  adoptEnvironment(environment=this.viewer?.scene?.environment) {
    if(!environment||this.environment===environment)return false
    this.environment=environment
    for(const m of this.materials){m.envMap=environment;m.envMapIntensity=.7;m.needsUpdate=true}
    return true
  }
  primeWarmup(camera) {
    this.warming=true
    // Every rig has to draw while the warmup compiles, so show them all. The
    // release hides the ones the player is not holding again. The warmup primes
    // twice, once per light count, and the second prime must show them again.
    for(const rig of Object.values(this.rigs)){this.feel.add(rig.root);rig.root.visible=true}
    const releaseBullets=this.bullets.primeWarmup()
    const releaseProjectiles=this.projectiles.primeWarmup(camera)
    return ()=>{
      releaseBullets();releaseProjectiles()
      this.warming=false
      keepRigsResident(this.rigs,this.feel,this.animation.shown)
    }
  }
  dispose() { this.animation.dispose();this.fx.dispose();this.worldFx.dispose();this.screenFx?.dispose();this.tracers.dispose();this.projectiles.dispose();this.scope?.dispose();this.world=null
    this.root.removeFromParent()
    for(const rig of new Set([...Object.values(this.rigs),...this.variants.values()])){rig.clipPlayer?.dispose();rig.root.traverse(n=>{if(n.isSkinnedMesh)n.skeleton.dispose()})};this.variants.clear()
    for(const m of this.materials)m.dispose()
    this.root.clear()
  }
}
