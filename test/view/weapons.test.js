import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData??=class {}
globalThis.window??={}
const E=await import('threepipe')
const {TracerPool,TracerView,TRACER_STYLE}=await import('../../lib/view/tracers.js')
const {ProjectileView,projectileStyle,projectileType}=await import('../../lib/view/projectiles.js')
const {createWeaponRigs,WEAPON_IDS}=await import('../../lib/view/weapons.js')
const {GrenadeView}=await import('../../lib/view/grenade.js')
const {WeaponAnimation}=await import('../../lib/view/weapons-animation.js')

function worldFixture(){
  const specs={pistol:{rate:6,mag:15,reloadSeconds:1.6},m4:{rate:11,mag:30,reloadSeconds:2},
    shotgun:{rate:1.2,mag:8,reloadSeconds:3,spreadDeg:7},plasma:{rate:3,mag:20,reloadSeconds:2.4},
    sniper:{rate:1.2,mag:10,reloadSeconds:2.6,aimFov:30},launcher:{rate:1,mag:1,reloadSeconds:2.2},
    knife:{rate:2},grenade:{}}
  const p={id:'player',activeWeapon:'pistol',pos:{x:0,y:0,z:0},vel:{x:0,y:0,z:0},yaw:0,pitch:0,
    ammo:Object.fromEntries(WEAPON_IDS.map(id=>[id,{mag:specs[id].mag||1,reserve:60}])),reloadTimer:0,aiming:false,grenadeCooldown:1}
  return {tick:0,player:p,players:new Map([[p.id,p]]),weaponCatalog:{weapons:specs},eventLog:[],projectiles:[],
    unitById:new Map(),unitCatalog:{types:{}},activeColliders:()=>[]}
}
function animationFixture(){
  const rigs=createWeaponRigs(new E.Group(),new E.PhysicalMaterial()),world=worldFixture()
  const effects={flashes:0,cases:0,update(){},fire(){this.flashes++},eject(){this.cases++}}
  const animation=new WeaponAnimation(rigs,effects);animation.sync(world)
  return {rigs,world,effects,animation,step(n=1){world.tick+=n;animation.sync(world)}}
}

test('tracer buffers and slot objects remain fixed after overflow and 10000 warm events',()=>{
  const pool=new TracerPool(new E.Group(),32),a=new E.Vector3(),b=new E.Vector3(0,0,30)
  const items=[...pool.items],buffers=[pool.batch.start,pool.batch.end,pool.batch.color,pool.batch.shape]
  for(let i=0;i<10000;i++){pool.emit(a,b,'m4');pool.update(1/600)}
  assert.equal(pool.items.length,32);assert.ok(pool.overwritten>0)
  for(let i=0;i<32;i++)assert.equal(pool.items[i],items[i])
  for(const [i,buffer] of [pool.batch.start,pool.batch.end,pool.batch.color,pool.batch.shape].entries())assert.equal(buffer,buffers[i])
  assert.ok(pool.batch.geometry.instanceCount<=32)
  pool.update(2);assert.equal(pool.active,0);assert.equal(pool.batch.mesh.visible,false)
  pool.dispose()
})

test('30 metre tracer travels for 0.2 seconds, clips its head, and fades behind impact',()=>{
  const pool=new TracerPool(new E.Group(),4),p=pool.emit(new E.Vector3(),new E.Vector3(0,0,30),'m4')
  pool.update(.1);assert.equal(pool.batch.end[2],15);assert.equal(p.active,true)
  pool.update(.1);assert.equal(pool.batch.end[2],30);assert.equal(p.active,true)
  pool.update(.02);assert.equal(p.active,true);assert.equal(pool.batch.end[2],30)
  assert.ok(pool.batch.shape[2]>0&&pool.batch.shape[2]<1)
  pool.update(.04);assert.equal(p.active,false)
  assert.equal(pool.emit(new E.Vector3(),new E.Vector3(0,0,1),'knife'),null)
  pool.dispose()
})

