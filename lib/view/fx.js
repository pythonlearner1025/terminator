import {Group, InstancedMesh, SphereGeometry, BoxGeometry, UnlitMaterial, Color, Object3D, PointLight, Vector3, AdditiveBlending} from 'threepipe'
import {Mesh2, PlaneGeometry, CanvasTexture, DoubleSide, CylinderGeometry, Float32BufferAttribute} from 'threepipe'

// Fixed pools keep combat allocation and draw calls bounded, even under minigun fire.
export class UnitFx {
  constructor(parent) {
    this.root = new Group(); this.root.name = 'Unit combat effects'; parent.add(this.root)
    this.temp = new Object3D(); this.direction = new Vector3()
    this.pools = {}; this.cursor = 0
    for(const [name,color,capacity] of [['sparks',0xffbf63,160],['plasma',0x9aeaff,48],['bullet',0xffa039,48]]) {
      const geometry = new BoxGeometry(1,1,1)
      const material = new UnlitMaterial({color:new Color(color),blending:AdditiveBlending,transparent:true,depthWrite:false})
      const mesh = new InstancedMesh(geometry,material,capacity)
      mesh.name = name; mesh.frustumCulled=false; mesh.raycast=()=>{}
      this.root.add(mesh)
      const pool={mesh,items:Array.from({length:capacity},()=>({life:0,max:1,pos:new Vector3(),vel:new Vector3(),scale:new Vector3()})),next:0}
      this.pools[name]=pool
    }
    this.lights = Array.from({length:2},()=>{
      const light=new PointLight(0xffae4b,0,3,2); this.root.add(light); return {light,life:0}
    })
    this.stats = {sparkBursts:0,plasmaShots:0,minigunShots:0}
    this.update(0)
  }
  particle(poolName, pos, velocity, scale, life) {
    const pool=this.pools[poolName], p=pool.items[pool.next++%pool.items.length]
    p.pos.copy(pos); p.vel.copy(velocity); p.scale.copy(scale); p.life=p.max=life
  }
  light(pos,color,intensity) {
    const entry=this.lights[this.cursor++%2]
    entry.light.position.copy(pos); entry.light.color.set(color); entry.light.intensity=intensity; entry.life=.065
  }
  hit(pos, seed=0) {
    this.stats.sparkBursts++
    for(let i=0;i<12;i++) {
      const a=i*2.399+seed,b=.5+(i%4)*.4
      this.particle('sparks',pos,new Vector3(Math.cos(a)*b,1+(i%3)*.6,Math.sin(a)*b),new Vector3(.013,.013,.085),.16+(i%5)*.033)
    }
    this.light(pos,0xffb85c,3)
  }
  shot(from,to,type) {
    const heavy=type==='heavy',pool=heavy?'bullet':'plasma'
    this.stats[heavy?'minigunShots':'plasmaShots']++
    const direction=new Vector3().subVectors(to,from).normalize()
    this.particle(pool,from,direction.clone().multiplyScalar(heavy?110:62),new Vector3(heavy?.022:.045,heavy?.022:.045,heavy?1.7:1.25),Math.min(.45,from.distanceTo(to)/(heavy?110:62)))
    this.particle(pool,from,new Vector3(),new Vector3(.13,.13,.32),.055)
    this.light(from,heavy?0xff8e28:0x83dfff,heavy?1.2:2)
  }
  update(dt) {
    for(const [name,pool] of Object.entries(this.pools)) {
      for(let i=0;i<pool.items.length;i++) {
        const p=pool.items[i]; p.life=Math.max(0,p.life-dt)
        if(p.life>0) {
          p.pos.addScaledVector(p.vel,dt)
          if(name==='sparks') p.vel.y-=dt*5
          this.temp.position.copy(p.pos)
          this.direction.copy(p.pos).add(p.vel)
          if(p.vel.lengthSq()>.01) this.temp.lookAt(this.direction)
          this.temp.scale.copy(p.scale).multiplyScalar(Math.min(1,p.life/p.max*3))
        } else this.temp.scale.setScalar(0)
        this.temp.updateMatrix(); pool.mesh.setMatrixAt(i,this.temp.matrix)
      }
      pool.mesh.instanceMatrix.needsUpdate=true
    }
    for(const entry of this.lights) {
      entry.life=Math.max(0,entry.life-dt)
      if(entry.life===0) entry.light.intensity=0
    }
  }
  dispose() {
    // Geometry and materials belong to the enclosing RuntimeObjectOwner.
    this.root.removeFromParent()
    for(const {mesh} of Object.values(this.pools)) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose?.() }
    this.pools={}; this.lights=[]
  }
}

