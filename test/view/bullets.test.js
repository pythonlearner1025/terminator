import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData??=class {}
globalThis.window??={}
const E=await import('threepipe')
const {BulletPool,BulletView,BULLET_STYLE,ImpactQueue,flightTime}=await import('../../lib/view/bullets.js')
const {ProjectileView,projectileStyle}=await import('../../lib/view/projectiles.js')
const {bootLabWorld}=await import('../../scripts/WeaponsLab.script.js')
const resources=()=>({material:new E.PhysicalMaterial(),shellMaterial:new E.PhysicalMaterial()})
const v=(x=0,y=0,z=0)=>new E.Vector3(x,y,z)

test('flight time uses distance and speed, including short contact distances',()=>{
  assert.equal(flightTime(20,60),1/3);assert.equal(flightTime(40,80),.5)
  assert.equal(flightTime(0,60),0);assert.equal(flightTime(.03,60),.0005)
})
test('a bullet occupies its flight point and disappears at arrival without a residual line',()=>{
  const pool=new BulletPool(new E.Group(),4,resources()),p=pool.emit(v(),v(0,0,30),'m4')
  pool.update(.25);assert.equal(p.position.z,15);assert.equal(pool.batch.mesh.count,1)
  assert.ok(pool.batch.mesh.material.isPhysicalMaterial)
  pool.update(.249);assert.ok(p.position.z<30);assert.equal(p.active,true)
  pool.update(.0011);assert.equal(p.active,false);assert.equal(pool.batch.mesh.count,0)
  pool.dispose()
})
test('saturated bullet pools retain every instance buffer and slot vector after warmup',()=>{
  const pool=new BulletPool(new E.Group(),32,resources()),from=v(),to=v(0,0,40)
  const slots=pool.items.map(p=>[p,p.from,p.to,p.position,p.direction])
  const buffers=pool.batch.meshes.flatMap(m=>[m.instanceMatrix.array,m.instanceColor.array])
  const glow=pool.batch.glow
  for(let i=0;i<10000;i++){pool.emit(from,to,i%2?'plasma':'m4');pool.update(.001)}
  assert.ok(pool.overwritten>0);assert.ok(pool.batch.count<=32)
  pool.items.forEach((p,i)=>[p,p.from,p.to,p.position,p.direction].forEach((o,j)=>assert.equal(o,slots[i][j])))
  pool.batch.meshes.flatMap(m=>[m.instanceMatrix.array,m.instanceColor.array]).forEach((b,i)=>assert.equal(b,buffers[i]))
  assert.equal(pool.batch.glow,glow);pool.reset();assert.equal(pool.active,0);pool.dispose()
})
test('scheduled impacts never fire early, fire once, and survive render-pool overwrite',()=>{
  const q=new ImpactQueue(4),shot={weapon:'m4'},point=v(0,0,20),normal=v(0,0,-1),event={}
  const record=q.schedule(event,shot,'unit',flightTime(20,60),point,normal)
  const received=[];const deliver=p=>received.push(p)
  point.z=500;q.flush(1/3-.000001,deliver);assert.equal(received.length,0)
  q.flush(1/3,deliver);assert.deepEqual(received,[record]);assert.equal(record.position.z,20)
  q.flush(20,deliver);assert.equal(received.length,1);assert.equal(q.has(event),true)
  q.reset();assert.equal(q.has(event),false)
})
test('a full impact queue cannot replace or prematurely deliver pending impacts',()=>{
  const q=new ImpactQueue(1),shot={weapon:'m4'},event={}
  q.schedule(event,shot,'unit',5,v(),v())
  assert.equal(q.schedule({},shot,'unit',2,v(),v()),null)
  assert.equal(q.dropped,1);assert.equal(q.pending,1);assert.equal(q.items[0].event,event)
})
test('lab shotgun follows all eight exact core paths and does not mutate the core',()=>{
  const {world,range}=bootLabWorld(),view=new BulletView(new E.Group(),resources())
  range.equip('shotgun');view.sync(world,v(-17,1.5,-13),world.activeColliders())
  world.playerFire();const shot=world.eventLog.at(-1),before=JSON.stringify(world.snapshot())
  assert.equal(shot.paths.length,8)
  view.sync(world,v(-17,1.5,-13),world.activeColliders())
  assert.equal(view.pool.emitted,8)
  shot.paths.forEach((path,i)=>assert.deepEqual(view.pool.items[i].to.toArray(),[path.point.x,path.point.y,path.point.z]))
  const after=world.snapshot();const initial=JSON.parse(before)
  delete after.eventStart;delete after.events;delete initial.eventStart;delete initial.events
  assert.deepEqual(after,initial)
  view.sync(world,v());assert.equal(view.pool.emitted,8);view.dispose();world.destroy()
})
test('recorded damage, marker and endpoint stay delayed after the target dies or moves',()=>{
  const {world,range}=bootLabWorld(),view=new BulletView(new E.Group(),resources())
  range.equip('m4');const from=v(-18,1.65,-13),point={x:2,y:1.65,z:-13}
  view.sync(world,from,[])
  const hit={type:'unit_damage',tick:world.tick,playerId:world.player.id,weapon:'m4',point,unitId:'gone'}
  const shot={type:'shot',tick:world.tick,by:world.player.id,weapon:'m4',origin:from,hit:true,unitId:'gone'}
  world.eventLog.push(hit,shot);view.sync(world,from,[])
  assert.equal(view.handles(hit),true);assert.equal(view.pool.items[0].distance,20)
  point.x=200;world.units.length=0;world.tick+=19;view.sync(world,from,[])
  let count=0;view.impacts.flush(world.tick/60,()=>count++);assert.equal(count,0)
  world.tick++;view.sync(world,from,[]);view.impacts.flush(world.tick/60,()=>count++)
  assert.equal(count,2);assert.equal(view.pool.items[0].to.x,2)
  view.dispose();world.destroy()
})
test('penetrating rifle bullets delay each recorded hit separately without duplicate flight bodies',()=>{
  const world={tick:0,eventLog:[],player:{id:'p',yaw:0,pitch:0},players:new Map()}
  const view=new BulletView(new E.Group(),resources());view.sync(world,v(),[])
  const shot={type:'shot',by:'p',tick:0,weapon:'sniper',origin:v(),hit:true}
  world.eventLog.push({type:'unit_damage',playerId:'p',tick:0,weapon:'sniper',point:v(0,0,20)},
    {type:'unit_damage',playerId:'p',tick:0,weapon:'sniper',point:v(0,0,40)},shot)
  view.sync(world,v(),[]);assert.equal(view.pool.emitted,1)
  const units=view.impacts.items.filter(p=>p.kind==='unit')
  assert.deepEqual(units.map(p=>p.due),[.25,.5]);assert.equal(view.pool.items[0].distance,40)
  view.dispose()
})
test('range pause and partial ticks preserve smooth bullet time without an arrival shortcut',()=>{
  const world={tick:0,eventLog:[],player:{id:'p',yaw:0,pitch:0}}
  const view=new BulletView(new E.Group(),resources()),clock={scale:.1,accumulator:0}
  view.manager={range:{clock}};view.sync(world,v(),[])
  world.eventLog.push({type:'shot',by:'p',tick:0,weapon:'m4',origin:v(),hitPoint:v(0,0,20)})
  view.sync(world,v(),[]);clock.accumulator=.008;view.sync(world,v(),[])
  assert.ok(Math.abs(view.pool.items[0].position.z-.48)<1e-8)
  clock.scale=0;clock.accumulator=0;view.sync(world,v(),[])
  assert.ok(Math.abs(view.pool.items[0].position.z-.48)<1e-8)
  world.tick++;view.sync(world,v(),[]);assert.equal(view.pool.items[0].position.z,1)
  view.dispose()
})
test('enemy round and plasma bodies use recorded velocity, keep snapshots intact, and vanish on removal',()=>{
  const root=new E.Group(),view=new ProjectileView(root,8,resources())
  const world={tick:0,projectiles:['round','bolt','shell','grenade'].map((type,id)=>({id,type,owner:'unit',pos:{x:id,y:1,z:20},vel:{x:0,y:0,z:-18}}))}
  const before=JSON.stringify(world);view.sync(world)
  assert.equal(view.bodies.count,2);assert.equal(view.shells.count,1);assert.equal(view.counts.grenade,1)
  assert.equal(projectileStyle('round').renderer,'bullet');assert.equal(projectileStyle('bolt').renderer,'plasma')
  assert.equal(view.slots[0].speed,18);assert.equal(view.bodies.positions[2],20)
  assert.equal(JSON.stringify(world),before)
  world.projectiles=[];world.tick++;view.sync(world)
  assert.equal(view.bodies.count,0);assert.equal(view.lights[0].intensity,0);view.dispose();assert.equal(root.children.length,0)
})
test('calibre sizes, lit bodies and bounded short trails replace the old streak constraints',()=>{
  assert.ok(BULLET_STYLE.sniper.length>BULLET_STYLE.m4.length)
  assert.ok(BULLET_STYLE.pistol.width>BULLET_STYLE.m4.width)
  assert.ok(BULLET_STYLE.shotgun.width<BULLET_STYLE.m4.width)
  for(const p of Object.values(BULLET_STYLE)){assert.ok(p.trail<=.18);assert.ok(p.emissive>0);assert.ok(p.width<p.length)}
})

