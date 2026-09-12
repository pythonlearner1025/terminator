import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../lib/core/world.js'
import {WaveDirector} from '../../lib/core/waves.js'
import {parseRangeFlag, rangeLayout, RANGE_START, RANGE_WEAPONS, WeaponsRange, RangeClock} from '../../lib/core/range.js'
import {mountRangePanel} from '../../lib/ui/range.js'

function fixture(t) {
  const world = new World({seed:81}), director = new WaveDirector(world), range = new WeaponsRange(world,director)
  range.start(); t.after(()=>world.destroy())
  return {world,director,range,step(n,input={yaw:RANGE_START.yaw}){for(let i=0;i<n;i++){director.step(range.input(input));range.afterStep()}}}
}

test('range flag requires range=1 and preserves other URL flags',()=>{
  for(const value of ['?range=1','?t=secret&range=1','?sandbox=1&range=1'])assert.equal(parseRangeFlag(value),true)
  for(const value of ['',null,'?range=0','?range=','?range=true','?sandbox=1'])assert.equal(parseRangeFlag(value),false)
})

test('range off creates no DOM and does not read document',()=>{
  assert.equal(mountRangePanel(null,'?sandbox=1'),null)
  assert.equal(mountRangePanel(null,''),null)
})

test('layout contains eighteen targets, one type per row, with tanks at forty metres',t=>{
  const {world}=fixture(t),layout=rangeLayout()
  assert.equal(world.units.length,18)
  for(const distance of [10,20,40]) {
    const row=layout.filter(slot=>slot.row===distance)
    assert.equal(row.length,6)
    assert.deepEqual(row.map(slot=>slot.type),Object.keys(world.unitCatalog.types))
    for(const slot of row) {
      assert.equal(slot.pos.x-RANGE_START.x,slot.type==='hktank'?40:distance)
      assert.equal(slot.pos.y,slot.type==='hkaerial'?4:0)
    }
  }
  for(const unit of world.units){const spec=world.unitCatalog.types[unit.type];assert.equal(world.positionBlocked(unit.pos,spec.radius,spec.height),false,unit.type)}
  assert.equal(world.positionBlocked(world.player.pos,.38,1.8),false)
})

test('dummy units never move or attack during sixty seconds of stimuli',t=>{
  const {world,step}=fixture(t)
  const positions=world.units.map(u=>structuredClone(u.pos))
  world.addSound('gunshot',world.player.pos)
  step(3600)
  assert.deepEqual(world.units.map(u=>u.pos),positions)
  assert.ok(world.units.every(u=>u.brainType==='dummy'&&Math.hypot(u.vel.x,u.vel.y,u.vel.z)===0))
  assert.equal(world.eventLog.some(e=>e.unitType&&(e.type==='shot'||e.type==='melee')),false)
  assert.equal(world.projectiles.length,0)
  assert.equal(world.wave,0)
})

test('dead targets respawn at the same point after exactly 120 ticks',t=>{
  const {world,range,step}=fixture(t),slot=range.layout[0],old=world.unitById.get(range.targets.get(slot.id))
  world.damageUnit(old.id,100000,{source:'sandbox'})
  step(119);assert.equal(range.targets.get(slot.id),old.id);assert.equal(world.aliveUnits.length,17)
  step(1);const replacement=world.unitById.get(range.targets.get(slot.id))
  assert.notEqual(replacement.id,old.id);assert.deepEqual(replacement.pos,old.pos)
  assert.equal(world.units.length,18);assert.equal(replacement.hp,replacement.maxHp)
  assert.equal(world.eventLog.at(-1).type,'range_respawn')
})

test('range equips all eight weapons and refills each magazine immediately',t=>{
  const {world,range}=fixture(t)
  for(const id of RANGE_WEAPONS){assert.equal(range.equip(id),true);assert.equal(world.player.activeWeapon,id);if(world.player.ammo[id])assert.equal(world.player.ammo[id].mag,world.weaponCatalog.weapons[id].mag)}
  assert.equal(range.equip('missing'),false)
})

