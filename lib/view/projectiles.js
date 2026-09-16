import {Group, Vector3, Object3D, InstancedMesh, CylinderGeometry, PointLight, DynamicDrawUsage} from 'threepipe'
import {BulletBatch} from './bullet-batch.js'
import {BULLET_STYLE} from './bullets.js'
import {solidMaterial,surfaceGeometry} from './fx-world.js'
import {releaseSubtree} from './mesh-release.js'

export const PROJECTILE_STYLE=Object.freeze({
  round:{...BULLET_STYLE.m4,renderer:'bullet',trail:.06},
  bolt:{...BULLET_STYLE.plasma,renderer:'plasma',color:[.65,.12,1],hot:[.8,.18,1],trail:.16},
  shell:{renderer:'shell'},
  grenade:{renderer:'grenade'},
})
const PLAYER_BOLT={...PROJECTILE_STYLE.bolt,color:BULLET_STYLE.plasma.color,hot:BULLET_STYLE.plasma.hot}
export function projectileStyle(type){return PROJECTILE_STYLE[type]||null}
export function projectileType(projectile){return projectile.type||projectile.projectileType||null}

// Positions and velocities come directly from core snapshots. Nothing extrapolates past removal.
export class ProjectileView {
  constructor(parent,capacity=192,resources={}) {
    this.root=new Group();this.root.name='Authoritative projectile bodies';parent.add(this.root)
    this.bodies=new BulletBatch(this.root,capacity,resources)
    this.slots=Array.from({length:capacity},()=>({id:null,seen:0,type:null,pos:new Vector3(),
      direction:new Vector3(),distance:0,style:null,speed:0,age:0}))
    this.liveIds=new Set()
    this.serial=0;this.lastTick=null;this.timeScale=1;this.forward=new Vector3(0,0,1)
    this.counts={round:0,bolt:0,shell:0,grenade:0,unknown:0,dropped:0}
    this.temp=new Object3D();this.to=new Vector3();this.velocity=new Vector3()
    this.shells=new InstancedMesh(surfaceGeometry(new CylinderGeometry(.035,.055,.22,10),2),resources.shellMaterial||solidMaterial(),capacity)
    const smokeMaterial=this.bodies.trail.material.clone()
    smokeMaterial.name='Faint shell smoke';smokeMaterial.color.setHex(0x33312e);smokeMaterial.emissiveIntensity=0;smokeMaterial.opacity=.12
    this.smoke=new InstancedMesh(this.bodies.trail.geometry.clone(),smokeMaterial,capacity)
    this.smoke.name='Instanced short shell smoke';this.smoke.count=0;this.smoke.frustumCulled=false;this.smoke.raycast=()=>{}
    this.smoke.instanceMatrix.setUsage(DynamicDrawUsage);this.root.add(this.smoke)
    this.shells.name='Instanced spinning 40 mm shells';this.shells.frustumCulled=false;this.shells.count=0
    this.shells.raycast=()=>{};this.shells.instanceMatrix.setUsage(DynamicDrawUsage);this.root.add(this.shells)
    this.lights=Array.from({length:2},()=>{const light=new PointLight(0xbc57ff,0,4.5,2);light.visible=false;this.root.add(light);return light})
    this.lightCandidates=this.lights.map(()=>({active:false,distance:Infinity,pos:new Vector3(),style:null}))
  }
  slot(id) {
    let free=null
    for(const p of this.slots){if(p.id===id)return p;if(p.id===null&&!free)free=p}
    if(free){free.id=id;free.age=0;free.distance=0;free.seen=0;return free}
    this.counts.dropped++;return null
  }
  sync(world,camera) {
    const dt=this.lastTick===null?0:Math.max(0,(world.tick-this.lastTick)/60);this.lastTick=world.tick
    this.serial++;this.bodies.begin();this.shells.count=0;this.smoke.count=0
    this.counts.round=0;this.counts.bolt=0;this.counts.shell=0;this.counts.grenade=0;this.counts.unknown=0
    for(let i=0;i<this.lights.length;i++){this.lights[i].intensity=0;this.lights[i].visible=false;this.lightCandidates[i].active=false}
    // Release missing ids before admission, so a full pool accepts replacements immediately.
    this.liveIds.clear()
    for(const projectile of world.projectiles)this.liveIds.add(projectile.id)
    for(const slot of this.slots)if(slot.id!==null) {
      if(!this.liveIds.has(slot.id)){slot.id=null;slot.seen=0}
    }
    for(const p of world.projectiles) {
      const type=projectileType(p),base=projectileStyle(type)
      if(!base){this.counts.unknown++;continue}
      this.counts[type]++;if(type==='grenade')continue
      const slot=this.slot(p.id);if(!slot)continue
      const fresh=slot.seen===0
      slot.seen=this.serial;slot.type=type;slot.age+=dt
      this.to.copy(p.pos);this.velocity.copy(p.vel)
      const speed=this.velocity.length()
      if(speed>.001)this.velocity.multiplyScalar(1/speed);else this.velocity.set(0,0,1)
      const style=type==='bolt'&&p.owner==='player'?PLAYER_BOLT:base
      if(!fresh)slot.distance+=slot.pos.distanceTo(this.to)
      slot.direction.copy(this.velocity);slot.speed=speed;slot.style=style
      if(type==='round'||type==='bolt') {
        this.bodies.add(this.to,this.velocity,style,speed,this.timeScale,slot.distance+style.length)
        if(type==='bolt')this.offerLight(this.to,style,camera)
      } else {
        if(slot.distance>0){
          this.temp.position.copy(this.to);this.temp.quaternion.setFromUnitVectors(this.forward,this.velocity)
          this.temp.scale.set(.04,.04,Math.min(1.2,slot.distance));this.temp.updateMatrix()
          this.smoke.setMatrixAt(this.smoke.count++,this.temp.matrix)
        }
        this.temp.position.copy(this.to);this.to.add(this.velocity);this.temp.lookAt(this.to)
        this.temp.rotateX(Math.PI/2);this.temp.rotateY(slot.age*24);this.temp.scale.setScalar(p.owner==='unit'?2:1)
        this.temp.updateMatrix();this.shells.setMatrixAt(this.shells.count++,this.temp.matrix)
      }
      slot.pos.copy(p.pos)
    }
    this.bodies.finish();this.shells.visible=this.shells.count>0
    if(this.shells.count)this.shells.instanceMatrix.needsUpdate=true
    this.smoke.visible=this.smoke.count>0;if(this.smoke.count)this.smoke.instanceMatrix.needsUpdate=true
    let lightIndex=0
    for(const candidate of this.lightCandidates)if(candidate.active){
      const light=this.lights[lightIndex++],style=candidate.style
      light.position.copy(candidate.pos);light.color.setRGB(style.hot[0],style.hot[1],style.hot[2]);light.intensity=1.4;light.visible=true
    }
  }
  offerLight(position,style,camera) {
    const distance=camera?position.distanceToSquared(camera.position):0
    let slot=-1,worst=-1,worstDistance=-1
    for(let i=0;i<this.lightCandidates.length;i++){
      const candidate=this.lightCandidates[i]
      if(!candidate.active){slot=i;break}
      if(candidate.distance>worstDistance){worstDistance=candidate.distance;worst=i}
    }
    if(slot<0){if(distance>=worstDistance)return;slot=worst}
    const candidate=this.lightCandidates[slot]
    candidate.active=true;candidate.distance=distance;candidate.pos.copy(position);candidate.style=style
  }
  primeWarmup(camera) {
    this.sync({tick:1,projectiles:[
      {id:'warmup-round',type:'round',owner:'unit',pos:{x:-.3,y:1,z:5},vel:{x:0,y:0,z:90}},
      {id:'warmup-bolt',type:'bolt',owner:'unit',pos:{x:0,y:1,z:6},vel:{x:0,y:0,z:42}},
      {id:'warmup-player-bolt',type:'bolt',owner:'player',pos:{x:.3,y:1,z:7},vel:{x:0,y:0,z:55}},
      {id:'warmup-shell',type:'shell',owner:'unit',pos:{x:.6,y:1,z:8},vel:{x:0,y:0,z:32}},
    ]},camera)
    return()=>this.reset()
  }
  reset() {
    for(const slot of this.slots){slot.id=null;slot.seen=0}
    this.serial=0;this.lastTick=null;this.bodies.begin();this.bodies.finish();this.shells.count=0;this.shells.visible=false
    this.smoke.count=0;this.smoke.visible=false
    for(const light of this.lights){light.intensity=0;light.visible=false}
  }
  dispose() {
    this.bodies.dispose();this.shells.dispose();this.shells.geometry.dispose();this.shells.material.dispose()
    this.smoke.dispose();this.smoke.geometry.dispose();this.smoke.material.dispose()
    releaseSubtree(this.root);this.root.removeFromParent()
  }
}
