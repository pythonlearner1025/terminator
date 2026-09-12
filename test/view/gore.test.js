import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {goreDecision,gorePart,GoreSystem,GoreDeformer,GorePiecePool,primeGorePaths,GORE_VERTEX_CAP,GORE_DENT_CAP,GORE_SPLIT,GORE_DENT,GORE_PARTS}=await import('../../lib/view/gore.js')

test('head kills crunch only on headshot, independently of weapon damage',()=>{
  for(const weapon of ['pistol','m4','shotgun','plasma','sniper']){
    assert.equal(goreDecision({type:'kill',headshot:true,weapon,part:'head'},300),1)
    assert.equal(goreDecision({type:'kill',headshot:false,weapon,part:'head'},300),0)
  }
  assert.equal(goreDecision({type:'unit_damage',headshot:true,amount:200,part:'head'},300),GORE_DENT)
})

test('both arms and legs detach at exactly 60 percent of scaled maximum HP',()=>{
  for(let i=1;i<GORE_PARTS.length;i++){
    const event={type:'unit_damage',part:GORE_PARTS[i],weapon:'sniper',amount:269.99}
    assert.equal(goreDecision(event,450),GORE_DENT)
    event.amount=270
    assert.equal(goreDecision(event,450),GORE_DENT|(1<<i))
  }
  assert.equal(goreDecision({type:'unit_damage',part:'left leg',amount:1000},undefined),GORE_DENT)
})

test('shotgun kills cut the struck limb; blast kills cut four limbs and split the waist',()=>{
  for(let i=1;i<GORE_PARTS.length;i++)assert.equal(goreDecision({type:'kill',part:GORE_PARTS[i],weapon:'shotgun'},300),1<<i)
  assert.equal(goreDecision({type:'kill',part:'Chest',weapon:'shotgun'},300),0)
  const split=GORE_SPLIT|(1<<1)|(1<<2)|(1<<5)|(1<<6)
  for(const weapon of ['grenade','launcher','shell','explosion'])assert.equal(goreDecision({type:'kill',weapon},300),split)
})

test('unknown parts degrade without claiming a humanoid head',()=>{
  for(const part of ['Hull','Wing Left','Cannon','Core',null]){
    assert.equal(gorePart(part),-1)
    assert.equal(goreDecision({type:'kill',weapon:'shotgun',part},500),0)
  }
  assert.equal(gorePart('Forearm_Left'),3)
  assert.equal(goreDecision({type:'unit_damage',amount:180,weapon:'sniper'},300,'Thigh Right'),GORE_DENT|(1<<6))
})

test('vehicle hulls without a humanoid rig degrade to bounded effect bursts',()=>{
  let bursts=0
  const system={definitions:new Map(),stats:{fallbacks:0},burst(){bursts++}}
  const visual={unitType:'hkaerial',object:new E.Group(),rig:{}},point=new E.Vector3(),direction=new E.Vector3(0,0,1)
  GoreSystem.prototype.prepareType.call(system,visual)
  assert.equal(system.definitions.get('hkaerial').size,0)
  GoreSystem.prototype.event.call(system,{type:'unit_damage',part:'Hull',amount:200},visual,{pos:{y:0}},null,point,direction)
  GoreSystem.prototype.detach.call(system,visual,'Thigh Left',direction,0)
  assert.equal(bursts,2);assert.equal(system.stats.fallbacks,2)
})

test('the retained piece pool never grows and evicts the oldest record only when full',()=>{
  let evictions=0
  const pool=new GorePiecePool(i=>({id:i,record:null,born:0,release(){if(this.record)evictions++;this.record=null}}))
  const identities=new Set(pool.items),capacity=pool.items.length
  for(let i=0;i<1000;i++){
    const item=pool.take();assert.ok(identities.has(item));item.record=true;item.born=i
    assert.equal(pool.items.length,capacity)
  }
  assert.equal(evictions,1000-capacity)
  pool.reset();assert.ok(pool.items.every(item=>item.record===null))
})

