import {Group, SphereGeometry, BoxGeometry, UnlitMaterial, Color, PointLight, Vector3, AdditiveBlending} from 'threepipe'
import {FxPool} from './fx-pool.js'
import {surfaceGeometry,solidMaterial} from './fx-world.js'
import {weaponAsset} from './weapons-materials.js'
import {Mesh2, TextureLoader, SRGBColorSpace, PlaneGeometry, DoubleSide} from 'threepipe'

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
    const heavy=type==='heavy',pool=heavy?'bullet':'plasma',speed=heavy?110:62
    this.stats[heavy?'minigunShots':'plasmaShots']++
    this.v.subVectors(to,from).normalize().multiplyScalar(speed)
    this.particle(pool,from,this.v,this.s.set(heavy?.012:.035,heavy?.012:.035,heavy?1.3:.62),Math.min(.45,from.distanceTo(to)/speed))
    this.particle(pool,from,this.zero,this.s.set(.10,.10,.19),.055)
    this.light(from,heavy?0xff8e28:0x83dfff,heavy?1.2:2)
  }
  update(dt) {
    for(const pool of Object.values(this.pools))pool.update(dt)
    for(const entry of this.lights){entry.life=Math.max(0,entry.life-dt);if(entry.life===0)entry.light.intensity=0}
  }
  dispose() {
    // This root is detached before its enclosing owner cleans up.
    const resources=new Set()
    this.root.traverse(object=>{
      if(object.geometry)resources.add(object.geometry)
      if(object.material){resources.add(object.material);for(const value of Object.values(object.material))if(value?.isTexture)resources.add(value)}
    })
    this.root.removeFromParent();for(const pool of Object.values(this.pools))pool.dispose();for(const resource of resources)resource.dispose()
    this.pools={};this.lights=[]
  }
}

// Muzzle sprite uses the weapon projection. Brass and illumination live in world
// space, so turning the camera cannot drag spent cases around the player.
export class WeaponFx {
  constructor(parent,projection,metal,worldFx) {
    this.worldFx=worldFx;this.metal=metal;this.position=new Vector3();this.rig=null
    this.root=new Group();this.root.name='First person muzzle';parent.add(this.root)
    const map=new TextureLoader().load(weaponAsset('fx-muzzle.png'));map.colorSpace=SRGBColorSpace
    this.material=new UnlitMaterial({name:'Textured muzzle flame',color:0xffebc7,map,
      blending:AdditiveBlending,transparent:true,depthWrite:false,side:DoubleSide,fog:false})
    this.material.registerMaterialExtensions([projection])
    this.flash=new Group();this.flash.name='Weapon muzzle flash';this.root.add(this.flash)
    const plane=new PlaneGeometry(1,1)
    for(let i=0;i<2;i++) {
      const mesh=new Mesh2(plane,this.material);mesh.scale.set(i===0?.28:.10,i===0?.28:.42,1)
      mesh.rotation.y=i*Math.PI/2;mesh.rotation.z=i*.65;mesh.renderOrder=950;mesh.frustumCulled=false
      mesh.raycast=()=>{};this.flash.add(mesh)
    }
    this.flash.visible=false;this.flashLife=0;this.flashMax=.045
    this.stats={flashes:0,cases:0}
  }
  fire(rig,id,interval) {
    this.rig=rig;this.id=id
    rig.muzzle.add(this.flash);this.flash.position.set(0,0,-.035)
    this.flash.rotation.z=this.stats.flashes*2.399;this.flash.scale.setScalar(id==='shotgun'?1.8:id==='plasma'?1.25:id==='m4'?1.3:.8)
    this.material.color.set(id==='plasma'?0x83e5ff:0xffe8bf)
    this.flashLife=this.flashMax=Math.min(.045,interval*.45);this.flash.visible=true;this.stats.flashes++
    rig.muzzle.getWorldPosition(this.position)
    this.worldFx.flash(this.position,id==='plasma',id==='shotgun'?10:6,this.flashLife)
    this.worldFx.emit('smoke',this.position,new Vector3(0,.22,0),new Vector3(.075,.075,.075),.55,0x7d8991)
  }
  eject(rig,id) {this.worldFx.eject(rig,id);this.stats.cases++}
  update(dt) {
    this.flashLife=Math.max(0,this.flashLife-dt);this.flash.visible=this.flashLife>0
    this.material.opacity=Math.min(1,this.flashLife/.015)
  }
  beforeRender(camera,aim) {
    const uniforms=this.metal.userData.weaponFlash
    uniforms.aim.value=aim
    uniforms.power.value=this.flashLife>0?.85*this.flashLife/this.flashMax:0
    uniforms.color.value.set(this.id==='plasma'?0x70ddff:0xffbc73)
    if(this.rig&&this.flashLife>0) {
      this.rig.muzzle.getWorldPosition(this.position)
      if(this.worldFx.lightMax<=.065)this.worldFx.light.position.copy(this.position)
      uniforms.position.value.copy(this.position).applyMatrix4(camera.matrixWorldInverse)
    }
  }
  dispose() {this.flashLife=0;this.metal.userData.weaponFlash.power.value=0;this.rig=null}
}