// Player effects use the same fixed projection as the weapon and bounded pools.
// All resources remain under PlayerView's RuntimeObjectOwner until cleanup.
export class WeaponFx {
  constructor(parent,projection,metal) {
    this.root=new Group();this.root.name='First person muzzle and brass';parent.add(this.root)
    const c=document.createElement('canvas');c.width=c.height=64
    const ctx=c.getContext('2d'),g=ctx.createRadialGradient(32,32,0,32,32,32)
    g.addColorStop(0,'#ffffffff');g.addColorStop(.12,'#fffffff0');g.addColorStop(.35,'#ffffff68');g.addColorStop(1,'#ffffff00')
    ctx.fillStyle=g;ctx.fillRect(0,0,64,64)
    this.material=new UnlitMaterial({name:'Weapon muzzle glow',color:0xffbd58,map:new CanvasTexture(c),
      blending:AdditiveBlending,transparent:true,depthWrite:false,side:DoubleSide,fog:false})
    this.material.registerMaterialExtensions([projection])
    this.flash=new Group();this.flash.name='Weapon muzzle flash';this.root.add(this.flash)
    const plane=new PlaneGeometry(1,1)
    for(let i=0;i<3;i++) {
      const mesh=new Mesh2(plane,this.material);mesh.scale.set(i===0?.19:.075,i===0?.19:.28,1)
      mesh.rotation.z=i*Math.PI/2;mesh.position.z=-.008*i;mesh.renderOrder=950;mesh.frustumCulled=false
      mesh.raycast=()=>{};this.flash.add(mesh)
    }
    this.flash.visible=false;this.flashLife=0
    const geo=new CylinderGeometry(.007,.007,.027,8),count=geo.attributes.position.count
    geo.setAttribute('color',new Float32BufferAttribute(Array.from({length:count*3},()=>1),3))
    geo.setAttribute('weaponSurface',new Float32BufferAttribute(Array.from({length:count*2},(_,i)=>i%2?.34:.82),2))
    this.shells=new InstancedMesh(geo,metal,8);this.shells.name='Eight pooled spent cases'
    this.shells.frustumCulled=false;this.shells.renderOrder=901;this.shells.raycast=()=>{}
    this.root.add(this.shells)
    this.items=Array.from({length:8},()=>({life:0,position:new Vector3(),velocity:new Vector3(),spin:0,size:1}))
    this.cursor=0;this.temp=new Object3D();this.color=new Color();this.stats={flashes:0,cases:0}
    for(let i=0;i<8;i++)this.shells.setColorAt(i,this.color.set(0xb99550))
    this.update(0)
  }
  fire(rig,id,interval) {
    rig.muzzle.add(this.flash);this.flash.position.set(0,0,-.017)
    this.flash.rotation.z=this.stats.flashes*2.399;this.flash.scale.setScalar(id==='shotgun'?1.6:id==='plasma'?1.3:1)
    this.material.color.set(id==='plasma'?0x73dfff:0xffbc55)
    this.flashLife=Math.min(.06,interval*.48);this.flash.visible=true;this.stats.flashes++
  }
  eject(rig,id) {
    const index=this.cursor++%8,item=this.items[index]
    rig.root.updateMatrix()
    item.position.set(.075,.03,id==='pistol'?-.065:0).applyMatrix4(rig.root.matrix)
    item.velocity.set(.65+(index%3)*.1,.65,-.10+(index%2)*.18)
    item.life=.65;item.spin=index;item.size=id==='shotgun'?1.7:1
    this.shells.setColorAt(index,this.color.set(id==='shotgun'?0x943e28:0xb99550));this.shells.instanceColor.needsUpdate=true
    this.stats.cases++
  }
  update(dt) {
    this.flashLife=Math.max(0,this.flashLife-dt);this.flash.visible=this.flashLife>0
    for(let i=0;i<8;i++) {
      const p=this.items[i];p.life=Math.max(0,p.life-dt)
      if(p.life>0) {
        p.position.addScaledVector(p.velocity,dt);p.velocity.y-=dt*2.6;p.spin+=dt*17
        this.temp.position.copy(p.position);this.temp.rotation.set(p.spin,p.spin*.7,0);this.temp.scale.setScalar(p.size)
      } else this.temp.scale.setScalar(0)
      this.temp.updateMatrix();this.shells.setMatrixAt(i,this.temp.matrix)
    }
    this.shells.instanceMatrix.needsUpdate=true
  }
  dispose() { this.flashLife=0 }
}
