import {Group, InstancedMesh, SphereGeometry, BoxGeometry, UnlitMaterial, Color, Object3D, PointLight, Vector3, AdditiveBlending} from 'threepipe'

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