test('presentation adapters release flinch, sound, marker and kill effects only at arrival',()=>{
  const world={tick:0,eventLog:[],player:{id:'p',yaw:0,pitch:0},players:new Map()}
  const view=new BulletView(new E.Group(),resources()),calls=[]
  world.unitById=new Map([['dead',{}]])
  view.manager={world,localPlayerId:'p',unitView:{visuals:new Map([['dead',{}]]),damageEvent:()=>calls.push('flinch'),killEffect:()=>calls.push('kill'),
    fx:{gore:{hitWrecks:()=>calls.push('wreck')},update:()=>{}}},audioBindings:{bulletImpact:e=>calls.push(e.type+'-sound')},hud:{showHit:()=>calls.push('marker')}}
  view.sync(world,v(),[])
  const point=v(0,0,20),hit={type:'unit_damage',tick:0,playerId:'p',weapon:'m4',unitId:'dead',point}
  const kill={type:'kill',tick:0,unitId:'dead',weapon:'m4'}
  const shot={type:'shot',by:'p',tick:0,weapon:'m4',origin:v(),hit:true,killed:true}
  world.eventLog.push(hit,kill,shot);view.sync(world,v(),[]);view.flush()
  assert.equal(view.handles(kill),true);assert.equal(view.handlesMarker('0:m4'),true);assert.deepEqual(calls,[])
  world.tick=19;view.sync(world,v(),[]);view.flush();assert.deepEqual(calls,[])
  world.tick=20;view.sync(world,v(),[]);view.flush()
  assert.deepEqual(calls,['flinch','unit_damage-sound','kill','wreck','marker','shot-sound'])
  view.flush();assert.equal(calls.length,6);view.dispose()
})
test('a rewound world clears pending flights and resets the presentation clock',()=>{
  const world={tick:60,eventLog:[],player:{id:'p',yaw:0,pitch:0}},view=new BulletView(new E.Group(),resources())
  view.sync(world,v(),[]);world.eventLog.push({type:'shot',by:'p',tick:60,weapon:'m4',origin:v(),hitPoint:v(0,0,20)})
  view.sync(world,v(),[]);assert.equal(view.pool.active,1)
  world.tick=0;world.eventLog.length=0;view.sync(world,v(),[])
  assert.equal(view.lastTime,0);assert.equal(view.pool.active,0);assert.equal(view.impacts.pending,0);view.dispose()
})

