import test from 'node:test'
import assert from 'node:assert/strict'
import {withV2ArchitectureCover} from '../../lib/core/v2-cover.js'
import {defaultMap} from '../../lib/core/map.js'
import {World} from '../../lib/core/world.js'

const cover = () => ({id:'v2_arch_cover_test',kind:'rubble',center:{x:0,y:.5,z:8},size:{x:2,y:1,z:2},navBlock:true,blocksSight:true,pile:{source:'test-only',scale:1}})

test('declared cover reaches movement, navigation and sight before World construction', () => {
  const original = new World({map:defaultMap,seed:1})
  const spec = cover(), map = withV2ArchitectureCover(defaultMap,[spec]), world = new World({map,seed:1})
  const point={x:0,y:0,z:8},from={x:-5,y:.5,z:8},to={x:5,y:.5,z:8}
  assert.equal(original.positionBlocked(point,.1),false)
  assert.equal(original.lineOfSight(from,to),true)
  assert.equal(world.positionBlocked(point,.1),true)
  assert.equal(world.nav.isBlocked(world.nav.worldToCell(point)),true)
  assert.equal(world.lineOfSight(from,to),false)
  assert.equal(world.lineOfSight({...from,y:1.65},{...to,y:1.65}),true,'low cover does not become a full-height wall')
  assert.equal(defaultMap.colliders.some(c=>c.id===spec.id),false)
  assert.equal(map.colliders[0],defaultMap.colliders[0],'authored collider identity retained')
  assert.notEqual(map.colliders.at(-1),spec)
  assert.notEqual(map.colliders.at(-1).pile,spec.pile)
  assert.equal(withV2ArchitectureCover(map,[spec]),map,'repeat augmentation cannot duplicate cover')
})

test('compound cover uses declared small solids rather than its empty enclosing box', () => {
  const spec=cover();spec.size={x:6,y:1,z:2};spec.shapes=[-2,2].map(x=>({shape:'box',offset:{x,y:0,z:0},size:{x:1,y:1,z:2}}))
  const world=new World({map:withV2ArchitectureCover(defaultMap,[spec]),seed:1})
  assert.equal(world.positionBlocked({x:0,y:0,z:8},.1),false)
  assert.equal(world.positionBlocked({x:2,y:0,z:8},.1),true)
})

test('invalid or conflicting cover fails without mutating the map or layout', () => {
  for(const edit of [s=>{s.blocksSight=false},s=>{s.navBlock=false},s=>{s.center.x=NaN},s=>{s.size.y=0},s=>{s.shapes=[]},s=>{s.shapes=[{shape:'sphere',radius:1}]},s=>{s.id='existing_wall'}]) {
    const spec=cover();edit(spec);assert.throws(()=>withV2ArchitectureCover(defaultMap,[spec]))
  }
  const spec=cover(),map=withV2ArchitectureCover(defaultMap,[spec]),before=JSON.stringify(map)
  assert.throws(()=>withV2ArchitectureCover(defaultMap,[spec,spec]),/duplicate/)
  spec.center.x=4;assert.throws(()=>withV2ArchitectureCover(map,[spec]),/replace/)
  assert.equal(JSON.stringify(map),before)
})
