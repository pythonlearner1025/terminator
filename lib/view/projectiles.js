import {Group, Vector3, Object3D, InstancedMesh, SphereGeometry, CylinderGeometry, PlaneGeometry,
  UnlitMaterial, TextureLoader, AdditiveBlending, PointLight, DynamicDrawUsage} from 'threepipe'
import {StreakBatch} from './tracers.js'
import {FxPool} from './fx-pool.js'
import {solidMaterial,surfaceGeometry} from './fx-world.js'
import {weaponAsset} from './weapons-materials.js'

export const PROJECTILE_STYLE=Object.freeze({
  round:{renderer:'streak',width:.10,glow:.65,trail:1.9,color:[4.8,1.15,.18]},
  bolt:{renderer:'orb',width:.22,glow:1.05,trail:3.4,color:[3.2,.28,4.6]},
  shell:{renderer:'shell',width:.13,glow:.28,trail:2.4,color:[2.8,.8,.12]},
  grenade:{renderer:'grenade',width:.14,glow:0,trail:0,color:[0,0,0]},
})
const PLAYER_BOLT={...PROJECTILE_STYLE.bolt,color:[.25,2.2,4.8]}
export function projectileStyle(type){return PROJECTILE_STYLE[type]||null}

// Reads authoritative positions verbatim. No visual velocity changes the World.
// GrenadeView retains the detailed M67 model and its existing lifecycle.
export class ProjectileView {
  constructor(parent,capacity=192,resources={}) {
    this.root=new Group();this.root.name='Dodgeable projectile bodies and trails';parent.add(this.root)
    this.streaks=new StreakBatch(this.root,capacity,'Enemy projectile cores and warning halos')
    this.slots=Array.from({length:capacity},()=>({id:null,seen:0,type:null,pos:new Vector3(),age:0,smokeAge:0}))
    this.serial=0;this.lastTick=null;this.counts={round:0,bolt:0,shell:0,grenade:0,unknown:0,dropped:0}
    this.temp=new Object3D();this.from=new Vector3();this.to=new Vector3();this.velocity=new Vector3();this.size=new Vector3()
    this.orbs=new InstancedMesh(new SphereGeometry(1,8,6),new UnlitMaterial({name:'Hot plasma projectile heads',
      color:0xffffff,transparent:true,opacity:.98,blending:AdditiveBlending,depthWrite:false}),capacity)
    this.shells=new InstancedMesh(surfaceGeometry(new CylinderGeometry(.035,.055,.22,10),2),(resources.shellMaterial||solidMaterial()),capacity)
    for(const mesh of [this.orbs,this.shells]) {
      mesh.frustumCulled=false;mesh.count=0;mesh.raycast=()=>{};mesh.instanceMatrix.setUsage(DynamicDrawUsage);this.root.add(mesh)
    }
    this.orbs.material.userData.renderToGBuffer=false;this.orbs.material.userData.renderToDepth=false
    this.orbs.name='Instanced plasma heads';this.shells.name='Instanced spinning 40 mm shells'
    const map=resources.smokeMap||new TextureLoader().load(weaponAsset('fx-smoke.png'))
    this.smoke=new FxPool(this.root,'192 shell smoke trail wisps',new PlaneGeometry(1,1),
      new UnlitMaterial({name:'Shell trail smoke',map,transparent:true,depthWrite:false,opacity:.28}),192,
      {billboard:true,growth:1.3,fade:true})
    this.lights=Array.from({length:2},()=>{const light=new PointLight(0xbc57ff,0,4.5,2);this.root.add(light);return light})
    this.color=this.orbs.material.color.clone()
    // Allocate the instance color buffer before the first projectile exists.
    for(let i=0;i<capacity;i++)this.orbs.setColorAt(i,this.color)
    this.orbs.instanceColor.setUsage(DynamicDrawUsage)
  }
  slot(id) {
    let free=null
    for(let i=0;i<this.slots.length;i++) {
      const p=this.slots[i];if(p.id===id)return p
      if(p.id===null&&!free)free=p
    }
    if(free){free.id=id;free.age=0;free.smokeAge=0;return free}
    this.counts.dropped++;return null
  }
  sync(world,camera) {
    const dt=this.lastTick===null?0:Math.max(0,Math.min(.1,(world.tick-this.lastTick)/60));this.lastTick=world.tick
    this.serial++;this.streaks.begin();this.orbs.count=0;this.shells.count=0
    this.counts.round=0;this.counts.bolt=0;this.counts.shell=0;this.counts.grenade=0;this.counts.unknown=0
    this.smoke.update(dt,camera)
    this.lights[0].intensity=0;this.lights[1].intensity=0
    let lit=0
    for(let i=0;i<world.projectiles.length;i++) {
      const p=world.projectiles[i],base=projectileStyle(p.type)
      if(!base){this.counts.unknown++;continue}
      this.counts[p.type]++
      if(base.renderer==='grenade')continue
      const slot=this.slot(p.id);if(!slot)continue
      const fresh=slot.seen===0||slot.age===0
      slot.seen=this.serial;slot.type=p.type;slot.age+=dt
      this.to.copy(p.pos);this.velocity.copy(p.vel)
      const speed=this.velocity.length()
      if(speed>.001)this.velocity.multiplyScalar(1/speed);else this.velocity.set(0,0,1)
      const style=p.type==='bolt'&&p.owner==='player'?PLAYER_BOLT:base
      this.from.copy(this.to).addScaledVector(this.velocity,-Math.min(style.trail,Math.max(.12,slot.age*speed)))
      this.streaks.add(this.from,this.to,style,p.type==='shell'?.45:1)
      if(base.renderer==='orb') {
        this.temp.position.copy(this.to);this.temp.quaternion.identity();this.temp.scale.setScalar(style.width*.60)
        this.temp.updateMatrix();this.orbs.setMatrixAt(this.orbs.count,this.temp.matrix)
        this.color.setRGB(style.color[0],style.color[1],style.color[2]);this.orbs.setColorAt(this.orbs.count++,this.color)
        if(lit<2){const light=this.lights[lit++];light.position.copy(this.to);light.color.copy(this.color);light.intensity=1.4}
      } else if(base.renderer==='shell') {
        this.temp.position.copy(this.to);this.from.copy(this.to).add(this.velocity);this.temp.lookAt(this.from)
        this.temp.rotateX(Math.PI/2);this.temp.rotateY(slot.age*24);this.temp.scale.setScalar(p.owner==='unit'?2:1)
        this.temp.updateMatrix();this.shells.setMatrixAt(this.shells.count++,this.temp.matrix)
        slot.smokeAge+=dt
        if(slot.smokeAge>=.035||fresh) {
          slot.smokeAge%=.035
          this.velocity.set(0,.18,0);this.size.setScalar(p.owner==='unit'?.25:.16)
          this.smoke.emit(this.to,this.velocity,this.size,.65,0x8c8780)
        }
      }
      slot.pos.copy(p.pos)
    }
    for(let i=0;i<this.slots.length;i++)if(this.slots[i].seen!==this.serial){this.slots[i].id=null;this.slots[i].seen=0}
    this.streaks.finish()
    this.orbs.visible=this.orbs.count>0;this.shells.visible=this.shells.count>0
    if(this.orbs.count){this.orbs.instanceMatrix.needsUpdate=true;this.orbs.instanceColor.needsUpdate=true}
    if(this.shells.count)this.shells.instanceMatrix.needsUpdate=true
    this.smoke.update(0,camera)
  }
  dispose() {
    this.streaks.dispose();this.smoke.mesh.material.map?.dispose();this.smoke.mesh.material.dispose()
    this.smoke.mesh.geometry.dispose();this.smoke.dispose()
    for(const mesh of [this.orbs,this.shells]){mesh.dispose();mesh.geometry.dispose();mesh.material.dispose()}
    this.root.removeFromParent()
  }
}
