import {weaponFixture} from './weapon-assets-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData??=class {}
globalThis.window??={}
const E=await import('threepipe')
const {createWeaponRigs,DEFAULT_REVOLVER_VARIANT,revolverVariantFromSearch,WEAPON_IDS}=await import('../../lib/view/weapons.js')
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
  const rigs=createWeaponRigs(new E.Group(),new E.PhysicalMaterial(),weaponFixture),world=worldFixture()
  const effects={flashes:0,cases:0,update(){},fire(){this.flashes++},eject(){this.cases++}}
  const animation=new WeaponAnimation(rigs,effects);animation.sync(world)
  return {rigs,world,effects,animation,step(n=1){world.tick+=n;animation.sync(world)}}
}

test('rebuilt revolver is default while pistol and swingout remain explicit overrides',()=>{
  assert.equal(DEFAULT_REVOLVER_VARIANT,'revolver-rebuild')
  assert.equal(revolverVariantFromSearch(''),'revolver-rebuild')
  assert.equal(revolverVariantFromSearch('?weapon=revolver-rebuild'),'revolver-rebuild')
  assert.equal(revolverVariantFromSearch('?weapon=pistol'),'pistol')
  assert.equal(revolverVariantFromSearch('?weapon=swingout'),'swingout')
})

test('all eight models have distinct mechanisms and finite vertices',()=>{
  const rigs=createWeaponRigs(new E.Group(),new E.PhysicalMaterial(),weaponFixture)
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
    f.rigs[id].root.updateMatrixWorld(true)
    const z=f.rigs[id].body.getWorldPosition(new E.Vector3()).z,cases=f.effects.cases
    f.world.eventLog.push({type:'shot',by:p.id,weapon:id});f.step()
    f.rigs[id].root.updateMatrixWorld(true)
    assert.equal(f.animation.state.mode,'fire');assert.ok(f.rigs[id].body.getWorldPosition(new E.Vector3()).z>z)
    if(id==='pistol')assert.equal(f.effects.cases,cases)
    assert.ok(Number.isFinite(f.rigs[id].root.rotation.x));f.step(120)
  }
  f.world.eventLog.push({type:'shot',by:p.id,weapon:'knife'});f.step();assert.equal(f.animation.state.mode,'swing')
  f.step(60);assert.equal(f.animation.shown,'launcher')
  f.world.eventLog.push({type:'grenade_thrown',by:p.id});f.step();assert.equal(f.animation.shown,'grenade')
  assert.equal(f.rigs.grenade.body.visible,false);f.step(90);assert.equal(f.animation.shown,'launcher')
})


test('grenades reuse sixteen models across throws and warmup restores hidden source',()=>{
  const scene=new E.Group();scene.modelRoot=weaponFixture;scene.add(scene.modelRoot)
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