function geometry(){
  const p=[]
  for(let y=-15;y<15;y++)for(let x=-15;x<15;x++){
    const a=x*.008,b=y*.008,s=.008
    p.push(a,b,0,a+s,b,0,a,b+s,0,a+s,b,0,a+s,b+s,0,a,b+s,0)
  }
  const g=new E.BufferGeometry();g.setAttribute('position',new E.Float32BufferAttribute(p,3));g.computeVertexNormals();return g
}
test('crunch progresses over time, changes real vertices, and preserves source and buffers',()=>{
  const source=geometry(),before=source.attributes.position.array.slice(),d=new GoreDeformer(source)
  const positions=d.geometry.attributes.position.array,normals=d.geometry.attributes.normal.array
  const slot=d.begin(new E.Vector3(),new E.Vector3(0,0,-1),0,.12,.13,true)
  assert.equal(slot.progress,0);assert.deepEqual(positions,before)
  d.apply(slot,.5);const halfway=Math.min(...positions)
  assert.ok(slot.count>0&&slot.count<=GORE_VERTEX_CAP)
  const halfDelta=positions.reduce((sum,v,i)=>sum+Math.abs(v-before[i]),0)
  d.apply(slot,1)
  assert.ok(positions.reduce((sum,v,i)=>sum+Math.abs(v-before[i]),0)>halfDelta*1.9)
  assert.equal(d.geometry.attributes.position.array,positions);assert.equal(d.geometry.attributes.normal.array,normals)
  assert.deepEqual(source.attributes.position.array,before)
  assert.ok(Number.isFinite(halfway));assert.ok(normals.every(Number.isFinite))
  let changed=0;for(let i=0;i<positions.length;i+=3)if(positions[i]!==before[i]||positions[i+1]!==before[i+1]||positions[i+2]!==before[i+2])changed++
  assert.ok(changed<=GORE_VERTEX_CAP)
  d.dispose();source.dispose()
})

test('dents accumulate, recycle at the cap, and reset without geometry replacement',()=>{
  const source=geometry(),d=new GoreDeformer(source),slots=d.slots.slice(),geometryIdentity=d.geometry
  for(let i=0;i<30;i++)d.begin(new E.Vector3((i%5-2)*.02,0,0),new E.Vector3(0,0,-1),0,.06,.04)
  assert.equal(d.slots.length,GORE_DENT_CAP+1)
  assert.ok(d.slots.every((slot,i)=>slot===slots[i]&&slot.count<=GORE_VERTEX_CAP))
  const p=d.geometry.attributes.position.array,base=source.attributes.position.array
  for(let i=0;i<p.length;i++)assert.ok(Math.abs(p[i]-base[i])<=.16001)
  d.reset();assert.equal(d.geometry,geometryIdentity);assert.deepEqual(p,base);assert.equal(d.changed,false)
  d.dispose();source.dispose()
})

test('match warmup reaches skull crunch, one limb, a torso split, and a real dent',()=>{
  const visuals=Array.from({length:3},()=>({rig:{joints:{Head:new E.Bone(),Chest:new E.Bone()}}}))
  const states=Array.from({length:3},()=>({maxHp:300})),calls=[]
  const deformer=new GoreDeformer(geometry())
  const gore={
    detach(v,name){calls.push(name)},
    event(event,v,unit){calls.push(goreDecision(event,unit.maxHp))},
    update(dt){calls.push(dt)},
    deform(){deformer.begin(new E.Vector3(),new E.Vector3(0,0,-1),0);calls.push('dent')},
  }
  primeGorePaths(gore,visuals,states,new E.Vector3(),new E.Vector3(0,0,1))
  assert.ok(calls.includes('Forearm Left'));assert.ok(calls.includes(1));assert.ok(calls.some(mask=>typeof mask==='number'&&(mask&GORE_SPLIT)))
  assert.ok(calls.includes(.06));assert.ok(deformer.changed);assert.ok(calls.includes('dent'))
  deformer.dispose()
})
