import {Group, Vector3} from 'threepipe'
import {BulletBatch} from './bullet-batch.js'
import {rayColliders} from './fx-world.js'

// Visual calibre exaggeration and speed calibration. See docs/reference/bullets/NOTES.md.
const COPPER=[.95,.43,.16], HOT=[1,.83,.48]
export const BULLET_STYLE=Object.freeze({
  pistol:{length:.105,width:.065,speed:55,trail:.06,emissive:1.8,color:COPPER,hot:HOT},
  m4:{length:.19,width:.045,speed:60,trail:.10,emissive:2.4,color:COPPER,hot:HOT},
  shotgun:{length:.06,width:.032,speed:50,trail:.035,emissive:1.5,color:COPPER,hot:HOT},
  sniper:{length:.28,width:.060,speed:80,trail:.14,emissive:4,color:COPPER,hot:[1,.92,.7]},
  plasma:{length:.24,width:.085,speed:45,trail:.18,emissive:8,color:[.12,.6,1],hot:[.15,.65,1],plasma:true},
})
export function flightTime(distance,speed) {return Math.max(0,distance)/Math.max(.001,speed)}
export function isBulletShot(event) {return event.type==='shot'&&!event.unitType&&!!event.origin&&!!BULLET_STYLE[event.weapon]}

export class BulletPool {
  constructor(parent,capacity=256,resources={}) {
    this.batch=new BulletBatch(parent,capacity,resources)
    this.items=Array.from({length:capacity},()=>({active:false,from:new Vector3(),to:new Vector3(),direction:new Vector3(),
      position:new Vector3(),distance:0,age:0,style:BULLET_STYLE.m4}))
    this.next=0;this.active=0;this.emitted=0;this.overwritten=0;this.timeScale=1
  }
  emit(from,to,weapon='m4',age=0) {
    const style=BULLET_STYLE[weapon];if(!style)return null
    const p=this.items[this.next++%this.items.length]
    if(p.active)this.overwritten++
    p.from.copy(from);p.to.copy(to);p.direction.subVectors(to,from);p.distance=p.direction.length()
    if(p.distance<.001){p.active=false;return null}
    p.direction.multiplyScalar(1/p.distance);p.age=age;p.style=style;p.active=true;this.emitted++
    return p
  }
  advance(dt){if(dt>0)for(const p of this.items)if(p.active)p.age+=dt}
  update(dt) {
    this.advance(dt)
    this.batch.begin();this.active=0
    for(let i=0;i<this.items.length;i++) {
      const p=this.items[i];if(!p.active)continue
      if(p.age<0)continue
      const travel=p.age*p.style.speed
      if(travel>=p.distance){p.active=false;continue}
      p.position.copy(p.from).addScaledVector(p.direction,travel);this.active++
      this.batch.add(p.position,p.direction,p.style,p.style.speed,this.timeScale,travel+p.style.length)
    }
    this.batch.finish()
  }
  reset(){for(const p of this.items)p.active=false;this.active=0;this.batch.begin();this.batch.finish()}
  dispose(){this.batch.dispose()}
}

// A separate fixed pool keeps pending impacts intact when bullet rendering saturates.
// Records retain event identities after delivery so later audio/HUD readers suppress duplicates.
export class ImpactQueue {
  constructor(capacity=2048) {
    this.items=Array.from({length:capacity},()=>({active:false,event:null,shot:null,due:0,kind:null,
      position:new Vector3(),normal:new Vector3(),surface:null,weapon:null,plate:null}))
    this.next=0;this.pending=0;this.delivered=0;this.dropped=0
  }
  schedule(event,shot,kind,due,position,normal,surface=null) {
    let slot=null
    for(let i=0;i<this.items.length;i++) {
      const p=this.items[this.next++%this.items.length]
      if(!p.active){slot=p;break}
    }
    if(!slot){this.dropped++;return null}
    slot.active=true;slot.event=event;slot.shot=shot;slot.kind=kind;slot.due=due;slot.surface=surface;slot.plate=null
    slot.weapon=shot.weapon;slot.position.copy(position);slot.normal.copy(normal);this.pending++
    return slot
  }
  has(event) {for(const p of this.items)if(p.event===event)return true;return false}
  flush(time,deliver) {
    for(const p of this.items)if(p.active&&time>=p.due) {
      p.active=false;this.pending--;this.delivered++;deliver(p)
    }
  }
  reset(){for(const p of this.items){p.active=false;p.event=null;p.shot=null;p.plate=null};this.pending=0}
}

