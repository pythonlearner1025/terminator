import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData??=class {}
globalThis.window??={}
const E=await import('threepipe')
const {TracerPool,TRACER_STYLE}=await import('../../lib/view/tracers.js')
const {ProjectileView,PROJECTILE_STYLE}=await import('../../lib/view/projectiles.js')

test('exposure lengths stay bounded and all luminous cores are narrow',()=>{
  for(const style of Object.values(TRACER_STYLE)){
    assert.ok(Math.abs(style.speed*style.exposure-style.trail)<1e-8)
    assert.ok(style.width<=.034);assert.equal(style.minPixels,1.5)
    assert.ok(style.linger>=.12&&style.linger<=.2)
  }
  assert.equal(PROJECTILE_STYLE.round.exposure*30,1)
  assert.ok(PROJECTILE_STYLE.bolt.width<.05)
})

test('residual light stays behind flight and expires per passed point',()=>{
  const pool=new TracerPool(new E.Group(),4)
  pool.emit(new E.Vector3(),new E.Vector3(0,0,40),'m4');pool.update(.25)
  const batch=pool.batch
  assert.equal(batch.count,2)
  assert.equal(batch.phase[3],0);assert.equal(batch.phase[7],1)
  assert.ok(Math.abs(batch.start[5]-13.5)<1e-5)
  assert.ok(Math.abs(batch.end[5]-batch.start[2])<1e-5)
  assert.equal(batch.phase[5],1)
  assert.ok(batch.phase[6]>0&&batch.phase[6]<1)
  pool.update(.07)
  assert.equal(batch.count,1);assert.equal(batch.phase[3],1);assert.equal(batch.end[2],40)
  pool.update(.107);assert.equal(pool.active,0);assert.equal(batch.count,0)
  pool.dispose()
})

test('all instance buffers and slot vectors survive saturated warm reuse',()=>{
  const pool=new TracerPool(new E.Group(),16),batch=pool.batch
  const buffers=Object.values(batch.geometry.attributes).map(a=>a.array)
  const slots=pool.items.map(p=>[p,p.from,p.direction])
  const a=new E.Vector3(),b=new E.Vector3(0,0,40)
  for(let i=0;i<10000;i++){pool.emit(a,b,i%2?'plasma':'m4');pool.update(.002)}
  assert.ok(batch.count<=32)
  Object.values(batch.geometry.attributes).forEach((a,i)=>assert.equal(a.array,buffers[i]))
  pool.items.forEach((p,i)=>{assert.equal(p,slots[i][0]);assert.equal(p.from,slots[i][1]);assert.equal(p.direction,slots[i][2])})
  pool.reset();assert.equal(batch.count,0);pool.dispose()
})

test('removed enemy rounds leave no bright head or extrapolated flight',()=>{
  const root=new E.Group(),view=new ProjectileView(root,4,{shellMaterial:new E.PhysicalMaterial()})
  const world={tick:0,projectiles:[{id:1,type:'round',owner:'unit',pos:{x:0,y:1,z:20},vel:{x:0,y:0,z:-30}}]}
  const camera=new E.PerspectiveCamera()
  view.sync(world,camera)
  world.tick=6;world.projectiles[0].pos.z=17;view.sync(world,camera)
  assert.equal(view.streaks.end[2],17);assert.equal(view.streaks.start[2],18)
  world.projectiles.length=0;world.tick++;view.sync(world,camera)
  assert.equal(view.streaks.count,1);assert.equal(view.streaks.phase[3],1)
  assert.equal(view.streaks.end[2],17)
  world.tick+=6;view.sync(world,camera);world.tick+=6;view.sync(world,camera)
  assert.equal(view.streaks.count,0)
  view.dispose();assert.equal(root.children.length,0)
})

test('shells have physical bodies and one thin nonadditive smoke line',()=>{
  const root=new E.Group(),view=new ProjectileView(root,4,{shellMaterial:new E.PhysicalMaterial()})
  const world={tick:0,projectiles:[{id:1,type:'shell',owner:'unit',pos:{x:0,y:2,z:20},vel:{x:0,y:0,z:-18}}]}
  const camera=new E.PerspectiveCamera()
  view.sync(world,camera);world.tick=6;world.projectiles[0].pos.z=18.2;view.sync(world,camera)
  assert.equal(view.shells.count,1);assert.equal(view.streaks.count,0)
  assert.ok(view.smoke.count<=2);assert.equal(view.smoke.material.blending,E.NormalBlending)
  assert.equal(view.smoke.material.map,null)
  view.dispose();assert.equal(root.children.length,0)
})