test('distant trajectories retain a full rifle trail, distinct widths, and bounded impact fade',()=>{
  const pool=new TracerPool(new E.Group(),8),from=new E.Vector3(),to=new E.Vector3(0,0,40)
  for(const id of ['pistol','m4','shotgun','plasma','sniper']) {
    pool.reset();pool.emit(from,to,id);pool.update(.25)
    assert.equal(pool.active,1);assert.equal(pool.batch.end[2],37.5)
    assert.ok(Math.abs(pool.batch.end[2]-pool.batch.start[2]-TRACER_STYLE[id].trail)<.00001)
    assert.equal(pool.batch.shape[2],1)
    pool.update(.025)
    assert.equal(pool.batch.end[2],40)
    if(pool.active)assert.ok(pool.batch.shape[2]>0&&pool.batch.shape[2]<1)
    pool.update(.2);assert.equal(pool.active,0)
  }
  assert.ok(TRACER_STYLE.m4.trail>=6);assert.ok(TRACER_STYLE.sniper.trail>=10)
  assert.ok(TRACER_STYLE.sniper.trail>TRACER_STYLE.m4.trail)
  assert.ok(TRACER_STYLE.pistol.width<TRACER_STYLE.m4.width)
  assert.ok(TRACER_STYLE.plasma.width>TRACER_STYLE.m4.width)
  pool.reset();pool.emit(from,new E.Vector3(0,0,.2),'sniper');pool.update(1/60)
  assert.ok(pool.batch.start[2]>=0);assert.ok(pool.batch.end[2]<=.200001)
  pool.update(.2);assert.equal(pool.active,0);pool.dispose()
})

test('incoming volleys keep long warning trails behind authoritative projectile heads',()=>{
  const view=new ProjectileView(new E.Group(),16,{shellMaterial:new E.PhysicalMaterial(),smokeMap:new E.Texture()})
  const world=worldFixture(),camera=new E.PerspectiveCamera()
  for(let i=0;i<12;i++)world.projectiles.push({id:i,type:i%2?'bolt':'round',owner:'unit',
    pos:{x:i-6,y:1.65,z:20},vel:{x:0,y:0,z:-18}})
  const snapshot=JSON.stringify(world.projectiles)
  view.sync(world,camera)
  for(let step=0;step<5;step++){world.tick+=6;view.sync(world,camera)}
  assert.equal(view.streaks.count,12);assert.equal(view.orbs.count,6)
  for(let i=0;i<12;i++){
    assert.equal(view.streaks.end[i*3+2],20)
    assert.equal(view.streaks.start[i*3+2],26)
    assert.ok(view.streaks.shape[i*4+2]>0&&view.streaks.shape[i*4+2]<=.75)
  }
  assert.equal(JSON.stringify(world.projectiles),snapshot)
  world.projectiles=[];view.sync(world,camera)
  assert.equal(view.streaks.count,0);assert.equal(view.lights[0].intensity,0)
  view.dispose()
})

test('shot events emit one travelling tracer or nine cosmetic shotgun pellets without replay',()=>{
  const world=worldFixture(),view=new TracerView(new E.Group()),muzzle=new E.Vector3(0,1.5,.6)
  view.sync(world,muzzle)
  const event={type:'shot',by:'player',weapon:'shotgun',origin:{x:0,y:1.65,z:0},hitPoint:{x:0,y:1.5,z:30}}
  world.eventLog.push(event);world.tick++
  const before=JSON.stringify(event);view.sync(world,muzzle)
  assert.equal(view.pool.emitted,9);view.sync(world,muzzle);assert.equal(view.pool.emitted,9)
  assert.equal(JSON.stringify(event),before);assert.equal(TRACER_STYLE.shotgun.pellets,9)
  world.eventLog.push({...event,unitType:'endo',by:'enemy',weapon:'m4'});view.sync(world,muzzle)
  assert.equal(view.pool.emitted,9);view.dispose()
})

