import {Group, Vector3, Object3D, InstancedMesh, SphereGeometry, CylinderGeometry,
  UnlitMaterial, AdditiveBlending, NormalBlending, PointLight, DynamicDrawUsage} from 'threepipe'
import {StreakBatch} from './tracers.js'
import {solidMaterial,surfaceGeometry} from './fx-world.js'

export const PROJECTILE_STYLE=Object.freeze({
  round:{renderer:'streak',width:.024,trail:1,exposure:1/30,minPixels:1.5,opacity:1,
    color:[1,.42,.08],head:[1,.94,.78],tail:[1,.09,.008],linger:.14,intensity:12},
  bolt:{renderer:'orb',width:.045,trail:1.4,exposure:1.4/18,minPixels:1.5,opacity:.85,
    color:[.85,.08,1],head:[1,.80,1],tail:[.45,.012,.8],linger:.16,intensity:12,plasma:true},
  shell:{renderer:'shell',width:.035,trail:1.2,minPixels:1.5,opacity:.16,
    color:[.20,.19,.17],head:[.24,.23,.21],tail:[.12,.12,.12],linger:.18,intensity:1},
  grenade:{renderer:'grenade',width:.14,glow:0,trail:0,color:[0,0,0]},
})
const PLAYER_BOLT={...PROJECTILE_STYLE.bolt,color:[.08,.4,1],head:[.72,.94,1],tail:[.018,.09,1]}
export function projectileStyle(type){return PROJECTILE_STYLE[type]||null}
export function projectileType(projectile){return projectile.type||projectile.projectileType||null}

// Reads authoritative positions verbatim. No visual velocity changes the World.
// GrenadeView retains the detailed M67 model and its existing lifecycle.
export class ProjectileView {
  constructor(parent,capacity=192,resources={}) {
    this.root=new Group();this.root.name='Dodgeable projectile bodies and trails';parent.add(this.root)
    this.streaks=new StreakBatch(this.root,capacity*2,'Enemy exposure streaks')
    this.smoke=new StreakBatch(this.root,capacity*2,'Thin shell smoke lines')
    this.smoke.material.blending=NormalBlending
    this.smoke.viewport=this.streaks.viewport
    this.smoke.material.materialExtensions[0].extraUniforms.streakViewport.value=this.streaks.viewport
    this.slots=Array.from({length:capacity},()=>({id:null,seen:0,type:null,pos:new Vector3(),
      origin:new Vector3(),direction:new Vector3(),distance:0,style:null,speed:0,age:0,missingAge:0}))
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
    if(free){free.id=id;free.age=0;free.missingAge=0;return free}
    this.counts.dropped++;return null
  }
  sync(world,camera) {
    const dt=this.lastTick===null?0:Math.max(0,Math.min(.1,(world.tick-this.lastTick)/60));this.lastTick=world.tick
    this.serial++;this.streaks.begin();this.smoke.begin();this.orbs.count=0;this.shells.count=0
    this.counts.round=0;this.counts.bolt=0;this.counts.shell=0;this.counts.grenade=0;this.counts.unknown=0
    this.lights[0].intensity=0;this.lights[1].intensity=0
    let lit=0
    for(let i=0;i<world.projectiles.length;i++) {
      const p=world.projectiles[i],type=projectileType(p),base=projectileStyle(type)
      if(!base){this.counts.unknown++;continue}
      this.counts[type]++
      if(base.renderer==='grenade')continue
      const slot=this.slot(p.id);if(!slot)continue
      const fresh=slot.seen===0
      slot.seen=this.serial;slot.type=type;slot.age+=dt;slot.missingAge=0
      this.to.copy(p.pos);this.velocity.copy(p.vel)
      const speed=this.velocity.length()
      if(speed>.001)this.velocity.multiplyScalar(1/speed);else this.velocity.set(0,0,1)
      const style=type==='bolt'&&p.owner==='player'?PLAYER_BOLT:base
      if(fresh){slot.origin.copy(this.to);slot.distance=0}
      else slot.distance+=slot.pos.distanceTo(this.to)
      slot.direction.copy(this.velocity);slot.speed=speed;slot.style=style
      const length=Math.min(style.exposure?speed*style.exposure:style.trail,style.trail,slot.distance)
      this.from.copy(this.to).addScaledVector(this.velocity,-length)
      if(length>.001)(base.renderer==='shell'?this.smoke:this.streaks).add(this.from,this.to,style,style.opacity)
      if(base.renderer==='orb') {
        this.temp.position.copy(this.to);this.temp.quaternion.identity();this.temp.scale.setScalar(style.width*.5)
        this.temp.updateMatrix();this.orbs.setMatrixAt(this.orbs.count,this.temp.matrix)
        this.color.setRGB(style.head[0]*style.intensity,style.head[1]*style.intensity,style.head[2]*style.intensity)
        this.orbs.setColorAt(this.orbs.count++,this.color)
        if(lit<2){const light=this.lights[lit++];light.position.copy(this.to)
          light.color.setRGB(style.color[0],style.color[1],style.color[2]);light.intensity=1.4}
      } else if(base.renderer==='shell') {
        this.temp.position.copy(this.to);this.from.copy(this.to).add(this.velocity);this.temp.lookAt(this.from)
        this.temp.rotateX(Math.PI/2);this.temp.rotateY(slot.age*24);this.temp.scale.setScalar(p.owner==='unit'?2:1)
        this.temp.updateMatrix();this.shells.setMatrixAt(this.shells.count++,this.temp.matrix)
      }
      slot.pos.copy(p.pos)
    }
    for(let i=0;i<this.slots.length;i++) {
      const slot=this.slots[i];if(slot.id===null)continue
      if(slot.seen!==this.serial)slot.missingAge+=dt
      const style=slot.style
      if(slot.missingAge>=style.linger){slot.id=null;slot.seen=0;continue}
      // A residual line ends at the last observed position, never past an impact.
      const length=Math.min(style.exposure?slot.speed*style.exposure:style.trail,style.trail,slot.distance)
      const endAge=slot.seen===this.serial?length/Math.max(.001,slot.speed):slot.missingAge
      const endDistance=slot.seen===this.serial?length:0
      const startDistance=Math.min(slot.distance,Math.max(0,(style.linger-slot.missingAge)*slot.speed))
      if(startDistance<=endDistance)continue
      this.from.copy(slot.pos).addScaledVector(slot.direction,-startDistance)
      this.to.copy(slot.pos).addScaledVector(slot.direction,-endDistance)
      const batch=style.renderer==='shell'?this.smoke:this.streaks
      batch.add(this.from,this.to,style,style.opacity,
        (slot.missingAge+startDistance/Math.max(.001,slot.speed))/style.linger,endAge/style.linger,true)
    }
    this.streaks.finish();this.smoke.finish()
    this.orbs.visible=this.orbs.count>0;this.shells.visible=this.shells.count>0
    if(this.orbs.count){this.orbs.instanceMatrix.needsUpdate=true;this.orbs.instanceColor.needsUpdate=true}
    if(this.shells.count)this.shells.instanceMatrix.needsUpdate=true
  }
  dispose() {
    this.streaks.dispose();this.smoke.dispose()
    for(const mesh of [this.orbs,this.shells]){mesh.dispose();mesh.geometry.dispose();mesh.material.dispose()}
    this.root.removeFromParent()
  }
}
