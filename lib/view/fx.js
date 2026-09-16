import {RevolverFx} from './revolver-fx.js'
import {Group, SphereGeometry, BoxGeometry, UnlitMaterial, Color, PointLight, Vector3, Quaternion, AdditiveBlending} from 'threepipe'
import {FxPool} from './fx-pool.js'
import {surfaceGeometry,solidMaterial} from './fx-world.js'
import {weaponAsset} from './weapons-materials.js'
import {Mesh2, TextureLoader, SRGBColorSpace, PlaneGeometry, DoubleSide} from 'threepipe'
import {releaseSubtree} from './mesh-release.js'

// Fixed pools keep combat allocation and draw calls bounded under minigun fire.
export class UnitFx {
  constructor(parent) {
    this.root=new Group();this.root.name='Unit combat effects';parent.add(this.root)
    this.v=new Vector3();this.s=new Vector3();this.zero=new Vector3();this.cursor=0
    this.pools={}
    for(const [name,color,capacity] of [['sparks',0xffbf63,128],['plasma',0x9aeaff,48],['bullet',0xffa039,48]]) {
      const material=new UnlitMaterial({color:new Color(color),blending:AdditiveBlending,transparent:true,depthWrite:false})
      this.pools[name]=new FxPool(this.root,name,name==='plasma'?new SphereGeometry(1,8,5):new BoxGeometry(1,1,1),material,capacity,{gravity:name==='sparks'?6:0,fade:true,alignVelocity:true})
    }
    this.pools.chips=new FxPool(this.root,'Terminator metal chips',surfaceGeometry(new BoxGeometry(1,1,1),1),solidMaterial(),32,{gravity:9.8,bounce:true})
    this.lights=Array.from({length:2},()=>{const light=new PointLight(0xffae4b,0,3,2);this.root.add(light);return {light,life:0}})
    this.stats={sparkBursts:0,plasmaShots:0,minigunShots:0}
  }
  particle(name,pos,velocity,scale,life) {return this.pools[name].emit(pos,velocity,scale,life)}
  light(pos,color,intensity) {
    const entry=this.lights[this.cursor++%2];entry.light.position.copy(pos);entry.light.color.set(color);entry.light.intensity=intensity;entry.life=.065
  }
  hit(pos,seed=0) {
    this.stats.sparkBursts++
    for(let i=0;i<12;i++) {
      const a=i*2.399+seed,b=.7+(i%4)*.5
      this.v.set(Math.cos(a)*b,1+(i%3)*.6,Math.sin(a)*b)
      this.particle('sparks',pos,this.v,this.s.set(.009,.009,.10),.16+(i%5)*.033)
      if(i<3)this.particle('chips',pos,this.v,this.s.set(.025,.012,.033),1.0+i*.12)
    }
    this.light(pos,0xffb85c,3)
  }
  shot(from,to,type) {
    const heavy=type==='heavy',pool=heavy?'bullet':'plasma'
    this.stats[heavy?'minigunShots':'plasmaShots']++
    this.particle(pool,from,this.zero,this.s.set(.10,.10,.19),.055)
    this.light(from,heavy?0xff8e28:0x83dfff,heavy?1.2:2)
  }
  update(dt) {
    for(const pool of Object.values(this.pools))pool.update(dt)
    for(const entry of this.lights){entry.life=Math.max(0,entry.life-dt);if(entry.life===0)entry.light.intensity=0}
  }
  dispose() {
    // Pool materials and geometry are local; the PBR fragment atlases are shared.
    const resources=new Set()
    for(const pool of Object.values(this.pools)){resources.add(pool.mesh.geometry);resources.add(pool.mesh.material);pool.dispose()}
    releaseSubtree(this.root);this.root.removeFromParent();for(const resource of resources)resource.dispose()
    this.pools={};this.lights=[]
  }
}

export const MUZZLE_STYLE={
  pistol:{tile:0,width:.75,length:1.15,color:0xffd9a1,power:6},
  m4:{tile:1,width:1.05,length:1.5,color:0xffc174,power:7},
  shotgun:{tile:2,width:1.9,length:1.45,color:0xffdeb0,power:11},
  plasma:{tile:3,width:1.5,length:1.9,color:0x75dfff,power:9},
  sniper:{tile:4,width:1.2,length:2,color:0xffe7c1,power:10},
  launcher:{tile:5,width:1.8,length:.9,color:0xffc99b,power:10},
}