test('projectile types map to bounded instanced renderers and leave snapshots unchanged',()=>{
  const view=new ProjectileView(new E.Group(),8,{shellMaterial:new E.PhysicalMaterial(),smokeMap:new E.Texture()})
  const world=worldFixture(),camera=new E.PerspectiveCamera()
  for(const [i,type] of ['round','bolt','shell','grenade'].entries())
    world.projectiles.push({id:i,type,owner:'unit',pos:{x:i,y:1,z:20},vel:{x:0,y:0,z:-18}})
  const snapshot=JSON.stringify(world.projectiles)
  view.sync(world,camera);world.tick=6;view.sync(world,camera)
  assert.equal(view.streaks.count,3);assert.equal(view.orbs.count,1);assert.equal(view.shells.count,1)
  assert.equal(view.counts.grenade,1);assert.equal(projectileStyle('grenade').renderer,'grenade')
  assert.equal(projectileType({projectileType:'bolt'}),'bolt')
  assert.equal(projectileStyle('unknown'),null);assert.equal(JSON.stringify(world.projectiles),snapshot)
  assert.equal(view.streaks.end[2],20)
  const slots=[...view.slots],array=view.shells.instanceMatrix.array
  for(let i=0;i<500;i++){world.projectiles[0].id=100+i;world.tick++;view.sync(world,camera)}
  assert.equal(view.slots.length,8);assert.equal(view.shells.instanceMatrix.array,array)
  for(let i=0;i<8;i++)assert.equal(slots[i],view.slots[i])
  world.projectiles=[];view.sync(world,camera);assert.equal(view.streaks.count,0);assert.equal(view.orbs.count,0)
  view.dispose()
})

test('all eight models have distinct mechanisms and finite vertices',()=>{
  const rigs=createWeaponRigs(new E.Group(),new E.PhysicalMaterial())
  assert.deepEqual(Object.keys(rigs),WEAPON_IDS)
  assert.ok(rigs.sniper.sight.scope);assert.equal(rigs.launcher.magazine.parent,rigs.launcher.breech)
  assert.ok(new E.Box3().setFromObject(rigs.sniper.body).getSize(new E.Vector3()).z>new E.Box3().setFromObject(rigs.m4.body).getSize(new E.Vector3()).z)
  for(const id of WEAPON_IDS){
    assert.ok(rigs[id].right);assert.ok(rigs[id].left);assert.ok(rigs[id].muzzle)
    rigs[id].root.traverse(object=>{
      if(!object.geometry)return
      assert.ok(object.geometry.attributes.uv);assert.ok(object.geometry.attributes.normal)
      assert.ok(object.geometry.attributes.position.array.every(Number.isFinite))
    })
  }
})

test('weapon switching lowers then raises, aims, sprints, and returns to idle',()=>{
  const f=animationFixture(),p=f.world.player
  p.activeWeapon='m4';f.step();assert.equal(f.animation.state.mode,'switch-lower')
  f.step(7);assert.equal(f.animation.state.mode,'switch-raise');assert.equal(f.animation.shown,'m4')
  f.step(10);p.aiming=true;f.step(1);assert.equal(f.animation.state.mode,'aim')
  f.step(8);assert.equal(f.animation.aimAmount,1)
  p.aiming=false;p.vel.z=7;f.step(10);assert.equal(f.animation.state.mode,'sprint')
  p.vel.z=0;f.step(20);assert.equal(f.animation.state.mode,'idle')
})

