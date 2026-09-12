import {Group, Vector3, Object3D, BoxGeometry, CylinderGeometry, PlaneGeometry, SphereGeometry, PointLight, UnlitMaterial, PhysicalMaterial, TextureLoader, AdditiveBlending, DoubleSide, SRGBColorSpace, Color, Quaternion} from 'threepipe'
import {FxPool} from './fx-pool.js'
import {weaponAsset,weaponSurfaceMaps} from './weapons-materials.js'
import {colliderSurfacesAt, rayCollider} from '../core/collision.js'

const AXES=['x','y','z']
const ZERO=new Vector3(),UP=new Vector3(0,1,0),FORWARD=new Vector3(0,0,1)
const loader=new TextureLoader()
function sprite(name,additive=false) {
  const map=loader.load(weaponAsset(`fx-${name}.png`));map.colorSpace=SRGBColorSpace
  return new UnlitMaterial({name:`Weapon ${name}`,map,transparent:true,depthWrite:false,side:DoubleSide,
    ...(additive?{blending:AdditiveBlending}:{})})
}
export function surfaceGeometry(geometry,tile) {
  const uv=geometry.attributes.uv
  for(let i=0;i<uv.count;i++)uv.setXY(i,((tile%4)+(.02+uv.getX(i)*.96))/4,(3-Math.floor(tile/4)+(.02+uv.getY(i)*.96))/4)
  geometry.setAttribute('uv1',uv.clone());return geometry
}
export function solidMaterial() {
  const maps=weaponSurfaceMaps()
  return new PhysicalMaterial({name:'Textured brass and impact fragments',map:maps.albedo,normalMap:maps.normal,
    roughnessMap:maps.roughness,metalnessMap:maps.metalness,aoMap:maps.ao,metalness:1,roughness:1})
}