test('arrival still creates an impact at the recorded point after a corpse leaves the view',()=>{
  const world={tick:0,eventLog:[],player:{id:'p',yaw:0,pitch:0},unitById:new Map()}
  const view=new BulletView(new E.Group(),resources()),points=[]
  view.manager={world,playerView:{weapons:{worldFx:{poolList:[],impact:p=>points.push(p.toArray())}}}}
  view.sync(world,v(),[])
  world.eventLog.push({type:'unit_damage',tick:0,playerId:'p',weapon:'m4',unitId:'gone',point:v(0,0,20)},
    {type:'shot',by:'p',tick:0,weapon:'m4',origin:v(),hit:true})
  view.sync(world,v(),[]);world.tick=19;view.sync(world,v(),[]);view.flush();assert.deepEqual(points,[])
  world.tick=20;view.sync(world,v(),[]);view.flush();assert.deepEqual(points,[[0,0,20]]);view.dispose()
})

test('a pending bullet stays invisible until its mechanical discharge time',()=>{
 const pool=new BulletPool(new E.Group(),4,resources())
 pool.emit(v(),v(0,0,20),'pistol',-7/120)
 pool.update(6/120);assert.equal(pool.batch.count,0)
 pool.update(1/120+.000001);assert.equal(pool.batch.count,1)
 pool.dispose()
})

test('local swingout discharge delays the bullet and its impacts together',()=>{
 const world={tick:0,eventLog:[],player:{id:'p',yaw:0,pitch:0}},view=new BulletView(new E.Group(),resources())
 view.manager={localPlayerId:'p',playerView:{weapons:{rigs:{pistol:{root:{userData:{viewModel:{fire:{discharge:7/120}}}},clipPlayer:{actions:new Map([['Fire',{time:0}]])}}}}}}
 view.sync(world,v(),[])
 world.eventLog.push({type:'unit_damage',playerId:'p',tick:0,weapon:'pistol',point:v(0,0,20)},
  {type:'shot',by:'p',tick:0,weapon:'pistol',origin:v(),hit:true})
 view.sync(world,v(),[]);assert.equal(view.pool.batch.count,0)
 assert.ok(Math.abs(view.impacts.items.find(p=>p.kind==='unit').due-(7/120+20/55))<1e-8)
 world.tick=3;view.sync(world,v(),[]);assert.equal(view.pool.batch.count,0)
 world.tick=4;view.sync(world,v(),[]);assert.equal(view.pool.batch.count,1)
 view.dispose()
})


test('fractional bullet time cannot overtake the fixed-tick hammer',()=>{
 const world={tick:100,eventLog:[],player:{id:'p',yaw:0,pitch:0}},view=new BulletView(new E.Group(),resources())
 view.manager={localPlayerId:'p',range:{clock:{scale:1,accumulator:.013}},playerView:{weapons:{rigs:{pistol:{root:{userData:{viewModel:{fire:{discharge:7/120}}}},clipPlayer:{actions:new Map([['Fire',{time:1/60}]])}}}}}}
 view.sync(world,v(),[]);world.eventLog.push({type:'shot',by:'p',tick:100,weapon:'pistol',origin:v(),hitPoint:v(0,0,20)})
 view.sync(world,v(),[]);world.tick+=2;view.sync(world,v(),[]);assert.equal(view.pool.batch.count,0)
 world.tick++;view.sync(world,v(),[]);assert.equal(view.pool.batch.count,1);view.dispose()
})