test('sniper reload exposes magazine, seats it, cycles its action, and settles',()=>{
  const f=animationFixture(),p=f.world.player;p.activeWeapon='sniper';f.step(20);f.step(20)
  f.world.eventLog.push({type:'reload',playerId:p.id,weapon:'sniper'})
  for(const [progress,phase] of [[.23,'remove'],[.42,'reach'],[.63,'seat'],[.83,'action'],[.97,'settle']]) {
    p.reloadTimer=2.6*(1-progress);f.step();assert.equal(f.animation.state.mode,'reload');assert.equal(f.animation.state.reloadPhase,phase)
    if(phase==='remove')assert.ok(f.rigs.sniper.root.rotation.x>.7)
    if(phase==='reach')assert.equal(f.rigs.sniper.magazine.visible,false)
    if(phase==='action')assert.ok(f.rigs.sniper.slide.position.z>.02)
  }
  p.reloadTimer=0;f.step();assert.equal(f.animation.state.mode,'idle');assert.equal(f.rigs.sniper.slide.position.z,0)
})

test('launcher opens its complete breech, ejects once, inserts a shell and closes',()=>{
  const f=animationFixture(),p=f.world.player;p.activeWeapon='launcher';f.step(20);f.step(20)
  f.world.eventLog.push({type:'reload',playerId:p.id,weapon:'launcher'})
  p.reloadTimer=2.2*.7;f.step();assert.ok(f.rigs.launcher.breech.rotation.x<-.6);assert.equal(f.effects.cases,1)
  f.step();assert.equal(f.effects.cases,1)
  p.reloadTimer=2.2*.4;f.step();assert.equal(f.rigs.launcher.magazine.visible,true)
  p.reloadTimer=0;f.step();assert.equal(f.rigs.launcher.breech.rotation.x,0);assert.equal(f.rigs.launcher.magazine.visible,false)
})

test('all firearms recoil, revolver keeps its cases, and transient actions return to the current weapon',()=>{
  const f=animationFixture(),p=f.world.player
  for(const id of ['pistol','m4','shotgun','plasma','sniper','launcher']) {
    p.activeWeapon=id;f.step(60);f.step(60)
    const z=f.rigs[id].root.position.z,cases=f.effects.cases
    f.world.eventLog.push({type:'shot',by:p.id,weapon:id});f.step()
    assert.equal(f.animation.state.mode,'fire');assert.ok(f.rigs[id].root.position.z>z)
    if(id==='pistol')assert.equal(f.effects.cases,cases)
    assert.ok(Number.isFinite(f.rigs[id].root.rotation.x));f.step(120)
  }
  f.world.eventLog.push({type:'shot',by:p.id,weapon:'knife'});f.step();assert.equal(f.animation.state.mode,'swing')
  f.step(60);assert.equal(f.animation.shown,'launcher')
  f.world.eventLog.push({type:'grenade_thrown',by:p.id});f.step();assert.equal(f.animation.shown,'grenade')
  assert.equal(f.rigs.grenade.body.visible,false);f.step(90);assert.equal(f.animation.shown,'launcher')
})


test('grenades reuse sixteen models across throws and warmup restores hidden source',()=>{
  const scene=new E.Group();scene.modelRoot=new E.Group();scene.add(scene.modelRoot)
  const source=new E.Group();source.name='Player Start';scene.modelRoot.add(source)
  const view=new GrenadeView({scene}),world=worldFixture()
  view.start(world,new E.PhysicalMaterial())
  const slots=[...view.visuals],objects=slots.map(v=>v.object)
  const release=view.primeWarmup();assert.equal(view.template.visible,true);release();assert.equal(view.template.visible,false)
  const projectile={id:0,type:'grenade',pos:{x:0,y:1,z:2},vel:{x:1,y:2,z:3}}
  for(let i=0;i<1000;i++){
    projectile.id=i;world.projectiles=[projectile];world.tick++;view.sync(world)
    assert.equal(view.visuals.filter(v=>v.object.visible).length,1)
  }
  assert.equal(view.visuals.length,16)
  for(let i=0;i<16;i++){assert.equal(slots[i],view.visuals[i]);assert.equal(objects[i],view.visuals[i].object)}
  world.projectiles=[];view.sync(world);assert.equal(view.visuals.some(v=>v.object.visible),false)
  view.stop();assert.equal(scene.children.length,1);assert.equal(view.visuals.length,0)
})