// Muzzle sprite uses the weapon projection. Brass and illumination live in world
// space, so turning the camera cannot drag spent cases around the player.
export class WeaponFx {
  constructor(parent,projection,metal,worldFx) {
    this.worldFx=worldFx;this.metal=metal;this.projection=projection;this.position=new Vector3();this.velocity=new Vector3();this.size=new Vector3();this.quaternion=new Quaternion();this.parentQuaternion=new Quaternion();this.rig=null
    this.root=new Group();this.root.name='First person muzzle';parent.add(this.root)
    const map=new TextureLoader().load(weaponAsset('fx-muzzle-atlas.png'));map.colorSpace=SRGBColorSpace;map.repeat.set(1/6,1)
    this.map=map
    this.material=new UnlitMaterial({name:'Textured muzzle flame',color:0xffebc7,map,
      blending:AdditiveBlending,transparent:true,depthWrite:false,side:DoubleSide,fog:false})
    this.material.registerMaterialExtensions([projection])
    this.flash=new Group();this.flash.name='Weapon muzzle flash';this.root.add(this.flash)
    const plane=new PlaneGeometry(1,1);this.geometry=plane
    for(let i=0;i<2;i++) {
      const mesh=new Mesh2(plane,this.material);mesh.scale.set(i===0?.28:.10,i===0?.28:.42,1)
      mesh.rotation.y=i*Math.PI/2;mesh.rotation.z=i*.65;mesh.renderOrder=950;mesh.frustumCulled=false
      mesh.raycast=()=>{};this.flash.add(mesh)
    }
    this.flash.visible=false;this.flashLife=0;this.flashMax=.045
    this.stats={flashes:0,cases:0}
  }
  fire(rig,id,interval) {
    if(rig.root.userData.viewModel?.mechanism==='swingout'){this.revolver||=new RevolverFx(this);this.revolver.fire(rig);this.rig=null;this.flashLife=0;this.flash.visible=false;return}
    this.rig=rig;this.id=id
    const style=MUZZLE_STYLE[id]||MUZZLE_STYLE.m4
    this.flashWidth=style.width;this.flashLength=style.length;this.layoutFlash()
    this.material.color.set(style.color);this.material.map.offset.x=style.tile/6
    this.flashLife=this.flashMax=Math.min(.045,interval*.45);this.flash.visible=true;this.stats.flashes++
    rig.muzzle.getWorldPosition(this.position)
    this.worldFx.flash(this.position,id==='plasma',style.power,this.flashLife)
    this.worldFx.emit('smoke',this.position,this.velocity.set(0,.22,0),this.size.set(.075,.075,.075),.55,0x7d8991)
  }
  eject(rig,id) {this.worldFx.eject(rig,id);this.stats.cases++}
  update(dt) {
    this.revolver?.update(dt)
    this.flashLife=Math.max(0,this.flashLife-dt);this.flash.visible=this.flashLife>0
    this.material.opacity=Math.min(1,this.flashLife/.015)
  }
  beforeRender(camera,aim) {
    const uniforms=this.metal.userData.weaponFlash
    uniforms.aim.value=aim
    uniforms.power.value=this.flashLife>0?.85*this.flashLife/this.flashMax:0
    uniforms.color.value.set(this.id==='plasma'?0x70ddff:0xffbc73)
    if(this.rig&&this.flashLife>0) {
      this.layoutFlash()
      this.rig.muzzle.getWorldPosition(this.position)
      if(this.worldFx.lightMax<=.065)this.worldFx.light.position.copy(this.position)
      uniforms.position.value.copy(this.position).applyMatrix4(camera.matrixWorldInverse)
    }
    this.revolver?.beforeRender()
  }
  layoutFlash() {
    if(!this.rig)return
    this.rig.muzzle.getWorldPosition(this.position);this.root.worldToLocal(this.position);this.flash.position.copy(this.position)
    this.rig.muzzle.getWorldQuaternion(this.quaternion);this.root.getWorldQuaternion(this.parentQuaternion).invert()
    this.flash.quaternion.copy(this.parentQuaternion).multiply(this.quaternion);this.flash.rotateZ(this.stats.flashes*2.399)
    this.flash.position.add(this.velocity.set(0,0,-.035).applyQuaternion(this.flash.quaternion));this.flash.scale.set(this.flashWidth||1,this.flashWidth||1,this.flashLength||1)
  }
  dispose() {
    this.revolver?.dispose();this.revolver=null;this.flashLife=0;this.metal.userData.weaponFlash.power.value=0;this.rig=null
    this.material.unregisterMaterialExtensions([this.projection])
    releaseSubtree(this.root);this.root.removeFromParent();this.geometry.dispose();this.material.dispose();this.map.dispose()
  }
}