export class BulletView {
  constructor(parent,resources={}) {
    this.root=new Group();this.root.name='Player bullet flights';parent.add(this.root)
    this.pool=new BulletPool(this.root,256,resources);this.impacts=new ImpactQueue()
    this.eventIndex=null;this.lastTick=null;this.lastTime=null;this.manager=null
    this.from=new Vector3();this.to=new Vector3();this.direction=new Vector3();this.normal=new Vector3()
    this.hit={distance:0,normal:this.normal,collider:null}
    this.deliver=p=>this.arrive(p)
  }
  sync(world,localMuzzle,colliders=null) {
    if(this.lastTick!==null&&world.tick<this.lastTick){this.reset();this.lastTime=null;this.eventIndex=world.eventLog.length}
    const now=Math.max(this.lastTime??0,world.tick/60+(this.manager?.range?.clock.accumulator||0))
    const dt=this.lastTime===null?0:Math.max(0,now-this.lastTime)
    this.lastTime=now
    this.lastTick=world.tick;this.world=world
    this.pool.timeScale=this.manager?.range?.clock.scale??1
    this.pool.advance(dt)
    if(this.eventIndex===null||this.eventIndex>world.eventLog.length)this.eventIndex=world.eventLog.length
    for(;this.eventIndex<world.eventLog.length;this.eventIndex++) {
      const e=world.eventLog[this.eventIndex];if(!isBulletShot(e))continue
      const style=BULLET_STYLE[e.weapon],player=world.players?.get(e.playerId||e.by)||world.player
      const localId=this.manager?.localPlayerId||world.localPlayerId||world.player.id
      this.from.copy(e.origin)
      if(e.by===localId&&localMuzzle)this.from.copy(localMuzzle)
      else {
        this.from.x+=Math.sin(player.yaw)*.6-Math.cos(player.yaw)*.17
        this.from.y-=.15;this.from.z+=Math.cos(player.yaw)*.6+Math.sin(player.yaw)*.17
      }
      const rig=e.by===localId&&e.weapon==='pistol'?this.manager?.playerView?.weapons?.rigs?.pistol:null
      const fire=rig?.root.userData.viewModel?.fire
      const delay=fire?.discharge===undefined?0:Math.max(0,fire.discharge-(rig.clipPlayer?.actions.get('Fire').time||0))
      // The viewmodel samples fixed ticks. Include the bullet clock's fractional tick
      // when scheduling discharge, so interpolation cannot release a bullet early.
      const start=fire?.discharge===undefined?Math.min(world.tick,(e.tick??world.tick)+1)/60:now+delay,age=now-start
      // Damage precedes its enclosing shot in the core log. Match shooter, tick and weapon.
      let first=this.eventIndex,damages=0,firstDue=Infinity,lastDamage=null
      while(first>0) {
        const prior=world.eventLog[first-1]
        if(prior.tick!==e.tick||prior.type==='shot')break
        first--
      }
      for(let i=first;i<this.eventIndex;i++) {
        const hit=world.eventLog[i]
        if(hit.type!=='unit_damage'||hit.weapon!==e.weapon||(hit.playerId||e.by)!==e.by||!(hit.point||hit.pos))continue
        const point=hit.point||hit.pos,due=start+flightTime(this.from.distanceTo(point),style.speed)
        this.normal.copy(hit.normal||this.direction.subVectors(this.from,point).normalize())
        this.impacts.schedule(hit,e,'unit',due,point,this.normal,'unit')
        firstDue=Math.min(firstDue,due);lastDamage=hit;damages++
        for(let j=i+1;j<this.eventIndex;j++){
          const kill=world.eventLog[j]
          if(kill.type==='kill'&&kill.unitId===hit.unitId&&!this.handles(kill))
            this.impacts.schedule(kill,e,'kill',due,point,this.normal,'unit')
        }
      }
      if(e.paths?.length) {
        // Preserve every authoritative pellet path.
        for(let i=0;i<e.paths.length;i++) {
          const path=e.paths[i];this.to.copy(path.point)
          this.pool.emit(this.from,this.to,e.weapon,age)
          // A recorded damage point owns unit particles; other hit paths own wall particles.
          let unitPath=false
          for(let j=first;j<this.eventIndex;j++) {
            const hit=world.eventLog[j],point=hit.point||hit.pos
            if(hit.type==='unit_damage'&&hit.weapon===e.weapon&&(hit.playerId||e.by)===e.by&&point&&this.to.distanceToSquared(point)<.0001){unitPath=true;break}
          }
          if(path.hit&&!unitPath) {
            this.direction.copy(path.direction)
            const hit=rayColliders(e.origin,this.direction,colliders||[],this.hit)
            this.normal.copy(hit?.normal||this.direction).multiplyScalar(hit?1:-1)
            this.impacts.schedule(null,e,'surface',start+flightTime(this.from.distanceTo(this.to),style.speed),this.to,this.normal,hit?.collider.kind||'concrete')
          }
        }
      } else if(lastDamage) {
        // Normal matches omit paths. Confirmed damage points and directions remain exact.
        if(e.weapon==='shotgun') {
          for(let i=first;i<this.eventIndex;i++) {
            const hit=world.eventLog[i]
            if(hit.type==='unit_damage'&&hit.weapon===e.weapon&&(hit.playerId||e.by)===e.by)
              this.pool.emit(this.from,hit.point||hit.pos,e.weapon,age)
          }
          for(let i=damages;i<(world.weaponCatalog?.weapons.shotgun.pellets||8);i++) {
            this.direction.set(Math.sin(player.yaw)*Math.cos(player.pitch||0),Math.sin(player.pitch||0),Math.cos(player.yaw)*Math.cos(player.pitch||0))
            const hit=rayColliders(e.origin,this.direction,colliders||[],this.hit)
            this.to.copy(e.origin).addScaledVector(this.direction,hit?.distance||100)
            this.pool.emit(this.from,this.to,e.weapon,age)
          }
        } else this.pool.emit(this.from,lastDamage.point||lastDamage.pos,e.weapon,age)
      } else {
        this.direction.copy(e.direction||this.normal.set(Math.sin(player.yaw)*Math.cos(player.pitch||0),Math.sin(player.pitch||0),Math.cos(player.yaw)*Math.cos(player.pitch||0)))
        const endpoint=e.hitPoint||e.point||e.target
        const hit=endpoint?null:rayColliders(e.origin,this.direction,colliders||[],this.hit)
        if(endpoint)this.to.copy(endpoint)
        else this.to.copy(e.origin).addScaledVector(this.direction,hit?.distance||100)
        // Legacy events carry no random miss rays. Reuse the known ray, without RNG or gameplay queries.
        const count=e.weapon==='shotgun'?(world.weaponCatalog?.weapons.shotgun.pellets||8):1
        for(let i=0;i<count;i++)this.pool.emit(this.from,this.to,e.weapon,age)
        if(hit||e.hit) {
          this.normal.copy(hit?.normal||this.direction).multiplyScalar(hit?1:-1)
          const due=start+flightTime(this.from.distanceTo(this.to),style.speed)
          this.impacts.schedule(null,e,'surface',due,this.to,this.normal,e.hit?'unit':hit.collider.kind)
          firstDue=due
        }
      }
      const finalPoint=e.paths?.[0]?.point||lastDamage?.point||lastDamage?.pos||this.to
      const due=Number.isFinite(firstDue)?firstDue:start+flightTime(this.from.distanceTo(finalPoint),style.speed)
      this.impacts.schedule(e,e,'shot',due,finalPoint,this.normal)
    }
    this.pool.update(0)
  }
  handles(event){return this.impacts.has(event)}
  handlesMarker(id) {
    const separator=id.indexOf(':'),tick=Number(id.slice(0,separator)),weapon=id.slice(separator+1)
    for(const p of this.impacts.items)if(p.kind==='shot'&&p.event?.tick===tick&&p.weapon===weapon&&(p.event.playerId||p.event.by)===(this.manager?.localPlayerId||this.world?.player.id))return true
    return false
  }
  primeWarmup() {
    const from=new Vector3(0,1,0)
    for(const [index,weapon] of Object.keys(BULLET_STYLE).entries())this.pool.emit(from,new Vector3(index*.2,1,8+index),weapon,.04)
    this.pool.update(0)
    return()=>this.reset()
  }
  flush(){
    const before=this.impacts.delivered
    this.impacts.flush(this.lastTime,this.deliver)
    if(this.impacts.delivered!==before){
      const m=this.manager
      m?.unitView?.fx.update(0,m.world.nav)
      const fx=m?.playerView?.weapons.worldFx
      if(fx)for(const pool of fx.poolList)pool.update(0,m.playerView.camera)
    }
  }
  arrive(p) {
    const m=this.manager;if(!m)return
    const e=p.event,world=m.world
    if(p.kind==='surface')m.playerView.weapons.worldFx.impact(p.position,p.normal,p.surface,p.weapon==='plasma',p.shot.tick||0,p.weapon==='sniper'?1.65:1)
    if(p.kind==='unit') {
      // Commons own an instance instead of a scene node; both have presentation.
      if(m.unitView?.hasPresentation(e.unitId)&&world.unitById?.has(e.unitId))m.unitView.damageEvent(world,e)
      else m.playerView?.weapons.worldFx.impact(p.position,p.normal,'unit',p.weapon==='plasma',p.shot.tick||0,p.weapon==='sniper'?1.65:1)
      m.audioBindings?.bulletImpact(e,p.position)
    }
    if(p.kind==='kill')m.unitView?.killEffect(world,e,p.position)
    if(p.kind==='shot') {
      m.unitView?.fx.gore.hitWrecks(e,m.unitView.visuals,world.players?.get(e.playerId)||world.player)
      if(e.hit&&(e.playerId||e.by)===(m.localPlayerId||world.player.id))m.hud?.showHit(e.killed?'kill':e.headshot?'headshot':'hit')
      m.audioBindings?.bulletImpact(e,p.position)
    }
    if(p.kind==='plate'&&p.plate) {
      p.plate.lastHit=world.tick;p.plate.hits++;m.rangeView?.ring(p.plate)
    }
  }
  reset(){this.pool.reset();this.impacts.reset()}
  dispose(){this.reset();this.pool.dispose();this.root.removeFromParent();this.manager=null;this.world=null}
}

// Wire adapters before they consume events. Call flush after UnitView has synchronized its bodies.
export function bindBulletPresentation(manager) {
  const bullets=manager.playerView?.weapons?.bullets;if(!bullets)return null
  bullets.manager=manager
  if(manager.unitView)manager.unitView.bullets=bullets
  if(manager.hud)manager.hud.bullets=bullets
  if(manager.audioBindings)manager.audioBindings.bullets=bullets
  return bullets
}
