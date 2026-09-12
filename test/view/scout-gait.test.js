import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {NavGrid} from '../../lib/core/nav.js'
import {getQualityPreset} from '../../lib/view/performance-quality.js'

globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')
const {bindUnitRig,animateUnit,unitGround}=await import('../../lib/view/units-animation.js')
const {UnitView}=await import('../../lib/view/units.js')
const map=JSON.parse(readFileSync(new URL('../../lib/core/data/map.json',import.meta.url),'utf8'))
const nav=new NavGrid(map)

// Anatomical fixture only: rendering and the full generated Scout are exercised
// separately by tools/verify-scout.mjs in headless Chrome.
function fixture(type='scout') {
  const object=new E.Group(),bones=[],j={}
  object.userData.unitTemplateType=type;object.scale.setScalar(.93)
  const bone=(name,parent,x,y,z)=>{
    const b=new E.Bone();b.name=name;b.position.set(x,y,z);parent.add(b);bones.push(b);j[name]=b;return b
  }
  const pelvis=bone('Pelvis',object,0,.94,0),spine=bone('Spine',pelvis,0,.12,0),chest=bone('Chest',spine,0,.28,0)
  const neck=bone('Neck',chest,0,.29,-.025),head=bone('Head',neck,0,.12,0)
  bone('Jaw',head,0,-.055,-.012)
  for(const [side,sign]of [['Left',-1],['Right',1]]) {
    const shoulder=bone('Shoulder '+side,chest,sign*.28,.19,0)
    const arm=bone('Upper Arm '+side,shoulder,0,-.034,0),fore=bone('Forearm '+side,arm,0,-.37,0)
    bone('Hand '+side,fore,0,-.38,0)
    const thigh=bone('Thigh '+side,pelvis,sign*.14,-.07,0),shin=bone('Shin '+side,thigh,0,-.42,0)
    bone('Foot '+side,shin,0,-.37,0)
  }
  const geometry=new E.BufferGeometry()
  geometry.setAttribute('position',new E.Float32BufferAttribute([0,.94,0,.01,.94,0,0,.95,0],3))
  geometry.setAttribute('skinIndex',new E.Uint16BufferAttribute(new Uint16Array(12),4))
  geometry.setAttribute('skinWeight',new E.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4))
  const mesh=new E.SkinnedMesh(geometry);mesh.name='Combined articulated steel';object.add(mesh)
  object.updateMatrixWorld(true);mesh.bind(new E.Skeleton(bones))
  const rig=bindUnitRig(object);rig.highGeometry=rig.lowGeometry=geometry
  return {object,rig}
}
const state=()=>({id:'scout-test',type:'scout',pos:{x:0,y:0,z:0},yaw:0,vel:{x:0,z:0},alive:true,intent:{}})

test('Scouts stay on all fours at rest and chase, and rise only for stationary melee',()=>{
  const {rig,object}=fixture(),unit=state(),point=new E.Vector3()
  function settle(){for(let i=0;i<40;i++)animateUnit(rig,unit,1/30,i/30,nav)}
  settle()
  assert.ok(rig.joints.Pelvis.rotation.x>1.1)
  for(const f of rig.scoutContacts){point.copy(f.pad);f.tip.localToWorld(point);assert.ok(Math.abs(point.y-.008*.93)<1e-6)}
  unit.intent.melee=true;settle()
  assert.ok(rig.joints.Pelvis.rotation.x<.45)
  assert.ok(rig.joints['Hand Right'].getWorldPosition(point).y>.3)
  unit.vel.z=7
  for(let i=0;i<40;i++){unit.pos.z+=7/30;object.position.z=unit.pos.z;animateUnit(rig,unit,1/30,i/30,nav)}
  assert.ok(rig.joints.Pelvis.rotation.x>1.1)
})

test('T-1000 melee intent drives a visible two-arm strike pose',()=>{
  const {rig}=fixture('t1000')
  const unit={...state(),id:'t1000-test',type:'t1000',intent:{melee:true}}
  for(let i=0;i<40;i++)animateUnit(rig,unit,1/30,i/30)
  assert.ok(rig.states.has('melee'))
  assert.ok(rig.joints['Upper Arm Right'].rotation.x<-.4)
  assert.ok(rig.joints['Forearm Left'].rotation.x<-.3)
})

test('new Scouts start animating and retain the 30 Hz UnitView gate',()=>{
  const unit=state(),world={tick:0,units:[unit],player:{pos:{x:0,z:0}},nav}
  unit.vel.z=7
  const visual=fixture(),view={owner:{},activeIds:new Set(),visuals:new Map(),lastTick:0,quality:getQualityPreset('high'),
    cloneTemplateFigure:()=>visual,processEvents(){},fx:{update(){}},optics:{update(){}}}
  let previous=-1,updates=0
  for(let i=0;i<120;i++){
    world.tick=i;unit.pos.z=i*7/60
    UnitView.prototype.sync.call(view,world)
    if(visual.lastAnimationTick!==previous){updates++;previous=visual.lastAnimationTick}
  }
  assert.equal(updates,60)
  assert.ok(visual.rig.phase>20)
  assert.ok(visual.rig.joints.Pelvis.rotation.x>1.1)
})

test('allocation-free ground sampling agrees with core support on Bunker 7 surfaces',()=>{
  for(let x=-29;x<30;x+=.73)for(let z=-29;z<30;z+=.79)for(const y of [0,.5,1,2,3,3.15]) {
    const expected=nav.supportAt({x,z},y,{maxAbove:.6,maxBelow:3})?.y??y
    assert.equal(unitGround(nav,x,z,y),expected,`support at ${x}, ${y}, ${z}`)
  }
})