export class WeaponWorldFx {
  constructor(parent) {
    this.root=new Group();this.root.name='Weapon world impacts, smoke and brass';parent.add(this.root)
    this.eventIndex=null;this.lastTick=null;this.v=new Vector3();this.to=new Vector3();this.normal=new Vector3();this.velocity=new Vector3();this.travel=new Vector3();this.size=new Vector3()
    this.matrix=new Object3D();this.lightAge=0;this.camera=null;this.colliders=[]
    this.rayHit={distance:0,normal:this.normal,collider:null}
    const metal=solidMaterial()
    const concrete=new PhysicalMaterial({name:'Concrete impact fragments',map:loader.load(new URL('../../assets/textures/map/concrete_wall_007_diff_1k.jpg',import.meta.url).href),
      normalMap:loader.load(new URL('../../assets/textures/map/concrete_wall_007_nor_gl_1k.jpg',import.meta.url).href),
      roughnessMap:loader.load(new URL('../../assets/textures/map/concrete_wall_007_arm_1k.jpg',import.meta.url).href),metalness:0,roughness:1})
    concrete.map.colorSpace=SRGBColorSpace;concrete.aoMap=concrete.roughnessMap
    this.pools={
      concrete:new FxPool(this.root,'48 textured concrete impact chips',new BoxGeometry(1,1,1),concrete,48,{gravity:9.8,bounce:true}),
      smoke:new FxPool(this.root,'48 pooled smoke wisps',new PlaneGeometry(1,1),sprite('smoke'),48,{billboard:true,growth:1.1,fade:true}),
      sparks:new FxPool(this.root,'96 pooled hot sparks',new BoxGeometry(1,1,1),new UnlitMaterial({color:0xffc277,blending:AdditiveBlending,transparent:true,depthWrite:false}),96,{gravity:7,fade:true}),
      chips:new FxPool(this.root,'48 pooled PBR fragments',surfaceGeometry(new BoxGeometry(1,1,1),0),metal,48,{gravity:9.8,bounce:true}),
      brass:new FxPool(this.root,'24 pooled bouncing cartridge cases',surfaceGeometry(new CylinderGeometry(.007,.007,.028,8),7),metal,24,{gravity:9.8,bounce:true}),
      holes:new FxPool(this.root,'64 persistent bullet impacts',new PlaneGeometry(1,1),sprite('hole'),64),
      scorch:new FxPool(this.root,'16 persistent plasma and blast scorches',new PlaneGeometry(1,1),sprite('scorch'),16),
      blast:new FxPool(this.root,'4 pooled explosion flashes',new PlaneGeometry(1,1),sprite('blast',true),4,{billboard:true,fade:true,growth:12}),
      rings:new FxPool(this.root,'4 pooled expanding shockwaves',new PlaneGeometry(1,1),sprite('shockwave',true),4,{growth:20,fade:true}),
    }
    for(const key of ['holes','scorch']){const m=this.pools[key].mesh.material;m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-2}
    this.light=new PointLight(0xffb45d,0,8,2);this.light.name='Weapon muzzle and blast illumination';this.root.add(this.light)
    this.stats={tracers:0,wallImpacts:0,scorches:0,explosions:0,bounces:0}
    this.onSound=null
    this.onBrassBounce=(p,energy)=>{this.stats.bounces++;this.onSound?.('shell-bounce',{position:{x:p.pos.x,y:p.pos.y,z:p.pos.z},energy,weapon:p.weapon})}
    this.poolList=Object.values(this.pools)
  }
  emit(pool,pos,velocity,size,life,color) {return this.pools[pool].emit(pos,velocity,size,life,color)}
  flash(position,plasma=false,power=7,age=.06) {
    if(this.lightAge>0&&this.lightMax>.1&&power<this.lightPower)return
    this.light.position.copy(position);this.light.color.set(plasma?0x72dfff:0xffb05a)
    this.light.intensity=power;this.lightAge=age;this.lightMax=age;this.lightPower=power
  }
  sync(world,camera) {
    this.camera=camera
    const dt=this.lastTick===null?0:Math.max(0,Math.min(.2,(world.tick-this.lastTick)/60));this.lastTick=world.tick
    if(this.eventIndex===null)this.eventIndex=world.eventLog.length
    for(;this.eventIndex<world.eventLog.length;this.eventIndex++) {
      const event=world.eventLog[this.eventIndex]
      if(event.type==='explosion'&&event.pos)this.explode(event.pos)
      if(event.type==='shot'&&event.origin&&!event.unitType&&event.weapon!=='knife'&&event.weapon!=='launcher')this.shot(world,event)
      if(event.type==='projectile_hit'&&event.pos){
        this.to.copy(event.pos);this.normal.copy(event.normal||UP)
        let type=event.projectileType
        if(!type&&this.projectiles)for(let i=0;i<this.projectiles.slots.length;i++){const slot=this.projectiles.slots[i];if(slot.id===event.id){type=slot.type;break}}
        this.impact(this.to,this.normal,event.targetId?'unit':'concrete',type==='bolt',event.tick||world.tick,type==='shell'?2:1)
      }
    }
    for(let i=0;i<this.poolList.length;i++){const pool=this.poolList[i];pool.update(dt,camera,pool===this.pools.brass?this.onBrassBounce:null)}
    this.lightAge=Math.max(0,this.lightAge-dt)
    this.light.intensity=this.lightPower*Math.min(1,this.lightAge/Math.max(.001,this.lightMax))||0
  }
  shot(world,event) {
    const player=world.players?.get(event.playerId||event.by)||world.player
    this.v.set(event.origin.x,event.origin.y,event.origin.z)
    const pitch=player.pitch||0,yaw=player.yaw||0
    this.velocity.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch))
    const unit=event.hit?world.units.find(u=>u.id===event.unitId):null
    let hit=null
    if(unit) {
      const spec=world.unitCatalog.types[unit.type]
      this.to.set(unit.pos.x,unit.pos.y+spec.height*(event.headshot?.84:.5),unit.pos.z)
    } else {
      // The core omits miss endpoints. Reconstruct only the cosmetic center ray;
      // never call hitscan or consume core RNG to produce visual wall impacts.
      hit=rayColliders(this.v,this.velocity,this.colliders,this.rayHit)
      this.to.copy(this.v).addScaledVector(this.velocity,hit?.distance||70)
    }
    const plasma=event.weapon==='plasma'
    const scale=event.weapon==='sniper'?1.65:event.weapon==='shotgun'?1.45:plasma?1.6:1
    if(hit)this.impact(this.to,hit.normal,hit.collider.kind,plasma,event.tick||world.tick,scale)
    else if(unit) {
      this.normal.subVectors(this.v,this.to).normalize()
      this.impact(this.to,this.normal,'unit',plasma,event.tick||world.tick,scale)
    }
  }
  impact(pos,normal,kind,plasma,seed=0,scale=1) {
    const isMetal=kind==='unit'||kind==='truck'||kind==='barrel'||kind==='container'||kind==='door'
    this.v.copy(pos).addScaledVector(normal,.008)
    if(kind!=='unit'){
      const decal=this.emit(plasma?'scorch':'holes',this.v,ZERO,this.size.setScalar((plasma?.45:.11)*scale),90)
      decal.quaternion.setFromUnitVectors(FORWARD,normal)
    }
    this.stats.wallImpacts++;if(plasma)this.stats.scorches++
    for(let i=0;i<(isMetal?7:5);i++){
      const a=i*2.399+seed
      this.velocity.set(Math.sin(a)*1.1,.4+(i%3)*.4,Math.cos(a)*1.1).addScaledVector(normal,1.5)
      this.emit(isMetal?'sparks':'concrete',this.v,this.velocity,this.size.set(isMetal?.012:.024,isMetal?.012:.018,isMetal?.14:.028).multiplyScalar(scale),isMetal?.3:1.2,isMetal?0xffc078:0x9c9c8d)
    }
    if(isMetal)for(let i=0;i<3;i++){
      this.velocity.set(Math.sin(seed+i)*1.8,.6+i*.4,Math.cos(seed+i)*1.8).addScaledVector(normal,1.2)
      this.emit('chips',this.v,this.velocity,this.size.set(.032,.012,.043).multiplyScalar(scale),.8+i*.12)
    }
    this.emit('smoke',this.v,this.velocity.copy(normal).multiplyScalar(.25).add(UP),this.size.setScalar((plasma?.35:.20)*scale),plasma?1.6:.85,isMetal?0x4e5659:0xb0a694)
  }
  explode(pos) {
    this.v.set(pos.x,pos.y,pos.z);this.stats.explosions++
    this.flash(this.v,false,45,.19)
    this.emit('blast',this.v,ZERO,this.size.setScalar(1.6),.19,0xffdbb2)
    const ring=this.emit('rings',this.v,ZERO,this.size.setScalar(.45),.40)
    ring.quaternion.setFromUnitVectors(FORWARD,UP)
    const decal=this.emit('scorch',this.to.set(pos.x,.013,pos.z),ZERO,this.size.setScalar(3),90)
    decal.quaternion.setFromUnitVectors(FORWARD,UP)
    for(let i=0;i<24;i++) {
      const a=i*2.399
      this.velocity.set(Math.sin(a)*(2+i%4),2.4+i%5,Math.cos(a)*(2+i%4))
      this.emit(i%2?'sparks':'chips',this.v,this.velocity,this.size.set(.025,.02,i%2?.24:.05),.7+(i%5)*.2,i%2?0xffb75d:0x8e8274)
      if(i<10)this.emit('smoke',this.v,this.velocity.multiplyScalar(.25),this.size.setScalar(.55+(i%3)*.2),2.3+i*.08,0x655f56)
    }
    this.onSound?.('explosion-flash',{position:{...pos}})
  }
  eject(rig,id) {
    rig.root.updateWorldMatrix(true,true)
    this.v.set(.075,.035,id==='pistol'?-.065:0).applyMatrix4(rig.root.matrixWorld)
    this.velocity.set(1.4+(this.stats.bounces%3)*.25,1.3,.3).applyQuaternion(this.camera?.quaternion||rig.root.quaternion)
    const p=this.emit('brass',this.v,this.velocity,this.size.setScalar(id==='launcher'?4:id==='shotgun'?1.7:id==='sniper'?1.4:1),3.8,id==='shotgun'?0xb85b42:0xffffff)
    p.weapon=id;p.floor=this.floorAt(p.pos)
  }
  floorAt(pos) {
    let top=0
    for(const collider of this.colliders)for(const surface of colliderSurfacesAt(pos,collider))if(surface.top<pos.y&&surface.top>top)top=surface.top
    return top
  }
  dispose() {this.onSound=null;this.camera=null;this.light.intensity=0;for(const pool of Object.values(this.pools))pool.dispose()}
}

// Read the same fitted gameplay primitives as deterministic shot occlusion.
export function rayColliders(origin,direction,colliders,result=null) {
  let best=null
  for(const collider of colliders) {
    const hit=rayCollider(origin,direction,collider,100)
    if(hit&&hit.distance>.01&&(!best||hit.distance<best.distance)){
      best=result||{distance:0,normal:new Vector3(),collider:null}
      best.distance=hit.distance;best.normal.set(hit.normal.x,hit.normal.y,hit.normal.z);best.collider=collider
    }
  }
  return best
}