test('infinite ammunition retains reserve while a normal reload consumes simulation time',t=>{
  const {world,range,step}=fixture(t);range.equip('m4')
  const reserve=world.player.ammo.m4.reserve
  step(1,{yaw:0,fire:true});assert.equal(world.player.ammo.m4.mag,29)
  assert.equal(world.startReload(),true)
  step(60);assert.ok(world.player.reloadTimer>0);assert.equal(world.player.ammo.m4.mag,29)
  step(60);assert.equal(world.player.reloadTimer,0);assert.equal(world.player.ammo.m4.mag,30)
  assert.equal(world.player.ammo.m4.reserve,reserve)
  const grenades=world.player.grenades;assert.equal(world.throwGrenade(),true);assert.equal(world.player.grenades,grenades)
})

test('reload switch disables magazine depletion and restores the normal animation path',t=>{
  const {world,range,step}=fixture(t);range.equip('m4');range.setReloads(false)
  step(180,{yaw:0,fire:true});assert.equal(world.player.ammo.m4.mag,30);assert.equal(world.startReload(),false)
  range.setReloads(true);step(10,{yaw:0,fire:true});assert.ok(world.player.ammo.m4.mag<30)
  assert.equal(range.reload(),true)
})

test('range clock admits world ticks at 1x, 0.25x, 0.1x, pause and single step',t=>{
  const {world,director}=fixture(t),clock=new RangeClock()
  for(const [scale,expected] of [[1,600],[.25,150],[.1,60],[0,0]]) {
    clock.setScale(scale);const before=world.tick
    for(let i=0;i<600;i++)for(let n=clock.takeTicks(1000/60);n>0;n--)director.step({yaw:0})
    assert.equal(world.tick-before,expected)
  }
  clock.step();const before=world.tick
  for(let i=0;i<10;i++)for(let n=clock.takeTicks(1000/60);n>0;n--)director.step()
  assert.equal(world.tick-before,1);assert.equal(clock.setScale(-1),false)
})

test('range snapshots preserve dummy brains and infinite ammunition',t=>{
  const {world,range,step}=fixture(t);range.setReloads(false);step(12)
  const copy=new World();t.after(()=>copy.destroy());copy.applySnapshot(world.snapshot())
  assert.deepEqual(copy.sandbox,world.sandbox)
  const pos=copy.units.map(u=>structuredClone(u.pos))
  for(let i=0;i<60;i++)copy.step()
  assert.deepEqual(copy.units.map(u=>u.pos),pos)
  assert.ok(copy.units.every(u=>u.brainType==='dummy'))
})

test('range shot paths use authoritative pellet endpoints and do not alter damage or randomness',t=>{
  const standard=new World({seed:199}),range=new World({seed:199});t.after(()=>{standard.destroy();range.destroy()})
  range.setSandbox({infiniteAmmo:true})
  for(const world of [standard,range]){
    world.giveAllWeapons();world.switchWeapon('shotgun');world.player.yaw=Math.PI/2
    world.playerFire()
  }
  assert.equal(standard.eventLog.at(-1).paths,undefined)
  assert.equal(range.eventLog.at(-1).paths.length,8)
  const {paths,...rangeShot}=range.eventLog.at(-1)
  assert.deepEqual(rangeShot,standard.eventLog.at(-1));assert.equal(range.rng.state,standard.rng.state)
  assert.ok(paths.every(p=>Number.isFinite(p.point.x)&&Number.isFinite(p.point.y)&&Number.isFinite(p.point.z)))
})

test('every target has a reachable hit volume from the initial firing point',t=>{
 const {world}=fixture(t),origin={...world.player.pos,y:1.65}
 for(const unit of world.units) {
  const cos=Math.cos(unit.yaw),sin=Math.sin(unit.yaw)
  const hittable=world.unitHitCollider(unit).shapes.some(part=>{
   const o=part.offset,target={x:unit.pos.x+o.x*cos+o.z*sin,y:unit.pos.y+o.y,z:unit.pos.z-o.x*sin+o.z*cos}
   const direction={x:target.x-origin.x,y:target.y-origin.y,z:target.z-origin.z}
   return world.hitscan({origin,direction,damage:0}).unitId===unit.id
  })
  assert.ok(hittable,unit.id)
 }
})

test('inspect aim loop starts on selection and alternates on simulation ticks',t=>{
 const {world,range}=fixture(t);world.tick=135;range.loopStartedAt=world.tick
 assert.equal(range.input({},'aim').aim,true)
 world.tick+=90;assert.equal(range.input({},'aim').aim,false)
 world.tick+=90;assert.equal(range.input({},'aim').aim,true)
 assert.equal(range.input({fire:true},'idle').fire,true)
})
